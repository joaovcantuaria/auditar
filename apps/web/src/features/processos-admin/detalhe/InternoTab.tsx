import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Alert, Button, Input, Spinner } from '@/components/ui';
import {
  enviarMensagemInterna,
  fetchMensagensInternas,
  requestUploadUrl,
  type AnexoInterno,
  type EnviarMensagemInternaInput,
} from './api';
import { extractApiError, formatarDataHora, MAX_MENSAGEM } from './helpers';

/**
 * Aba Interno do Detalhe Administrativo — canal de mensagens internas
 * Servidor ↔ Servidor (Task 15.2, Req 13.2, 13.5, 13.6, 13.8).
 *
 * Este canal é exclusivo de Servidor e invisível ao Cidadão — a página inteira
 * já está sob a `RoleRoute` do painel administrativo, e a rota do backend
 * exige a permissão `OBSERVACAO_INTERNA`.
 *
 * - Lista as mensagens internas em ordem crescente. Sem evento de socket
 *   dedicado, a lista se atualiza no envio (invalidação da query local).
 * - Composer: textarea + `destinatarioServidorId` opcional (quando informado,
 *   o backend notifica o Servidor destinatário — Req 13.6) + anexo opcional
 *   (≤10MB, formatos PDF/JPG/PNG/DOC/DOCX — Req 13.5).
 * - O anexo é enviado direto ao MinIO via presigned URL (reuso do endpoint de
 *   Documentos) e apenas seus metadados + `caminhoStorage` seguem no corpo.
 * - Composer desabilitado quando o Processo está encerrado (Req 13.8).
 */
export interface InternoTabProps {
  processoId: string;
  /** True quando o Processo está encerrado (aprovado/rejeitado/finalizado). */
  encerrado: boolean;
}

/** Formatos aceitos (extensões), alinhados a `FORMATOS_PERMITIDOS` do backend. */
const EXTENSOES_ACEITAS = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx'];

/** Tamanho máximo por anexo: 10 MB (Req 13.5). */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Query-key local das mensagens internas de um Processo. */
function internasQueryKey(processoId: string): readonly [string, string, 'mensagens-internas'] {
  return ['processo', processoId, 'mensagens-internas'] as const;
}

/** Extrai a extensão (lowercase, sem ponto) de um nome de arquivo. */
function extensao(nome: string): string {
  const partes = nome.toLowerCase().split('.');
  return partes.length > 1 ? partes[partes.length - 1] : '';
}

export function InternoTab({ processoId, encerrado }: InternoTabProps) {
  const queryClient = useQueryClient();
  const [conteudo, setConteudo] = useState('');
  const [destinatario, setDestinatario] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erroLocal, setErroLocal] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: internasQueryKey(processoId),
    queryFn: () => fetchMensagensInternas(processoId),
  });

  const mutation = useMutation({
    mutationFn: async (input: EnviarMensagemInternaInput) =>
      enviarMensagemInterna(processoId, input),
    onSuccess: () => {
      setConteudo('');
      setDestinatario('');
      setArquivo(null);
      setErroLocal(null);
      void queryClient.invalidateQueries({ queryKey: internasQueryKey(processoId) });
    },
  });

  /** Valida (client-side) e faz o upload do anexo ao MinIO, retornando seus metadados. */
  async function prepararAnexo(file: File): Promise<AnexoInterno> {
    if (!EXTENSOES_ACEITAS.includes(extensao(file.name)) || file.size > MAX_FILE_BYTES) {
      throw new Error(
        `Anexo inválido. Formatos aceitos: ${EXTENSOES_ACEITAS.join(', ').toUpperCase()} (até 10MB).`,
      );
    }
    const mimeType = file.type || 'application/octet-stream';
    const meta = { nomeOriginal: file.name, mimeType, tamanhoBytes: file.size };
    const { uploadUrl, caminhoStorage } = await requestUploadUrl(processoId, meta);
    // Upload direto ao MinIO (fora do axiosInstance, para não anexar o Bearer).
    await axios.put(uploadUrl, file, { headers: { 'Content-Type': mimeType } });
    return { ...meta, caminhoStorage };
  }

  async function handleEnviar() {
    const texto = conteudo.trim();
    if (!texto) return;
    setErroLocal(null);
    try {
      const anexo = arquivo ? await prepararAnexo(arquivo) : undefined;
      mutation.mutate({
        conteudo: texto,
        destinatarioServidorId: destinatario.trim() || undefined,
        anexo,
      });
    } catch (err) {
      setErroLocal(extractApiError(err, 'Falha ao anexar o arquivo. Tente novamente.'));
    }
  }

  const mensagens = data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {isLoading ? (
        <Spinner label="Carregando mensagens internas..." />
      ) : isError ? (
        <Alert variant="danger" title="Não foi possível carregar as mensagens internas">
          {extractApiError(error)}
        </Alert>
      ) : mensagens.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Ainda não há mensagens internas neste processo.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {mensagens.map((m) => (
            <li key={m.id} className="rounded-card border border-neutral/50 bg-white p-3">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-text-primary">
                  {m.remetenteServidor?.nome ?? 'Servidor'}
                </span>
                <span className="text-xs text-text-secondary">
                  {formatarDataHora(m.enviadaEm)}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-text-primary">{m.conteudo}</p>
              {m.caminhoAnexo && (
                <p className="mt-1 text-xs text-text-secondary">Anexo incluído.</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        {encerrado ? (
          <Alert variant="info">
            Este processo está encerrado. O envio de novas mensagens internas está desabilitado.
          </Alert>
        ) : (
          <>
            <label htmlFor="interno-mensagem" className="text-sm font-medium text-text-primary">
              Nova mensagem interna
            </label>
            <textarea
              id="interno-mensagem"
              value={conteudo}
              maxLength={MAX_MENSAGEM}
              onChange={(e) => setConteudo(e.target.value)}
              rows={3}
              disabled={mutation.isPending}
              className="w-full rounded-btn border border-neutral bg-white px-3 py-2 text-base text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:bg-bg-alt"
              placeholder="Mensagem visível apenas a servidores..."
            />
            <Input
              label="Destinatário (ID do servidor, opcional)"
              value={destinatario}
              onChange={(e) => setDestinatario(e.target.value)}
              disabled={mutation.isPending}
              helperText="Quando informado, o servidor destinatário é notificado."
            />
            <div className="flex flex-col gap-1">
              <label htmlFor="interno-anexo" className="text-sm font-medium text-text-primary">
                Anexo (opcional)
              </label>
              <input
                id="interno-anexo"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                disabled={mutation.isPending}
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                className="text-sm text-text-primary file:mr-3 file:rounded-btn file:border file:border-primary file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
              />
              <p className="text-xs text-text-secondary">
                {EXTENSOES_ACEITAS.join(', ').toUpperCase()} · até 10MB
              </p>
            </div>
            {(erroLocal || mutation.isError) && (
              <Alert variant="danger">{erroLocal ?? extractApiError(mutation.error)}</Alert>
            )}
            <div className="flex justify-end">
              <Button
                onClick={() => void handleEnviar()}
                loading={mutation.isPending}
                disabled={conteudo.trim().length === 0}
              >
                Enviar
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default InternoTab;
