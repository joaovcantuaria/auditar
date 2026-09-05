import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { ModoAtribuicao } from '@auditar/shared';
import { axiosInstance } from '@/lib/axiosInstance';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/hooks/useSocket';

/**
 * Hook de dados da Atribuição/Reatribuição de Processos no Painel
 * Administrativo (tarefa 15.3, Requisito 12).
 *
 * Encapsula a query de cargas e as duas mutações (atribuir/reatribuir) para
 * que tanto os modais desta feature quanto a página de detalhe do processo
 * (tarefa 15.2, concorrente) consumam a MESMA fonte, sem duplicar o contrato
 * do backend.
 *
 * Contrato do backend (lido de `processos.atribuicao.controller.ts`,
 * `processos.atribuicao.service.ts`, `processos.atribuicao.router.ts` e
 * `processos.atribuicao.schema.ts`; baseURL do axios: `/api/v1`):
 *
 * - `GET /admin/processos/:id/atribuir/cargas` (Req 12.4)
 *   → `{ data: CargaServidorDisponivel[] }`, onde cada item é
 *     `{ servidorId: string; nome: string; processosAtivos: number }`.
 *     Lista os Servidores ATIVOS da Unidade do Processo com a contagem de
 *     Processos ativos de cada um — exibida ANTES de confirmar a atribuição
 *     manual / escolher o destino da reatribuição.
 *
 * - `POST /admin/processos/:id/atribuir` (Req 12.1, 12.2, 12.5, 12.7)
 *   corpo `{ modo: 'automatico' | 'manual' | 'fila_geral'; servidorId?: string }`
 *   (`servidorId` obrigatório apenas quando `modo === 'manual'`)
 *   → `{ data: AtribuicaoResultado }`.
 *
 * - `POST /admin/processos/:id/reatribuir` (Req 12.8, 12.9, 12.10)
 *   corpo `{ servidorDestinoId: string; justificativa: string }`
 *   (justificativa 20–500 chars, validada no cliente ANTES do envio)
 *   → `{ data: AtribuicaoResultado }`.
 *
 * Todas as rotas exigem Servidor autenticado com a permissão `ATRIBUIR` — o
 * token é injetado pelo interceptor do axios.
 *
 * _Requirements: 12.1, 12.2, 12.4, 12.5, 12.7, 12.8, 12.9, 12.10_
 */

// ---------------------------------------------------------------------------
// Constantes de validação (espelham `processos.atribuicao.schema.ts`).
// ---------------------------------------------------------------------------

/** Tamanho mínimo da justificativa de reatribuição (Req 12.8, 12.9). */
export const JUSTIFICATIVA_MIN_CHARS = 20;
/** Tamanho máximo da justificativa de reatribuição (Req 12.8, 12.9). */
export const JUSTIFICATIVA_MAX_CHARS = 500;

// ---------------------------------------------------------------------------
// Tipos do contrato (espelham as formas do backend).
// ---------------------------------------------------------------------------

/**
 * Carga de um Servidor exibida ao Gestor antes de confirmar a atribuição
 * manual (Req 12.4). Idêntico ao `CargaServidorDisponivel` do backend.
 */
export interface CargaServidorDisponivel {
  servidorId: string;
  nome: string;
  processosAtivos: number;
}

/** Resumo do resultado de uma atribuição/reatribuição (backend `AtribuicaoResultado`). */
export interface AtribuicaoResultado {
  processoId: string;
  /** Servidor atribuído, ou null quando o Processo foi para a Fila_Geral. */
  servidorId: string | null;
  modo: string;
  /** true quando nenhum Servidor foi atribuído e o Processo caiu na Fila_Geral. */
  filaGeral: boolean;
}

/** Corpo do `POST /admin/processos/:id/atribuir` (Req 12.1). */
export interface AtribuirPayload {
  modo: ModoAtribuicao;
  /** Obrigatório apenas quando `modo === ModoAtribuicao.MANUAL`. */
  servidorId?: string;
}

/** Corpo do `POST /admin/processos/:id/reatribuir` (Req 12.8). */
export interface ReatribuirPayload {
  servidorDestinoId: string;
  justificativa: string;
}

/** Formato de erro padronizado da API (`{ error, code, field? }`). */
export interface ApiError {
  error: string;
  code: string;
  field?: string;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Envelope `{ data: T }` usado por todas as respostas destes endpoints. */
interface DataEnvelope<T> {
  data: T;
}

/** Extrai a mensagem de erro da API de forma segura, com fallback amigável. */
export function extractApiError(err: unknown): string {
  if (err instanceof AxiosError && err.response?.data) {
    const data = err.response.data as Partial<ApiError>;
    if (typeof data.error === 'string') return data.error;
  }
  if (err instanceof Error) return err.message;
  return 'Ocorreu um erro inesperado. Tente novamente.';
}

/**
 * Valida o tamanho da justificativa no cliente ANTES do envio (Req 12.9).
 * Retorna `null` quando válida ou uma mensagem descritiva quando inválida.
 */
export function validarJustificativa(justificativa: string): string | null {
  const tamanho = justificativa.trim().length;
  if (tamanho < JUSTIFICATIVA_MIN_CHARS || tamanho > JUSTIFICATIVA_MAX_CHARS) {
    return `A justificativa deve ter entre ${JUSTIFICATIVA_MIN_CHARS} e ${JUSTIFICATIVA_MAX_CHARS} caracteres.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Query-key das cargas (derivada da chave de detalhe do processo).
// ---------------------------------------------------------------------------

/** Chave da query de cargas de um Processo. */
export function cargasQueryKey(processoId: string): readonly [string, string, 'cargas'] {
  return ['processo', processoId, 'cargas'] as const;
}

// ---------------------------------------------------------------------------
// Requisições isoladas (reutilizáveis / testáveis sem React).
// ---------------------------------------------------------------------------

/** GET das cargas dos Servidores da Unidade do Processo (Req 12.4). */
export async function fetchCargas(processoId: string): Promise<CargaServidorDisponivel[]> {
  const { data } = await axiosInstance.get<DataEnvelope<CargaServidorDisponivel[]>>(
    `/admin/processos/${processoId}/atribuir/cargas`,
  );
  return data.data;
}

/** POST de atribuição (Req 12.1, 12.2, 12.5). */
export async function postAtribuir(
  processoId: string,
  payload: AtribuirPayload,
): Promise<AtribuicaoResultado> {
  const { data } = await axiosInstance.post<DataEnvelope<AtribuicaoResultado>>(
    `/admin/processos/${processoId}/atribuir`,
    payload,
  );
  return data.data;
}

/** POST de reatribuição (Req 12.8, 12.10). */
export async function postReatribuir(
  processoId: string,
  payload: ReatribuirPayload,
): Promise<AtribuicaoResultado> {
  const { data } = await axiosInstance.post<DataEnvelope<AtribuicaoResultado>>(
    `/admin/processos/${processoId}/reatribuir`,
    payload,
  );
  return data.data;
}

// ---------------------------------------------------------------------------
// Hook.
// ---------------------------------------------------------------------------

/** Valor de retorno do hook `useAtribuicao`. */
export interface UseAtribuicaoResult {
  /** Query das cargas dos Servidores da Unidade (Req 12.4). */
  cargasQuery: UseQueryResult<CargaServidorDisponivel[]>;
  /** Mutação de atribuição (Req 12.1, 12.2, 12.5, 12.7). */
  atribuirMutation: UseMutationResult<AtribuicaoResultado, unknown, AtribuirPayload>;
  /** Mutação de reatribuição (Req 12.8, 12.9, 12.10). */
  reatribuirMutation: UseMutationResult<AtribuicaoResultado, unknown, ReatribuirPayload>;
}

/**
 * Encapsula a query de cargas e as duas mutações de atribuição/reatribuição
 * de um Processo.
 *
 * @param processoId Processo alvo. Quando vazio, a query de cargas fica
 *   desabilitada (evita fetch antes de haver um processo selecionado).
 * @param options.enabledCargas Habilita a busca de cargas. Útil para só
 *   buscar quando o modal está aberto e o modo exige a lista de Servidores.
 */
export function useAtribuicao(
  processoId: string,
  options: { enabledCargas?: boolean } = {},
): UseAtribuicaoResult {
  const { enabledCargas = true } = options;

  const cargasQuery = useQuery<CargaServidorDisponivel[]>({
    queryKey: cargasQueryKey(processoId),
    queryFn: () => fetchCargas(processoId),
    enabled: Boolean(processoId) && enabledCargas,
  });

  /**
   * Após uma (re)atribuição bem-sucedida, invalida o detalhe do Processo, as
   * listas que o contêm e as próprias cargas (a contagem por Servidor muda).
   * Espelha o comportamento de `useSocket` para `processo:atribuido`.
   */
  function invalidarAposAtribuicao(): void {
    void queryClient.invalidateQueries({ queryKey: queryKeys.processo(processoId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.processos() });
    void queryClient.invalidateQueries({ queryKey: cargasQueryKey(processoId) });
  }

  const atribuirMutation = useMutation<AtribuicaoResultado, unknown, AtribuirPayload>({
    mutationFn: (payload) => postAtribuir(processoId, payload),
    onSuccess: invalidarAposAtribuicao,
  });

  const reatribuirMutation = useMutation<AtribuicaoResultado, unknown, ReatribuirPayload>({
    mutationFn: (payload) => postReatribuir(processoId, payload),
    onSuccess: invalidarAposAtribuicao,
  });

  return { cargasQuery, atribuirMutation, reatribuirMutation };
}

export default useAtribuicao;
