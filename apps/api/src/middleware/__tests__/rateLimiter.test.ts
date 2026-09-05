import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createRateLimiter, type RateLimiterRedis } from '../rateLimiter.js';

// ---------------------------------------------------------------------------
// In-memory mock redis implementing just the methods the limiter needs.
// ---------------------------------------------------------------------------

function makeMockRedis(): RateLimiterRedis & { store: Map<string, number> } {
  const store = new Map<string, number>();
  const ttl = new Map<string, number>();
  return {
    store,
    async incr(key: string): Promise<number> {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    },
    async expire(key: string, seconds: number): Promise<number> {
      ttl.set(key, seconds);
      return 1;
    },
    async pttl(key: string): Promise<number> {
      const s = ttl.get(key);
      return typeof s === 'number' ? s * 1000 : -1;
    },
  };
}

function mockReq(ip = '10.0.0.1'): Request {
  return { ip } as unknown as Request;
}

function mockRes(): Response & { statusCode?: number; body?: unknown; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res: Partial<Response> & {
    statusCode?: number;
    body?: unknown;
    headers: Record<string, string>;
  } = { headers };
  res.status = vi.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.set = vi.fn().mockImplementation((name: string, value: string) => {
    headers[name] = value;
    return res as Response;
  });
  res.json = vi.fn().mockImplementation((payload: unknown) => {
    res.body = payload;
    return res as Response;
  });
  return res as Response & { statusCode?: number; body?: unknown; headers: Record<string, string> };
}

describe('createRateLimiter', () => {
  let client: ReturnType<typeof makeMockRedis>;

  beforeEach(() => {
    client = makeMockRedis();
  });

  it('allows requests under the limit and calls next()', async () => {
    const limiter = createRateLimiter({ max: 3, windowMs: 60000, client });

    for (let i = 0; i < 3; i++) {
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn() as unknown as NextFunction;
      await limiter(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it('sets the expiry only on the first request of a window', async () => {
    const spyExpire = vi.spyOn(client, 'expire');
    const limiter = createRateLimiter({ max: 5, windowMs: 60000, client });

    for (let i = 0; i < 3; i++) {
      await limiter(mockReq(), mockRes(), vi.fn() as unknown as NextFunction);
    }

    expect(spyExpire).toHaveBeenCalledTimes(1);
    expect(spyExpire).toHaveBeenCalledWith('rate:10.0.0.1', 60);
  });

  it('blocks requests over the limit with 429 and SYS_002', async () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 60000, client });

    // First two are allowed.
    await limiter(mockReq(), mockRes(), vi.fn() as unknown as NextFunction);
    await limiter(mockReq(), mockRes(), vi.fn() as unknown as NextFunction);

    // Third exceeds the limit.
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await limiter(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.headers['Retry-After']).toBe('60');
    expect(res.body).toMatchObject({
      error: 'Muitas requisições',
      code: 'SYS_002',
      retryAfter: 60,
    });
  });

  it('tracks limits per IP independently', async () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60000, client });

    // IP A uses its single allowance.
    await limiter(mockReq('1.1.1.1'), mockRes(), vi.fn() as unknown as NextFunction);

    // IP B should still be allowed.
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await limiter(mockReq('2.2.2.2'), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('fails open when the redis client throws', async () => {
    const failing: RateLimiterRedis = {
      incr: vi.fn().mockRejectedValue(new Error('redis down')),
      expire: vi.fn(),
      pttl: vi.fn(),
    };
    const limiter = createRateLimiter({ max: 1, windowMs: 60000, client: failing });

    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await limiter(mockReq(), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
