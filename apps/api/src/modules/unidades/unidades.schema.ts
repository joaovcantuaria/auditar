import { z } from 'zod';
import { ModoAtribuicao } from '@auditar/shared';

/**
 * Schemas de validação (Zod) do CRUD de Unidades.
 *
 * Regras (Req. 14.5):
 *  - obrigatórios na criação: nome (≤100), secretaria, Gestor responsável (gestorId);
 *  - opcionais: endereço (≤300), telefone com DDD (10 a 11 dígitos numéricos),
 *    horário de funcionamento e modo de atribuição.
 */

/** Modos de atribuição aceitos, derivados do enum compartilhado. */
const modoAtribuicaoValues = Object.values(ModoAtribuicao) as [string, ...string[]];

/** Telefone com DDD: exatamente 10 ou 11 dígitos numéricos (Req. 14.5). */
const telefoneRegex = /^\d{10,11}$/;

/** Campos comuns reutilizados por criação/edição. */
const nome = z
  .string()
  .trim()
  .min(1, 'Nome é obrigatório')
  .max(100, 'Nome deve ter no máximo 100 caracteres');

const secretaria = z
  .string()
  .trim()
  .min(1, 'Secretaria é obrigatória');

const gestorId = z
  .string()
  .trim()
  .min(1, 'Gestor responsável é obrigatório');

const endereco = z
  .string()
  .trim()
  .max(300, 'Endereço deve ter no máximo 300 caracteres');

const telefone = z
  .string()
  .trim()
  .regex(telefoneRegex, 'Telefone deve conter 10 a 11 dígitos numéricos (com DDD)');

const horarioFuncionamento = z.string().trim().min(1);

const modoAtribuicao = z.enum(modoAtribuicaoValues);

/** Criação de Unidade — campos obrigatórios validados aqui (Req. 14.5). */
export const criarUnidadeSchema = z.object({
  nome,
  secretaria,
  gestorId,
  endereco: endereco.optional(),
  telefone: telefone.optional(),
  horarioFuncionamento: horarioFuncionamento.optional(),
  modoAtribuicao: modoAtribuicao.optional().default(ModoAtribuicao.MANUAL),
});

/** Edição de Unidade — todos os campos opcionais, mesmas restrições. */
export const editarUnidadeSchema = z
  .object({
    nome: nome.optional(),
    secretaria: secretaria.optional(),
    gestorId: gestorId.optional(),
    endereco: endereco.optional(),
    telefone: telefone.optional(),
    horarioFuncionamento: horarioFuncionamento.optional(),
    modoAtribuicao: modoAtribuicao.optional(),
  })
  .strict();

export type CriarUnidadeDto = z.infer<typeof criarUnidadeSchema>;
export type EditarUnidadeDto = z.infer<typeof editarUnidadeSchema>;
