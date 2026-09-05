import { z } from 'zod';
import { Permissao } from '@auditar/shared';

/**
 * Schemas de validação (Zod) do CRUD de Servidores (Req. 21).
 *
 * Regras de criação (Req. 21.1):
 *  - nome completo: obrigatório, máximo 150 caracteres;
 *  - CPF: exatamente 11 dígitos numéricos (dígitos verificadores conferidos no serviço);
 *  - email institucional: formato válido, máximo 254 caracteres;
 *  - telefone: opcional, 10 ou 11 dígitos numéricos (com DDD);
 *  - nível de acesso: inteiro entre 1 e 7 (os 7 níveis definidos);
 *  - Unidade de lotação: obrigatória.
 *
 * Na edição (Req. 21.5) todos os campos são opcionais e o CPF é IMUTÁVEL —
 * o schema de edição nem sequer aceita o campo `cpf` (uso de `.strict()`).
 */

/** CPF: exatamente 11 dígitos numéricos (validação de dígitos fica no serviço). */
const cpfRegex = /^\d{11}$/;

/** Telefone com DDD: exatamente 10 ou 11 dígitos numéricos. */
const telefoneRegex = /^\d{10,11}$/;

const nome = z
  .string()
  .trim()
  .min(1, 'Nome completo é obrigatório')
  .max(150, 'Nome deve ter no máximo 150 caracteres');

const cpf = z
  .string()
  .trim()
  .regex(cpfRegex, 'CPF deve conter 11 dígitos numéricos');

const email = z
  .string()
  .trim()
  .max(254, 'Email deve ter no máximo 254 caracteres')
  .email('Email institucional inválido');

const telefone = z
  .string()
  .trim()
  .regex(telefoneRegex, 'Telefone deve conter 10 a 11 dígitos numéricos (com DDD)');

const nivelAcesso = z
  .number({ invalid_type_error: 'Nível de acesso deve ser um número' })
  .int('Nível de acesso deve ser um inteiro')
  .min(1, 'Nível de acesso inválido')
  .max(7, 'Nível de acesso inválido');

const unidadeId = z
  .string()
  .trim()
  .min(1, 'Unidade de lotação é obrigatória');

/** Criação de Servidor — campos obrigatórios validados aqui (Req. 21.1). */
export const criarServidorSchema = z.object({
  nome,
  cpf,
  email,
  telefone: telefone.optional(),
  nivelAcesso,
  unidadeId,
});

/**
 * Edição de Servidor — todos os campos opcionais (Req. 21.5). O CPF é imutável
 * após o cadastro: `.strict()` faz o schema rejeitar qualquer campo extra,
 * inclusive `cpf`.
 */
export const editarServidorSchema = z
  .object({
    nome: nome.optional(),
    email: email.optional(),
    telefone: telefone.optional(),
    nivelAcesso: nivelAcesso.optional(),
    unidadeId: unidadeId.optional(),
  })
  .strict();

/** Filtros + paginação da listagem de Servidores. */
export const paginacaoServidorSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  nivel: z.coerce.number().int().min(1).max(7).optional(),
  unidadeId: z.string().trim().min(1).optional(),
  ativo: z.coerce.boolean().optional(),
});

/**
 * Desativação de Servidor (Req. 21.6, 21.7, 21.8). Recebe a lista de
 * reatribuições dos Processos em andamento atribuídos ao Servidor — cada uma
 * move um `processoId` para um `novoServidorId` ativo.
 */
export const desativarServidorSchema = z.object({
  reatribuicoes: z
    .array(
      z.object({
        processoId: z.string().trim().min(1, 'processoId é obrigatório'),
        novoServidorId: z.string().trim().min(1, 'novoServidorId é obrigatório'),
      }),
    )
    .default([]),
});

/**
 * Atualização de permissões granulares (Req. 8.6/8.9). Cada item indica uma
 * permissão e se ela é concedida (`true`) ou revogada (`false`). O conjunto
 * substitui integralmente as permissões atuais do Servidor.
 */
export const atualizarPermissoesSchema = z.object({
  permissoes: z
    .array(
      z.object({
        permissao: z.nativeEnum(Permissao),
        concedida: z.boolean(),
      }),
    )
    .max(50, 'Muitas permissões informadas'),
});

export type CriarServidorDto = z.infer<typeof criarServidorSchema>;
export type EditarServidorDto = z.infer<typeof editarServidorSchema>;
export type PaginacaoServidorDto = z.infer<typeof paginacaoServidorSchema>;
export type DesativarServidorDto = z.infer<typeof desativarServidorSchema>;
export type AtualizarPermissoesDto = z.infer<typeof atualizarPermissoesSchema>;
