import { describe, it, expect, vi } from 'vitest';
import { StatusProcesso, TipoEvento } from '@auditar/shared';

// Mock bullmq so importing the worker never opens a Redis connection and never
// requires the `bullmq` native module to resolve in the test transform.
vi.mock('bullmq', () => ({
  Queue: class {},
  Worker: class {},
  ConnectionOptions: class {},
}));

// Stub the auditoria barrel: `mensagens.publico.service.js` (imported for
// STATUS_ENCERRADOS) pulls it in transitively, and it loads `bullmq` as a real
// value otherwise. Same pattern used by mensagens.publico.service.test.ts.
vi.mock('../../modules/auditoria/index.js', () => ({ registrar: vi.fn() }));

// Avoid loading the real prisma client / env validation just by importing the
// worker module. The passes always receive an injected prisma in these tests.
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));

import {
  verificarPrazosVencendo,
  marcarEtapasVencidas,
  verificarFilaEstagnada,
  processarPrazoCheck,
  FILA_ESTAGNADA_MS,
  type PrazoWorkerDeps,
} from '../prazo.worker.js';

// ---------------------------------------------------------------------------
// Test helpers — a fixed "now" and a small prisma mock so every pass is
// deterministic and Redis-free.
// ---------------------------------------------------------------------------

// Fixed clock: a Wednesday (2025-06-11 12:00 UTC) to keep business-day math
// predictable and away from weekends/holidays.
const NOW = new Date('2025-06-11T12:00:00.000Z');
const now = () => new Date(NOW);

/** Business days from NOW: 2025-06-13 is Fri (2 business days ahead). */
const DEADLINE_2_DIAS = new Date('2025-06-13T12:00:00.000Z');
/** 2025-06-30 is well beyond the 3-business-day window. */
const DEADLINE_LONGE = new Date('2025-06-30T12:00:00.000Z');
/** Already past. */
const DEADLINE_PASSADO = new Date('2025-06-09T12:00:00.000Z');

function makePrismaMock(overrides?: {
  findMany?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
}) {
  const findMany = overrides?.findMany ?? vi.fn().mockResolvedValue([]);
  const update = overrides?.update ?? vi.fn().mockResolvedValue({});
  return {
    prisma: { processo: { findMany, update } },
    findMany,
    update,
  };
}

function makeDeps(prismaMock: ReturnType<typeof makePrismaMock>): PrazoWorkerDeps {
  return {
    prisma: prismaMock.prisma as unknown as PrazoWorkerDeps['prisma'],
    enqueue: vi.fn().mockResolvedValue(undefined),
    now,
  };
}

// ---------------------------------------------------------------------------
// Pass 1 — verificarPrazosVencendo (Req. 6.6)
// ---------------------------------------------------------------------------

describe('verificarPrazosVencendo', () => {
  it('enfileira alerta ao cidadão para processos dentro de 3 dias úteis', async () => {
    const prismaMock = makePrismaMock({
      findMany: vi.fn().mockResolvedValue([
        { id: 'p1', protocolo: '2025-00001', cidadaoId: 'cid-1', prazoFinal: DEADLINE_2_DIAS },
      ]),
    });
    const deps = makeDeps(prismaMock);

    const count = await verificarPrazosVencendo(deps);

    expect(count).toBe(1);
    expect(deps.enqueue).toHaveBeenCalledTimes(1);
    expect(deps.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'painel',
        destinatario: { cidadaoId: 'cid-1' },
        tipoEvento: TipoEvento.VENCIMENTO_PRAZO,
        processoId: 'p1',
      }),
    );
  });

  it('ignora processos cujo prazo está fora da janela de 3 dias úteis', async () => {
    const prismaMock = makePrismaMock({
      findMany: vi.fn().mockResolvedValue([
        { id: 'p2', protocolo: '2025-00002', cidadaoId: 'cid-2', prazoFinal: DEADLINE_LONGE },
      ]),
    });
    const deps = makeDeps(prismaMock);

    const count = await verificarPrazosVencendo(deps);

    expect(count).toBe(0);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it('exclui processos encerrados e vencidos já na query', async () => {
    const prismaMock = makePrismaMock();
    const deps = makeDeps(prismaMock);

    await verificarPrazosVencendo(deps);

    const whereArg = prismaMock.findMany.mock.calls[0][0].where;
    expect(whereArg.status.notIn).toContain(StatusProcesso.FINALIZADO);
    expect(whereArg.status.notIn).toContain(StatusProcesso.REJEITADO);
    expect(whereArg.status.notIn).toContain(StatusProcesso.APROVADO);
    expect(whereArg.status.notIn).toContain(StatusProcesso.VENCIDO);
    // Deadline must still be in the future (past ones are pass 2's job).
    expect(whereArg.prazoFinal).toEqual({ gte: NOW });
  });
});

// ---------------------------------------------------------------------------
// Pass 2 — marcarEtapasVencidas (Req. 11.8)
// ---------------------------------------------------------------------------

describe('marcarEtapasVencidas', () => {
  it('marca o processo como VENCIDO e notifica o gestor da unidade', async () => {
    const prismaMock = makePrismaMock({
      findMany: vi.fn().mockResolvedValue([
        { id: 'p1', protocolo: '2025-00001', unidade: { gestorId: 'gestor-1' } },
      ]),
    });
    const deps = makeDeps(prismaMock);

    const count = await marcarEtapasVencidas(deps);

    expect(count).toBe(1);
    expect(prismaMock.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { status: StatusProcesso.VENCIDO },
    });
    expect(deps.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'painel',
        destinatario: { servidorId: 'gestor-1' },
        tipoEvento: TipoEvento.VENCIMENTO_PRAZO,
        processoId: 'p1',
      }),
    );
  });

  it('marca como VENCIDO mas NÃO notifica quando gestorId é null', async () => {
    const prismaMock = makePrismaMock({
      findMany: vi.fn().mockResolvedValue([
        { id: 'p3', protocolo: '2025-00003', unidade: { gestorId: null } },
      ]),
    });
    const deps = makeDeps(prismaMock);

    const count = await marcarEtapasVencidas(deps);

    expect(count).toBe(0);
    expect(prismaMock.update).toHaveBeenCalledWith({
      where: { id: 'p3' },
      data: { status: StatusProcesso.VENCIDO },
    });
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it('busca apenas processos ativos com prazo já ultrapassado', async () => {
    const prismaMock = makePrismaMock();
    const deps = makeDeps(prismaMock);

    await marcarEtapasVencidas(deps);

    const whereArg = prismaMock.findMany.mock.calls[0][0].where;
    expect(whereArg.prazoFinal).toEqual({ lt: NOW });
    expect(whereArg.status.notIn).toContain(StatusProcesso.VENCIDO);
  });

  it('não aborta o pass quando uma linha falha ao atualizar', async () => {
    const update = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue({});
    const prismaMock = makePrismaMock({
      findMany: vi.fn().mockResolvedValue([
        { id: 'bad', protocolo: '2025-0BAD', unidade: { gestorId: 'g1' } },
        { id: 'ok', protocolo: '2025-00OK', unidade: { gestorId: 'g2' } },
      ]),
      update,
    });
    const deps = makeDeps(prismaMock);

    const count = await marcarEtapasVencidas(deps);

    // First row threw; second row still processed.
    expect(count).toBe(1);
    expect(deps.enqueue).toHaveBeenCalledTimes(1);
    expect(deps.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ destinatario: { servidorId: 'g2' } }),
    );
  });
});

// ---------------------------------------------------------------------------
// Pass 3 — verificarFilaEstagnada (Req. 12.6)
// ---------------------------------------------------------------------------

describe('verificarFilaEstagnada', () => {
  it('notifica o gestor para processos na fila há mais de 24h (via abertoEm)', async () => {
    const antigo = new Date(NOW.getTime() - FILA_ESTAGNADA_MS - 60_000); // 24h + 1min
    const prismaMock = makePrismaMock({
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'p1',
          protocolo: '2025-00001',
          abertoEm: antigo,
          unidade: { gestorId: 'gestor-1' },
          movimentacoes: [],
        },
      ]),
    });
    const deps = makeDeps(prismaMock);

    const count = await verificarFilaEstagnada(deps);

    expect(count).toBe(1);
    expect(deps.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'painel',
        destinatario: { servidorId: 'gestor-1' },
        tipoEvento: TipoEvento.VENCIMENTO_PRAZO,
        processoId: 'p1',
      }),
    );
  });

  it('usa a movimentação mais recente como proxy de entrada na fila', async () => {
    const recente = new Date(NOW.getTime() - 60 * 60 * 1000); // 1h ago → NOT stale
    const antigoAberto = new Date(NOW.getTime() - FILA_ESTAGNADA_MS - 60_000);
    const prismaMock = makePrismaMock({
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'p2',
          protocolo: '2025-00002',
          abertoEm: antigoAberto,
          unidade: { gestorId: 'gestor-2' },
          movimentacoes: [{ realizadoEm: recente }],
        },
      ]),
    });
    const deps = makeDeps(prismaMock);

    const count = await verificarFilaEstagnada(deps);

    // Latest movimentação (1h ago) is recent → not stale despite old abertoEm.
    expect(count).toBe(0);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it('ignora processos na fila há menos de 24h', async () => {
    const recente = new Date(NOW.getTime() - 60 * 60 * 1000); // 1h ago
    const prismaMock = makePrismaMock({
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'p3',
          protocolo: '2025-00003',
          abertoEm: recente,
          unidade: { gestorId: 'gestor-3' },
          movimentacoes: [],
        },
      ]),
    });
    const deps = makeDeps(prismaMock);

    const count = await verificarFilaEstagnada(deps);

    expect(count).toBe(0);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it('pula processos estagnados sem gestor na unidade', async () => {
    const antigo = new Date(NOW.getTime() - FILA_ESTAGNADA_MS - 60_000);
    const prismaMock = makePrismaMock({
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'p4',
          protocolo: '2025-00004',
          abertoEm: antigo,
          unidade: { gestorId: null },
          movimentacoes: [],
        },
      ]),
    });
    const deps = makeDeps(prismaMock);

    const count = await verificarFilaEstagnada(deps);

    expect(count).toBe(0);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it('filtra apenas processos sem servidor responsável e ativos', async () => {
    const prismaMock = makePrismaMock();
    const deps = makeDeps(prismaMock);

    await verificarFilaEstagnada(deps);

    const whereArg = prismaMock.findMany.mock.calls[0][0].where;
    expect(whereArg.servidorResponsavelId).toBeNull();
    expect(whereArg.status.notIn).toContain(StatusProcesso.FINALIZADO);
  });
});

// ---------------------------------------------------------------------------
// Top-level processor — isolates each pass.
// ---------------------------------------------------------------------------

describe('processarPrazoCheck', () => {
  it('executa os três passes e agrega o resumo', async () => {
    const antigo = new Date(NOW.getTime() - FILA_ESTAGNADA_MS - 60_000);
    const findMany = vi
      .fn()
      // Pass 1: prazo vencendo (dentro da janela)
      .mockResolvedValueOnce([
        { id: 'v1', protocolo: '2025-0V001', cidadaoId: 'c1', prazoFinal: DEADLINE_2_DIAS },
      ])
      // Pass 2: etapa vencida
      .mockResolvedValueOnce([
        { id: 'e1', protocolo: '2025-0E001', unidade: { gestorId: 'g1' } },
      ])
      // Pass 3: fila estagnada
      .mockResolvedValueOnce([
        {
          id: 'f1',
          protocolo: '2025-0F001',
          abertoEm: antigo,
          unidade: { gestorId: 'g2' },
          movimentacoes: [],
        },
      ]);
    const prismaMock = makePrismaMock({ findMany });
    const deps = makeDeps(prismaMock);

    const resumo = await processarPrazoCheck(deps);

    expect(resumo).toEqual({ prazosVencendo: 1, etapasVencidas: 1, filaEstagnada: 1 });
    expect(deps.enqueue).toHaveBeenCalledTimes(3);
  });

  it('não lança quando um pass falha — demais passes continuam', async () => {
    const findMany = vi
      .fn()
      // Pass 1 explode
      .mockRejectedValueOnce(new Error('boom'))
      // Pass 2 vazio
      .mockResolvedValueOnce([])
      // Pass 3 vazio
      .mockResolvedValueOnce([]);
    const prismaMock = makePrismaMock({ findMany });
    const deps = makeDeps(prismaMock);

    const resumo = await processarPrazoCheck(deps);

    expect(resumo).toEqual({ prazosVencendo: 0, etapasVencidas: 0, filaEstagnada: 0 });
  });
});
