import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCodes, StatusProcesso, TipoEvento } from '@auditar/shared';
import { calcularPrazoFinal } from '../../../utils/index.js';
import {
  criarProcesso,
  listarDoCidadao,
  type ProcessosServiceDeps,
  type Ator,
} from '../processos.service.js';

/**
 * Testes unitários da criação e listagem de Processos pelo Cidadão (Req. 4, 3).
 *
 * Todas as dependências (prisma, redis, auditar, obterFormulario, notificar,
 * agendarAtribuicao) são injetadas explicitamente via `deps` — nenhum I/O real
 * é exercitado. Como o serviço só toca `config/database.js`/`config/redis.js`
 * de forma preguiçosa (apenas quando `deps` está ausente), não é necessário
 * mockar esses módulos aqui (mesmo padrão de `servidores.service.test.ts`).
 */

const ATOR: Ator = { cidadaoId: 'cid-1', enderecoIp: '203.0.113.20' };

function makeTipoProcesso(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tipo-1',
    ativo: true,
    prazoTotalDiasUteis: 10,
    categoriaId: 'cat-1',
    fluxoId: 'fluxo-1',
    categoria: { id: 'cat-1', ativa: true },
    fluxo: {
      id: 'fluxo-1',
      etapas: [
        { id: 'etapa-1', ordem: 0 },
        { id: 'etapa-2', ordem: 1 },
      ],
    },
    ...overrides,
  };
}

function makeUnidade(overrides: Record<string, unknown> = {}) {
  return { id: 'uni-1', ativa: true, nome: 'Unidade Central', ...overrides };
}

function makeFormulario(overrides: Record<string, unknown> = {}) {
  return {
    campos: [
      { id: 'campo-1', obrigatorio: true, rotulo: 'Nome completo' },
      { id: 'campo-2', obrigatorio: false, rotulo: 'Observação' },
    ],
    ...overrides,
  };
}

function makeDto(overrides: Record<string, unknown> = {}) {
  return {
    tipoProcessoId: 'tipo-1',
    unidadeId: 'uni-1',
    respostas: [{ campoId: 'campo-1', valor: 'João' }],
    ...overrides,
  };
}

/** Monta um contexto de teste completo: prisma/tx/redis mocks + deps injetáveis. */
function makeCtx() {
  const tx = {
    processo: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'proc-1',
        ...data,
      })),
    },
    respostaFormulario: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    documento: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };

  const prisma = {
    tipoProcesso: { findUnique: vi.fn().mockResolvedValue(makeTipoProcesso()) },
    unidade: { findUnique: vi.fn().mockResolvedValue(makeUnidade()) },
    processo: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
  };

  const redis = {
    incr: vi.fn().mockResolvedValue(42),
    expire: vi.fn().mockResolvedValue(1),
  };

  const auditar = vi.fn().mockResolvedValue(undefined);
  const obterFormulario = vi.fn().mockResolvedValue(makeFormulario());
  const notificar = vi.fn().mockResolvedValue(undefined);
  const agendarAtribuicao = vi.fn().mockResolvedValue(undefined);

  const deps = {
    prisma,
    redis,
    auditar,
    obterFormulario,
    notificar,
    agendarAtribuicao,
  } as unknown as ProcessosServiceDeps;

  return { deps, prisma, tx, redis, auditar, obterFormulario, notificar, agendarAtribuicao };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// criarProcesso
// ---------------------------------------------------------------------------

describe('criarProcesso', () => {
  it('rejeita quando o Tipo de Processo está inativo', async () => {
    const ctx = makeCtx();
    ctx.prisma.tipoProcesso.findUnique.mockResolvedValue(makeTipoProcesso({ ativo: false }));

    await expect(criarProcesso('cid-1', makeDto(), ATOR, ctx.deps)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejeita quando a Categoria do Tipo de Processo está inativa', async () => {
    const ctx = makeCtx();
    ctx.prisma.tipoProcesso.findUnique.mockResolvedValue(
      makeTipoProcesso({ categoria: { id: 'cat-1', ativa: false } }),
    );

    await expect(criarProcesso('cid-1', makeDto(), ATOR, ctx.deps)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejeita quando a Unidade está inativa', async () => {
    const ctx = makeCtx();
    ctx.prisma.unidade.findUnique.mockResolvedValue(makeUnidade({ ativa: false }));

    await expect(criarProcesso('cid-1', makeDto(), ATOR, ctx.deps)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejeita e lista o campo pendente quando falta resposta obrigatória do formulário (Req 4.6)', async () => {
    const ctx = makeCtx();

    await expect(
      criarProcesso('cid-1', makeDto({ respostas: [] }), ATOR, ctx.deps),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: ErrorCodes.CAMPO_OBRIGATORIO,
      message: expect.stringContaining('Nome completo'),
    });
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('gera protocolo no formato AAAA-NNNNN (Req 4.8)', async () => {
    const ctx = makeCtx();

    const resultado = await criarProcesso('cid-1', makeDto(), ATOR, ctx.deps);

    expect(resultado.protocolo).toMatch(/^\d{4}-\d{5}$/);
    expect(resultado.processoId).toBe('proc-1');
  });

  it('calcula o prazoFinal a partir do prazoTotalDiasUteis do Tipo de Processo', async () => {
    const ctx = makeCtx();

    await criarProcesso('cid-1', makeDto(), ATOR, ctx.deps);

    const createData = ctx.tx.processo.create.mock.calls[0][0].data as {
      abertoEm: Date;
      prazoFinal: Date;
    };
    const esperado = calcularPrazoFinal(createData.abertoEm, 10);
    expect(createData.prazoFinal).toEqual(esperado);
  });

  it('cria o Processo e as RespostaFormulario dentro da transação com os campos corretos', async () => {
    const ctx = makeCtx();
    const dto = makeDto({
      respostas: [
        { campoId: 'campo-1', valor: 'João' },
        { campoId: 'campo-2', valor: { sim: true } },
      ],
    });

    await criarProcesso('cid-1', dto, ATOR, ctx.deps);

    const createData = ctx.tx.processo.create.mock.calls[0][0].data;
    expect(createData).toMatchObject({
      status: StatusProcesso.ABERTO,
      prioridade: 0,
      cidadaoId: 'cid-1',
      tipoProcessoId: 'tipo-1',
      unidadeId: 'uni-1',
      etapaAtualId: 'etapa-1',
      fluxoVersaoId: 'fluxo-1',
    });

    const respostasData = ctx.tx.respostaFormulario.createMany.mock.calls[0][0].data;
    expect(respostasData).toEqual([
      { processoId: 'proc-1', campoId: 'campo-1', valor: 'João' },
      { processoId: 'proc-1', campoId: 'campo-2', valor: JSON.stringify({ sim: true }) },
    ]);
  });

  it('vincula os documentoIds informados ao Processo criado dentro da transação', async () => {
    const ctx = makeCtx();
    const dto = makeDto({ documentoIds: ['doc-1', 'doc-2'] });

    await criarProcesso('cid-1', dto, ATOR, ctx.deps);

    expect(ctx.tx.documento.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['doc-1', 'doc-2'] } },
      data: { processoId: 'proc-1' },
    });
  });

  it('chama notificar e agendarAtribuicao após o commit, e audita com tipoAcao criar_processo', async () => {
    const ctx = makeCtx();

    const resultado = await criarProcesso('cid-1', makeDto(), ATOR, ctx.deps);

    expect(ctx.notificar).toHaveBeenCalledWith({
      tipo: 'painel',
      destinatario: { cidadaoId: 'cid-1' },
      tipoEvento: TipoEvento.CRIACAO_PROCESSO,
      conteudo: resultado.protocolo,
      processoId: 'proc-1',
    });
    expect(ctx.agendarAtribuicao).toHaveBeenCalledWith('proc-1', 'uni-1');
    expect(ctx.auditar).toHaveBeenCalledWith(
      expect.objectContaining({
        ator: 'cidadao',
        atorCidadaoId: 'cid-1',
        tipoAcao: 'criar_processo',
        modulo: 'processos',
        objetoId: 'proc-1',
      }),
    );
  });

  it('propaga erros da transação sem engolir, permitindo nova tentativa (Req 4.11)', async () => {
    const ctx = makeCtx();
    ctx.prisma.$transaction.mockRejectedValueOnce(new Error('conexão perdida'));

    await expect(criarProcesso('cid-1', makeDto(), ATOR, ctx.deps)).rejects.toThrow(
      'conexão perdida',
    );

    expect(ctx.notificar).not.toHaveBeenCalled();
    expect(ctx.agendarAtribuicao).not.toHaveBeenCalled();
    expect(ctx.auditar).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listarDoCidadao
// ---------------------------------------------------------------------------

describe('listarDoCidadao', () => {
  it('aplica os filtros de status, categoria e período combinados', async () => {
    const ctx = makeCtx();
    ctx.prisma.processo.findMany.mockResolvedValue([]);

    await listarDoCidadao(
      'cid-1',
      {
        status: 'aberto',
        categoriaId: 'cat-1',
        periodoInicio: '2024-01-01',
        periodoFim: '2024-12-31',
      },
      ctx.deps,
    );

    expect(ctx.prisma.processo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          cidadaoId: 'cid-1',
          status: 'aberto',
          tipoProcesso: { categoriaId: 'cat-1' },
          abertoEm: { gte: new Date('2024-01-01'), lte: new Date('2024-12-31') },
        },
        orderBy: { abertoEm: 'desc' },
      }),
    );
  });
});
