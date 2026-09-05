import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { ErrorCodes } from '@auditar/shared';
import { AppError, badRequest } from '../../utils/errors.js';
import { prisma as defaultPrisma } from '../../config/database.js';
import { redis as defaultRedis } from '../../config/redis.js';
import { env } from '../../config/env.js';
import { enviarEmailRecuperacao } from './auth.recuperacao.email.js';

/**
 * Serviço de recuperação (esqueci a senha) e redefinição de senha do Cidadão.
 *
 * O token de redefinição NÃO é persistido no schema do Prisma para evitar
 * migrações: é armazenado no Redis (`reset:senha:{token}` = cidadaoId) com
 * expiração de 1 hora e uso único (removido após a redefinição).
 *
 * _Requirements: 7.3, 7.4_
 */

/** Validade do token de redefinição no Redis: 1 hora em segundos (Req. 7.3). */
export const RESET_TOKEN_TTL_SECONDS = 60 * 60;

/** Prefixo da chave do token de redefinição no Redis. */
export const RESET_KEY_PREFIX = 'reset:senha:';

/** Tamanho mínimo/máximo da nova senha (Req. 7.3). */
export const SENHA_MIN = 8;
export const SENHA_MAX = 64;

/** Monta a chave Redis do token de redefinição. */
export function montarChaveReset(token: string): string {
  return `${RESET_KEY_PREFIX}${token}`;
}

/** Portas mínimas dos serviços externos, para injeção em testes. */
export type RecuperacaoPrismaClient = Pick<PrismaClient, 'cidadao'>;
export type RecuperacaoRedisClient = Pick<Redis, 'set' | 'get' | 'del'>;

/** Função de envio de e-mail de recuperação (injetável). */
export type EnviarRecuperacaoFn = typeof enviarEmailRecuperacao;

/** Dependências do serviço — permitem substituição em testes. */
export interface RecuperacaoDeps {
  prisma: RecuperacaoPrismaClient;
  redis: RecuperacaoRedisClient;
  enviarEmail: EnviarRecuperacaoFn;
  /** Gerador de token (uuid v4 por padrão). */
  gerarToken: () => string;
}

const defaultDeps: RecuperacaoDeps = {
  prisma: defaultPrisma,
  redis: defaultRedis,
  enviarEmail: enviarEmailRecuperacao,
  gerarToken: () => randomUUID(),
};

/** Mescla dependências parciais com os padrões de produção. */
function resolveDeps(deps?: Partial<RecuperacaoDeps>): RecuperacaoDeps {
  return { ...defaultDeps, ...deps };
}

/**
 * Solicita a recuperação de senha (Req. 7.3).
 *
 * Fluxo:
 * 1. Localiza o cidadão pelo e-mail. Se não existir, retorna silenciosamente
 *    (sem revelar se a conta existe — evita enumeração de contas).
 * 2. Gera um token de redefinição (uuid v4) e o armazena no Redis
 *    (`reset:senha:{token}` = cidadaoId) com expiração de 1 hora.
 * 3. Envia o e-mail com o link `${WEB_URL}/nova-senha/{token}`.
 */
export async function solicitarRecuperacao(
  email: string,
  deps?: Partial<RecuperacaoDeps>,
): Promise<void> {
  const { prisma, redis, enviarEmail, gerarToken } = resolveDeps(deps);

  const normalizado = email.trim().toLowerCase();
  const cidadao = await prisma.cidadao.findFirst({
    where: { email: normalizado },
    select: { id: true, nome: true, email: true },
  });

  // Não revela se o e-mail existe (Req. 7.3 — sem enumeração de contas).
  if (!cidadao) {
    return;
  }

  const token = gerarToken();
  await redis.set(montarChaveReset(token), cidadao.id, 'EX', RESET_TOKEN_TTL_SECONDS);

  await enviarEmail({ nome: cidadao.nome, email: cidadao.email }, token);
}

/**
 * Redefine a senha a partir de um token de redefinição (Req. 7.4).
 *
 * Fluxo:
 * 1. Lê o cidadaoId em `reset:senha:{token}` no Redis. Se ausente/expirado,
 *    rejeita com TOKEN_EXPIRED.
 * 2. Valida o comprimento da nova senha (8–64 caracteres).
 * 3. Gera o hash bcrypt e atualiza `senhaHash` do cidadão. Também zera
 *    `tentativasLogin` e `bloqueadoAte` para desbloquear a conta.
 * 4. Remove o token do Redis (uso único).
 */
export async function redefinirSenha(
  token: string,
  novaSenha: string,
  deps?: Partial<RecuperacaoDeps>,
): Promise<void> {
  const { prisma, redis } = resolveDeps(deps);

  // 1. Resolver o token no Redis.
  const chave = montarChaveReset(token);
  const cidadaoId = await redis.get(chave);
  if (!cidadaoId) {
    throw new AppError(400, ErrorCodes.TOKEN_EXPIRED, 'Link de redefinição inválido ou expirado');
  }

  // 2. Validar comprimento da nova senha (Req. 7.3).
  if (novaSenha.length < SENHA_MIN || novaSenha.length > SENHA_MAX) {
    throw badRequest(
      ErrorCodes.VALIDATION_ERROR,
      `A senha deve ter entre ${SENHA_MIN} e ${SENHA_MAX} caracteres`,
      'novaSenha',
    );
  }

  // 3. Hash e atualização; desbloqueia a conta.
  const senhaHash = await bcrypt.hash(novaSenha, env.BCRYPT_ROUNDS);
  await prisma.cidadao.update({
    where: { id: cidadaoId },
    data: {
      senhaHash,
      tentativasLogin: 0,
      bloqueadoAte: null,
    },
  });

  // 4. Invalida o token (uso único).
  await redis.del(chave);
}
