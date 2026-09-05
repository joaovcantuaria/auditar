import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCodes } from '@auditar/shared';

// ---------------------------------------------------------------------------
// Mocks das dependências carregadas no import do serviço.
// Substituímos config/database, config/redis, lib/jwt, auditoria e o email
// helper para não abrir conexões reais nem carregar o @prisma/client.
// ---------------------------------------------------------------------------

vi.mock('../../../config/database.js', () => ({ prisma: {} }));
vi.mock('../../../config/redis.js', () => ({ redis: {} }));

const signTokenMock = vi.fn();
const blacklistTokenMock = vi.fn();
vi.mock('../../../lib/jwt.js', () => ({
  signToken: (...args: unknown[]) => signTokenMock(...args),
  blacklistToken: (...args: unknown[]) => blacklistTokenMock(...args),
}));

const registrarMock = vi.fn();
vi.mock('../../../modules/auditoria/auditoria.service.js', () => ({
  registrar: (...args: unknown[]) => registrarMock(...args),
}));

const enviarEmailBloqueioMock = vi.fn();
vi.mock('../auth.cidadao.email.js', () => ({
  enviarEmailBloqueio: (...args: unknown[]) => enviarEmailBloqueioMock(...args),
}));

const bcryptCompareMock = vi.fn();
vi.mock('bcryptjs', () => ({
  default: {
    compare: (...args: unknown[]) => bcryptCompareMock(...args),
    hash: vi.fn(async (senha: string) => `hashed:${senha}`),
  },
}));

// Import AFTER mocks are registered.
import {
  loginCidadao,
  logoutCidadao,
  MAX_TENTATIVAS,
  BLOQUEIO_MINUTOS,
  type CidadaoLoginDeps,
} from '../auth.cidadao.login.service.js';
import { AppError } from '../../../utils/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CPF = '52998224725';
const IP = '203.0.113.10';
const NOW = new Date('2025-01-01T12:00:00.000Z');

function makeCidadao(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

/** Cria dependências mockadas com relógio fixo e prisma configurável. */
function buildDeps(cidadao: ReturnType<typeof makeCidadao> | null) {
  const findUnique = vi.fn(async (_args: unknown) => cidadao);
  const update = vi.fn(async (_args: unknown) => undefined);
  const acessoCreate = vi.fn(async (_args: unknown) => ({ id: 'ac-1' }));

  const deps: Partial<CidadaoLoginDeps> = {
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

  return { deps, findUnique, update, acessoCreate };
}

beforeEach(() => {
  vi.clearAllMocks();
  signTokenMock.mockReturnValue('signed.jwt.token');
  blacklistTokenMock.mockResolvedValue(undefined);
  registrarMock.mockResolvedValue(undefined);
  enviarEmailBloqueioMock.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// loginCidadao
// ---------------------------------------------------------------------------

describe('loginCidadao', () => {
  it('CPF inexistente retorna erro genérico sem vazar existência (Req 2.2)', async () => {
    const { deps, update } = buildDeps(null);

    await expect(loginCidadao(CPF, 'qualquer', false, IP, deps)).rejects.toMatchObject({
      statusCode: 401,
      code: ErrorCodes.INVALID_CREDENTIALS,
      message: 'CPF ou senha inválidos',
    });
    expect(update).not.toHaveBeenCalled();
    expect(bcryptCompareMock).not.toHaveBeenCalled();
  });

  it('conta não ativada é rejeitada com ACCOUNT_NOT_ACTIVATED (Req 1.9)', async () => {
    const { deps } = buildDeps(makeCidadao({ ativo: false }));

    let caught: unknown;
    try {
      await loginCidadao(CPF, 'qualquer', false, IP, deps);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    const appErr = caught as AppError;
    expect(appErr.statusCode).toBe(403);
    expect(appErr.code).toBe(ErrorCodes.ACCOUNT_NOT_ACTIVATED);
    expect(bcryptCompareMock).not.toHaveBeenCalled();
  });

  it('senha incorreta incrementa o contador de tentativas', async () => {
    const { deps, update } = buildDeps(makeCidadao({ tentativasLogin: 2 }));
    bcryptCompareMock.mockResolvedValue(false);

    await expect(loginCidadao(CPF, 'errada', false, IP, deps)).rejects.toMatchObject({
      code: ErrorCodes.INVALID_CREDENTIALS,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'cid-1' },
      data: { tentativasLogin: 3 },
    });
    expect(enviarEmailBloqueioMock).not.toHaveBeenCalled();
  });

  it('5ª tentativa incorreta bloqueia por 15min, zera o contador e notifica por e-mail (Req 2.3)', async () => {
    const { deps, update } = buildDeps(makeCidadao({ tentativasLogin: MAX_TENTATIVAS - 1 }));
    bcryptCompareMock.mockResolvedValue(false);

    await expect(loginCidadao(CPF, 'errada', false, IP, deps)).rejects.toMatchObject({
      code: ErrorCodes.INVALID_CREDENTIALS,
    });

    expect(update).toHaveBeenCalledTimes(1);
    const updateArg = update.mock.calls[0][0] as {
      where: { id: string };
      data: { tentativasLogin: number; bloqueadoAte: Date };
    };
    expect(updateArg.where).toEqual({ id: 'cid-1' });
    expect(updateArg.data.tentativasLogin).toBe(0);
    expect(updateArg.data.bloqueadoAte).toBeInstanceOf(Date);
    const deltaMs = updateArg.data.bloqueadoAte.getTime() - NOW.getTime();
    expect(deltaMs).toBe(BLOQUEIO_MINUTOS * 60_000);

    // Notificação por e-mail ao endereço cadastrado.
    expect(enviarEmailBloqueioMock).toHaveBeenCalledWith(
      { nome: 'Maria Silva', email: 'maria@example.com' },
      BLOQUEIO_MINUTOS,
    );
  });

  it('falha ao notificar bloqueio não interrompe o fluxo (ainda lança credenciais)', async () => {
    const { deps } = buildDeps(makeCidadao({ tentativasLogin: MAX_TENTATIVAS - 1 }));
    bcryptCompareMock.mockResolvedValue(false);
    enviarEmailBloqueioMock.mockRejectedValue(new Error('smtp down'));

    await expect(loginCidadao(CPF, 'errada', false, IP, deps)).rejects.toMatchObject({
      code: ErrorCodes.INVALID_CREDENTIALS,
    });
  });

  it('conta bloqueada é rejeitada com o tempo restante em minutos (Req 2.4)', async () => {
    const bloqueadoAte = new Date(NOW.getTime() + 8 * 60_000);
    const { deps } = buildDeps(makeCidadao({ bloqueadoAte }));

    let caught: unknown;
    try {
      await loginCidadao(CPF, 'qualquer', false, IP, deps);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    const appErr = caught as AppError;
    expect(appErr.statusCode).toBe(429);
    expect(appErr.code).toBe(ErrorCodes.ACCOUNT_LOCKED);
    expect(appErr.message).toMatch(/8 minuto/);
    expect(bcryptCompareMock).not.toHaveBeenCalled();
  });

  it('login com sucesso zera contadores, emite token e registra acesso + auditoria', async () => {
    const { deps, update, acessoCreate } = buildDeps(makeCidadao({ tentativasLogin: 3 }));
    bcryptCompareMock.mockResolvedValue(true);

    const result = await loginCidadao(CPF, 'correta', false, IP, deps);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'cid-1' },
      data: { tentativasLogin: 0, bloqueadoAte: null },
    });

    expect(signTokenMock).toHaveBeenCalledWith(
      { sub: 'cid-1', role: 'cidadao' },
      { longLived: false },
    );

    expect(acessoCreate).toHaveBeenCalledWith({
      data: { cidadaoId: 'cid-1', enderecoIp: IP },
    });
    expect(registrarMock).toHaveBeenCalledTimes(1);

    expect(result).toEqual({
      requires2fa: false,
      token: 'signed.jwt.token',
      cidadao: { id: 'cid-1', nome: 'Maria Silva' },
    });
  });

  it('sucesso com doisFatoresAtivo retorna requires2fa sem emitir token (Req 2.5)', async () => {
    const { deps, acessoCreate } = buildDeps(makeCidadao({ doisFatoresAtivo: true }));
    bcryptCompareMock.mockResolvedValue(true);

    const result = await loginCidadao(CPF, 'correta', false, IP, deps);

    expect(result).toEqual({ requires2fa: true, cidadaoId: 'cid-1' });
    expect(signTokenMock).not.toHaveBeenCalled();
    expect(acessoCreate).not.toHaveBeenCalled();
    expect(registrarMock).not.toHaveBeenCalled();
  });

  it('manterConectado emite token de longa duração (Req 2.7)', async () => {
    const { deps } = buildDeps(makeCidadao());
    bcryptCompareMock.mockResolvedValue(true);

    await loginCidadao(CPF, 'correta', true, IP, deps);

    expect(signTokenMock).toHaveBeenCalledWith(
      { sub: 'cid-1', role: 'cidadao' },
      { longLived: true },
    );
  });
});

// ---------------------------------------------------------------------------
// logoutCidadao
// ---------------------------------------------------------------------------

describe('logoutCidadao', () => {
  it('adiciona o jti à blacklist com a expiração informada', async () => {
    await logoutCidadao('jti-123', 1_700_000_000, {
      revogarToken: blacklistTokenMock as never,
    });
    expect(blacklistTokenMock).toHaveBeenCalledWith('jti-123', 1_700_000_000);
  });
});
