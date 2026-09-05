import { describe, it, expect, vi } from 'vitest';

// Stub da infra para não abrir conexão real (Prisma/Redis/BullMQ) ao importar
// o serviço. Todos os testes injetam mocks explícitos via `deps`.
vi.mock('../../../config/database.js', () => ({ prisma: {} }));
vi.mock('../../../config/redis.js', () => ({ redis: {} }));
vi.mock('../../../jobs/queues.js', () => ({ getQueue: () => ({ add: vi.fn() }) }));

import {
  listarAuditoria,
  solicitarExportacao,
  statusExportacao,
  montarWhereAuditoria,
  validarIntervalo,
  resolverObjetoId,
  chaveStatusExport,
  AUDITORIA_PAGE_SIZE_MAX,
  AUDITORIA_EXPORT_JOB,
  EXPORT_STATUS_TTL_SEG,
  type AuditoriaQueryDeps,
  type ExportStatusRecord,
} from '../auditoria.query.service.js';
import * as queryService from '../auditoria.query.service.js';

// ---------------------------------------------------------------------------
// Mock builders
// ---------------------------------------------------------------------------

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    ator: 'servidor',
    atorCidadaoId: null,
    atorServidorId: 'srv-1',
    enderecoIp: '203.0.113.7',
    tipoAcao: 'mover_etapa',
    modulo: 'processos',
    objetoId: 'proc-99',
    tipoObjeto: 'Processo',
    valorAnterior: null,
    valorPosterior: null,
    realizadaEmUtc: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeDeps(over: {
  findMany?: ReturnType<typeof vi.fn>;
  count?: ReturnType<typeof vi.fn>;
  findUnique?: ReturnType<typeof vi.fn>;
  set?: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
  add?: ReturnType<typeof vi.fn>;
} = {}): {
  deps: Partial<AuditoriaQueryDeps>;
  findMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  add: ReturnType<typeof vi.fn>;
} {
  const findMany = over.findMany ?? vi.fn().mockResolvedValue([makeRow()]);
  const count = over.count ?? vi.fn().mockResolvedValue(1);
  const findUnique = over.findUnique ?? vi.fn().mockResolvedValue({ id: 'proc-99' });
  const set = over.set ?? vi.fn().mockResolvedValue('OK');
  const get = over.get ?? vi.fn().mockResolvedValue(null);
  const add = over.add ?? vi.fn().mockResolvedValue({ id: 'job-1' });

  const deps: Partial<AuditoriaQueryDeps> = {
    prisma: {
      auditoriaLog: { findMany, count },
      processo: { findUnique },
    } as unknown as AuditoriaQueryDeps['prisma'],
    redis: { set, get } as unknown as AuditoriaQueryDeps['redis'],
    enqueue: { add } as unknown as AuditoriaQueryDeps['enqueue'],
  };

  return { deps, findMany, count, findUnique, set, get, add };
}

// ---------------------------------------------------------------------------
// montarWhereAuditoria (Req. 17.4)
// ---------------------------------------------------------------------------

describe('montarWhereAuditoria', () => {
  it('builds a date range on realizadaEmUtc', () => {
    const inicio = new Date('2024-01-01T00:00:00Z');
    const fim = new Date('2024-01-31T00:00:00Z');
    const where = montarWhereAuditoria({ dataInicio: inicio, dataFim: fim });
    expect(where.realizadaEmUtc).toEqual({ gte: inicio, lte: fim });
  });

  it('filters by tipoAcao and modulo', () => {
    const where = montarWhereAuditoria({ tipoAcao: 'login', modulo: 'auth' });
    expect(where.tipoAcao).toBe('login');
    expect(where.modulo).toBe('auth');
  });

  it('routes atorId to atorCidadaoId when ator is cidadao', () => {
    const where = montarWhereAuditoria({ ator: 'cidadao', atorId: 'cid-1' });
    expect(where.ator).toBe('cidadao');
    expect(where.atorCidadaoId).toBe('cid-1');
    expect(where.atorServidorId).toBeUndefined();
  });

  it('routes atorId to atorServidorId when ator is servidor', () => {
    const where = montarWhereAuditoria({ ator: 'servidor', atorId: 'srv-1' });
    expect(where.atorServidorId).toBe('srv-1');
    expect(where.atorCidadaoId).toBeUndefined();
  });

  it('matches atorId against either column when ator is unset', () => {
    const where = montarWhereAuditoria({ atorId: 'x-1' });
    expect(where.OR).toEqual([{ atorCidadaoId: 'x-1' }, { atorServidorId: 'x-1' }]);
  });

  it('applies objetoId when provided (protocolo resolved)', () => {
    const where = montarWhereAuditoria({}, 'proc-42');
    expect(where.objetoId).toBe('proc-42');
  });
});

// ---------------------------------------------------------------------------
// validarIntervalo (Req. 17.4)
// ---------------------------------------------------------------------------

describe('validarIntervalo', () => {
  it('rejects when dataFim is before dataInicio', () => {
    expect(() =>
      validarIntervalo({
        dataInicio: new Date('2024-02-01'),
        dataFim: new Date('2024-01-01'),
      }),
    ).toThrow(/data final/i);
  });

  it('accepts when dataFim equals dataInicio', () => {
    const d = new Date('2024-01-01');
    expect(() => validarIntervalo({ dataInicio: d, dataFim: d })).not.toThrow();
  });

  it('accepts when only one bound is provided', () => {
    expect(() => validarIntervalo({ dataInicio: new Date('2024-01-01') })).not.toThrow();
    expect(() => validarIntervalo({ dataFim: new Date('2024-01-01') })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolverObjetoId
// ---------------------------------------------------------------------------

describe('resolverObjetoId', () => {
  it('returns the processo id for a known protocolo', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'proc-7' });
    const prisma = { processo: { findUnique } } as never;
    await expect(resolverObjetoId('2024-00007', prisma)).resolves.toBe('proc-7');
    expect(findUnique).toHaveBeenCalledWith({
      where: { protocolo: '2024-00007' },
      select: { id: true },
    });
  });

  it('returns null for an unknown protocolo', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = { processo: { findUnique } } as never;
    await expect(resolverObjetoId('nope', prisma)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listarAuditoria (Req. 17.2, 17.4)
// ---------------------------------------------------------------------------

describe('listarAuditoria', () => {
  it('returns a PaginatedResult with data and meta', async () => {
    const { deps } = makeDeps({ count: vi.fn().mockResolvedValue(3) });
    const result = await listarAuditoria({}, { page: 1, pageSize: 10 }, deps);

    expect(result.data).toHaveLength(1);
    expect(result.meta).toEqual({ total: 3, page: 1, pageSize: 10, totalPages: 1 });
  });

  it('caps pageSize at 100 (Req 17.2)', async () => {
    const { deps, findMany } = makeDeps();
    const result = await listarAuditoria({}, { page: 1, pageSize: 500 }, deps);

    expect(result.meta.pageSize).toBe(AUDITORIA_PAGE_SIZE_MAX);
    // take should also be clamped
    expect(findMany.mock.calls[0][0].take).toBe(AUDITORIA_PAGE_SIZE_MAX);
  });

  it('orders by realizadaEmUtc desc', async () => {
    const { deps, findMany } = makeDeps();
    await listarAuditoria({}, {}, deps);
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ realizadaEmUtc: 'desc' });
  });

  it('passes the date range filter to the where clause', async () => {
    const { deps, findMany } = makeDeps();
    const dataInicio = new Date('2024-01-01T00:00:00Z');
    const dataFim = new Date('2024-01-31T00:00:00Z');
    await listarAuditoria({ dataInicio, dataFim }, {}, deps);
    expect(findMany.mock.calls[0][0].where.realizadaEmUtc).toEqual({
      gte: dataInicio,
      lte: dataFim,
    });
  });

  it('passes tipoAcao / ator / modulo filters to the where clause', async () => {
    const { deps, findMany } = makeDeps();
    await listarAuditoria(
      { tipoAcao: 'login', ator: 'servidor', atorId: 'srv-9', modulo: 'auth' },
      {},
      deps,
    );
    const where = findMany.mock.calls[0][0].where;
    expect(where.tipoAcao).toBe('login');
    expect(where.ator).toBe('servidor');
    expect(where.atorServidorId).toBe('srv-9');
    expect(where.modulo).toBe('auth');
  });

  it('resolves protocolo to objetoId and queries the log', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'proc-77' });
    const { deps, findMany } = makeDeps({ findUnique });
    await listarAuditoria({ protocolo: '2024-00077' }, {}, deps);

    expect(findUnique).toHaveBeenCalledWith({
      where: { protocolo: '2024-00077' },
      select: { id: true },
    });
    expect(findMany.mock.calls[0][0].where.objetoId).toBe('proc-77');
  });

  it('returns empty result when protocolo is unknown (no log query)', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const { deps, findMany, count } = makeDeps({ findUnique });
    const result = await listarAuditoria({ protocolo: 'ghost' }, { page: 1, pageSize: 10 }, deps);

    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it('rejects an invalid date range before querying', async () => {
    const { deps, findMany } = makeDeps();
    await expect(
      listarAuditoria(
        { dataInicio: new Date('2024-02-01'), dataFim: new Date('2024-01-01') },
        {},
        deps,
      ),
    ).rejects.toThrow(/data final/i);
    expect(findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// solicitarExportacao (Req. 17.5)
// ---------------------------------------------------------------------------

describe('solicitarExportacao', () => {
  it('enqueues a job, writes Redis status with TTL and returns jobId', async () => {
    const { deps, set, add } = makeDeps();
    const { jobId } = await solicitarExportacao('csv', { tipoAcao: 'login' }, deps);

    expect(typeof jobId).toBe('string');
    expect(jobId.length).toBeGreaterThan(0);

    // Redis status written with EX + 1h TTL
    expect(set).toHaveBeenCalledTimes(1);
    const [key, value, mode, ttl] = set.mock.calls[0];
    expect(key).toBe(chaveStatusExport(jobId));
    expect(mode).toBe('EX');
    expect(ttl).toBe(EXPORT_STATUS_TTL_SEG);
    const record = JSON.parse(value) as ExportStatusRecord;
    expect(record.status).toBe('pendente');
    expect(record.formato).toBe('csv');

    // Job enqueued with the serialized filters
    expect(add).toHaveBeenCalledTimes(1);
    const [jobName, jobData] = add.mock.calls[0];
    expect(jobName).toBe(AUDITORIA_EXPORT_JOB);
    expect(jobData.jobId).toBe(jobId);
    expect(jobData.formato).toBe('csv');
    expect(jobData.filtros.tipoAcao).toBe('login');
  });

  it('accepts pdf as a valid format', async () => {
    const { deps } = makeDeps();
    await expect(solicitarExportacao('pdf', {}, deps)).resolves.toHaveProperty('jobId');
  });

  it('rejects an unsupported format', async () => {
    const { deps, add, set } = makeDeps();
    await expect(solicitarExportacao('xlsx', {}, deps)).rejects.toThrow(/formato/i);
    expect(add).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('rejects an invalid date range', async () => {
    const { deps, add } = makeDeps();
    await expect(
      solicitarExportacao(
        'csv',
        { dataInicio: new Date('2024-02-01'), dataFim: new Date('2024-01-01') },
        deps,
      ),
    ).rejects.toThrow(/data final/i);
    expect(add).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// statusExportacao (Req. 17.5)
// ---------------------------------------------------------------------------

describe('statusExportacao', () => {
  it('returns the stored status record', async () => {
    const record: ExportStatusRecord = {
      jobId: 'job-1',
      status: 'concluido',
      formato: 'csv',
      downloadUrl: 'https://minio/local/file.csv',
      criadoEm: new Date().toISOString(),
    };
    const { deps } = makeDeps({ get: vi.fn().mockResolvedValue(JSON.stringify(record)) });

    await expect(statusExportacao('job-1', deps)).resolves.toEqual(record);
  });

  it('returns null when the status key does not exist', async () => {
    const { deps } = makeDeps({ get: vi.fn().mockResolvedValue(null) });
    await expect(statusExportacao('missing', deps)).resolves.toBeNull();
  });

  it('returns null when the stored value is corrupt', async () => {
    const { deps } = makeDeps({ get: vi.fn().mockResolvedValue('{not-json') });
    await expect(statusExportacao('bad', deps)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Read-only guarantee (Req. 17.7)
// ---------------------------------------------------------------------------

describe('read-only service surface (Req 17.7)', () => {
  it('exposes no create/update/delete operations on the auditoria log', () => {
    const forbidden = /^(create|update|delete|remove|insert|save|write|destroy)/i;
    const exportedFns = Object.keys(queryService).filter(
      (k) => typeof (queryService as Record<string, unknown>)[k] === 'function',
    );
    const mutators = exportedFns.filter((name) => forbidden.test(name));
    expect(mutators).toEqual([]);
  });
});
