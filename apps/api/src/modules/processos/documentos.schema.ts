import { z } from 'zod';

/**
 * Schemas de validação (Zod) para o Upload de Documentos via MinIO (Task 7.2).
 *
 * `arquivoInputSchema` descreve os metadados enviados pelo cliente ANTES do
 * upload (usado tanto para solicitar a URL presigned quanto, estendido, para
 * confirmar o upload já realizado). O binário do arquivo nunca passa pela API
 * — apenas os metadados (nome, tipo, tamanho) e, na confirmação, o caminho no
 * bucket retornado pela própria API na etapa anterior.
 *
 * Requisitos: 4.5, 4.7, 5.4
 */

/** Metadados do arquivo informados pelo cliente antes do upload. */
export const arquivoInputSchema = z.object({
  nomeOriginal: z
    .string()
    .trim()
    .min(1, 'Nome do arquivo é obrigatório')
    .max(255, 'Nome do arquivo deve conter no máximo 255 caracteres'),
  mimeType: z
    .string()
    .trim()
    .min(1, 'Tipo do arquivo é obrigatório')
    .max(255, 'Tipo do arquivo deve conter no máximo 255 caracteres'),
  tamanhoBytes: z
    .number()
    .int('Tamanho do arquivo deve ser um número inteiro')
    .positive('Tamanho do arquivo deve ser maior que zero'),
});

export type ArquivoInput = z.infer<typeof arquivoInputSchema>;

/** Confirmação de upload — metadados do arquivo + caminho retornado no passo anterior. */
export const confirmarDocumentoSchema = arquivoInputSchema.extend({
  caminhoStorage: z
    .string()
    .trim()
    .min(1, 'Caminho de armazenamento é obrigatório')
    .max(1024, 'Caminho de armazenamento inválido'),
});

export type ConfirmarDocumentoInput = z.infer<typeof confirmarDocumentoSchema>;
