// Feature: auditar-sistema-gestao — Organizador de Tarefas da Equipe (Req. 27)
//
// Property 16: Atribuição para Todos Gera Uma Atribuição por Servidor Ativo
//   For any conjunto de Servidores com estados ativo/inativo variados, criar uma
//   Tarefa direcionada a todos os Servidores ativos deve gerar exatamente uma
//   Atribuição_de_Tarefa para cada Servidor ativo e nenhuma para inativos.
//   Validates: Requirements 27.4
//
// Property 17: Isolamento de Status por Atribuição de Tarefa
//   For any Tarefa com N Atribuições_de_Tarefa, alterar o status de uma não altera
//   as demais; ao concluir, registra `concluidaEm`.
//   Validates: Requirements 27.7
//
// Os serviços são exercitados com dependências INJETADAS (mock do Prisma), sem
// abrir conexões nem carregar `@prisma/client`. numRuns ≥ 100 em cada propriedade.

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { StatusTarefa } from '@auditar/shared';
import { criar, alterarStatusMinha, type TarefasDeps, type Ator } from '../tarefas.service.js';

const ator: Ator = { servidorId: 'coord-1', enderecoIp: '203.0.113.1' };

/** Constrói um conjunto de dependências totalmente mockado para o serviço. */
function makeDeps(overrides: Partial<Record<string, unknown>> = {}) {
  const prisma = {
    servidor: { findMany: vi.fn() },
    tarefa: { create: vi.fn() },
    tarefaAtribuicao: { findUnique: vi.fn(), update: vi.fn() },
    ...overrides,
  };
  const auditar = vi.fn().mockResolvedValue(undefined);
  const notificar = vi.fn().mockResolvedValue(undefined);
  const emitirServidor = vi.fn();
  const deps = { prisma, auditar, notificar, emitirServidor } as unknown as TarefasDeps;
  return { deps, prisma, auditar, notificar, emitirServidor };
}

describe('Property 16: Atribuição para Todos gera uma atribuição por Servidor ativo', () => {
  it('gera exatamente uma atribuição por Servidor ativo e nenhuma para inativos', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Conjunto de servidores com id único e flag de ativo/inativo variada.
        fc.uniqueArray(
          fc.record({
            id: fc.uuid(),
            ativo: fc.boolean(),
          }),
          { selector: (s) => s.id, minLength: 1, maxLength: 30 },
        ),
        async (servidores) => {
          const ativos = servidores.filter((s) => s.ativo);

          const { deps, prisma, notificar, emitirServidor } = makeDeps();

          // O serviço consulta apenas os Servidores ATIVOS (where: { ativo: true }).
          (prisma.servidor.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
            ativos.map((s) => ({ id: s.id })),
          );

          // Captura as atribuições criadas no `create` aninhado.
          (prisma.tarefa.create as ReturnType<typeof vi.fn>).mockImplementation(
            async (args: { data: { atribuicoes: { create: Array<{ servidorId: string }> } } }) => {
              const criadas = args.data.atribuicoes.create;
              return {
                id: 'tarefa-1',
                titulo: 'Tarefa geral',
                prazo: new Date(Date.now() + 3_600_000),
                atribuicoes: criadas.map((c, i) => ({ id: `a-${i}`, servidorId: c.servidorId })),
              };
            },
          );

          if (ativos.length === 0) {
            // Sem nenhum servidor ativo → TAR_003 (sem destinatário).
            await expect(
              criar(
                {
                  titulo: 'Tarefa geral',
                  prazo: new Date(Date.now() + 3_600_000),
                  todos: true,
                  destinatarios: [],
                } as never,
                ator,
                deps,
              ),
            ).rejects.toMatchObject({ code: 'TAR_003' });
            return;
          }

          const { atribuicoes } = await criar(
            {
              titulo: 'Tarefa geral',
              prazo: new Date(Date.now() + 3_600_000),
              todos: true,
              destinatarios: [],
            } as never,
            ator,
            deps,
          );

          const idsAtribuidos = atribuicoes.map((a) => (a as { servidorId: string }).servidorId);
          const idsAtivos = ativos.map((s) => s.id).sort();
          const idsInativos = new Set(servidores.filter((s) => !s.ativo).map((s) => s.id));

          // Exatamente uma atribuição por servidor ativo (sem duplicatas).
          expect([...idsAtribuidos].sort()).toEqual(idsAtivos);
          expect(idsAtribuidos.length).toBe(ativos.length);
          // Nenhuma atribuição para servidor inativo.
          for (const id of idsAtribuidos) {
            expect(idsInativos.has(id)).toBe(false);
          }
          // Uma notificação/emissão por servidor ativo.
          expect(notificar).toHaveBeenCalledTimes(ativos.length);
          expect(emitirServidor).toHaveBeenCalledTimes(ativos.length);
        },
      ),
      { numRuns: 120 },
    );
  });
});

describe('Property 17: Isolamento de Status por Atribuição de Tarefa', () => {
  it('altera o status apenas da atribuição do servidor, sem tocar nas demais; conclui registra concluidaEm', async () => {
    await fc.assert(
      fc.asyncProperty(
        // N atribuições distintas (servidores únicos) para a mesma tarefa.
        fc.uniqueArray(fc.uuid(), { minLength: 2, maxLength: 12 }),
        fc.constantFrom(
          StatusTarefa.PENDENTE,
          StatusTarefa.EM_ANDAMENTO,
          StatusTarefa.CONCLUIDA,
        ),
        async (servidorIds, novoStatus) => {
          const tarefaId = 'tarefa-iso';
          // Estado inicial: todas as atribuições começam como PENDENTE.
          const estado = new Map<string, { id: string; status: string; concluidaEm: Date | null }>();
          servidorIds.forEach((sid, i) => {
            estado.set(sid, { id: `atr-${i}`, status: StatusTarefa.PENDENTE, concluidaEm: null });
          });

          const alvo = servidorIds[0];

          const { deps, prisma } = makeDeps();

          (prisma.tarefaAtribuicao.findUnique as ReturnType<typeof vi.fn>).mockImplementation(
            async (args: { where: { tarefaId_servidorId: { servidorId: string } } }) => {
              const sid = args.where.tarefaId_servidorId.servidorId;
              const atual = estado.get(sid);
              return atual ? { id: atual.id, status: atual.status } : null;
            },
          );

          // O update DEVE afetar somente a atribuição-alvo (where compound único).
          (prisma.tarefaAtribuicao.update as ReturnType<typeof vi.fn>).mockImplementation(
            async (args: {
              where: { tarefaId_servidorId: { servidorId: string } };
              data: { status: string; concluidaEm: Date | null };
            }) => {
              const sid = args.where.tarefaId_servidorId.servidorId;
              const atual = estado.get(sid)!;
              atual.status = args.data.status;
              atual.concluidaEm = args.data.concluidaEm;
              return { id: atual.id, servidorId: sid, ...args.data };
            },
          );

          await alterarStatusMinha(
            tarefaId,
            alvo,
            { status: novoStatus },
            ator,
            deps,
          );

          // A atribuição-alvo recebeu o novo status.
          expect(estado.get(alvo)!.status).toBe(novoStatus);
          // Ao concluir, `concluidaEm` é registrado; caso contrário, permanece nulo.
          if (novoStatus === StatusTarefa.CONCLUIDA) {
            expect(estado.get(alvo)!.concluidaEm).toBeInstanceOf(Date);
          } else {
            expect(estado.get(alvo)!.concluidaEm).toBeNull();
          }
          // As demais N-1 atribuições permanecem PENDENTE e sem conclusão.
          for (const sid of servidorIds.slice(1)) {
            expect(estado.get(sid)!.status).toBe(StatusTarefa.PENDENTE);
            expect(estado.get(sid)!.concluidaEm).toBeNull();
          }
        },
      ),
      { numRuns: 120 },
    );
  });
});
