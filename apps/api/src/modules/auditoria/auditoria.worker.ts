import { Worker, type Job } from 'bullmq';
import { bullmqConnection } from '../../config/bullmq.js';
import { prisma } from '../../config/database.js';
import { AUDITORIA_QUEUE_NAME } from './auditoria.service.js';
import type { AuditoriaJobData } from './auditoria.types.js';

/**
 * Worker da `auditoria-queue`. Persiste cada job na tabela `AuditoriaLog`.
 *
 * O reprocessamento (attempts: 3) é configurado na fila (auditoria.service.ts).
 * Se todas as tentativas falharem, o evento de falha é registrado internamente
 * via console.error — o worker nunca derruba o processo (Req. 17.8).
 *
 * Requisitos: 17.1, 17.3, 17.8
 */

/**
 * Processa um job de auditoria gravando o registro no banco.
 * A data/hora é definida no momento da persistência (UTC, precisão de ms).
 */
export async function processAuditoriaJob(job: Job<AuditoriaJobData>): Promise<void> {
  const data = job.data;
  await prisma.auditoriaLog.create({
    data: {
      ator: data.ator,
      atorCidadaoId: data.atorCidadaoId,
      atorServidorId: data.atorServidorId,
      enderecoIp: data.enderecoIp,
      tipoAcao: data.tipoAcao,
      modulo: data.modulo,
      objetoId: data.objetoId,
      tipoObjeto: data.tipoObjeto,
      valorAnterior: data.valorAnterior,
      valorPosterior: data.valorPosterior,
      realizadaEmUtc: new Date(),
    },
  });
}

/**
 * Cria e inicia o Worker da fila de auditoria. Exposto como factory para que
 * testes e o bootstrap da aplicação possam iniciá-lo explicitamente (evita
 * abrir conexão Redis no momento do import).
 */
export function createAuditoriaWorker(): Worker<AuditoriaJobData> {
  const worker = new Worker<AuditoriaJobData>(AUDITORIA_QUEUE_NAME, processAuditoriaJob, {
    connection: bullmqConnection,
  });

  worker.on('failed', (job, err) => {
    // Após esgotar as tentativas, apenas registra a falha; nunca lança/derruba.
    const esgotou = !job || job.attemptsMade >= (job.opts.attempts ?? 1);
    console.error(
      JSON.stringify({
        level: 'error',
        scope: 'auditoria.worker',
        event: esgotou ? 'persistencia_falhou_definitiva' : 'persistencia_falhou_retry',
        jobId: job?.id,
        tipoAcao: job?.data?.tipoAcao,
        modulo: job?.data?.modulo,
        objetoId: job?.data?.objetoId,
        attemptsMade: job?.attemptsMade,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  });

  worker.on('error', (err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        scope: 'auditoria.worker',
        event: 'worker_error',
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  });

  return worker;
}
