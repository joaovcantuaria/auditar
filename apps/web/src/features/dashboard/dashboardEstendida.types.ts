import type { Indicador } from './dashboard.types';

/**
 * Tipos e contrato de API da Dashboard Estendida (Tasks 27.1 e 27.2, Req 9.7–9.12).
 *
 * Os nomes de campo aqui espelham EXATAMENTE as interfaces do backend em
 * `apps/api/src/modules/dashboard/dashboard.service.ts`:
 *  - {@link CardsResumo}        ← interface `CardsResumo`      (camelCase)
 *  - {@link IndicadorPrazos}    ← interface `IndicadorPrazos`
 *  - {@link DashboardResumo}    ← interface `DashboardResumo`  (`{ cards, prazos }`)
 *  - {@link DesempenhoServidor} ← interface `DesempenhoServidor`
 *
 * Endpoints (relativos ao baseURL `/api/v1`):
 *  - `GET /admin/dashboard/resumo?unidadeId=&categoriaId=&de=&ate=`
 *  - `GET /admin/dashboard/desempenho-equipe?ordenarPor=&unidadeId=&categoriaId=&de=&ate=`
 *
 * O escopo RBAC (Gestor_de_Unidade → sua Unidade; Administrador → todas) é
 * resolvido inteiramente no backend a partir do JWT; o frontend apenas envia os
 * filtros opcionais.
 */

// ---------------------------------------------------------------------------
// Resumo — cards de contagem (Req 9.7)
// ---------------------------------------------------------------------------

/** Cards de contagem por situação — espelha `CardsResumo` do backend. */
export interface CardsResumo {
  total: number;
  abertos: number;
  emAndamento: number;
  aguardandoDocs: number;
  atrasados: number;
  aprovados: number;
  finalizados: number;
  rejeitados: number;
}

// ---------------------------------------------------------------------------
// Resumo — indicador de prazos (Req 9.8)
// ---------------------------------------------------------------------------

/** Identificação enxuta de um Processo no indicador de prazos. */
export interface ProcessoPrazo {
  id: string;
  protocolo: string;
  /** Data/hora de vencimento em ISO 8601 (UTC). */
  prazoFinal: string;
}

/** Grupo de prazos (quantidade + lista de processos). */
export interface GrupoPrazo {
  quantidade: number;
  processos: ProcessoPrazo[];
}

/** Indicador de prazos: vencendo em ≤3 dias úteis e vencidos. */
export interface IndicadorPrazos {
  vencendo: GrupoPrazo;
  vencidos: GrupoPrazo;
}

/** Resposta de `GET /admin/dashboard/resumo`. */
export interface DashboardResumo {
  cards: Indicador<CardsResumo>;
  prazos: Indicador<IndicadorPrazos>;
}

// ---------------------------------------------------------------------------
// Desempenho da equipe (Req 9.9, 9.10)
// ---------------------------------------------------------------------------

/** Indicadores de desempenho de um Servidor — espelha `DesempenhoServidor`. */
export interface DesempenhoServidor {
  servidorId: string;
  nome: string;
  atribuidos: number;
  emAndamento: number;
  concluidos: number;
  atrasados: number;
  tempoMedioConclusaoHoras: number;
  tarefasPendentes: number;
}

/** Campos ordenáveis do Painel de Desempenho — espelha `OrdenarDesempenhoPor`. */
export type OrdenarDesempenhoPor =
  | 'nome'
  | 'atribuidos'
  | 'emAndamento'
  | 'concluidos'
  | 'atrasados'
  | 'tempoMedioConclusaoHoras'
  | 'tarefasPendentes';

/**
 * Resposta de `GET /admin/dashboard/desempenho-equipe`: um Indicador embrulhando
 * o array de linhas (o backend devolve `Indicador<DesempenhoServidor[]>`).
 */
export type DesempenhoEquipeResposta = Indicador<DesempenhoServidor[]>;

// ---------------------------------------------------------------------------
// Filtros combináveis (Req 9.11)
// ---------------------------------------------------------------------------

/**
 * Estado dos filtros combináveis do Dashboard estendido. Todos opcionais; as
 * datas usam o formato `YYYY-MM-DD` do input nativo `<input type="date">`.
 */
export interface FiltrosDashboardEstado {
  unidadeId?: string;
  categoriaId?: string;
  de?: string;
  ate?: string;
}

/** Endpoints da Dashboard estendida (relativos ao baseURL `/api/v1`). */
export const DASHBOARD_RESUMO_ENDPOINT = '/admin/dashboard/resumo';
export const DASHBOARD_DESEMPENHO_ENDPOINT = '/admin/dashboard/desempenho-equipe';

/**
 * Converte o estado dos filtros nos params aceitos pela API, omitindo os vazios
 * (o backend só aplica os presentes). Reutilizado por ambos os endpoints.
 */
export function filtrosParaParams(
  filtros: FiltrosDashboardEstado,
): Record<string, string> {
  const params: Record<string, string> = {};
  if (filtros.unidadeId) params.unidadeId = filtros.unidadeId;
  if (filtros.categoriaId) params.categoriaId = filtros.categoriaId;
  if (filtros.de) params.de = filtros.de;
  if (filtros.ate) params.ate = filtros.ate;
  return params;
}
