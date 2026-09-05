import { z } from 'zod';

/**
 * Schemas de validação (Zod) para a Tramitação de Processo pelo Servidor
 * (Task 7.6, Requisito 11).
 *
 * Cobre os corpos aceitos pelos endpoints de:
 *  - avançar etapa (observação opcional, Req 11.2);
 *  - rejeitar (motivo obrigatório, Req 11.7);
 *  - solicitar documentos (lista de documentos, Req 11.6);
 *  - registrar observação interna/pública (Req 11.4, 11.5).
 *
 * Requisitos: 11.2, 11.4, 11.5, 11.6, 11.7
 */

/** Limite máximo de caracteres de uma observação/motivo (Req 11.4, 11.5). */
export const OBSERVACAO_MAX_CHARS = 2000;

/** Corpo aceito por `POST /:id/avancar-etapa` (Req 11.2). */
export const avancarEtapaSchema = z.object({
  observacao: z
    .string()
    .trim()
    .max(OBSERVACAO_MAX_CHARS, `A observação deve ter no máximo ${OBSERVACAO_MAX_CHARS} caracteres`)
    .optional(),
});

export type AvancarEtapaInput = z.infer<typeof avancarEtapaSchema>;

/** Corpo aceito por `POST /:id/rejeitar` (Req 11.7). */
export const rejeitarSchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(1, 'O motivo da rejeição é obrigatório')
    .max(OBSERVACAO_MAX_CHARS, `O motivo deve ter no máximo ${OBSERVACAO_MAX_CHARS} caracteres`),
});

export type RejeitarInput = z.infer<typeof rejeitarSchema>;

/** Corpo aceito por `POST /:id/solicitar-documentos` (Req 11.6). */
export const solicitarDocumentosSchema = z.object({
  documentos: z
    .array(
      z
        .string()
        .trim()
        .min(1, 'O nome do documento é obrigatório')
        .max(255, 'O nome do documento deve ter no máximo 255 caracteres'),
    )
    .min(1, 'Informe ao menos um documento a solicitar')
    .max(20, 'Informe no máximo 20 documentos por solicitação'),
});

export type SolicitarDocumentosInput = z.infer<typeof solicitarDocumentosSchema>;

/** Corpo aceito por `POST /:id/observacoes` (Req 11.4, 11.5). */
export const observacaoSchema = z.object({
  tipo: z.enum(['interna', 'publica'], {
    errorMap: () => ({ message: 'O tipo da observação deve ser "interna" ou "publica"' }),
  }),
  conteudo: z
    .string()
    .trim()
    .min(1, 'O conteúdo da observação é obrigatório')
    .max(OBSERVACAO_MAX_CHARS, `A observação deve ter no máximo ${OBSERVACAO_MAX_CHARS} caracteres`),
});

export type ObservacaoInput = z.infer<typeof observacaoSchema>;

/**
 * Corpo aceito por `PATCH /:id` — Edição_Corretiva de dados do Processo
 * (Task 21.2, Req 24.4). Conjunto editável conservador: `prioridade` (campo
 * simples) e correções das `respostas` do Formulário_Dinâmico por `campoId`.
 * Protocolo, cidadão, status, etapa e tipos NÃO são corrigíveis por aqui.
 */
export const edicaoCorretivaSchema = z
  .object({
    prioridade: z
      .number({ invalid_type_error: 'A prioridade deve ser um número' })
      .int('A prioridade deve ser um número inteiro')
      .min(0, 'A prioridade deve ser maior ou igual a 0')
      .max(10, 'A prioridade deve ser no máximo 10')
      .optional(),
    respostas: z
      .array(
        z.object({
          campoId: z.string().trim().min(1, 'campoId é obrigatório'),
          valor: z
            .string()
            .max(5000, 'O valor da resposta deve ter no máximo 5000 caracteres'),
        }),
      )
      .max(50, 'Informe no máximo 50 correções de resposta por vez')
      .optional(),
  })
  .refine(
    (data) => data.prioridade !== undefined || (data.respostas?.length ?? 0) > 0,
    { message: 'Informe ao menos um campo para corrigir' },
  );

export type EdicaoCorretivaSchemaInput = z.infer<typeof edicaoCorretivaSchema>;
