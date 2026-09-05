import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ErrorCodes } from '@auditar/shared';

/**
 * Redis-backed fixed-window rate limiter.
 *
 * Strategy: for each client IP a counter key `rate:{ip}` is INCR'd. On the first
 * hit of a window the key gets an EXPIRE equal to the configured window, so the
 * counter naturally resets when the window elapses. When the counter exceeds the
 * configured maximum the request is rejected with HTTP 429 and a `Retry-After`
 * header (in seconds) plus a `retryAfter` field in the JSON body.
 *
 * _Requirements: 20.4_
 */

// Minimal structural type so tests can inject a mock redis client.
export interface RateLimiterRedis {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  pttl(key: string): Promise<number>;
}

export interface RateLimiterOptions {
  max?: number;
  windowMs?: number;
  client?: RateLimiterRedis;
}

/**
 * Factory that builds a rate limiting middleware. Exposed for testing so a mock
 * redis client and custom limits can be injected.
 */
export function createRateLimiter(
  maxOrOptions?: number | RateLimiterOptions,
  windowMsArg?: number,
): RequestHandler {
  let explicitMax: number | undefined;
  let explicitWindowMs: number | undefined;
  let injectedClient: RateLimiterRedis | undefined;

  if (typeof maxOrOptions === 'object' && maxOrOptions !== null) {
    explicitMax = maxOrOptions.max;
    explicitWindowMs = maxOrOptions.windowMs;
    injectedClient = maxOrOptions.client;
  } else {
    explicitMax = maxOrOptions;
    explicitWindowMs = windowMsArg;
  }

  // Config resolved lazily so that importing this module (e.g. in unit tests
  // with a mock client) does not eagerly load env validation or the ioredis
  // dependency. Env-configured values (RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS)
  // are used when explicit values are not supplied.
  let cachedMax = explicitMax;
  let cachedWindowMs = explicitWindowMs;
  async function getConfig(): Promise<{ max: number; windowSeconds: number }> {
    if (cachedMax === undefined || cachedWindowMs === undefined) {
      const { env } = await import('../config/env.js');
      cachedMax = cachedMax ?? env.RATE_LIMIT_MAX;
      cachedWindowMs = cachedWindowMs ?? env.RATE_LIMIT_WINDOW_MS;
    }
    return { max: cachedMax, windowSeconds: Math.ceil(cachedWindowMs / 1000) };
  }

  // Lazily resolve the shared redis client only when no client was injected.
  let resolvedClient: RateLimiterRedis | undefined = injectedClient;
  async function getClient(): Promise<RateLimiterRedis> {
    if (!resolvedClient) {
      const { redis } = await import('../config/redis.js');
      resolvedClient = redis as unknown as RateLimiterRedis;
    }
    return resolvedClient;
  }

  return async function rateLimiterMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const ip = req.ip ?? 'unknown';
    const key = `rate:${ip}`;

    try {
      const { max, windowSeconds } = await getConfig();
      const client = await getClient();
      const count = await client.incr(key);

      // First hit in this window — set the expiry so the counter resets later.
      if (count === 1) {
        await client.expire(key, windowSeconds);
      }

      if (count > max) {
        // Prefer the real remaining TTL when available, fall back to full window.
        let retryAfter = windowSeconds;
        try {
          const ttlMs = await client.pttl(key);
          if (typeof ttlMs === 'number' && ttlMs > 0) {
            retryAfter = Math.ceil(ttlMs / 1000);
          }
        } catch {
          // ignore pttl errors, keep default
        }

        res
          .status(429)
          .set('Retry-After', String(retryAfter))
          .json({ error: 'Muitas requisições', code: ErrorCodes.SERVICO_INDISPONIVEL, retryAfter });
        return;
      }

      next();
    } catch (err) {
      // Fail-open: if Redis is unavailable, do not block legitimate traffic.
      console.error('[rateLimiter] redis error:', (err as Error).message);
      next();
    }
  };
}

/**
 * Default rate limiter using env-configured limits and the shared redis client.
 */
export const rateLimiter: RequestHandler = createRateLimiter();
