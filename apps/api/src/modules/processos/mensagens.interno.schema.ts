import { z } from 'zod';

/**
 * Schemas de validação (Zod) para o canal de mensagens internas (Servidor ↔
 * Servidor) de um Processo (Task 8.2).
 *
 * `anexoInternoSchema` descreve os metadados de um anexo já enviado ao MinIO
 * ANTES desta chamada — ver o comentário de reuso do fluxo de upload no topo
 * de `mensagens.interno.service.ts`. `enviarMensagemInternaSchema` é o corpo
 * aceito por `POST /api/v1/admin/processos/:id/mensagens/internas`.
 *
 * Requisitos: 13.2, 13.5, 13.6, 13.8
 */

/** Metadados do anexo de uma mensagem interna, já enviado ao MinIO (Req 13.5). */
export const anexoInternoSchema = z.object({
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
  caminhoStorage: z
    .string()
    .trim()
    .min(1, 'Caminho de armazenamento é obrigatório')
    .max(1024, 'Caminho de armazenamento inválido'),
});

export type AnexoInternoInput = z.infer<typeof anexoInternoSchema>;

/** Corpo aceito pelo envio de mensagem interna (Req 13.2, 13.5, 13.6). */
export const enviarMensagemInternaSchema = z.object({
  conteudo: z
    .string()
    .trim()
    .min(1, 'O conteúdo da mensagem é obrigatório')
    .max(4000, 'O conteúdo da mensagem deve ter no máximo 4000 caracteres'),
  destinatarioServidorId: z.string().trim().min(1).optional(),
  anexo: anexoInternoSchema.optional(),
});

export type EnviarMensagemInternaInput = z.infer<typeof enviarMensagemInternaSchema>;
