import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCodes } from '@auditar/shared';

// ---------------------------------------------------------------------------
// Mocks dos módulos carregados no import do serviço (config + email helper).
// Substituídos para não abrir conexões reais nem carregar `@prisma/client`.
// ---------------------------------------------------------------------------

vi.mock('../../../config/database.js', () => ({ prisma: {} }));
vi.mock('../../../config/redis.js', () => ({ redis: {} }));
vi.mock('../auth.recuperacao.email.js', () => ({
  enviarEmailRecuperacao: vi.fn(async () => undefined),
}));

// Mock bcrypt para hashing determinístico e rápido.
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(async (senha: string) => `hashed:${senha}`),
    compare: vi.fn(async () => true),
  },
}));

import {
  solicitarRecuperacao,
  redefinirSenha,
  montarChaveReset,
  RESET_TOKEN_TTL_SECONDS,
  type RecuperacaoDeps,
} from '../auth.recuperacao.service.js';
import { AppError } from '../../../utils/errors.js';

/**
 * Redis fake baseado em Map, respeitando a assinatura usada pelo serviço:
 * `set(key, value, 'EX', ttl)`, `get(key)`, `del(key)`.
 */
function buildFakeRedis() {
  const store = new Map<string, string>();
  const set = vi.fn(async (key: string, value: string, _mode?: string, _ttl?: number) => {
    store.set(key, value);
    return 'OK';
  });
  const get = vi.fn(async (key: string) => store.get(key) ?? null);
  const del = vi.fn(async (key: string) => (store.delete(key) ? 1 : 0));
  return { redis: { set, get, del }, store };
}

/** Cria dependências mockadas com um gerador de token fixo. */
function buildDeps(overrides: Partial<RecuperacaoDeps> = {}) {
  const { redis, store } = buildFakeRedis();
  const findFirst = vi.fn(async () => null);
  const update = vi.fn(async () => ({ id: 'cid-1' }));
  const enviarEmail = vi.fn(async () => undefined);

  const deps: Partial<RecuperacaoDeps> = {
    prisma: { cidadao: { findFirst, update } } as any,
    redis: redis as any,
    enviarEmail,
    gerarToken: () => 'token-fixo-uuid',
    ...overrides,
  };

  return { deps, mocks: { findFirst, update, enviarEmail, redis }, store };
}

describe('solicitarRecuperacao', () => {
  beforeEach(() => vi.clearAllMocks());

  it('não envia e-mail nem lança erro quando o e-mail é desconhecido (sem enumeração — Req 7.3)', async () => {
    const { deps, mocks, store } = buildDeps();
    mocks.findFirst.mockResolvedValueOnce(null);

    await expect(solicitarRecuperacao('naoexiste@example.com', deps)).resolves.toBeUndefined();
    expect(mocks.enviarEmail).not.toHaveBeenCalled();
    expect(mocks.redis.set).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('armazena token no Redis com TTL de 1h e envia e-mail quando o e-mail existe (Req 7.3)', async () => {
    const { deps, mocks, store } = buildDeps();
    mocks.findFirst.mockResolvedValueOnce({ id: 'cid-1', nome: 'Maria', email: 'maria@example.com' });

    await solicitarRecuperacao('Maria@Example.com', deps);

    // Token armazenado com EX 3600 sob a chave reset:senha:{token}.
    expect(mocks.redis.set).toHaveBeenCalledWith(
      montarChaveReset('token-fixo-uuid'),
      'cid-1',
      'EX',
      RESET_TOKEN_TTL_SECONDS,
    );
    expect(RESET_TOKEN_TTL_SECONDS).toBe(3600);
    expect(store.get(montarChaveReset('token-fixo-uuid'))).toBe('cid-1');

    // E-mail enviado com o token gerado.
    expect(mocks.enviarEmail).toHaveBeenCalledWith(
      { nome: 'Maria', email: 'maria@example.com' },
      'token-fixo-uuid',
    );
  });
});

describe('redefinirSenha', () => {
  beforeEach(() => vi.clearAllMocks());

  it('atualiza o hash da senha e remove o token com token válido (Req 7.4)', async () => {
    const { deps, mocks, store } = buildDeps();
    // Simula token válido no Redis.
    store.set(montarChaveReset('token-fixo-uuid'), 'cid-1');

    await redefinirSenha('token-fixo-uuid', 'novaSenha123', deps);

    expect(mocks.update).toHaveBeenCalledTimes(1);
    const call = mocks.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'cid-1' });
    expect(call.data.senhaHash).toBe('hashed:novaSenha123');
    // Desbloqueia a conta.
    expect(call.data.tentativasLogin).toBe(0);
    expect(call.data.bloqueadoAte).toBeNull();

    // Token removido (uso único).
    expect(mocks.redis.del).toHaveBeenCalledWith(montarChaveReset('token-fixo-uuid'));
    expect(store.has(montarChaveReset('token-fixo-uuid'))).toBe(false);
  });

  it('rejeita token ausente/expirado com TOKEN_EXPIRED (Req 7.4)', async () => {
    const { deps, mocks } = buildDeps();
    // Nada armazenado no Redis => get retorna null.

    await expect(redefinirSenha('inexistente', 'novaSenha123', deps)).rejects.toMatchObject({
      code: ErrorCodes.TOKEN_EXPIRED,
    });
    await expect(redefinirSenha('inexistente', 'novaSenha123', deps)).rejects.toBeInstanceOf(AppError);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejeita nova senha muito curta (< 8 caracteres — Req 7.3)', async () => {
    const { deps, mocks, store } = buildDeps();
    store.set(montarChaveReset('token-fixo-uuid'), 'cid-1');

    await expect(redefinirSenha('token-fixo-uuid', 'curta', deps)).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION_ERROR,
      field: 'novaSenha',
    });
    expect(mocks.update).not.toHaveBeenCalled();
    // Token não consumido em caso de falha de validação.
    expect(mocks.redis.del).not.toHaveBeenCalled();
  });

  it('garante uso único: a segunda tentativa com o mesmo token falha (Req 7.4)', async () => {
    const { deps, mocks, store } = buildDeps();
    store.set(montarChaveReset('token-fixo-uuid'), 'cid-1');

    // Primeira redefinição consome o token.
    await redefinirSenha('token-fixo-uuid', 'novaSenha123', deps);
    expect(mocks.update).toHaveBeenCalledTimes(1);

    // Segunda tentativa com o mesmo token deve falhar.
    await expect(redefinirSenha('token-fixo-uuid', 'outraSenha456', deps)).rejects.toMatchObject({
      code: ErrorCodes.TOKEN_EXPIRED,
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
