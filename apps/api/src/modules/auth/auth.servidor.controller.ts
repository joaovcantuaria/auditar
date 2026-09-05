import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/index.js';
import { loginServidorSchema, trocarSenhaSchema } from './auth.servidor.schema.js';
import { loginServidor, logoutServidor, trocarSenha } from './auth.servidor.service.js';

/**
 * Controllers HTTP para autenticação de Servidores.
 * Traduzem a requisição Express para o serviço e serializam erros (`AppError`,
 * `ZodError`) na forma de resposta `ApiError` (`{ error, code, field? }`).
 */

/** Resolve o IP de origem da requisição, com fallback seguro. */
function resolveIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
}

/** Mapeia um erro conhecido para uma resposta HTTP; loga e responde 500 caso contrário. */
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

  console.error(
    JSON.stringify({
      level: 'error',
      scope: 'auth.servidor.controller',
      event: 'erro_nao_tratado',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  res.status(500).json({ error: 'Erro interno', code: ErrorCodes.SERVICO_INDISPONIVEL });
}

/** POST /api/v1/auth/servidor/login */
export async function postLoginServidor(req: Request, res: Response): Promise<void> {
  try {
    const { cpf, senha } = loginServidorSchema.parse(req.body);
    const result = await loginServidor(cpf, senha, resolveIp(req));
    res.status(200).json(result);
  } catch (err) {
    handleError(err, res);
  }
}

/** POST /api/v1/auth/servidor/logout (requer autenticação) */
export async function postLogoutServidor(req: Request, res: Response): Promise<void> {
  try {
    const jti = req.user?.jti;
    const exp = req.user?.exp;
    if (!jti || !exp) {
      res.status(401).json({ error: 'Não autenticado', code: ErrorCodes.TOKEN_EXPIRED });
      return;
    }
    await logoutServidor(jti, exp);
    res.status(204).send();
  } catch (err) {
    handleError(err, res);
  }
}

/** POST /api/v1/auth/servidor/trocar-senha (requer autenticação) */
export async function postTrocarSenha(req: Request, res: Response): Promise<void> {
  try {
    const servidorId = req.user?.sub;
    if (!servidorId) {
      res.status(401).json({ error: 'Não autenticado', code: ErrorCodes.TOKEN_EXPIRED });
      return;
    }
    const { senhaAtual, novaSenha } = trocarSenhaSchema.parse(req.body);
    await trocarSenha(servidorId, senhaAtual, novaSenha);
    res.status(204).send();
  } catch (err) {
    handleError(err, res);
  }
}
