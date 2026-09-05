import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCodes } from '@auditar/shared';

// ---------------------------------------------------------------------------
// Mocks dos módulos carregados no import do serviço, para não abrir conexões
// reais (Redis/SMTP) nem resolver `@prisma/client` no ambiente de teste.
// O comportamento é exercido via injeção de dependências (parâmetro `deps`).
// ---------------------------------------------------------------------------

vi.mock('../../../config/database.js', () => ({ prisma: {} }));
vi.mock('../../../config/redis.js', () => ({ redis: {} }));
vi.mock('../../../config/mailer.js', () => ({
  mailer: { sendMail: vi.fn(async () => undefined) },
  fromAddress: 'Auditar <no-reply@example.com>',
}));
vi.mock('../../../lib/jwt.js', () => ({
  signToken: vi.fn(() => 'jwt-token'),
}));
vi.mock('../../auditoria/auditoria.service.js', () => ({ registrar: vi.fn(async () => undefined) }));

import {
  gerarCodigo2fa,
  verificar2fa,
  ativar2fa,
  desativar2fa,
  gerarCodigoNumerico,
  chaveCodigo2fa,
  CODIGO_2FA_TTL_SECONDS,
  type Cidadao2faDeps,
} from '../auth.2fa.service.js';
import { AppError } from '../../../utils/errors.js';

/** Redis fake baseado em Map, com suporte a `set(EX)`, `get`, `del`. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    set: vi.fn(async (key: string, value: string, _ex?: string, _ttl?: number) => {
      store.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
}

interface BuildOpts {
  cidadao?: Record<string, unknown> | null;
  codigo?: string;
}

function buildDeps(opts: BuildOpts = {}) {
  const cidadao =
    opts.cidadao === undefined
      ? {
          id: 'cid-1',
          nome: 'Maria',
          email: 'maria@example.com',
          telefone: '11987654321',
          doisFatoresAtivo: true,
          doisFatoresCanal: 'email',
        }
      : opts.cidadao;

  const findUnique = vi.fn(async () => cidadao as any);
  const update = vi.fn(async () => ({ id: 'cid-1' }));
  const acessoCreate = vi.fn(async () => ({ id: 'acc-1' }));

  const redis = fakeRedis();
  const signToken = vi.fn((_payload: unknown, _options?: unknown) => 'jwt-token');
  const registrarAuditoria = vi.fn(async (_dto: unknown) => undefined);
  const enviarCodigo = vi.fn(async (_dest: unknown, _canal: unknown, _codigo: unknown) => undefined);
  const gerarCodigo = vi.fn(() => opts.codigo ?? '123456');

  const deps: Partial<Cidadao2faDeps> = {
    prisma: {
      cidadao: { findUnique, update } as any,
      acessoHistorico: { create: acessoCreate } as any,
    } as any,
    redis: redis as any,
    signToken: signToken as any,
    registrarAuditoria: registrarAuditoria as any,
    enviarCodigo: enviarCodigo as any,
    gerarCodigo,
  };

  return {
    deps,
    mocks: { findUnique, update, acessoCreate, redis, signToken, registrarAuditoria, enviarCodigo, gerarCodigo },
  };
}

describe('gerarCodigoNumerico', () => {
  it('gera sempre 6 dígitos numéricos com zero à esquerda', () => {
    for (let i = 0; i < 200; i++) {
      const codigo = gerarCodigoNumerico();
      expect(codigo).toMatch(/^\d{6}$/);
    }
  });
});

describe('gerarCodigo2fa (Req 2.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('armazena código de 6 dígitos com TTL de 600s e envia pelo canal', async () => {
    const { deps, mocks } = buildDeps({ codigo: '654321' });

    const result = await gerarCodigo2fa('cid-1', undefined, deps);

    // Armazenou no Redis com a chave e TTL corretos.
    expect(mocks.redis.set).toHaveBeenCalledWith(
      chaveCodigo2fa('cid-1'),
      '654321',
      'EX',
      CODIGO_2FA_TTL_SECONDS,
    );
    expect(CODIGO_2FA_TTL_SECONDS).toBe(600);
    expect(mocks.redis.store.get(chaveCodigo2fa('cid-1'))).toBe('654321');

    // Enviou pelo canal preferido (email) com o código.
    expect(mocks.enviarCodigo).toHaveBeenCalledTimes(1);
    const [dest, canal, codigo] = mocks.enviarCodigo.mock.calls[0];
    expect(canal).toBe('email');
    expect(codigo).toBe('654321');
    expect((dest as any).email).toBe('maria@example.com');

    // Destino mascarado no retorno.
    expect(result.canal).toBe('email');
    expect(result.destino).toContain('@example.com');
    expect(result.destino).not.toBe('maria@example.com');
  });

  it('usa o canal explícito quando informado (sms)', async () => {
    const { deps, mocks } = buildDeps();
    const result = await gerarCodigo2fa('cid-1', 'sms', deps);
    const [, canal] = mocks.enviarCodigo.mock.calls[0];
    expect(canal).toBe('sms');
    expect(result.canal).toBe('sms');
  });

  it('rejeita quando a conta não tem 2FA ativo', async () => {
    const { deps, mocks } = buildDeps({
      cidadao: {
        id: 'cid-1',
        nome: 'Maria',
        email: 'maria@example.com',
        telefone: '11987654321',
        doisFatoresAtivo: false,
        doisFatoresCanal: null,
      },
    });
    await expect(gerarCodigo2fa('cid-1', undefined, deps)).rejects.toMatchObject({
      code: ErrorCodes.INVALID_CREDENTIALS,
    });
    expect(mocks.redis.set).not.toHaveBeenCalled();
    expect(mocks.enviarCodigo).not.toHaveBeenCalled();
  });

  it('rejeita quando a conta não existe', async () => {
    const { deps } = buildDeps({ cidadao: null });
    await expect(gerarCodigo2fa('cid-x', undefined, deps)).rejects.toBeInstanceOf(AppError);
  });

  it('rejeita SMS sem telefone cadastrado', async () => {
    const { deps, mocks } = buildDeps({
      cidadao: {
        id: 'cid-1',
        nome: 'Maria',
        email: 'maria@example.com',
        telefone: null,
        doisFatoresAtivo: true,
        doisFatoresCanal: 'email',
      },
    });
    await expect(gerarCodigo2fa('cid-1', 'sms', deps)).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION_ERROR,
    });
    expect(mocks.redis.set).not.toHaveBeenCalled();
  });
});

describe('verificar2fa (Req 2.5, 2.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('com código correto emite token, remove o código e registra o acesso', async () => {
    const { deps, mocks } = buildDeps();
    // Semeia o código no Redis.
    await mocks.redis.set(chaveCodigo2fa('cid-1'), '123456');

    const result = await verificar2fa('cid-1', '123456', false, '10.0.0.1', deps);

    expect(result.token).toBe('jwt-token');
    expect(result.cidadao).toEqual({ id: 'cid-1', nome: 'Maria' });

    // Código de uso único removido após validar.
    expect(mocks.redis.del).toHaveBeenCalledWith(chaveCodigo2fa('cid-1'));
    expect(mocks.redis.store.has(chaveCodigo2fa('cid-1'))).toBe(false);

    // Histórico + auditoria de login_2fa.
    expect(mocks.acessoCreate).toHaveBeenCalledTimes(1);
    expect(mocks.registrarAuditoria).toHaveBeenCalledTimes(1);
    expect(mocks.registrarAuditoria.mock.calls[0][0]).toMatchObject({ tipoAcao: 'login_2fa' });

    // Token de curta duração quando manterConectado=false.
    expect(mocks.signToken).toHaveBeenCalledWith(
      { sub: 'cid-1', role: 'cidadao' },
      { longLived: false },
    );
  });

  it('manterConectado=true emite token de longa duração', async () => {
    const { deps, mocks } = buildDeps();
    await mocks.redis.set(chaveCodigo2fa('cid-1'), '123456');

    await verificar2fa('cid-1', '123456', true, '10.0.0.1', deps);

    expect(mocks.signToken).toHaveBeenCalledWith(
      { sub: 'cid-1', role: 'cidadao' },
      { longLived: true },
    );
  });

  it('código expirado/ausente é rejeitado com TOKEN_EXPIRED e NÃO altera contadores', async () => {
    const { deps, mocks } = buildDeps();
    // Redis vazio => código expirado/ausente.

    await expect(verificar2fa('cid-1', '123456', false, '10.0.0.1', deps)).rejects.toMatchObject({
      code: ErrorCodes.TOKEN_EXPIRED,
    });

    // Req 2.6: nenhuma escrita no cidadão (sem incremento de bloqueio por senha).
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.acessoCreate).not.toHaveBeenCalled();
    expect(mocks.signToken).not.toHaveBeenCalled();
  });

  it('código incorreto é rejeitado com INVALID_CREDENTIALS e NÃO altera contadores', async () => {
    const { deps, mocks } = buildDeps();
    await mocks.redis.set(chaveCodigo2fa('cid-1'), '123456');

    await expect(verificar2fa('cid-1', '000000', false, '10.0.0.1', deps)).rejects.toMatchObject({
      code: ErrorCodes.INVALID_CREDENTIALS,
    });

    // Req 2.6: código incorreto não conta para o bloqueio por senha.
    expect(mocks.update).not.toHaveBeenCalled();
    // Código NÃO removido (permanece válido até expirar/uso correto).
    expect(mocks.redis.del).not.toHaveBeenCalled();
    expect(mocks.signToken).not.toHaveBeenCalled();
  });
});

describe('ativar2fa / desativar2fa (Req 2.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ativar2fa liga a flag e define o canal', async () => {
    const { deps, mocks } = buildDeps();
    await ativar2fa('cid-1', 'sms', deps);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'cid-1' },
      data: { doisFatoresAtivo: true, doisFatoresCanal: 'sms' },
    });
  });

  it('desativar2fa desliga a flag e limpa o canal', async () => {
    const { deps, mocks } = buildDeps();
    await desativar2fa('cid-1', deps);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'cid-1' },
      data: { doisFatoresAtivo: false, doisFatoresCanal: null },
    });
  });
});
