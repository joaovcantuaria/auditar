import { describe, it, expect, vi } from 'vitest';
import { StatusProcesso } from '@auditar/shared';

/**
 * Testes unitários do serviço de Tipos de Processo.
 * Cobrem os Requisitos 14.3, 14.4, 14.6 e 14.7 usando um Prisma/Redis/auditar
 * simulados (sem I/O real).
 *
 * As dependências singleton (`config/database`, `config/redis`, auditoria) são
 * mockadas para evitar que o `@prisma/client` / ioredis reais sejam carregados
 * ao importar o serviço. Os testes injetam mocks explícitos via `deps`.
 */

vi.mock('../../../config/database.js', () => ({ prisma: {} }));
vi.mock('../../../config/redis.js', () => ({ redis: { del: vi.fn() } }));
vi.mock('../../../modules/auditoria/index.js', () => ({ registrar: vi.fn() }));

// Import APÓS o registro dos mocks.
const { listar, criar, editar, desativar } = await import('../tipos.service.js');
const { AppError } = await import('../../../utils/index.js');
type TiposServiceDeps = import('../tipos.service.js').TiposServiceDeps;

const ATOR = { servidorId: 'srv-1', enderecoIp: '203.0.113.9' };

interface MockPrisma {
  tipoProcesso: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  processo: {
    count: ReturnType<typeof vi.fn>;
  };
}

function makeDeps(): { deps: Partial<TiposServiceDeps>; prisma: MockPrisma; redis: { del: ReturnType<typeof vi.fn> }; auditar: ReturnType<typeof vi.fn> } {
  const prisma: MockPrisma = {
    tipoProcesso: {
      findMany: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    processo: {
      count: vi.fn().mockResolvedValue(0),
    },
  };
  const redis = { del: vi.fn().mockResolvedValue(1) };
  const auditar = vi.fn().mockResolvedValue(undefined);

  const deps: Partial<TiposServiceDeps> = {
    prisma: prisma as unknown as TiposServiceDeps['prisma'],
    redis,
    auditar,
  };
  return { deps, prisma, redis, auditar };
}

const CATEGORIA = '11111111-1111-1111-1111-111111111111';
const UNIDADE = '22222222-2222-2222-2222-222222222222';

function criarDto(overrides: Record<string, unknown> = {}) {
  return {
    nome: 'Alvará de Construção',
    categoriaId: CATEGORIA,
    prazoTotalDiasUteis: 30,
    unidadesIds: [UNIDADE],
    ...overrides,
  };
}

describe('listar', () => {
  it('lista sem filtro incluindo as unidades associadas', async () => {
    const { deps, prisma } = makeDeps();
    prisma.tipoProcesso.findMany.mockResolvedValue([{ id: 't1', unidades: [] }]);

    const result = await listar(undefined, deps);

    expect(result).toEqual([{ id: 't1', unidades: [] }]);
    expect(prisma.tipoProcesso.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined, include: { unidades: true } }),
    );
  });

  it('filtra por categoria quando informada', async () => {
    const { deps, prisma } = makeDeps();
    prisma.tipoProcesso.findMany.mockResolvedValue([]);

    await listar(CATEGORIA, deps);

    expect(prisma.tipoProcesso.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { categoriaId: CATEGORIA } }),
    );
  });
});

describe('criar (Req. 14.3 / 14.4)', () => {
  it('rejeita nome duplicado dentro da mesma categoria', async () => {
    const { deps, prisma } = makeDeps();
    prisma.tipoProcesso.findFirst.mockResolvedValue({ id: 'existente' });

    await expect(criar(criarDto(), ATOR, deps)).rejects.toBeInstanceOf(AppError);
    expect(prisma.tipoProcesso.create).not.toHaveBeenCalled();
    // A checagem de unicidade é restrita à categoria e case-insensitive.
    expect(prisma.tipoProcesso.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          categoriaId: CATEGORIA,
          nome: { equals: 'Alvará de Construção', mode: 'insensitive' },
        }),
      }),
    );
  });

  it('cria com unidades conectadas e registra auditoria', async () => {
    const { deps, prisma, redis, auditar } = makeDeps();
    prisma.tipoProcesso.create.mockResolvedValue({
      id: 'novo',
      nome: 'Alvará de Construção',
      categoriaId: CATEGORIA,
      unidades: [{ tipoProcessoId: 'novo', unidadeId: UNIDADE }],
    });

    const result = await criar(criarDto(), ATOR, deps);

    expect(result.id).toBe('novo');
    expect(prisma.tipoProcesso.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nome: 'Alvará de Construção',
          categoriaId: CATEGORIA,
          prazoTotalDiasUteis: 30,
          unidades: { create: [{ unidadeId: UNIDADE }] },
        }),
        include: { unidades: true },
      }),
    );
    expect(redis.del).toHaveBeenCalled();
    expect(auditar).toHaveBeenCalledWith(
      expect.objectContaining({ tipoAcao: 'criar_tipo_processo', objetoId: 'novo' }),
    );
  });

  it('rejeita prazo fora do intervalo [1,365]', async () => {
    const { deps, prisma } = makeDeps();

    await expect(criar(criarDto({ prazoTotalDiasUteis: 0 }), ATOR, deps)).rejects.toBeInstanceOf(AppError);
    await expect(criar(criarDto({ prazoTotalDiasUteis: 366 }), ATOR, deps)).rejects.toBeInstanceOf(AppError);
    expect(prisma.tipoProcesso.create).not.toHaveBeenCalled();
  });

  it('rejeita unidades vazias', async () => {
    const { deps, prisma } = makeDeps();

    await expect(criar(criarDto({ unidadesIds: [] }), ATOR, deps)).rejects.toBeInstanceOf(AppError);
    expect(prisma.tipoProcesso.create).not.toHaveBeenCalled();
  });
});

describe('editar (Req. 14.4)', () => {
  it('rejeita nome duplicado na categoria, excluindo o próprio registro', async () => {
    const { deps, prisma } = makeDeps();
    prisma.tipoProcesso.findUnique.mockResolvedValue({
      id: 't1',
      nome: 'Antigo',
      categoriaId: CATEGORIA,
      unidades: [],
    });
    prisma.tipoProcesso.findFirst.mockResolvedValue({ id: 'outro' });

    await expect(editar('t1', { nome: 'Novo Nome' }, ATOR, deps)).rejects.toBeInstanceOf(AppError);
    expect(prisma.tipoProcesso.update).not.toHaveBeenCalled();
    expect(prisma.tipoProcesso.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ categoriaId: CATEGORIA, id: { not: 't1' } }),
      }),
    );
  });

  it('atualiza e reconcilia unidades quando unidadesIds é informado', async () => {
    const { deps, prisma, auditar } = makeDeps();
    prisma.tipoProcesso.findUnique.mockResolvedValue({
      id: 't1',
      nome: 'Antigo',
      categoriaId: CATEGORIA,
      unidades: [],
    });
    prisma.tipoProcesso.update.mockResolvedValue({
      id: 't1',
      nome: 'Antigo',
      categoriaId: CATEGORIA,
      unidades: [{ unidadeId: UNIDADE }],
    });

    await editar('t1', { unidadesIds: [UNIDADE] }, ATOR, deps);

    expect(prisma.tipoProcesso.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: expect.objectContaining({
          unidades: { deleteMany: {}, create: [{ unidadeId: UNIDADE }] },
        }),
      }),
    );
    expect(auditar).toHaveBeenCalledWith(
      expect.objectContaining({ tipoAcao: 'editar_tipo_processo', objetoId: 't1' }),
    );
  });

  it('lança erro quando o tipo não existe', async () => {
    const { deps, prisma } = makeDeps();
    prisma.tipoProcesso.findUnique.mockResolvedValue(null);

    await expect(editar('inexistente', { nome: 'X' }, ATOR, deps)).rejects.toBeInstanceOf(AppError);
  });
});

describe('desativar (Req. 14.6 / 14.7)', () => {
  it('exige confirmação quando há processos em andamento, retornando a contagem', async () => {
    const { deps, prisma, auditar } = makeDeps();
    prisma.tipoProcesso.findUnique.mockResolvedValue({ id: 't1', ativo: true });
    prisma.processo.count.mockResolvedValue(3);

    const result = await desativar('t1', false, ATOR, deps);

    expect(result).toEqual({ requerConfirmacao: true, processosImpactados: 3 });
    // Não altera o tipo nem processos existentes (Req. 14.7).
    expect(prisma.tipoProcesso.update).not.toHaveBeenCalled();
    expect(auditar).not.toHaveBeenCalled();
    // Só conta processos NÃO terminais.
    expect(prisma.processo.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tipoProcessoId: 't1',
          status: {
            notIn: [StatusProcesso.FINALIZADO, StatusProcesso.REJEITADO, StatusProcesso.APROVADO],
          },
        }),
      }),
    );
  });

  it('desativa (ativo=false) quando confirmado, mesmo com processos em andamento', async () => {
    const { deps, prisma, redis, auditar } = makeDeps();
    prisma.tipoProcesso.findUnique.mockResolvedValue({ id: 't1', ativo: true });
    prisma.processo.count.mockResolvedValue(3);
    prisma.tipoProcesso.update.mockResolvedValue({ id: 't1', ativo: false, unidades: [] });

    const result = await desativar('t1', true, ATOR, deps);

    expect(result).toEqual({ requerConfirmacao: false, tipo: { id: 't1', ativo: false, unidades: [] } });
    expect(prisma.tipoProcesso.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' }, data: { ativo: false } }),
    );
    expect(redis.del).toHaveBeenCalled();
    expect(auditar).toHaveBeenCalledWith(
      expect.objectContaining({ tipoAcao: 'desativar_tipo_processo', objetoId: 't1' }),
    );
  });

  it('desativa direto quando não há processos em andamento', async () => {
    const { deps, prisma } = makeDeps();
    prisma.tipoProcesso.findUnique.mockResolvedValue({ id: 't1', ativo: true });
    prisma.processo.count.mockResolvedValue(0);
    prisma.tipoProcesso.update.mockResolvedValue({ id: 't1', ativo: false, unidades: [] });

    const result = await desativar('t1', false, ATOR, deps);

    expect(result.requerConfirmacao).toBe(false);
    expect(prisma.tipoProcesso.update).toHaveBeenCalled();
  });

  it('lança erro quando o tipo não existe', async () => {
    const { deps, prisma } = makeDeps();
    prisma.tipoProcesso.findUnique.mockResolvedValue(null);

    await expect(desativar('inexistente', true, ATOR, deps)).rejects.toBeInstanceOf(AppError);
  });
});
