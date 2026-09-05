import { StatusTarefa } from '@auditar/shared';
import { axiosInstance } from '@/lib/axiosInstance';

/**
 * Cliente de API + tipos do Organizador de Tarefas (Req. 27).
 *
 * Os nomes de campo espelham EXATAMENTE os contratos do backend em
 * `apps/api/src/modules/tarefas/` (router/controller/service) e os tipos de
 * `packages/shared` (`Tarefa`, `TarefaAtribuicao`, enum `StatusTarefa`).
 *
 * Endpoints (relativos ao baseURL `/api/v1`):
 *  - `POST   /admin/tarefas`                      cria a Tarefa + atribuições
 *  - `GET    /admin/tarefas?status=&prazoDe=&prazoAte=&processoId=`  lista
 *  - `GET    /admin/tarefas/minhas`               atribuições agrupadas por status
 *  - `GET    /admin/tarefas/:id`                  detalhe
 *  - `PATCH  /admin/tarefas/:id`                  edição
 *  - `DELETE /admin/tarefas/:id`                  remoção
 *  - `PATCH  /admin/tarefas/:id/atribuicoes/minha` muda status da própria atribuição
 */

/** Identificação enxuta do Processo vinculado (para exibição/navegação). */
export interface ProcessoVinculado {
  id: string;
  protocolo: string;
}

/** Atribuição de uma Tarefa a um Servidor — espelha `TarefaAtribuicao`. */
export interface TarefaAtribuicaoItem {
  id: string;
  tarefaId: string;
  servidorId: string;
  status: StatusTarefa;
  concluidaEm?: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

/** Tarefa retornada pela listagem/detalhe — inclui atribuições e Processo. */
export interface TarefaItem {
  id: string;
  titulo: string;
  descricao?: string | null;
  status: StatusTarefa;
  prioridade?: number | null;
  criadoPorId: string;
  processoId?: string | null;
  prazo: string;
  criadoEm: string;
  atualizadoEm: string;
  atribuicoes?: TarefaAtribuicaoItem[];
  processo?: ProcessoVinculado | null;
}

/**
 * Item de "Minhas Tarefas": uma `TarefaAtribuicao` com a Tarefa aninhada
 * (que por sua vez traz o Processo vinculado). Corresponde ao retorno de
 * `GET /admin/tarefas/minhas` (agrupado por status).
 */
export interface MinhaAtribuicaoItem extends TarefaAtribuicaoItem {
  tarefa: TarefaItem & { processo?: ProcessoVinculado | null };
}

/** Agrupamento por status devolvido por `GET /admin/tarefas/minhas`. */
export interface MinhasTarefasAgrupadas {
  pendente: MinhaAtribuicaoItem[];
  em_andamento: MinhaAtribuicaoItem[];
  concluida: MinhaAtribuicaoItem[];
}

/** Payload de criação (mesmos campos aceitos pelo controller). */
export interface CriarTarefaPayload {
  titulo: string;
  descricao?: string;
  /** Data/hora em ISO 8601 (futuro). */
  prazo: string;
  prioridade?: number;
  processoId?: string;
  destinatarios?: string[];
  todos?: boolean;
}

/** Filtros aceitos por `GET /admin/tarefas`. */
export interface FiltrosTarefa {
  status?: StatusTarefa;
  /** Data inicial do intervalo de prazo (ISO). */
  prazoDe?: string;
  /** Data final do intervalo de prazo (ISO). */
  prazoAte?: string;
  processoId?: string;
}

const BASE = '/admin/tarefas';

/** Cria uma Tarefa e distribui as atribuições (Req. 27.1-27.5). */
export async function criarTarefa(payload: CriarTarefaPayload): Promise<{
  tarefa: TarefaItem;
  atribuicoes: TarefaAtribuicaoItem[];
}> {
  const { data } = await axiosInstance.post(BASE, payload);
  return data;
}

/** Lista Tarefas com filtros opcionais (Req. 27.10, 27.11). */
export async function listarTarefas(filtros: FiltrosTarefa = {}): Promise<TarefaItem[]> {
  const params: Record<string, string> = {};
  if (filtros.status) params.status = filtros.status;
  if (filtros.prazoDe) params.prazoDe = filtros.prazoDe;
  if (filtros.prazoAte) params.prazoAte = filtros.prazoAte;
  if (filtros.processoId) params.processoId = filtros.processoId;
  const { data } = await axiosInstance.get<TarefaItem[]>(BASE, { params });
  return data;
}

/** Atribuições do servidor autenticado, agrupadas por status (Req. 27.6). */
export async function listarMinhasTarefas(): Promise<MinhasTarefasAgrupadas> {
  const { data } = await axiosInstance.get<MinhasTarefasAgrupadas>(`${BASE}/minhas`);
  return data;
}

/** Remove uma Tarefa (Req. 27.1). */
export async function removerTarefa(id: string): Promise<{ id: string }> {
  const { data } = await axiosInstance.delete<{ id: string }>(`${BASE}/${id}`);
  return data;
}

/** Altera o status APENAS da própria atribuição (Req. 27.7). */
export async function alterarStatusMinhaAtribuicao(
  tarefaId: string,
  status: StatusTarefa,
): Promise<TarefaAtribuicaoItem> {
  const { data } = await axiosInstance.patch<TarefaAtribuicaoItem>(
    `${BASE}/${tarefaId}/atribuicoes/minha`,
    { status },
  );
  return data;
}

// ---------------------------------------------------------------------------
// Servidores (para o seletor de destinatários da criação — Req. 27.3)
// ---------------------------------------------------------------------------

/** Servidor enxuto para o seletor de destinatários. */
export interface ServidorOpcao {
  id: string;
  nome: string;
  ativo: boolean;
}

/**
 * Carrega os Servidores ATIVOS para o seletor de destinatários. Usa a listagem
 * paginada de `GET /admin/servidores` (retorna `PaginatedResult<Servidor>`),
 * solicitando uma página grande o suficiente para uma seleção prática.
 */
export async function listarServidoresAtivos(): Promise<ServidorOpcao[]> {
  const { data } = await axiosInstance.get<{
    data: Array<{ id: string; nome: string; ativo: boolean }>;
  }>('/admin/servidores', { params: { ativo: 'true', pageSize: 100, page: 1 } });
  return data.data.map((s) => ({ id: s.id, nome: s.nome, ativo: s.ativo }));
}

// ---------------------------------------------------------------------------
// Rótulos e utilidades compartilhadas
// ---------------------------------------------------------------------------

/** Rótulo humano por status de Tarefa/Atribuição. */
export const STATUS_TAREFA_LABEL: Record<StatusTarefa, string> = {
  [StatusTarefa.PENDENTE]: 'Pendente',
  [StatusTarefa.EM_ANDAMENTO]: 'Em andamento',
  [StatusTarefa.CONCLUIDA]: 'Concluída',
};

/** Ordem canônica dos status (para tabs/colunas). */
export const STATUS_TAREFA_ORDEM: StatusTarefa[] = [
  StatusTarefa.PENDENTE,
  StatusTarefa.EM_ANDAMENTO,
  StatusTarefa.CONCLUIDA,
];

/** Rótulo humano de prioridade (0=baixa, 1=média, 2=alta). */
export const PRIORIDADE_LABEL: Record<number, string> = {
  0: 'Baixa',
  1: 'Média',
  2: 'Alta',
};
