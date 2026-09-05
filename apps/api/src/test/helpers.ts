import { vi } from 'vitest';

/**
 * Creates an in-memory mock of the Prisma client with vi.fn() stubs
 * for the models used across tests. Extend as needed per test.
 */
export function createMockPrisma() {
  return {
    cidadao: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    servidor: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    processo: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    auditoriaLog: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  };
}

/**
 * Creates an in-memory mock of ioredis with vi.fn() stubs.
 */
export function createMockRedis() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }),
    incr: vi.fn(async (k: string) => {
      const next = Number(store.get(k) ?? '0') + 1;
      store.set(k, String(next));
      return next;
    }),
    expire: vi.fn(async () => 1),
    del: vi.fn(async (k: string) => { store.delete(k); return 1; }),
    _store: store,
  };
}

/**
 * Entity factory helpers for building test fixtures.
 */
export function makeCidadao(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cid-1',
    nome: 'João da Silva',
    cpf: '52998224725', // valid CPF for testing
    email: 'joao@example.com',
    telefone: '11987654321',
    logradouro: 'Rua Teste',
    numero: '100',
    cep: '01001000',
    cidade: 'São Paulo',
    estado: 'SP',
    senhaHash: '$2a$12$abcdefghijklmnopqrstuv',
    ativo: true,
    emailConfirmado: true,
    tentativasLogin: 0,
    doisFatoresAtivo: false,
    criadoEm: new Date(),
    atualizadoEm: new Date(),
    ...overrides,
  };
}
