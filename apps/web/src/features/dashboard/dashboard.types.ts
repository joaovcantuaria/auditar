import type { NivelAcesso, StatusProcesso } from '@auditar/shared';

/**
 * Tipos das respostas dos dashboards por perfil, espelhando EXATAMENTE as
 * interfaces do backend (`apps/api/src/modules/dashboard/dashboard.service.ts`,
 * Task 10.1, Requisito 9). Os nomes de campo aqui são cópias fiéis das
 * respostas JSON de cada endpoint sob `GET /api/v1/admin/dashboard/*`.
 *
 * Cada indicador vem embrulhado em {@link Indicador}: em caso de falha isolada
 * de um indicador o backend devolve `{ value: null, erro: true }`, permitindo
 * que o restante do dashboard continue exibindo dados (Req 9.6).
 */

// ---------------------------------------------------------------------------
// Envelope por indicador (Req 9.6)
// ---------------------------------------------------------------------------

/** Envelope de um indicador: valor calculado OU sentinela de erro. */
export interface Indicador<T> {
  value: T | null;
  erro: boolean;
}

// ---------------------------------------------------------------------------
// Tipos de agregação (espelham dashboard.service.ts)
// ---------------------------------------------------------------------------

/** Contagem por status: `{ [status]: total }`. As chaves são valores de StatusProcesso. */
export type PorStatus = Record<string, number>;

/** Item de série diária: `dia` (YYYY-MM-DD) + `total`. */
export interface SerieDia {
  dia: string;
  total: number;
}

/** Item de série semanal: `semana` (YYYY-Wnn) + `total`. */
export interface SerieSemana {
  semana: string;
  total: number;
}

/** Taxas de aprovação/rejeição em porcentagem sobre os processos encerrados. */
export interface TaxaAprovacaoRejeicao {
  aprovados: number;
  rejeitados: number;
  taxaAprovacao: number;
  taxaRejeicao: number;
}

/** Carga (processos ativos) por servidor da unidade. */
export interface CargaServidor {
  servidorId: string;
  nome: string;
  ativos: number;
}

/** Totais por status agrupados por uma dimensão (unidade/categoria). */
export interface GrupoDimensao {
  id: string;
  nome: string;
  porStatus: PorStatus;
}

/** Tempo médio de resolução por tipo de processo. */
export interface TempoMedioPorTipo {
  tipoProcessoId: string;
  nome: string;
  horas: number;
}

/** Comparação de dois períodos consecutivos de mesma duração. */
export interface ComparacaoPeriodos {
  periodoAtual: number;
  periodoAnterior: number;
  variacaoPercentual: number;
}

// ---------------------------------------------------------------------------
// Respostas por perfil (Req 9.1 – 9.4)
// ---------------------------------------------------------------------------

/** Resposta de `GET /admin/dashboard/analista` (Req 9.1). */
export interface DashboardAnalista {
  porStatus: Indicador<PorStatus>;
  vencendoEm24h: Indicador<number>;
  tempoMedioResolucaoHoras: Indicador<number>;
  produtividadeDiaria: Indicador<SerieDia[]>;
}

/** Resposta de `GET /admin/dashboard/gestor-unidade` (Req 9.2). */
export interface DashboardGestorUnidade {
  porStatus: Indicador<PorStatus>;
  cargaPorServidor: Indicador<CargaServidor[]>;
  taxaAprovacaoRejeicao: Indicador<TaxaAprovacaoRejeicao>;
  volumeDiario: Indicador<SerieDia[]>;
}

/** Resposta de `GET /admin/dashboard/gestor-categoria` (Req 9.3). */
export interface DashboardGestorCategoria {
  porStatusPorUnidade: Indicador<GrupoDimensao[]>;
  tempoMedioPorTipo: Indicador<TempoMedioPorTipo[]>;
  comparacaoUnidades: Indicador<GrupoDimensao[]>;
}

/** Resposta de `GET /admin/dashboard/gestor-geral` (Req 9.4). */
export interface DashboardGestorGeral {
  porStatusPorCategoria: Indicador<GrupoDimensao[]>;
  volumeSemanal: Indicador<SerieSemana[]>;
  comparacaoPeriodos: Indicador<ComparacaoPeriodos>;
}

// ---------------------------------------------------------------------------
// Seleção de perfil → endpoint
// ---------------------------------------------------------------------------

/** Perfis de dashboard que o frontend sabe renderizar. */
export type DashboardPerfil =
  | 'analista'
  | 'gestor-unidade'
  | 'gestor-categoria'
  | 'gestor-geral';

/**
 * Mapeia o `NivelAcesso` do servidor logado ao perfil de dashboard a exibir.
 * Administrador (1) e Gestor Geral (2) veem a visão geral. Níveis sem dashboard
 * dedicado (Inspetor 6, Visualizador 7) recaem para a visão geral também,
 * já que o acesso ao endpoint é controlado pelo RBAC no backend.
 */
export function perfilPorNivel(nivel: NivelAcesso | undefined): DashboardPerfil {
  switch (nivel) {
    case 5: // ANALISTA
      return 'analista';
    case 4: // GESTOR_UNIDADE
      return 'gestor-unidade';
    case 3: // GESTOR_CATEGORIA
      return 'gestor-categoria';
    case 1: // ADMINISTRADOR
    case 2: // GESTOR_GERAL
    default:
      return 'gestor-geral';
  }
}

/** Caminho do endpoint (relativo ao baseURL `/api/v1`) por perfil. */
export const DASHBOARD_ENDPOINT: Record<DashboardPerfil, string> = {
  analista: '/admin/dashboard/analista',
  'gestor-unidade': '/admin/dashboard/gestor-unidade',
  'gestor-categoria': '/admin/dashboard/gestor-categoria',
  'gestor-geral': '/admin/dashboard/gestor-geral',
};

/** Chaves de StatusProcesso conhecidas, para iterar em ordem estável nos gráficos. */
export const STATUS_KEYS: StatusProcesso[] = [
  'aberto',
  'em_andamento',
  'aguardando_docs',
  'aguardando_cidadao',
  'vencido',
  'aprovado',
  'rejeitado',
  'finalizado',
] as unknown as StatusProcesso[];
