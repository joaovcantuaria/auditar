import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCodes, StatusProcesso } from '@auditar/shared';

// ---------------------------------------------------------------------------
// Stubs dos módulos de infra (prisma/redis/auditoria) para evitar carregar o
// `@prisma/client` real e abrir conexões ao apenas IMPORTAR o serviço. Todos os
// testes injetam mocks explícitos via `deps`, então estes stubs só precisam
// existir como módulos resolvíveis.
// ---------------------------------------------------------------------------
vi.mock('../../../config/database.js', () => ({ prisma: {} }));
vi.mock('../../../config/redis.js', () => ({ redis: {} }));
vi.mock('../../../modules/auditoria/index.js', () => ({ registrar: vi.fn() }));

// Import AFTER mocks are registered.
import {
  listar,
  criar,
  editar,
  desativar,
  CATEGORIAS_CACHE_KEY,
  CATEGORIAS_CACHE_TTL_SECONDS,
  type CategoriasDeps,
  type AtorCategoria,
} from '../categorias.service.js';

// ---------------------------------------------------------------------------
// Mocks das dependências injetadas (prisma, redis, auditar).
// ---------------------------------------------------------------------------

const prismaMock = {
  categoria: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  processo: {
    count: vi.fn(),
  },
};

const redisMock = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};

const auditarMock = vi.fn();

function deps(): Partial<CategoriasDeps> {
  return {
    prisma: prismaMock as unknown as CategoriasDeps['prisma'],
    redis: redisMock as unknown as CategoriasDeps['redis'],
    auditar: auditarMock,
  };
}

const ATOR: AtorCategoria = { servidorId: 'srv-1', enderecoIp: '203.0.113.10' };

function makeCategoria(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cat-1',
    nome: 'Saúde',
    descricao: null,
    icone: null,
    cor: null,
    secretaria: null,
    ativa: true,
    gestorId: null,
    criadoEm: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  redisMock.get.mockResolvedValue(null);
  redisMock.set.mockResolvedValue('OK');
  redisMock.del.mockResolvedValue(1);
  auditarMock.mockResolvedValue(undefined);
  prismaMock.categoria.findMany.mockResolvedValue([]);
  prismaMock.processo.count.mockResolvedValue(0);
});

// ---------------------------------------------------------------------------
// criar
// ---------------------------------------------------------------------------

describe('criar', () => {
  it('rejeita nome em branco (Req 14.2)', async () => {
    await expect(
      criar({ nome: '   ' } as never, ATOR, deps()),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: ErrorCodes.VALIDATION_ERROR,
      field: 'nome',
    });
    expect(prismaMock.categoria.create).not.toHaveBeenCalled();
  });

  it('rejeita nome duplicado (case-insensitive) sem persistir (Req 14.2)', async () => {
    prismaMock.categoria.findMany.mockResolvedValue([makeCategoria({ id: 'x', nome: 'Saúde' })]);

    await expect(
      criar({ nome: 'saúde' }, ATOR, deps()),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'nome duplicado',
      field: 'nome',
    });
    expect(prismaMock.categoria.create).not.toHaveBeenCalled();
    expect(auditarMock).not.toHaveBeenCalled();
  });

  it('cria a categoria, invalida o cache e audita (Req 14.1)', async () => {
    prismaMock.categoria.findMany.mockResolvedValue([]);
    const criada = makeCategoria({ id: 'cat-9', nome: 'Educação' });
    prismaMock.categoria.create.mockResolvedValue(criada);

    const result = await criar({ nome: 'Educação', descricao: 'desc' }, ATOR, deps());

    expect(result).toBe(criada);
    expect(prismaMock.categoria.create).toHaveBeenCalledWith({
      data: {
        nome: 'Educação',
        descricao: 'desc',
        icone: undefined,
        cor: undefined,
        secretaria: undefined,
        gestorId: undefined,
      },
    });
    expect(redisMock.del).toHaveBeenCalledWith(CATEGORIAS_CACHE_KEY);
    expect(auditarMock).toHaveBeenCalledTimes(1);
    expect(auditarMock.mock.calls[0][0]).toMatchObject({
      tipoAcao: 'criar_categoria',
      modulo: 'categorias',
      objetoId: 'cat-9',
      atorServidorId: 'srv-1',
    });
  });
});

// ---------------------------------------------------------------------------
// editar
// ---------------------------------------------------------------------------

describe('editar', () => {
  it('rejeita nome duplicado excluindo o próprio registro (Req 14.2)', async () => {
    prismaMock.categoria.findUnique.mockResolvedValue(makeCategoria({ id: 'cat-1' }));
    prismaMock.categoria.findMany.mockResolvedValue([
      makeCategoria({ id: 'cat-1', nome: 'Saúde' }),
      makeCategoria({ id: 'cat-2', nome: 'Educação' }),
    ]);

    await expect(
      editar('cat-1', { nome: 'educação' }, ATOR, deps()),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'nome duplicado',
    });
    expect(prismaMock.categoria.update).not.toHaveBeenCalled();
  });

  it('permite manter o próprio nome (não conflita consigo mesmo)', async () => {
    prismaMock.categoria.findUnique.mockResolvedValue(makeCategoria({ id: 'cat-1', nome: 'Saúde' }));
    prismaMock.categoria.findMany.mockResolvedValue([makeCategoria({ id: 'cat-1', nome: 'Saúde' })]);
    const atualizada = makeCategoria({ id: 'cat-1', nome: 'Saúde', cor: '#fff' });
    prismaMock.categoria.update.mockResolvedValue(atualizada);

    const result = await editar('cat-1', { nome: 'Saúde', cor: '#fff' }, ATOR, deps());

    expect(result).toBe(atualizada);
    expect(redisMock.del).toHaveBeenCalledWith(CATEGORIAS_CACHE_KEY);
    expect(auditarMock).toHaveBeenCalledTimes(1);
    expect(auditarMock.mock.calls[0][0]).toMatchObject({ tipoAcao: 'editar_categoria' });
  });

  it('rejeita quando a categoria não existe', async () => {
    prismaMock.categoria.findUnique.mockResolvedValue(null);

    await expect(
      editar('inexistente', { nome: 'Nova' }, ATOR, deps()),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.categoria.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listar (cache)
// ---------------------------------------------------------------------------

describe('listar', () => {
  it('em cache miss consulta o banco e popula o cache com TTL 10min', async () => {
    redisMock.get.mockResolvedValue(null);
    const ativas = [makeCategoria({ id: 'a', ativa: true })];
    prismaMock.categoria.findMany
      .mockResolvedValueOnce(ativas) // ativas
      .mockResolvedValueOnce([]); // inativas

    const result = await listar(deps());

    expect(result).toEqual(ativas);
    expect(redisMock.set).toHaveBeenCalledWith(
      CATEGORIAS_CACHE_KEY,
      JSON.stringify(ativas),
      'EX',
      CATEGORIAS_CACHE_TTL_SECONDS,
    );
  });

  it('a segunda chamada usa o cache para as ativas (não re-consulta ativas no banco)', async () => {
    const ativas = [makeCategoria({ id: 'a', ativa: true })];
    // Cache hit devolve as ativas serializadas (datas viram strings no JSON).
    const cachedSerializado = JSON.stringify(ativas);
    redisMock.get.mockResolvedValue(cachedSerializado);
    // Apenas as inativas são buscadas no banco.
    prismaMock.categoria.findMany.mockResolvedValue([]);

    const result = await listar(deps());

    // O resultado das ativas vem exatamente do cache desserializado.
    expect(result).toEqual(JSON.parse(cachedSerializado));
    // Não popula o cache novamente em hit.
    expect(redisMock.set).not.toHaveBeenCalled();
    // Somente a consulta de inativas ocorreu.
    expect(prismaMock.categoria.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.categoria.findMany).toHaveBeenCalledWith({
      where: { ativa: false },
      orderBy: { nome: 'asc' },
    });
  });
});

// ---------------------------------------------------------------------------
// desativar
// ---------------------------------------------------------------------------

describe('desativar', () => {
  it('com processos em andamento retorna contagem e exige confirmação (Req 14.6)', async () => {
    prismaMock.categoria.findUnique.mockResolvedValue(makeCategoria());
    prismaMock.processo.count.mockResolvedValue(3);

    const result = await desativar('cat-1', ATOR, false, deps());

    expect(result).toEqual({ precisaConfirmacao: true, processosImpactados: 3 });
    expect(prismaMock.processo.count).toHaveBeenCalledWith({
      where: {
        status: {
          notIn: [StatusProcesso.FINALIZADO, StatusProcesso.REJEITADO, StatusProcesso.APROVADO],
        },
        tipoProcesso: { categoriaId: 'cat-1' },
      },
    });
    // Nada persistido/auditado enquanto não confirmado.
    expect(prismaMock.categoria.update).not.toHaveBeenCalled();
    expect(auditarMock).not.toHaveBeenCalled();
  });

  it('confirmado define ativa=false, invalida cache e audita (Req 14.7)', async () => {
    prismaMock.categoria.findUnique.mockResolvedValue(makeCategoria());
    prismaMock.processo.count.mockResolvedValue(3);
    const desativada = makeCategoria({ ativa: false });
    prismaMock.categoria.update.mockResolvedValue(desativada);

    const result = await desativar('cat-1', ATOR, true, deps());

    expect(prismaMock.categoria.update).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
      data: { ativa: false },
    });
    expect(result.precisaConfirmacao).toBe(false);
    expect(result.processosImpactados).toBe(3);
    expect(result.categoria).toBe(desativada);
    expect(redisMock.del).toHaveBeenCalledWith(CATEGORIAS_CACHE_KEY);
    expect(auditarMock).toHaveBeenCalledTimes(1);
    expect(auditarMock.mock.calls[0][0]).toMatchObject({ tipoAcao: 'desativar_categoria' });
  });

  it('sem processos impactados desativa imediatamente mesmo sem confirmar', async () => {
    prismaMock.categoria.findUnique.mockResolvedValue(makeCategoria());
    prismaMock.processo.count.mockResolvedValue(0);
    prismaMock.categoria.update.mockResolvedValue(makeCategoria({ ativa: false }));

    const result = await desativar('cat-1', ATOR, false, deps());

    expect(result.precisaConfirmacao).toBe(false);
    expect(prismaMock.categoria.update).toHaveBeenCalledTimes(1);
  });
});
