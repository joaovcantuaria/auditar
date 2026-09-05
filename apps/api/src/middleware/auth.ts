import type { Request, Response, NextFunction } from 'express';
import { createRequire } from 'node:module';
import { ErrorCodes } from '@auditar/shared';
import { verifyToken, isBlacklisted, type JwtPayload } from '../lib/jwt.js';

/** Prefixo da chave de kill-switch de revogação de sessão de Servidor no Redis. */
const REVOGADO_PREFIX = 'servidor:revogado:';

/** Interface mínima do Redis usada aqui (facilita testes/mocks). */
interface RedisGet {
  get(key: string): Promise<string | null>;
}

/**
 * Resolve o Redis preguiçosamente (lazy) para não abrir conexão ao importar o
 * módulo em testes que não exercitam a revogação de sessão.
 */
function resolveRedis(): RedisGet {
  const requireLocal = createRequire(import.meta.url);
  const { redis } = requireLocal('../config/redis.js') as { redis: RedisGet };
  return redis;
}

/**
 * Verifica o kill-switch de revogação de sessão de um Servidor (Req. 21.8).
 * Quando um Servidor é desativado, grava-se `servidor:revogado:{id}` = timestamp
 * (ms). Qualquer token emitido ANTES desse instante deve ser rejeitado, forçando
 * o encerramento das sessões ativas.
 *
 * @param sub id do Servidor (claim `sub` do JWT)
 * @param iat "issued at" do token em epoch SECONDS (claim `iat` do JWT)
 * @returns true quando o token foi emitido antes da revogação (sessão inválida)
 */
export async function isServidorRevogado(sub: string, iat?: number): Promise<boolean> {
  const raw = await resolveRedis().get(`${REVOGADO_PREFIX}${sub}`);
  if (!raw) return false;
  const revogadoMs = Number(raw);
  if (!Number.isFinite(revogadoMs)) return false;
  // `iat` está em segundos; convertemos a revogação para segundos na comparação.
  const iatSec = typeof iat === 'number' ? iat : 0;
  return iatSec < Math.floor(revogadoMs / 1000);
}

// ---------------------------------------------------------------------------
// Declaration merging — adiciona `user` ao Request do Express
// ---------------------------------------------------------------------------
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Extrai o token do header `Authorization: Bearer <token>`.
 * @returns o token bruto ou null quando o header está ausente/mal-formado
 */
function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token.trim() || null;
}

/**
 * Middleware de autenticação JWT.
 * - Extrai e verifica o token (assinatura + expiração).
 * - Checa a blacklist no Redis (tokens revogados via logout).
 * - Anexa `req.user` com o payload decodificado.
 *
 * Em qualquer falha responde 401 com `code: AUTH_004` (TOKEN_EXPIRED),
 * sem revelar o motivo específico da falha.
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    res.status(401).json({ error: 'Não autenticado', code: ErrorCodes.TOKEN_EXPIRED });
    return;
  }

  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado', code: ErrorCodes.TOKEN_EXPIRED });
    return;
  }

  try {
    if (payload.jti && (await isBlacklisted(payload.jti))) {
      res.status(401).json({ error: 'Sessão encerrada', code: ErrorCodes.TOKEN_EXPIRED });
      return;
    }
  } catch {
    // Falha ao consultar o Redis: por segurança, negar o acesso.
    res.status(401).json({ error: 'Não autenticado', code: ErrorCodes.TOKEN_EXPIRED });
    return;
  }

  // Req. 21.8: para tokens de Servidor, verifica o kill-switch de revogação de
  // sessão (Servidor desativado). Guardado para não impactar fluxos que não
  // usam Redis: se a consulta REJEITAR, encerramos por segurança; qualquer outra
  // condição não bloqueia (mantém compatibilidade com tokens de cidadão/testes).
  if (payload.role === 'servidor') {
    try {
      if (await isServidorRevogado(payload.sub, payload.iat)) {
        res.status(401).json({ error: 'Sessão encerrada', code: ErrorCodes.TOKEN_EXPIRED });
        return;
      }
    } catch {
      res.status(401).json({ error: 'Não autenticado', code: ErrorCodes.TOKEN_EXPIRED });
      return;
    }
  }

  req.user = payload;
  next();
}

/**
 * Guard: exige que o ator autenticado seja um cidadão.
 */
export function requireCidadao(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'cidadao') {
    res.status(403).json({ error: 'Acesso negado', code: ErrorCodes.INSUFFICIENT_PERMISSIONS });
    return;
  }
  next();
}

/**
 * Guard: exige que o ator autenticado seja um servidor.
 */
export function requireServidor(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'servidor') {
    res.status(403).json({ error: 'Acesso negado', code: ErrorCodes.INSUFFICIENT_PERMISSIONS });
    return;
  }
  next();
}
