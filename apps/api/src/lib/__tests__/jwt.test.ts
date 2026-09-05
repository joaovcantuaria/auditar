import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

// ---------------------------------------------------------------------------
// In-memory Redis mock (createMockRedis pattern)
// Supports the subset used by jwt.ts: get / set (with EX) and TTL expiry.
// ---------------------------------------------------------------------------
function createMockRedis() {
  const store = new Map<string, { value: string; expiresAt: number | null }>();

  return {
    store,
    async get(key: string): Promise<string | null> {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key: string, value: string, mode?: string, ttlSeconds?: number): Promise<'OK'> {
      const expiresAt = mode === 'EX' && ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
      store.set(key, { value, expiresAt });
      return 'OK';
    },
  };
}

const mockRedis = createMockRedis();

vi.mock('../../config/redis.js', () => ({
  get redis() {
    return mockRedis;
  },
}));

// Import after mock registration (vi.mock is hoisted above imports)
const { signToken, verifyToken, blacklistToken, isBlacklisted } = await import('../jwt.js');

describe('jwt.signToken / verifyToken', () => {
  beforeEach(() => {
    mockRedis.store.clear();
  });

  it('roundtrips a servidor payload preserving claims and generating a jti', () => {
    const token = signToken({
      sub: 'user-123',
      role: 'servidor',
      nivel: 5,
      permissions: ['visualizar'],
    });

    const payload = verifyToken(token);

    expect(payload.sub).toBe('user-123');
    expect(payload.role).toBe('servidor');
    expect(payload.nivel).toBe(5);
    expect(payload.permissions).toEqual(['visualizar']);
    expect(typeof payload.jti).toBe('string');
    expect(payload.jti.length).toBeGreaterThan(0);
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
  });

  it('generates unique jti values on each sign', () => {
    const a = verifyToken(signToken({ sub: 'u1', role: 'cidadao' }));
    const b = verifyToken(signToken({ sub: 'u1', role: 'cidadao' }));
    expect(a.jti).not.toBe(b.jti);
  });

  it('applies a longer expiry when longLived is set', () => {
    const shortPayload = verifyToken(signToken({ sub: 'u1', role: 'cidadao' }));
    const longPayload = verifyToken(
      signToken({ sub: 'u1', role: 'cidadao' }, { longLived: true }),
    );
    const shortWindow = shortPayload.exp! - shortPayload.iat!;
    const longWindow = longPayload.exp! - longPayload.iat!;
    expect(longWindow).toBeGreaterThan(shortWindow);
  });

  it('rejects a token with an invalid signature', () => {
    const forged = jwt.sign({ sub: 'x', role: 'cidadao', jti: 'z' }, 'wrong-secret');
    expect(() => verifyToken(forged)).toThrow();
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign(
      { sub: 'x', role: 'cidadao', jti: 'z' },
      process.env.JWT_SECRET!,
      { expiresIn: '-1s' },
    );
    expect(() => verifyToken(expired)).toThrow();
  });
});

describe('jwt blacklist', () => {
  beforeEach(() => {
    mockRedis.store.clear();
  });

  it('reports a jti as not blacklisted by default', async () => {
    expect(await isBlacklisted('some-jti')).toBe(false);
  });

  it('marks a jti as blacklisted after blacklistToken', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    await blacklistToken('jti-1', exp);
    expect(await isBlacklisted('jti-1')).toBe(true);
  });

  it('uses a minimum TTL of 1s for already-expired tokens', async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 100;
    await blacklistToken('jti-past', pastExp);
    const entry = mockRedis.store.get('blacklist:jti-past');
    expect(entry).toBeDefined();
    // expiresAt must be in the future (>= now), proving ttl was clamped to >= 1s
    expect(entry!.expiresAt).not.toBeNull();
    expect(entry!.expiresAt!).toBeGreaterThan(Date.now());
  });
});
