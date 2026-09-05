// Feature: auditar-sistema-gestao, Property 2: Unicidade de CPF no Cadastro
//
// Property 2: Unicidade de CPF no Cadastro
// For any CPF already associated with an existing account (active or inactive),
// a registration attempt with that same CPF must be rejected, and the total
// number of accounts must remain unchanged.
//
// Validates: Requirements 1.3

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { ErrorCodes } from '@auditar/shared';

// ---------------------------------------------------------------------------
// Mocks das dependências carregadas no import do serviço. `prisma`/`redis` de
// config e o mailer são substituídos para não abrir conexões reais nem carregar
// o `@prisma/client`/`ioredis` (não resolvidos no ambiente de teste). O bcrypt é
// mockado para manter os 100+ runs rápidos.
// ---------------------------------------------------------------------------

vi.mock('../../../config/database.js', () => ({ prisma: {} }));
vi.mock('../../../config/redis.js', () => ({ redis: {} }));
vi.mock('../auth.cidadao.email.js', () => ({
  enviarEmailAtivacao: vi.fn(async () => undefined),
}));
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(async (senha: string) => `hashed:${senha}`),
    compare: vi.fn(async () => true),
  },
}));

import { validarCPF, desformatarCPF } from '../../../utils/cpf.js';
import { registrarCidadao, type CidadaoAuthDeps } from '../auth.cidadao.service.js';
import type { RegistrarInput } from '../auth.cidadao.schema.js';

// ---------------------------------------------------------------------------
// CPF generation helper — Receita Federal check-digit algorithm
// ---------------------------------------------------------------------------

/**
 * Computes the two verifier digits for a 9-digit CPF base and returns the
 * full 11-digit CPF string. Guarantees a value that passes `validarCPF`
 * (all-same-digit sequences are excluded by the generator below).
 */
function gerarCpfValido(base9: string): string {
  const digits = base9.split('').map((d) => parseInt(d, 10));

  // First check digit: weights 10..2 over the first 9 digits.
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += digits[i]! * (10 - i);
  }
  let d1 = (sum * 10) % 11;
  if (d1 === 10 || d1 === 11) d1 = 0;

  // Second check digit: weights 11..2 over the first 10 digits.
  const withD1 = [...digits, d1];
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += withD1[i]! * (11 - i);
  }
  let d2 = (sum * 10) % 11;
  if (d2 === 10 || d2 === 11) d2 = 0;

  return `${base9}${d1}${d2}`;
}

// ---------------------------------------------------------------------------
// In-memory fake prisma `cidadao` store
// ---------------------------------------------------------------------------

interface StoredCidadao {
  id: string;
  nome: string;
  cpf: string;
  email: string;
}

interface FakeStore {
  registros: StoredCidadao[];
  prisma: CidadaoAuthDeps['prisma'];
  size(): number;
}

function criarFakeStore(): FakeStore {
  const registros: StoredCidadao[] = [];
  let seq = 0;

  const prisma = {
    cidadao: {
      // Matches the service's findFirst({ where: { OR: [{cpf},{email}] } }).
      async findFirst(args: any) {
        const or = args?.where?.OR ?? [];
        const found = registros.find((r) =>
          or.some((cond: any) => {
            if (cond.cpf !== undefined) return r.cpf === cond.cpf;
            if (cond.email !== undefined) return r.email === cond.email;
            return false;
          }),
        );
        if (!found) return null;
        return { id: found.id, cpf: found.cpf };
      },
      async create(args: any) {
        const data = args.data;
        const registro: StoredCidadao = {
          id: `id-${++seq}`,
          nome: data.nome,
          cpf: data.cpf,
          email: data.email,
        };
        registros.push(registro);
        return { id: registro.id, nome: registro.nome, email: registro.email };
      },
    },
  } as unknown as CidadaoAuthDeps['prisma'];

  return {
    registros,
    prisma,
    size() {
      return registros.length;
    },
  };
}

// ---------------------------------------------------------------------------
// Stub deps (everything except prisma is inert for the registration flow)
// ---------------------------------------------------------------------------

function criarDeps(prisma: CidadaoAuthDeps['prisma']): Partial<CidadaoAuthDeps> {
  let tok = 0;
  return {
    prisma,
    redis: {
      incr: async () => 1,
      expire: async () => 1,
    },
    enviarEmail: async () => {},
    gerarToken: () => `tok-${++tok}`,
    agora: () => new Date(),
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** A valid CPF built from 9 base digits that are not all identical. */
const cpfValidoArb: fc.Arbitrary<string> = fc
  .stringMatching(/^\d{9}$/)
  .filter((base9) => !/^(\d)\1{8}$/.test(base9))
  .map(gerarCpfValido)
  .filter((cpf) => validarCPF(cpf));

/** A registration DTO given a fixed CPF and a discriminator for uniqueness. */
function dtoComCpf(cpf: string, disc: string): RegistrarInput {
  const sufixo = disc.replace(/\W/g, '').slice(0, 12) || 'x';
  return {
    nome: `Cidadao ${sufixo}`,
    cpf,
    email: `user.${sufixo}.${cpf}@example.com`,
    telefone: '11987654321',
    logradouro: 'Rua das Flores',
    numero: '100',
    cep: '01001000',
    cidade: 'Sao Paulo',
    estado: 'SP',
    senha: 'senhaForte123',
  };
}

// ---------------------------------------------------------------------------
// Property 2
// ---------------------------------------------------------------------------

describe('Property 2: Unicidade de CPF no Cadastro (Req 1.3)', () => {
  it('rejects a second registration with the same CPF and keeps the account count unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        cpfValidoArb,
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        async (cpf, disc1, disc2) => {
          // Two distinct DTOs sharing the SAME cpf (different email/nome).
          const dto1 = dtoComCpf(cpf, `a${disc1}`);
          const dto2 = dtoComCpf(cpf, `b${disc2}`);

          const store = criarFakeStore();
          const deps = criarDeps(store.prisma);

          // 1. First registration succeeds → store size 1.
          const primeiro = await registrarCidadao(dto1, deps);
          expect(primeiro.id).toBeTruthy();
          expect(store.size()).toBe(1);

          // 2. Second registration with the SAME cpf must be rejected.
          let rejeitou = false;
          try {
            await registrarCidadao(dto2, deps);
          } catch (err) {
            rejeitou = true;
            expect((err as { code?: string }).code).toBe(ErrorCodes.CPF_DUPLICADO);
          }
          expect(rejeitou).toBe(true);

          // 3. Total number of accounts remains unchanged.
          expect(store.size()).toBe(1);

          // The stored account is still the first one.
          expect(store.registros[0]!.cpf).toBe(desformatarCPF(cpf));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('sanity control: two distinct CPFs both register successfully (store size 2)', async () => {
    await fc.assert(
      fc.asyncProperty(cpfValidoArb, cpfValidoArb, async (cpfA, cpfB) => {
        // Only meaningful when the two CPFs actually differ.
        fc.pre(desformatarCPF(cpfA) !== desformatarCPF(cpfB));

        const store = criarFakeStore();
        const deps = criarDeps(store.prisma);

        await registrarCidadao(dtoComCpf(cpfA, 'a'), deps);
        await registrarCidadao(dtoComCpf(cpfB, 'b'), deps);

        expect(store.size()).toBe(2);
      }),
      { numRuns: 100 },
    );
  });
});
