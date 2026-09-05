import jwt, { type SignOptions } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env.js';
import { redis } from '../config/redis.js';

/**
 * Estrutura do payload do JWT usado pela API do Auditar.
 * Conforme a seção "Security Architecture" do design.
 */
export interface JwtPayload {
  /** userId (Cidadao.id ou Servidor.id) */
  sub: string;
  /** Tipo de ator autenticado */
  role: 'cidadao' | 'servidor';
  /** Nível de acesso (apenas servidores) */
  nivel?: number;
  /** Permissões granulares em cache (apenas servidores) */
  permissions?: string[];
  /** JWT ID — usado para blacklist no logout */
  jti: string;
  /** Emitido em (epoch seconds) — preenchido pela lib */
  iat?: number;
  /** Expira em (epoch seconds) — preenchido pela lib */
  exp?: number;
}

/** Prefixo das chaves de blacklist no Redis. */
const BLACKLIST_PREFIX = 'blacklist:';

/**
 * Assina um novo JWT. Gera automaticamente o `jti` (uuid v4).
 *
 * @param payload dados do usuário (sem jti/iat/exp — gerenciados internamente)
 * @param options.longLived quando true usa `JWT_LONG_EXPIRES_IN` ("manter conectado")
 * @returns token JWT assinado
 */
export function signToken(
  payload: Omit<JwtPayload, 'jti' | 'iat' | 'exp'>,
  options?: { longLived?: boolean },
): string {
  const jti = uuidv4();
  const expiresIn = options?.longLived ? env.JWT_LONG_EXPIRES_IN : env.JWT_EXPIRES_IN;

  const signOptions: SignOptions = {
    // jsonwebtoken aceita string (ex.: "1h", "7d") ou number (segundos)
    expiresIn: expiresIn as SignOptions['expiresIn'],
  };

  return jwt.sign({ ...payload, jti }, env.JWT_SECRET, signOptions);
}

/**
 * Verifica a assinatura e a validade temporal do token.
 * Lança erro (`jsonwebtoken` TokenExpiredError / JsonWebTokenError) quando inválido ou expirado.
 *
 * @param token JWT bruto (sem o prefixo "Bearer ")
 * @returns payload decodificado e validado
 */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

/**
 * Adiciona um `jti` à blacklist no Redis com TTL igual ao tempo restante até a expiração.
 * O TTL mínimo é 1 segundo para evitar `EX 0` (que o Redis rejeita) ou valores negativos.
 *
 * @param jti identificador do JWT a ser revogado
 * @param expUnix expiração do token em epoch seconds (campo `exp` do payload)
 */
export async function blacklistToken(jti: string, expUnix: number): Promise<void> {
  const nowUnix = Math.floor(Date.now() / 1000);
  const ttl = Math.max(1, expUnix - nowUnix);
  await redis.set(`${BLACKLIST_PREFIX}${jti}`, '1', 'EX', ttl);
}

/**
 * Verifica se um `jti` está na blacklist (token revogado via logout).
 *
 * @param jti identificador do JWT
 * @returns true se o token foi revogado
 */
export async function isBlacklisted(jti: string): Promise<boolean> {
  const value = await redis.get(`${BLACKLIST_PREFIX}${jti}`);
  return value !== null;
}
