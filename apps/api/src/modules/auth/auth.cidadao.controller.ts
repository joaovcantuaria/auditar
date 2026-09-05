import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/errors.js';
import { registrar as registrarAuditoria } from '../auditoria/auditoria.service.js';
import {
  registrarSchema,
  ativarSchema,
  reenviarAtivacaoSchema,
  loginCidadaoSchema,
  recuperarSenhaSchema,
  novaSenhaSchema,
} from './auth.cidadao.schema.js';
import {
  registrarCidadao,
  ativarConta,
  reenviarAtivacao,
} from './auth.cidadao.service.js';
import { loginCidadao, logoutCidadao } from './auth.cidadao.login.service.js';
import {
  solicitarRecuperacao,
  redefinirSenha,
} from './auth.recuperacao.service.js';
import { enviar2faSchema, verificar2faSchema } from './auth.cidadao.schema.js';
import { gerarCodigo2fa, verificar2fa } from './auth.2fa.service.js';

/**
 * Controllers HTTP do fluxo de cadastro/ativação do Cidadão.
 *
 * Cada handler: (1) valida a entrada com Zod, (2) chama o serviço, (3) mapeia
 * erros para a estrutura `{ error, code, field }` com o status apropriado.
 *
 * _Requirements: 1.1–1.9_
 */

/** Serializa erros conhecidos para a resposta padrão da API. */
function handleError(err: unknown, res: Response): void {
  if (err instanceof ZodError) {
    const first = err.errors[0];
    res.status(400).json({
      error: first?.message ?? 'Dados inválidos',
      code: ErrorCodes.VALIDATION_ERROR,
      field: first?.path?.join('.') || undefined,
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      field: err.field,
    });
    return;
  }

  console.error('[auth.cidadao] erro inesperado:', err instanceof Error ? err.message : err);
  res.status(500).json({ error: 'Erro interno do servidor', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/** POST /api/v1/auth/cidadao/registrar */
export async function postRegistrar(req: Request, res: Response): Promise<void> {
  try {
    const dto = registrarSchema.parse(req.body);
    const result = await registrarCidadao(dto);

    // Auditoria assíncrona do cadastro (não bloqueia a resposta).
    await registrarAuditoria({
      ator: 'cidadao',
      atorCidadaoId: result.id,
      enderecoIp: req.ip ?? 'desconhecido',
      tipoAcao: 'cadastro_cidadao',
      modulo: 'auth',
      objetoId: result.id,
      tipoObjeto: 'Cidadao',
    });

    res.status(201).json({
      id: result.id,
      mensagem: 'Cadastro realizado. Verifique seu e-mail para ativar a conta.',
    });
  } catch (err) {
    handleError(err, res);
  }
}

/** POST /api/v1/auth/cidadao/ativar */
export async function postAtivar(req: Request, res: Response): Promise<void> {
  try {
    const { token } = ativarSchema.parse(req.body);
    const result = await ativarConta(token);
    res.status(200).json({
      id: result.id,
      mensagem: 'Conta ativada com sucesso.',
    });
  } catch (err) {
    handleError(err, res);
  }
}

/** POST /api/v1/auth/cidadao/reenviar-ativacao */
export async function postReenviarAtivacao(req: Request, res: Response): Promise<void> {
  try {
    const { email } = reenviarAtivacaoSchema.parse(req.body);
    await reenviarAtivacao(email);
    res.status(200).json({
      mensagem: 'Se houver uma conta pendente para este e-mail, um novo link de ativação foi enviado.',
    });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * POST /api/v1/auth/cidadao/recuperar-senha (público)
 *
 * Sempre responde 200, independentemente de o e-mail existir, para não revelar
 * a existência de contas (Req. 7.3).
 */
export async function postRecuperarSenha(req: Request, res: Response): Promise<void> {
  try {
    const { email } = recuperarSenhaSchema.parse(req.body);
    await solicitarRecuperacao(email);
    res.status(200).json({
      mensagem: 'Se houver uma conta associada a este e-mail, um link de redefinição foi enviado.',
    });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * POST /api/v1/auth/cidadao/nova-senha (público)
 *
 * Redefine a senha a partir do token de uso único (Req. 7.4).
 */
export async function postNovaSenha(req: Request, res: Response): Promise<void> {
  try {
    const { token, novaSenha } = novaSenhaSchema.parse(req.body);
    await redefinirSenha(token, novaSenha);
    res.status(200).json({
      mensagem: 'Senha redefinida com sucesso. Você já pode entrar com a nova senha.',
    });
  } catch (err) {
    handleError(err, res);
  }
}

/** Resolve o IP de origem da requisição, com fallback seguro. */
function resolveIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
}

/**
 * POST /api/v1/auth/cidadao/login
 *
 * Quando o 2FA está habilitado, responde 200 com `{ requires2fa: true }` sem
 * emitir token (a verificação do código conclui o fluxo). Caso contrário,
 * responde 200 com `{ token, cidadao }`.
 */
export async function postLoginCidadao(req: Request, res: Response): Promise<void> {
  try {
    const { cpf, senha, manterConectado } = loginCidadaoSchema.parse(req.body);
    const result = await loginCidadao(cpf, senha, manterConectado, resolveIp(req));

    if (result.requires2fa) {
      // Devolve o cidadaoId para que o cliente solicite/verifique o código 2FA.
      res.status(200).json({ requires2fa: true, cidadaoId: result.cidadaoId });
      return;
    }

    res.status(200).json({ token: result.token, cidadao: result.cidadao });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * POST /api/v1/auth/cidadao/2fa/enviar (público)
 *
 * Gera e envia o código 2FA de 6 dígitos ao canal escolhido. Tipicamente
 * chamado logo após o login retornar `requires2fa: true` (Req. 2.5).
 */
export async function postEnviar2fa(req: Request, res: Response): Promise<void> {
  try {
    const { cidadaoId, canal } = enviar2faSchema.parse(req.body);
    const result = await gerarCodigo2fa(cidadaoId, canal);
    res.status(200).json({
      mensagem: `Enviamos um código de verificação para ${result.destino}.`,
      canal: result.canal,
      destino: result.destino,
    });
  } catch (err) {
    handleError(err, res);
  }
}

/**
 * POST /api/v1/auth/cidadao/2fa/verificar (público)
 *
 * Valida o código de 6 dígitos e conclui a autenticação, emitindo o token
 * (Req. 2.5, 2.6). Uma falha aqui não conta para o bloqueio por senha.
 */
export async function postVerificar2fa(req: Request, res: Response): Promise<void> {
  try {
    const { cidadaoId, codigo, manterConectado } = verificar2faSchema.parse(req.body);
    const result = await verificar2fa(cidadaoId, codigo, manterConectado, resolveIp(req));
    res.status(200).json({ token: result.token, cidadao: result.cidadao });
  } catch (err) {
    handleError(err, res);
  }
}

/** POST /api/v1/auth/cidadao/logout (requer autenticação de cidadão) */
export async function postLogoutCidadao(req: Request, res: Response): Promise<void> {
  try {
    const jti = req.user?.jti;
    const exp = req.user?.exp;
    if (!jti || !exp) {
      res.status(401).json({ error: 'Não autenticado', code: ErrorCodes.TOKEN_EXPIRED });
      return;
    }
    await logoutCidadao(jti, exp);
    res.status(204).send();
  } catch (err) {
    handleError(err, res);
  }
}
