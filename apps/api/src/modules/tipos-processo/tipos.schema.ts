import { z } from 'zod';

/**
 * Schemas de validação (Zod) para Tipos de Processo.
 *
 * Regras espelham o Requisito 14.3:
 *  - nome: obrigatório, máximo 100 caracteres.
 *  - prazoTotalDiasUteis: inteiro entre 1 e 365.
 *  - unidadesIds: Unidades atendentes obrigatórias (pelo menos uma).
 *  - categoriaId: Categoria à qual o tipo pertence (obrigatória na criação).
 *  - fluxoId: opcional (Fluxo associado).
 */

const NOME_MAX = 100;
const PRAZO_MIN = 1;
const PRAZO_MAX = 365;

const nomeSchema = z
  .string()
  .trim()
  .min(1, 'O nome do tipo de processo é obrigatório')
  .max(NOME_MAX, `O nome deve ter no máximo ${NOME_MAX} caracteres`);

const prazoSchema = z
  .number({ invalid_type_error: 'O prazo total deve ser um número inteiro' })
  .int('O prazo total deve ser um número inteiro')
  .min(PRAZO_MIN, `O prazo total deve ser no mínimo ${PRAZO_MIN} dia útil`)
  .max(PRAZO_MAX, `O prazo total deve ser no máximo ${PRAZO_MAX} dias úteis`);

const unidadesIdsSchema = z
  .array(z.string().uuid('Identificador de unidade inválido'))
  .min(1, 'Informe ao menos uma Unidade atendente');

/** Payload de criação de um Tipo de Processo (Req. 14.3). */
export const criarTipoSchema = z.object({
  nome: nomeSchema,
  categoriaId: z.string().uuid('Categoria inválida'),
  prazoTotalDiasUteis: prazoSchema,
  unidadesIds: unidadesIdsSchema,
  fluxoId: z.string().uuid('Fluxo inválido').optional(),
});

/** Payload de edição — todos os campos opcionais, mesmas restrições quando presentes. */
export const editarTipoSchema = z
  .object({
    nome: nomeSchema.optional(),
    categoriaId: z.string().uuid('Categoria inválida').optional(),
    prazoTotalDiasUteis: prazoSchema.optional(),
    unidadesIds: unidadesIdsSchema.optional(),
    fluxoId: z.string().uuid('Fluxo inválido').nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo para atualizar',
  });

export type CriarTipoDto = z.infer<typeof criarTipoSchema>;
export type EditarTipoDto = z.infer<typeof editarTipoSchema>;
