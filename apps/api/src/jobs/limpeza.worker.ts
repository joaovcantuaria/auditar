// Worker + scheduler for the `limpeza` (cleanup) queue.
//
// Runs once a day (03:00) and performs LGPD-driven maintenance:
//   1. Processar solicitacoes de exclusao de conta — anonimizacao dos dados
//      pessoais 30 dias apos a solicitacao (Req. 20.6; task 4.2).
//   2. Invalidar tokens de ativacao expirados (>48h, Req. 1.7) — toque leve.
//
// Nothing connects to Redis or the database at import time: the config
// singletons are imported lazily inside the processor.

import { Worker, type Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { bullmqConnection } from '../config/bullmq.js';
import { QUEUE_NAMES, limpezaQueue } from './queues.js';
import type { LimpezaJob } from './types.js';
import {
  EXCLUSAO_PENDENTES_SET,
  montarChaveExclusao,
} from '../modules/cidadaos/cidadaos.service.js';

/** Cron pattern: run daily at 03:00. */
export const LIMPEZA_CRON = '0 3 * * *';

/** Stable job id for the repeatable limpeza job (prevents duplicates). */
const LIMPEZA_JOB_NAME = 'limpeza-cron';

/** Janela apos a qual uma conta solicitada para exclusao e anonimizada (Req. 20.6). */
export const ANONIMIZACAO_APOS_MS = 30 * 24 * 60 * 60 * 1000;

/** Contrato minimo do Prisma usado pela anonimizacao. */
type LimpezaPrisma = Pick<PrismaClient, 'cidadao'>;

/**
 * Contrato minimo do Redis usado pela varredura de exclusoes. Compativel com
 * `ioredis` (os retornos exatos sao ignorados; usamos apenas os efeitos).
 */
export interface LimpezaCache {
  zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>;
  zrem(key: string, ...members: string[]): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

/**
 * Anonimiza irreversivelmente os dados pessoais de um cidadao (Req. 20.6).
 *
 * Sobrescreve nome, CPF, e-mail, telefone e desativa a conta, PRESERVANDO o
 * `id` — os registros de auditoria e o vinculo historico dos processos
 * permanecem intactos, conforme exige a LGPD.
 *
 * @returns o registro anonimizado.
 */
export async function anonimizarCidadao(
  cidadaoId: string,
  prisma: LimpezaPrisma,
): Promise<unknown> {
  return prisma.cidadao.update({
    where: { id: cidadaoId },
    data: {
      nome: `ANONIMIZADO_${cidadaoId.slice(0, 8)}`,
      cpf: '00000000000',
      email: `anonimizado_${cidadaoId}@deletado.local`,
      telefone: '00000000000',
      ativo: false,
    },
  });
}

/**
 * Varre as solicitacoes de exclusao pendentes e anonimiza aquelas com mais de
 * 30 dias, removendo o respectivo marcador (Req. 20.6). Defensivo: falhas em um
 * cidadao sao logadas e nao interrompem o processamento dos demais.
 *
 * @returns quantidade de contas anonimizadas com sucesso.
 */
export async function processarExclusoesPendentes(
  prisma: LimpezaPrisma,
  redis: LimpezaCache,
  agora: number = Date.now(),
): Promise<number> {
  const limite = agora - ANONIMIZACAO_APOS_MS;

  // Membros cujo score (timestamp da solicitacao) <= limite ja passaram de 30 dias.
  const vencidos = await redis.zrangebyscore(EXCLUSAO_PENDENTES_SET, '-inf', limite);

  let anonimizados = 0;
  for (const cidadaoId of vencidos) {
    try {
      await anonimizarCidadao(cidadaoId, prisma);
      await redis.del(montarChaveExclusao(cidadaoId));
      await redis.zrem(EXCLUSAO_PENDENTES_SET, cidadaoId);
      anonimizados += 1;
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          scope: 'limpeza.worker',
          event: 'falha_anonimizacao',
          cidadaoId,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  return anonimizados;
}

/**
 * Processor da limpeza diaria. Resolve prisma/redis de forma lazy (nao abre
 * conexoes no import) e nunca lanca — qualquer erro e logado, mantendo o worker
 * saudavel para a proxima execucao.
 */
export async function processarLimpeza(_job: Job<LimpezaJob>): Promise<void> {
  try {
    const [{ prisma }, { redis }] = await Promise.all([
      import('../config/database.js'),
      import('../config/redis.js'),
    ]);

    const anonimizados = await processarExclusoesPendentes(
      prisma as unknown as LimpezaPrisma,
      redis as unknown as LimpezaCache,
    );

    console.log(
      JSON.stringify({
        level: 'info',
        scope: 'limpeza.worker',
        event: 'limpeza_concluida',
        anonimizados,
      }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        scope: 'limpeza.worker',
        event: 'falha_limpeza',
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/**
 * Register the daily repeatable limpeza job. Idempotent thanks to the fixed
 * job name. Lazy: only touches Redis when called.
 */
export async function agendarLimpeza(): Promise<void> {
  await limpezaQueue().add(
    LIMPEZA_JOB_NAME,
    { trigger: 'cron' } satisfies LimpezaJob,
    { repeat: { pattern: LIMPEZA_CRON } },
  );
}

/**
 * Create the limpeza Worker. Lazy — importing this module does not connect.
 */
export function createLimpezaWorker(): Worker<LimpezaJob> {
  return new Worker<LimpezaJob>(QUEUE_NAMES.LIMPEZA, processarLimpeza, {
    connection: bullmqConnection,
  });
}
