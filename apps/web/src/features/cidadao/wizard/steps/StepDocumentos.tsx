import { useCallback, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Alert, Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  DROPZONE_ACCEPT,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  FORMATOS_PERMITIDOS,
  formatarTamanho,
  validarLote,
} from '../documentos.validacao';

/**
 * Step 5 do wizard — anexos do processo via react-dropzone (Req. 4.5).
 *
 * Valida no cliente: formatos PDF/JPG/PNG/DOC/DOCX, ≤10MB por arquivo, ≤50MB
 * no total e ≤20 arquivos. Arquivos válidos são preservados; os inválidos são
 * rejeitados com mensagem descritiva (Req. 4.5). O envio ao MinIO ocorre APÓS a
 * criação do processo (ver ordem documentada em `wizard.api.ts`), então aqui
 * apenas coletamos os `File[]` no estado do wizard.
 *
 * Documentos são opcionais neste step (a obrigatoriedade específica por tipo é
 * tratada pelo Formulário Dinâmico via campos de upload, no step 4).
 */

interface StepDocumentosProps {
  /** Arquivos já coletados (mantidos pelo container). */
  files: File[];
  /** Atualiza a lista completa de arquivos. */
  onChange: (files: File[]) => void;
}

export function StepDocumentos({ files, onChange }: StepDocumentosProps) {
  const [erros, setErros] = useState<string[]>([]);

  const onDrop = useCallback(
    (aceitosDropzone: File[], rejeitados: FileRejection[]) => {
      // Junta os candidatos (aceitos + rejeitados pelo dropzone) e revalida com
      // as nossas regras agregadas (quantidade e total), preservando os válidos.
      const candidatos = [...aceitosDropzone, ...rejeitados.map((r) => r.file)];
      const { aceitos, erros: errosLote } = validarLote(files, candidatos);
      if (aceitos.length > 0) {
        onChange([...files, ...aceitos]);
      }
      setErros(errosLote);
    },
    [files, onChange],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: DROPZONE_ACCEPT,
    maxSize: MAX_FILE_BYTES,
    multiple: true,
    noClick: true,
    noKeyboard: true,
  });

  function removerArquivo(indice: number): void {
    onChange(files.filter((_, i) => i !== indice));
    setErros([]);
  }

  const totalBytes = files.reduce((soma, f) => soma + f.size, 0);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        Anexe documentos que apoiem o seu processo (opcional). Formatos aceitos:{' '}
        {FORMATOS_PERMITIDOS.join(', ').toUpperCase()}. Máximo de {MAX_FILES} arquivos,{' '}
        {formatarTamanho(MAX_FILE_BYTES)} por arquivo e {formatarTamanho(MAX_TOTAL_BYTES)} no total.
      </p>

      <div
        {...getRootProps()}
        className={cn(
          'flex flex-col items-center gap-3 rounded-card border-2 border-dashed p-8 text-center',
          isDragActive ? 'border-primary bg-primary-light' : 'border-neutral bg-bg-alt',
        )}
      >
        <input {...getInputProps()} aria-label="Selecionar documentos" />
        <p className="text-text-primary">
          Arraste e solte os arquivos aqui, ou selecione manualmente.
        </p>
        <Button variant="secondary" size="sm" onClick={open}>
          Selecionar arquivos
        </Button>
      </div>

      {erros.length > 0 && (
        <Alert variant="warning" title="Alguns arquivos não foram anexados">
          <ul className="list-disc pl-5">
            {erros.map((erro) => (
              <li key={erro}>{erro}</li>
            ))}
          </ul>
        </Alert>
      )}

      {files.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-text-primary">
            {files.length} arquivo(s) — {formatarTamanho(totalBytes)}
          </p>
          <ul className="flex flex-col gap-2">
            {files.map((file, indice) => (
              <li
                key={`${file.name}-${indice}`}
                className="flex items-center justify-between gap-3 rounded-btn border border-neutral bg-white px-3 py-2"
              >
                <span className="flex flex-col">
                  <span className="text-sm text-text-primary">{file.name}</span>
                  <span className="text-xs text-text-secondary">{formatarTamanho(file.size)}</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removerArquivo(indice)}
                  aria-label={`Remover ${file.name}`}
                >
                  Remover
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default StepDocumentos;
