/**
 * Validação client-side dos documentos anexados no step 5 do wizard (Req. 4.5).
 *
 * Espelha as regras do backend (`documentos.service.ts`): formatos permitidos,
 * ≤10MB por arquivo, ≤50MB no total e ≤20 arquivos. É uma validação de UX
 * (mensagem imediata e descritiva); o backend revalida ao gerar a presigned URL.
 */

/** Extensões aceitas (Req. 4.5). */
export const FORMATOS_PERMITIDOS = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx'] as const;

/** MIME types aceitos, alinhados às extensões. */
export const MIME_TYPES_PERMITIDOS = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

/** `accept` para o react-dropzone (MIME → extensões). */
export const DROPZONE_ACCEPT: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
};

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB por arquivo
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB no total
export const MAX_FILES = 20; // 20 arquivos

/** Extensão (lowercase, sem ponto) do nome do arquivo. */
function extensao(nome: string): string {
  const partes = nome.trim().toLowerCase().split('.');
  return partes.length > 1 ? partes[partes.length - 1] : '';
}

/** Formata bytes em MB legível (ex.: "12,5 MB"). */
export function formatarTamanho(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

/**
 * Valida um único arquivo (formato + tamanho por arquivo). Retorna a mensagem
 * de erro descritiva (Req. 4.5) ou `undefined` quando válido.
 */
export function validarArquivo(file: File): string | undefined {
  const ext = extensao(file.name);
  const formatoOk =
    (FORMATOS_PERMITIDOS as readonly string[]).includes(ext) &&
    (file.type === '' || (MIME_TYPES_PERMITIDOS as readonly string[]).includes(file.type));

  if (!formatoOk) {
    return `Formato não permitido. Aceitos: ${FORMATOS_PERMITIDOS.join(', ').toUpperCase()}.`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `Arquivo excede o limite de ${formatarTamanho(MAX_FILE_BYTES)} por arquivo.`;
  }
  return undefined;
}

/** Resultado da validação de um lote de arquivos que se quer ADICIONAR. */
export interface ResultadoValidacaoLote {
  /** Arquivos válidos que podem ser adicionados (respeitando os limites). */
  aceitos: File[];
  /** Erros por arquivo rejeitado (para exibição). */
  erros: string[];
}

/**
 * Valida arquivos NOVOS contra os já selecionados, aplicando os limites de
 * quantidade e tamanho total, além do formato/tamanho por arquivo. Preserva os
 * arquivos válidos e rejeita apenas os inválidos com erro descritivo (Req. 4.5).
 */
export function validarLote(existentes: File[], novos: File[]): ResultadoValidacaoLote {
  const aceitos: File[] = [];
  const erros: string[] = [];

  let quantidade = existentes.length;
  let total = existentes.reduce((soma, f) => soma + f.size, 0);

  for (const file of novos) {
    const erroArquivo = validarArquivo(file);
    if (erroArquivo) {
      erros.push(`${file.name}: ${erroArquivo}`);
      continue;
    }
    if (quantidade >= MAX_FILES) {
      erros.push(`${file.name}: limite de ${MAX_FILES} arquivos atingido.`);
      continue;
    }
    if (total + file.size > MAX_TOTAL_BYTES) {
      erros.push(
        `${file.name}: excederia o total de ${formatarTamanho(MAX_TOTAL_BYTES)} do processo.`,
      );
      continue;
    }
    aceitos.push(file);
    quantidade += 1;
    total += file.size;
  }

  return { aceitos, erros };
}
