// Worker + scheduler da fila `tarefa-check` (Task 25.5 — Req. 27.8, 27.9).
//
// Segue EXATAMENTE o padrão do `prazo.worker.ts` (worker + scheduler cron,
// injeção de deps prisma + enqueue + now, tudo lazy — nada conecta no Redis no
// import). O processador roda a cada 15 minutos e faz DUAS varreduras
// independentes sobre `TarefaAtribuicao` NÃO concluídas (status != 'concluida'),
// usando o `prazo` da `Tarefa` associada:
//
//   1. verificarProximidade (Req. 27.8)
//        Atribuições cujo prazo da Tarefa vence em <= 24h e ainda com
//        `notificadoProximidade = false`. Enfileira notificação
//        `TAREFA_PROXIMA_VENCIMENTO` (canal painel, destinatário servidorId),
//        emite Socket.io `tarefa:proxima_vencimento` e marca a flag. A
//        notificação dispara NO MÁXIMO UMA VEZ por atribuição.
//
//   2. verificarVencidas (Req. 27.9)
//        Atribuições cujo prazo já foi atingido (prazo <= now) e ainda com
//        `notificadoVencida = false`. Enfileira `TAREFA_VENCIDA`, emite
//        `tarefa:vencida` e marca a flag. Dispara EXATAMENTE UMA VEZ enquanto a
//        atribuição permanecer não concluída após o prazo.
//
// Idempotência (disparo exatamente-uma-vez)
// -----------------------------------------
// A marcação da flag e o enfileiramento ocorrem de forma atômica: primeiro
// atualizamos a flag com um `updateMany` cujo `where` inclui a própria flag
// (`notificadoProximidade: false` / `notificadoVencida: false`). Só quando a
// atualização afeta a linha (`count === 1`) é que enfileiramos/emitimos. Sob
// concorrência (duas execuções do cron sobrepostas), apenas UMA atualização
// vence a corrida — a outra vê `count === 0` e não dispara. Isso garante o
// disparo exatamente-uma-vez por atribuição mesmo com execuções repetidas.
//
// Robustez: uma linha ruim nunca derruba a varredura — cada item é envolvido em
// try/catch com log estruturado, e cada varredura é isolada no processador.
//
// Nada conecta no Redis no import. `createTarefaWorker()` é lazy.

import { Worker, type Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { createRequire } from 'node:module';
import { StatusTarefa, TipoEvento } from '@auditar/shared';
import { bullmqConnection } from '../config/bullmq.js';
import { QUEUE_NAMES, tarefaCheckQueue, notificacaoQueue } from './queues.js';
import { prisma as defaultPrisma } from '../lib/prisma.js';
import type { TarefaCheckJob, NotificacaoJob } from './types.js';

/** Padrão cron: a cada 15 minutos. */
export const TAREFA_CHECK_CRON = '*/15 * * * *';

/** Nome estável do job repetível de tarefa-check (evita duplicatas). */
const TAREFA_CHECK_JOB_NAME = 'tarefa-check-cron';

/** Janela de proximidade de vencimento, em milissegundos (24h — Req. 27.8). */
export const JANELA_PROXIMIDADE_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Injeção de dependências — cada varredura recebe prisma + enqueue + emit + now
// injetáveis para ser testável sem Redis e sem banco real.
// ---------------------------------------------------------------------------

/** Enfileira um job de notificacao. Default: `notificacaoQueue().add`. */
export type EnqueueNotificacao = (job: NotificacaoJob) => Promise<unknown>;

/** Emite um evento Socket.io para a sala pessoal de um Servidor. */
export type EmitirServidorFn = (servidorId: string, evento: string, payload: unknown) => void;

/**
 * Superfície mínima do Prisma usada pelas varreduras (mantém os mocks pequenos).
 * Usa `tarefaAtribuicao.findMany` + `tarefaAtribuicao.updateMany`.
 */
export type PrismaTarefaClient = Pick<PrismaClient, 'tarefaAtribuicao'>;

export interface TarefaWorkerDeps {
  prisma: PrismaTarefaClient;
  enqueue: EnqueueNotificacao;
  emitirServidor: EmitirServidorFn;
  /** Relógio injetável para testes determinísticos. Default: `new Date()`. */
  now?: () => Date;
}

/** Enqueue default: adiciona um job na fila de notificacao (abre Redis lazy). */
const defaultEnqueue: EnqueueNotificacao = (job) => notificacaoQueue().add('notificacao', job);

/**
 * Emissão Socket.io default: resolvida preguiçosamente e envolvida em try/catch
 * para virar no-op enquanto o servidor Socket.io (task 9.3) não existir —
 * mesmo padrão dos demais produtores (ex.: tarefas.service.ts).
 */
const defaultEmitirServidor: EmitirServidorFn = (servidorId, evento, payload) => {
  try {
    const requireLocal = createRequire(import.meta.url);
    const { emitParaServidor } = requireLocal('../socket/socket.server.js') as {
      emitParaServidor: (id: string, ev: string, p: unknown) => void;
    };
    emitParaServidor(servidorId, evento, payload);
  } catch {
    /* Socket.io ainda não inicializado — emissão é no-op */
  }
};

function resolveDeps(deps?: Partial<TarefaWorkerDeps>): Required<TarefaWorkerDeps> {
  return {
    prisma: deps?.prisma ?? (defaultPrisma as unknown as PrismaTarefaClient),
    enqueue: deps?.enqueue ?? defaultEnqueue,
    emitirServidor: deps?.emitirServidor ?? defaultEmitirServidor,
    now: deps?.now ?? (() => new Date()),
  };
}

// ---------------------------------------------------------------------------
// Varredura 1 — Proximidade de vencimento (Req. 27.8)
// ---------------------------------------------------------------------------

/**
 * Busca `TarefaAtribuicao` NÃO concluídas cujo `prazo` da Tarefa vence em <= 24h
 * (e ainda não vencido) e com `notificadoProximidade = false`; para cada uma,
 * marca a flag de forma atômica e, se a marcação afetou a linha, enfileira a
 * notificação `TAREFA_PROXIMA_VENCIMENTO` e emite `tarefa:proxima_vencimento`.
 *
 * @returns o número de notificações efetivamente disparadas.
 */
export async function verificarProximidade(
  deps?: Partial<TarefaWorkerDeps>,
): Promise<number> {
  const { prisma, enqueue, emitirServidor, now } = resolveDeps(deps);
  const agora = now();
  const limiteProximidade = new Date(agora.getTime() + JANELA_PROXIMIDADE_MS);

  const atribuicoes = await prisma.tarefaAtribuicao.findMany({
    where: {
      status: { not: StatusTarefa.CONCLUIDA },
      notificadoProximidade: false,
      // Prazo entre agora (exclusivo) e agora+24h — ainda não vencido, mas
      // dentro da janela de proximidade. Prazos já vencidos são tratados na
      // varredura 2 (verificarVencidas).
      tarefa: { prazo: { gt: agora, lte: limiteProximidade } },
    },
    select: {
      id: true,
      servidorId: true,
      tarefa: { select: { id: true, titulo: true, prazo: true } },
    },
  });

  let disparados = 0;
  for (const a of atribuicoes) {
    try {
      // Marca a flag de forma idempotente: só afeta a linha se ainda estiver
      // `false`. Sob concorrência, apenas UMA execução vence esta corrida.
      const { count } = await prisma.tarefaAtribuicao.updateMany({
        where: { id: a.id, notificadoProximidade: false },
        data: { notificadoProximidade: true },
      });
      if (count === 0) continue; // outra execução já disparou — no-op

      await enqueue({
        tipo: 'painel',
        destinatario: { servidorId: a.servidorId },
        tipoEvento: TipoEvento.TAREFA_PROXIMA_VENCIMENTO,
        conteudo: `A tarefa "${a.tarefa.titulo}" vence em menos de 24 horas.`,
      });

      emitirServidor(a.servidorId, 'tarefa:proxima_vencimento', {
        tarefaId: a.tarefa.id,
        atribuicaoId: a.id,
        titulo: a.tarefa.titulo,
        prazo: a.tarefa.prazo instanceof Date ? a.tarefa.prazo.toISOString() : a.tarefa.prazo,
      });
      disparados++;
    } catch (err) {
      // Uma linha ruim não derruba a varredura.
      console.error(
        JSON.stringify({
          level: 'error',
          scope: 'tarefa-check',
          event: 'proximidade_falhou',
          atribuicaoId: a.id,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  return disparados;
}

// ---------------------------------------------------------------------------
// Varredura 2 — Tarefa vencida (Req. 27.9)
// ---------------------------------------------------------------------------

/**
 * Busca `TarefaAtribuicao` NÃO concluídas cujo `prazo` da Tarefa já foi atingido
 * (`prazo <= now`) e com `notificadoVencida = false`; para cada uma, marca a
 * flag de forma atômica e, se a marcação afetou a linha, enfileira a
 * notificação `TAREFA_VENCIDA` e emite `tarefa:vencida`. Dispara exatamente uma
 * vez enquanto a atribuição permanecer não concluída após o prazo.
 *
 * @returns o número de notificações efetivamente disparadas.
 */
export async function verificarVencidas(
  deps?: Partial<TarefaWorkerDeps>,
): Promise<number> {
  const { prisma, enqueue, emitirServidor, now } = resolveDeps(deps);
  const agora = now();

  const atribuicoes = await prisma.tarefaAtribuicao.findMany({
    where: {
      status: { not: StatusTarefa.CONCLUIDA },
      notificadoVencida: false,
      // Prazo já atingido (<= agora).
      tarefa: { prazo: { lte: agora } },
    },
    select: {
      id: true,
      servidorId: true,
      tarefa: { select: { id: true, titulo: true, prazo: true } },
    },
  });

  let disparados = 0;
  for (const a of atribuicoes) {
    try {
      const { count } = await prisma.tarefaAtribuicao.updateMany({
        where: { id: a.id, notificadoVencida: false },
        data: { notificadoVencida: true },
      });
      if (count === 0) continue; // outra execução já disparou — no-op

      await enqueue({
        tipo: 'painel',
        destinatario: { servidorId: a.servidorId },
        tipoEvento: TipoEvento.TAREFA_VENCIDA,
        conteudo: `A tarefa "${a.tarefa.titulo}" está vencida.`,
      });

      emitirServidor(a.servidorId, 'tarefa:vencida', {
        tarefaId: a.tarefa.id,
        atribuicaoId: a.id,
        titulo: a.tarefa.titulo,
        prazo: a.tarefa.prazo instanceof Date ? a.tarefa.prazo.toISOString() : a.tarefa.prazo,
      });
      disparados++;
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          scope: 'tarefa-check',
          event: 'vencida_falhou',
          atribuicaoId: a.id,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  return disparados;
}

// ---------------------------------------------------------------------------
// Processador de topo — executa as duas varreduras de forma isolada.
// ---------------------------------------------------------------------------

export interface TarefaCheckResumo {
  proximidade: number;
  vencidas: number;
}

/**
 * Executa as duas varreduras de prazo de tarefa. Cada varredura é isolada: uma
 * falha em uma varredura é logada e não impede a outra de rodar, então o
 * processador nunca lança por uma única varredura/linha ruim.
 */
export async function processarTarefaCheck(
  deps?: Partial<TarefaWorkerDeps>,
): Promise<TarefaCheckResumo> {
  const resolved = resolveDeps(deps);

  const resumo: TarefaCheckResumo = { proximidade: 0, vencidas: 0 };

  try {
    resumo.proximidade = await verificarProximidade(resolved);
  } catch (err) {
    console.error('[tarefa-check] varredura verificarProximidade falhou:', err);
  }

  try {
    resumo.vencidas = await verificarVencidas(resolved);
  } catch (err) {
    console.error('[tarefa-check] varredura verificarVencidas falhou:', err);
  }

  return resumo;
}

/**
 * Registra o job repetível de tarefa-check (a cada 15 min). Idempotente graças
 * ao nome de job fixo. Lazy: só toca o Redis quando chamado.
 */
export async function agendarTarefaCheck(): Promise<void> {
  await tarefaCheckQueue().add(
    TAREFA_CHECK_JOB_NAME,
    { trigger: 'cron' } satisfies TarefaCheckJob,
    { repeat: { pattern: TAREFA_CHECK_CRON } },
  );
}

/**
 * Cria o Worker de tarefa-check. Lazy — importar este módulo não conecta. O
 * wrapper do job BullMQ delega ao processador injetável usando o prisma real +
 * a fila de notificacao.
 */
export function createTarefaWorker(): Worker<TarefaCheckJob> {
  return new Worker<TarefaCheckJob>(
    QUEUE_NAMES.TAREFA_CHECK,
    async (_job: Job<TarefaCheckJob>) => {
      await processarTarefaCheck();
    },
    { connection: bullmqConnection },
  );
}
