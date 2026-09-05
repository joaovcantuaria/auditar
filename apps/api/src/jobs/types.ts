// Job payload interfaces for the Auditar BullMQ queues.
//
// These describe the shape of the `data` object attached to each job. The full
// processing logic for each job lives in the corresponding worker (tasks 9.1,
// 9.2, 4.2). Keeping the payloads here decouples producers (services that
// enqueue jobs) from the workers that consume them.

/**
 * Payload for the `notificacao` queue.
 * Routed by {@link NotificacaoJob.tipo} inside the notificacao worker.
 * See design "notificacao-queue" (Req. 6.4, 6.5).
 */
export interface NotificacaoJob {
  tipo: 'email' | 'sms' | 'painel' | 'push';
  destinatario: { cidadaoId?: string; servidorId?: string };
  /** Corresponds to the shared `TipoEvento` enum value. */
  tipoEvento: string;
  conteudo: string;
  processoId?: string;
  /** ISO date string used to delay delivery during the silence window (Req. 6.4). */
  agendadaPara?: string;
}

/**
 * Payload for the `relatorio` queue.
 * Reports over 10.000 records are processed in the background (Req. 18.5).
 */
export interface RelatorioJob {
  formato: 'csv' | 'pdf';
  filtros: Record<string, unknown>;
  servidorId: string;
  /** UUID used to track report generation status. */
  jobId: string;
}

/**
 * Payload for the repeatable `prazo-check` cron job (Req. 6.6, 11.8, 12.6).
 */
export interface PrazoCheckJob {
  trigger: 'cron';
}

/**
 * Payload for the repeatable `tarefa-check` cron job (Req. 27.8, 27.9).
 * Sem payload útil — o worker varre `TarefaAtribuicao` não concluídas.
 */
export interface TarefaCheckJob {
  trigger: 'cron';
}

/**
 * Payload for the repeatable `limpeza` cron job (Req. 1.7, 20.6).
 */
export interface LimpezaJob {
  trigger: 'cron';
}
