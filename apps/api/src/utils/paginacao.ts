import type { PaginatedResult } from '@auditar/shared';

/**
 * Wraps a page of data + total count into the canonical PaginatedResult shape.
 * totalPages is Math.ceil(total / pageSize), falling back to 0 when total is 0.
 */
export function buildPaginatedResult<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  return {
    data,
    meta: {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 0,
    },
  };
}

/**
 * Normalizes raw page/pageSize query params into safe Prisma skip/take values.
 * - page is clamped to a minimum of 1.
 * - pageSize is clamped to the range [1, 100], defaulting to 20.
 */
export function getPaginationParams(
  page?: number,
  pageSize?: number,
): { skip: number; take: number; page: number; pageSize: number } {
  const p = Math.max(1, page ?? 1);
  const ps = Math.min(100, Math.max(1, pageSize ?? 20));
  return { skip: (p - 1) * ps, take: ps, page: p, pageSize: ps };
}
