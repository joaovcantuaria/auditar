// Worker for the `atribuicao` queue — automatic assignment of newly created
// Processos (Req. 12.2, 12.3).
//
// A new Processo whose Unidade is configured with `modoAtribuicao = automatico`
// is assigned to the active Servidor with the fewest active Processos (ties
// broken by the oldest last assignment). If no Servidor is available, the
// Processo is moved to the Fila_Geral and the event is recorded in the audit
// log — both handled by `atribuirAutomaticamente` in the atribuicao service,
// which is the single shared source of the assignment logic (used by the
// `modo=automatico` endpoint path too).
//
// Nothing here connects to Redis at import time — the Worker is only created
// when `createAtribuicaoWorker()` is called (from the server bootstrap). The
// processor is split out as `processarAtribuicao(job)` so it can be unit-tested
// without Redis, mirroring `notificacao.worker.ts`'s `processarNotificacao`.

import { createRequire } from 'node:module';
import { Worker, type Job } from 'bullmq';
import { bullmqConnection } from '../config/bullmq.js';
import { getQueue } from './queues.js';
import type { AtribuicaoDeps } from '../modules/processos/processos.atribuicao.service.js';

/** Canonical name of the automatic-assignment queue. */
export const ATRIBUICAO_QUEUE_NAME = 'atribuicao';

/**
 * Payload for the `atribuicao` queue (Req. 12.2, 12.3). Enqueued when a new
 * Processo is created; the worker runs the least-load algorithm scoped to the
 * Processo's Unidade.
 */
export interface AtribuicaoJob {
  processoId: string;
  unidadeId: string;
}

/**
 * Lazily resolve the real `atribuirAutomaticamente` from the atribuicao
 * service. Kept lazy so importing this worker module does not pull the Prisma
 * client / open connections — only the actual processing does. Injectable via
 * the optional `atribuir` parameter for unit tests.
 */
type AtribuirAutomaticamenteFn = (
  processoId: string,
  unidadeId: string,
  deps?: Partial<AtribuicaoDeps>,
) => Promise<unknown>;

let cachedAtribuir: AtribuirAutomaticamenteFn | undefined;

function getRealAtribuir(): AtribuirAutomaticamenteFn {
  if (!cachedAtribuir) {
    const requireLocal = createRequire(import.meta.url);
    const mod = requireLocal('../modules/processos/processos.atribuicao.service.js') as {
      atribuirAutomaticamente: AtribuirAutomaticamenteFn;
    };
    cachedAtribuir = mod.atribuirAutomaticamente;
  }
  return cachedAtribuir;
}

/**
 * Process a single automatic-assignment job. Delegates entirely to
 * `atribuirAutomaticamente`, which itself checks the Unidade's `modoAtribuicao`
 * and only auto-assigns when it is AUTOMATICO — skipping manual/fila_geral
 * Unidades (Req. 12.1/12.2) — and moves the Processo to the Fila_Geral +
 * audit when no Servidor is available (Req. 12.3).
 *
 * Kept separate from the Worker so it can be unit-tested without Redis.
 *
 * @param job     the BullMQ job carrying `{ processoId, unidadeId }`.
 * @param atribuir optional override of the assignment function (tests).
 */
export async function processarAtribuicao(
  job: Job<AtribuicaoJob>,
  atribuir: AtribuirAutomaticamenteFn = getRealAtribuir(),
): Promise<void> {
  const { processoId, unidadeId } = job.data;
  await atribuir(processoId, unidadeId);
}

/**
 * Lazily create (or return the cached) BullMQ Queue for automatic assignment.
 * Producing to this queue is what `processos.service.ts#agendarAtribuicao` can
 * use to hand a new Processo off to the worker.
 */
export function atribuicaoQueue() {
  return getQueue(ATRIBUICAO_QUEUE_NAME, {
    connection: bullmqConnection,
    defaultJobOptions: { attempts: 3, backoff: { type: 'fixed', delay: 30_000 } },
  });
}

/**
 * Create the atribuicao Worker.
 *
 * Lazy: calling this opens the Redis connection; importing the module does not.
 */
export function createAtribuicaoWorker(): Worker<AtribuicaoJob> {
  // Envolve em arrow que passa só o `job`: a assinatura de `processarAtribuicao`
  // tem um 2º parâmetro opcional de injeção (testes) que é incompatível com o
  // `token: string` esperado pelo `Processor` do BullMQ (mesmo padrão do
  // notificacao/relatorio worker).
  return new Worker<AtribuicaoJob>(ATRIBUICAO_QUEUE_NAME, (job) => processarAtribuicao(job), {
    connection: bullmqConnection,
  });
}
