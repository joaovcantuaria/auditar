import { createRequire } from 'node:module';
import type { Queue as QueueType } from 'bullmq';
import type { PrismaClient, Prisma } from '@prisma/client';
import { bullmqConnection } from '../../config/bullmq.js';
import type { AuditoriaJobData, RegistrarAuditoriaDto } from './auditoria.types.js';

/**
 * Serviço de Auditoria.
 *
 * Responsável por registrar ações relevantes do sistema. O caminho padrão
 * (`registrar`) é assíncrono: enfileira o registro na `auditoria-queue` e o
 * `AuditoriaWorker` persiste no banco. Uma falha ao enfileirar NÃO deve
 * interromper a operação original (Req. 17.8).
 *
 * Para casos onde a auditoria precisa ser atômica com a operação de negócio
 * (ex: tramitação — Req. 11.9), use `registrarSync`, que grava diretamente
 * dentro de uma transação fornecida pelo chamador e PROPAGA falhas.
 *
 * Requisitos: 17.1, 17.3, 17.8, 11.9
 */

export const AUDITORIA_QUEUE_NAME = 'auditoria';

const MAX_VALOR_LENGTH = 1000;

/** Configuração da fila: 3 tentativas com backoff, retenção limitada. */
const auditoriaQueueOptions = {
  connection: bullmqConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'fixed' as const, delay: 30_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
};

/**
 * Instância criada preguiçosamente (lazy). Importar este módulo em testes NÃO
 * deve abrir uma conexão real com o Redis — a fila só é instanciada na primeira
 * chamada a `getAuditoriaQueue()`.
 */
let queueInstance: QueueType<AuditoriaJobData> | undefined;

export function getAuditoriaQueue(): QueueType<AuditoriaJobData> {
  if (!queueInstance) {
    // Carrega a bullmq apenas no momento do uso, mantendo-a fora do grafo
    // estático de imports (evita resolver/abrir Redis ao importar em testes).
    const require = createRequire(import.meta.url);
    const { Queue } = require('bullmq') as typeof import('bullmq');
    queueInstance = new Queue<AuditoriaJobData>(AUDITORIA_QUEUE_NAME, auditoriaQueueOptions);
  }
  return queueInstance;
}

/** Interface mínima da fila usada por `registrar` — facilita injeção em testes. */
export interface AuditoriaEnqueuer {
  add(name: string, data: AuditoriaJobData): Promise<unknown>;
}

/**
 * Serializa um valor em JSON e trunca para no máximo 1000 caracteres.
 * Retorna `undefined` quando o valor de entrada é `undefined`.
 */
export function stringifyValor(v: unknown): string | undefined {
  if (v === undefined) {
    return undefined;
  }
  let serialized: string;
  try {
    serialized = typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    // Estruturas circulares ou não serializáveis: cai para representação simples.
    serialized = String(v);
  }
  if (serialized === undefined) {
    return undefined;
  }
  return serialized.length > MAX_VALOR_LENGTH
    ? serialized.slice(0, MAX_VALOR_LENGTH)
    : serialized;
}

/** Converte o DTO recebido no payload pronto para persistência/enfileiramento. */
function toJobData(dto: RegistrarAuditoriaDto): AuditoriaJobData {
  return {
    ator: dto.ator,
    atorCidadaoId: dto.atorCidadaoId,
    atorServidorId: dto.atorServidorId,
    enderecoIp: dto.enderecoIp,
    tipoAcao: dto.tipoAcao,
    modulo: dto.modulo,
    objetoId: dto.objetoId,
    tipoObjeto: dto.tipoObjeto,
    valorAnterior: stringifyValor(dto.valorAnterior),
    valorPosterior: stringifyValor(dto.valorPosterior),
  };
}

/**
 * Registra uma ação de auditoria de forma assíncrona, enfileirando o job na
 * `auditoria-queue`. Uma eventual falha ao enfileirar é registrada internamente
 * (console.error estruturado) mas NÃO é propagada — a operação de negócio que
 * disparou a auditoria não pode ser interrompida (Req. 17.8).
 *
 * @param dto   Dados da ação a registrar.
 * @param queue Fila opcional (injeção de dependência p/ testes). Quando ausente,
 *              usa a fila singleton instanciada preguiçosamente.
 */
export async function registrar(
  dto: RegistrarAuditoriaDto,
  queue: AuditoriaEnqueuer = getAuditoriaQueue(),
): Promise<void> {
  const jobData = toJobData(dto);
  try {
    await queue.add(AUDITORIA_QUEUE_NAME, jobData);
  } catch (err) {
    // Falha de auditoria assíncrona nunca interrompe a operação original.
    console.error(
      JSON.stringify({
        level: 'error',
        scope: 'auditoria',
        event: 'enfileiramento_falhou',
        tipoAcao: jobData.tipoAcao,
        modulo: jobData.modulo,
        objetoId: jobData.objetoId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** Cliente Prisma mínimo aceito por `registrarSync` (transação ou client). */
export type PrismaAuditoriaClient = Pick<PrismaClient, 'auditoriaLog'> | Prisma.TransactionClient;

/**
 * Registra uma ação de auditoria de forma SÍNCRONA, gravando diretamente no
 * banco através do client/transação fornecido pelo chamador. Deve ser usado
 * quando a auditoria precisa ser atômica com a operação de negócio (Req. 11.9);
 * em caso de falha, o erro é PROPAGADO para que a transação seja revertida.
 *
 * @param dto           Dados da ação a registrar.
 * @param prismaClient  Client Prisma (tipicamente o `tx` de uma transação).
 */
export async function registrarSync(
  dto: RegistrarAuditoriaDto,
  prismaClient: PrismaAuditoriaClient,
): Promise<void> {
  const jobData = toJobData(dto);
  await prismaClient.auditoriaLog.create({
    data: {
      ator: jobData.ator,
      atorCidadaoId: jobData.atorCidadaoId,
      atorServidorId: jobData.atorServidorId,
      enderecoIp: jobData.enderecoIp,
      tipoAcao: jobData.tipoAcao,
      modulo: jobData.modulo,
      objetoId: jobData.objetoId,
      tipoObjeto: jobData.tipoObjeto,
      valorAnterior: jobData.valorAnterior,
      valorPosterior: jobData.valorPosterior,
      realizadaEmUtc: new Date(),
    },
  });
}
