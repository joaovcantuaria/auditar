import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { ErrorCodes } from '@auditar/shared';
import { env } from '../config/env.js';

/**
 * CSRF protection using the double-submit cookie pattern.
 *
 * The client must send the same token both as the `csrf-token` cookie and the
 * `X-CSRF-Token` request header. Because an attacker's cross-site request cannot
 * read or set a matching custom header for the victim's cookie, a matching pair
 * proves the request originated from our own frontend.
 *
 * Enforcement only applies to mutating HTTP methods (POST, PUT, PATCH, DELETE).
 * Enforcement is skipped in the `test` environment for easier testing, unless a
 * factory is used to force it on.
 *
 * _Requirements: 20.5_
 */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Generates a fresh CSRF token (UUID v4 based). Exposed so callers can seed the
 * `csrf-token` cookie on login / session start.
 */
export function generateCsrfToken(): string {
  return randomUUID();
}

export interface CsrfOptions {
  /** Force enforcement even in the test environment. */
  enabledInTest?: boolean;
}

function readCookie(req: Request, name: string): string | undefined {
  // Prefer a cookie parser if one populated req.cookies.
  const parsed = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (parsed && typeof parsed[name] === 'string') {
    return parsed[name];
  }

  // Fall back to parsing the raw Cookie header.
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}

/**
 * Factory to build the CSRF middleware. Exposed for testing so enforcement can
 * be forced on regardless of NODE_ENV.
 */
export function createCsrfMiddleware(options: CsrfOptions = {}) {
  const skipInTest = env.NODE_ENV === 'test' && !options.enabledInTest;

  return function csrf(req: Request, res: Response, next: NextFunction): void {
    if (skipInTest) {
      next();
      return;
    }

    if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    const headerToken = req.get('X-CSRF-Token');
    const cookieToken = readCookie(req, 'csrf-token');

    if (!headerToken || !cookieToken || headerToken !== cookieToken) {
      res.status(403).json({ error: 'Token CSRF inválido', code: ErrorCodes.INSUFFICIENT_PERMISSIONS });
      return;
    }

    next();
  };
}

/**
 * Default CSRF middleware honoring NODE_ENV (skips enforcement under test).
 */
export const csrfMiddleware = createCsrfMiddleware();
