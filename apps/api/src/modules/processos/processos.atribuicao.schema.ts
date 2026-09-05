import { z } from 'zod';
import { ModoAtribuicao } from '@auditar/shared';

/**
 * Schemas de validação (Zod) para Atribuição e Reatribuição de Processos
 * (Task 7.7, Requisito 12).
 *
 * Cobre os corpos aceitos pelos endpoints de:
 *  - atribuir (modo automático/manual/fila_geral — Req 12.1, 12.2, 12.5);
 *    `servidorId` é exigido apenas no modo manual (Req 12.1);
 *  - reatribuir (justificativa 20–500 chars validada ANTES de qualquer
 *    alteração de estado — Req 12.8, 12.9).
 *
 * Requisitos: 12.1, 12.8, 12.9
 */

/** Tamanho mínimo da justificativa de reatribuição (Req 12.8, 12.9). */
export const JUSTIFICATIVA_MIN_CHARS = 20;
/** Tamanho máximo da justificativa de reatribuição (Req 12.8, 12.9). */
export const JUSTIFICATIVA_MAX_CHARS = 500;

/**
 * Corpo aceito por `POST /:id/atribuir` (Req 12.1, 12.2, 12.5).
 *
 * O `servidorId` é obrigatório somente quando `modo === 'manual'` — nos modos
 * automático e fila_geral ele é ignorado. A regra condicional é aplicada via
 * `superRefine` para produzir um erro de validação no campo `servidorId`
 * quando ausente no modo manual (Req 12.1).
 */
export const atribuirSchema = z
  .object({
    modo: z.nativeEnum(ModoAtribuicao, {
      errorMap: () => ({
        message: 'O modo de atribuição deve ser "automatico", "manual" ou "fila_geral"',
      }),
    }),
    servidorId: z.string().trim().min(1, 'O servidor é obrigatório').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.modo === ModoAtribuicao.MANUAL && !data.servidorId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe o servidor para atribuição manual',
        path: ['servidorId'],
      });
    }
  });

export type AtribuirInput = z.infer<typeof atribuirSchema>;

/** Corpo aceito por `POST /:id/reatribuir` (Req 12.8, 12.9). */
export const reatribuirSchema = z.object({
  servidorDestinoId: z.string().trim().min(1, 'O servidor de destino é obrigatório'),
  justificativa: z
    .string()
    .trim()
    .min(
      JUSTIFICATIVA_MIN_CHARS,
      `A justificativa deve ter entre ${JUSTIFICATIVA_MIN_CHARS} e ${JUSTIFICATIVA_MAX_CHARS} caracteres`,
    )
    .max(
      JUSTIFICATIVA_MAX_CHARS,
      `A justificativa deve ter entre ${JUSTIFICATIVA_MIN_CHARS} e ${JUSTIFICATIVA_MAX_CHARS} caracteres`,
    ),
});

export type ReatribuirInput = z.infer<typeof reatribuirSchema>;
