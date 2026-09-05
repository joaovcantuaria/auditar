import { z } from 'zod';

/**
 * Schemas de validação (Zod) para a Gestão de Conta do Cidadão (Req. 7).
 *
 * O CPF é imutável e o e-mail possui um fluxo próprio de confirmação, portanto
 * NENHUM desses campos é aceito na edição de perfil. A alteração de senha exige
 * a senha atual e valida o comprimento da nova senha (8..64) conforme Req. 7.3.
 *
 * Requisitos: 7.1, 7.2, 7.3
 */

/** Somente dígitos. */
const APENAS_DIGITOS = /^\d+$/;

/**
 * Edição de perfil (Req. 7.1). Todos os campos são opcionais — o cidadão pode
 * atualizar apenas o que desejar. `cpf` e `email` NÃO fazem parte deste schema:
 * o CPF é imutável e o e-mail tem fluxo de confirmação dedicado.
 */
export const editarPerfilSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, 'Nome não pode ser vazio')
    .max(150, 'Nome deve conter no máximo 150 caracteres')
    .optional(),
  telefone: z
    .string()
    .trim()
    .regex(APENAS_DIGITOS, 'Telefone deve conter apenas dígitos')
    .refine((v) => v.length === 10 || v.length === 11, {
      message: 'Telefone deve conter 10 ou 11 dígitos',
    })
    .optional(),
  logradouro: z
    .string()
    .trim()
    .min(1, 'Logradouro não pode ser vazio')
    .max(200, 'Logradouro deve conter no máximo 200 caracteres')
    .optional(),
  numero: z
    .string()
    .trim()
    .min(1, 'Número não pode ser vazio')
    .max(20, 'Número deve conter no máximo 20 caracteres')
    .optional(),
  cep: z
    .string()
    .trim()
    .regex(APENAS_DIGITOS, 'CEP deve conter apenas dígitos')
    .length(8, 'CEP deve conter 8 dígitos')
    .optional(),
  cidade: z
    .string()
    .trim()
    .min(1, 'Cidade não pode ser vazia')
    .max(100, 'Cidade deve conter no máximo 100 caracteres')
    .optional(),
  estado: z
    .string()
    .trim()
    .length(2, 'Estado deve conter 2 caracteres')
    .optional(),
});

export type EditarPerfilInput = z.infer<typeof editarPerfilSchema>;

/** Solicitação de alteração de e-mail — apenas o novo endereço (Req. 7.2). */
export const alterarEmailSchema = z.object({
  novoEmail: z
    .string()
    .trim()
    .email('E-mail inválido')
    .max(254, 'E-mail deve conter no máximo 254 caracteres'),
});

export type AlterarEmailInput = z.infer<typeof alterarEmailSchema>;

/** Confirmação da alteração de e-mail via token (Req. 7.2, 7.8). */
export const confirmarEmailSchema = z.object({
  token: z.string().trim().min(1, 'Token é obrigatório'),
});

export type ConfirmarEmailInput = z.infer<typeof confirmarEmailSchema>;

/** Alteração de senha — exige a senha atual; nova senha entre 8 e 64 (Req. 7.3). */
export const alterarSenhaSchema = z.object({
  senhaAtual: z.string().min(1, 'Senha atual é obrigatória'),
  novaSenha: z
    .string()
    .min(8, 'A nova senha deve conter no mínimo 8 caracteres')
    .max(64, 'A nova senha deve conter no máximo 64 caracteres'),
});

export type AlterarSenhaInput = z.infer<typeof alterarSenhaSchema>;
