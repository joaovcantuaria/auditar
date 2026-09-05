import { createRequire } from 'node:module';
import type { PrismaClient } from '@prisma/client';
import { ErrorCodes } from '@auditar/shared';
import { notFound } from '../../utils/index.js';

/**
 * Serviço de Consulta e Acompanhamento de Processo pelo Cidadão (Task 7.3).
 *
 * Cobre as abas Informações, Histórico e Comunicação (canal público) da tela
 * de detalhe do Processo no Portal do Cidadão. A aba Documentos já é servida
 * por `documentos.service.ts` (tarefa 7.2) e a aba Prazos é responsabilidade
 * exclusiva do frontend (tarefa 13.3, calendário visual client-side).
 *
 * Toda consulta aqui aplica a MESMA regra de ownership: um Cidadão só pode
 * acessar Processos dos quais é o titular. Quando o Processo não existe OU
 * pertence a outro Cidadão, a resposta é 404 (nunca 403) — para não revelar a
 * existência do Processo a quem não é o dono (Req 5.1, 5.10), no mesmo padrão
 * já usado em `documentos.service.ts` (`gerarDownloadUrl`).
 *
 * Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5, 5.10
 */

const MENSAGEM_PROCESSO_NAO_ENCONTRADO = 'Processo não encontrado';

// ---------------------------------------------------------------------------
// Injeção de dependências (facilita testes; usa a instância real por padrão)
// ---------------------------------------------------------------------------

/** Dependências injetáveis do serviço. */
export interface ProcessosDetalheDeps {
  prisma: PrismaClient;
}

let cachedPrisma: ProcessosDetalheDeps['prisma'] | undefined;

/**
 * Resolve o Prisma real preguiçosamente (lazy). Só é chamada quando o chamador
 * NÃO injeta `deps.prisma` — importar este módulo não deve carregar o
 * `@prisma/client` (mesmo padrão de `processos.service.ts`/`documentos.service.ts`).
 */
function getRealPrisma(): ProcessosDetalheDeps['prisma'] {
  if (!cachedPrisma) {
    const requireLocal = createRequire(import.meta.url);
    const { prisma } = requireLocal('../../config/database.js') as { prisma: PrismaClient };
    cachedPrisma = prisma;
  }
  return cachedPrisma;
}

function resolveDeps(deps?: Partial<ProcessosDetalheDeps>): ProcessosDetalheDeps {
  return { prisma: deps?.prisma ?? getRealPrisma() };
}

/**
 * Verifica se o Processo existe e pertence ao Cidadão informado, sem carregar
 * dados adicionais (usado por `obterHistorico`/`obterMensagens`, que não
 * precisam do restante da projeção de `obterDetalhe`).
 *
 * @throws {AppError} 404 — Processo inexistente ou não pertencente ao Cidadão
 * (nunca 403 — Req 5.1, 5.10).
 */
async function verificarOwnership(
  processoId: string,
  cidadaoId: string,
  d: ProcessosDetalheDeps,
): Promise<void> {
  const processo = await d.prisma.processo.findUnique({
    where: { id: processoId },
    select: { cidadaoId: true },
  });
  if (!processo || processo.cidadaoId !== cidadaoId) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, MENSAGEM_PROCESSO_NAO_ENCONTRADO);
  }
}

// ---------------------------------------------------------------------------
// Aba Informações (Req 5.1, 5.2)
// ---------------------------------------------------------------------------

/** Resposta de um campo do Formulário_Dinâmico submetido no Processo. */
export interface RespostaResumo {
  campoId: string;
  valor: string;
}

/** Detalhe completo do Processo exibido na aba Informações (Req 5.2). */
export interface ProcessoDetalhe {
  protocolo: string;
  categoria: string | null;
  tipoProcesso: string;
  unidade: string;
  abertoEm: Date;
  prazoFinal: Date;
  status: string;
  etapaAtual: string | null;
  respostas: RespostaResumo[];
}

/** Formato crú retornado pelo Prisma para a projeção usada em `obterDetalhe`. */
interface ProcessoDetalheRow {
  protocolo: string;
  status: string;
  abertoEm: Date;
  prazoFinal: Date;
  cidadaoId: string;
  tipoProcesso: { nome: string; categoria: { nome: string } | null } | null;
  unidade: { nome: string } | null;
  etapaAtual: { nome: string } | null;
  respostas: RespostaResumo[];
}

/**
 * Carrega o detalhe completo de um Processo para exibição na aba Informações
 * (Req 5.1, 5.2): protocolo, categoria, tipo, unidade, data de abertura,
 * status atual, etapa atual e as respostas do formulário submetido.
 *
 * @throws {AppError} 404 — Processo inexistente ou não pertencente ao Cidadão
 * autenticado (Req 5.1, 5.10 — jamais 403, para não revelar a existência do
 * Processo a quem não é o titular).
 */
export async function obterDetalhe(
  processoId: string,
  cidadaoId: string,
  deps?: Partial<ProcessosDetalheDeps>,
): Promise<ProcessoDetalhe> {
  const d = resolveDeps(deps);

  const processo = (await d.prisma.processo.findUnique({
    where: { id: processoId },
    select: {
      protocolo: true,
      status: true,
      abertoEm: true,
      prazoFinal: true,
      cidadaoId: true,
      tipoProcesso: { select: { nome: true, categoria: { select: { nome: true } } } },
      unidade: { select: { nome: true } },
      etapaAtual: { select: { nome: true } },
      respostas: { select: { campoId: true, valor: true } },
    },
  })) as ProcessoDetalheRow | null;

  if (!processo || processo.cidadaoId !== cidadaoId) {
    throw notFound(ErrorCodes.VALIDATION_ERROR, MENSAGEM_PROCESSO_NAO_ENCONTRADO);
  }

  return {
    protocolo: processo.protocolo,
    categoria: processo.tipoProcesso?.categoria?.nome ?? null,
    tipoProcesso: processo.tipoProcesso?.nome ?? '',
    unidade: processo.unidade?.nome ?? '',
    abertoEm: processo.abertoEm,
    prazoFinal: processo.prazoFinal,
    status: processo.status,
    etapaAtual: processo.etapaAtual?.nome ?? null,
    respostas: processo.respostas,
  };
}

// ---------------------------------------------------------------------------
// Aba Histórico (Req 5.3)
// ---------------------------------------------------------------------------

/** Item de histórico exibido na aba Histórico, em ordem cronológica crescente. */
export interface HistoricoItem {
  data: Date;
  acao: string;
  responsavel: string;
  observacao: string | null;
}

/** Formato crú retornado pelo Prisma para a projeção usada em `obterHistorico`. */
interface MovimentacaoRow {
  etapaOrigemId: string | null;
  etapaDestinoId: string | null;
  observacao: string | null;
  realizadoEm: Date;
  servidor: { nome: string } | null;
}

/**
 * Descreve textualmente uma movimentação a partir da transição de Etapa
 * (origem → destino). Quando não há transição de Etapa registrada (ex.:
 * apenas uma observação foi adicionada ao Processo), usa a própria observação
 * como descrição, com um texto genérico de último recurso quando nem isso
 * está disponível.
 */
function describirAcao(
  mov: Pick<MovimentacaoRow, 'etapaOrigemId' | 'etapaDestinoId' | 'observacao'>,
): string {
  if (mov.etapaOrigemId && mov.etapaDestinoId) {
    return `Movimentação da etapa ${mov.etapaOrigemId} para a etapa ${mov.etapaDestinoId}`;
  }
  if (!mov.etapaOrigemId && mov.etapaDestinoId) {
    return `Processo encaminhado para a etapa ${mov.etapaDestinoId}`;
  }
  if (mov.etapaOrigemId && !mov.etapaDestinoId) {
    return `Processo encerrado a partir da etapa ${mov.etapaOrigemId}`;
  }
  return mov.observacao?.trim() ? mov.observacao : 'Movimentação registrada';
}

/**
 * Lista a cronologia de movimentações de um Processo em ordem cronológica
 * crescente (Req 5.3), com data, hora e identificação do Servidor
 * responsável por cada ação.
 *
 * @throws {AppError} 404 — Processo inexistente ou não pertencente ao Cidadão
 * autenticado (Req 5.1, 5.10).
 */
export async function obterHistorico(
  processoId: string,
  cidadaoId: string,
  deps?: Partial<ProcessosDetalheDeps>,
): Promise<HistoricoItem[]> {
  const d = resolveDeps(deps);

  await verificarOwnership(processoId, cidadaoId, d);

  const movimentacoes = (await d.prisma.movimentacaoProcesso.findMany({
    // Observações internas (Servidor ↔ Servidor, Req 11.4) nunca são expostas
    // ao Cidadão: filtra-se `tipoObservacao != 'interna'`, mantendo as
    // movimentações públicas e as sem tipo (transições de etapa, etc.).
    where: { processoId, tipoObservacao: { not: 'interna' } },
    orderBy: { realizadoEm: 'asc' },
    select: {
      etapaOrigemId: true,
      etapaDestinoId: true,
      observacao: true,
      realizadoEm: true,
      servidor: { select: { nome: true } },
    },
  })) as MovimentacaoRow[];

  return movimentacoes.map((mov) => ({
    data: mov.realizadoEm,
    acao: describirAcao(mov),
    responsavel: mov.servidor?.nome ?? '',
    observacao: mov.observacao,
  }));
}

// ---------------------------------------------------------------------------
// Aba Comunicação — canal público (Req 5.5)
// ---------------------------------------------------------------------------

/** Mensagem do canal público exibida na aba Comunicação, em ordem crescente. */
export interface MensagemPublica {
  id: string;
  remetente: string;
  conteudo: string;
  enviadaEm: Date;
}

/** Formato crú retornado pelo Prisma para a projeção usada em `obterMensagens`. */
interface MensagemRow {
  id: string;
  conteudo: string;
  enviadaEm: Date;
  remetenteCidadao: { nome: string } | null;
  remetenteServidor: { nome: string } | null;
}

/**
 * Lista as mensagens do canal público (Cidadão ↔ Servidor) de um Processo, em
 * ordem cronológica crescente (Req 5.5). O canal interno (Servidor ↔
 * Servidor, Req 13.2) nunca é exposto por esta função — apenas
 * `canal = 'publico'` é consultado.
 *
 * @throws {AppError} 404 — Processo inexistente ou não pertencente ao Cidadão
 * autenticado (Req 5.1, 5.10).
 */
export async function obterMensagens(
  processoId: string,
  cidadaoId: string,
  deps?: Partial<ProcessosDetalheDeps>,
): Promise<MensagemPublica[]> {
  const d = resolveDeps(deps);

  await verificarOwnership(processoId, cidadaoId, d);

  const mensagens = (await d.prisma.mensagem.findMany({
    where: { processoId, canal: 'publico' },
    orderBy: { enviadaEm: 'asc' },
    select: {
      id: true,
      conteudo: true,
      enviadaEm: true,
      remetenteCidadao: { select: { nome: true } },
      remetenteServidor: { select: { nome: true } },
    },
  })) as MensagemRow[];

  return mensagens.map((m) => ({
    id: m.id,
    remetente: m.remetenteCidadao?.nome ?? m.remetenteServidor?.nome ?? '',
    conteudo: m.conteudo,
    enviadaEm: m.enviadaEm,
  }));
}
