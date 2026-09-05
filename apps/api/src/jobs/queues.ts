// Central registry of every BullMQ queue used by the API.
//
// IMPORTANT: nothing here opens a Redis connection at import time. A `Queue`
// instance is only created when one of the factory helpers below is called.
// This keeps unit tests (and any module that only needs the payload types)
// cheap and side-effect free.
//
// All queues are deduplicated through a module-level `Map` cache so that there
// is exactly ONE `Queue` instance per queue name across the whole process.
// This matters because more than one module may want the same queue (e.g. task
// 2.6 also produces to the `auditoria` queue).

import { Queue, type QueueOptions } from 'bullmq';
import { bullmqConnection } from '../config/bullmq.js';

/** Canonical queue names. Kept as string literals to avoid enum import cycles. */
export const QUEUE_NAMES = {
  NOTIFICACAO: 'notificacao',
  RELATORIO: 'relatorio',
  AUDITORIA: 'auditoria',
  PRAZO_CHECK: 'prazo-check',
  TAREFA_CHECK: 'tarefa-check',
  LIMPEZA: 'limpeza',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Default job options per queue, derived from the design "Especificação por
 * Fila" section. These are only applied the first time a queue is created
 * through {@link getQueue}.
 */
const DEFAULT_OPTIONS_BY_NAME: Record<string, QueueOptions['defaultJobOptions']> = {
  [QUEUE_NAMES.NOTIFICACAO]: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 30_000 }, // 30s between retries (Req. 6.5)
    removeOnComplete: 100,
    removeOnFail: 500,
  },
  [QUEUE_NAMES.RELATORIO]: {
    attempts: 2,
    removeOnComplete: 50,
  },
  [QUEUE_NAMES.AUDITORIA]: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 5_000 },
  },
  [QUEUE_NAMES.PRAZO_CHECK]: {
    attempts: 1,
  },
  [QUEUE_NAMES.TAREFA_CHECK]: {
    attempts: 1,
  },
  [QUEUE_NAMES.LIMPEZA]: {
    attempts: 1,
  },
};

/** Module-level cache: one Queue instance per queue name. */
const queueCache = new Map<string, Queue>();

/**
 * Lazily create (or return the cached) BullMQ Queue for the given name.
 *
 * Only the first call for a name constructs the `Queue` (and therefore opens a
 * Redis connection). Subsequent calls return the same instance, so producers
 * that live in different modules always share one queue.
 *
 * @param name  Queue name — prefer the {@link QUEUE_NAMES} constants.
 * @param opts  Optional overrides merged over the queue's default options.
 */
export function getQueue(name: string, opts?: QueueOptions): Queue {
  const cached = queueCache.get(name);
  if (cached) {
    return cached;
  }

  const defaultJobOptions = {
    ...DEFAULT_OPTIONS_BY_NAME[name],
    ...opts?.defaultJobOptions,
  };

  const queue = new Queue(name, {
    connection: bullmqConnection,
    ...opts,
    defaultJobOptions,
  });

  queueCache.set(name, queue);
  return queue;
}

// ---------------------------------------------------------------------------
// Named helpers — thin wrappers around getQueue for ergonomics and type intent.
// Each one is lazy: calling it is what creates the queue.
// ---------------------------------------------------------------------------

export const notificacaoQueue = (): Queue => getQueue(QUEUE_NAMES.NOTIFICACAO);
export const relatorioQueue = (): Queue => getQueue(QUEUE_NAMES.RELATORIO);
export const auditoriaQueue = (): Queue => getQueue(QUEUE_NAMES.AUDITORIA);
export const prazoCheckQueue = (): Queue => getQueue(QUEUE_NAMES.PRAZO_CHECK);
export const tarefaCheckQueue = (): Queue => getQueue(QUEUE_NAMES.TAREFA_CHECK);
export const limpezaQueue = (): Queue => getQueue(QUEUE_NAMES.LIMPEZA);

/**
 * Close every cached queue and clear the cache. Intended for graceful shutdown
 * and for test teardown.
 */
export async function closeAllQueues(): Promise<void> {
  const queues = [...queueCache.values()];
  queueCache.clear();
  await Promise.all(queues.map((q) => q.close()));
}
