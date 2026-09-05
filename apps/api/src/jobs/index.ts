// Barrel export + bootstrap helpers for the BullMQ job subsystem.
//
// The important invariant: importing this module must NOT open a Redis
// connection. Queues and Workers are only created when the factory functions
// below are called from the server bootstrap (never at import time).

import type { Worker } from 'bullmq';

export * from './types.js';
export * from './queues.js';

export {
  createNotificacaoWorker,
  processarNotificacao,
  enviarEmail,
  enviarSms,
  gravarPainel,
  enviarPush,
} from './notificacao.worker.js';

export {
  createPrazoWorker,
  processarPrazoCheck,
  agendarPrazoCheck,
  PRAZO_CHECK_CRON,
} from './prazo.worker.js';

export {
  createTarefaWorker,
  processarTarefaCheck,
  verificarProximidade,
  verificarVencidas,
  agendarTarefaCheck,
  TAREFA_CHECK_CRON,
  JANELA_PROXIMIDADE_MS,
} from './tarefa.worker.js';

export {
  createLimpezaWorker,
  processarLimpeza,
  processarExclusoesPendentes,
  anonimizarCidadao,
  agendarLimpeza,
  LIMPEZA_CRON,
  ANONIMIZACAO_APOS_MS,
} from './limpeza.worker.js';

export {
  createRelatorioWorker,
  processarRelatorio,
  serializarRelatorio,
  toCsv,
  toPdf,
  escapeCsv,
  RELATORIO_BUCKET,
} from './relatorio.worker.js';

import { createNotificacaoWorker } from './notificacao.worker.js';
import { createPrazoWorker, agendarPrazoCheck } from './prazo.worker.js';
import { createTarefaWorker, agendarTarefaCheck } from './tarefa.worker.js';
import { createLimpezaWorker, agendarLimpeza } from './limpeza.worker.js';
import { createRelatorioWorker } from './relatorio.worker.js';

/**
 * Instantiate all base workers. Call this ONCE from the server bootstrap —
 * never at import time, since creating a Worker opens a Redis connection.
 *
 * Note: the auditoria worker is owned by the auditoria module (task 2.6) and
 * registers itself separately.
 *
 * @returns the created Worker instances (useful for graceful shutdown).
 */
export function startWorkers(): Worker[] {
  return [
    createNotificacaoWorker(),
    createPrazoWorker(),
    createTarefaWorker(),
    createLimpezaWorker(),
    createRelatorioWorker(),
  ];
}

/**
 * Register all repeatable (cron) jobs. Call this ONCE from the server
 * bootstrap. Idempotent — repeatable jobs use stable names.
 */
export async function scheduleCronJobs(): Promise<void> {
  await Promise.all([agendarPrazoCheck(), agendarTarefaCheck(), agendarLimpeza()]);
}
