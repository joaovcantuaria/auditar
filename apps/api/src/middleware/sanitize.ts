import type { Request, Response, NextFunction } from 'express';
import { ErrorCodes } from '@auditar/shared';

/**
 * Sanitization middleware for the Auditar API.
 *
 * Recursively inspects `req.body`, `req.query` and `req.params` for dangerous
 * patterns (SQL injection, XSS and control characters). When a dangerous pattern
 * is detected the WHOLE request is rejected with HTTP 400 and no partial data is
 * persisted (the middleware chain is short-circuited before any handler runs).
 *
 * IMPORTANT: normal accented Portuguese text, punctuation, emails and CPFs must
 * pass through untouched — only genuine injection / script / control patterns are
 * blocked.
 *
 * _Requirements: 20.3, 20.9_
 */

// ---------------------------------------------------------------------------
// Dangerous pattern definitions
// ---------------------------------------------------------------------------

// SQL injection: keyword-based, comment/terminator sequences and quote-based tautologies.
const SQL_PATTERNS: RegExp[] = [
  /(\b(union|select|insert|update|delete|drop|alter|create|truncate|exec|execute)\b\s)/i,
  /(--|;|\/\*|\*\/|xp_)/,
  /'\s*(or|and)\s*'?\d/i,
];

// XSS: script tags, javascript: URIs, inline event handlers and iframes.
const XSS_PATTERNS: RegExp[] = [
  /<script[\s\S]*?>/i,
  /<\/script>/i,
  /javascript:/i,
  /on\w+\s*=/i,
  /<iframe/i,
];

// Control characters (excluding common whitespace \t \n \r).
const CONTROL_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

const ALL_PATTERNS: RegExp[] = [...SQL_PATTERNS, ...XSS_PATTERNS, CONTROL_PATTERN];

// ---------------------------------------------------------------------------
// Pure functions (exported for property/unit testing)
// ---------------------------------------------------------------------------

/**
 * Returns true when the given string value contains any dangerous pattern.
 * Pure and side-effect free so it can be property-tested directly.
 */
export function containsDangerousPattern(value: string): boolean {
  if (typeof value !== 'string') return false;
  for (const pattern of ALL_PATTERNS) {
    if (pattern.test(value)) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively scans an arbitrary object/array/primitive structure. Returns true
 * as soon as any string value (or object key) contains a dangerous pattern.
 * Pure and side-effect free so it can be property-tested directly.
 */
export function deepScan(obj: unknown): boolean {
  if (obj === null || obj === undefined) {
    return false;
  }

  if (typeof obj === 'string') {
    return containsDangerousPattern(obj);
  }

  if (typeof obj === 'number' || typeof obj === 'boolean' || typeof obj === 'bigint') {
    return false;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (deepScan(item)) return true;
    }
    return false;
  }

  if (typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      // Keys are attacker-controllable too (e.g. query string keys).
      if (containsDangerousPattern(key)) return true;
      if (deepScan(val)) return true;
    }
    return false;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Express middleware
// ---------------------------------------------------------------------------

export function sanitizeMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (deepScan(req.body) || deepScan(req.query) || deepScan(req.params)) {
    res.status(400).json({ error: 'Entrada inválida detectada', code: ErrorCodes.VALIDATION_ERROR });
    return;
  }
  next();
}
