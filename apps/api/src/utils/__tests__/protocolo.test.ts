import { describe, it, expect } from 'vitest';
import { gerarProtocolo } from '../protocolo.js';

/**
 * Minimal in-memory Redis mock exposing only the incr/expire commands used by
 * gerarProtocolo. INCR is atomic per-key; expire is a no-op we can assert on.
 */
class FakeRedis {
  private store = new Map<string, number>();
  public expireCalls: Array<{ key: string; seconds: number }> = [];

  async incr(key: string): Promise<number> {
    const next = (this.store.get(key) ?? 0) + 1;
    this.store.set(key, next);
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.expireCalls.push({ key, seconds });
    return 1;
  }
}

describe('gerarProtocolo', () => {
  it('generates a protocol matching the AAAA-NNNNN format', async () => {
    const redis = new FakeRedis();
    const protocolo = await gerarProtocolo(redis, new Date(2025, 2, 10));
    expect(protocolo).toMatch(/^\d{4}-\d{5}$/);
    expect(protocolo).toBe('2025-00001');
  });

  it('uses the year-scoped key and sets a 2-year TTL', async () => {
    const redis = new FakeRedis();
    await gerarProtocolo(redis, new Date(2025, 0, 1));
    expect(redis.expireCalls).toEqual([{ key: 'protocolo:seq:2025', seconds: 63_072_000 }]);
  });

  it('increments sequential numbers on successive calls within a year', async () => {
    const redis = new FakeRedis();
    const now = new Date(2025, 5, 15);
    const p1 = await gerarProtocolo(redis, now);
    const p2 = await gerarProtocolo(redis, now);
    const p3 = await gerarProtocolo(redis, now);
    expect(p1).toBe('2025-00001');
    expect(p2).toBe('2025-00002');
    expect(p3).toBe('2025-00003');
  });

  it('resets the sequence per year (separate keys)', async () => {
    const redis = new FakeRedis();
    const p2024 = await gerarProtocolo(redis, new Date(2024, 11, 31));
    const p2025 = await gerarProtocolo(redis, new Date(2025, 0, 1));
    expect(p2024).toBe('2024-00001');
    expect(p2025).toBe('2025-00001');
  });

  it('produces unique protocols across many concurrent calls', async () => {
    const redis = new FakeRedis();
    const now = new Date(2025, 0, 1);
    const count = 500;
    const protocolos = await Promise.all(
      Array.from({ length: count }, () => gerarProtocolo(redis, now)),
    );
    const unique = new Set(protocolos);
    expect(unique.size).toBe(count);
    protocolos.forEach((p) => expect(p).toMatch(/^\d{4}-\d{5}$/));
  });
});
