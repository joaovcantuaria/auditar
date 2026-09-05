import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusProcesso } from '@auditar/shared';

// Stub da infra para não abrir conexão real ao importar o serviço.
vi.mock('../../../config/database.js', () => ({ prisma: {} }));

import {
  safe,
  comCache,
  invalidarCacheDashboard,
  emitirAtualizacaoDashboard,
  chaveCacheDashboard,
  desdeDiasAtras,
  DASHBOARD_CACHE_TTL_SEG,
  processosPorStatus,
  contarVencendoEm,
  tempoMedioResolucao,
  produtividadeDiaria,
  volumeSemanal,
  taxaAprovacaoRejeicao,
  cargaPorServidor,
  porStatusPorUnidadeNaCategoria,
  tempoMedioPorTipo,
  porStatusPorCategoria,
  compararPeriodos,
  dashboardAnalista,
  dashboardGestorUnidade,
  type DashboardDeps,
  type RedisPort,
} from '../dashboard.service.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const groupByMock = vi.fn();
const countMock = vi.fn();
const findManyProcessoMock = vi.fn();
const findManyServidorMock = vi.fn();
const findManyUnidadeMock = vi.fn();
const findManyCategoriaMock = vi.fn();

const prismaMock = {
  processo: {
    groupBy: groupByMock,
    count: countMock,
    findMany: findManyProcessoMock,
  },
  servidor: { findMany: findManyServidorMock },
  unidade: { findMany: findManyUnidadeMock },
  categoria: { findMany: findManyCategoriaMock },
};

function makeRedis(store: Map<string, string> = new Map()): RedisPort & {
  getMock: ReturnType<typeof vi.fn>;
  setMock: ReturnType<typeof vi.fn>;
  delMock: ReturnType<typeof vi.fn>;
} {
  const getMock = vi.fn(async (k: string) => store.get(k) ?? null);
  const setMock = vi.fn(async (k: string, v: string) => {
    store.set(k, v);
    return 'OK';
  });
  const delMock = vi.fn(async (k: string) => {
    store.delete(k);
    return 1;
  });
  return {
    get: getMock,
    set: setMock as unknown as RedisPort['set'],
    del: delMock,
    getMock,
    setMock,
    delMock,
  };
}

function deps(over: Partial<DashboardDeps> = {}): Partial<DashboardDeps> {
  return {
    prisma: prismaMock as unknown as DashboardDeps['prisma'],
    redis: makeRedis(),
    emit: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// safe — resiliência por indicador (Req 9.6)
// ---------------------------------------------------------------------------

describe('safe', () => {
  it('devolve value + erro:false quando a computação tem sucesso', async () => {
    await expect(safe(async () => 42)).resolves.toEqual({ value: 42, erro: false });
  });

  it('devolve sentinela { value: null, erro: true } quando lança (Req 9.6)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      safe(async () => {
        throw new Error('boom');
      }),
    ).resolves.toEqual({ value: null, erro: true });
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// comCache — hit/miss (Req 9.5)
// ---------------------------------------------------------------------------

describe('comCache', () => {
  it('cache miss: computa e grava com TTL 300', async () => {
    const redis = makeRedis();
    const compute = vi.fn(async () => ({ a: 1 }));

    const out = await comCache(redis, 'analista', 'srv-1', compute);

    expect(out).toEqual({ a: 1 });
    expect(compute).toHaveBeenCalledTimes(1);
    expect(redis.setMock).toHaveBeenCalledWith(
      chaveCacheDashboard('analista', 'srv-1'),
      JSON.stringify({ a: 1 }),
      'EX',
      DASHBOARD_CACHE_TTL_SEG,
    );
  });

  it('cache hit: devolve cacheado sem recomputar', async () => {
    const store = new Map<string, string>();
    store.set(chaveCacheDashboard('analista', 'srv-1'), JSON.stringify({ cache: true }));
    const redis = makeRedis(store);
    const compute = vi.fn(async () => ({ cache: false }));

    const out = await comCache(redis, 'analista', 'srv-1', compute);

    expect(out).toEqual({ cache: true });
    expect(compute).not.toHaveBeenCalled();
    expect(redis.setMock).not.toHaveBeenCalled();
  });
});

describe('invalidarCacheDashboard', () => {
  it('chama redis.del na chave correta', async () => {
    const redis = makeRedis();
    await invalidarCacheDashboard('gestor-unidade', 'uni-1', { redis });
    expect(redis.delMock).toHaveBeenCalledWith(chaveCacheDashboard('gestor-unidade', 'uni-1'));
  });
});

describe('emitirAtualizacaoDashboard', () => {
  it('emite dashboard:atualizar na room informada', () => {
    const emit = vi.fn();
    emitirAtualizacaoDashboard('unidade:uni-1', { emit });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe('unidade:uni-1');
    expect(emit.mock.calls[0][1]).toBe('dashboard:atualizar');
  });

  it('nunca propaga erro do emit', () => {
    const emit = vi.fn(() => {
      throw new Error('socket down');
    });
    expect(() => emitirAtualizacaoDashboard('room', { emit })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Helpers de agregação
// ---------------------------------------------------------------------------

describe('processosPorStatus', () => {
  it('reduz groupBy para mapa status -> total', async () => {
    groupByMock.mockResolvedValue([
      { status: StatusProcesso.EM_ANDAMENTO, _count: { _all: 3 } },
      { status: StatusProcesso.APROVADO, _count: { _all: 5 } },
    ]);

    const out = await processosPorStatus(prismaMock as never, { unidadeId: 'u1' });
    expect(out).toEqual({ [StatusProcesso.EM_ANDAMENTO]: 3, [StatusProcesso.APROVADO]: 5 });

    const arg = groupByMock.mock.calls[0][0];
    expect(arg.by).toEqual(['status']);
    expect(arg.where).toEqual({ unidadeId: 'u1' });
  });
});

describe('contarVencendoEm', () => {
  it('filtra encerradoEm null e prazoFinal na janela de horas', async () => {
    countMock.mockResolvedValue(2);
    const agora = new Date('2024-06-01T00:00:00Z');

    const out = await contarVencendoEm(prismaMock as never, { servidorResponsavelId: 's1' }, 24, agora);
    expect(out).toBe(2);

    const where = countMock.mock.calls[0][0].where;
    expect(where.encerradoEm).toBeNull();
    expect(where.servidorResponsavelId).toBe('s1');
    expect(where.prazoFinal.gte).toEqual(agora);
    expect(where.prazoFinal.lte).toEqual(new Date('2024-06-02T00:00:00Z'));
  });
});

describe('tempoMedioResolucao', () => {
  it('calcula média de horas entre abertoEm e encerradoEm', async () => {
    findManyProcessoMock.mockResolvedValue([
      { abertoEm: new Date('2024-06-01T00:00:00Z'), encerradoEm: new Date('2024-06-01T10:00:00Z') },
      { abertoEm: new Date('2024-06-01T00:00:00Z'), encerradoEm: new Date('2024-06-01T20:00:00Z') },
    ]);
    const out = await tempoMedioResolucao(prismaMock as never, {}, desdeDiasAtras(30));
    expect(out).toBe(15); // (10 + 20) / 2
  });

  it('retorna 0 quando não há encerrados', async () => {
    findManyProcessoMock.mockResolvedValue([]);
    const out = await tempoMedioResolucao(prismaMock as never, {}, desdeDiasAtras(30));
    expect(out).toBe(0);
  });
});

describe('produtividadeDiaria', () => {
  it('agrupa por dia e ordena crescente', async () => {
    findManyProcessoMock.mockResolvedValue([
      { abertoEm: new Date('2024-06-02T09:00:00Z') },
      { abertoEm: new Date('2024-06-01T09:00:00Z') },
      { abertoEm: new Date('2024-06-01T15:00:00Z') },
    ]);
    const out = await produtividadeDiaria(prismaMock as never, {}, desdeDiasAtras(30), 'abertoEm');
    expect(out).toEqual([
      { dia: '2024-06-01', total: 2 },
      { dia: '2024-06-02', total: 1 },
    ]);
  });
});

describe('volumeSemanal', () => {
  it('agrupa por semana', async () => {
    findManyProcessoMock.mockResolvedValue([
      { abertoEm: new Date('2024-01-01T00:00:00Z') },
      { abertoEm: new Date('2024-01-02T00:00:00Z') },
    ]);
    const out = await volumeSemanal(prismaMock as never, {}, desdeDiasAtras(90));
    expect(out).toHaveLength(1);
    expect(out[0].total).toBe(2);
  });
});

describe('taxaAprovacaoRejeicao', () => {
  it('calcula porcentagens sobre encerrados', async () => {
    countMock.mockResolvedValueOnce(3).mockResolvedValueOnce(1); // aprovados, rejeitados
    const out = await taxaAprovacaoRejeicao(prismaMock as never, {}, desdeDiasAtras(30));
    expect(out.aprovados).toBe(3);
    expect(out.rejeitados).toBe(1);
    expect(out.taxaAprovacao).toBe(75);
    expect(out.taxaRejeicao).toBe(25);
  });

  it('taxas 0 quando não há encerrados', async () => {
    countMock.mockResolvedValue(0);
    const out = await taxaAprovacaoRejeicao(prismaMock as never, {}, desdeDiasAtras(30));
    expect(out.taxaAprovacao).toBe(0);
    expect(out.taxaRejeicao).toBe(0);
  });
});

describe('cargaPorServidor', () => {
  it('conta processos ativos por servidor ativo da unidade', async () => {
    findManyServidorMock.mockResolvedValue([
      { id: 's1', nome: 'Ana' },
      { id: 's2', nome: 'Bruno' },
    ]);
    countMock.mockResolvedValueOnce(4).mockResolvedValueOnce(1);

    const out = await cargaPorServidor(prismaMock as never, 'uni-1');
    expect(out).toEqual([
      { servidorId: 's1', nome: 'Ana', ativos: 4 },
      { servidorId: 's2', nome: 'Bruno', ativos: 1 },
    ]);
    expect(findManyServidorMock.mock.calls[0][0].where).toEqual({ unidadeId: 'uni-1', ativo: true });
  });
});

describe('porStatusPorUnidadeNaCategoria', () => {
  it('agrupa por status para cada unidade da categoria', async () => {
    findManyUnidadeMock.mockResolvedValue([{ id: 'u1', nome: 'Unidade 1' }]);
    groupByMock.mockResolvedValue([{ status: StatusProcesso.ABERTO, _count: { _all: 2 } }]);

    const out = await porStatusPorUnidadeNaCategoria(prismaMock as never, 'cat-1');
    expect(out).toEqual([
      { id: 'u1', nome: 'Unidade 1', porStatus: { [StatusProcesso.ABERTO]: 2 } },
    ]);
  });
});

describe('tempoMedioPorTipo', () => {
  it('agrega horas médias por tipo', async () => {
    findManyProcessoMock.mockResolvedValue([
      {
        tipoProcessoId: 't1',
        abertoEm: new Date('2024-06-01T00:00:00Z'),
        encerradoEm: new Date('2024-06-01T10:00:00Z'),
        tipoProcesso: { nome: 'Licença' },
      },
      {
        tipoProcessoId: 't1',
        abertoEm: new Date('2024-06-01T00:00:00Z'),
        encerradoEm: new Date('2024-06-01T20:00:00Z'),
        tipoProcesso: { nome: 'Licença' },
      },
    ]);
    const out = await tempoMedioPorTipo(prismaMock as never, 'cat-1', desdeDiasAtras(30));
    expect(out).toEqual([{ tipoProcessoId: 't1', nome: 'Licença', horas: 15 }]);
  });
});

describe('porStatusPorCategoria', () => {
  it('agrupa por status para cada categoria ativa', async () => {
    findManyCategoriaMock.mockResolvedValue([{ id: 'c1', nome: 'Obras' }]);
    groupByMock.mockResolvedValue([{ status: StatusProcesso.EM_ANDAMENTO, _count: { _all: 7 } }]);

    const out = await porStatusPorCategoria(prismaMock as never);
    expect(out).toEqual([
      { id: 'c1', nome: 'Obras', porStatus: { [StatusProcesso.EM_ANDAMENTO]: 7 } },
    ]);
  });
});

describe('compararPeriodos', () => {
  it('compara dois períodos e calcula variação percentual', async () => {
    countMock.mockResolvedValueOnce(12).mockResolvedValueOnce(10); // atual, anterior
    const out = await compararPeriodos(prismaMock as never, {}, 30, new Date('2024-06-30T00:00:00Z'));
    expect(out.periodoAtual).toBe(12);
    expect(out.periodoAnterior).toBe(10);
    expect(out.variacaoPercentual).toBe(20);
  });

  it('variação 0 quando o período anterior é 0', async () => {
    countMock.mockResolvedValueOnce(5).mockResolvedValueOnce(0);
    const out = await compararPeriodos(prismaMock as never, {}, 30);
    expect(out.variacaoPercentual).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Dashboards por perfil — escopo, cache e resiliência
// ---------------------------------------------------------------------------

describe('dashboardAnalista', () => {
  it('escopa por servidorResponsavelId e monta os 4 indicadores (Req 9.1)', async () => {
    groupByMock.mockResolvedValue([{ status: StatusProcesso.EM_ANDAMENTO, _count: { _all: 2 } }]);
    countMock.mockResolvedValue(1); // vencendoEm24h
    findManyProcessoMock.mockResolvedValue([]); // tempo + produtividade

    const d = deps();
    const out = await dashboardAnalista('srv-1', d);

    expect(out.porStatus).toEqual({ value: { [StatusProcesso.EM_ANDAMENTO]: 2 }, erro: false });
    expect(out.vencendoEm24h).toEqual({ value: 1, erro: false });
    expect(out.tempoMedioResolucaoHoras).toEqual({ value: 0, erro: false });
    expect(out.produtividadeDiaria).toEqual({ value: [], erro: false });

    // escopo aplicado ao groupBy
    expect(groupByMock.mock.calls[0][0].where).toEqual({ servidorResponsavelId: 'srv-1' });
  });

  it('um indicador falho não derruba os demais (Req 9.6)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    groupByMock.mockRejectedValue(new Error('db falhou')); // porStatus falha
    countMock.mockResolvedValue(3);
    findManyProcessoMock.mockResolvedValue([]);

    const out = await dashboardAnalista('srv-1', deps());
    expect(out.porStatus).toEqual({ value: null, erro: true });
    expect(out.vencendoEm24h).toEqual({ value: 3, erro: false });
    errSpy.mockRestore();
  });

  it('usa cache em hit sem consultar o prisma (Req 9.5)', async () => {
    const store = new Map<string, string>();
    store.set(
      chaveCacheDashboard('analista', 'srv-1'),
      JSON.stringify({ porStatus: { value: {}, erro: false } }),
    );
    const redis = makeRedis(store);

    const out = await dashboardAnalista('srv-1', { ...deps(), redis });
    expect(out).toEqual({ porStatus: { value: {}, erro: false } });
    expect(groupByMock).not.toHaveBeenCalled();
    expect(countMock).not.toHaveBeenCalled();
  });
});

describe('dashboardGestorUnidade', () => {
  it('escopa por unidadeId (Req 9.2)', async () => {
    groupByMock.mockResolvedValue([]);
    findManyServidorMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);
    findManyProcessoMock.mockResolvedValue([]);

    const out = await dashboardGestorUnidade('uni-9', deps());
    expect(out.porStatus.erro).toBe(false);
    expect(groupByMock.mock.calls[0][0].where).toEqual({ unidadeId: 'uni-9' });
  });
});
