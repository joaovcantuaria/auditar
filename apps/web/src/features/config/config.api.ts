import { isAxiosError } from 'axios';
import type { Automacao, Categoria, Etapa, Fluxo, TipoProcesso, Unidade } from '@auditar/shared';
import { axiosInstance } from '@/lib/axiosInstance';

/**
 * Camada de acesso à API para as Configurações Administrativas
 * (Categorias, Tipos de Processo e Unidades).
 *
 * A baseURL do axios já inclui `/api/v1`, portanto os caminhos abaixo são
 * relativos. Os três CRUDs estão montados sob `/admin/config/*` no backend:
 *
 *  - Categorias:      `GET/POST /admin/config/categorias`,
 *                     `PATCH/DELETE /admin/config/categorias/:id`
 *  - Tipos:           `GET/POST /admin/config/tipos-processo`,
 *                     `PATCH/DELETE /admin/config/tipos-processo/:id`
 *  - Unidades:        `GET/POST /admin/config/unidades`,
 *                     `PATCH/DELETE /admin/config/unidades/:id`
 *
 * A desativação usa `DELETE ...?confirmar=true`. Quando há Processos em
 * andamento e a confirmação está ausente, o backend responde 409 com a
 * contagem de impactados (Req. 14.6):
 *  - Categorias:  `{ precisaConfirmacao: true, processosImpactados, message }`
 *  - Tipos:       `{ requerConfirmacao: true, processosImpactados }`
 *  - Unidades:    `{ requerConfirmacao: true, processosImpactados, mensagem }`
 *
 * _Requirements: 14.1–14.7_
 */

// ---------------------------------------------------------------------------
// Tipos de resposta / erro
// ---------------------------------------------------------------------------

/** Formato padrão de erro da API (`{ error, code, field? }`). */
export interface ApiError {
  error?: string;
  code?: string;
  field?: string;
}

/** Tipo de Processo com as Unidades atendentes já incluídas (relação). */
export interface TipoProcessoComUnidades extends TipoProcesso {
  unidades: Array<{ unidadeId: string }>;
}

/**
 * Resposta de uma tentativa de desativação. Quando `precisaConfirmacao` é
 * verdadeiro, nada foi persistido e `processosImpactados` traz a contagem a
 * ser confirmada pelo usuário (Req. 14.6). Normaliza as variações de nome de
 * campo entre os três backends (`precisaConfirmacao`/`requerConfirmacao`).
 */
export interface ResultadoDesativacao {
  precisaConfirmacao: boolean;
  processosImpactados: number;
}

// ---------------------------------------------------------------------------
// Query keys (React Query)
// ---------------------------------------------------------------------------

export const configQueryKeys = {
  categorias: ['admin', 'config', 'categorias'] as const,
  tipos: (categoriaId?: string) =>
    ['admin', 'config', 'tipos-processo', categoriaId ?? 'todos'] as const,
  unidades: ['admin', 'config', 'unidades'] as const,
  fluxos: ['admin', 'config', 'fluxos'] as const,
  fluxo: (id: string) => ['admin', 'config', 'fluxos', id] as const,
};

// ---------------------------------------------------------------------------
// Helpers de erro
// ---------------------------------------------------------------------------

/** Extrai a mensagem amigável de erro de uma resposta da API. */
export function extrairMensagemErro(err: unknown, fallback: string): string {
  if (isAxiosError<ApiError>(err)) {
    return err.response?.data?.error ?? fallback;
  }
  return fallback;
}

/** Extrai o campo (`field`) associado a um erro de validação da API, se houver. */
export function extrairCampoErro(err: unknown): string | undefined {
  if (isAxiosError<ApiError>(err)) {
    return err.response?.data?.field;
  }
  return undefined;
}

/**
 * Normaliza a resposta 409 de desativação (que exige confirmação) em um
 * `ResultadoDesativacao`. Reconhece as três formas de payload usadas pelos
 * backends. Retorna `undefined` se o erro não for um 409 de confirmação.
 */
function parseConflitoDesativacao(err: unknown): ResultadoDesativacao | undefined {
  if (!isAxiosError(err) || err.response?.status !== 409) {
    return undefined;
  }
  const body = err.response.data as {
    precisaConfirmacao?: boolean;
    requerConfirmacao?: boolean;
    processosImpactados?: number;
  };
  const flag = body.precisaConfirmacao ?? body.requerConfirmacao;
  if (flag) {
    return {
      precisaConfirmacao: true,
      processosImpactados: body.processosImpactados ?? 0,
    };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

export interface CategoriaFormPayload {
  nome: string;
  descricao?: string;
  icone?: string;
  cor?: string;
  secretaria?: string;
  gestorId?: string;
}

export async function listarCategorias(): Promise<Categoria[]> {
  const { data } = await axiosInstance.get<{ data: Categoria[] }>(
    '/admin/config/categorias',
  );
  return data.data;
}

export async function criarCategoria(payload: CategoriaFormPayload): Promise<Categoria> {
  const { data } = await axiosInstance.post<Categoria>('/admin/config/categorias', payload);
  return data;
}

export async function editarCategoria(
  id: string,
  payload: CategoriaFormPayload,
): Promise<Categoria> {
  const { data } = await axiosInstance.patch<Categoria>(
    `/admin/config/categorias/${id}`,
    payload,
  );
  return data;
}

/**
 * Desativa uma Categoria. Se `confirmar` for falso e existirem Processos em
 * andamento, retorna `{ precisaConfirmacao: true, processosImpactados }` sem
 * lançar (Req. 14.6). Demais erros são propagados.
 */
export async function desativarCategoria(
  id: string,
  confirmar: boolean,
): Promise<ResultadoDesativacao> {
  try {
    await axiosInstance.delete(`/admin/config/categorias/${id}`, {
      params: confirmar ? { confirmar: 'true' } : undefined,
    });
    return { precisaConfirmacao: false, processosImpactados: 0 };
  } catch (err) {
    const conflito = parseConflitoDesativacao(err);
    if (conflito) return conflito;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Unidades
// ---------------------------------------------------------------------------

export interface UnidadeFormPayload {
  nome: string;
  secretaria: string;
  gestorId: string;
  endereco?: string;
  telefone?: string;
  horarioFuncionamento?: string;
  modoAtribuicao?: string;
}

export async function listarUnidades(): Promise<Unidade[]> {
  const { data } = await axiosInstance.get<{ data: Unidade[] }>('/admin/config/unidades');
  return data.data;
}

export async function criarUnidade(payload: UnidadeFormPayload): Promise<Unidade> {
  const { data } = await axiosInstance.post<Unidade>('/admin/config/unidades', payload);
  return data;
}

export async function editarUnidade(
  id: string,
  payload: UnidadeFormPayload,
): Promise<Unidade> {
  const { data } = await axiosInstance.patch<Unidade>(
    `/admin/config/unidades/${id}`,
    payload,
  );
  return data;
}

export async function desativarUnidade(
  id: string,
  confirmar: boolean,
): Promise<ResultadoDesativacao> {
  try {
    await axiosInstance.delete(`/admin/config/unidades/${id}`, {
      params: confirmar ? { confirmar: 'true' } : undefined,
    });
    return { precisaConfirmacao: false, processosImpactados: 0 };
  } catch (err) {
    const conflito = parseConflitoDesativacao(err);
    if (conflito) return conflito;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Tipos de Processo
// ---------------------------------------------------------------------------

export interface TipoFormPayload {
  nome: string;
  categoriaId: string;
  prazoTotalDiasUteis: number;
  unidadesIds: string[];
  fluxoId?: string;
}

export async function listarTipos(
  categoriaId?: string,
): Promise<TipoProcessoComUnidades[]> {
  const { data } = await axiosInstance.get<TipoProcessoComUnidades[]>(
    '/admin/config/tipos-processo',
    { params: categoriaId ? { categoriaId } : undefined },
  );
  return data;
}

export async function criarTipo(payload: TipoFormPayload): Promise<TipoProcessoComUnidades> {
  const { data } = await axiosInstance.post<TipoProcessoComUnidades>(
    '/admin/config/tipos-processo',
    payload,
  );
  return data;
}

export async function editarTipo(
  id: string,
  payload: Partial<TipoFormPayload>,
): Promise<TipoProcessoComUnidades> {
  const { data } = await axiosInstance.patch<TipoProcessoComUnidades>(
    `/admin/config/tipos-processo/${id}`,
    payload,
  );
  return data;
}

export async function desativarTipo(
  id: string,
  confirmar: boolean,
): Promise<ResultadoDesativacao> {
  try {
    await axiosInstance.delete(`/admin/config/tipos-processo/${id}`, {
      params: confirmar ? { confirmar: 'true' } : undefined,
    });
    return { precisaConfirmacao: false, processosImpactados: 0 };
  } catch (err) {
    const conflito = parseConflitoDesativacao(err);
    if (conflito) return conflito;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Fluxos e Etapas (editor visual — Task 16.2 / Req. 15)
// ---------------------------------------------------------------------------
//
// A baseURL já inclui `/api/v1`; os Fluxos estão montados sob
// `/admin/config/fluxos` no backend (ver `apps/api/src/modules/fluxos`).
// Endpoints exatos:
//   GET  /admin/config/fluxos        — lista (array de Fluxo + etapas)
//   GET  /admin/config/fluxos/:id    — detalhe (Fluxo + etapas + prazoTotalDiasUteis)
//   POST /admin/config/fluxos        — cria (nova versão 1)
//   PUT  /admin/config/fluxos/:id    — salva = nova versão (Req. 15.4)
//
// Forma do corpo aceita por `criarFluxoSchema`/`editarFluxoSchema`:
//   {
//     nome: string (≤100),
//     etapas: Array<{
//       nome: string (≤100),
//       prazosDiasUteis: number (1–365, inteiro),
//       servidorPadraoId?: string (uuid),
//       documentosObrigatorios?: string[] (≤20),
//       observacoesObrigatorias?: string (≤1000),
//       automacoes?: Array<{ tipo: 'email_cidadao' | 'alerta_servidor' | 'alterar_status'; payload: string }> (≤10),
//     }>  (1–50)
//   }

/** Automação de uma Etapa conforme aceita pelo backend (`automacaoSchema`). */
export interface AutomacaoPayload {
  tipo: 'email_cidadao' | 'alerta_servidor' | 'alterar_status';
  payload: string;
}

/** Payload de uma Etapa conforme aceito por `etapaSchema` (Req. 15.2/15.3). */
export interface EtapaPayload {
  nome: string;
  prazosDiasUteis: number;
  servidorPadraoId?: string;
  documentosObrigatorios?: string[];
  observacoesObrigatorias?: string;
  automacoes?: AutomacaoPayload[];
}

/** Payload de criação/edição de um Fluxo (Req. 15.1/15.4). */
export interface FluxoFormPayload {
  nome: string;
  etapas: EtapaPayload[];
}

/** Etapa retornada pelo backend, com automações incluídas. */
export interface EtapaComAutomacoes extends Etapa {
  documentosObrigatorios?: string[] | null;
  observacoesObrigatorias?: string | null;
  automacoes: Automacao[];
}

/** Fluxo retornado pelo backend na listagem/detalhe, com etapas ordenadas. */
export interface FluxoComEtapas extends Fluxo {
  etapas: EtapaComAutomacoes[];
}

/** Detalhe do Fluxo — acrescenta o prazo total estimado (Req. 15.5). */
export interface FluxoDetalhe extends FluxoComEtapas {
  prazoTotalDiasUteis: number;
}

/**
 * Resposta de salvamento (POST/PUT). O backend responde com confirmação
 * (`salvo`, `prazoTotalDiasUteis`, `salvoEm`) para o feedback de Req. 15.8.
 */
export interface RespostaSalvarFluxo {
  salvo: boolean;
  fluxo: FluxoComEtapas;
  prazoTotalDiasUteis: number;
  salvoEm: string;
}

/**
 * Lista os Fluxos com suas Etapas.
 * `GET /admin/config/fluxos` retorna um array de Fluxos (com etapas).
 */
export async function listarFluxos(): Promise<FluxoComEtapas[]> {
  const { data } = await axiosInstance.get<FluxoComEtapas[]>('/admin/config/fluxos');
  return data;
}

/**
 * Obtém um Fluxo pelo id, com etapas ordenadas, automações e o prazo total
 * estimado. `GET /admin/config/fluxos/:id`.
 */
export async function obterFluxo(id: string): Promise<FluxoDetalhe> {
  const { data } = await axiosInstance.get<FluxoDetalhe>(`/admin/config/fluxos/${id}`);
  return data;
}

/** Cria um novo Fluxo. `POST /admin/config/fluxos`. */
export async function criarFluxo(payload: FluxoFormPayload): Promise<RespostaSalvarFluxo> {
  const { data } = await axiosInstance.post<RespostaSalvarFluxo>(
    '/admin/config/fluxos',
    payload,
  );
  return data;
}

/**
 * Salva a edição de um Fluxo. O backend NÃO altera o Fluxo existente: cria uma
 * NOVA versão (Req. 15.4). `PUT /admin/config/fluxos/:id`.
 */
export async function salvarFluxo(
  id: string,
  payload: FluxoFormPayload,
): Promise<RespostaSalvarFluxo> {
  const { data } = await axiosInstance.put<RespostaSalvarFluxo>(
    `/admin/config/fluxos/${id}`,
    payload,
  );
  return data;
}
