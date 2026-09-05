// Testes de unidade do serviço do Organizador de Tarefas (Req. 27).
// Usam dependências injetadas (mock do Prisma), sem abrir conexões.

import { describe, it, expect, vi } from 'vitest';
import { StatusTarefa, TipoEvento } from '@auditar/shared';
import {
  criar,
  editar,
  minhas,
  alterarStatusMinha,
  resolverDestinatarios,
  type TarefasDeps,
  type Ator,
} from '../tarefas.service.js';

const ator: Ator = { servidorId: 'coord-1', enderecoIp: '203.0.113.1' };

function makeDeps() {
  const prisma = {
    servidor: { findMany: vi.fn() },
    tarefa: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
    tarefaAtribuicao: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  };
  const auditar = vi.fn().mockResolvedValue(undefined);
  const notificar = vi.fn().mockResolvedValue(undefined);
  const emitirServidor = vi.fn();
  const deps = { prisma, auditar, notificar, emitirServidor } as unknown as TarefasDeps;
  return { deps, prisma, auditar, notificar, emitirServidor };
}

const prazoFuturo = () => new Date(Date.now() + 24 * 3_600_000);

describe('criar', () => {
  it('rejeita prazo no passado com TAR_002', async () => {
    const { deps } = makeDeps();
    await expect(
      criar(
        { titulo: 'X', prazo: new Date(Date.now() - 1000), destinatarios: ['s1'] } as never,
        ator,
        deps,
      ),
    ).rejects.toMatchObject({ code: 'TAR_002', statusCode: 400 });
  });

  it('rejeita sem destinatários com TAR_003', async () => {
    const { deps } = makeDeps();
    await expect(
      criar({ titulo: 'X', prazo: prazoFuturo(), destinatarios: [] } as never, ator, deps),
    ).rejects.toMatchObject({ code: 'TAR_003', statusCode: 400 });
  });

  it('cria tarefa com uma atribuição por destinatário e notifica cada um', async () => {
    const { deps, prisma, auditar, notificar, emitirServidor } = makeDeps();
    (prisma.tarefa.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 't1',
      titulo: 'Revisar processos',
      prazo: prazoFuturo(),
      atribuicoes: [
        { id: 'a1', servidorId: 's1' },
        { id: 'a2', servidorId: 's2' },
      ],
    });

    const { tarefa, atribuicoes } = await criar(
      { titulo: 'Revisar processos', prazo: prazoFuturo(), destinatarios: ['s1', 's2'] } as never,
      ator,
      deps,
    );

    expect((tarefa as { id: string }).id).toBe('t1');
    expect(atribuicoes).toHaveLength(2);
    // Uma notificação TAREFA_ATRIBUIDA por destinatário + emit.
    expect(notificar).toHaveBeenCalledTimes(2);
    expect(notificar).toHaveBeenCalledWith(
      expect.objectContaining({ tipoEvento: TipoEvento.TAREFA_ATRIBUIDA }),
    );
    expect(emitirServidor).toHaveBeenCalledWith('s1', 'tarefa:atribuida', expect.any(Object));
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ tipoAcao: 'criar_tarefa' }));
  });

  it('deduplica destinatários repetidos (uma atribuição por servidor)', async () => {
    const { deps, prisma } = makeDeps();
    let capturado: string[] = [];
    (prisma.tarefa.create as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { data: { atribuicoes: { create: Array<{ servidorId: string }> } } }) => {
        capturado = args.data.atribuicoes.create.map((c) => c.servidorId);
        return { id: 't', titulo: 'T', prazo: prazoFuturo(), atribuicoes: [] };
      },
    );
    await criar(
      { titulo: 'T', prazo: prazoFuturo(), destinatarios: ['s1', 's1', 's2'] } as never,
      ator,
      deps,
    );
    expect(capturado).toEqual(['s1', 's2']);
  });
});

describe('resolverDestinatarios', () => {
  it('para "todos" retorna apenas os servidores ativos', async () => {
    const { deps, prisma } = makeDeps();
    (prisma.servidor.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 's1' },
      { id: 's2' },
    ]);
    const ids = await resolverDestinatarios(
      { titulo: 'T', prazo: prazoFuturo(), todos: true, destinatarios: [] } as never,
      deps.prisma,
    );
    expect(ids).toEqual(['s1', 's2']);
    expect(prisma.servidor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ativo: true } }),
    );
  });
});

describe('editar', () => {
  it('rejeita edição inexistente com TAR_001', async () => {
    const { deps, prisma } = makeDeps();
    (prisma.tarefa.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(editar('nao-existe', { titulo: 'Novo' }, ator, deps)).rejects.toMatchObject({
      code: 'TAR_001',
      statusCode: 404,
    });
  });
});

describe('minhas', () => {
  it('agrupa as atribuições do servidor por status', async () => {
    const { deps, prisma } = makeDeps();
    (prisma.tarefaAtribuicao.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'a1', status: StatusTarefa.PENDENTE, tarefa: {} },
      { id: 'a2', status: StatusTarefa.EM_ANDAMENTO, tarefa: {} },
      { id: 'a3', status: StatusTarefa.CONCLUIDA, tarefa: {} },
      { id: 'a4', status: StatusTarefa.PENDENTE, tarefa: {} },
    ]);
    const grupos = await minhas('s1', deps);
    expect(grupos.pendente).toHaveLength(2);
    expect(grupos.em_andamento).toHaveLength(1);
    expect(grupos.concluida).toHaveLength(1);
  });
});

describe('alterarStatusMinha', () => {
  it('rejeita atribuição inexistente com TAR_001', async () => {
    const { deps, prisma } = makeDeps();
    (prisma.tarefaAtribuicao.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      alterarStatusMinha('t1', 's1', { status: StatusTarefa.EM_ANDAMENTO }, ator, deps),
    ).rejects.toMatchObject({ code: 'TAR_001', statusCode: 404 });
  });

  it('conclui a atribuição registrando concluidaEm e emite status_atualizado', async () => {
    const { deps, prisma, emitirServidor } = makeDeps();
    (prisma.tarefaAtribuicao.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a1',
      status: StatusTarefa.PENDENTE,
    });
    let dataUpdate: { status: string; concluidaEm: Date | null } | undefined;
    (prisma.tarefaAtribuicao.update as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { data: { status: string; concluidaEm: Date | null } }) => {
        dataUpdate = args.data;
        return { id: 'a1', ...args.data };
      },
    );

    await alterarStatusMinha('t1', 's1', { status: StatusTarefa.CONCLUIDA }, ator, deps);

    expect(dataUpdate?.status).toBe(StatusTarefa.CONCLUIDA);
    expect(dataUpdate?.concluidaEm).toBeInstanceOf(Date);
    expect(emitirServidor).toHaveBeenCalledWith('s1', 'tarefa:status_atualizado', expect.any(Object));
  });
});
