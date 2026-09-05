import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusProcesso } from '@auditar/shared';

// ---------------------------------------------------------------------------
// Stubs dos módulos de infra (prisma/redis/mailer/auditoria/env) para evitar
// carregar `@prisma/client`/`ioredis` reais ou abrir conexões ao IMPORTAR o
// serviço e o worker. Todos os testes injetam mocks explícitos via `deps`.
// ---------------------------------------------------------------------------
vi.mock('../../../config/database.js', () => ({ prisma: {} }));
vi.mock('../../../config/redis.js', () => ({ redis: {} }));
vi.mock('../../../config/env.js', () => ({ env: { BCRYPT_ROUNDS: 12, WEB_URL: 'http://localhost:5173' } }));
vi.mock('../../../config/bullmq.js', () => ({ bullmqConnection: {} }));
// bullmq não é resolvido em ambiente de teste (deps não instaladas); só
// precisamos das classes referenciadas no import do worker.
vi.mock('bullmq', () => ({ Worker: class {}, Queue: class {} }));
vi.mock('../cidadaos.email.js', () => ({ enviarConfirmacaoNovoEmail: vi.fn(async () => undefined) }));
vi.mock('../../../modules/auditoria/index.js', () => ({ registrar: vi.fn() }));
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn(), hash: vi.fn() } }));

// Import AFTER mocks are registered.
import {
  listarProcessosEmAndamento,
  solicitarExclusao,
  montarChaveExclusao,
  EXCLUSAO_PENDENTES_SET,
  EXCLUSAO_TTL_SECONDS,
  STATUS_ENCERRADOS,
  type CidadaosDeps,
  type AtorCidadao,
} from '../cidadaos.service.js';
import {
  anonimizarCidadao,
  processarExclusoesPendentes,
  ANONIMIZACAO_APOS_MS,
  type LimpezaCache,
} from '../../../jobs/limpeza.worker.js';

// ---------------------------------------------------------------------------
// Mocks das dependências injetadas.
// ---------------------------------------------------------------------------

const prismaMock = {
  cidadao: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  acessoHistorico: {
    findMany: vi.fn(),
  },
  processo: {
    findMany: vi.fn(),
  },
};

const redisMock = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  zadd: vi.fn(),
  zrangebyscore: vi.fn(),
  zrem: vi.fn(),
};

const auditarMock = vi.fn();

function deps(): Partial<CidadaosDeps> {
  return {
    prisma: prismaMock as unknown as CidadaosDeps['prisma'],
    redis: redisMock as unknown as CidadaosDeps['redis'],
    auditar: auditarMock,
  };
}

const ATOR: AtorCidadao = { cidadaoId: 'cid-1', enderecoIp: '203.0.113.10' };

function makeCidadao(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cid-1',
    nome: 'Maria Silva',
    cpf: '12345678909',
    email: 'maria@example.com',
    telefone: '11999998888',
    ativo: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auditarMock.mockResolvedValue(undefined);
  redisMock.set.mockResolvedValue('OK');
  redisMock.del.mockResolvedValue(1);
  redisMock.zadd.mockResolvedValue(1);
  redisMock.zrem.mockResolvedValue(1);
  redisMock.zrangebyscore.mockResolvedValue([]);
  prismaMock.processo.findMany.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// listarProcessosEmAndamento — Req. 7.7
// ---------------------------------------------------------------------------

describe('listarProcessosEmAndamento', () => {
  it('filtra por status não encerrados e mapeia protocolo + tipoProcesso.nome', async () => {
    prismaMock.processo.findMany.mockResolvedValue([
      { protocolo: '2024-00001', tipoProcesso: { nome: 'Alvará' } },
      { protocolo: '2024-00002', tipoProcesso: { nome: 'IPTU' } },
    ]);

    const lista = await listarProcessosEmAndamento('cid-1', deps());

    expect(prismaMock.processo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cidadaoId: 'cid-1', status: { notIn: STATUS_ENCERRADOS } },
      }),
    );
    expect(lista).toEqual([
      { protocolo: '2024-00001', tipoProcesso: 'Alvará' },
      { protocolo: '2024-00002', tipoProcesso: 'IPTU' },
    ]);
  });

  it('exclui os status encerrados (finalizado, rejeitado, aprovado)', () => {
    expect(STATUS_ENCERRADOS).toEqual([
      StatusProcesso.FINALIZADO,
      StatusProcesso.REJEITADO,
      StatusProcesso.APROVADO,
    ]);
  });
});

// ---------------------------------------------------------------------------
// solicitarExclusao — Req. 7.6, 7.7
// ---------------------------------------------------------------------------

describe('solicitarExclusao', () => {
  it('com processos em andamento e sem confirmação retorna requerConfirmacao + lista sem registrar', async () => {
    prismaMock.cidadao.findUnique.mockResolvedValue(makeCidadao());
    prismaMock.processo.findMany.mockResolvedValue([
      { protocolo: '2024-00001', tipoProcesso: { nome: 'Alvará' } },
    ]);

    const resultado = await solicitarExclusao('cid-1', false, ATOR, deps());

    expect(resultado.requerConfirmacao).toBe(true);
    expect(resultado.processos).toEqual([{ protocolo: '2024-00001', tipoProcesso: 'Alvará' }]);
    // Nada foi registrado: sem marcador no Redis nem auditoria.
    expect(redisMock.set).not.toHaveBeenCalled();
    expect(redisMock.zadd).not.toHaveBeenCalled();
    expect(auditarMock).not.toHaveBeenCalled();
  });

  it('quando confirmado grava o marcador no Redis, indexa no ZSET e registra auditoria', async () => {
    prismaMock.cidadao.findUnique.mockResolvedValue(makeCidadao());
    prismaMock.processo.findMany.mockResolvedValue([
      { protocolo: '2024-00001', tipoProcesso: { nome: 'Alvará' } },
    ]);

    const resultado = await solicitarExclusao('cid-1', true, ATOR, deps());

    expect(resultado.requerConfirmacao).toBe(false);
    expect(resultado.agendadoPara).toBeDefined();

    expect(redisMock.set).toHaveBeenCalledWith(
      montarChaveExclusao('cid-1'),
      expect.any(String),
      'EX',
      EXCLUSAO_TTL_SECONDS,
    );
    expect(redisMock.zadd).toHaveBeenCalledWith(
      EXCLUSAO_PENDENTES_SET,
      expect.any(Number),
      'cid-1',
    );
    expect(auditarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ator: 'cidadao',
        atorCidadaoId: 'cid-1',
        tipoAcao: 'solicitar_exclusao_conta',
        objetoId: 'cid-1',
      }),
    );
  });

  it('sem processos em andamento registra diretamente mesmo sem confirmação', async () => {
    prismaMock.cidadao.findUnique.mockResolvedValue(makeCidadao());
    prismaMock.processo.findMany.mockResolvedValue([]);

    const resultado = await solicitarExclusao('cid-1', false, ATOR, deps());

    expect(resultado.requerConfirmacao).toBe(false);
    expect(redisMock.set).toHaveBeenCalledTimes(1);
    expect(auditarMock).toHaveBeenCalledTimes(1);
  });

  it('lança notFound quando o cidadão não existe', async () => {
    prismaMock.cidadao.findUnique.mockResolvedValue(null);

    await expect(solicitarExclusao('inexistente', true, ATOR, deps())).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// anonimizarCidadao — Req. 20.6
// ---------------------------------------------------------------------------

describe('anonimizarCidadao', () => {
  it('sobrescreve os campos de PII e preserva o id', async () => {
    prismaMock.cidadao.update.mockImplementation(async (args: any) => ({
      id: args.where.id,
      ...args.data,
    }));

    await anonimizarCidadao('cid-1abcdef', prismaMock as any);

    expect(prismaMock.cidadao.update).toHaveBeenCalledWith({
      where: { id: 'cid-1abcdef' },
      data: {
        nome: 'ANONIMIZADO_cid-1abc',
        cpf: '00000000000',
        email: 'anonimizado_cid-1abcdef@deletado.local',
        telefone: '00000000000',
        ativo: false,
      },
    });
  });
});

// ---------------------------------------------------------------------------
// processarExclusoesPendentes — Req. 20.6
// ---------------------------------------------------------------------------

describe('processarExclusoesPendentes', () => {
  const redisWorker = redisMock as unknown as LimpezaCache;

  it('anonimiza solicitações com mais de 30 dias e remove os marcadores', async () => {
    const agora = Date.now();
    redisMock.zrangebyscore.mockResolvedValue(['cid-antiga-1', 'cid-antiga-2']);
    prismaMock.cidadao.update.mockResolvedValue(makeCidadao());

    const total = await processarExclusoesPendentes(prismaMock as any, redisWorker, agora);

    expect(total).toBe(2);
    // A varredura usa o limite = agora - 30 dias.
    expect(redisMock.zrangebyscore).toHaveBeenCalledWith(
      EXCLUSAO_PENDENTES_SET,
      '-inf',
      agora - ANONIMIZACAO_APOS_MS,
    );
    expect(prismaMock.cidadao.update).toHaveBeenCalledTimes(2);
    expect(redisMock.del).toHaveBeenCalledWith(montarChaveExclusao('cid-antiga-1'));
    expect(redisMock.zrem).toHaveBeenCalledWith(EXCLUSAO_PENDENTES_SET, 'cid-antiga-1');
  });

  it('não anonimiza quando não há solicitações vencidas (mais recentes que 30 dias)', async () => {
    redisMock.zrangebyscore.mockResolvedValue([]);

    const total = await processarExclusoesPendentes(prismaMock as any, redisWorker, Date.now());

    expect(total).toBe(0);
    expect(prismaMock.cidadao.update).not.toHaveBeenCalled();
    expect(redisMock.del).not.toHaveBeenCalled();
  });

  it('é defensivo: falha em um cidadão não interrompe os demais', async () => {
    redisMock.zrangebyscore.mockResolvedValue(['cid-erro', 'cid-ok']);
    prismaMock.cidadao.update
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(makeCidadao());

    const total = await processarExclusoesPendentes(prismaMock as any, redisWorker, Date.now());

    expect(total).toBe(1);
    expect(prismaMock.cidadao.update).toHaveBeenCalledTimes(2);
  });
});
