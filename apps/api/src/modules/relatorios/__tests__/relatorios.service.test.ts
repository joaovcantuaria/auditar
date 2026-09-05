import { describe, it, expect, vi } from 'vitest';

// Stub da infra para não abrir conexão real (Prisma/Redis/BullMQ) ao importar
// o serviço. Todos os testes injetam mocks explícitos via `deps`.
vi.mock('../../../config/database.js', () => ({ prisma: {} }));
vi.mock('../../../config/redis.js', () => ({ redis: {} }));
vi.mock('../../../jobs/queues.js', () => ({ getQueue: () => ({ add: vi.fn() }) }));

import {
  aplicarPeriodoPadrao,
  validarIntervalo,
  montarWhereRelatorio,
  volumePorPeriodo,
  tempoMedioPorTipo,
  taxaPorUnidade,
  vencidosPorServidor,
  volumePorCategoria,
  gerarRelatorio,
  solicitarExportacao,
  statusExportacao,
  chaveStatusRelatorio,
  serializarFiltros,
  desserializarFiltros,
  RELATORIO_STATUS_TTL_SEG,
  RELATORIO_EXPORT_JOB,
  PERIODO_PADRAO_DIAS,
  INTERVALO_MAX_DIAS,
  type FiltrosRelatorio,
  type RelatorioDeps,
  type RelatorioStatusRecord,
} from '../relatorios.service.js';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// aplicarPeriodoPadrao (Req. 18.2)
// ---------------------------------------------------------------------------

describe('aplicarPeriodoPadrao', () => {
  it('applies the last-30-days window when no dates are given', () => {
    const agora = new Date('2024-06-30T12:00:00.000Z');
    const r = aplicarPeriodoPadrao({}, () => agora);
    expect(r.dataFim).toEqual(agora);
    expect(r.dataInicio).toEqual(new Date(agora.getTime() - PERIODO_PADRAO_DIAS * MS_POR_DIA));
  });

  it('preserves the dates when at least one bound is provided', () => {
    const dataInicio = new Date('2024-01-01T00:00:00Z');
    const r = aplicarPeriodoPadrao({ dataInicio }, () => new Date('2024-06-30'));
    expect(r.dataInicio).toEqual(dataInicio);
    expect(r.dataFim).toBeUndefined();
  });

  it('keeps other filters intact', () => {
    const r = aplicarPeriodoPadrao({ unidadeId: 'u-1' }, () => new Date('2024-06-30'));
    expect(r.unidadeId).toBe('u-1');
    expect(r.dataInicio).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// validarIntervalo (Req. 18.7)
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

  it('rejects a range exceeding 366 days', () => {
    const dataInicio = new Date('2024-01-01T00:00:00Z');
    const dataFim = new Date(dataInicio.getTime() + (INTERVALO_MAX_DIAS + 1) * MS_POR_DIA);
    expect(() => validarIntervalo({ dataInicio, dataFim })).toThrow(/intervalo/i);
  });

  it('accepts a range exactly at the 366-day limit', () => {
    const dataInicio = new Date('2024-01-01T00:00:00Z');
    const dataFim = new Date(dataInicio.getTime() + INTERVALO_MAX_DIAS * MS_POR_DIA);
    expect(() => validarIntervalo({ dataInicio, dataFim })).not.toThrow();
  });

  it('accepts when only one bound is provided', () => {
    expect(() => validarIntervalo({ dataInicio: new Date('2024-01-01') })).not.toThrow();
    expect(() => validarIntervalo({ dataFim: new Date('2024-01-01') })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// montarWhereRelatorio (Req. 18.2)
// ---------------------------------------------------------------------------

describe('montarWhereRelatorio', () => {
  it('maps tipoProcessoId, unidadeId and servidorId', () => {
    const where = montarWhereRelatorio({
      tipoProcessoId: 'tp-1',
      unidadeId: 'u-1',
      servidorId: 'srv-1',
    });
    expect(where.tipoProcessoId).toBe('tp-1');
    expect(where.unidadeId).toBe('u-1');
    expect(where.servidorResponsavelId).toBe('srv-1');
  });

  it('maps categoriaId through the tipoProcesso relation', () => {
    const where = montarWhereRelatorio({ categoriaId: 'cat-1' });
    expect(where.tipoProcesso).toEqual({ categoriaId: 'cat-1' });
  });

  it('maps the date range onto abertoEm', () => {
    const dataInicio = new Date('2024-01-01T00:00:00Z');
    const dataFim = new Date('2024-01-31T00:00:00Z');
    const where = montarWhereRelatorio({ dataInicio, dataFim });
    expect(where.abertoEm).toEqual({ gte: dataInicio, lte: dataFim });
  });

  it('supports a single date bound on abertoEm', () => {
    const dataInicio = new Date('2024-01-01T00:00:00Z');
    const where = montarWhereRelatorio({ dataInicio });
    expect(where.abertoEm).toEqual({ gte: dataInicio });
  });

  it('returns an empty where when no filters are given', () => {
    expect(montarWhereRelatorio({})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Dataset helpers (Req. 18.1)
// ---------------------------------------------------------------------------

describe('volumePorPeriodo', () => {
  it('consolidates grouped counts by day (UTC)', async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { abertoEm: new Date('2024-01-01T09:00:00Z'), _count: { _all: 2 } },
      { abertoEm: new Date('2024-01-01T18:00:00Z'), _count: { _all: 3 } },
      { abertoEm: new Date('2024-01-02T10:00:00Z'), _count: { _all: 1 } },
    ]);
    const prisma = { processo: { groupBy } } as unknown as RelatorioDeps['prisma'];

    const r = await volumePorPeriodo({}, prisma);
    expect(r).toEqual([
      { data: '2024-01-01', total: 5 },
      { data: '2024-01-02', total: 1 },
    ]);
  });
});

describe('tempoMedioPorTipo', () => {
  it('computes the average resolution time in days per tipo', async () => {
    const groupBy = vi.fn().mockResolvedValue([{ tipoProcessoId: 'tp-1', _count: { _all: 2 } }]);
    // processo.findMany: linhas com datas para o cálculo do tempo médio
    const processoFindMany = vi.fn().mockResolvedValue([
      {
        abertoEm: new Date('2024-01-01T00:00:00Z'),
        encerradoEm: new Date('2024-01-03T00:00:00Z'), // 2 dias
      },
      {
        abertoEm: new Date('2024-01-01T00:00:00Z'),
        encerradoEm: new Date('2024-01-05T00:00:00Z'), // 4 dias
      },
    ]);
    // tipoProcesso.findMany: mapa de nomes de tipo
    const tipoFindMany = vi.fn().mockResolvedValue([{ id: 'tp-1', nome: 'Licença' }]);
    const prisma = {
      processo: { groupBy, findMany: processoFindMany },
      tipoProcesso: { findMany: tipoFindMany },
    } as unknown as RelatorioDeps['prisma'];

    const r = await tempoMedioPorTipo({}, prisma);
    expect(r).toHaveLength(1);
    expect(r[0].tipoProcessoId).toBe('tp-1');
    expect(r[0].tipoProcesso).toBe('Licença');
    expect(r[0].tempoMedioDias).toBe(3); // média de 2 e 4
    expect(r[0].totalResolvidos).toBe(2);
  });
});

describe('taxaPorUnidade', () => {
  it('computes approval/rejection rates per unidade', async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { unidadeId: 'u-1', status: 'aprovado', _count: { _all: 3 } },
      { unidadeId: 'u-1', status: 'rejeitado', _count: { _all: 1 } },
      { unidadeId: 'u-1', status: 'em_analise', _count: { _all: 0 } },
    ]);
    const findMany = vi.fn().mockResolvedValue([{ id: 'u-1', nome: 'Unidade Central' }]);
    const prisma = {
      processo: { groupBy },
      unidade: { findMany },
    } as unknown as RelatorioDeps['prisma'];

    const r = await taxaPorUnidade({}, prisma);
    expect(r).toHaveLength(1);
    expect(r[0].unidade).toBe('Unidade Central');
    expect(r[0].aprovados).toBe(3);
    expect(r[0].rejeitados).toBe(1);
    expect(r[0].total).toBe(4);
    expect(r[0].taxaAprovacao).toBe(0.75);
    expect(r[0].taxaRejeicao).toBe(0.25);
  });
});

describe('vencidosPorServidor', () => {
  it('counts overdue processes per servidor', async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { servidorResponsavelId: 'srv-1', _count: { _all: 5 } },
      { servidorResponsavelId: null, _count: { _all: 2 } },
    ]);
    const findMany = vi.fn().mockResolvedValue([{ id: 'srv-1', nome: 'Ana' }]);
    const prisma = {
      processo: { groupBy },
      servidor: { findMany },
    } as unknown as RelatorioDeps['prisma'];

    const r = await vencidosPorServidor({}, prisma);
    // ordenado por totalVencidos desc
    expect(r[0]).toEqual({ servidorId: 'srv-1', servidor: 'Ana', totalVencidos: 5 });
    expect(r[1]).toEqual({ servidorId: null, servidor: 'Sem responsável', totalVencidos: 2 });
    // filtro por status vencido
    expect(groupBy.mock.calls[0][0].where.status).toBe('vencido');
  });
});

describe('volumePorCategoria', () => {
  it('maps tipo counts onto their categoria', async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { tipoProcessoId: 'tp-1', _count: { _all: 4 } },
      { tipoProcessoId: 'tp-2', _count: { _all: 6 } },
    ]);
    const findMany = vi.fn().mockResolvedValue([
      { id: 'tp-1', categoriaId: 'cat-1', categoria: { nome: 'Fiscal' } },
      { id: 'tp-2', categoriaId: 'cat-1', categoria: { nome: 'Fiscal' } },
    ]);
    const prisma = {
      processo: { groupBy },
      tipoProcesso: { findMany },
    } as unknown as RelatorioDeps['prisma'];

    const r = await volumePorCategoria({}, prisma);
    expect(r).toEqual([{ categoriaId: 'cat-1', categoria: 'Fiscal', total: 10 }]);
  });
});

// ---------------------------------------------------------------------------
// Deps builder for gerarRelatorio / solicitarExportacao / statusExportacao
// ---------------------------------------------------------------------------

function makeDeps(over: {
  groupBy?: ReturnType<typeof vi.fn>;
  findMany?: ReturnType<typeof vi.fn>;
  set?: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
  add?: ReturnType<typeof vi.fn>;
} = {}): {
  deps: Partial<RelatorioDeps>;
  groupBy: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  add: ReturnType<typeof vi.fn>;
} {
  const groupBy = over.groupBy ?? vi.fn().mockResolvedValue([]);
  const findMany = over.findMany ?? vi.fn().mockResolvedValue([]);
  const set = over.set ?? vi.fn().mockResolvedValue('OK');
  const get = over.get ?? vi.fn().mockResolvedValue(null);
  const add = over.add ?? vi.fn().mockResolvedValue({ id: 'job-1' });

  const deps: Partial<RelatorioDeps> = {
    prisma: {
      processo: { groupBy, findMany },
      tipoProcesso: { findMany },
      unidade: { findMany },
      servidor: { findMany },
    } as unknown as RelatorioDeps['prisma'],
    redis: { set, get } as unknown as RelatorioDeps['redis'],
    enqueue: { add } as unknown as RelatorioDeps['enqueue'],
  };

  return { deps, groupBy, findMany, set, get, add };
}

// ---------------------------------------------------------------------------
// gerarRelatorio (Req. 18.1, 18.2, 18.7)
// ---------------------------------------------------------------------------

describe('gerarRelatorio', () => {
  it('returns all five datasets plus periodo and applies the default period', async () => {
    const agora = new Date('2024-06-30T00:00:00.000Z');
    const { deps } = makeDeps();

    const r = await gerarRelatorio({}, deps, () => agora);

    expect(r).toHaveProperty('volumePorPeriodo');
    expect(r).toHaveProperty('tempoMedioPorTipo');
    expect(r).toHaveProperty('taxaPorUnidade');
    expect(r).toHaveProperty('vencidosPorServidor');
    expect(r).toHaveProperty('volumePorCategoria');
    expect(r.periodo.dataFim).toBe(agora.toISOString());
    expect(r.periodo.dataInicio).toBe(
      new Date(agora.getTime() - PERIODO_PADRAO_DIAS * MS_POR_DIA).toISOString(),
    );
  });

  it('rejects an invalid range before querying', async () => {
    const { deps, groupBy } = makeDeps();
    await expect(
      gerarRelatorio(
        { dataInicio: new Date('2024-02-01'), dataFim: new Date('2024-01-01') },
        deps,
      ),
    ).rejects.toThrow(/data final/i);
    expect(groupBy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// solicitarExportacao (Req. 18.4, 18.5)
// ---------------------------------------------------------------------------

describe('solicitarExportacao', () => {
  it('rejects an unsupported format (no enqueue/set)', async () => {
    const { deps, add, set } = makeDeps();
    await expect(solicitarExportacao('xlsx', 'srv-1', {}, deps)).rejects.toThrow(/formato/i);
    expect(add).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('writes Redis status with EX + 1h TTL, enqueues the job and returns jobId', async () => {
    const agora = new Date('2024-06-30T00:00:00.000Z');
    const { deps, set, add } = makeDeps();

    const { jobId } = await solicitarExportacao('csv', 'srv-9', { unidadeId: 'u-1' }, deps, () => agora);

    expect(typeof jobId).toBe('string');
    expect(jobId.length).toBeGreaterThan(0);

    // Redis status inicial
    expect(set).toHaveBeenCalledTimes(1);
    const [key, value, mode, ttl] = set.mock.calls[0];
    expect(key).toBe(chaveStatusRelatorio(jobId));
    expect(mode).toBe('EX');
    expect(ttl).toBe(RELATORIO_STATUS_TTL_SEG);
    const record = JSON.parse(value) as RelatorioStatusRecord;
    expect(record.status).toBe('pendente');
    expect(record.formato).toBe('csv');

    // Job enfileirado com filtros serializados + servidorId
    expect(add).toHaveBeenCalledTimes(1);
    const [jobName, jobData] = add.mock.calls[0];
    expect(jobName).toBe(RELATORIO_EXPORT_JOB);
    expect(jobData.jobId).toBe(jobId);
    expect(jobData.formato).toBe('csv');
    expect(jobData.servidorId).toBe('srv-9');
    expect(jobData.filtros.unidadeId).toBe('u-1');
    // período padrão aplicado e serializado como ISO
    expect(jobData.filtros.dataFim).toBe(agora.toISOString());
  });

  it('accepts pdf as a valid format', async () => {
    const { deps } = makeDeps();
    await expect(solicitarExportacao('pdf', 'srv-1', {}, deps)).resolves.toHaveProperty('jobId');
  });

  it('rejects an invalid date range', async () => {
    const { deps, add } = makeDeps();
    await expect(
      solicitarExportacao(
        'csv',
        'srv-1',
        { dataInicio: new Date('2024-02-01'), dataFim: new Date('2024-01-01') },
        deps,
      ),
    ).rejects.toThrow(/data final/i);
    expect(add).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// statusExportacao (Req. 18.5)
// ---------------------------------------------------------------------------

describe('statusExportacao', () => {
  it('returns the stored status record', async () => {
    const record: RelatorioStatusRecord = {
      jobId: 'job-1',
      status: 'concluido',
      formato: 'csv',
      downloadUrl: 'https://minio/relatorios/srv-1/job-1.csv',
      criadoEm: new Date().toISOString(),
    };
    const { deps } = makeDeps({ get: vi.fn().mockResolvedValue(JSON.stringify(record)) });
    await expect(statusExportacao('job-1', deps)).resolves.toEqual(record);
  });

  it('returns null when the status key does not exist', async () => {
    const { deps } = makeDeps({ get: vi.fn().mockResolvedValue(null) });
    await expect(statusExportacao('missing', deps)).resolves.toBeNull();
  });

  it('returns null when the stored value is corrupt JSON', async () => {
    const { deps } = makeDeps({ get: vi.fn().mockResolvedValue('{not-json') });
    await expect(statusExportacao('bad', deps)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// serializarFiltros / desserializarFiltros round-trip
// ---------------------------------------------------------------------------

describe('serializarFiltros / desserializarFiltros', () => {
  it('round-trips dates through ISO strings', () => {
    const filtros: FiltrosRelatorio = {
      dataInicio: new Date('2024-01-01T00:00:00.000Z'),
      dataFim: new Date('2024-01-31T00:00:00.000Z'),
      categoriaId: 'cat-1',
      unidadeId: 'u-1',
    };
    const round = desserializarFiltros(serializarFiltros(filtros));
    expect(round.dataInicio).toEqual(filtros.dataInicio);
    expect(round.dataFim).toEqual(filtros.dataFim);
    expect(round.categoriaId).toBe('cat-1');
    expect(round.unidadeId).toBe('u-1');
  });
});
