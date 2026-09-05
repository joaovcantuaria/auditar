import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { ErrorCodes } from '@auditar/shared';
import { desformatarCPF } from '../../utils/cpf.js';
import { AppError, unauthorized } from '../../utils/errors.js';
import { prisma as defaultPrisma } from '../../config/database.js';
import { signToken, blacklistToken } from '../../lib/jwt.js';
import { registrar } from '../auditoria/auditoria.service.js';
import { enviarEmailBloqueio } from './auth.cidadao.email.js';

/**
 * Serviço de autenticação (login/logout) do Cidadão.
 *
 * Regras (Req. 2):
 *  - Login com CPF + senha; mensagem de erro genérica tanto para CPF inexistente
 *    quanto para senha incorreta, sem revelar qual campo falhou (Req. 2.2). O
 *    frontend mantém o CPF preenchido no formulário — o backend não interfere.
 *  - Conta ainda não ativada é rejeitada com código específico (Req. 1.9).
 *  - Bloqueio após 5 tentativas consecutivas por exatamente 15 minutos, com
 *    notificação por e-mail ao endereço cadastrado (Req. 2.3). Durante o
 *    bloqueio novas tentativas são rejeitadas com o tempo restante (Req. 2.4).
 *  - 2FA (Req. 2.5): quando `doisFatoresAtivo`, o login valida CPF+senha mas NÃO
 *    emite o token final; retorna `requires2fa` para que a verificação do código
 *    (task 3.5) conclua o fluxo e emita o token.
 *  - "Manter conectado" (Req. 2.7): usa token de longa duração (7 dias via
 *    `JWT_LONG_EXPIRES_IN`); caso contrário usa `JWT_EXPIRES_IN`.
 *  - Timeout por inatividade de 30 minutos (Req. 2.8/2.9) é derivado da
 *    expiração do JWT: o frontend detecta a expiração (campo `exp`) e exibe a
 *    mensagem de encerramento por inatividade antes de redirecionar ao login.
 *    Nenhum cron adicional é necessário no backend para este fluxo.
 *
 * _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 2.8, 2.9, 1.9_
 */

/** Número de tentativas consecutivas que dispara o bloqueio (Req. 2.3). */
export const MAX_TENTATIVAS = 5;

/** Duração do bloqueio em minutos (Req. 2.3). */
export const BLOQUEIO_MINUTOS = 15;

/** Mensagem genérica única para credenciais inválidas / conta inexistente (Req. 2.2). */
const MSG_CREDENCIAIS = 'CPF ou senha inválidos';

/** Cliente Prisma mínimo usado pelo serviço — facilita injeção em testes. */
export type CidadaoLoginPrismaClient = Pick<PrismaClient, 'cidadao' | 'acessoHistorico'>;

/** Função de auditoria injetável (login do cidadão). */
export type RegistrarAuditoriaLoginFn = typeof registrar;

/** Função de notificação de bloqueio injetável. */
export type EnviarBloqueioFn = typeof enviarEmailBloqueio;

/** Dependências do serviço de login — permitem substituição em testes. */
export interface CidadaoLoginDeps {
  prisma: CidadaoLoginPrismaClient;
  /** Assina o JWT. */
  assinarToken: typeof signToken;
  /** Revoga um token no logout. */
  revogarToken: typeof blacklistToken;
  /** Registra auditoria (assíncrona). */
  auditar: RegistrarAuditoriaLoginFn;
  /** Envia e-mail de notificação de bloqueio. */
  notificarBloqueio: EnviarBloqueioFn;
  /** Relógio injetável. */
  agora: () => Date;
}

const defaultDeps: CidadaoLoginDeps = {
  prisma: defaultPrisma,
  assinarToken: signToken,
  revogarToken: blacklistToken,
  auditar: registrar,
  notificarBloqueio: enviarEmailBloqueio,
  agora: () => new Date(),
};

/** Mescla dependências parciais com os padrões de produção. */
function resolveDeps(deps?: Partial<CidadaoLoginDeps>): CidadaoLoginDeps {
  return { ...defaultDeps, ...deps };
}

/** Calcula os minutos inteiros restantes de bloqueio (arredonda para cima, mínimo 1). */
function minutosRestantes(bloqueadoAte: Date, agora: Date): number {
  const diffMs = bloqueadoAte.getTime() - agora.getTime();
  return Math.max(1, Math.ceil(diffMs / 60_000));
}

/** Resultado do login quando o 2FA está habilitado (token ainda não emitido). */
export interface Login2faPendente {
  requires2fa: true;
  cidadaoId: string;
}

/** Resultado do login concluído (token emitido). */
export interface LoginConcluido {
  requires2fa: false;
  token: string;
  cidadao: {
    id: string;
    nome: string;
  };
}

export type LoginCidadaoResult = Login2faPendente | LoginConcluido;

/**
 * Autentica um Cidadão por CPF + senha.
 *
 * @param cpf CPF informado (pode vir formatado; será normalizado para 11 dígitos).
 * @param senha senha em texto puro.
 * @param manterConectado quando true, emite token de longa duração (Req. 2.7).
 * @param ip endereço IP de origem, para histórico de acessos e auditoria.
 * @throws AppError 401 genérico quando CPF não existe ou senha incorreta (Req. 2.2).
 * @throws AppError 403 (ACCOUNT_NOT_ACTIVATED) quando a conta ainda não foi ativada (Req. 1.9).
 * @throws AppError 429 (ACCOUNT_LOCKED) quando a conta está bloqueada, com minutos restantes (Req. 2.4).
 */
export async function loginCidadao(
  cpf: string,
  senha: string,
  manterConectado: boolean,
  ip: string,
  deps?: Partial<CidadaoLoginDeps>,
): Promise<LoginCidadaoResult> {
  const { prisma, assinarToken, auditar, notificarBloqueio, agora } = resolveDeps(deps);

  // 1. Normalizar CPF.
  const cpfNormalizado = desformatarCPF(cpf);
  const instante = agora();

  // 2. Localizar cidadão pelo CPF.
  const cidadao = await prisma.cidadao.findUnique({
    where: { cpf: cpfNormalizado },
  });

  // Req. 2.2: CPF inexistente → mesma mensagem genérica de credenciais inválidas.
  if (!cidadao) {
    throw unauthorized(MSG_CREDENCIAIS);
  }

  // 3. Conta ainda não ativada (Req. 1.9).
  if (!cidadao.ativo) {
    throw new AppError(
      403,
      ErrorCodes.ACCOUNT_NOT_ACTIVATED,
      'Sua conta ainda aguarda ativação. Verifique o e-mail de confirmação.',
    );
  }

  // 4. Conta bloqueada e ainda dentro do período de bloqueio (Req. 2.4).
  if (cidadao.bloqueadoAte && cidadao.bloqueadoAte.getTime() > instante.getTime()) {
    const restante = minutosRestantes(cidadao.bloqueadoAte, instante);
    throw new AppError(
      429,
      ErrorCodes.ACCOUNT_LOCKED,
      `Conta bloqueada temporariamente. Tente novamente em ${restante} minuto(s).`,
    );
  }

  // 5. Conferir a senha.
  const senhaCorreta = await bcrypt.compare(senha, cidadao.senhaHash);

  if (!senhaCorreta) {
    const tentativas = cidadao.tentativasLogin + 1;

    if (tentativas >= MAX_TENTATIVAS) {
      // 5ª tentativa: bloqueia por 15min, zera o contador e notifica por e-mail (Req. 2.3).
      const bloqueadoAte = new Date(instante.getTime() + BLOQUEIO_MINUTOS * 60_000);
      await prisma.cidadao.update({
        where: { id: cidadao.id },
        data: { tentativasLogin: 0, bloqueadoAte },
      });
      // Notificação por e-mail nunca deve interromper o fluxo de login.
      try {
        await notificarBloqueio(
          { nome: cidadao.nome, email: cidadao.email },
          BLOQUEIO_MINUTOS,
        );
      } catch (err) {
        console.error(
          JSON.stringify({
            level: 'error',
            scope: 'auth.cidadao.login',
            event: 'notificar_bloqueio_falhou',
            cidadaoId: cidadao.id,
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    } else {
      await prisma.cidadao.update({
        where: { id: cidadao.id },
        data: { tentativasLogin: tentativas },
      });
    }

    // Req. 2.2: senha incorreta → mesma mensagem genérica.
    throw unauthorized(MSG_CREDENCIAIS);
  }

  // 6. Sucesso: zera contadores e limpa bloqueio.
  await prisma.cidadao.update({
    where: { id: cidadao.id },
    data: { tentativasLogin: 0, bloqueadoAte: null },
  });

  // 6a. 2FA habilitado (Req. 2.5): não emite token; a verificação do código
  // (task 3.5) conclui o fluxo. Não registra acesso/auditoria de login ainda.
  if (cidadao.doisFatoresAtivo) {
    return { requires2fa: true, cidadaoId: cidadao.id };
  }

  // 6b. Sem 2FA: emite o token (longa duração se "manter conectado" — Req. 2.7).
  const token = assinarToken(
    { sub: cidadao.id, role: 'cidadao' },
    { longLived: manterConectado },
  );

  // Registra o acesso no histórico.
  await prisma.acessoHistorico.create({
    data: { cidadaoId: cidadao.id, enderecoIp: ip },
  });

  // Auditoria assíncrona do login.
  await auditar({
    ator: 'cidadao',
    atorCidadaoId: cidadao.id,
    enderecoIp: ip,
    tipoAcao: 'login',
    modulo: 'auth',
    objetoId: cidadao.id,
    tipoObjeto: 'Cidadao',
  });

  return {
    requires2fa: false,
    token,
    cidadao: { id: cidadao.id, nome: cidadao.nome },
  };
}

/**
 * Encerra a sessão do Cidadão adicionando o `jti` do token à blacklist (Req. 2).
 *
 * @param jti identificador do JWT.
 * @param exp expiração do token em epoch seconds.
 */
export async function logoutCidadao(
  jti: string,
  exp: number,
  deps?: Partial<CidadaoLoginDeps>,
): Promise<void> {
  const { revogarToken } = resolveDeps(deps);
  await revogarToken(jti, exp);
}
