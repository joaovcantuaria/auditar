import { z } from 'zod';

/**
 * Schemas de validação (Zod) para autenticação de Servidores.
 *
 * Requisitos: 8.1 (CPF 11 dígitos + senha mínima 8), 21.3 (troca de senha temporária).
 */

/** Login do Servidor: CPF com exatamente 11 dígitos numéricos e senha com no mínimo 8 caracteres (Req. 8.1). */
export const loginServidorSchema = z.object({
  cpf: z
    .string()
    .trim()
    .regex(/^\d{11}$/, 'CPF deve conter exatamente 11 dígitos numéricos'),
  senha: z.string().min(8, 'Senha deve conter no mínimo 8 caracteres'),
});

export type LoginServidorInput = z.infer<typeof loginServidorSchema>;

/** Troca de senha (temporária ou não): exige senha atual e nova senha de 8 a 64 caracteres (Req. 21.3). */
export const trocarSenhaSchema = z.object({
  senhaAtual: z.string().min(1, 'Senha atual é obrigatória'),
  novaSenha: z
    .string()
    .min(8, 'Nova senha deve conter no mínimo 8 caracteres')
    .max(64, 'Nova senha deve conter no máximo 64 caracteres'),
});

export type TrocarSenhaInput = z.infer<typeof trocarSenhaSchema>;
