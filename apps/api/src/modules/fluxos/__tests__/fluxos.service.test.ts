import { describe, it, expect, vi } from 'vitest';

/**
 * Testes unitários do serviço de Fluxos e Etapas.
 * Cobrem os Requisitos 15.4, 15.5, 15.6, 15.7 e 15.8 usando um
 * Prisma/Redis/auditar simulados (sem I/O real).
 *
 * As dependências singleton (`config/database`, `config/redis`, auditoria) são
 * mockadas para evitar que o `@prisma/client` / ioredis reais sejam carregados
 * ao importar o serviço. Os testes injetam mocks explícitos via `deps`.
 */

vi.mock('../../../config/database.js', () => ({ prisma: {} }));
vi.mock('../../../config/redis.js', () => ({ redis: { del: vi.fn() } }));
vi.mock('../../../modules/auditoria/index.js', () => ({ registrar: vi.fn() }));

// Import APÓS o registro dos mocks.
const { listar, obter, criar, salvarEdicao, calcularPrazoTotal } = await import('../fluxos.service.js');
const { AppError } = await import('../../../utils/index.js');
type FluxosServiceDeps = import('../fluxos.service.js').FluxosServiceDeps;

const ATOR = { servidorId: 'srv-1', enderecoIp: '203.0.113.9' };

interface MockPrisma {
  fluxo: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

function makeDeps(): {
  deps: Partial<FluxosServiceDeps>;
  prisma: MockPrisma;
  redis: { del: ReturnType<typeof vi.fn> };
  auditar: ReturnType<typeof vi.fn>;
} {
  const prisma: MockPrisma = {
    fluxo: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  };
  const redis = { del: vi.fn().mockResolvedValue(1) };
  const auditar = vi.fn().mockResolvedValue(undefined);

  const deps: Partial<FluxosServiceDeps> = {
    prisma: prisma as unknown as FluxosServiceDeps['prisma'],
    redis,
    auditar,
  };
  return { deps, prisma, redis, auditar };
}

function etapa(overrides: Record<string, unknown> = {}) {
  return {
    nome: 'Triagem',
    prazosDiasUteis: 5,
    ...overrides,
  };
}

function criarDto(overrides: Record<string, unknown> = {}) {
  return {
    nome: 'Fluxo Padrão',
    etapas: [etapa()],
    ...overrides,
  };
}

describe('calcularPrazoTotal (Req. 15.5)', () => {
  it('soma os prazos em dias úteis de todas as etapas', () => {
    const total = calcularPrazoTotal([
      { prazosDiasUteis: 5 },
      { prazosDiasUteis: 10 },
      { prazosDiasUteis: 3 },
    ]);
    expect(total).toBe(18);
  });
});

describe('listar', () => {
  it('lista fluxos incluindo etapas ordenadas', async () => {
    const { deps, prisma } = makeDeps();
    prisma.fluxo.findMany.mockResolvedValue([{ id: 'f1', etapas: [] }]);

    const result = await listar(deps);

    expect(result).toEqual([{ id: 'f1', etapas: [] }]);
    expect(prisma.fluxo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          etapas: expect.objectContaining({ orderBy: { ordem: 'asc' }, include: { automacoes: true } }),
        }),
      }),
    );
  });
});

describe('obter (Req. 15.5)', () => {
  it('retorna o fluxo com prazoTotal = soma dos prazos das etapas', async () => {
    const { deps, prisma } = makeDeps();
    prisma.fluxo.findUnique.mockResolvedValue({
      id: 'f1',
      nome: 'Fluxo Padrão',
      versao: 1,
      etapas: [
        { id: 'e1', prazosDiasUteis: 5, ordem: 0, automacoes: [] },
        { id: 'e2', prazosDiasUteis: 7, ordem: 1, automacoes: [] },
      ],
    });

    const result = await obter('f1', deps);

    expect(result.prazoTotalDiasUteis).toBe(12);
  });

  it('lança erro quando o fluxo não existe', async () => {
    const { deps, prisma } = makeDeps();
    prisma.fluxo.findUnique.mockResolvedValue(null);

    await expect(obter('inexistente', deps)).rejects.toBeInstanceOf(AppError);
  });
});

describe('criar (Req. 15.6 / 15.7 / 15.8)', () => {
  it('rejeita fluxo sem etapas (Req. 15.6)', async () => {
    const { deps, prisma } = makeDeps();

    await expect(criar(criarDto({ etapas: [] }), ATOR, deps)).rejects.toBeInstanceOf(AppError);
    expect(prisma.fluxo.create).not.toHaveBeenCalled();
  });

  it('rejeita etapa com nome em branco (Req. 15.7)', async () => {
    const { deps, prisma } = makeDeps();

    await expect(
      criar(criarDto({ etapas: [etapa({ nome: '   ' })] }), ATOR, deps),
    ).rejects.toBeInstanceOf(AppError);
    expect(prisma.fluxo.create).not.toHaveBeenCalled();
  });

  it('rejeita etapa com prazo fora do intervalo [1,365] (Req. 15.7)', async () => {
    const { deps, prisma } = makeDeps();

    await expect(
      criar(criarDto({ etapas: [etapa({ prazosDiasUteis: 0 })] }), ATOR, deps),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      criar(criarDto({ etapas: [etapa({ prazosDiasUteis: 366 })] }), ATOR, deps),
    ).rejects.toBeInstanceOf(AppError);
    expect(prisma.fluxo.create).not.toHaveBeenCalled();
  });

  it('cria fluxo com ordem sequencial, automações aninhadas e auditoria (Req. 15.8)', async () => {
    const { deps, prisma, redis, auditar } = makeDeps();
    prisma.fluxo.create.mockResolvedValue({
      id: 'novo',
      nome: 'Fluxo Padrão',
      versao: 1,
      etapas: [
        { id: 'e1', ordem: 0, automacoes: [] },
        { id: 'e2', ordem: 1, automacoes: [{ tipo: 'email_cidadao', payload: '{}' }] },
      ],
    });

    const dto = criarDto({
      etapas: [
        etapa({ nome: 'Triagem', prazosDiasUteis: 5 }),
        etapa({
          nome: 'Análise',
          prazosDiasUteis: 10,
          automacoes: [{ tipo: 'email_cidadao', payload: '{}' }],
        }),
      ],
    });

    const result = await criar(dto, ATOR, deps);

    expect(result.id).toBe('novo');
    expect(prisma.fluxo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nome: 'Fluxo Padrão',
          versao: 1,
          criadoPorId: 'srv-1',
          etapas: {
            create: [
              expect.objectContaining({ nome: 'Triagem', prazosDiasUteis: 5, ordem: 0 }),
              expect.objectContaining({
                nome: 'Análise',
                prazosDiasUteis: 10,
                ordem: 1,
                automacoes: { create: [{ tipo: 'email_cidadao', payload: '{}' }] },
              }),
            ],
          },
        }),
      }),
    );
    expect(redis.del).toHaveBeenCalled();
    expect(auditar).toHaveBeenCalledWith(
      expect.objectContaining({ tipoAcao: 'criar_fluxo', objetoId: 'novo' }),
    );
  });
});

describe('salvarEdicao (Req. 15.4)', () => {
  it('cria uma NOVA versão (versao+1) preservando o fluxo anterior', async () => {
    const { deps, prisma, auditar } = makeDeps();
    prisma.fluxo.findUnique.mockResolvedValue({ id: 'f1', versao: 2, nome: 'Antigo' });
    prisma.fluxo.create.mockResolvedValue({
      id: 'f2',
      nome: 'Novo',
      versao: 3,
      etapas: [{ id: 'e1', ordem: 0, automacoes: [] }],
    });

    const result = await salvarEdicao('f1', criarDto({ nome: 'Novo' }), ATOR, deps);

    // Uma nova linha de Fluxo é criada com versao+1; o antigo não é atualizado.
    expect(prisma.fluxo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nome: 'Novo', versao: 3, criadoPorId: 'srv-1' }),
      }),
    );
    expect(result.id).toBe('f2');
    expect(result.versao).toBe(3);
    // O serviço não expõe update do fluxo — a versão anterior permanece intacta.
    expect((prisma.fluxo as unknown as Record<string, unknown>).update).toBeUndefined();
    expect(auditar).toHaveBeenCalledWith(
      expect.objectContaining({ tipoAcao: 'editar_fluxo', objetoId: 'f2' }),
    );
  });

  it('lança erro quando o fluxo não existe', async () => {
    const { deps, prisma } = makeDeps();
    prisma.fluxo.findUnique.mockResolvedValue(null);

    await expect(salvarEdicao('inexistente', criarDto(), ATOR, deps)).rejects.toBeInstanceOf(AppError);
  });

  it('rejeita edição sem etapas (Req. 15.6)', async () => {
    const { deps, prisma } = makeDeps();
    prisma.fluxo.findUnique.mockResolvedValue({ id: 'f1', versao: 1, nome: 'Antigo' });

    await expect(
      salvarEdicao('f1', criarDto({ etapas: [] }), ATOR, deps),
    ).rejects.toBeInstanceOf(AppError);
    expect(prisma.fluxo.create).not.toHaveBeenCalled();
  });
});
