import { z } from 'zod';
import { registerCidadaoSchema } from '@auditar/shared';

/**
 * Schemas Zod do fluxo de cadastro e ativação de conta do Cidadão.
 *
 * Reutiliza o `registerCidadaoSchema` do pacote compartilhado (Req. 1.1), que
 * já valida todos os campos obrigatórios e o campo `senha` com 8–64 caracteres.
 * Este módulo apenas re-exporta/estende conforme necessário para o backend.
 *
 * _Requirements: 1.1, 1.6, 1.7, 1.8_
 */

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

/**
 * Cadastro do cidadão. Baseia-se no schema compartilhado, garantindo que a
 * senha tenha entre 8 e 128 caracteres. O `registerCidadaoSchema` já limita a
 * 8–64; aqui reforçamos o teto de 128 exigido pela task, mantendo o piso de 8.
 */
export const registrarSchema = registerCidadaoSchema.extend({
  senha: z
    .string()
    .min(8, 'Senha deve ter no mínimo 8 caracteres')
    .max(128, 'Senha deve ter no máximo 128 caracteres'),
});

export type RegistrarInput = z.infer<typeof registrarSchema>;

// ---------------------------------------------------------------------------
// Ativação de conta
// ---------------------------------------------------------------------------

export const ativarSchema = z.object({
  token: z.string().min(1, 'Token de ativação é obrigatório'),
});

export type AtivarInput = z.infer<typeof ativarSchema>;

// ---------------------------------------------------------------------------
// Reenvio do link de ativação
// ---------------------------------------------------------------------------

export const reenviarAtivacaoSchema = z.object({
  email: z
    .string()
    .email('Formato de e-mail inválido')
    .max(254, 'E-mail deve ter no máximo 254 caracteres'),
});

export type ReenviarAtivacaoInput = z.infer<typeof reenviarAtivacaoSchema>;

// ---------------------------------------------------------------------------
// Recuperação de senha (Req. 7.3, 7.4)
// ---------------------------------------------------------------------------

/** Solicitação de recuperação: apenas o e-mail do cidadão. */
export const recuperarSenhaSchema = z.object({
  email: z
    .string()
    .email('Formato de e-mail inválido')
    .max(254, 'E-mail deve ter no máximo 254 caracteres'),
});

export type RecuperarSenhaInput = z.infer<typeof recuperarSenhaSchema>;

/** Redefinição: token de uso único + nova senha (8–64 caracteres). */
export const novaSenhaSchema = z.object({
  token: z.string().min(1, 'Token de redefinição é obrigatório'),
  novaSenha: z
    .string()
    .min(8, 'Senha deve ter no mínimo 8 caracteres')
    .max(64, 'Senha deve ter no máximo 64 caracteres'),
});

export type NovaSenhaInput = z.infer<typeof novaSenhaSchema>;

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * Login do Cidadão: CPF com 11 dígitos numéricos (após normalização) e senha
 * de 8 a 128 caracteres (Req. 2.1). O campo `manterConectado` é opcional e,
 * quando verdadeiro, sinaliza sessão de longa duração (7 dias — Req. 2.7).
 */
export const loginCidadaoSchema = z.object({
  cpf: z
    .string()
    .trim()
    .regex(/^\d{11}$/, 'CPF deve conter exatamente 11 dígitos numéricos'),
  senha: z
    .string()
    .min(8, 'Senha deve ter no mínimo 8 caracteres')
    .max(128, 'Senha deve ter no máximo 128 caracteres'),
  manterConectado: z.boolean().optional().default(false),
});

export type LoginCidadaoInput = z.infer<typeof loginCidadaoSchema>;

// ---------------------------------------------------------------------------
// Autenticação de dois fatores (2FA) — Req. 2.5, 2.6
// ---------------------------------------------------------------------------

/** Canal de envio do código 2FA. */
export const canal2faSchema = z.enum(['email', 'sms']);

export type Canal2faInput = z.infer<typeof canal2faSchema>;

/**
 * Solicitação de envio do código 2FA. O `cidadaoId` vem da etapa de login
 * (quando `requires2fa: true`). O canal é opcional: quando ausente, usa o canal
 * preferido cadastrado na conta.
 */
export const enviar2faSchema = z.object({
  cidadaoId: z.string().min(1, 'cidadaoId é obrigatório'),
  canal: canal2faSchema.optional(),
});

export type Enviar2faInput = z.infer<typeof enviar2faSchema>;

/**
 * Verificação do código 2FA. `codigo` deve ter exatamente 6 dígitos numéricos.
 */
export const verificar2faSchema = z.object({
  cidadaoId: z.string().min(1, 'cidadaoId é obrigatório'),
  codigo: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'O código deve ter 6 dígitos numéricos'),
  manterConectado: z.boolean().optional().default(false),
});

export type Verificar2faInput = z.infer<typeof verificar2faSchema>;
