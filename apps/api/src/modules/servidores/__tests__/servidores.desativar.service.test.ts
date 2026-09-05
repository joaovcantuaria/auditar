import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Permissao, StatusProcesso, ErrorCodes } from '@auditar/shared';
import { AppError } from '../../../utils/errors.js';

// bcryptjs é importado estaticamente pelo serviço (via `criar`); mockamos para
// que o módulo carregue sem depender do pacote real instalado.
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(async (senha: string) => `hash(${senha})`),
    compare: vi.fn(async () => true),
  },
}));

import {
  listarProcessosAtribuidos,
  desativar,
  atualizarPermissoes,
  type ServidoresDeps,
  type RedisLike,
  type Ator,
} from '../servidores.service.js';

// ---------------------------------------------------------------------------
// Helpers de mock
// ---------------------------------------------------------------------------

const ator: Ator = { servidorId: 'admin-1', enderecoIp: '203.0.113.9' };

function makeDeps() {
  const servidor = {
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  const processo = {
    findMany: vi.fn(),
    update: vi.fn(),
  };
  const permissaoServidor = {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  };
  const auditar = vi.fn().mockResolvedValue(undefined);

  const deps = {
    prisma: { servidor, processo, permissaoServidor },
    mailer: { sendMail: vi.fn() },
    fromAddress: 'Auditar <no-reply@auditar.local>',
    auditar,
  } as unknown as ServidoresDeps;

  const redisStore = new Map<string, string>();
  const redis: RedisLike = {
    set: vi.fn(async (key: string, value: string) => {
      redisStore.set(key, value);
      return 'OK';
    }),
  };

  return { deps, servidor, processo, permissaoServidor, auditar, redis, redisStore };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// listarProcessosAtribuidos (Req. 21.7)
// ---------------------------------------------------------------------------

describe('listarProcessosAtribuidos', () => {
  it('busca apenas processos em andamento (status não terminal) do servidor', async () => {
    const { deps, processo } = makeDeps();
    processo.findMany.mockResolvedValue([{ id: 'p1', protocolo: '2024000001' }]);

    const result = await listarProcessosAtribuidos('srv-1', deps);

    expect(result).toEqual([{ id: 'p1', protocolo: '2024000001' }]);
    const where = processo.findMany.mock.calls[0][0].where;
    expect(where.servidorResponsavelId).toBe('srv-1');
    expect(where.status.notIn).toEqual(
      expect.arrayContaining([
        StatusProcesso.APROVADO,
        StatusProcesso.REJEITADO,
        StatusProcesso.FINALIZADO,
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// desativar (Req. 21.6, 21.7, 21.8)
// ---------------------------------------------------------------------------

describe('desativar', () => {
  it('lança erro quando o servidor não existe', async () => {
    const { deps, servidor, redis } = makeDeps();
    servidor.findUnique.mockResolvedValue(null);

    await expect(desativar('inexistente', [], ator, deps, redis)).rejects.toBeInstanceOf(AppError);
    expect(servidor.update).not.toHaveBeenCalled();
  });

  it('rejeita listando os processos em andamento não cobertos pelas reatribuições (Req. 21.7)', async () => {
    const { deps, servidor, processo, redis } = makeDeps();
    servidor.findUnique.mockResolvedValue({ id: 'srv-1', ativo: true, nivelAcesso: 5 });
    processo.findMany.mockResolvedValue([
      { id: 'p1', protocolo: '2024000001' },
      { id: 'p2', protocolo: '2024000002' },
    ]);

    // Apenas p1 é reatribuído; p2 fica pendente → deve falhar.
    await expect(
      desativar('srv-1', [{ processoId: 'p1', novoServidorId: 'srv-2' }], ator, deps, redis),
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });

    // A mensagem lista o protocolo do processo pendente.
    await expect(
      desativar('srv-1', [{ processoId: 'p1', novoServidorId: 'srv-2' }], ator, deps, redis),
    ).rejects.toThrow(/2024000002/);

    expect(servidor.update).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('reatribui processos, desativa o servidor, seta kill-switch no Redis e audita (Req. 21.6, 21.8)', async () => {
    const { deps, servidor, processo, redis, redisStore, auditar } = makeDeps();
    servidor.findUnique.mockResolvedValue({ id: 'srv-1', ativo: true, nivelAcesso: 5 });
    processo.findMany.mockResolvedValue([
      { id: 'p1', protocolo: '2024000001' },
      { id: 'p2', protocolo: '2024000002' },
    ]);
    processo.update.mockResolvedValue({});
    servidor.update.mockResolvedValue({ id: 'srv-1', ativo: false });

    const antes = Date.now();
    const result = await desativar(
      'srv-1',
      [
        { processoId: 'p1', novoServidorId: 'srv-2' },
        { processoId: 'p2', novoServidorId: 'srv-3' },
      ],
      ator,
      deps,
      redis,
    );

    // Cada processo foi reatribuído ao novo responsável.
    expect(processo.update).toHaveBeenCalledTimes(2);
    expect(processo.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { servidorResponsavelId: 'srv-2' },
    });
    expect(processo.update).toHaveBeenCalledWith({
      where: { id: 'p2' },
      data: { servidorResponsavelId: 'srv-3' },
    });

    // O servidor foi marcado como inativo (soft delete — Req. 21.6).
    expect(servidor.update).toHaveBeenCalledWith({
      where: { id: 'srv-1' },
      data: { ativo: false },
      select: expect.any(Object),
    });

    // Kill-switch de sessão gravado no Redis com timestamp >= início (Req. 21.8).
    expect(redis.set).toHaveBeenCalledTimes(1);
    const chave = 'servidor:revogado:srv-1';
    expect(redisStore.has(chave)).toBe(true);
    const ts = Number(redisStore.get(chave));
    expect(ts).toBeGreaterThanOrEqual(antes);

    // Auditoria: 2 reatribuições + 1 desativação.
    const acoes = auditar.mock.calls.map((c) => c[0].tipoAcao);
    expect(acoes.filter((a) => a === 'reatribuir_processo')).toHaveLength(2);
    expect(acoes).toContain('desativar_servidor');

    expect(result).toMatchObject({ id: 'srv-1', ativo: false, reatribuidos: 2 });
  });

  it('desativa sem reatribuições quando não há processos em andamento', async () => {
    const { deps, servidor, processo, redis } = makeDeps();
    servidor.findUnique.mockResolvedValue({ id: 'srv-1', ativo: true, nivelAcesso: 5 });
    processo.findMany.mockResolvedValue([]);
    servidor.update.mockResolvedValue({ id: 'srv-1', ativo: false });

    const result = await desativar('srv-1', [], ator, deps, redis);

    expect(processo.update).not.toHaveBeenCalled();
    expect(servidor.update).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(result.ativo).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// atualizarPermissoes (Req. 8.6, 8.9)
// ---------------------------------------------------------------------------

describe('atualizarPermissoes', () => {
  it('lança erro quando o servidor não existe', async () => {
    const { deps, servidor } = makeDeps();
    servidor.findUnique.mockResolvedValue(null);

    await expect(atualizarPermissoes('inexistente', [], ator, deps)).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it('substitui as linhas (deleteMany + createMany) e audita valores anterior/posterior (Req. 8.6, 8.9)', async () => {
    const { deps, servidor, permissaoServidor, auditar } = makeDeps();
    servidor.findUnique.mockResolvedValue({ id: 'srv-1' });
    permissaoServidor.findMany.mockResolvedValue([
      { permissao: Permissao.REJEITAR, concedida: false },
    ]);
    permissaoServidor.deleteMany.mockResolvedValue({ count: 1 });
    permissaoServidor.createMany.mockResolvedValue({ count: 2 });

    const novas = [
      { permissao: Permissao.REJEITAR, concedida: true },
      { permissao: Permissao.APROVAR, concedida: true },
    ];

    const result = await atualizarPermissoes('srv-1', novas, ator, deps);

    // Substituição: apaga tudo do servidor e recria o novo conjunto.
    expect(permissaoServidor.deleteMany).toHaveBeenCalledWith({ where: { servidorId: 'srv-1' } });
    expect(permissaoServidor.createMany).toHaveBeenCalledWith({
      data: [
        { servidorId: 'srv-1', permissao: Permissao.REJEITAR, concedida: true },
        { servidorId: 'srv-1', permissao: Permissao.APROVAR, concedida: true },
      ],
    });

    // Auditoria com ANTERIOR e POSTERIOR (Req. 8.9).
    expect(auditar).toHaveBeenCalledTimes(1);
    const dto = auditar.mock.calls[0][0];
    expect(dto).toMatchObject({
      tipoAcao: 'alterar_permissoes',
      modulo: 'servidores',
      tipoObjeto: 'Servidor',
      objetoId: 'srv-1',
      atorServidorId: 'admin-1',
    });
    expect(dto.valorAnterior).toEqual([{ permissao: Permissao.REJEITAR, concedida: false }]);
    expect(dto.valorPosterior).toEqual(novas);

    expect(result).toEqual(novas);
  });

  it('não chama createMany quando a lista de permissões é vazia', async () => {
    const { deps, servidor, permissaoServidor } = makeDeps();
    servidor.findUnique.mockResolvedValue({ id: 'srv-1' });
    permissaoServidor.findMany.mockResolvedValue([]);
    permissaoServidor.deleteMany.mockResolvedValue({ count: 0 });

    await atualizarPermissoes('srv-1', [], ator, deps);

    expect(permissaoServidor.deleteMany).toHaveBeenCalledTimes(1);
    expect(permissaoServidor.createMany).not.toHaveBeenCalled();
  });
});
