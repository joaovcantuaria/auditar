import { describe, it, expect } from 'vitest';
import { buildPaginatedResult, getPaginationParams } from '../paginacao.js';

describe('buildPaginatedResult', () => {
  it('wraps data with correct meta', () => {
    const result = buildPaginatedResult([1, 2, 3], 30, 1, 10);
    expect(result).toEqual({
      data: [1, 2, 3],
      meta: { total: 30, page: 1, pageSize: 10, totalPages: 3 },
    });
  });

  it('rounds totalPages up for a partial last page', () => {
    expect(buildPaginatedResult([], 25, 1, 10).meta.totalPages).toBe(3);
    expect(buildPaginatedResult([], 21, 1, 10).meta.totalPages).toBe(3);
    expect(buildPaginatedResult([], 11, 1, 10).meta.totalPages).toBe(2);
  });

  it('returns totalPages 0 when there are no records', () => {
    expect(buildPaginatedResult([], 0, 1, 10).meta.totalPages).toBe(0);
  });

  it('computes exactly one page when total equals pageSize', () => {
    expect(buildPaginatedResult([], 10, 1, 10).meta.totalPages).toBe(1);
  });
});

describe('getPaginationParams', () => {
  it('applies defaults when params are omitted', () => {
    expect(getPaginationParams()).toEqual({ skip: 0, take: 20, page: 1, pageSize: 20 });
  });

  it('computes skip from page and pageSize', () => {
    expect(getPaginationParams(3, 25)).toEqual({ skip: 50, take: 25, page: 3, pageSize: 25 });
  });

  it('clamps page to a minimum of 1', () => {
    expect(getPaginationParams(0, 10)).toEqual({ skip: 0, take: 10, page: 1, pageSize: 10 });
    expect(getPaginationParams(-5, 10)).toEqual({ skip: 0, take: 10, page: 1, pageSize: 10 });
  });

  it('clamps pageSize to the range [1, 100]', () => {
    expect(getPaginationParams(1, 0).pageSize).toBe(1);
    expect(getPaginationParams(1, -10).pageSize).toBe(1);
    expect(getPaginationParams(1, 500).pageSize).toBe(100);
    expect(getPaginationParams(1, 100).pageSize).toBe(100);
  });
});
