// Worker da fila `relatorio` (tarefa 10.2 / Req. 18.5).
//
// Gera relatórios em background nos formatos CSV/PDF. O produtor
// (`relatorios.service.ts#solicitarExportacao`) grava um status inicial
// `pendente` no Redis (`relatorio:job:{jobId}`, TTL 1h) e enfileira um job
// `relatorio-export` com `{ jobId, formato, filtros, servidorId }`. Este worker:
//
//   1. Recomputa os cinco datasets via `gerarRelatorio(desserializarFiltros(...))`.
//   2. Serializa o resultado em CSV (implementação real, seções rotuladas) ou
//      PDF (stub textual documentado — a integração de um renderizador de PDF
//      real está fora do escopo desta tarefa).
//   3. Salva o artefato no MinIO em `relatorios/{servidorId}/{jobId}.{ext}`.
//   4. Atualiza o status no Redis para `concluido` com a URL de download
//      (presigned GET), ou `falhou` em caso de erro.
//
// Segue o mesmo estilo de `notificacao.worker.ts`: tudo é injetável via `deps`
// com defaults reais resolvidos preguiçosamente (`createRequire`), de modo que
// importar este módulo não abre nenhuma conexão (Redis/MinIO/DB) e o processor
// é unit-testável sem serviços reais. Uma linha ruim de dado nunca derruba o
// job — a serialização é tolerante a valores ausentes.

import { Worker, type Job } from 'bullmq';
import { createRequire } from 'node:module';
import { bullmqConnection } from '../config/bullmq.js';
import { QUEUE_NAMES } from './queues.js';
import type { RelatorioJob } from './types.js';
// Importa direto do serviço (não do barrel index.js) para NÃO puxar o router
// Express de forma transitiva para dentro do worker/testes.
import {
  gerarRelatorio,
  desserializarFiltros,
  chaveStatusRelatorio,
  RELATORIO_STATUS_TTL_SEG,
  type FiltrosRelatorioSerializado,
  type RelatorioResultado,
  type RelatorioStatusRecord,
  type FormatoRelatorio,
} from '../modules/relatorios/relatorios.service.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Bucket do MinIO onde os relatórios exportados são armazenados. */
export const RELATORIO_BUCKET = 'relatorios';

/** Validade (segundos) da presigned URL de download do relatório — 1h. */
export const RELATORIO_DOWNLOAD_TTL_SEG = 3600;

// ---------------------------------------------------------------------------
// Serialização (helpers puros, exportados para teste)
// ---------------------------------------------------------------------------

/** Escapa um valor para uma célula CSV (RFC 4180): aspas quando contém `,`, `"` ou quebra de linha. */
export function escapeCsv(valor: unknown): string {
  const s = valor === null || valor === undefined ? '' : String(valor);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Monta uma linha CSV a partir de células já como valores brutos. */
function linhaCsv(celulas: unknown[]): string {
  return celulas.map(escapeCsv).join(',');
}

/**
 * Achata os cinco datasets do relatório em um único CSV com seções rotuladas.
 * Cada seção começa com uma linha `# <nome>`, seguida do cabeçalho e das linhas.
 * Implementação real e determinística; tolerante a datasets vazios.
 */
export function toCsv(resultado: RelatorioResultado): string {
  const linhas: string[] = [];

  linhas.push(linhaCsv(['# periodo']));
  linhas.push(linhaCsv(['dataInicio', 'dataFim']));
  linhas.push(linhaCsv([resultado.periodo?.dataInicio ?? '', resultado.periodo?.dataFim ?? '']));
  linhas.push('');

  linhas.push(linhaCsv(['# volumePorPeriodo']));
  linhas.push(linhaCsv(['data', 'total']));
  for (const r of resultado.volumePorPeriodo ?? []) {
    linhas.push(linhaCsv([r.data, r.total]));
  }
  linhas.push('');

  linhas.push(linhaCsv(['# tempoMedioPorTipo']));
  linhas.push(linhaCsv(['tipoProcessoId', 'tipoProcesso', 'tempoMedioDias', 'totalResolvidos']));
  for (const r of resultado.tempoMedioPorTipo ?? []) {
    linhas.push(linhaCsv([r.tipoProcessoId, r.tipoProcesso, r.tempoMedioDias ?? '', r.totalResolvidos]));
  }
  linhas.push('');

  linhas.push(linhaCsv(['# taxaPorUnidade']));
  linhas.push(linhaCsv(['unidadeId', 'unidade', 'aprovados', 'rejeitados', 'total', 'taxaAprovacao', 'taxaRejeicao']));
  for (const r of resultado.taxaPorUnidade ?? []) {
    linhas.push(linhaCsv([r.unidadeId, r.unidade, r.aprovados, r.rejeitados, r.total, r.taxaAprovacao, r.taxaRejeicao]));
  }
  linhas.push('');

  linhas.push(linhaCsv(['# vencidosPorServidor']));
  linhas.push(linhaCsv(['servidorId', 'servidor', 'totalVencidos']));
  for (const r of resultado.vencidosPorServidor ?? []) {
    linhas.push(linhaCsv([r.servidorId ?? '', r.servidor, r.totalVencidos]));
  }
  linhas.push('');

  linhas.push(linhaCsv(['# volumePorCategoria']));
  linhas.push(linhaCsv(['categoriaId', 'categoria', 'total']));
  for (const r of resultado.volumePorCategoria ?? []) {
    linhas.push(linhaCsv([r.categoriaId, r.categoria, r.total]));
  }

  return linhas.join('\n');
}

/**
 * Gera um PDF mínimo (stub documentado) a partir do relatório. Produz um PDF
 * 1.4 válido de página única contendo um resumo textual do relatório. NÃO é um
 * renderizador completo — a diagramação rica está fora do escopo desta tarefa;
 * o objetivo é entregar um artefato binário abrível e determinístico.
 */
export function toPdf(resultado: RelatorioResultado): Buffer {
  const resumo = [
    'Relatorio Auditar',
    `Periodo: ${resultado.periodo?.dataInicio ?? '-'} a ${resultado.periodo?.dataFim ?? '-'}`,
    `Volume por periodo: ${resultado.volumePorPeriodo?.length ?? 0} dia(s)`,
    `Tempo medio por tipo: ${resultado.tempoMedioPorTipo?.length ?? 0} tipo(s)`,
    `Taxa por unidade: ${resultado.taxaPorUnidade?.length ?? 0} unidade(s)`,
    `Vencidos por servidor: ${resultado.vencidosPorServidor?.length ?? 0} servidor(es)`,
    `Volume por categoria: ${resultado.volumePorCategoria?.length ?? 0} categoria(s)`,
  ];

  // Monta um conteúdo de página com uma linha de texto por item do resumo.
  const textOps = resumo
    .map((linha, i) => {
      const y = 760 - i * 20;
      const escapado = linha.replace(/([\\()])/g, '\\$1');
      return `BT /F1 12 Tf 50 ${y} Td (${escapado}) Tj ET`;
    })
    .join('\n');
  const stream = textOps;
  const streamLen = Buffer.byteLength(stream, 'utf8');

  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${streamLen} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 0; i < objetos.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${i + 1} 0 obj\n${objetos[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objetos.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, 'utf8');
}

/** Serializa o relatório no formato solicitado, retornando o buffer e a extensão. */
export function serializarRelatorio(
  resultado: RelatorioResultado,
  formato: FormatoRelatorio,
): { buffer: Buffer; ext: string; contentType: string } {
  if (formato === 'pdf') {
    return { buffer: toPdf(resultado), ext: 'pdf', contentType: 'application/pdf' };
  }
  return { buffer: Buffer.from(toCsv(resultado), 'utf8'), ext: 'csv', contentType: 'text/csv' };
}

// ---------------------------------------------------------------------------
// Dependências injetáveis
// ---------------------------------------------------------------------------

/** Superfície mínima do cliente MinIO usada pelo worker. */
export interface RelatorioMinio {
  bucketExists(bucket: string): Promise<boolean>;
  makeBucket(bucket: string, region?: string): Promise<void>;
  putObject(
    bucket: string,
    objectName: string,
    stream: Buffer,
    size?: number,
    metaData?: Record<string, string>,
  ): Promise<unknown>;
  presignedGetObject(bucket: string, objectName: string, expiry?: number): Promise<string>;
}

/** Superfície mínima do Redis usada pelo worker (status do job). */
export interface RelatorioWorkerRedis {
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

/** Assinatura da função que (re)computa os datasets do relatório. */
export type GerarRelatorioFn = (
  filtros: ReturnType<typeof desserializarFiltros>,
) => Promise<RelatorioResultado>;

/** Dependências injetáveis do processor de relatório. */
export interface RelatorioWorkerDeps {
  minio: RelatorioMinio;
  redis: RelatorioWorkerRedis;
  gerar: GerarRelatorioFn;
  bucket: string;
}

// ---------------------------------------------------------------------------
// Defaults reais preguiçosos — nada roda no import.
// ---------------------------------------------------------------------------

let cachedMinio: RelatorioMinio | undefined;
function getRealMinio(): RelatorioMinio {
  if (!cachedMinio) {
    const requireLocal = createRequire(import.meta.url);
    const { minio } = requireLocal('../config/minio.js') as { minio: RelatorioMinio };
    cachedMinio = minio;
  }
  return cachedMinio;
}

let cachedRedis: RelatorioWorkerRedis | undefined;
function getRealRedis(): RelatorioWorkerRedis {
  if (!cachedRedis) {
    const requireLocal = createRequire(import.meta.url);
    const { redis } = requireLocal('../config/redis.js') as { redis: RelatorioWorkerRedis };
    cachedRedis = redis;
  }
  return cachedRedis;
}

function getRealBucket(): string {
  try {
    const requireLocal = createRequire(import.meta.url);
    const { env } = requireLocal('../config/env.js') as {
      env: { MINIO_BUCKET_RELATORIOS?: string };
    };
    return env.MINIO_BUCKET_RELATORIOS ?? RELATORIO_BUCKET;
  } catch {
    return RELATORIO_BUCKET;
  }
}

/** Default real do recomputo: delega para o serviço com o Prisma real. */
const realGerar: GerarRelatorioFn = (filtros) => gerarRelatorio(filtros);

function resolveDeps(deps?: Partial<RelatorioWorkerDeps>): RelatorioWorkerDeps {
  return {
    minio: deps?.minio ?? getRealMinio(),
    redis: deps?.redis ?? getRealRedis(),
    gerar: deps?.gerar ?? realGerar,
    bucket: deps?.bucket ?? getRealBucket(),
  };
}

// ---------------------------------------------------------------------------
// Persistência de status
// ---------------------------------------------------------------------------

/** Grava o registro de status do job no Redis (mesma chave/TTL do serviço). */
async function gravarStatus(
  redis: RelatorioWorkerRedis,
  record: RelatorioStatusRecord,
): Promise<void> {
  await redis.set(
    chaveStatusRelatorio(record.jobId),
    JSON.stringify(record),
    'EX',
    RELATORIO_STATUS_TTL_SEG,
  );
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

/**
 * Processa um job de exportação de relatório (Req. 18.5).
 *
 * Recomputa os datasets, serializa (CSV/PDF), salva no MinIO em
 * `relatorios/{servidorId}/{jobId}.{ext}` e atualiza o status no Redis para
 * `concluido` com a presigned URL de download. Em qualquer erro, registra o
 * status `falhou` (sem relançar por padrão — o worker de background não deve
 * derrubar o processo). Retorna o registro final para facilitar o teste.
 */
export async function processarRelatorio(
  job: Job<RelatorioJob>,
  deps?: Partial<RelatorioWorkerDeps>,
): Promise<RelatorioStatusRecord> {
  const d = resolveDeps(deps);
  const { jobId, formato, filtros, servidorId } = job.data;
  const formatoValido = (formato ?? 'csv') as FormatoRelatorio;

  try {
    const resultado = await d.gerar(
      desserializarFiltros((filtros ?? {}) as FiltrosRelatorioSerializado),
    );

    const { buffer, ext, contentType } = serializarRelatorio(resultado, formatoValido);
    const objectName = `relatorios/${servidorId}/${jobId}.${ext}`;

    // Garante o bucket (idempotente) antes de gravar.
    const existe = await d.minio.bucketExists(d.bucket).catch(() => false);
    if (!existe) {
      await d.minio.makeBucket(d.bucket).catch(() => {
        /* corrida de criação concorrente — ignorável */
      });
    }

    await d.minio.putObject(d.bucket, objectName, buffer, buffer.length, {
      'Content-Type': contentType,
    });

    let downloadUrl = objectName;
    try {
      downloadUrl = await d.minio.presignedGetObject(
        d.bucket,
        objectName,
        RELATORIO_DOWNLOAD_TTL_SEG,
      );
    } catch {
      // Sem presigned URL disponível: expõe o caminho do objeto como fallback.
      downloadUrl = objectName;
    }

    const record: RelatorioStatusRecord = {
      jobId,
      status: 'concluido',
      formato: formatoValido,
      downloadUrl,
      criadoEm: new Date().toISOString(),
    };
    await gravarStatus(d.redis, record);
    return record;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        scope: 'relatorio.worker',
        event: 'exportacao_falhou',
        jobId,
        formato: formatoValido,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    const record: RelatorioStatusRecord = {
      jobId,
      status: 'falhou',
      formato: formatoValido,
      criadoEm: new Date().toISOString(),
    };
    // Registro de falha é best-effort; nunca relança.
    await gravarStatus(d.redis, record).catch(() => {});
    return record;
  }
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

/**
 * Cria e inicia o Worker da fila `relatorio`. Exposto como factory para que o
 * bootstrap e os testes controlem quando a conexão Redis é aberta (importar
 * este módulo não abre conexão alguma).
 */
export function createRelatorioWorker(): Worker<RelatorioJob> {
  const worker = new Worker<RelatorioJob>(
    QUEUE_NAMES.RELATORIO,
    (job) => processarRelatorio(job),
    { connection: bullmqConnection },
  );

  worker.on('failed', (job, err) => {
    console.error(
      JSON.stringify({
        level: 'error',
        scope: 'relatorio.worker',
        event: 'job_failed',
        jobId: job?.data?.jobId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  });

  return worker;
}
