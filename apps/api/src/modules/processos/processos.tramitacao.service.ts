import { createRequire } from 'node:module';
import type { PrismaClient } from '@prisma/client';
import { ErrorCodes, StatusProcesso, TipoEvento } from '@auditar/shared';
import { AppError, badRequest, notFound } from '../../utils/index.js';
import type { NotificacaoJob } from '../../jobs/types.js';
import { STATUS_ENCERRADOS } from './mensagens.publico.service.js';
import {
  registrar as defaultRegistrar,
  registrarSync as defaultRegistrarSync,
} from '../auditoria/index.js';
import type { RegistrarAuditoriaDto } from '../auditoria/index.js';

/**
 * Serviço de Tramitação de Processo pelo Servidor (Task 7.6, Requisito 11).
 *
 * Cobre:
 *  - Detalhe administrativo do Processo, com etapa atual, etapas anteriores
 *    concluídas, próxima etapa prevista e histórico completo de movimentações
 *    (Req 11.1) — o Servidor vê observações tanto públicas quanto internas.
 *  - Avanço de etapa (Req 11.2, 11.3, 11.9), incluindo a finalização
 *    (aprovação) quando a etapa atual é a última, condicionada à permissão
 *    APROVAR (Req 11.7 aplica-se por analogia ao caso REJEITAR).
 *  - Rejeição do Processo (Req 11.7).
 *  - Solicitação de documentos ao Cidadão (Req 11.6).
 *  - Registro de observações internas/públicas (Req 11.4, 11.5).
 *
 * O registro no Módulo_de_Auditoria dos eventos de tramitação que alteram o
 * estado do Processo (avançar, aprovar, rejeitar, solicitar documentos) é
 * ATÔMICO com a operação de negócio: usa `registrarSync` dentro da mesma
 * `$transaction`, de modo que uma falha no registro reverte toda a operação e
 * a resposta é 500 `AUDITORIA_FALHA` (Req 11.9). As observações
 * (Req 11.4/11.5) usam o `registrar` assíncrono (nunca lança), pois não há
 * exigência de atomicidade nesses casos.
 *
 * Requisitos: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.9
 */

const MODULO = 'processos';

const MENSAGEM_PROCESSO_NAO_ENCONTRADO = 'Processo não encontrado';
const MENSAGEM_PROCESSO_ENCERRADO = 'Processo encerrado; não é possível avançar etapa';
const MENSAGEM_AUDITORIA_FALHA =
  'Falha no registro de auditoria; a operação sobre o processo foi cancelada';
const MENSAGEM_SEM_PERMISSAO_APROVAR =
  'Você não possui permissão para aprovar processos. Contate o Gestor responsável para solicitar essa permissão.';

/**
 * Prefixo da observação registrada ao solicitar documentos ao Cidadão
 * (ver `solicitarDocumentos`). É reutilizado no cálculo das ações pendentes
 * (Req 24.3) para reconstruir a lista de documentos solicitados a partir das
 * movimentações — enquanto `Etapa.documentosObrigatorios` não é persistido.
 */
export const PREFIXO_DOCS_SOLICITADOS = 'Documentos solicitados: ';

// ---------------------------------------------------------------------------
// Injeção de dependências (facilita testes; usa as instâncias reais por padrão)
// ---------------------------------------------------------------------------

/** Enfileiramento de notificação — mesmo payload da `notificacao-queue`. */
export type NotificarTramitacaoFn = (payload: NotificacaoJob) => Promise<unknown>;

/** Dependências injetáveis do serviço. */
export interface TramitacaoDeps {
  /** Precisa de `processo`, `movimentacaoProcesso`, `etapa` e `$transaction`. */
  prisma: PrismaClient;
  notificar: NotificarTramitacaoFn;
  /** Registro transacional (lança em caso de falha, para reverter — Req 11.9). */
  registrarSync: (dto: RegistrarAuditoriaDto, tx: unknown) => Promise<void>;
  /** Registro assíncrono (nunca lança) — usado nas observações (Req 11.4/11.5). */
  registrar: (dto: RegistrarAuditoriaDto) => Promise<void>;
}

let cachedPrisma: PrismaClient | undefined;
let cachedNotificar: NotificarTramitacaoFn | undefined;

/**
 * Resolve o Prisma real preguiçosamente (lazy). Só é chamada quando o
 * chamador NÃO injeta `deps.prisma` — importar este módulo não deve carregar
 * o `@prisma/client`.
 */
function getRealPrisma(): PrismaClient {
  if (!cachedPrisma) {
    const requireLocal = createRequire(import.meta.url);
    const { prisma } = requireLocal('../../config/database.js') as { prisma: PrismaClient };
    cachedPrisma = prisma;
  }
  return cachedPrisma;
}

/**
 * Resolve o enfileiramento de notificação real preguiçosamente (lazy). Só é
 * chamada quando o chamador NÃO injeta `deps.notificar` — importar este
 * módulo não deve abrir conexão com o Redis/BullMQ.
 */
function getRealNotificar(): NotificarTramitacaoFn {
  if (!cachedNotificar) {
    const requireLocal = createRequire(import.meta.url);
    const { notificacaoQueue, QUEUE_NAMES } = requireLocal('../../jobs/queues.js') as {
      notificacaoQueue: () => { add: (name: string, data: unknown) => Promise<unknown> };
      QUEUE_NAMES: Record<string, string>;
    };
    cachedNotificar = (payload) => notificacaoQueue().add(QUEUE_NAMES.NOTIFICACAO, payload);
  }
  return cachedNotificar;
}

function resolveDeps(deps?: Partial<TramitacaoDeps>): TramitacaoDeps {
  return {
    prisma: deps?.prisma ?? getRealPrisma(),
    notificar: deps?.notificar ?? getRealNotificar(),
    registrarSync: deps?.registrarSync ?? (defaultRegistrarSync as TramitacaoDeps['registrarSync']),
    registrar: deps?.registrar ?? defaultRegistrar,
  };
}

// ---------------------------------------------------------------------------
// Emissão de eventos em tempo real via Socket.io (tarefa 9.3 — ainda não existe)
// ---------------------------------------------------------------------------

type EmitFn = (room: string, event: string, payload: unknown) => void;
let cachedEmit: EmitFn | undefined;

/**
 * Resolve preguiçosamente a função de emissão do Socket.io. O servidor
 * Socket.io ainda não existe (será criado na tarefa 9.3) — enquanto isso, cai
 * silenciosamente em um no-op. Assim que `socket/socket.server.js#getIO`
 * existir, a emissão passa a funcionar sem alterar este arquivo.
 */
function getRealEmit(): EmitFn {
  if (!cachedEmit) {
    try {
      const requireLocal = createRequire(import.meta.url);
      const { getIO } = requireLocal('../../socket/socket.server.js') as {
        getIO: () => { to: (room: string) => { emit: (e: string, p: unknown) => void } };
      };
      cachedEmit = (room, event, payload) => {
        getIO().to(room).emit(event, payload);
      };
    } catch {
      cachedEmit = () => {}; /* Socket.io (tarefa 9.3) ainda não existe — no-op */
    }
  }
  return cachedEmit;
}

/** Emite um evento em tempo real sem nunca propagar erro (fire-and-forget síncrono). */
function emitSeguro(room: string, event: string, payload: unknown): void {
  try {
    getRealEmit()(room, event, payload);
  } catch {
    /* nunca propaga */
  }
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Executa uma operação assíncrona sem aguardar seu resultado, registrando
 * (mas nunca propagando) uma eventual falha. Usado para a notificação ao
 * Cidadão, que jamais deve derrubar a tramitação já persistida (mesmo padrão
 * de `mensagens.publico.service.ts`).
 */
function fireAndForget(operacao: () => Promise<unknown>, evento: string): void {
  operacao().catch((err: unknown) => {
    console.error(
      JSON.stringify({
        level: 'error',
        scope: MODULO,
        event: evento,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  });
}

/**
 * Lista os documentos obrigatórios ainda pendentes para permitir o avanço da
 * Etapa (Req 11.3).
 *
 * TODO: `Etapa.documentosObrigatorios` NÃO é persistido no schema atual do
 * Prisma — `fluxos.service.ts` nunca grava o array aceito pelo Zod e
 * `schema.prisma` não possui a coluna correspondente. Portanto esta checagem é
 * um no-op documentado (sempre retorna lista vazia) até que uma migração
 * futura adicione a coluna. Quando isso acontecer, basta passar a ler os
 * documentos obrigatórios da Etapa e comparar com os Documentos já enviados.
 */
export function listarDocumentosPendentes(_etapa: EtapaOrdenada): string[] {
  return [];
}

// ---------------------------------------------------------------------------
// GET /:id — detalhe administrativo (Req 11.1)
// ---------------------------------------------------------------------------

/** Etapa do Fluxo carregada em ordem para navegação origem→destino. */
interface EtapaOrdenada {
  id: string;
  nome: string;
  prazosDiasUteis: number;
  ordem: number;
}

/** Resumo da etapa atual do Processo. */
export interface EtapaAtualResumo {
  id: string;
  nome: string;
  prazosDiasUteis: number;
}

/** Resumo de uma etapa anterior já concluída. */
export interface EtapaAnteriorResumo {
  id: string;
  nome: string;
  concluidaEm: Date | null;
}

/** Resumo da próxima etapa prevista no Fluxo. */
export interface ProximaEtapaResumo {
  id: string;
  nome: string;
}

/** Uma resposta do Formulário_Dinâmico associada ao Processo (Req 24.1). */
export interface RespostaFormularioResumo {
  campoId: string;
  valor: string;
}

/**
 * Seção de ações pendentes do Processo (Req 24.3): próxima etapa prevista e
 * documentos solicitados ainda não anexados.
 */
export interface AcoesPendentesResumo {
  proximaEtapa: ProximaEtapaResumo | null;
  documentosSolicitadosPendentes: string[];
}

/** Item do histórico de movimentações exibido ao Servidor (públicas + internas). */
export interface MovimentacaoResumo {
  etapaOrigemId: string | null;
  etapaDestinoId: string | null;
  observacao: string | null;
  tipoObservacao: string | null;
  realizadoEm: Date;
  servidor: { nome: string } | null;
}

/** Detalhe administrativo completo do Processo (Req 11.1). */
export interface ProcessoTramitacaoDetalhe {
  protocolo: string;
  status: string;
  prioridade: number;
  cidadao: { nome: string; cpf: string } | null;
  categoria: string | null;
  tipoProcesso: string;
  unidade: string;
  servidorResponsavel: string | null;
  abertoEm: Date;
  prazoFinal: Date;
  etapaAtual: EtapaAtualResumo | null;
  etapasAnteriores: EtapaAnteriorResumo[];
  proximaEtapa: ProximaEtapaResumo | null;
  movimentacoes: MovimentacaoResumo[];
  /**
   * Respostas do Formulário_Dinâmico do Processo (Req 24.1). Campo aditivo:
   * não substitui nada do retorno original da tramitação (Task 21.1).
   */
  respostas: RespostaFormularioResumo[];
  /**
   * Ações pendentes para o avanço do Processo (Req 24.3). Campo aditivo:
   * próxima etapa prevista + documentos solicitados ainda não anexados.
   */
  acoesPendentes: AcoesPendentesResumo;
}

/** Formato crú do Processo carregado para o detalhe administrativo. */
interface ProcessoDetalheAdminRow {
  protocolo: string;
  status: string;
  prioridade: number;
  abertoEm: Date;
  prazoFinal: Date;
  etapaAtualId: string | null;
  fluxoVersaoId: string;
  cidadao: { nome: string; cpf: string } | null;
  tipoProcesso: { nome: string; categoria: { nome: string } | null } | null;
  unidade: { nome: string } | null;
  servidorResponsavel: { nome: string } | null;
  respostas: RespostaFormularioResumo[];
  documentos: { nomeOriginal: string }[];
}

/**
 * Carrega o detalhe administrativo de um Processo para a tela de tramitação do
 * Servidor (Req 11.1): dados gerais, etapa atual, etapas anteriores concluídas,
 * próxima etapa prevista no Fluxo e o histórico COMPLETO de movimentações
 * (incluindo observações internas — visíveis a Servidores).
 *
 * @throws {AppError} 404 — Processo inexistente.
 */
export async function obterDetalheAdmin(
  processoId: string,
  deps?: Partial<TramitacaoDeps>,
): Promise<ProcessoTramitacaoDetalhe> {
  const d = resolveDeps(deps);

  const processo = (await d.prisma.processo.findUnique({
    where: { id: processoId },
    select: {
      protocolo: true,
      status: true,
      prioridade: true,
      abertoEm: true,
      prazoFinal: true,
      etapaAtualId: true,
      fluxoVersaoId: true,
      cidadao: { select: { nome: true, cpf: true } },
      tipoProcesso: { select: { nome: true, categoria: { select: { nome: true } } } },
      unidade: { select: { nome: true } },
      servidorResponsavel: { select: { nome: true } },
      // Req 24.1 — respostas do Formulário_Dinâmico (campo aditivo).
      respostas: { select: { campoId: true, valor: true } },
      // Req 24.3 — documentos já anexados, para cálculo das pendências.
      documentos: { select: { nomeOriginal: true } },
    },
  })) as ProcessoDetalheAdminRow | null;

  if (!processo) {
    throw notFound(ErrorCodes.PROCESSO_NAO_ENCONTRADO, MENSAGEM_PROCESSO_NAO_ENCONTRADO);
  }

  const etapas = (await d.prisma.etapa.findMany({
    where: { fluxoId: processo.fluxoVersaoId },
    orderBy: { ordem: 'asc' },
    select: { id: true, nome: true, prazosDiasUteis: true, ordem: true },
  })) as EtapaOrdenada[];

  const movimentacoes = (await d.prisma.movimentacaoProcesso.findMany({
    where: { processoId },
    orderBy: { realizadoEm: 'asc' },
    select: {
      etapaOrigemId: true,
      etapaDestinoId: true,
      observacao: true,
      tipoObservacao: true,
      realizadoEm: true,
      servidor: { select: { nome: true } },
    },
  })) as MovimentacaoResumo[];

  const etapaAtual = etapas.find((e) => e.id === processo.etapaAtualId) ?? null;

  // Última movimentação com destino = id da etapa determina quando ela foi
  // concluída (Req 11.1 — etapas anteriores concluídas).
  const concluidaEmPorEtapa = new Map<string, Date>();
  for (const mov of movimentacoes) {
    if (mov.etapaDestinoId) {
      concluidaEmPorEtapa.set(mov.etapaDestinoId, mov.realizadoEm);
    }
  }

  const etapasAnteriores: EtapaAnteriorResumo[] = etapaAtual
    ? etapas
        .filter((e) => e.ordem < etapaAtual.ordem)
        .map((e) => ({
          id: e.id,
          nome: e.nome,
          concluidaEm: concluidaEmPorEtapa.get(e.id) ?? null,
        }))
    : [];

  const proximaEtapaEntidade = etapaAtual
    ? etapas.find((e) => e.ordem === etapaAtual.ordem + 1) ?? null
    : null;

  const proximaEtapa: ProximaEtapaResumo | null = proximaEtapaEntidade
    ? { id: proximaEtapaEntidade.id, nome: proximaEtapaEntidade.nome }
    : null;

  // Req 24.3 — documentos solicitados ainda não anexados: reconstrói a lista
  // solicitada a partir das movimentações e subtrai os já anexados (por nome).
  const documentosSolicitadosPendentes = calcularDocumentosSolicitadosPendentes(
    movimentacoes,
    (processo.documentos ?? []).map((d) => d.nomeOriginal),
  );

  return {
    protocolo: processo.protocolo,
    status: processo.status,
    prioridade: processo.prioridade,
    cidadao: processo.cidadao,
    categoria: processo.tipoProcesso?.categoria?.nome ?? null,
    tipoProcesso: processo.tipoProcesso?.nome ?? '',
    unidade: processo.unidade?.nome ?? '',
    servidorResponsavel: processo.servidorResponsavel?.nome ?? null,
    abertoEm: processo.abertoEm,
    prazoFinal: processo.prazoFinal,
    etapaAtual: etapaAtual
      ? { id: etapaAtual.id, nome: etapaAtual.nome, prazosDiasUteis: etapaAtual.prazosDiasUteis }
      : null,
    etapasAnteriores,
    proximaEtapa,
    movimentacoes,
    respostas: processo.respostas ?? [],
    acoesPendentes: {
      proximaEtapa,
      documentosSolicitadosPendentes,
    },
  };
}

/**
 * Calcula os documentos solicitados ainda pendentes de anexação (Req 24.3).
 *
 * Enquanto `Etapa.documentosObrigatorios` não é persistido no schema, a lista
 * de documentos solicitados é reconstruída a partir das movimentações cujo
 * `observacao` começa com {@link PREFIXO_DOCS_SOLICITADOS} (geradas por
 * `solicitarDocumentos`). Os itens são então subtraídos dos documentos já
 * anexados (comparação case-insensitive por nome original), resultando na
 * diferença de conjuntos (solicitados − anexados).
 */
export function calcularDocumentosSolicitadosPendentes(
  movimentacoes: Pick<MovimentacaoResumo, 'observacao'>[],
  nomesAnexados: string[],
): string[] {
  const anexadosNorm = new Set(nomesAnexados.map((n) => n.trim().toLowerCase()));

  const solicitados: string[] = [];
  const vistos = new Set<string>();
  for (const mov of movimentacoes) {
    if (!mov.observacao || !mov.observacao.startsWith(PREFIXO_DOCS_SOLICITADOS)) continue;
    const lista = mov.observacao.slice(PREFIXO_DOCS_SOLICITADOS.length);
    for (const item of lista.split(',')) {
      const nome = item.trim();
      if (!nome) continue;
      const chave = nome.toLowerCase();
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      solicitados.push(nome);
    }
  }

  return solicitados.filter((nome) => !anexadosNorm.has(nome.toLowerCase()));
}

// ---------------------------------------------------------------------------
// GET /:id/auditoria — trilha de auditoria unificada (Req 24.2)
// ---------------------------------------------------------------------------

/**
 * Item unificado da trilha de auditoria do Processo (Req 24.2). Combina, num
 * formato único e ordenado cronologicamente, tanto as `MovimentacaoProcesso`
 * (tramitação) quanto os registros de `AuditoriaLog` do Processo.
 */
export interface TrilhaAuditoriaItem {
  /** Origem do item: movimentação de tramitação ou registro de auditoria. */
  origem: 'movimentacao' | 'auditoria';
  /** Identidade do autor da ação (nome do Servidor, categoria do ator, etc.). */
  autor: string | null;
  /** Descrição da ação realizada. */
  acao: string;
  /** Valor imediatamente anterior à ação, quando aplicável. */
  valorAnterior?: string | null;
  /** Valor posterior à ação, quando aplicável. */
  valorPosterior?: string | null;
  /** Data e hora da ação (usada para a ordenação cronológica). */
  data: Date;
}

/** Formato crú de uma movimentação carregada para a trilha de auditoria. */
interface MovimentacaoTrilhaRow {
  etapaOrigemId: string | null;
  etapaDestinoId: string | null;
  observacao: string | null;
  tipoObservacao: string | null;
  realizadoEm: Date;
  servidor: { nome: string } | null;
}

/** Formato crú de um registro de AuditoriaLog carregado para a trilha. */
interface AuditoriaLogTrilhaRow {
  tipoAcao: string;
  valorAnterior: string | null;
  valorPosterior: string | null;
  realizadaEmUtc: Date;
  atorServidorId: string | null;
  atorCidadaoId: string | null;
  ator: string;
}

/**
 * Descreve, em texto, a ação de uma movimentação de tramitação para exibição
 * na trilha (Req 24.2). Cobre avanço/finalização, rejeição, solicitação de
 * documentos e observações internas/públicas.
 */
function descreverMovimentacao(mov: MovimentacaoTrilhaRow): string {
  if (mov.tipoObservacao === 'interna') return 'Observação interna registrada';
  if (mov.tipoObservacao === 'publica') return 'Observação pública registrada';
  if (mov.observacao?.startsWith(PREFIXO_DOCS_SOLICITADOS)) return 'Documentos solicitados';
  if (mov.etapaDestinoId && mov.etapaDestinoId !== mov.etapaOrigemId) return 'Etapa avançada';
  if (!mov.etapaDestinoId && mov.etapaOrigemId) return 'Processo encerrado';
  return 'Movimentação registrada';
}

/**
 * Carrega a trilha de auditoria completa de um Processo (Req 24.2), combinando
 * `MovimentacaoProcesso` (autor Servidor, etapa origem/destino, observação,
 * data) e os registros de `AuditoriaLog` cujo `objetoId` é o Processo
 * (com valorAnterior/valorPosterior quando houver). O resultado é normalizado
 * no formato unificado {origem, autor, acao, valorAnterior?, valorPosterior?,
 * data} e ordenado cronologicamente (crescente).
 *
 * @throws {AppError} 404 — Processo inexistente.
 */
export async function obterTrilhaAuditoria(
  processoId: string,
  deps?: Partial<TramitacaoDeps>,
): Promise<TrilhaAuditoriaItem[]> {
  const d = resolveDeps(deps);

  const processo = await d.prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true },
  });

  if (!processo) {
    throw notFound(ErrorCodes.PROCESSO_NAO_ENCONTRADO, MENSAGEM_PROCESSO_NAO_ENCONTRADO);
  }

  const movimentacoes = (await d.prisma.movimentacaoProcesso.findMany({
    where: { processoId },
    orderBy: { realizadoEm: 'asc' },
    select: {
      etapaOrigemId: true,
      etapaDestinoId: true,
      observacao: true,
      tipoObservacao: true,
      realizadoEm: true,
      servidor: { select: { nome: true } },
    },
  })) as MovimentacaoTrilhaRow[];

  const registros = (await d.prisma.auditoriaLog.findMany({
    where: { objetoId: processoId, tipoObjeto: 'Processo' },
    orderBy: { realizadaEmUtc: 'asc' },
    select: {
      tipoAcao: true,
      valorAnterior: true,
      valorPosterior: true,
      realizadaEmUtc: true,
      atorServidorId: true,
      atorCidadaoId: true,
      ator: true,
    },
  })) as AuditoriaLogTrilhaRow[];

  const itensMovimentacao: TrilhaAuditoriaItem[] = movimentacoes.map((mov) => ({
    origem: 'movimentacao',
    autor: mov.servidor?.nome ?? null,
    acao: descreverMovimentacao(mov),
    valorAnterior: mov.etapaOrigemId ?? null,
    valorPosterior: mov.etapaDestinoId ?? null,
    data: mov.realizadoEm,
  }));

  const itensAuditoria: TrilhaAuditoriaItem[] = registros.map((reg) => ({
    origem: 'auditoria',
    autor: reg.atorServidorId ?? reg.atorCidadaoId ?? reg.ator,
    acao: reg.tipoAcao,
    valorAnterior: reg.valorAnterior,
    valorPosterior: reg.valorPosterior,
    data: reg.realizadaEmUtc,
  }));

  return [...itensMovimentacao, ...itensAuditoria].sort(
    (a, b) => a.data.getTime() - b.data.getTime(),
  );
}

// ---------------------------------------------------------------------------
// PATCH /:id — Edição Corretiva de dados do Processo (Req 24.4, 24.5, 24.7)
// ---------------------------------------------------------------------------

/**
 * Conjunto de campos simples do Processo passíveis de Edição_Corretiva.
 *
 * Decisão conservadora (Task 21.2): apenas a `prioridade` é editável entre os
 * campos escalares do Processo. Campos que definem identidade/estado do
 * Processo — `protocolo`, `cidadaoId`, `status`, `etapaAtualId`,
 * `tipoProcessoId`, `unidadeId`, `fluxoVersaoId`, prazos — NÃO são corrigíveis
 * por aqui (mudanças de status/etapa passam pela tramitação; protocolo e
 * cidadão são imutáveis).
 */
export const CAMPOS_PROCESSO_EDITAVEIS = ['prioridade'] as const;
export type CampoProcessoEditavel = (typeof CAMPOS_PROCESSO_EDITAVEIS)[number];

/** Correção de uma resposta do Formulário_Dinâmico (por campoId). */
export interface CorrecaoResposta {
  campoId: string;
  valor: string;
}

/** Payload aceito pela Edição_Corretiva (Req 24.4). */
export interface EdicaoCorretivaInput {
  /** Novos valores para campos simples do Processo (apenas `prioridade`). */
  prioridade?: number;
  /** Correções de respostas do Formulário_Dinâmico, por campoId. */
  respostas?: CorrecaoResposta[];
}

/** Resumo do Processo retornado após a Edição_Corretiva. */
export interface EdicaoCorretivaResultado {
  protocolo: string;
  prioridade: number;
  /** Lista dos campos efetivamente alterados (para feedback ao Servidor). */
  camposAlterados: string[];
}

/** Formato crú do Processo carregado para a Edição_Corretiva. */
interface ProcessoParaEdicaoRow {
  id: string;
  protocolo: string;
  prioridade: number;
  respostas: { id: string; campoId: string; valor: string }[];
}

/**
 * Aplica uma Edição_Corretiva de dados de um Processo (Req 24.4, 24.5, 24.7).
 *
 * Regras:
 * 1. 404 quando o Processo não existe.
 * 2. Calcula o diff campo a campo entre o estado atual e os novos valores;
 *    somente campos com alteração real são persistidos e auditados.
 * 3. Se nada mudou, retorna sem abrir transação (nenhuma auditoria registrada).
 * 4. A alteração do Processo, das RespostaFormulario e o registro em auditoria
 *    (um por campo alterado, com valor anterior e posterior) ocorrem na MESMA
 *    transação. Como o único ponto que lança dentro dela é `registrarSync`,
 *    uma falha da auditoria reverte tudo e resulta em 500 `AUDITORIA_FALHA`
 *    (`SYS_001`) — a alteração NÃO é persistida (Req 24.7).
 *
 * A verificação da Permissão_Granular `editar` (Req 24.4) é feita no
 * controller/router — este serviço assume que já passou.
 *
 * @throws {AppError} 404 / 500 `AUDITORIA_FALHA`.
 */
export async function editarProcessoCorretivo(
  processoId: string,
  servidorId: string,
  enderecoIp: string,
  input: EdicaoCorretivaInput,
  deps?: Partial<TramitacaoDeps>,
): Promise<EdicaoCorretivaResultado> {
  const d = resolveDeps(deps);

  const processo = (await d.prisma.processo.findUnique({
    where: { id: processoId },
    select: {
      id: true,
      protocolo: true,
      prioridade: true,
      respostas: { select: { id: true, campoId: true, valor: true } },
    },
  })) as ProcessoParaEdicaoRow | null;

  if (!processo) {
    throw notFound(ErrorCodes.PROCESSO_NAO_ENCONTRADO, MENSAGEM_PROCESSO_NAO_ENCONTRADO);
  }

  // Diff campo a campo — cada entrada guarda o rótulo do campo e os valores
  // anterior/posterior para auditoria (Req 24.5).
  interface AlteracaoCampo {
    campo: string;
    valorAnterior: unknown;
    valorPosterior: unknown;
    aplicar: (tx: PrismaClient) => Promise<unknown>;
  }
  const alteracoes: AlteracaoCampo[] = [];

  // Campo simples do Processo: prioridade.
  if (input.prioridade !== undefined && input.prioridade !== processo.prioridade) {
    const anterior = processo.prioridade;
    const posterior = input.prioridade;
    alteracoes.push({
      campo: 'prioridade',
      valorAnterior: anterior,
      valorPosterior: posterior,
      aplicar: (tx) =>
        tx.processo.update({
          where: { id: processoId },
          data: { prioridade: posterior },
        }),
    });
  }

  // Respostas do Formulário_Dinâmico: só corrige respostas já existentes.
  const respostasPorCampo = new Map(processo.respostas.map((r) => [r.campoId, r]));
  for (const correcao of input.respostas ?? []) {
    const atual = respostasPorCampo.get(correcao.campoId);
    if (!atual || atual.valor === correcao.valor) continue;
    const anterior = atual.valor;
    const posterior = correcao.valor;
    alteracoes.push({
      campo: `resposta:${correcao.campoId}`,
      valorAnterior: anterior,
      valorPosterior: posterior,
      aplicar: (tx) =>
        tx.respostaFormulario.update({
          where: { id: atual.id },
          data: { valor: posterior },
        }),
    });
  }

  // Nada mudou: não abre transação nem registra auditoria.
  if (alteracoes.length === 0) {
    return {
      protocolo: processo.protocolo,
      prioridade: processo.prioridade,
      camposAlterados: [],
    };
  }

  try {
    await d.prisma.$transaction(async (tx) => {
      const txClient = tx as unknown as PrismaClient;

      for (const alt of alteracoes) {
        await alt.aplicar(txClient);

        // Um registro de auditoria por campo alterado (Req 24.5). É o único
        // ponto que lança dentro da transação — falha ⇒ rollback (Req 24.7).
        await d.registrarSync(
          {
            tipoAcao: 'editar_processo',
            modulo: MODULO,
            objetoId: processoId,
            tipoObjeto: 'Processo',
            ator: 'servidor',
            atorServidorId: servidorId,
            enderecoIp,
            valorAnterior: { campo: alt.campo, valor: alt.valorAnterior },
            valorPosterior: { campo: alt.campo, valor: alt.valorPosterior },
          },
          tx,
        );
      }
    });
  } catch (err) {
    // Falha da transação decorre do único ponto que lança dentro dela: o
    // registro de auditoria. A alteração NÃO é persistida (Req 24.7).
    if (err instanceof AppError) throw err;
    throw new AppError(500, ErrorCodes.AUDITORIA_FALHA, MENSAGEM_AUDITORIA_FALHA);
  }

  const prioridadeFinal =
    input.prioridade !== undefined ? input.prioridade : processo.prioridade;

  return {
    protocolo: processo.protocolo,
    prioridade: prioridadeFinal,
    camposAlterados: alteracoes.map((a) => a.campo),
  };
}

// ---------------------------------------------------------------------------
// Resumo de retorno das ações de tramitação
// ---------------------------------------------------------------------------

/** Resumo do Processo retornado após uma ação de tramitação. */
export interface ProcessoTramitacaoResumo {
  protocolo: string;
  status: string;
  etapaAtualId: string | null;
}

// ---------------------------------------------------------------------------
// POST /:id/avancar-etapa (Req 11.2, 11.3, 11.9)
// ---------------------------------------------------------------------------

/** Formato crú do Processo carregado para o avanço de etapa. */
interface ProcessoParaAvancoRow {
  etapaAtualId: string | null;
  fluxoVersaoId: string;
  cidadaoId: string;
  status: string;
}

/**
 * Avança o Processo para a próxima Etapa do Fluxo, ou o finaliza (aprova)
 * quando a Etapa atual é a última (Req 11.2, 11.3, 11.9).
 *
 * Regras:
 * 1. 404 quando o Processo não existe.
 * 2. 400 `PROCESSO_ENCERRADO` quando o Processo já está em status terminal.
 * 3. Bloqueia o avanço (400 `DOCUMENTOS_PENDENTES`) se houver documentos
 *    obrigatórios pendentes (Req 11.3) — atualmente sempre lista vazia, ver
 *    `listarDocumentosPendentes`.
 * 4. Avanço normal: atualiza a etapa atual e cria a movimentação.
 * 5. Finalização (última etapa): exige `podeAprovar` (Req 11.7 por analogia);
 *    quando falso, 403 `INSUFFICIENT_PERMISSIONS`. Quando permitido, aprova o
 *    Processo (status `aprovado`, `encerradoEm` preenchido).
 *
 * O UPDATE do Processo, a criação da Movimentacao e o registro em auditoria
 * ocorrem na MESMA transação. Como o único ponto que lança dentro da
 * transação (em produção e nos testes) é `registrarSync`, uma rejeição da
 * transação é mapeada para 500 `AUDITORIA_FALHA` e a transação é revertida
 * automaticamente (Req 11.9).
 *
 * @param podeAprovar Resultado de `hasPermission(user, APROVAR)`, computado no
 *   controller (o serviço não acessa `req.user`).
 * @throws {AppError} 404 / 400 `PROCESSO_ENCERRADO` / 400 `DOCUMENTOS_PENDENTES`
 *   / 403 `INSUFFICIENT_PERMISSIONS` / 500 `AUDITORIA_FALHA`.
 */
export async function avancarEtapa(
  processoId: string,
  servidorId: string,
  enderecoIp: string,
  podeAprovar: boolean,
  observacao?: string,
  deps?: Partial<TramitacaoDeps>,
): Promise<ProcessoTramitacaoResumo> {
  const d = resolveDeps(deps);

  const processo = (await d.prisma.processo.findUnique({
    where: { id: processoId },
    select: { etapaAtualId: true, fluxoVersaoId: true, cidadaoId: true, status: true },
  })) as ProcessoParaAvancoRow | null;

  if (!processo) {
    throw notFound(ErrorCodes.PROCESSO_NAO_ENCONTRADO, MENSAGEM_PROCESSO_NAO_ENCONTRADO);
  }

  if (STATUS_ENCERRADOS.includes(processo.status)) {
    throw badRequest(ErrorCodes.PROCESSO_ENCERRADO, MENSAGEM_PROCESSO_ENCERRADO);
  }

  const etapas = (await d.prisma.etapa.findMany({
    where: { fluxoId: processo.fluxoVersaoId },
    orderBy: { ordem: 'asc' },
    select: { id: true, nome: true, prazosDiasUteis: true, ordem: true },
  })) as EtapaOrdenada[];

  const indiceAtual = etapas.findIndex((e) => e.id === processo.etapaAtualId);
  if (indiceAtual === -1) {
    // Integridade de dados: etapa atual não pertence ao fluxo do Processo.
    throw badRequest(
      ErrorCodes.VALIDATION_ERROR,
      'Não foi possível localizar a etapa atual do processo no fluxo configurado',
    );
  }

  const etapaAtual = etapas[indiceAtual];

  // Req 11.3 — documentos obrigatórios pendentes bloqueiam o avanço.
  const pendentes = listarDocumentosPendentes(etapaAtual);
  if (pendentes.length > 0) {
    throw badRequest(
      ErrorCodes.DOCUMENTOS_PENDENTES,
      `Documentos obrigatórios pendentes: ${pendentes.join(', ')}`,
    );
  }

  const proximaEtapa = etapas[indiceAtual + 1] ?? null;

  // Finalização (última etapa) exige permissão de aprovação (Req 11.7 por analogia).
  if (!proximaEtapa && !podeAprovar) {
    throw new AppError(
      403,
      ErrorCodes.INSUFFICIENT_PERMISSIONS,
      MENSAGEM_SEM_PERMISSAO_APROVAR,
    );
  }

  const ehFinalizacao = !proximaEtapa;

  let atualizado: ProcessoTramitacaoResumo;
  try {
    atualizado = await d.prisma.$transaction(async (tx) => {
      const txClient = tx as unknown as PrismaClient;

      const processoAtualizado = ehFinalizacao
        ? await txClient.processo.update({
            where: { id: processoId },
            data: { status: StatusProcesso.APROVADO, encerradoEm: new Date() },
            select: { protocolo: true, status: true, etapaAtualId: true },
          })
        : await txClient.processo.update({
            where: { id: processoId },
            data: { etapaAtualId: proximaEtapa!.id, status: StatusProcesso.EM_ANDAMENTO },
            select: { protocolo: true, status: true, etapaAtualId: true },
          });

      await txClient.movimentacaoProcesso.create({
        data: {
          processoId,
          etapaOrigemId: etapaAtual.id,
          etapaDestinoId: ehFinalizacao ? null : proximaEtapa!.id,
          servidorId,
          observacao: observacao ?? null,
          tipoObservacao: null,
        },
      });

      // Único ponto que pode lançar dentro da transação — ver Req 11.9.
      await d.registrarSync(
        {
          tipoAcao: ehFinalizacao ? 'aprovar_processo' : 'avancar_etapa',
          modulo: MODULO,
          objetoId: processoId,
          tipoObjeto: 'Processo',
          ator: 'servidor',
          atorServidorId: servidorId,
          enderecoIp,
          valorAnterior: { etapaId: etapaAtual.id },
          valorPosterior: ehFinalizacao
            ? { status: StatusProcesso.APROVADO }
            : { etapaId: proximaEtapa!.id },
        },
        tx,
      );

      return processoAtualizado as ProcessoTramitacaoResumo;
    });
  } catch (err) {
    // Uma falha da transação decorre do único ponto que lança dentro dela: o
    // registro de auditoria. Nesse caso a transação já foi revertida (Req 11.9).
    if (err instanceof AppError) throw err;
    throw new AppError(500, ErrorCodes.AUDITORIA_FALHA, MENSAGEM_AUDITORIA_FALHA);
  }

  // Notificação ao Cidadão + emissão em tempo real, ambas fire-and-forget.
  fireAndForget(
    () =>
      d.notificar({
        tipo: 'painel',
        destinatario: { cidadaoId: processo.cidadaoId },
        tipoEvento: TipoEvento.MOVIMENTACAO_ETAPA,
        conteudo: proximaEtapa ? proximaEtapa.nome : 'aprovado',
        processoId,
      }),
    'notificar_avanco_etapa_falhou',
  );

  if (ehFinalizacao) {
    emitSeguro(`processo:${processoId}`, 'processo:status_atualizado', {
      processoId,
      novoStatus: 'aprovado',
    });
  } else {
    emitSeguro(`processo:${processoId}`, 'processo:etapa_avancada', {
      processoId,
      etapaDestino: proximaEtapa?.id ?? null,
    });
  }

  return atualizado;
}

// ---------------------------------------------------------------------------
// POST /:id/rejeitar (Req 11.7)
// ---------------------------------------------------------------------------

/** Formato crú do Processo carregado para rejeição/solicitação de documentos. */
interface ProcessoParaEncerramentoRow {
  etapaAtualId: string | null;
  cidadaoId: string;
  status: string;
}

/**
 * Rejeita o Processo (Req 11.7). A checagem de permissão `REJEITAR` (com a
 * mensagem orientativa customizada) é feita no controller — este serviço
 * assume que ela já passou.
 *
 * 404 quando o Processo não existe; 400 `PROCESSO_ENCERRADO` quando já
 * encerrado. A atualização de status, a movimentação e a auditoria ocorrem na
 * mesma transação, com rollback→500 `AUDITORIA_FALHA` (Req 11.9).
 */
export async function rejeitar(
  processoId: string,
  servidorId: string,
  enderecoIp: string,
  motivo: string,
  deps?: Partial<TramitacaoDeps>,
): Promise<ProcessoTramitacaoResumo> {
  const d = resolveDeps(deps);

  const processo = (await d.prisma.processo.findUnique({
    where: { id: processoId },
    select: { etapaAtualId: true, cidadaoId: true, status: true },
  })) as ProcessoParaEncerramentoRow | null;

  if (!processo) {
    throw notFound(ErrorCodes.PROCESSO_NAO_ENCONTRADO, MENSAGEM_PROCESSO_NAO_ENCONTRADO);
  }

  if (STATUS_ENCERRADOS.includes(processo.status)) {
    throw badRequest(ErrorCodes.PROCESSO_ENCERRADO, MENSAGEM_PROCESSO_ENCERRADO);
  }

  let atualizado: ProcessoTramitacaoResumo;
  try {
    atualizado = await d.prisma.$transaction(async (tx) => {
      const txClient = tx as unknown as PrismaClient;

      const processoAtualizado = await txClient.processo.update({
        where: { id: processoId },
        data: { status: StatusProcesso.REJEITADO, encerradoEm: new Date() },
        select: { protocolo: true, status: true, etapaAtualId: true },
      });

      await txClient.movimentacaoProcesso.create({
        data: {
          processoId,
          etapaOrigemId: processo.etapaAtualId,
          etapaDestinoId: null,
          servidorId,
          observacao: motivo,
          tipoObservacao: null,
        },
      });

      await d.registrarSync(
        {
          tipoAcao: 'rejeitar_processo',
          modulo: MODULO,
          objetoId: processoId,
          tipoObjeto: 'Processo',
          ator: 'servidor',
          atorServidorId: servidorId,
          enderecoIp,
          valorAnterior: { status: processo.status },
          valorPosterior: { status: StatusProcesso.REJEITADO },
        },
        tx,
      );

      return processoAtualizado as ProcessoTramitacaoResumo;
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, ErrorCodes.AUDITORIA_FALHA, MENSAGEM_AUDITORIA_FALHA);
  }

  fireAndForget(
    () =>
      d.notificar({
        tipo: 'painel',
        destinatario: { cidadaoId: processo.cidadaoId },
        tipoEvento: TipoEvento.REJEICAO,
        conteudo: motivo,
        processoId,
      }),
    'notificar_rejeicao_falhou',
  );

  emitSeguro(`processo:${processoId}`, 'processo:status_atualizado', {
    processoId,
    novoStatus: 'rejeitado',
  });

  return atualizado;
}

// ---------------------------------------------------------------------------
// POST /:id/solicitar-documentos (Req 11.6)
// ---------------------------------------------------------------------------

/**
 * Solicita documentos adicionais ao Cidadão (Req 11.6): altera o status para
 * "Aguardando Documentos", registra a movimentação com a lista solicitada e
 * notifica o Cidadão. Transação com rollback→500 `AUDITORIA_FALHA` (Req 11.9).
 *
 * 404 quando o Processo não existe; 400 `PROCESSO_ENCERRADO` quando já
 * encerrado.
 */
export async function solicitarDocumentos(
  processoId: string,
  servidorId: string,
  enderecoIp: string,
  documentos: string[],
  deps?: Partial<TramitacaoDeps>,
): Promise<ProcessoTramitacaoResumo> {
  const d = resolveDeps(deps);

  const processo = (await d.prisma.processo.findUnique({
    where: { id: processoId },
    select: { etapaAtualId: true, cidadaoId: true, status: true },
  })) as ProcessoParaEncerramentoRow | null;

  if (!processo) {
    throw notFound(ErrorCodes.PROCESSO_NAO_ENCONTRADO, MENSAGEM_PROCESSO_NAO_ENCONTRADO);
  }

  if (STATUS_ENCERRADOS.includes(processo.status)) {
    throw badRequest(ErrorCodes.PROCESSO_ENCERRADO, MENSAGEM_PROCESSO_ENCERRADO);
  }

  const listaDocs = documentos.join(', ');

  let atualizado: ProcessoTramitacaoResumo;
  try {
    atualizado = await d.prisma.$transaction(async (tx) => {
      const txClient = tx as unknown as PrismaClient;

      const processoAtualizado = await txClient.processo.update({
        where: { id: processoId },
        data: { status: StatusProcesso.AGUARDANDO_DOCS },
        select: { protocolo: true, status: true, etapaAtualId: true },
      });

      await txClient.movimentacaoProcesso.create({
        data: {
          processoId,
          etapaOrigemId: processo.etapaAtualId,
          etapaDestinoId: processo.etapaAtualId,
          servidorId,
          observacao: `${PREFIXO_DOCS_SOLICITADOS}${listaDocs}`,
          tipoObservacao: null,
        },
      });

      await d.registrarSync(
        {
          tipoAcao: 'solicitar_documentos',
          modulo: MODULO,
          objetoId: processoId,
          tipoObjeto: 'Processo',
          ator: 'servidor',
          atorServidorId: servidorId,
          enderecoIp,
          valorAnterior: { status: processo.status },
          valorPosterior: { documentos },
        },
        tx,
      );

      return processoAtualizado as ProcessoTramitacaoResumo;
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, ErrorCodes.AUDITORIA_FALHA, MENSAGEM_AUDITORIA_FALHA);
  }

  fireAndForget(
    () =>
      d.notificar({
        tipo: 'painel',
        destinatario: { cidadaoId: processo.cidadaoId },
        tipoEvento: TipoEvento.SOLICITACAO_DOCUMENTOS,
        conteudo: listaDocs,
        processoId,
      }),
    'notificar_solicitacao_documentos_falhou',
  );

  emitSeguro(`processo:${processoId}`, 'processo:status_atualizado', {
    processoId,
    novoStatus: 'aguardando_docs',
  });

  return atualizado;
}

// ---------------------------------------------------------------------------
// POST /:id/observacoes (Req 11.4, 11.5)
// ---------------------------------------------------------------------------

/** Formato crú retornado ao criar uma observação. */
export interface ObservacaoCriada {
  id: string;
  processoId: string;
  observacao: string | null;
  tipoObservacao: string | null;
  realizadoEm: Date;
}

/**
 * Registra uma observação interna ou pública no Processo (Req 11.4, 11.5). A
 * checagem de permissão (`OBSERVACAO_INTERNA`/`OBSERVACAO_PUBLICA`) é feita no
 * controller conforme o `tipo` — este serviço assume que já passou.
 *
 * Não há transação nem bloqueio por status encerrado (Req 11.4/11.5 não
 * restringem isso): a Movimentacao é criada diretamente e a auditoria usa o
 * `registrar` assíncrono (nunca lança). Nenhuma notificação é disparada.
 *
 * @throws {AppError} 404 — Processo inexistente.
 */
export async function registrarObservacao(
  processoId: string,
  servidorId: string,
  enderecoIp: string,
  tipo: 'interna' | 'publica',
  conteudo: string,
  deps?: Partial<TramitacaoDeps>,
): Promise<ObservacaoCriada> {
  const d = resolveDeps(deps);

  const processo = await d.prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true },
  });

  if (!processo) {
    throw notFound(ErrorCodes.PROCESSO_NAO_ENCONTRADO, MENSAGEM_PROCESSO_NAO_ENCONTRADO);
  }

  const movimentacao = (await d.prisma.movimentacaoProcesso.create({
    data: {
      processoId,
      etapaOrigemId: null,
      etapaDestinoId: null,
      servidorId,
      observacao: conteudo,
      tipoObservacao: tipo,
    },
    select: {
      id: true,
      processoId: true,
      observacao: true,
      tipoObservacao: true,
      realizadoEm: true,
    },
  })) as ObservacaoCriada;

  await d.registrar({
    tipoAcao: `registrar_observacao_${tipo}`,
    modulo: MODULO,
    objetoId: processoId,
    tipoObjeto: 'Processo',
    ator: 'servidor',
    atorServidorId: servidorId,
    enderecoIp,
    valorPosterior: { tipo },
  });

  return movimentacao;
}
