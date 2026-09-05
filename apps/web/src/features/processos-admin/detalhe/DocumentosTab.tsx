import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Spinner } from '@/components/ui';
import { queryKeys } from '@/hooks/useSocket';
import { anexarDocumento, fetchDocumentos, fetchDownloadUrl } from './api';
import { extractApiError, formatarDataHora, formatarTamanho } from './helpers';

/**
 * Aba Documentos do Detalhe Administrativo (Task 15.2 + 28.2, Req 5.4, 24.6, 25).
 *
 * Lista os documentos anexados ao Processo (nome, data, tamanho, origem) e
 * oferece download por item (presigned URL). Além disso (Task 28.2):
 *  - destaca os `documentosSolicitadosPendentes` (Req 25.5), quando houver;
 *  - oferece um seletor de arquivos para anexar novos documentos ao Processo
 *    reutilizando o fluxo presigned do MinIO (upload-url → PUT → confirmação),
 *    quando o servidor tem permissão `editar` (Req 24.6, 25.1–25.4).
 *
 * O backend valida formato/tamanho/limites ao gerar a presigned URL — as
 * mensagens descritivas de erro são exibidas por arquivo (Req 25.2). Após um
 * upload bem-sucedido, invalida a lista de documentos e o detalhe do Processo
 * (recalcula as pendências).
 *
 * _Requirements: 5.4, 24.6, 25.1, 25.2, 25.3, 25.4, 25.5_
 */
export interface DocumentosTabProps {
  processoId: string;
  /** Documentos solicitados ao cidadão ainda não anexados (Req 25.5). */
  documentosSolicitadosPendentes?: string[];
  /** Habilita a anexação de documentos (permissão `editar`, Req 24.6). */
  podeAnexar?: boolean;
}

/** Query-key dos documentos de um Processo (idêntica à usada no Portal). */
function documentosQueryKey(processoId: string): readonly [string, string, 'documentos'] {
  return ['processo', processoId, 'documentos'] as const;
}

/** Resultado do envio de um arquivo, para reporte por item (Req 25.2). */
interface ResultadoUpload {
  nome: string;
  sucesso: boolean;
  erro?: string;
}

export function DocumentosTab({
  processoId,
  documentosSolicitadosPendentes = [],
  podeAnexar = false,
}: DocumentosTabProps) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [baixandoId, setBaixandoId] = useState<string | null>(null);
  const [erroDownload, setErroDownload] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoUpload[]>([]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: documentosQueryKey(processoId),
    queryFn: () => fetchDocumentos(processoId),
  });

  async function handleDownload(docId: string) {
    setBaixandoId(docId);
    setErroDownload(null);
    try {
      const { downloadUrl } = await fetchDownloadUrl(processoId, docId);
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setErroDownload(extractApiError(err, 'Não foi possível gerar o link de download.'));
    } finally {
      setBaixandoId(null);
    }
  }

  async function handleSelecionarArquivos(arquivos: FileList | null) {
    if (!arquivos || arquivos.length === 0) return;
    setEnviando(true);
    const novos: ResultadoUpload[] = [];
    for (const file of Array.from(arquivos)) {
      try {
        await anexarDocumento(processoId, file);
        novos.push({ nome: file.name, sucesso: true });
      } catch (err) {
        novos.push({
          nome: file.name,
          sucesso: false,
          erro: extractApiError(err, 'Não foi possível anexar este arquivo.'),
        });
      }
    }
    setResultados(novos);
    setEnviando(false);
    // Limpa o input para permitir reenviar o mesmo arquivo, se necessário.
    if (inputRef.current) inputRef.current.value = '';
    // Atualiza a lista de documentos e o detalhe (recalcula pendências, Req 25.5).
    void queryClient.invalidateQueries({ queryKey: documentosQueryKey(processoId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.processo(processoId) });
  }

  if (isLoading) {
    return <Spinner label="Carregando documentos..." />;
  }

  if (isError) {
    return (
      <Alert variant="danger" title="Não foi possível carregar os documentos">
        {extractApiError(error)}
      </Alert>
    );
  }

  const documentos = data ?? [];
  const falhas = resultados.filter((r) => !r.sucesso);
  const sucessos = resultados.filter((r) => r.sucesso);

  return (
    <div className="flex flex-col gap-4">
      {erroDownload && <Alert variant="danger">{erroDownload}</Alert>}

      {/* --- Documentos solicitados pendentes (Req 25.5) ------------------- */}
      {documentosSolicitadosPendentes.length > 0 && (
        <Alert variant="warning" title="Documentos solicitados pendentes">
          <ul className="list-disc pl-5">
            {documentosSolicitadosPendentes.map((doc) => (
              <li key={doc}>{doc}</li>
            ))}
          </ul>
        </Alert>
      )}

      {/* --- Anexação de documentos (Req 24.6, 25.1–25.4) ------------------ */}
      {podeAnexar && (
        <div className="flex flex-col gap-2 rounded-card border border-neutral bg-white p-3">
          <p className="text-sm font-medium text-text-primary">Anexar documento</p>
          <p className="text-xs text-text-secondary">
            Formatos aceitos: PDF, JPG, PNG, DOC, DOCX. Até 10MB por arquivo.
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            disabled={enviando}
            onChange={(e) => void handleSelecionarArquivos(e.target.files)}
            className="w-full rounded-btn border border-neutral bg-white px-3 py-2 text-base text-text-primary file:mr-3 file:rounded-btn file:border-0 file:bg-primary file:px-3 file:py-1 file:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:bg-bg-alt"
          />
          {enviando && <Spinner size="sm" label="Enviando arquivos..." />}
          {sucessos.length > 0 && (
            <Alert variant="success">
              {sucessos.length} arquivo(s) anexado(s) com sucesso.
            </Alert>
          )}
          {falhas.length > 0 && (
            <Alert variant="danger" title="Alguns arquivos não foram anexados">
              <ul className="list-disc pl-5">
                {falhas.map((f) => (
                  <li key={f.nome}>
                    {f.nome}: {f.erro}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
      )}

      {documentos.length === 0 ? (
        <p className="text-sm text-text-secondary">Nenhum documento anexado a este processo.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-neutral/40 rounded-card border border-neutral bg-white">
          {documentos.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm text-text-primary">{doc.nomeOriginal}</p>
                  <Badge color={doc.enviadoPorCidadao ? 'blue' : 'neutral'}>
                    {doc.enviadoPorCidadao ? 'Cidadão' : 'Servidor'}
                  </Badge>
                </div>
                <p className="text-xs text-text-secondary">
                  {formatarDataHora(doc.enviadoEm)} · {formatarTamanho(doc.tamanhoBytes)}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                loading={baixandoId === doc.id}
                onClick={() => void handleDownload(doc.id)}
              >
                Baixar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default DocumentosTab;
