import { randomInt } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { ErrorCodes } from '@auditar/shared';
import { AppError } from '../../utils/errors.js';
import { prisma as defaultPrisma } from '../../config/database.js';
import { redis as defaultRedis } from '../../config/redis.js';
import { signToken } from '../../lib/jwt.js';
import { registrar } from '../auditoria/auditoria.service.js';
import { enviarCodigo2fa as defaultEnviarCodigo2fa } from './auth.2fa.notify.js';

/**
 * Serviço de autenticação de dois fatores (2FA) do Cidadão.
 *
 * Fluxo (Req. 2.5, 2.6):
 *  - Após validar CPF + senha com sucesso (task 3.3), se a conta possuir
 *    `doisFatoresAtivo: true`, o login retorna `{ requires2fa: true, cidadaoId }`.
 *  - `gerarCodigo2fa` gera um código numérico de 6 dígitos, armazena no Redis
 *    (`2fa:code:{cidadaoId}`) com validade de 10 minutos e envia pelo canal
 *    escolhido (email ou SMS).
 *  - `verificar2fa` valida o código. Um código expirado/ausente ou inválido é
 *    rejeitado SEM contabilizar a tentativa no limite de bloqueio por senha
 *    (Req. 2.6) — este serviço nunca toca em `tentativasLogin`/`bloqueadoAte`.
 *
 * O código é armazenado em texto puro no Redis: trata-se de um segredo de vida
 * curta (10 min), de uso único (removido no sucesso), protegido pelo TTL e pelo
 * escopo por `cidadaoId`. Isso mantém a comparação simples e evita hashing
 * desnecessário para um valor de 6 dígitos efêmero.
 *
 * _Requirements: Req. 2.5, 2.6_
 */

/** Canais suportados para envio do código 2FA. */
export type Canal2fa = 'email' | 'sms';

/** Prefixo das chaves Redis que guardam o código 2FA por cidadão. */
export const CODIGO_2FA_KEY_PREFIX = '2fa:code:';

/** Validade do código 2FA: 10 minutos em segundos (Req. 2.5). */
export const CODIGO_2FA_TTL_SECONDS = 10 * 60;

/** Monta a chave Redis do código 2FA de um cidadão. */
export function chaveCodigo2fa(cidadaoId: string): string {
  return `${CODIGO_2FA_KEY_PREFIX}${cidadaoId}`;
}

/** Cliente Prisma mínimo utilizado pelo serviço (facilita injeção em testes). */
export type Cidadao2faPrismaClient = Pick<PrismaClient, 'cidadao' | 'acessoHistorico'>;

/** Interface mínima do Redis utilizada pelo serviço. */
export type Redis2faClient = Pick<Redis, 'set' | 'get' | 'del'>;

/** Assinatura da função que assina o JWT (injetável). */
export type SignTokenFn = typeof signToken;

/** Assinatura da função de auditoria (injetável). */
export type RegistrarAuditoriaFn = typeof registrar;

/** Assinatura da função de envio do código pelo canal (injetável). */
export type EnviarCodigo2faFn = typeof defaultEnviarCodigo2fa;

/** Dependências do serviço — permitem substituição em testes. */
export interface Cidadao2faDeps {
  prisma: Cidadao2faPrismaClient;
  redis: Redis2faClient;
  signToken: SignTokenFn;
  registrarAuditoria: RegistrarAuditoriaFn;
  enviarCodigo: EnviarCodigo2faFn;
  /** Gerador do código de 6 dígitos (crypto por padrão). */
  gerarCodigo: () => string;
}

const defaultDeps: Cidadao2faDeps = {
  prisma: defaultPrisma,
  redis: defaultRedis,
  signToken,
  registrarAuditoria: registrar,
  enviarCodigo: defaultEnviarCodigo2fa,
  gerarCodigo: gerarCodigoNumerico,
};

/** Mescla dependências parciais com os padrões de produção. */
function resolveDeps(deps?: Partial<Cidadao2faDeps>): Cidadao2faDeps {
  return { ...defaultDeps, ...deps };
}

/**
 * Gera um código numérico de 6 dígitos com preenchimento à esquerda por zeros.
 * Usa `crypto.randomInt` para aleatoriedade adequada (0–999999).
 */
export function gerarCodigoNumerico(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Mascara um destino (email/telefone) para feedback seguro ao cliente. */
function mascararDestino(canal: Canal2fa, destino: string): string {
  if (canal === 'email') {
    const [usuario, dominio] = destino.split('@');
    if (!dominio) {
      return destino;
    }
    const visivel = usuario.slice(0, 2);
    return `${visivel}${'*'.repeat(Math.max(1, usuario.length - 2))}@${dominio}`;
  }
  // SMS/telefone: mostra apenas os 4 últimos dígitos.
  const ultimos = destino.slice(-4);
  return `${'*'.repeat(Math.max(0, destino.length - 4))}${ultimos}`;
}

/** Resultado de `gerarCodigo2fa` — destino mascarado apenas para feedback. */
export interface GerarCodigo2faResult {
  canal: Canal2fa;
  /** Destino mascarado (ex.: `ma****@example.com`). */
  destino: string;
}

/**
 * Gera e envia o código 2FA de 6 dígitos ao cidadão (Req. 2.5).
 *
 * @param cidadaoId id do cidadão que já autenticou CPF + senha.
 * @param canal canal desejado; quando ausente usa `doisFatoresCanal` do cidadão,
 *              caindo para `email` como padrão.
 * @throws AppError 400 quando o cidadão não existe ou não tem 2FA ativo.
 * @throws AppError 400 quando o canal escolhido é SMS mas não há telefone cadastrado.
 */
export async function gerarCodigo2fa(
  cidadaoId: string,
  canal?: Canal2fa,
  deps?: Partial<Cidadao2faDeps>,
): Promise<GerarCodigo2faResult> {
  const { prisma, redis, enviarCodigo, gerarCodigo } = resolveDeps(deps);

  const cidadao = await prisma.cidadao.findUnique({
    where: { id: cidadaoId },
    select: {
      id: true,
      nome: true,
      email: true,
      telefone: true,
      doisFatoresAtivo: true,
      doisFatoresCanal: true,
    },
  });

  // Não gera código para conta inexistente ou sem 2FA habilitado (Req. 2.5).
  if (!cidadao || !cidadao.doisFatoresAtivo) {
    throw new AppError(400, ErrorCodes.INVALID_CREDENTIALS, 'Autenticação de dois fatores indisponível');
  }

  const canalEscolhido: Canal2fa = canal ?? (cidadao.doisFatoresCanal as Canal2fa | null) ?? 'email';

  const destino = canalEscolhido === 'sms' ? cidadao.telefone : cidadao.email;
  if (!destino) {
    throw new AppError(
      400,
      ErrorCodes.VALIDATION_ERROR,
      'Não há destino cadastrado para o canal selecionado',
    );
  }

  // Gera o código e o armazena com validade de 10 minutos (Req. 2.5).
  const codigo = gerarCodigo();
  await redis.set(chaveCodigo2fa(cidadaoId), codigo, 'EX', CODIGO_2FA_TTL_SECONDS);

  // Envia pelo canal escolhido (email via mailer, ou SMS stub).
  await enviarCodigo({ nome: cidadao.nome, email: cidadao.email, telefone: cidadao.telefone }, canalEscolhido, codigo);

  return { canal: canalEscolhido, destino: mascararDestino(canalEscolhido, destino) };
}

/** Resultado de `verificar2fa`. */
export interface Verificar2faResult {
  token: string;
  cidadao: { id: string; nome: string };
}

/**
 * Verifica o código 2FA e conclui a autenticação (Req. 2.5, 2.6).
 *
 * Importante (Req. 2.6): uma falha aqui — código expirado, ausente ou incorreto —
 * NUNCA incrementa o contador de bloqueio por senha. Este serviço não altera
 * `tentativasLogin` nem `bloqueadoAte`.
 *
 * @param cidadaoId id do cidadão que iniciou o login.
 * @param codigo código de 6 dígitos informado.
 * @param manterConectado quando true emite um JWT de longa duração (7 dias, Req. 2.7).
 * @param ip endereço IP de origem, para histórico e auditoria.
 * @throws AppError 400 (TOKEN_EXPIRED) quando o código expirou ou não existe (Req. 2.6).
 * @throws AppError 400 (INVALID_CREDENTIALS) quando o código está incorreto (Req. 2.6).
 */
export async function verificar2fa(
  cidadaoId: string,
  codigo: string,
  manterConectado: boolean,
  ip: string,
  deps?: Partial<Cidadao2faDeps>,
): Promise<Verificar2faResult> {
  const { prisma, redis, signToken: assinar, registrarAuditoria } = resolveDeps(deps);

  const chave = chaveCodigo2fa(cidadaoId);
  const armazenado = await redis.get(chave);

  // Código ausente/expirado — rejeita SEM tocar no contador de bloqueio (Req. 2.6).
  if (!armazenado) {
    throw new AppError(400, ErrorCodes.TOKEN_EXPIRED, 'Código expirado ou inválido');
  }

  // Código incorreto — rejeita SEM tocar no contador de bloqueio (Req. 2.6).
  if (armazenado !== codigo) {
    throw new AppError(400, ErrorCodes.INVALID_CREDENTIALS, 'Código inválido');
  }

  const cidadao = await prisma.cidadao.findUnique({
    where: { id: cidadaoId },
    select: { id: true, nome: true },
  });

  if (!cidadao) {
    // Conta removida entre login e verificação — trata como código inválido.
    throw new AppError(400, ErrorCodes.INVALID_CREDENTIALS, 'Código inválido');
  }

  // Código de uso único: remove após validar com sucesso.
  await redis.del(chave);

  const token = assinar(
    { sub: cidadao.id, role: 'cidadao' },
    { longLived: manterConectado },
  );

  // Registra o acesso no histórico.
  await prisma.acessoHistorico.create({
    data: { cidadaoId: cidadao.id, enderecoIp: ip },
  });

  // Auditoria assíncrona do login concluído por 2FA.
  await registrarAuditoria({
    ator: 'cidadao',
    atorCidadaoId: cidadao.id,
    enderecoIp: ip,
    tipoAcao: 'login_2fa',
    modulo: 'auth',
    objetoId: cidadao.id,
    tipoObjeto: 'Cidadao',
  });

  return { token, cidadao: { id: cidadao.id, nome: cidadao.nome } };
}

/**
 * Ativa a autenticação de dois fatores para o cidadão, definindo o canal
 * preferido (Req. 2.5). Usado pelas configurações de conta.
 */
export async function ativar2fa(
  cidadaoId: string,
  canal: Canal2fa,
  deps?: Partial<Cidadao2faDeps>,
): Promise<void> {
  const { prisma } = resolveDeps(deps);
  await prisma.cidadao.update({
    where: { id: cidadaoId },
    data: { doisFatoresAtivo: true, doisFatoresCanal: canal },
  });
}

/**
 * Desativa a autenticação de dois fatores para o cidadão (Req. 2.5).
 * Usado pelas configurações de conta.
 */
export async function desativar2fa(
  cidadaoId: string,
  deps?: Partial<Cidadao2faDeps>,
): Promise<void> {
  const { prisma } = resolveDeps(deps);
  await prisma.cidadao.update({
    where: { id: cidadaoId },
    data: { doisFatoresAtivo: false, doisFatoresCanal: null },
  });
}
