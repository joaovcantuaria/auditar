import { createRequire } from 'node:module';
import type { PrismaClient, Prisma } from '@prisma/client';
import { ErrorCodes } from '@auditar/shared';
import type { PaginatedResult } from '@auditar/shared';
import { prisma as realPrisma } from '../../config/database.js';
import {
  buildPaginatedResult,
  getPaginationParams,
  badRequest,
} from '../../utils/index.js';

/**
 * Serviço de CONSULTA/LEITURA de Auditoria (Req. 17.2, 17.4, 17.5, 17.6, 17.7).
 *
 * Mantido separado do serviço de escrita (`auditoria.service.ts`, tarefa 2.6)
 * para não interferir no caminho de gravação. Este módulo é ESTRITAMENTE de
 * leitura — não expõe nenhuma operação de create/update/delete sobre o
 * `AuditoriaLog` (Req. 17.7). A única mutação possível é solicitar um job de
 * EXPORTAÇÃO, que grava apenas um registro de status no Redis (nunca no log).
 *
 * Cobre:
 *  - Listagem paginada (≤100/página) com filtros combináveis (Req. 17.2, 17.4).
 *  - Exportação CSV/PDF via enfileiramento em background (Req. 17.5).
 *  - Consulta de status do job de exportação (Req. 17.5).
 */

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Tamanho de página padrão E máximo do log de auditoria (Req. 17.2). */
export const AUDITORIA_PAGE_SIZE_MAX = 100;

/** Prefixo da chave de status do job de exportação no Redis (Req. 17.5). */
export const EXPORT_STATUS_PREFIX = 'auditoria:export:';

/** TTL (segundos) do registro de status de exportação — 1 hora (Req. 17.5). */
export const EXPORT_STATUS_TTL_SEG = 3600;

/** Nome da fila reutilizada para exportações (compartilha `relatorio`). */
export const AUDITORIA_EXPORT_QUEUE = 'relatorio';

/** Nome do job de exportação de auditoria dentro da fila `relatorio`. */
export const AUDITORIA_EXPORT_JOB = 'auditoria-export';

/** Formatos de exportação suportados (Req. 17.5). */
export const FORMATOS_EXPORT = ['csv', 'pdf'] as const;
export type FormatoExport = (typeof FORMATOS_EXPORT)[number];

/** Estados possíveis de um job de exportação. */
export type ExportStatus = 'pendente' | 'processando' | 'concluido' | 'falhou';

// ---------------------------------------------------------------------------
// Filtros e ordenação
// ---------------------------------------------------------------------------

/** Filtros combináveis do log de auditoria (Req. 17.4). */
export interface FiltrosAuditoria {
  /** Início do intervalo sobre `realizadaEmUtc`. */
  dataInicio?: Date;
  /** Fim do intervalo sobre `realizadaEmUtc`. */
  dataFim?: Date;
  /** Tipo de ação (ex.: 'login', 'mover_etapa'). */
  tipoAcao?: string;
  /** Categoria do ator: 'cidadao' | 'servidor' | 'sistema'. */
  ator?: string;
  /** Id do ator (resolvido para atorCidadaoId ou atorServidorId conforme `ator`). */
  atorId?: string;
  /** Módulo de origem (ex.: 'processos', 'auth'). */
  modulo?: string;
  /**
   * Protocolo do processo. Como o `AuditoriaLog` guarda `objetoId` (não o
   * protocolo), o filtro é traduzido para o id do Processo correspondente
   * (Req. 17.4). Protocolo desconhecido → resultado vazio.
   */
  protocolo?: string;
}

/** Payload enfileirado para o job de exportação de auditoria. */
export interface AuditoriaExportJobData {
  jobId: string;
  formato: FormatoExport;
  filtros: FiltrosAuditoriaSerializada;
}

/** Filtros serializados (datas como ISO string) para transporte na fila. */
export interface FiltrosAuditoriaSerializada {
  dataInicio?: string;
  dataFim?: string;
  tipoAcao?: string;
  ator?: string;
  atorId?: string;
  modulo?: string;
  protocolo?: string;
}

/** Registro de status persistido no Redis (Req. 17.5). */
export interface ExportStatusRecord {
  jobId: string;
  status: ExportStatus;
  formato: FormatoExport;
  downloadUrl?: string;
  criadoEm: string;
}

// ---------------------------------------------------------------------------
// Construção do `where` (Req. 17.4)
// ---------------------------------------------------------------------------

/**
 * Monta a cláusula `where` do Prisma a partir dos filtros combináveis.
 *
 * O filtro por `protocolo` NÃO é resolvido aqui (exige lookup assíncrono no
 * Processo); em vez disso ele é traduzido por {@link resolverObjetoId} e
 * passado como `objetoId`. Todos os demais filtros são combináveis.
 */
export function montarWhereAuditoria(
  filtros: FiltrosAuditoria = {},
  objetoId?: string,
): Prisma.AuditoriaLogWhereInput {
  const where: Prisma.AuditoriaLogWhereInput = {};

  if (filtros.tipoAcao) where.tipoAcao = filtros.tipoAcao;
  if (filtros.modulo) where.modulo = filtros.modulo;
  if (filtros.ator) where.ator = filtros.ator;

  // Id do ator: direcionado para a coluna certa conforme a categoria do ator.
  if (filtros.atorId) {
    if (filtros.ator === 'cidadao') {
      where.atorCidadaoId = filtros.atorId;
    } else if (filtros.ator === 'servidor') {
      where.atorServidorId = filtros.atorId;
    } else {
      // Sem `ator` definido: casa em qualquer uma das colunas de ator.
      where.OR = [
        { atorCidadaoId: filtros.atorId },
        { atorServidorId: filtros.atorId },
      ];
    }
  }

  // Intervalo de data/hora sobre `realizadaEmUtc` (Req. 17.4).
  if (filtros.dataInicio || filtros.dataFim) {
    where.realizadaEmUtc = {
      ...(filtros.dataInicio ? { gte: filtros.dataInicio } : {}),
      ...(filtros.dataFim ? { lte: filtros.dataFim } : {}),
    };
  }

  // Protocolo → objetoId (resolvido pelo chamador).
  if (objetoId !== undefined) {
    where.objetoId = objetoId;
  }

  return where;
}

/**
 * Valida o intervalo de datas: quando ambos são informados, `dataFim` deve ser
 * ≥ `dataInicio` (Req. 17.4). Lança `badRequest` caso contrário.
 */
export function validarIntervalo(filtros: FiltrosAuditoria): void {
  if (filtros.dataInicio && filtros.dataFim && filtros.dataFim < filtros.dataInicio) {
    throw badRequest(
      ErrorCodes.VALIDATION_ERROR,
      'A data final deve ser maior ou igual à data inicial.',
      'dataFim',
    );
  }
}

// ---------------------------------------------------------------------------
// Injeção de dependências
// ---------------------------------------------------------------------------

/** Interface mínima do Redis usada aqui (facilita testes/mocks). */
export interface RedisPort {
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

/** Interface mínima da fila usada pela exportação (injetável em testes). */
export interface ExportEnqueuer {
  add(name: string, data: AuditoriaExportJobData): Promise<unknown>;
}

/** Dependências injetáveis do serviço de consulta (testes injetam mocks). */
export interface AuditoriaQueryDeps {
  prisma: Pick<PrismaClient, 'auditoriaLog' | 'processo'>;
  redis: RedisPort;
  enqueue: ExportEnqueuer;
}

/** Resolve o Redis real preguiçosamente (sem abrir conexão ao importar). */
function resolveRedis(): RedisPort {
  const requireLocal = createRequire(import.meta.url);
  const { redis } = requireLocal('../../config/redis.js') as { redis: RedisPort };
  return redis;
}

/** Resolve a fila real de exportação preguiçosamente. */
function resolveEnqueue(): ExportEnqueuer {
  const requireLocal = createRequire(import.meta.url);
  const { getQueue } = requireLocal('../../jobs/queues.js') as {
    getQueue: (name: string) => ExportEnqueuer;
  };
  return getQueue(AUDITORIA_EXPORT_QUEUE);
}

function resolveDeps(deps?: Partial<AuditoriaQueryDeps>): AuditoriaQueryDeps {
  return {
    prisma: deps?.prisma ?? (realPrisma as unknown as AuditoriaQueryDeps['prisma']),
    redis: deps?.redis ?? resolveRedis(),
    enqueue: deps?.enqueue ?? resolveEnqueue(),
  };
}

// ---------------------------------------------------------------------------
// Resolução de protocolo → objetoId
// ---------------------------------------------------------------------------

/**
 * Traduz um `protocolo` de processo para o `objetoId` armazenado no log de
 * auditoria (Req. 17.4). Retorna `null` (sentinela de "não encontrado") quando
 * o protocolo não corresponde a nenhum processo — o chamador deve, nesse caso,
 * devolver resultado vazio sem consultar o log.
 */
export async function resolverObjetoId(
  protocolo: string,
  prisma: Pick<PrismaClient, 'processo'>,
): Promise<string | null> {
  const processo = await prisma.processo.findUnique({
    where: { protocolo },
    select: { id: true },
  });
  return processo?.id ?? null;
}

// ---------------------------------------------------------------------------
// Item da listagem
// ---------------------------------------------------------------------------

/** Linha do log de auditoria exposta na listagem (Req. 17.2). */
export interface AuditoriaLogItem {
  id: string;
  ator: string;
  atorCidadaoId: string | null;
  atorServidorId: string | null;
  enderecoIp: string;
  tipoAcao: string;
  modulo: string;
  objetoId: string | null;
  tipoObjeto: string | null;
  valorAnterior: string | null;
  valorPosterior: string | null;
  realizadaEmUtc: Date;
}

// ---------------------------------------------------------------------------
// Listagem paginada (Req. 17.2, 17.4)
// ---------------------------------------------------------------------------

/**
 * Lista registros de auditoria de forma paginada (≤100/página) aplicando os
 * filtros combináveis (Req. 17.2, 17.4). Ordena por `realizadaEmUtc` desc
 * (mais recentes primeiro). Quando o filtro `protocolo` não corresponde a
 * nenhum processo, devolve `data` vazio + `meta` sem consultar o log.
 */
export async function listarAuditoria(
  filtros: FiltrosAuditoria = {},
  paginacao: { page?: number; pageSize?: number } = {},
  deps?: Partial<AuditoriaQueryDeps>,
): Promise<PaginatedResult<AuditoriaLogItem>> {
  validarIntervalo(filtros);

  const { prisma } = resolveDeps(deps);

  // pageSize é limitado a 100 (Req. 17.2) — getPaginationParams já faz o clamp.
  const { skip, take, page, pageSize } = getPaginationParams(
    paginacao.page,
    Math.min(paginacao.pageSize ?? AUDITORIA_PAGE_SIZE_MAX, AUDITORIA_PAGE_SIZE_MAX),
  );

  // Resolve protocolo → objetoId antes de montar o where.
  let objetoId: string | undefined;
  if (filtros.protocolo) {
    const resolvido = await resolverObjetoId(filtros.protocolo, prisma);
    if (resolvido === null) {
      // Protocolo desconhecido: resultado vazio (Req. 17.4).
      return buildPaginatedResult<AuditoriaLogItem>([], 0, page, pageSize);
    }
    objetoId = resolvido;
  }

  const where = montarWhereAuditoria(filtros, objetoId);

  const [rows, total] = await Promise.all([
    prisma.auditoriaLog.findMany({
      where,
      orderBy: { realizadaEmUtc: 'desc' },
      skip,
      take,
    }),
    prisma.auditoriaLog.count({ where }),
  ]);

  return buildPaginatedResult(rows as AuditoriaLogItem[], total, page, pageSize);
}

// ---------------------------------------------------------------------------
// Exportação (Req. 17.5)
// ---------------------------------------------------------------------------

/** Serializa filtros para transporte na fila (datas → ISO string). */
function serializarFiltros(filtros: FiltrosAuditoria): FiltrosAuditoriaSerializada {
  return {
    dataInicio: filtros.dataInicio?.toISOString(),
    dataFim: filtros.dataFim?.toISOString(),
    tipoAcao: filtros.tipoAcao,
    ator: filtros.ator,
    atorId: filtros.atorId,
    modulo: filtros.modulo,
    protocolo: filtros.protocolo,
  };
}

/** Gera um identificador de job de exportação. */
function gerarJobId(): string {
  const requireLocal = createRequire(import.meta.url);
  const { randomUUID } = requireLocal('node:crypto') as typeof import('node:crypto');
  return randomUUID();
}

/** Chave Redis do status de um job de exportação. */
export function chaveStatusExport(jobId: string): string {
  return `${EXPORT_STATUS_PREFIX}${jobId}`;
}

/**
 * Solicita uma exportação do log de auditoria (Req. 17.5).
 *
 * Valida o formato e o intervalo de datas, grava um registro de status inicial
 * no Redis (TTL 1h) e enfileira um job na fila `relatorio` com o payload de
 * exportação. Esta é a ÚNICA operação de mutação do módulo, e ela nunca escreve
 * no `AuditoriaLog` — apenas em uma chave de status transitória (Req. 17.7).
 *
 * @returns o `jobId` para acompanhamento posterior via {@link statusExportacao}.
 */
export async function solicitarExportacao(
  formato: string,
  filtros: FiltrosAuditoria = {},
  deps?: Partial<AuditoriaQueryDeps>,
): Promise<{ jobId: string }> {
  if (!FORMATOS_EXPORT.includes(formato as FormatoExport)) {
    throw badRequest(
      ErrorCodes.VALIDATION_ERROR,
      `Formato inválido. Use um de: ${FORMATOS_EXPORT.join(', ')}.`,
      'formato',
    );
  }
  validarIntervalo(filtros);

  const { redis, enqueue } = resolveDeps(deps);
  const jobId = gerarJobId();
  const formatoValido = formato as FormatoExport;

  const statusInicial: ExportStatusRecord = {
    jobId,
    status: 'pendente',
    formato: formatoValido,
    criadoEm: new Date().toISOString(),
  };

  // Grava o status inicial no Redis com TTL de 1h (Req. 17.5).
  await redis.set(
    chaveStatusExport(jobId),
    JSON.stringify(statusInicial),
    'EX',
    EXPORT_STATUS_TTL_SEG,
  );

  // Enfileira o job para geração em background.
  await enqueue.add(AUDITORIA_EXPORT_JOB, {
    jobId,
    formato: formatoValido,
    filtros: serializarFiltros(filtros),
  });

  return { jobId };
}

/**
 * Lê o status de um job de exportação a partir do Redis (Req. 17.5).
 * Retorna `null` quando a chave não existe (job desconhecido/expirado).
 */
export async function statusExportacao(
  jobId: string,
  deps?: Partial<AuditoriaQueryDeps>,
): Promise<ExportStatusRecord | null> {
  const { redis } = resolveDeps(deps);
  const raw = await redis.get(chaveStatusExport(jobId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ExportStatusRecord;
  } catch {
    return null;
  }
}
