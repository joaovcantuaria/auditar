import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModoAtribuicao } from '@auditar/shared';
import { AppError } from '../../../utils/errors.js';
import { criarUnidadeSchema, editarUnidadeSchema } from '../unidades.schema.js';
import {
  listar,
  criar,
  editar,
  desativar,
  contarProcessosEmAndamento,
  type UnidadesDeps,
  type Ator,
} from '../unidades.service.js';

// ---------------------------------------------------------------------------
// Helpers de mock
// ---------------------------------------------------------------------------

const ator: Ator = { servidorId: 'srv-1', enderecoIp: '203.0.113.9' };

function makeDeps() {
  const unidade = {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const processo = {
    count: vi.fn(),
  };
  const auditar = vi.fn().mockResolvedValue(undefined);

  const deps = {
    prisma: { unidade, processo },
    redis: {},
    auditar,
  } as unknown as UnidadesDeps;

  return { deps, unidade, processo, auditar };
}

function unidadeValida(overrides: Record<string, unknown> = {}) {
  return {
    nome: 'Secretaria de Obras',
    secretaria: 'Obras',
    gestorId: 'srv-gestor-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema — campos obrigatórios e formato (Req. 14.5)
// ---------------------------------------------------------------------------

describe('criarUnidadeSchema', () => {
  it('rejeita criação sem nome (campo obrigatório)', () => {
    const result = criarUnidadeSchema.safeParse(unidadeValida({ nome: undefined }));
    expect(result.success).toBe(false);
  });

  it('rejeita criação sem gestor responsável', () => {
    const result = criarUnidadeSchema.safeParse(unidadeValida({ gestorId: undefined }));
    expect(result.success).toBe(false);
  });

  it('rejeita nome com mais de 100 caracteres', () => {
    const result = criarUnidadeSchema.safeParse(unidadeValida({ nome: 'x'.repeat(101) }));
    expect(result.success).toBe(false);
  });

  it('aplica modoAtribuicao "manual" por padrão', () => {
    const result = criarUnidadeSchema.parse(unidadeValida());
    expect(result.modoAtribuicao).toBe(ModoAtribuicao.MANUAL);
  });

  it('rejeita telefone com formato inválido (menos de 10 dígitos)', () => {
    const result = criarUnidadeSchema.safeParse(unidadeValida({ telefone: '119999' }));
    expect(result.success).toBe(false);
  });

  it('rejeita telefone com caracteres não numéricos', () => {
    const result = criarUnidadeSchema.safeParse(unidadeValida({ telefone: '(11) 99999-9999' }));
    expect(result.success).toBe(false);
  });

  it('aceita telefone com 10 dígitos', () => {
    const result = criarUnidadeSchema.safeParse(unidadeValida({ telefone: '1133334444' }));
    expect(result.success).toBe(true);
  });

  it('aceita telefone com 11 dígitos', () => {
    const result = criarUnidadeSchema.safeParse(unidadeValida({ telefone: '11999998888' }));
    expect(result.success).toBe(true);
  });

  it('rejeita endereço com mais de 300 caracteres', () => {
    const result = criarUnidadeSchema.safeParse(unidadeValida({ endereco: 'x'.repeat(301) }));
    expect(result.success).toBe(false);
  });
});

describe('editarUnidadeSchema', () => {
  it('aceita objeto vazio (todos os campos opcionais)', () => {
    expect(editarUnidadeSchema.safeParse({}).success).toBe(true);
  });

  it('mantém validação de telefone quando informado', () => {
    expect(editarUnidadeSchema.safeParse({ telefone: '123' }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// criar (Req. 14.5)
// ---------------------------------------------------------------------------

describe('criar', () => {
  it('cria a unidade e registra a auditoria', async () => {
    const { deps, unidade, auditar } = makeDeps();
    const criada = { id: 'uni-1', nome: 'Secretaria de Obras', ativa: true };
    unidade.create.mockResolvedValue(criada);

    const dto = criarUnidadeSchema.parse(unidadeValida());
    const result = await criar(dto, ator, deps);

    expect(result).toEqual(criada);
    expect(unidade.create).toHaveBeenCalledTimes(1);
    expect(unidade.create.mock.calls[0][0].data).toMatchObject({
      nome: 'Secretaria de Obras',
      secretaria: 'Obras',
      gestorId: 'srv-gestor-1',
      modoAtribuicao: ModoAtribuicao.MANUAL,
    });
    expect(auditar).toHaveBeenCalledTimes(1);
    expect(auditar.mock.calls[0][0]).toMatchObject({
      tipoAcao: 'criar_unidade',
      modulo: 'unidades',
      tipoObjeto: 'Unidade',
      objetoId: 'uni-1',
      atorServidorId: 'srv-1',
    });
  });

  it('rejeita criação quando um campo obrigatório está ausente (guarda do serviço)', async () => {
    const { deps, unidade, auditar } = makeDeps();

    await expect(
      criar({ nome: '', secretaria: 'Obras', gestorId: 'g1' } as never, ator, deps),
    ).rejects.toBeInstanceOf(AppError);

    expect(unidade.create).not.toHaveBeenCalled();
    expect(auditar).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// editar (Req. 14.5)
// ---------------------------------------------------------------------------

describe('editar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('atualiza campos e registra auditoria', async () => {
    const { deps, unidade, auditar } = makeDeps();
    unidade.findUnique.mockResolvedValue({ id: 'uni-1', nome: 'Antigo', ativa: true });
    const atualizada = { id: 'uni-1', nome: 'Novo Nome', ativa: true };
    unidade.update.mockResolvedValue(atualizada);

    const dto = editarUnidadeSchema.parse({ nome: 'Novo Nome' });
    const result = await editar('uni-1', dto, ator, deps);

    expect(result).toEqual(atualizada);
    expect(unidade.update).toHaveBeenCalledWith({
      where: { id: 'uni-1' },
      data: { nome: 'Novo Nome' },
    });
    expect(auditar).toHaveBeenCalledTimes(1);
    expect(auditar.mock.calls[0][0].tipoAcao).toBe('editar_unidade');
  });

  it('lança erro quando a unidade não existe', async () => {
    const { deps, unidade } = makeDeps();
    unidade.findUnique.mockResolvedValue(null);

    await expect(editar('inexistente', {}, ator, deps)).rejects.toBeInstanceOf(AppError);
    expect(unidade.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// contarProcessosEmAndamento (Req. 14.6)
// ---------------------------------------------------------------------------

describe('contarProcessosEmAndamento', () => {
  it('conta processos com status fora do conjunto encerrado', async () => {
    const { deps, processo } = makeDeps();
    processo.count.mockResolvedValue(3);

    const total = await contarProcessosEmAndamento('uni-1', deps);

    expect(total).toBe(3);
    const arg = processo.count.mock.calls[0][0];
    expect(arg.where.unidadeId).toBe('uni-1');
    expect(arg.where.status.notIn).toEqual(
      expect.arrayContaining(['finalizado', 'rejeitado', 'cancelado']),
    );
  });
});

// ---------------------------------------------------------------------------
// desativar (Req. 14.6, 14.7)
// ---------------------------------------------------------------------------

describe('desativar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exige confirmação retornando a contagem quando há processos em andamento', async () => {
    const { deps, unidade, processo, auditar } = makeDeps();
    unidade.findUnique.mockResolvedValue({ id: 'uni-1', ativa: true });
    processo.count.mockResolvedValue(5);

    const result = await desativar('uni-1', false, ator, deps);

    expect(result).toEqual({ requerConfirmacao: true, processosImpactados: 5 });
    // Não persiste alterações nem audita quando aguarda confirmação (Req. 14.6).
    expect(unidade.update).not.toHaveBeenCalled();
    expect(auditar).not.toHaveBeenCalled();
  });

  it('desativa (ativa=false) e audita quando confirmado', async () => {
    const { deps, unidade, processo, auditar } = makeDeps();
    unidade.findUnique.mockResolvedValue({ id: 'uni-1', ativa: true });
    processo.count.mockResolvedValue(2);
    unidade.update.mockResolvedValue({ id: 'uni-1', ativa: false });

    const result = await desativar('uni-1', true, ator, deps);

    expect(result).toEqual({ id: 'uni-1', ativa: false });
    expect(unidade.update).toHaveBeenCalledWith({
      where: { id: 'uni-1' },
      data: { ativa: false },
    });
    expect(auditar).toHaveBeenCalledTimes(1);
    expect(auditar.mock.calls[0][0].tipoAcao).toBe('desativar_unidade');
  });

  it('desativa diretamente quando não há processos em andamento', async () => {
    const { deps, unidade, processo } = makeDeps();
    unidade.findUnique.mockResolvedValue({ id: 'uni-1', ativa: true });
    processo.count.mockResolvedValue(0);
    unidade.update.mockResolvedValue({ id: 'uni-1', ativa: false });

    const result = await desativar('uni-1', false, ator, deps);

    expect(result).toEqual({ id: 'uni-1', ativa: false });
    expect(unidade.update).toHaveBeenCalledTimes(1);
  });

  it('lança erro quando a unidade não existe', async () => {
    const { deps, unidade } = makeDeps();
    unidade.findUnique.mockResolvedValue(null);

    await expect(desativar('inexistente', true, ator, deps)).rejects.toBeInstanceOf(AppError);
  });
});

// ---------------------------------------------------------------------------
// listar
// ---------------------------------------------------------------------------

describe('listar', () => {
  it('aplica filtros de ativa e secretaria', async () => {
    const { deps, unidade } = makeDeps();
    unidade.findMany.mockResolvedValue([]);

    await listar({ ativa: true, secretaria: 'Obras' }, deps);

    expect(unidade.findMany).toHaveBeenCalledWith({
      where: { ativa: true, secretaria: 'Obras' },
      orderBy: { nome: 'asc' },
    });
  });

  it('lista sem filtros quando nenhum é informado', async () => {
    const { deps, unidade } = makeDeps();
    unidade.findMany.mockResolvedValue([]);

    await listar({}, deps);

    expect(unidade.findMany).toHaveBeenCalledWith({ where: {}, orderBy: { nome: 'asc' } });
  });
});
