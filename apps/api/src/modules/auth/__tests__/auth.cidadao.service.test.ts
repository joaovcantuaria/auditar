import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCodes } from '@auditar/shared';

// ---------------------------------------------------------------------------
// Mocks das dependências carregadas no momento do import do serviço.
// O serviço importa `prisma`/`redis` de config e o mailer via o email helper;
// esses módulos são substituídos para não abrir conexões reais nem carregar o
// `@prisma/client` (que não é resolvido no ambiente de teste).
// ---------------------------------------------------------------------------

vi.mock('../../../config/database.js', () => ({ prisma: {} }));
vi.mock('../../../config/redis.js', () => ({ redis: {} }));
vi.mock('../auth.cidadao.email.js', () => ({
  enviarEmailAtivacao: vi.fn(async () => undefined),
}));

// Mock bcrypt para evitar hashing lento e permitir asserção de "não é o texto puro".
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(async (senha: string) => `hashed:${senha}`),
    compare: vi.fn(async () => true),
  },
}));

import {
  registrarCidadao,
  ativarConta,
  reenviarAtivacao,
  TOKEN_ATIVACAO_TTL_MS,
  MAX_REENVIOS_ATIVACAO,
  REENVIO_WINDOW_SECONDS,
  type CidadaoAuthDeps,
} from '../auth.cidadao.service.js';
import { AppError } from '../../../utils/errors.js';
import type { RegistrarInput } from '../auth.cidadao.schema.js';

// CPF válido conhecido (dígitos verificadores corretos).
const CPF_VALIDO = '52998224725';
const CPF_INVALIDO = '11111111111';

function buildDto(overrides: Partial<RegistrarInput> = {}): RegistrarInput {
  return {
    nome: 'Maria Silva',
    cpf: CPF_VALIDO,
    email: 'maria@example.com',
    telefone: '11987654321',
    logradouro: 'Rua das Flores',
    numero: '100',
    cep: '01234567',
    cidade: 'São Paulo',
    estado: 'SP',
    senha: 'senhaSegura1',
    ...overrides,
  };
}

/** Cria dependências mockadas com um relógio fixo. */
function buildDeps(overrides: Partial<CidadaoAuthDeps> = {}) {
  const now = new Date('2025-01-01T12:00:00.000Z');
  const create = vi.fn(async ({ data }: any) => ({
    id: 'cid-1',
    nome: data.nome,
    email: data.email,
  }));
  const update = vi.fn(async () => ({ id: 'cid-1' }));
  const findFirst = vi.fn(async () => null);
  const incr = vi.fn(async () => 1);
  const expire = vi.fn(async () => 1);
  const enviarEmail = vi.fn(async () => undefined);

  const deps: Partial<CidadaoAuthDeps> = {
    prisma: { cidadao: { findFirst, create, update } } as any,
    redis: { incr, expire } as any,
    enviarEmail,
    gerarToken: () => 'token-fixo-uuid',
    agora: () => now,
    ...overrides,
  };

  return { deps, mocks: { create, update, findFirst, incr, expire, enviarEmail }, now };
}

describe('registrarCidadao', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejeita CPF com dígitos verificadores inválidos (Req 1.2)', async () => {
    const { deps, mocks } = buildDeps();
    await expect(registrarCidadao(buildDto({ cpf: CPF_INVALIDO }), deps)).rejects.toMatchObject({
      code: ErrorCodes.CPF_INVALIDO,
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejeita CPF já cadastrado (Req 1.3)', async () => {
    const { deps, mocks } = buildDeps();
    mocks.findFirst.mockResolvedValueOnce({ id: 'existente', cpf: CPF_VALIDO });

    await expect(registrarCidadao(buildDto(), deps)).rejects.toMatchObject({
      code: ErrorCodes.CPF_DUPLICADO,
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejeita e-mail já cadastrado sem criar a conta', async () => {
    const { deps, mocks } = buildDeps();
    // Registro existente com cpf diferente => conflito de e-mail.
    mocks.findFirst.mockResolvedValueOnce({ id: 'existente', cpf: '00000000000' });

    await expect(registrarCidadao(buildDto(), deps)).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION_ERROR,
      field: 'email',
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('cria conta inativa, faz hash da senha e gera token com expiração de 48h (Req 1.5)', async () => {
    const { deps, mocks, now } = buildDeps();

    const result = await registrarCidadao(buildDto(), deps);

    expect(mocks.create).toHaveBeenCalledTimes(1);
    const data = mocks.create.mock.calls[0][0].data;

    // Conta criada inativa e não confirmada.
    expect(data.ativo).toBe(false);
    expect(data.emailConfirmado).toBe(false);

    // Senha nunca persistida em texto puro.
    expect(data.senhaHash).not.toBe('senhaSegura1');
    expect(data.senhaHash).toBe('hashed:senhaSegura1');

    // CPF normalizado (apenas dígitos).
    expect(data.cpf).toBe(CPF_VALIDO);

    // Token gerado e expiração = agora + 48h.
    expect(data.tokenAtivacao).toBe('token-fixo-uuid');
    expect(data.tokenAtivacaoExpira.getTime()).toBe(now.getTime() + TOKEN_ATIVACAO_TTL_MS);

    // E-mail de ativação enviado com o token.
    expect(mocks.enviarEmail).toHaveBeenCalledWith(
      { nome: 'Maria Silva', email: 'maria@example.com' },
      'token-fixo-uuid',
    );

    // Resultado não expõe a senha e mascara o token.
    expect(result.id).toBe('cid-1');
    expect(result).not.toHaveProperty('senhaHash');
    expect(result.protocoloAtivacao).not.toBe('token-fixo-uuid');
    expect(result.protocoloAtivacao.startsWith('token-fi')).toBe(true);
  });
});

describe('ativarConta', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ativa a conta com token válido dentro do prazo (Req 1.6)', async () => {
    const { deps, mocks, now } = buildDeps();
    mocks.findFirst.mockResolvedValueOnce({
      id: 'cid-1',
      tokenAtivacaoExpira: new Date(now.getTime() + 60_000),
      ativo: false,
    });

    const result = await ativarConta('token-fixo-uuid', deps);

    expect(result.id).toBe('cid-1');
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const data = mocks.update.mock.calls[0][0].data;
    expect(data.ativo).toBe(true);
    expect(data.emailConfirmado).toBe(true);
    expect(data.tokenAtivacao).toBeNull();
    expect(data.tokenAtivacaoExpira).toBeNull();
  });

  it('rejeita token inexistente (Req 1.7)', async () => {
    const { deps, mocks } = buildDeps();
    mocks.findFirst.mockResolvedValueOnce(null);

    await expect(ativarConta('inexistente', deps)).rejects.toMatchObject({
      code: ErrorCodes.TOKEN_EXPIRED,
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejeita token expirado (Req 1.7)', async () => {
    const { deps, mocks, now } = buildDeps();
    mocks.findFirst.mockResolvedValueOnce({
      id: 'cid-1',
      tokenAtivacaoExpira: new Date(now.getTime() - 60_000),
      ativo: false,
    });

    await expect(ativarConta('token-fixo-uuid', deps)).rejects.toBeInstanceOf(AppError);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe('reenviarAtivacao', () => {
  beforeEach(() => vi.clearAllMocks());

  it('não envia e-mail nem lança erro quando a conta não existe / já ativa', async () => {
    const { deps, mocks } = buildDeps();
    mocks.findFirst.mockResolvedValueOnce(null);

    await expect(reenviarAtivacao('naoexiste@example.com', deps)).resolves.toBeUndefined();
    expect(mocks.enviarEmail).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('gera novo token, atualiza expiração e reenvia e-mail dentro do limite', async () => {
    const { deps, mocks, now } = buildDeps();
    mocks.findFirst.mockResolvedValueOnce({ id: 'cid-1', nome: 'Maria', email: 'maria@example.com' });
    mocks.incr.mockResolvedValueOnce(1);

    await reenviarAtivacao('maria@example.com', deps);

    // Janela de 24h configurada na primeira contagem.
    expect(mocks.expire).toHaveBeenCalledWith('ativacao:resend:cid-1', REENVIO_WINDOW_SECONDS);

    const data = mocks.update.mock.calls[0][0].data;
    expect(data.tokenAtivacao).toBe('token-fixo-uuid');
    expect(data.tokenAtivacaoExpira.getTime()).toBe(now.getTime() + TOKEN_ATIVACAO_TTL_MS);
    expect(mocks.enviarEmail).toHaveBeenCalledTimes(1);
  });

  it('bloqueia após exceder o limite de 3 reenvios em 24h (Req 1.8)', async () => {
    const { deps, mocks } = buildDeps();
    mocks.findFirst.mockResolvedValueOnce({ id: 'cid-1', nome: 'Maria', email: 'maria@example.com' });
    // 4ª tentativa (> MAX_REENVIOS_ATIVACAO).
    mocks.incr.mockResolvedValueOnce(MAX_REENVIOS_ATIVACAO + 1);

    await expect(reenviarAtivacao('maria@example.com', deps)).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION_ERROR,
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.enviarEmail).not.toHaveBeenCalled();
  });
});
