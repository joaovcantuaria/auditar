// Worker + scheduler for the `prazo-check` queue (Task 9.2).
//
// The processor runs every hour and performs three INDEPENDENT scans, each of
// which enqueues `notificacao` jobs (delivery/channel routing happens
// downstream in the NotificacaoWorker — Task 9.1):
//
//   1. verificarPrazosVencendo (Req. 6.6)
//        Active processos whose `prazoFinal` is within <= 3 business days from
//        now. The owning Cidadão receives a "painel" notification so the
//        NotificacaoWorker can fan it out according to the citizen's channel
//        preferences.
//
//   2. marcarEtapasVencidas (Req. 11.8)
//        Active processos whose deadline has already passed while the processo
//        is still unadvanced. The processo is marked `VENCIDO` and the owning
//        Unidade's Gestor is notified.
//
//        SCHEMA APPROXIMATION: the design speaks of an "etapa" reaching its
//        deadline, but there is NO persisted per-processo etapa deadline column
//        in the schema (Etapa.prazosDiasUteis is a template value on the flow
//        definition, not a per-processo due date). We therefore approximate
//        "etapa vencida" using the only persisted per-processo deadline signal:
//        `Processo.prazoFinal` in the past while `status` is still active. When
//        that holds we set `Processo.status = VENCIDO` (there is likewise no
//        persisted per-processo etapa-status column to update instead).
//
//   3. verificarFilaEstagnada (Req. 12.6)
//        Active processos in the Fila_Geral (servidorResponsavelId = null)
//        whose "entered queue" timestamp is more than 24h ago. The owning
//        Unidade's Gestor is notified.
//
//        SCHEMA APPROXIMATION: there is no explicit "entered Fila_Geral"
//        timestamp. We use the most recent `MovimentacaoProcesso.realizadoEm`
//        as the queue-entry proxy, falling back to `Processo.abertoEm` when the
//        processo has no movimentações yet.
//
// Robustness: the top-level processor never throws for one bad row — each pass
// is wrapped so a failure in one pass (or one row) is logged and the remaining
// passes still run.
//
// Nothing connects to Redis at import time. `createPrazoWorker()` is lazy.

import { Worker, type Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { StatusProcesso, TipoEvento } from '@auditar/shared';
import { calcularDiasRestantes } from '../utils/index.js';
import { bullmqConnection } from '../config/bullmq.js';
import { QUEUE_NAMES, prazoCheckQueue, notificacaoQueue } from './queues.js';
import { prisma as defaultPrisma } from '../lib/prisma.js';
import { STATUS_ENCERRADOS } from '../modules/processos/mensagens.publico.service.js';
import type { PrazoCheckJob, NotificacaoJob } from './types.js';

/** Cron pattern: run at minute 0 of every hour. */
export const PRAZO_CHECK_CRON = '0 * * * *';

/** Stable job id for the repeatable prazo-check job (prevents duplicates). */
const PRAZO_CHECK_JOB_NAME = 'prazo-check-cron';

/** Deadline-warning window, in business days (Req. 6.6). */
export const JANELA_ALERTA_DIAS_UTEIS = 3;

/** Fila_Geral staleness threshold, in milliseconds (24h — Req. 12.6). */
export const FILA_ESTAGNADA_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Dependency injection — every pass takes an injected prisma + enqueue fn so it
// can be unit-tested with no Redis and no real database.
// ---------------------------------------------------------------------------

/** Enqueues a notificacao job. Defaults to `notificacaoQueue().add`. */
export type EnqueueNotificacao = (job: NotificacaoJob) => Promise<unknown>;

/** Minimal Prisma surface the passes rely on (keeps mocks small). */
export type PrismaPrazoClient = Pick<PrismaClient, 'processo'>;

export interface PrazoWorkerDeps {
  prisma: PrismaPrazoClient;
  enqueue: EnqueueNotificacao;
  /** Injectable clock for deterministic tests. Defaults to `new Date()`. */
  now?: () => Date;
}

/** Default enqueue: add a job to the notificacao queue (opens Redis lazily). */
const defaultEnqueue: EnqueueNotificacao = (job) => notificacaoQueue().add('notificacao', job);

function resolveDeps(deps?: Partial<PrazoWorkerDeps>): Required<PrazoWorkerDeps> {
  return {
    prisma: deps?.prisma ?? (defaultPrisma as unknown as PrismaPrazoClient),
    enqueue: deps?.enqueue ?? defaultEnqueue,
    now: deps?.now ?? (() => new Date()),
  };
}

// ---------------------------------------------------------------------------
// Pass 1 — Deadline warning to the Cidadão (Req. 6.6)
// ---------------------------------------------------------------------------

/**
 * Find active processos whose `prazoFinal` is within <= 3 business days from
 * `now` and enqueue a deadline-warning notification to the owning Cidadão.
 *
 * Encerrados (STATUS_ENCERRADOS) and already-`VENCIDO` processos are excluded:
 * a processo whose deadline has already passed is handled by pass 2, not here.
 *
 * @returns the number of notifications enqueued.
 */
export async function verificarPrazosVencendo(deps?: Partial<PrazoWorkerDeps>): Promise<number> {
  const { prisma, enqueue, now } = resolveDeps(deps);
  const agora = now();

  const processos = await prisma.processo.findMany({
    where: {
      status: { notIn: [...STATUS_ENCERRADOS, StatusProcesso.VENCIDO] },
      // Deadline still in the future (past deadlines are pass 2's job).
      prazoFinal: { gte: agora },
    },
    select: { id: true, protocolo: true, cidadaoId: true, prazoFinal: true },
  });

  let enfileirados = 0;
  for (const p of processos) {
    try {
      const diasRestantes = calcularDiasRestantes(agora, p.prazoFinal);
      // Outside the window → skip.
      if (diasRestantes > JANELA_ALERTA_DIAS_UTEIS) continue;

      const conteudo =
        `O processo ${p.protocolo} está próximo do prazo final: ` +
        `${diasRestantes} dia(s) útil(eis) restante(s).`;

      await enqueue({
        tipo: 'painel',
        destinatario: { cidadaoId: p.cidadaoId },
        tipoEvento: TipoEvento.VENCIMENTO_PRAZO,
        conteudo,
        processoId: p.id,
      });
      enfileirados++;
    } catch (err) {
      // Never let one bad row abort the whole pass.
      console.error(`[prazo-check] falha ao alertar prazo do processo ${p.id}:`, err);
    }
  }

  return enfileirados;
}

// ---------------------------------------------------------------------------
// Pass 2 — Overdue etapa → mark VENCIDO + notify Gestor (Req. 11.8)
// ---------------------------------------------------------------------------

/**
 * Find active processos whose deadline has already passed while still
 * unadvanced (approximated by `prazoFinal < now` and status still active — see
 * the file header for the schema approximation), set their status to
 * `VENCIDO`, and notify the owning Unidade's Gestor.
 *
 * If the Unidade has no gestor (`gestorId` null) the status is still updated
 * but the notification is skipped (logged).
 *
 * @returns the number of notifications enqueued to gestores.
 */
export async function marcarEtapasVencidas(deps?: Partial<PrazoWorkerDeps>): Promise<number> {
  const { prisma, enqueue, now } = resolveDeps(deps);
  const agora = now();

  const processos = await prisma.processo.findMany({
    where: {
      status: { notIn: [...STATUS_ENCERRADOS, StatusProcesso.VENCIDO] },
      prazoFinal: { lt: agora },
    },
    select: {
      id: true,
      protocolo: true,
      unidade: { select: { gestorId: true } },
    },
  });

  let notificados = 0;
  for (const p of processos) {
    try {
      // Mark the processo (proxy for its current etapa) as VENCIDO.
      await prisma.processo.update({
        where: { id: p.id },
        data: { status: StatusProcesso.VENCIDO },
      });

      const gestorId = p.unidade?.gestorId ?? null;
      if (!gestorId) {
        console.warn(
          `[prazo-check] processo ${p.id} vencido, mas a unidade não tem gestor — notificação ignorada`,
        );
        continue;
      }

      await enqueue({
        tipo: 'painel',
        destinatario: { servidorId: gestorId },
        tipoEvento: TipoEvento.VENCIMENTO_PRAZO,
        conteudo: `O processo ${p.protocolo} teve sua etapa vencida e foi marcado como Vencido.`,
        processoId: p.id,
      });
      notificados++;
    } catch (err) {
      console.error(`[prazo-check] falha ao marcar/notificar processo vencido ${p.id}:`, err);
    }
  }

  return notificados;
}

// ---------------------------------------------------------------------------
// Pass 3 — Stale Fila_Geral → notify Gestor (Req. 12.6)
// ---------------------------------------------------------------------------

/**
 * Find active processos in the Fila_Geral (no responsible servidor) whose
 * queue-entry proxy timestamp is more than 24h old, and notify the owning
 * Unidade's Gestor. The queue-entry proxy is the most recent
 * `MovimentacaoProcesso.realizadoEm`, falling back to `abertoEm` (see header).
 *
 * If the Unidade has no gestor the processo is skipped (logged).
 *
 * @returns the number of notifications enqueued to gestores.
 */
export async function verificarFilaEstagnada(deps?: Partial<PrazoWorkerDeps>): Promise<number> {
  const { prisma, enqueue, now } = resolveDeps(deps);
  const agora = now();
  const limite = new Date(agora.getTime() - FILA_ESTAGNADA_MS);

  const processos = await prisma.processo.findMany({
    where: {
      servidorResponsavelId: null,
      status: { notIn: [...STATUS_ENCERRADOS, StatusProcesso.VENCIDO] },
    },
    select: {
      id: true,
      protocolo: true,
      abertoEm: true,
      unidade: { select: { gestorId: true } },
      movimentacoes: {
        select: { realizadoEm: true },
        orderBy: { realizadoEm: 'desc' },
        take: 1,
      },
    },
  });

  let notificados = 0;
  for (const p of processos) {
    try {
      // Queue-entry proxy: latest movimentação, else abertoEm.
      const entradaFila = p.movimentacoes[0]?.realizadoEm ?? p.abertoEm;
      // Not stale enough yet → skip.
      if (entradaFila > limite) continue;

      const gestorId = p.unidade?.gestorId ?? null;
      if (!gestorId) {
        console.warn(
          `[prazo-check] processo ${p.id} estagnado na fila, mas a unidade não tem gestor — notificação ignorada`,
        );
        continue;
      }

      const horas = Math.floor((agora.getTime() - entradaFila.getTime()) / (60 * 60 * 1000));
      await enqueue({
        tipo: 'painel',
        destinatario: { servidorId: gestorId },
        tipoEvento: TipoEvento.VENCIMENTO_PRAZO,
        conteudo:
          `O processo ${p.protocolo} está na Fila Geral há ${horas}h ` +
          `sem servidor responsável.`,
        processoId: p.id,
      });
      notificados++;
    } catch (err) {
      console.error(`[prazo-check] falha ao verificar fila estagnada do processo ${p.id}:`, err);
    }
  }

  return notificados;
}

// ---------------------------------------------------------------------------
// Top-level processor — runs all three passes independently.
// ---------------------------------------------------------------------------

export interface PrazoCheckResumo {
  prazosVencendo: number;
  etapasVencidas: number;
  filaEstagnada: number;
}

/**
 * Run the three deadline scans. Each pass is isolated: a failure in one pass is
 * logged and does not prevent the others from running, so the processor never
 * throws for a single bad pass/row.
 */
export async function processarPrazoCheck(
  deps?: Partial<PrazoWorkerDeps>,
): Promise<PrazoCheckResumo> {
  const resolved = resolveDeps(deps);

  const resumo: PrazoCheckResumo = {
    prazosVencendo: 0,
    etapasVencidas: 0,
    filaEstagnada: 0,
  };

  try {
    resumo.prazosVencendo = await verificarPrazosVencendo(resolved);
  } catch (err) {
    console.error('[prazo-check] pass verificarPrazosVencendo falhou:', err);
  }

  try {
    resumo.etapasVencidas = await marcarEtapasVencidas(resolved);
  } catch (err) {
    console.error('[prazo-check] pass marcarEtapasVencidas falhou:', err);
  }

  try {
    resumo.filaEstagnada = await verificarFilaEstagnada(resolved);
  } catch (err) {
    console.error('[prazo-check] pass verificarFilaEstagnada falhou:', err);
  }

  return resumo;
}

/**
 * Register the hourly repeatable prazo-check job. Idempotent thanks to the
 * fixed job name. Lazy: only touches Redis when called.
 */
export async function agendarPrazoCheck(): Promise<void> {
  await prazoCheckQueue().add(
    PRAZO_CHECK_JOB_NAME,
    { trigger: 'cron' } satisfies PrazoCheckJob,
    { repeat: { pattern: PRAZO_CHECK_CRON } },
  );
}

/**
 * Create the prazo-check Worker. Lazy — importing this module does not connect.
 * The BullMQ job wrapper delegates to the deps-injectable processor using the
 * real prisma + notificacao queue.
 */
export function createPrazoWorker(): Worker<PrazoCheckJob> {
  return new Worker<PrazoCheckJob>(
    QUEUE_NAMES.PRAZO_CHECK,
    async (_job: Job<PrazoCheckJob>) => {
      await processarPrazoCheck();
    },
    { connection: bullmqConnection },
  );
}
