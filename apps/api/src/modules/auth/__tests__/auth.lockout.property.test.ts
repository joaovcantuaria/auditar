// Feature: auditar-sistema-gestao, Property 3: Bloqueio por Tentativas Consecutivas de Login
//
// Property 3: Bloqueio por Tentativas Consecutivas de Login
// For any citizen or servidor account, after exactly 5 consecutive failed login
// attempts the account must be locked, and any further attempt must be rejected
// with a lock indication until the period expires.
//
// Validates: Requirements 2.3, 20.8

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { ErrorCodes, NivelAcesso } from '@auditar/shared';

// ---------------------------------------------------------------------------
// Mocks das dependências carregadas no import dos serviços. `prisma`/`redis` de
// config, `lib/jwt`, auditoria, os helpers de e-mail e o `bcryptjs` são
// substituídos para não abrir conexões reais nem carregar `@prisma/client`/
// `ioredis` (não resolvidos no ambiente de teste). O `bcrypt.compare` retorna
// `false` para simular senha incorreta em todas as tentativas.
// ---------------------------------------------------------------------------

vi.mock('../../../config/redis.js', () => ({ redis: {} }));

// prisma compartilhado (usado pelo serviço do servidor, que importa `prisma`
// diretamente de config/database). O objeto é reatribuído por corrida através de
// `Object.assign` sobre `servidorPrismaMock`. Usa `vi.hoisted` porque `vi.mock` é
// içado acima das declarações de módulo.
const { servidorPrismaMock } = vi.hoisted(() => ({
  servidorPrismaMock: {} as Record<string, unknown>,
}));
vi.mock('../../../config/database.js', () => ({
  get prisma() {
    return servidorPrismaMock;
  },
}));

const signTokenMock = vi.fn(() => 'signed.jwt.token');
const blacklistTokenMock = vi.fn(async () => undefined);
vi.mock('../../../lib/jwt.js', () => ({
  signToken: (...args: unknown[]) => signTokenMock(...args),
  blacklistToken: (...args: unknown[]) => blacklistTokenMock(...args),
}));

const registrarMock = vi.fn(async () => undefined);
vi.mock('../../../modules/auditoria/auditoria.service.js', () => ({
  registrar: (...args: unknown[]) => registrarMock(...args),
}));
vi.mock('../../../modules/auditoria/index.js', () => ({
  registrar: (...args: unknown[]) => registrarMock(...args),
}));

const enviarEmailBloqueioMock = vi.fn(async () => undefined);
vi.mock('../auth.cidadao.email.js', () => ({
  enviarEmailBloqueio: (...args: unknown[]) => enviarEmailBloqueioMock(...args),
}));

const bcryptCompareMock = vi.fn(async () => false);
vi.mock('bcryptjs', () => ({
  default: {
    compare: (...args: unknown[]) => bcryptCompareMock(...args),
    hash: vi.fn(async (senha: string) => `hashed:${senha}`),
  },
}));

// Import AFTER mocks are registered.
import {
  loginCidadao,
  MAX_TENTATIVAS as CIDADAO_MAX_TENTATIVAS,
  BLOQUEIO_MINUTOS as CIDADAO_BLOQUEIO_MINUTOS,
  type CidadaoLoginDeps,
} from '../auth.cidadao.login.service.js';
import { loginServidor } from '../auth.servidor.service.js';
import { AppError } from '../../../utils/errors.js';

// ---------------------------------------------------------------------------
// Constantes de teste
// ---------------------------------------------------------------------------

// Boundary comum a cidadão e servidor: 5 tentativas consecutivas disparam o bloqueio.
const MAX_TENTATIVAS = 5;
// Servidor bloqueia por 30 minutos (constante privada do serviço; conferida via delta).
const SERVIDOR_BLOQUEIO_MINUTOS = 30;

// CPF de 11 dígitos válido (o login normaliza via desformatarCPF e não revalida
// dígitos verificadores, então qualquer string de 11 dígitos serve).
const CPF = '52998224725';
const IP = '203.0.113.10';
const NOW = new Date('2025-01-01T12:00:00.000Z');

// ---------------------------------------------------------------------------
// Helpers — cidadão
// ---------------------------------------------------------------------------

interface CidadaoRecord {
  id: string;
  nome: string;
  cpf: string;
  email: string;
  senhaHash: string;
  ativo: boolean;
  tentativasLogin: number;
  bloqueadoAte: Date | null;
  doisFatoresAtivo: boolean;
}

function makeCidadaoRecord(): CidadaoRecord {
  return {
    id: 'cid-1',
    nome: 'Maria Silva',
    cpf: CPF,
    email: 'maria@example.com',
    senhaHash: '$2a$12$hashedpassword',
    ativo: true,
    tentativasLogin: 0,
    bloqueadoAte: null,
    doisFatoresAtivo: false,
  };
}

/**
 * Deps do cidadão com um registro prisma ESTATEFUL em memória: `update` muta o
 * registro real e `findUnique` sempre devolve o estado corrente. Isso permite
 * dirigir N logins sequenciais pelo serviço real e observar a transição.
 */
function buildCidadaoDeps(record: CidadaoRecord): Partial<CidadaoLoginDeps> {
  const findUnique = vi.fn(async () => ({ ...record }));
  const update = vi.fn(async (args: { where: unknown; data: Partial<CidadaoRecord> }) => {
    Object.assign(record, args.data);
    return { ...record };
  });
  const acessoCreate = vi.fn(async () => ({ id: 'ac-1' }));

  return {
    prisma: {
      cidadao: { findUnique, update },
      acessoHistorico: { create: acessoCreate },
    } as unknown as CidadaoLoginDeps['prisma'],
    assinarToken: signTokenMock as unknown as CidadaoLoginDeps['assinarToken'],
    revogarToken: blacklistTokenMock as unknown as CidadaoLoginDeps['revogarToken'],
    auditar: registrarMock as unknown as CidadaoLoginDeps['auditar'],
    notificarBloqueio: enviarEmailBloqueioMock as unknown as CidadaoLoginDeps['notificarBloqueio'],
    agora: () => NOW,
  };
}

// ---------------------------------------------------------------------------
// Helpers — servidor
// ---------------------------------------------------------------------------

interface ServidorRecord {
  id: string;
  nome: string;
  cpf: string;
  email: string;
  senhaHash: string;
  nivelAcesso: number;
  ativo: boolean;
  senhaTemporaria: boolean;
  tentativasLogin: number;
  bloqueadoAte: Date | null;
}

function makeServidorRecord(): ServidorRecord {
  return {
    id: 'srv-1',
    nome: 'Maria Servidora',
    cpf: CPF,
    email: 'maria@municipio.gov',
    senhaHash: '$2a$12$hashedpassword',
    nivelAcesso: NivelAcesso.ANALISTA,
    ativo: true,
    senhaTemporaria: false,
    tentativasLogin: 0,
    bloqueadoAte: null,
  };
}

/**
 * Instala um prisma ESTATEFUL para o servidor sobre o mock compartilhado. O
 * serviço do servidor importa `prisma` diretamente (sem injeção de deps) e usa o
 * relógio real; como `bloqueadoAte = now + 30min` fica muito à frente do relógio
 * do processo, a checagem `bloqueadoAte > agora` continua verdadeira nas
 * tentativas subsequentes da mesma corrida.
 */
function installServidorPrisma(record: ServidorRecord): void {
  const findUnique = vi.fn(async () => ({ ...record }));
  const update = vi.fn(async (args: { where: unknown; data: Partial<ServidorRecord> }) => {
    Object.assign(record, args.data);
    return { ...record };
  });

  Object.assign(servidorPrismaMock, {
    servidor: {
      findUnique,
      update,
      findMany: vi.fn(async () => []),
    },
    permissaoServidor: { findMany: vi.fn(async () => []) },
    acessoHistorico: { create: vi.fn(async () => ({ id: 'ac-1' })) },
    notificacao: { createMany: vi.fn(async () => ({ count: 0 })) },
  });
}

// ---------------------------------------------------------------------------
// Utilitário: captura o AppError lançado por uma tentativa de login.
// ---------------------------------------------------------------------------

async function capturarErro(fn: () => Promise<unknown>): Promise<AppError> {
  try {
    await fn();
  } catch (err) {
    return err as AppError;
  }
  throw new Error('esperava que a tentativa de login lançasse, mas ela resolveu');
}

beforeEach(() => {
  vi.clearAllMocks();
  bcryptCompareMock.mockResolvedValue(false);
  signTokenMock.mockReturnValue('signed.jwt.token');
});

// ---------------------------------------------------------------------------
// Property 3 — Cidadão
// ---------------------------------------------------------------------------

describe('Property 3: Bloqueio por Tentativas Consecutivas (Cidadão)', () => {
  it('confirma o boundary de constantes do serviço (5 tentativas / 15 min)', () => {
    expect(CIDADAO_MAX_TENTATIVAS).toBe(MAX_TENTATIVAS);
    expect(CIDADAO_BLOQUEIO_MINUTOS).toBe(15);
  });

  it('tentativas 1..4 → INVALID_CREDENTIALS; a 5ª bloqueia (bloqueadoAte = now+15min); 6+ → ACCOUNT_LOCKED', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 6, max: 12 }), async (totalTentativas) => {
        const record = makeCidadaoRecord();
        const deps = buildCidadaoDeps(record);

        for (let n = 1; n <= totalTentativas; n += 1) {
          const erro = await capturarErro(() =>
            loginCidadao(CPF, 'senha-errada', false, IP, deps),
          );

          if (n < MAX_TENTATIVAS) {
            // Tentativas 1..4: credenciais inválidas, sem bloqueio, contador incrementado.
            expect(erro.code).toBe(ErrorCodes.INVALID_CREDENTIALS);
            expect(record.bloqueadoAte).toBeNull();
            expect(record.tentativasLogin).toBe(n);
          } else if (n === MAX_TENTATIVAS) {
            // 5ª tentativa: dispara o bloqueio. O serviço avalia a senha nesta
            // tentativa (ainda não bloqueado ao entrar), então o erro é o genérico
            // de credenciais, mas o registro passa a estar bloqueado.
            expect(erro.code).toBe(ErrorCodes.INVALID_CREDENTIALS);
            expect(record.bloqueadoAte).toBeInstanceOf(Date);
            expect(record.tentativasLogin).toBe(0);
            const deltaMs = (record.bloqueadoAte as Date).getTime() - NOW.getTime();
            expect(deltaMs).toBe(CIDADAO_BLOQUEIO_MINUTOS * 60_000);
          } else {
            // Tentativas 6+ enquanto bloqueado: rejeitadas com indicação de bloqueio.
            expect(erro).toBeInstanceOf(AppError);
            expect(erro.statusCode).toBe(429);
            expect(erro.code).toBe(ErrorCodes.ACCOUNT_LOCKED);
          }
        }
      }),
      { numRuns: 50 },
    );
  });

  it('exatamente na 5ª a conta trava e permanece travada por todas as tentativas extras', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 6, max: 12 }), async (extras) => {
        const record = makeCidadaoRecord();
        const deps = buildCidadaoDeps(record);

        // Dispara exatamente 5 tentativas para atingir o boundary de bloqueio.
        for (let n = 1; n <= MAX_TENTATIVAS; n += 1) {
          await capturarErro(() => loginCidadao(CPF, 'x', false, IP, deps));
        }
        expect(record.bloqueadoAte).toBeInstanceOf(Date);

        // Toda tentativa pós-bloqueio deve ser rejeitada com ACCOUNT_LOCKED.
        for (let e = 0; e < extras; e += 1) {
          const erro = await capturarErro(() => loginCidadao(CPF, 'x', false, IP, deps));
          expect(erro.code).toBe(ErrorCodes.ACCOUNT_LOCKED);
          // bcrypt.compare não é chamado quando já está bloqueado.
        }
      }),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3 — Servidor
// ---------------------------------------------------------------------------

describe('Property 3: Bloqueio por Tentativas Consecutivas (Servidor)', () => {
  it('tentativas 1..4 → INVALID_CREDENTIALS; a 5ª bloqueia (bloqueadoAte = now+30min); 6+ → ACCOUNT_LOCKED', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 6, max: 12 }), async (totalTentativas) => {
        const record = makeServidorRecord();
        installServidorPrisma(record);

        for (let n = 1; n <= totalTentativas; n += 1) {
          const antes = Date.now();
          const erro = await capturarErro(() => loginServidor(CPF, 'senha-errada', IP));

          if (n < MAX_TENTATIVAS) {
            expect(erro.code).toBe(ErrorCodes.INVALID_CREDENTIALS);
            expect(record.bloqueadoAte).toBeNull();
            expect(record.tentativasLogin).toBe(n);
          } else if (n === MAX_TENTATIVAS) {
            expect(erro.code).toBe(ErrorCodes.INVALID_CREDENTIALS);
            expect(record.bloqueadoAte).toBeInstanceOf(Date);
            expect(record.tentativasLogin).toBe(0);
            const deltaMs = (record.bloqueadoAte as Date).getTime() - antes;
            // ~30 min à frente (tolera o avanço do relógio real durante a corrida).
            expect(deltaMs).toBeGreaterThanOrEqual((SERVIDOR_BLOQUEIO_MINUTOS - 1) * 60_000);
            expect(deltaMs).toBeLessThanOrEqual((SERVIDOR_BLOQUEIO_MINUTOS + 1) * 60_000);
          } else {
            expect(erro).toBeInstanceOf(AppError);
            expect(erro.statusCode).toBe(423);
            expect(erro.code).toBe(ErrorCodes.ACCOUNT_LOCKED);
          }
        }
      }),
      { numRuns: 50 },
    );
  });
});
