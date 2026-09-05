import { useCallback, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios, { AxiosError } from 'axios';
import { Alert, Button, Spinner } from '@/components/ui';
import {
  confirmarDocumento,
  fetchDownloadUrl,
  fetchProcessoDocumentos,
  requestUploadUrl,
} from './api';
import { formatarDataHora, formatarTamanho } from './helpers';

/**
 * Aba Documentos do Detalhe do Processo (Req 5.4, 4.5, 4.7).
 *
 * - Lista os documentos anexados (nome, data de envio, tamanho) e oferece um
 *   botão de download por item, que solicita a presigned URL ao backend e
 *   abre o `downloadUrl` retornado.
 * - Permite ao Cidadão anexar novos documentos pelo fluxo de duas etapas
 *   (presigned upload → confirmação), validando formato e tamanho no cliente
 *   para espelhar as regras do backend (PDF/JPG/JPEG/PNG/DOC/DOCX, ≤10MB).
 */
export interface DocumentosTabProps {
  processoId: string;
}

/** Formatos aceitos (extensões), alinhados a `FORMATOS_PERMITIDOS` do backend. */
const EXTENSOES_ACEITAS = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx'];

/** MIME types aceitos por extensão (espelham `MIME_TYPES_PERMITIDOS` do backend). */
const ACCEPT: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
};

/** Tamanho máximo por arquivo: 10 MB (Req 4.5, 4.7). */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Extrai a extensão (lowercase, sem ponto) de um nome de arquivo. */
function extensao(nome: string): string {
  const partes = nome.toLowerCase().split('.');
  return partes.length > 1 ? partes[partes.length - 1] : '';
}

export function DocumentosTab({ processoId }: DocumentosTabProps) {
  const queryClient = useQueryClient();
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const [baixandoId, setBaixandoId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['processo', processoId, 'documentos'],
    queryFn: () => fetchProcessoDocumentos(processoId),
  });

  // Fluxo de duas etapas: presigned URL → PUT direto ao MinIO → confirmação.
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const mimeType = file.type || '';
      const arquivo = { nomeOriginal: file.name, mimeType, tamanhoBytes: file.size };
      const { uploadUrl, caminhoStorage } = await requestUploadUrl(processoId, arquivo);
      // Upload direto ao MinIO (fora do axiosInstance, para não anexar o Bearer).
      await axios.put(uploadUrl, file, { headers: { 'Content-Type': mimeType } });
      return confirmarDocumento(processoId, { ...arquivo, caminhoStorage });
    },
    onSuccess: () => {
      setErroLocal(null);
      void queryClient.invalidateQueries({
        queryKey: ['processo', processoId, 'documentos'],
      });
    },
  });

  const onDrop = useCallback(
    (aceitos: File[], rejeitados: FileRejection[]) => {
      if (rejeitados.length > 0) {
        setErroLocal(
          `Arquivo inválido. Formatos aceitos: ${EXTENSOES_ACEITAS.join(', ').toUpperCase()} (até 10MB).`,
        );
        return;
      }
      const file = aceitos[0];
      if (!file) return;

      // Checagem redundante de segurança (dropzone já filtra por accept/maxSize).
      if (!EXTENSOES_ACEITAS.includes(extensao(file.name)) || file.size > MAX_FILE_BYTES) {
        setErroLocal(
          `Arquivo inválido. Formatos aceitos: ${EXTENSOES_ACEITAS.join(', ').toUpperCase()} (até 10MB).`,
        );
        return;
      }

      setErroLocal(null);
      uploadMutation.mutate(file);
    },
    [uploadMutation],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT,
    maxSize: MAX_FILE_BYTES,
    multiple: false,
    disabled: uploadMutation.isPending,
  });

  async function handleDownload(docId: string) {
    setBaixandoId(docId);
    try {
      const { downloadUrl } = await fetchDownloadUrl(processoId, docId);
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    } catch {
      setErroLocal('Não foi possível gerar o link de download. Tente novamente.');
    } finally {
      setBaixandoId(null);
    }
  }

  const erroUpload =
    uploadMutation.error instanceof AxiosError
      ? ((uploadMutation.error.response?.data as { error?: string } | undefined)?.error ??
        'Falha ao enviar o documento. Tente novamente.')
      : uploadMutation.error
        ? 'Falha ao enviar o documento. Tente novamente.'
        : null;

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="documentos-lista-heading">
        <h3
          id="documentos-lista-heading"
          className="mb-2 text-base font-semibold text-text-primary"
        >
          Documentos anexados
        </h3>
        {isLoading ? (
          <Spinner label="Carregando documentos..." />
        ) : isError ? (
          <Alert variant="danger" title="Não foi possível carregar os documentos">
            Tente novamente em alguns instantes.
          </Alert>
        ) : (data ?? []).length === 0 ? (
          <p className="text-sm text-text-secondary">Nenhum documento anexado a este processo.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-neutral/40">
            {(data ?? []).map((doc) => (
              <li
                key={doc.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-base text-text-primary">{doc.nomeOriginal}</p>
                  <p className="text-sm text-text-secondary">
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
      </section>

      <section aria-labelledby="documentos-upload-heading">
        <h3
          id="documentos-upload-heading"
          className="mb-2 text-base font-semibold text-text-primary"
        >
          Anexar novo documento
        </h3>

        <div
          {...getRootProps()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed p-6 text-center transition-colors ${
            isDragActive ? 'border-primary bg-primary/5' : 'border-neutral'
          } ${uploadMutation.isPending ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          <input {...getInputProps()} aria-label="Selecionar documento para upload" />
          {uploadMutation.isPending ? (
            <Spinner label="Enviando documento..." />
          ) : (
            <>
              <p className="text-sm text-text-primary">
                Arraste um arquivo aqui ou clique para selecionar
              </p>
              <p className="text-xs text-text-secondary">
                {EXTENSOES_ACEITAS.join(', ').toUpperCase()} · até 10MB
              </p>
            </>
          )}
        </div>

        {(erroLocal || erroUpload) && (
          <Alert variant="danger" className="mt-3">
            {erroLocal ?? erroUpload}
          </Alert>
        )}
      </section>
    </div>
  );
}

export default DocumentosTab;
