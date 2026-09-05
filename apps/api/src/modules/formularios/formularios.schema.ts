import { z } from 'zod';
import { TipoCampo } from '@auditar/shared';

/**
 * Schemas de validação (Zod) para Formulários Dinâmicos.
 *
 * Um Formulário Dinâmico está associado a um Tipo de Processo e a uma Unidade e
 * contém uma lista ordenada de campos (no máximo 50). Cada campo declara seu
 * `tipo` (um dos 8 tipos suportados), `rotulo` (≤100), `descricaoAuxiliar`
 * opcional (≤300), obrigatoriedade, uma `validacao` (regex) opcional, um
 * `valorPadrao` opcional que DEVE ser compatível com o tipo do campo e sua
 * `ordem` de exibição. Campos de seleção (única/múltipla) exigem `opcoes`.
 *
 * Requisitos: 16.1, 16.2, 16.3, 16.4
 */

/** Número máximo de campos permitidos por formulário (Req. 16.1). */
export const MAX_CAMPOS = 50;

/** Tipos que exigem a definição de `opcoes`. */
const TIPOS_COM_OPCOES: readonly TipoCampo[] = [
  TipoCampo.SELECAO_UNICA,
  TipoCampo.SELECAO_MULTIPLA,
];

/**
 * Verifica se um `valorPadrao` é compatível com o `tipo` do campo (Req. 16.2/16.3).
 *
 * - Valor ausente/vazio é sempre compatível (campo sem valor padrão).
 * - `numero`: precisa ser uma string numérica (inteiro ou decimal).
 * - `data`: precisa ser parseável como data (ISO ou equivalente).
 * - `cpf`: precisa conter 11 dígitos (aceita máscara de pontuação).
 * - demais tipos: qualquer string é aceita como valor padrão.
 *
 * @param tipo tipo declarado do campo
 * @param valorPadrao valor padrão candidato (opcional)
 * @returns true quando compatível
 */
export function validarValorPadrao(
  tipo: TipoCampo,
  valorPadrao?: string | null,
): boolean {
  if (valorPadrao === undefined || valorPadrao === null || valorPadrao === '') {
    return true;
  }

  switch (tipo) {
    case TipoCampo.NUMERO:
      // Inteiro ou decimal, com sinal opcional.
      return /^-?\d+(\.\d+)?$/.test(valorPadrao.trim());
    case TipoCampo.DATA: {
      const t = Date.parse(valorPadrao.trim());
      return !Number.isNaN(t);
    }
    case TipoCampo.CPF: {
      const digitos = valorPadrao.replace(/\D/g, '');
      return digitos.length === 11;
    }
    default:
      return true;
  }
}

/**
 * Schema de um campo do formulário. A compatibilidade `valorPadrao × tipo` e a
 * exigência de `opcoes` para campos de seleção são validadas por refinamentos.
 */
export const campoSchema = z
  .object({
    tipo: z.nativeEnum(TipoCampo),
    rotulo: z
      .string()
      .trim()
      .min(1, 'Rótulo é obrigatório')
      .max(100, 'Rótulo deve conter no máximo 100 caracteres'),
    descricaoAuxiliar: z
      .string()
      .trim()
      .max(300, 'Descrição auxiliar deve conter no máximo 300 caracteres')
      .optional(),
    obrigatorio: z.boolean().default(false),
    /** Expressão de validação (regex) aplicável ao tipo do campo. */
    validacao: z.string().max(500).optional(),
    valorPadrao: z.string().optional(),
    /** Necessária para tipos de seleção; ignorada nos demais. */
    opcoes: z.array(z.string().trim().min(1)).optional(),
    ordem: z.number().int('Ordem deve ser um inteiro').min(0),
  })
  .refine((campo) => validarValorPadrao(campo.tipo, campo.valorPadrao), {
    message: 'Valor padrão incompatível com o tipo do campo',
    path: ['valorPadrao'],
  })
  .refine(
    (campo) =>
      !TIPOS_COM_OPCOES.includes(campo.tipo) ||
      (Array.isArray(campo.opcoes) && campo.opcoes.length > 0),
    {
      message: 'Campos de seleção exigem ao menos uma opção',
      path: ['opcoes'],
    },
  );

export type CampoInput = z.infer<typeof campoSchema>;

/** Criação de formulário — associa a um Tipo de Processo + Unidade (Req. 16.1). */
export const criarFormularioSchema = z.object({
  tipoProcessoId: z.string().trim().min(1, 'Tipo de processo é obrigatório'),
  unidadeId: z.string().trim().min(1, 'Unidade é obrigatória'),
  campos: z
    .array(campoSchema)
    .max(MAX_CAMPOS, `Um formulário pode ter no máximo ${MAX_CAMPOS} campos`),
});

export type CriarFormularioInput = z.infer<typeof criarFormularioSchema>;

/** Edição/salvamento de formulário — substitui a lista de campos (Req. 16.4). */
export const editarFormularioSchema = z.object({
  campos: z
    .array(campoSchema)
    .max(MAX_CAMPOS, `Um formulário pode ter no máximo ${MAX_CAMPOS} campos`),
});

export type EditarFormularioInput = z.infer<typeof editarFormularioSchema>;
