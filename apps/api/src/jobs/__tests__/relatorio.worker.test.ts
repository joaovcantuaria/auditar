import { describe, it, expect, vi } from 'vitest';
import type { Job } from 'bullmq';

// Mock bullmq para que importar o worker nunca abra conexão Redis nem exija o
// módulo nativo `bullmq` no transform de teste (mesmo padrão de
// notificacao.worker.test.ts). O Worker não é instanciado nestes testes.
vi.mock('bullmq', () => ({ Worker: class {}, Queue: class {} }));
vi.mock('../../config/bullmq.js', () => ({ bullmqConnection: {} }));

// Stub da infra para não abrir conexão real ao importar o worker/serviço.
vi.mock('../../config/database.js', () => ({ prisma: {} }));
vi.mock('../../config/redis.js', () => ({ redis: {} }));
vi.mock('../../config/minio.js', () => ({ minio: {} }));
vi.mock('../queues.js', () => ({
  QUEUE_NAMES: { RELATORIO: 'relatorio' },
  getQueue: () => ({ add: vi.fn() }),
}));

import {
  processarRelatorio,
  toCsv,
  escapeCsv,
  serializarRelatorio,
  type RelatorioWorkerDeps,
} from '../relatorio.worker.js';
import type { RelatorioJob } from '../types.js';
import type { RelatorioResultado } from '../../modules/relatorios/relatorios.service.js';

function resultadoFake(): RelatorioResultado {
  return {
    periodo: { dataInicio: '2024-01-01T00:00:00.000Z', dataFim: '2024-01-31T00:00:00.000Z' },
    volumePorPeriodo: [{ data: '2024-01-01', total: 2 }],
    tempoMedioPorTipo: [
      { tipoProcessoId: 'tp-1', tipoProcesso: 'Licença, especial', tempoMedioDias: 3, totalResolvidos: 2 },
    ],
    taxaPorUnidade: [
      {
        unidadeId: 'u-1',
        unidade: 'Central',
        aprovados: 3,
        rejeitados: 1,
        total: 4,
        taxaAprovacao: 0.75,
        taxaRejeicao: 0.25,
      },
    ],
    vencidosPorServidor: [{ servidorId: 'srv-1', servidor: 'Ana', totalVencidos: 5 }],
    volumePorCategoria: [{ categoriaId: 'cat-1', categoria: 'Fiscal', total: 10 }],
  };
}

function makeJob(over: Partial<RelatorioJob> = {}): Job<RelatorioJob> {
  return {
    data: {
      jobId: 'job-1',
      formato: 'csv',
      filtros: {},
      servidorId: 'srv-9',
      ...over,
    },
  } as Job<RelatorioJob>;
}

function makeDeps(over: Partial<RelatorioWorkerDeps> = {}): {
  deps: Partial<RelatorioWorkerDeps>;
  putObject: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  presignedGetObject: ReturnType<typeof vi.fn>;
  gerar: ReturnType<typeof vi.fn>;
} {
  const putObject = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockResolvedValue('OK');
  const presignedGetObject = vi.fn().mockResolvedValue('https://minio.local/get-url');
  const gerar = (over.gerar as ReturnType<typeof vi.fn>) ?? vi.fn().mockResolvedValue(resultadoFake());

  const deps: Partial<RelatorioWorkerDeps> = {
    minio: {
      bucketExists: vi.fn().mockResolvedValue(true),
      makeBucket: vi.fn().mockResolvedValue(undefined),
      putObject,
      presignedGetObject,
    },
    redis: { set, get: vi.fn() },
    gerar,
    bucket: 'relatorios',
    ...over,
  };

  return { deps, putObject, set, presignedGetObject, gerar };
}

// ---------------------------------------------------------------------------
// escapeCsv / toCsv (helpers puros)
// ---------------------------------------------------------------------------

describe('escapeCsv', () => {
  it('leaves plain values untouched', () => {
    expect(escapeCsv('abc')).toBe('abc');
    expect(escapeCsv(42)).toBe('42');
  });

  it('quotes and escapes values containing commas, quotes or newlines', () => {
    expect(escapeCsv('a,b')).toBe('"a,b"');
    expect(escapeCsv('a"b')).toBe('"a""b"');
    expect(escapeCsv('a\nb')).toBe('"a\nb"');
  });

  it('renders null/undefined as empty cells', () => {
    expect(escapeCsv(null)).toBe('');
    expect(escapeCsv(undefined)).toBe('');
  });
});

describe('toCsv', () => {
  it('serializes the five datasets and escapes values with commas', () => {
    const csv = toCsv(resultadoFake());
    expect(csv).toContain('# volumePorPeriodo');
    expect(csv).toContain('2024-01-01,2');
    expect(csv).toContain('# taxaPorUnidade');
    expect(csv).toContain('u-1,Central,3,1,4,0.75,0.25');
    // valor com vírgula deve ser escapado
    expect(csv).toContain('"Licença, especial"');
  });
});

describe('serializarRelatorio', () => {
  it('produces a csv buffer for the csv format', () => {
    const { buffer, ext, contentType } = serializarRelatorio(resultadoFake(), 'csv');
    expect(ext).toBe('csv');
    expect(contentType).toBe('text/csv');
    expect(buffer.toString('utf8')).toContain('# periodo');
  });

  it('produces a pdf buffer for the pdf format', () => {
    const { buffer, ext, contentType } = serializarRelatorio(resultadoFake(), 'pdf');
    expect(ext).toBe('pdf');
    expect(contentType).toBe('application/pdf');
    expect(buffer.toString('utf8').startsWith('%PDF-1.4')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// processarRelatorio
// ---------------------------------------------------------------------------

describe('processarRelatorio', () => {
  it('recomputes, serializes, saves to MinIO and sets Redis status concluido', async () => {
    const { deps, putObject, set, presignedGetObject, gerar } = makeDeps();

    const record = await processarRelatorio(makeJob(), deps);

    expect(gerar).toHaveBeenCalledTimes(1);

    // salvou no MinIO no caminho relatorios/{servidorId}/{jobId}.{ext}
    expect(putObject).toHaveBeenCalledTimes(1);
    const [bucket, objectName] = putObject.mock.calls[0];
    expect(bucket).toBe('relatorios');
    expect(objectName).toBe('relatorios/srv-9/job-1.csv');

    expect(presignedGetObject).toHaveBeenCalledWith('relatorios', 'relatorios/srv-9/job-1.csv', expect.any(Number));

    // status concluido gravado no Redis
    expect(record.status).toBe('concluido');
    expect(record.downloadUrl).toBe('https://minio.local/get-url');
    expect(set).toHaveBeenCalledTimes(1);
    const [, value] = set.mock.calls[0];
    expect(JSON.parse(value).status).toBe('concluido');
  });

  it('uses the pdf object key when the format is pdf', async () => {
    const { deps, putObject } = makeDeps();
    await processarRelatorio(makeJob({ formato: 'pdf' }), deps);
    expect(putObject.mock.calls[0][1]).toBe('relatorios/srv-9/job-1.pdf');
  });

  it('sets status falhou when generation throws and does not rethrow', async () => {
    const gerar = vi.fn().mockRejectedValue(new Error('db down'));
    const { deps, set, putObject } = makeDeps({ gerar });

    const record = await processarRelatorio(makeJob(), deps);

    expect(record.status).toBe('falhou');
    expect(putObject).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledTimes(1);
    expect(JSON.parse(set.mock.calls[0][1]).status).toBe('falhou');
  });

  it('creates the bucket when it does not exist', async () => {
    const makeBucket = vi.fn().mockResolvedValue(undefined);
    const { deps } = makeDeps({
      minio: {
        bucketExists: vi.fn().mockResolvedValue(false),
        makeBucket,
        putObject: vi.fn().mockResolvedValue(undefined),
        presignedGetObject: vi.fn().mockResolvedValue('https://minio.local/get-url'),
      },
    });

    await processarRelatorio(makeJob(), deps);
    expect(makeBucket).toHaveBeenCalledWith('relatorios');
  });
});
