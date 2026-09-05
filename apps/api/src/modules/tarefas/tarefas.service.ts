import { createRequire } from 'node:module';
import type { PrismaClient } from '@prisma/client';
import {
  ErrorCodes,
  StatusTarefa,
  TipoEvento,
  type CriarTarefaInput,
  type FiltroTarefaInput,
  type AtualizarStatusTarefaInput,
} from '@auditar/shared';
import { badRequest, notFound } from '../../utils/errors.js';
import { registrar as defaultRegistrar } from '../auditoria/auditoria.service.js';
import type { RegistrarAuditoriaDto } from '../auditoria/auditoria.types.js';
import type { NotificacaoJob } from '../../jobs/types.js';

/**
 * Serviço do Organizador de Tarefas da Equipe (Req. 27).
 *
 * Regras principais:
 *  - Criação exige título (≤150), prazo futuro (senão `TAR_002`) e ao menos um
 *    destinatário (senão `TAR_003`). Cria uma `Tarefa` + uma `TarefaAtribuicao`
 *    por destinatário; para o alvo "todos", uma atribuição por Servidor ATIVO no
 *    momento da criação (Req. 27.2, 27.3, 27.4, 27.12).
 *  - Para cada destinatário, enfileira uma Notificação `TAREFA_ATRIBUIDA` (≤60s)
 *    e emite o evento Socket.io `tarefa:atribuida` na sala `servidor:{id}`
 *    (Req. 27.5).
 *  - A alteração de status atinge SOMENTE a `TarefaAtribuicao` do Servidor
 *    autenticado, preservando as demais; ao concluir, registra `concluidaEm`
 *    (Req. 27.6, 27.7).
 *
 * As dependências (prisma, auditar, notificar, emitir) são injetáveis para
 * facilitar os testes unitários — em produção usam as instâncias reais por
 * padrão (resolução preguiçosa via `createRequire`).
 */

const MODULO = 'tarefas';
const TIPO_OBJETO = 'Tarefa';

/** Ator que dispara a operação — usado para registrar a auditoria. */
export interface Ator {
  servidorId: string;
  enderecoIp: string;
}

/** Cliente mínimo de auditoria — permite injetar um mock nos testes. */
export type Auditar = (dto: RegistrarAuditoriaDto) => Promise<void>;

/** Enfileiramento de notificação — mesmo payload da `notificacao-queue`. */
export type NotificarFn = (payload: NotificacaoJob) => Promise<unknown>;

/** Emissão de evento Socket.io para a sala pessoal de um Servidor. */
export type EmitirServidorFn = (servidorId: string, evento: string, payload: unknown) => void;

/** Dependências injetáveis do serviço. */
export interface TarefasDeps {
  prisma: PrismaClient;
  auditar: Auditar;
  notificar: NotificarFn;
  emitirServidor: EmitirServidorFn;
}

/**
 * Resolve as dependências reais preguiçosamente (lazy). Importar este módulo
 * NÃO deve carregar o Prisma Client, a fila BullMQ nem o Socket.io — só quando
 * uma operação é executada sem dependências injetadas. Mantém os testes (que
 * injetam mocks) independentes da geração do client Prisma / pacotes externos.
 */
let cachedDeps: TarefasDeps | undefined;

function resolveDeps(deps?: TarefasDeps): TarefasDeps {
  if (deps) return deps;
  if (!cachedDeps) {
    const requireLocal = createRequire(import.meta.url);
    const { prisma } = requireLocal('../../config/database.js') as { prisma: PrismaClient };
    const { notificacaoQueue, QUEUE_NAMES } = requireLocal('../../jobs/queues.js') as {
      notificacaoQueue: () => { add: (name: string, data: unknown) => Promise<unknown> };
      QUEUE_NAMES: Record<string, string>;
    };
    // Emissão Socket.io: envolvida em try/catch para virar no-op antes de o
    // servidor Socket.io ser inicializado (padrão dos demais produtores).
    const emitirServidor: EmitirServidorFn = (servidorId, evento, payload) => {
      try {
        const { emitParaServidor } = requireLocal('../../socket/socket.server.js') as {
          emitParaServidor: (id: string, ev: string, p: unknown) => void;
        };
        emitParaServidor(servidorId, evento, payload);
      } catch {
        /* Socket.io ainda não inicializado — emissão é no-op */
      }
    };
    cachedDeps = {
      prisma,
      auditar: defaultRegistrar,
      notificar: (payload) => notificacaoQueue().add(QUEUE_NAMES.NOTIFICACAO, payload),
      emitirServidor,
    };
  }
  return cachedDeps;
}

/** Monta o DTO base de auditoria para uma ação sobre uma Tarefa. */
function auditoriaBase(
  tipoAcao: string,
  ator: Ator,
  objetoId: string,
  extra: Partial<RegistrarAuditoriaDto> = {},
): RegistrarAuditoriaDto {
  return {
    ator: 'servidor',
    atorServidorId: ator.servidorId,
    enderecoIp: ator.enderecoIp,
    tipoAcao,
    modulo: MODULO,
    objetoId,
    tipoObjeto: TIPO_OBJETO,
    ...extra,
  };
}

/**
 * DTO de criação estendido: além dos campos validados por `criarTarefaSchema`,
 * aceita o marcador `todos` para direcionar a Tarefa a todos os Servidores
 * ativos. Quando `todos` é `true`, o campo `destinatarios` é ignorado e as
 * atribuições são geradas a partir dos Servidores ativos no banco (Req. 27.4).
 */
export interface CriarTarefaDto extends CriarTarefaInput {
  todos?: boolean;
}

/**
 * Resolve a lista de `servidorId` que receberão uma `TarefaAtribuicao`.
 *
 * - Alvo "todos": consulta os Servidores ATIVOS no momento da criação e retorna
 *   seus ids (Req. 27.4). Servidores inativos NÃO recebem atribuição.
 * - Alvo específico: retorna os `destinatarios` informados, deduplicados.
 *
 * Lança `TAR_003` quando o conjunto final estiver vazio (Req. 27.2).
 */
export async function resolverDestinatarios(
  dto: CriarTarefaDto,
  prisma: PrismaClient,
): Promise<string[]> {
  let ids: string[];
  if (dto.todos) {
    const ativos = await prisma.servidor.findMany({
      where: { ativo: true },
      select: { id: true },
    });
    ids = ativos.map((s) => s.id);
  } else {
    ids = dto.destinatarios ?? [];
  }

  // Deduplica preservando a ordem (uma atribuição por Servidor — Req. 27.4).
  const unicos = [...new Set(ids)];

  if (unicos.length === 0) {
    throw badRequest(
      ErrorCodes.TAREFA_SEM_DESTINATARIO,
      'Selecione ao menos um destinatário para a tarefa',
      'destinatarios',
    );
  }
  return unicos;
}

/** Resultado da criação: a Tarefa criada + suas atribuições. */
export interface CriarTarefaResult {
  tarefa: Record<string, unknown>;
  atribuicoes: Record<string, unknown>[];
}

/**
 * Cria uma Tarefa e distribui as atribuições (Req. 27.1-27.5, 27.12).
 *
 * Fluxo: valida prazo futuro (`TAR_002`) → resolve destinatários (`TAR_003`) →
 * cria a `Tarefa` com uma `TarefaAtribuicao` por destinatário em transação →
 * audita → enfileira notificação `TAREFA_ATRIBUIDA` + emite `tarefa:atribuida`
 * para cada destinatário. A validação de prazo do schema já garante prazo
 * futuro; reforçamos aqui para o caminho de serviço (defesa em profundidade).
 */
export async function criar(
  dto: CriarTarefaDto,
  ator: Ator,
  deps?: TarefasDeps,
): Promise<CriarTarefaResult> {
  const d = resolveDeps(deps);

  // Req. 27.12: o prazo deve ser futuro em relação ao instante da criação.
  if (dto.prazo.getTime() <= Date.now()) {
    throw badRequest(
      ErrorCodes.TAREFA_PRAZO_PASSADO,
      'O prazo da tarefa deve ser uma data e horário futuros',
      'prazo',
    );
  }

  // Req. 27.3/27.4: resolve a lista final de destinatários (uma por servidor).
  const destinatarios = await resolverDestinatarios(dto, d.prisma);

  // Cria a Tarefa + uma atribuição por destinatário na mesma transação implícita
  // do `create` aninhado (Req. 27.2, 27.3, 27.4).
  const tarefa = await d.prisma.tarefa.create({
    data: {
      titulo: dto.titulo.trim(),
      descricao: dto.descricao?.trim(),
      prioridade: dto.prioridade ?? null,
      criadoPorId: ator.servidorId,
      processoId: dto.processoId ?? null,
      prazo: dto.prazo,
      status: StatusTarefa.PENDENTE,
      atribuicoes: {
        create: destinatarios.map((servidorId) => ({
          servidorId,
          status: StatusTarefa.PENDENTE,
        })),
      },
    },
    include: { atribuicoes: true },
  });

  const atribuicoes = (tarefa as { atribuicoes: Record<string, unknown>[] }).atribuicoes ?? [];

  await d.auditar(
    auditoriaBase('criar_tarefa', ator, (tarefa as { id: string }).id, {
      valorPosterior: {
        titulo: (tarefa as { titulo: string }).titulo,
        prazo: (tarefa as { prazo: Date }).prazo,
        destinatarios,
      },
    }),
  );

  // Req. 27.5: notifica cada destinatário (≤60s) e emite Socket.io.
  const prazoIso =
    dto.prazo instanceof Date ? dto.prazo.toISOString() : new Date(dto.prazo).toISOString();
  for (const servidorId of destinatarios) {
    try {
      await d.notificar({
        tipo: 'painel',
        destinatario: { servidorId },
        tipoEvento: TipoEvento.TAREFA_ATRIBUIDA,
        conteudo: `Nova tarefa atribuída: ${(tarefa as { titulo: string }).titulo}`,
      });
    } catch (err) {
      // Falha no enfileiramento não desfaz a criação (pipeline assíncrono).
      console.error(
        JSON.stringify({
          level: 'error',
          scope: MODULO,
          event: 'notificacao_tarefa_atribuida_falhou',
          servidorId,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    d.emitirServidor(servidorId, 'tarefa:atribuida', {
      tarefaId: (tarefa as { id: string }).id,
      titulo: (tarefa as { titulo: string }).titulo,
      prazo: prazoIso,
    });
  }

  return { tarefa, atribuicoes };
}

/** Filtros da listagem de Tarefas (Req. 27.10, 27.11). */
export interface ListarTarefasFiltros extends FiltroTarefaInput {}

/**
 * Lista as Tarefas com filtros opcionais por status, período de prazo e vínculo
 * a Processo (Req. 27.10, 27.11). Inclui as atribuições e o protocolo do
 * Processo vinculado para exibição/navegação.
 */
export async function listar(
  filtros: ListarTarefasFiltros = {},
  deps?: TarefasDeps,
): Promise<Record<string, unknown>[]> {
  const d = resolveDeps(deps);

  const where: Record<string, unknown> = {};
  if (filtros.status) where.status = filtros.status;
  if (filtros.processoId) where.processoId = filtros.processoId;
  if (filtros.prazoDe || filtros.prazoAte) {
    where.prazo = {
      ...(filtros.prazoDe ? { gte: filtros.prazoDe } : {}),
      ...(filtros.prazoAte ? { lte: filtros.prazoAte } : {}),
    };
  }

  const tarefas = await d.prisma.tarefa.findMany({
    where,
    include: {
      atribuicoes: true,
      processo: { select: { id: true, protocolo: true } },
    },
    orderBy: { prazo: 'asc' },
  });
  return tarefas as Record<string, unknown>[];
}

/**
 * Obtém uma Tarefa pelo id, incluindo suas atribuições e o Processo vinculado
 * (Req. 27.11). Lança `TAR_001` quando não encontrada.
 */
export async function obter(id: string, deps?: TarefasDeps): Promise<Record<string, unknown>> {
  const d = resolveDeps(deps);
  const tarefa = await d.prisma.tarefa.findUnique({
    where: { id },
    include: {
      atribuicoes: true,
      processo: { select: { id: true, protocolo: true } },
    },
  });
  if (!tarefa) {
    throw notFound(ErrorCodes.TAREFA_NAO_ENCONTRADA, 'Tarefa não encontrada');
  }
  return tarefa as Record<string, unknown>;
}

/** Campos editáveis de uma Tarefa (Req. 27.1, 27.12). */
export interface EditarTarefaDto {
  titulo?: string;
  descricao?: string | null;
  prazo?: Date;
  prioridade?: number | null;
  processoId?: string | null;
}

/**
 * Edita os campos de uma Tarefa (título, descrição, prazo, prioridade, vínculo).
 * Valida prazo futuro quando informado (`TAR_002`). Registra a Auditoria com os
 * valores anterior e posterior.
 */
export async function editar(
  id: string,
  dto: EditarTarefaDto,
  ator: Ator,
  deps?: TarefasDeps,
): Promise<Record<string, unknown>> {
  const d = resolveDeps(deps);

  const existente = await d.prisma.tarefa.findUnique({ where: { id } });
  if (!existente) {
    throw notFound(ErrorCodes.TAREFA_NAO_ENCONTRADA, 'Tarefa não encontrada');
  }

  if (dto.prazo !== undefined && dto.prazo.getTime() <= Date.now()) {
    throw badRequest(
      ErrorCodes.TAREFA_PRAZO_PASSADO,
      'O prazo da tarefa deve ser uma data e horário futuros',
      'prazo',
    );
  }

  const data: Record<string, unknown> = {};
  if (dto.titulo !== undefined) data.titulo = dto.titulo.trim();
  if (dto.descricao !== undefined) data.descricao = dto.descricao?.trim() ?? null;
  if (dto.prazo !== undefined) data.prazo = dto.prazo;
  if (dto.prioridade !== undefined) data.prioridade = dto.prioridade;
  if (dto.processoId !== undefined) data.processoId = dto.processoId;

  const tarefa = await d.prisma.tarefa.update({
    where: { id },
    data,
    include: { atribuicoes: true, processo: { select: { id: true, protocolo: true } } },
  });

  await d.auditar(
    auditoriaBase('editar_tarefa', ator, id, {
      valorAnterior: existente,
      valorPosterior: tarefa,
    }),
  );

  return tarefa as Record<string, unknown>;
}

/**
 * Remove uma Tarefa (Req. 27.1). A remoção em cascata das `TarefaAtribuicao` é
 * garantida pelo `onDelete: Cascade` do schema Prisma. Registra a Auditoria.
 */
export async function remover(id: string, ator: Ator, deps?: TarefasDeps): Promise<{ id: string }> {
  const d = resolveDeps(deps);

  const existente = await d.prisma.tarefa.findUnique({ where: { id } });
  if (!existente) {
    throw notFound(ErrorCodes.TAREFA_NAO_ENCONTRADA, 'Tarefa não encontrada');
  }

  await d.prisma.tarefa.delete({ where: { id } });

  await d.auditar(
    auditoriaBase('remover_tarefa', ator, id, {
      valorAnterior: existente,
    }),
  );

  return { id };
}

/** Tarefas do servidor autenticado agrupadas por status (Req. 27.6, 27.10). */
export interface MinhasTarefasAgrupadas {
  pendente: Record<string, unknown>[];
  em_andamento: Record<string, unknown>[];
  concluida: Record<string, unknown>[];
}

/**
 * Retorna as atribuições do Servidor autenticado agrupadas pelos status
 * pendente/em_andamento/concluida (Req. 27.6). Cada item traz a Tarefa e o
 * protocolo do Processo vinculado para exibição e navegação (Req. 27.11).
 */
export async function minhas(
  servidorId: string,
  deps?: TarefasDeps,
): Promise<MinhasTarefasAgrupadas> {
  const d = resolveDeps(deps);
  const atribuicoes = await d.prisma.tarefaAtribuicao.findMany({
    where: { servidorId },
    include: {
      tarefa: {
        include: { processo: { select: { id: true, protocolo: true } } },
      },
    },
    orderBy: { tarefa: { prazo: 'asc' } },
  });

  const grupos: MinhasTarefasAgrupadas = {
    pendente: [],
    em_andamento: [],
    concluida: [],
  };
  for (const atrib of atribuicoes as Array<Record<string, unknown> & { status: string }>) {
    const chave = atrib.status as keyof MinhasTarefasAgrupadas;
    if (chave in grupos) {
      grupos[chave].push(atrib);
    }
  }
  return grupos;
}

/**
 * Altera o status APENAS da `TarefaAtribuicao` do Servidor autenticado
 * (Req. 27.7). Localiza a atribuição por `tarefaId + servidorId`, sem tocar nas
 * demais atribuições da mesma Tarefa. Ao concluir, registra `concluidaEm`.
 * Emite `tarefa:status_atualizado` na sala pessoal do Servidor.
 */
export async function alterarStatusMinha(
  tarefaId: string,
  servidorId: string,
  dto: AtualizarStatusTarefaInput,
  ator: Ator,
  deps?: TarefasDeps,
): Promise<Record<string, unknown>> {
  const d = resolveDeps(deps);

  const atribuicao = await d.prisma.tarefaAtribuicao.findUnique({
    where: { tarefaId_servidorId: { tarefaId, servidorId } },
  });
  if (!atribuicao) {
    throw notFound(
      ErrorCodes.TAREFA_NAO_ENCONTRADA,
      'Atribuição de tarefa não encontrada para este servidor',
    );
  }

  const statusAnterior = (atribuicao as { status: string }).status;
  const concluindo = dto.status === StatusTarefa.CONCLUIDA;

  const atualizada = await d.prisma.tarefaAtribuicao.update({
    where: { tarefaId_servidorId: { tarefaId, servidorId } },
    data: {
      status: dto.status,
      // Req. 27.7: registra a data/hora da conclusão ao concluir; limpa ao reabrir.
      concluidaEm: concluindo ? new Date() : null,
    },
  });

  await d.auditar(
    auditoriaBase('alterar_status_atribuicao', ator, (atribuicao as { id: string }).id, {
      tipoObjeto: 'TarefaAtribuicao',
      valorAnterior: { status: statusAnterior },
      valorPosterior: { status: dto.status },
    }),
  );

  d.emitirServidor(servidorId, 'tarefa:status_atualizado', {
    tarefaId,
    atribuicaoId: (atribuicao as { id: string }).id,
    status: dto.status,
  });

  return atualizada as Record<string, unknown>;
}
