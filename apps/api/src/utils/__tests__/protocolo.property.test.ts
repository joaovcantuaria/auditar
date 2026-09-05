// Feature: auditar-sistema-gestao, Property 4: Formato e Unicidade do Protocolo
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { gerarProtocolo } from '../protocolo.js';

/**
 * Minimal in-memory Redis mock exposing only the incr/expire commands used by
 * gerarProtocolo. INCR is atomic per-key; expire is a no-op we accept and count.
 * Mirrors the FakeRedis used in protocolo.test.ts.
 */
class FakeRedis {
  private store = new Map<string, number>();

  async incr(key: string): Promise<number> {
    const next = (this.store.get(key) ?? 0) + 1;
    this.store.set(key, next);
    return next;
  }

  async expire(_key: string, _seconds: number): Promise<number> {
    return 1;
  }
}

/**
 * Generates `count` protocols for the given date using a fresh in-memory Redis.
 */
async function gerarLote(count: number, now: Date): Promise<string[]> {
  const redis = new FakeRedis();
  const protocolos: string[] = [];
  for (let i = 0; i < count; i++) {
    protocolos.push(await gerarProtocolo(redis, now));
  }
  return protocolos;
}

describe('Property 4: Formato e Unicidade do Protocolo', () => {
  // Property A — format: every generated protocol matches AAAA-NNNNN.
  // Validates: Requirements 4.8
  it('Property A: todo protocolo gerado corresponde ao formato AAAA-NNNNN', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 300 }), async (count) => {
        const protocolos = await gerarLote(count, new Date(2025, 0, 1));
        for (const p of protocolos) {
          expect(p).toMatch(/^\d{4}-\d{5}$/);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Property B — uniqueness: no two distinct processes share the same protocol.
  // Validates: Requirements 4.8
  it('Property B: nenhum protocolo se repete no mesmo conjunto', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 300 }), async (count) => {
        const protocolos = await gerarLote(count, new Date(2025, 0, 1));
        expect(new Set(protocolos).size).toBe(protocolos.length);
      }),
      { numRuns: 100 },
    );
  });

  // Property C — year prefix: every protocol begins with the 4-digit year.
  // Validates: Requirements 4.8
  it('Property C: todo protocolo inicia com o ano de 4 dígitos', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2000, max: 2100 }),
        fc.integer({ min: 1, max: 300 }),
        async (ano, count) => {
          const protocolos = await gerarLote(count, new Date(ano, 0, 1));
          const prefixo = String(ano);
          for (const p of protocolos) {
            expect(p.startsWith(prefixo)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property D — formato e unicidade com PREFIXO (Req. 4.8a–4.8c).
  // For any conjunto de protocolos com e sem prefixo (2–5 letras maiúsculas):
  //   1. todo protocolo casa com ^([A-Z]{2,5}-)?\d{4}-\d{5,}$;
  //   2. a sequência é independente por (prefixo, ano);
  //   3. não há duplicatas mesmo em geração concorrente (mesma instância Redis).
  // Validates: Requirements 4.8, 4.8a, 4.8b, 4.8c, 23.5
  // -------------------------------------------------------------------------

  const FORMATO_COM_PREFIXO = /^([A-Z]{2,5}-)?\d{4}-\d{5,}$/;

  // Gerador de siglas: 2 a 5 letras maiúsculas.
  const prefixoArb = fc
    .array(
      fc.integer({ min: 65, max: 90 }).map((c) => String.fromCharCode(c)),
      { minLength: 2, maxLength: 5 },
    )
    .map((letras) => letras.join(''));

  // Escopo = prefixo (string) ou undefined (sem prefixo, retrocompatível).
  const escopoArb = fc.option(prefixoArb, { nil: undefined });

  it('Property D: todo protocolo (com ou sem prefixo) casa com [PREFIXO-]AAAA-NNNNN', async () => {
    await fc.assert(
      fc.asyncProperty(escopoArb, fc.integer({ min: 1, max: 200 }), async (prefixo, count) => {
        const redis = new FakeRedis();
        const now = new Date(2026, 0, 1);
        for (let i = 0; i < count; i++) {
          const p = await gerarProtocolo(redis, prefixo, now);
          expect(p).toMatch(FORMATO_COM_PREFIXO);
          if (prefixo) {
            expect(p.startsWith(`${prefixo}-`)).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Property D: a sequência é independente por (prefixo, ano)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Dois prefixos distintos + o escopo sem prefixo devem numerar do 1.
        fc.uniqueArray(prefixoArb, { minLength: 2, maxLength: 2 }),
        async ([prefA, prefB]) => {
          const redis = new FakeRedis();
          const now = new Date(2026, 0, 1);

          const a1 = await gerarProtocolo(redis, prefA, now);
          const b1 = await gerarProtocolo(redis, prefB, now);
          const semPrefixo1 = await gerarProtocolo(redis, now); // escopo próprio
          const a2 = await gerarProtocolo(redis, prefA, now);

          // Cada escopo mantém sua própria contagem começando em 1.
          expect(a1).toBe(`${prefA}-2026-00001`);
          expect(b1).toBe(`${prefB}-2026-00001`);
          expect(semPrefixo1).toBe('2026-00001');
          expect(a2).toBe(`${prefA}-2026-00002`);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property D: não há duplicatas em geração concorrente por escopo', async () => {
    await fc.assert(
      fc.asyncProperty(escopoArb, fc.integer({ min: 2, max: 300 }), async (prefixo, count) => {
        const redis = new FakeRedis();
        const now = new Date(2026, 0, 1);
        const protocolos = await Promise.all(
          Array.from({ length: count }, () => gerarProtocolo(redis, prefixo, now)),
        );
        expect(new Set(protocolos).size).toBe(protocolos.length);
        for (const p of protocolos) {
          expect(p).toMatch(FORMATO_COM_PREFIXO);
        }
      }),
      { numRuns: 100 },
    );
  });
});
