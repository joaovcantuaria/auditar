import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusProcesso } from '@auditar/shared';
import {
  abrirProcessoPeloServidor,
  type ProcessosServiceDeps,
  type AtorServidor,
} from '../processos.service.js';

/**
 * Testes unitários da abertura de Processo pelo Servidor no Painel
 * Administrativo (tarefa 20.2, Req. 23).
 *
 * Reutilizam o mesmo padrão de injeção de dependências dos testes de
 * `criarProcesso`: prisma/redis/auditar/formulário/notificar são mocks; nenhum
 * I/O real é exercitado. O foco é garantir que a abertura administrativa (a)
 * reaproveita o motor de criação, (b) aplica o prefixo do Protocolo e (c)
 * registra a Auditoria com o Servidor como ator e o Cidadão vinculado.
 */

const ATOR_SERVIDOR: AtorServidor = { servidorId: 'srv-9', enderecoIp: '203.0.113.50' };

function makeTipoProcesso(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tipo-1',
    ativo: true,
    prazoTotalDiasUteis: 10,
    categoriaId: 'cat-1',
    fluxoId: 'fluxo-1',
    categoria: { id: 'cat-1', ativa: true, prefixoProtocolo: null },
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
  return { id: 'uni-1', ativa: true, nome: 'Unidade Central', prefixoProtocolo: null, ...overrides };
}

function makeDto(overrides: Record<string, unknown> = {}) {
  return {
    tipoProcessoId: 'tipo-1',
    unidadeId: 'uni-1',
    respostas: [{ campoId: 'campo-1', valor: 'João' }],
    ...overrides,
  };
}

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
    cidadao: { findUnique: vi.fn().mockResolvedValue({ id: 'cid-1', nome: 'João' }) },
    tipoProcesso: { findUnique: vi.fn().mockResolvedValue(makeTipoProcesso()) },
    unidade: { findUnique: vi.fn().mockResolvedValue(makeUnidade()) },
    processo: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
  };

  const redis = { incr: vi.fn().mockResolvedValue(42), expire: vi.fn().mockResolvedValue(1) };
  const auditar = vi.fn().mockResolvedValue(undefined);
  const obterFormulario = vi
    .fn()
    .mockResolvedValue({ campos: [{ id: 'campo-1', obrigatorio: true, rotulo: 'Nome completo' }] });
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

  return { deps, prisma, tx, redis, auditar, notificar, agendarAtribuicao };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('abrirProcessoPeloServidor', () => {
  it('rejeita quando o Cidadão informado não existe (Req 23.2)', async () => {
    const ctx = makeCtx();
    ctx.prisma.cidadao.findUnique.mockResolvedValue(null);

    await expect(
      abrirProcessoPeloServidor('cid-inexistente', makeDto(), ATOR_SERVIDOR, ctx.deps),
    ).rejects.toMatchObject({ statusCode: 400, field: 'cidadaoId' });
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reutiliza o motor de criação: gera protocolo, notifica o cidadão e agenda atribuição', async () => {
    const ctx = makeCtx();

    const resultado = await abrirProcessoPeloServidor('cid-1', makeDto(), ATOR_SERVIDOR, ctx.deps);

    expect(resultado.processoId).toBe('proc-1');
    // Sem prefixo configurado, o formato permanece AAAA-NNNNN (retrocompat.).
    expect(resultado.protocolo).toMatch(/^\d{4}-\d{5}$/);
    // Notificação ao Cidadão com o protocolo (Req 23.6).
    expect(ctx.notificar).toHaveBeenCalledWith(
      expect.objectContaining({ destinatario: { cidadaoId: 'cid-1' }, conteudo: resultado.protocolo }),
    );
    expect(ctx.agendarAtribuicao).toHaveBeenCalledWith('proc-1', 'uni-1');
    // Processo criado vinculado ao Cidadão informado.
    const createData = ctx.tx.processo.create.mock.calls[0][0].data;
    expect(createData).toMatchObject({ cidadaoId: 'cid-1', status: StatusProcesso.ABERTO });
  });

  it('aplica o prefixo da Unidade ao Protocolo (precedência sobre a Categoria)', async () => {
    const ctx = makeCtx();
    ctx.prisma.unidade.findUnique.mockResolvedValue(makeUnidade({ prefixoProtocolo: 'SEC' }));
    ctx.prisma.tipoProcesso.findUnique.mockResolvedValue(
      makeTipoProcesso({ categoria: { id: 'cat-1', ativa: true, prefixoProtocolo: 'CAT' } }),
    );

    const resultado = await abrirProcessoPeloServidor('cid-1', makeDto(), ATOR_SERVIDOR, ctx.deps);

    expect(resultado.protocolo).toMatch(/^SEC-\d{4}-\d{5}$/);
    // A chave de sequência do Redis usa o prefixo resolvido.
    expect(ctx.redis.incr).toHaveBeenCalledWith(expect.stringContaining('SEC:'));
  });

  it('registra a Auditoria com o Servidor como ator e o Cidadão vinculado (Req 23.6)', async () => {
    const ctx = makeCtx();

    await abrirProcessoPeloServidor('cid-1', makeDto(), ATOR_SERVIDOR, ctx.deps);

    expect(ctx.auditar).toHaveBeenCalledWith(
      expect.objectContaining({
        ator: 'servidor',
        atorServidorId: 'srv-9',
        atorCidadaoId: 'cid-1',
        tipoAcao: 'abrir_processo_admin',
        modulo: 'processos',
        objetoId: 'proc-1',
      }),
    );
  });
});
