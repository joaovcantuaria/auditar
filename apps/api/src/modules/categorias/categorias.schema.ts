import { z } from 'zod';

/**
 * Schemas de validação (Zod) para o CRUD de Categorias.
 *
 * Uma Categoria exige obrigatoriamente `nome` (≤100 caracteres) e aceita
 * opcionalmente `descricao` (≤500), `icone`, `cor`, `secretaria` e `gestorId`.
 *
 * Requisitos: 14.1, 14.2
 */

/** Criação de Categoria — `nome` obrigatório; demais campos opcionais (Req. 14.1). */
export const criarCategoriaSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, 'Nome é obrigatório')
    .max(100, 'Nome deve conter no máximo 100 caracteres'),
  descricao: z
    .string()
    .trim()
    .max(500, 'Descrição deve conter no máximo 500 caracteres')
    .optional(),
  icone: z.string().trim().max(100).optional(),
  cor: z.string().trim().max(50).optional(),
  secretaria: z.string().trim().max(200).optional(),
  gestorId: z.string().trim().min(1).optional(),
});

export type CriarCategoriaInput = z.infer<typeof criarCategoriaSchema>;

/**
 * Edição de Categoria — todos os campos são opcionais; quando `nome` estiver
 * presente, deve respeitar o limite de 100 caracteres e não pode ser vazio.
 */
export const editarCategoriaSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(1, 'Nome não pode ser vazio')
      .max(100, 'Nome deve conter no máximo 100 caracteres')
      .optional(),
    descricao: z
      .string()
      .trim()
      .max(500, 'Descrição deve conter no máximo 500 caracteres')
      .optional(),
    icone: z.string().trim().max(100).optional(),
    cor: z.string().trim().max(50).optional(),
    secretaria: z.string().trim().max(200).optional(),
    gestorId: z.string().trim().min(1).optional(),
  });

export type EditarCategoriaInput = z.infer<typeof editarCategoriaSchema>;
