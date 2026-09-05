import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { StatusTarefa, TipoEvento } from '@auditar/shared';

// Mock do bullmq para que importar o worker nunca abra conexão Redis nem exija
// o módulo nativo `bullmq` na transformação de teste.
vi.mock('bullmq', () => ({
  Queue: class {},
  Worker: class {},
  ConnectionOptions: class {},
}));

// Evita carregar o prisma client real / validação de env só por importar o
// worker. As varreduras sempre recebem um prisma injetado nestes testes.
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));

import {
  verificarProximidade,
  verificarVencidas,
  processarTarefaCheck,
  JANELA_PROXIMIDADE_MS,
  type TarefaWorkerDeps,
} from '../tarefa.worker.js';

// ---------------------------------------------------------------------------
// Prisma mock em memória para `tarefaAtribuicao`.
//
// Modela apenas o subconjunto de `findMany`/`updateMany` que o worker usa:
//   - findMany filtra por status != concluida, flag (proximidade/vencida) e
//     janela de prazo (gt/lte/lte) da Tarefa associada.
//   - updateMany aplica `data` às linhas que casam com `where` (id + flag) e
//     retorna { count } — é isso que garante a idempotência sob execuções
//     repetidas: a segunda passada vê a flag já `true` e casa 0 linhas.
// ---------------------------------------------------------------------------

interface AtribuicaoRow {
  id: string;
  servidorId: string;
  status: string;
  notificadoProximidade: boolean;
  notificadoVencida: boolean;
  tarefa: { id: string; titulo: string; prazo: Date };
}

function matchPrazo(prazo: Date, cond: Record<string, Date> | undefined): boolean {
  if (!cond) return true;
  if (cond.gt !== undefined && !(prazo.getTime() > cond.gt.getTime())) return false;
  if (cond.gte !== undefined && !(prazo.getTime() >= cond.gte.getTime())) return false;
  if (cond.lte !== undefined && !(prazo.getTime() <= cond.lte.getTime())) return false;
  if (cond.lt !== undefined && !(prazo.getTime() < cond.lt.getTime())) return false;
  return true;
}

function makePrismaMock(rows: AtribuicaoRow[]) {
  const store = rows;

  const findMany = vi.fn(async (args: { where: Record<string, any>; select?: unknown }) => {
    const w = args.where;
    return store
      .filter((r) => {
        if (w.status?.not !== undefined && r.status === w.status.not) return false;
        if (w.notificadoProximidade !== undefined && r.notificadoProximidade !== w.notificadoProximidade)
          return false;
        if (w.notificadoVencida !== undefined && r.notificadoVencida !== w.notificadoVencida)
          return false;
        if (w.tarefa?.prazo && !matchPrazo(r.tarefa.prazo, w.tarefa.prazo)) return false;
        return true;
      })
      .map((r) => ({
        id: r.id,
        servidorId: r.servidorId,
        tarefa: { id: r.tarefa.id, titulo: r.tarefa.titulo, prazo: r.tarefa.prazo },
      }));
  });

  const updateMany = vi.fn(
    async (args: { where: Record<string, any>; data: Record<string, unknown> }) => {
      const w = args.where;
      let count = 0;
      for (const r of store) {
        if (w.id !== undefined && r.id !== w.id) continue;
        if (w.notificadoProximidade !== undefined && r.notificadoProximidade !== w.notificadoProximidade)
          continue;
        if (w.notificadoVencida !== undefined && r.notificadoVencida !== w.notificadoVencida) continue;
        Object.assign(r, args.data);
        count++;
      }
      return { count };
    },
  );

  return {
    prisma: { tarefaAtribuicao: { findMany, updateMany } },
    store,
    findMany,
    updateMany,
  };
}

function makeDeps(
  prismaMock: ReturnType<typeof makePrismaMock>,
  now: () => Date,
): TarefaWorkerDeps & {
  enqueue: ReturnType<typeof vi.fn>;
  emitirServidor: ReturnType<typeof vi.fn>;
} {
  return {
    prisma: prismaMock.prisma as unknown as TarefaWorkerDeps['prisma'],
    enqueue: vi.fn().mockResolvedValue(undefined),
    emitirServidor: vi.fn(),
    now,
  };
}

const NOW = new Date('2025-06-11T12:00:00.000Z');
const now = () => new Date(NOW);

function row(overrides: Partial<AtribuicaoRow> & { prazo: Date }): AtribuicaoRow {
  const { prazo, ...rest } = overrides;
  return {
    id: overrides.id ?? 't-atrib-1',
    servidorId: overrides.servidorId ?? 'srv-1',
    status: overrides.status ?? StatusTarefa.PENDENTE,
    notificadoProximidade: overrides.notificadoProximidade ?? false,
    notificadoVencida: overrides.notificadoVencida ?? false,
    tarefa: { id: 'tar-1', titulo: 'Revisar documento', prazo },
    ...rest,
  } as AtribuicaoRow;
}

// ---------------------------------------------------------------------------
// Testes de unidade — proximidade (Req. 27.8)
// ---------------------------------------------------------------------------

describe('verificarProximidade', () => {
  it('dispara notificação quando o prazo vence em <= 24h e ainda não notificado', async () => {
    const prazo = new Date(NOW.getTime() + 12 * 60 * 60 * 1000); // 12h à frente
    const prismaMock = makePrismaMock([row({ id: 'a1', prazo })]);
    const deps = makeDeps(prismaMock, now);

    const count = await verificarProximidade(deps);

    expect(count).toBe(1);
    expect(deps.enqueue).toHaveBeenCalledTimes(1);
    expect(deps.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'painel',
        destinatario: { servidorId: 'srv-1' },
        tipoEvento: TipoEvento.TAREFA_PROXIMA_VENCIMENTO,
      }),
    );
    expect(deps.emitirServidor).toHaveBeenCalledWith(
      'srv-1',
      'tarefa:proxima_vencimento',
      expect.objectContaining({ atribuicaoId: 'a1' }),
    );
    // Flag marcada.
    expect(prismaMock.store[0].notificadoProximidade).toBe(true);
  });

  it('não dispara para prazo fora da janela de 24h', async () => {
    const prazo = new Date(NOW.getTime() + JANELA_PROXIMIDADE_MS + 60 * 60 * 1000); // 25h
    const prismaMock = makePrismaMock([row({ id: 'a2', prazo })]);
    const deps = makeDeps(prismaMock, now);

    const count = await verificarProximidade(deps);

    expect(count).toBe(0);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it('não dispara para atribuição já concluída', async () => {
    const prazo = new Date(NOW.getTime() + 6 * 60 * 60 * 1000);
    const prismaMock = makePrismaMock([
      row({ id: 'a3', prazo, status: StatusTarefa.CONCLUIDA }),
    ]);
    const deps = makeDeps(prismaMock, now);

    const count = await verificarProximidade(deps);

    expect(count).toBe(0);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it('não redispara quando notificadoProximidade já é true', async () => {
    const prazo = new Date(NOW.getTime() + 6 * 60 * 60 * 1000);
    const prismaMock = makePrismaMock([
      row({ id: 'a4', prazo, notificadoProximidade: true }),
    ]);
    const deps = makeDeps(prismaMock, now);

    const count = await verificarProximidade(deps);

    expect(count).toBe(0);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Testes de unidade — vencida (Req. 27.9)
// ---------------------------------------------------------------------------

describe('verificarVencidas', () => {
  it('dispara notificação quando o prazo já passou e ainda não notificado', async () => {
    const prazo = new Date(NOW.getTime() - 60 * 60 * 1000); // 1h atrás
    const prismaMock = makePrismaMock([row({ id: 'v1', prazo })]);
    const deps = makeDeps(prismaMock, now);

    const count = await verificarVencidas(deps);

    expect(count).toBe(1);
    expect(deps.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'painel',
        destinatario: { servidorId: 'srv-1' },
        tipoEvento: TipoEvento.TAREFA_VENCIDA,
      }),
    );
    expect(deps.emitirServidor).toHaveBeenCalledWith(
      'srv-1',
      'tarefa:vencida',
      expect.objectContaining({ atribuicaoId: 'v1' }),
    );
    expect(prismaMock.store[0].notificadoVencida).toBe(true);
  });

  it('não dispara quando o prazo ainda não foi atingido', async () => {
    const prazo = new Date(NOW.getTime() + 60 * 60 * 1000); // 1h à frente
    const prismaMock = makePrismaMock([row({ id: 'v2', prazo })]);
    const deps = makeDeps(prismaMock, now);

    const count = await verificarVencidas(deps);

    expect(count).toBe(0);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it('não dispara para atribuição concluída mesmo com prazo vencido', async () => {
    const prazo = new Date(NOW.getTime() - 60 * 60 * 1000);
    const prismaMock = makePrismaMock([
      row({ id: 'v3', prazo, status: StatusTarefa.CONCLUIDA }),
    ]);
    const deps = makeDeps(prismaMock, now);

    const count = await verificarVencidas(deps);

    expect(count).toBe(0);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it('uma linha ruim não derruba a varredura', async () => {
    const prazo = new Date(NOW.getTime() - 60 * 60 * 1000);
    const prismaMock = makePrismaMock([
      row({ id: 'bad', prazo }),
      row({ id: 'ok', prazo, servidorId: 'srv-2' }),
    ]);
    // Faz o updateMany do primeiro item lançar; o segundo segue normalmente.
    const original = prismaMock.updateMany.getMockImplementation()!;
    prismaMock.updateMany
      .mockImplementationOnce(async () => {
        throw new Error('db down');
      })
      .mockImplementation(original);
    const deps = makeDeps(prismaMock, now);

    const count = await verificarVencidas(deps);

    expect(count).toBe(1);
    expect(deps.enqueue).toHaveBeenCalledTimes(1);
    expect(deps.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ destinatario: { servidorId: 'srv-2' } }),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 18: Notificação de Prazo de Tarefa Exatamente Uma Vez por Destinatário
// (Req. 27.8, 27.9)
//
// Para qualquer TarefaAtribuicao NÃO concluída, independentemente de quantas
// vezes a varredura roda, a notificação de proximidade dispara NO MÁXIMO uma
// vez e a de vencida EXATAMENTE uma vez enquanto permanecer não concluída após
// o prazo.
// **Validates: Requirements 27.8, 27.9**
// ---------------------------------------------------------------------------

describe('Property 18: notificação de prazo de tarefa exatamente uma vez', () => {
  it('múltiplas execuções da varredura disparam proximidade <=1x e vencida ==1x', async () => {
    fc.assert(
      fc.asyncProperty(
        // Número de execuções da varredura (>= 2 para exercitar idempotência).
        fc.integer({ min: 2, max: 8 }),
        // Offset do prazo em minutos relativo a NOW: negativo = já vencido,
        // pequeno positivo = dentro da janela de 24h, grande = fora.
        fc.integer({ min: -600, max: 3000 }),
        // status inicial (nunca concluída, pois a propriedade fala de não concluídas)
        fc.constantFrom(StatusTarefa.PENDENTE, StatusTarefa.EM_ANDAMENTO),
        async (execucoes, offsetMin, status) => {
          const prazo = new Date(NOW.getTime() + offsetMin * 60 * 1000);
          const prismaMock = makePrismaMock([
            row({ id: 'p18', servidorId: 'srv-x', status, prazo }),
          ]);
          const enqueue = vi.fn().mockResolvedValue(undefined);
          const emitirServidor = vi.fn();
          const deps: TarefaWorkerDeps = {
            prisma: prismaMock.prisma as unknown as TarefaWorkerDeps['prisma'],
            enqueue,
            emitirServidor,
            now,
          };

          // Roda a varredura completa várias vezes (simula o cron repetindo).
          for (let i = 0; i < execucoes; i++) {
            await processarTarefaCheck(deps);
          }

          const chamadasProximidade = enqueue.mock.calls.filter(
            (c) => (c[0] as { tipoEvento: string }).tipoEvento === TipoEvento.TAREFA_PROXIMA_VENCIMENTO,
          ).length;
          const chamadasVencida = enqueue.mock.calls.filter(
            (c) => (c[0] as { tipoEvento: string }).tipoEvento === TipoEvento.TAREFA_VENCIDA,
          ).length;

          // Proximidade: no máximo uma vez, independentemente das execuções.
          expect(chamadasProximidade).toBeLessThanOrEqual(1);
          // Vencida: no máximo uma vez (é exatamente uma vez apenas se vencida).
          expect(chamadasVencida).toBeLessThanOrEqual(1);

          const vencido = prazo.getTime() <= NOW.getTime();
          const dentroJanela =
            prazo.getTime() > NOW.getTime() &&
            prazo.getTime() <= NOW.getTime() + JANELA_PROXIMIDADE_MS;

          if (vencido) {
            // Prazo atingido e não concluída → vencida dispara EXATAMENTE uma vez.
            expect(chamadasVencida).toBe(1);
            // Prazo já passou (não está na janela futura) → proximidade não dispara.
            expect(chamadasProximidade).toBe(0);
          } else if (dentroJanela) {
            // Dentro de 24h e ainda não vencido → proximidade dispara 1x, vencida 0.
            expect(chamadasProximidade).toBe(1);
            expect(chamadasVencida).toBe(0);
          } else {
            // Prazo distante → nenhuma notificação.
            expect(chamadasProximidade).toBe(0);
            expect(chamadasVencida).toBe(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('atribuição concluída nunca dispara notificação, mesmo com prazo vencido e várias execuções', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: -600, max: 600 }),
        async (execucoes, offsetMin) => {
          const prazo = new Date(NOW.getTime() + offsetMin * 60 * 1000);
          const prismaMock = makePrismaMock([
            row({ id: 'pc', servidorId: 'srv-y', status: StatusTarefa.CONCLUIDA, prazo }),
          ]);
          const enqueue = vi.fn().mockResolvedValue(undefined);
          const deps: TarefaWorkerDeps = {
            prisma: prismaMock.prisma as unknown as TarefaWorkerDeps['prisma'],
            enqueue,
            emitirServidor: vi.fn(),
            now,
          };

          for (let i = 0; i < execucoes; i++) {
            await processarTarefaCheck(deps);
          }

          expect(enqueue).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});
