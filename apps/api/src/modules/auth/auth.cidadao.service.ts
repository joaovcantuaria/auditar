import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { ErrorCodes } from '@auditar/shared';
import { validarCPF, desformatarCPF } from '../../utils/cpf.js';
import { AppError, badRequest } from '../../utils/errors.js';
import { prisma as defaultPrisma } from '../../config/database.js';
import { redis as defaultRedis } from '../../config/redis.js';
import { env } from '../../config/env.js';
import { enviarEmailAtivacao } from './auth.cidadao.email.js';
import type { RegistrarInput } from './auth.cidadao.schema.js';

/**
 * Serviço de cadastro e ativação de conta do Cidadão.
 *
 * _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 1.8, 1.9_
 */

/** Validade do token de ativação: 48 horas (Req. 1.7). */
export const TOKEN_ATIVACAO_TTL_MS = 48 * 60 * 60 * 1000;

/** Limite de reenvios do link de ativação por período de 24h (Req. 1.8). */
export const MAX_REENVIOS_ATIVACAO = 3;

/** TTL da janela de reenvio no Redis: 24 horas em segundos (Req. 1.8). */
export const REENVIO_WINDOW_SECONDS = 24 * 60 * 60;

/** Portas mínimas dos serviços externos, para injeção em testes. */
export type CidadaoPrismaClient = Pick<PrismaClient, 'cidadao'>;
export type RedisClient = Pick<Redis, 'incr' | 'expire'>;

/** Função de envio de e-mail de ativação (injetável). */
export type EnviarAtivacaoFn = typeof enviarEmailAtivacao;

/** Dependências do serviço — permitem substituição em testes. */
export interface CidadaoAuthDeps {
  prisma: CidadaoPrismaClient;
  redis: RedisClient;
  enviarEmail: EnviarAtivacaoFn;
  /** Gerador de token (uuid v4 por padrão). */
  gerarToken: () => string;
  /** Relógio injetável. */
  agora: () => Date;
}

const defaultDeps: CidadaoAuthDeps = {
  prisma: defaultPrisma,
  redis: defaultRedis,
  enviarEmail: enviarEmailAtivacao,
  gerarToken: () => randomUUID(),
  agora: () => new Date(),
};

/** Mescla dependências parciais com os padrões de produção. */
function resolveDeps(deps?: Partial<CidadaoAuthDeps>): CidadaoAuthDeps {
  return { ...defaultDeps, ...deps };
}

/** Resultado do cadastro — nunca expõe a senha ou o token completo. */
export interface RegistrarResult {
  id: string;
  /** Token de ativação mascarado (apenas para feedback ao cliente). */
  protocoloAtivacao: string;
}

/** Mascara o token, expondo apenas os primeiros caracteres. */
function mascararToken(token: string): string {
  const visivel = token.slice(0, 8);
  return `${visivel}${'*'.repeat(Math.max(0, token.length - 8))}`;
}

/**
 * Registra um novo cidadão (Req. 1.1–1.5).
 *
 * Fluxo:
 * 1. Valida os dígitos verificadores do CPF (Req. 1.2).
 * 2. Normaliza o CPF (remove formatação).
 * 3. Rejeita CPF/email já cadastrados (Req. 1.3).
 * 4. Gera hash bcrypt da senha (Req. 20.2).
 * 5. Gera token de ativação único com validade de 48h.
 * 6. Cria a conta inativa (`ativo=false`, `emailConfirmado=false`).
 * 7. Envia o e-mail de ativação (Req. 1.5).
 */
export async function registrarCidadao(
  dto: RegistrarInput,
  deps?: Partial<CidadaoAuthDeps>,
): Promise<RegistrarResult> {
  const { prisma, enviarEmail, gerarToken, agora } = resolveDeps(deps);

  // 1. Validar dígitos verificadores do CPF.
  if (!validarCPF(dto.cpf)) {
    throw badRequest(ErrorCodes.CPF_INVALIDO, 'CPF inválido', 'cpf');
  }

  // 2. Normalizar CPF.
  const cpf = desformatarCPF(dto.cpf);
  const email = dto.email.trim().toLowerCase();

  // 3. Verificar duplicidade de CPF ou email (conta ativa ou inativa).
  const existente = await prisma.cidadao.findFirst({
    where: { OR: [{ cpf }, { email }] },
    select: { id: true, cpf: true },
  });
  if (existente) {
    if (existente.cpf === cpf) {
      throw badRequest(ErrorCodes.CPF_DUPLICADO, 'CPF já cadastrado', 'cpf');
    }
    throw badRequest(ErrorCodes.VALIDATION_ERROR, 'E-mail já cadastrado', 'email');
  }

  // 4. Hash da senha.
  const senhaHash = await bcrypt.hash(dto.senha, env.BCRYPT_ROUNDS);

  // 5. Token de ativação com expiração de 48h.
  const tokenAtivacao = gerarToken();
  const tokenAtivacaoExpira = new Date(agora().getTime() + TOKEN_ATIVACAO_TTL_MS);

  // 6. Criar conta inativa.
  const cidadao = await prisma.cidadao.create({
    data: {
      nome: dto.nome,
      cpf,
      email,
      telefone: dto.telefone,
      logradouro: dto.logradouro,
      numero: dto.numero,
      cep: dto.cep,
      cidade: dto.cidade,
      estado: dto.estado.toUpperCase(),
      senhaHash,
      ativo: false,
      emailConfirmado: false,
      tokenAtivacao,
      tokenAtivacaoExpira,
    },
    select: { id: true, nome: true, email: true },
  });

  // 7. Enviar e-mail de ativação.
  await enviarEmail({ nome: cidadao.nome, email: cidadao.email }, tokenAtivacao);

  return { id: cidadao.id, protocoloAtivacao: mascararToken(tokenAtivacao) };
}

/** Resultado da ativação. */
export interface AtivarResult {
  id: string;
}

/**
 * Ativa a conta do cidadão a partir de um token de ativação (Req. 1.6, 1.7).
 *
 * Rejeita quando o token não existe ou já expirou; caso válido, marca a conta
 * como ativa e confirmada, limpando os campos de token.
 */
export async function ativarConta(
  token: string,
  deps?: Partial<CidadaoAuthDeps>,
): Promise<AtivarResult> {
  const { prisma, agora } = resolveDeps(deps);

  const cidadao = await prisma.cidadao.findFirst({
    where: { tokenAtivacao: token },
    select: { id: true, tokenAtivacaoExpira: true, ativo: true },
  });

  if (!cidadao) {
    throw new AppError(400, ErrorCodes.TOKEN_EXPIRED, 'Link de ativação inválido ou expirado');
  }

  // Token expirado (Req. 1.7).
  if (!cidadao.tokenAtivacaoExpira || cidadao.tokenAtivacaoExpira.getTime() < agora().getTime()) {
    throw new AppError(400, ErrorCodes.TOKEN_EXPIRED, 'Link de ativação inválido ou expirado');
  }

  await prisma.cidadao.update({
    where: { id: cidadao.id },
    data: {
      ativo: true,
      emailConfirmado: true,
      tokenAtivacao: null,
      tokenAtivacaoExpira: null,
    },
  });

  return { id: cidadao.id };
}

/**
 * Reenvia o link de ativação (Req. 1.8).
 *
 * Invalida o token anterior, gera um novo com validade de 48h e reenvia o
 * e-mail. Aplica limite de no máximo 3 reenvios por período de 24h via Redis
 * (`ativacao:resend:{cidadaoId}` — INCR + EXPIRE).
 *
 * Contas já ativas são silenciosamente ignoradas (nenhum e-mail é enviado),
 * evitando enumeração de contas.
 */
export async function reenviarAtivacao(
  email: string,
  deps?: Partial<CidadaoAuthDeps>,
): Promise<void> {
  const { prisma, redis, enviarEmail, gerarToken, agora } = resolveDeps(deps);

  const normalizado = email.trim().toLowerCase();
  const cidadao = await prisma.cidadao.findFirst({
    where: { email: normalizado, ativo: false },
    select: { id: true, nome: true, email: true },
  });

  // Não revela se o e-mail existe ou já está ativo.
  if (!cidadao) {
    return;
  }

  // Rate limit: máximo de 3 reenvios por 24h.
  const chave = `ativacao:resend:${cidadao.id}`;
  const total = await redis.incr(chave);
  if (total === 1) {
    await redis.expire(chave, REENVIO_WINDOW_SECONDS);
  }
  if (total > MAX_REENVIOS_ATIVACAO) {
    throw badRequest(
      ErrorCodes.VALIDATION_ERROR,
      'Limite de reenvios atingido. Tente novamente em 24 horas.',
    );
  }

  // Invalida o token anterior gerando um novo.
  const tokenAtivacao = gerarToken();
  const tokenAtivacaoExpira = new Date(agora().getTime() + TOKEN_ATIVACAO_TTL_MS);

  await prisma.cidadao.update({
    where: { id: cidadao.id },
    data: { tokenAtivacao, tokenAtivacaoExpira },
  });

  await enviarEmail({ nome: cidadao.nome, email: cidadao.email }, tokenAtivacao);
}
