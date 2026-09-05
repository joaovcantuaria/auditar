import { isAxiosError } from 'axios';
import type { TipoProcesso, Unidade } from '@auditar/shared';
import { axiosInstance } from '@/lib/axiosInstance';
import type { FormularioComCampos } from './formulario.types';

/**
 * Camada de acesso à API para o editor de Formulários Dinâmicos (Painel
 * Administrativo — task 16.3).
 *
 * A baseURL do axios já inclui `/api/v1`, portanto os caminhos abaixo são
 * relativos. As rotas administrativas estão montadas sob
 * `/admin/config/formularios` no backend (task 5.7), verificadas em
 * `apps/api/src/modules/formularios/formularios.router.ts`:
 *
 *   GET  /admin/config/formularios       — lista todos os formulários com campos
 *                                           (servidor com permissão VISUALIZAR)
 *   POST /admin/config/formularios       — cria (Administrador nível 1)
 *                                           body: { tipoProcessoId, unidadeId, campos[] }
 *   PUT  /admin/config/formularios/:id    — salva/edita (Administrador nível 1)
 *                                           body: { campos[] }  (substitui a lista)
 *
 * Observações importantes verificadas na fonte:
 *  - NÃO existe rota de detalhe `GET /:id`: a listagem já devolve cada
 *    formulário com seus `campos` ordenados por `ordem`. O editor obtém o
 *    detalhe filtrando a lista pelo id.
 *  - NÃO existe rota de reordenação separada. O serviço tem `reordenarCampos`,
 *    mas ele não é exposto no router. Portanto a reordenação (Req. 16.4) é
 *    aplicada localmente (atualizando `ordem`) e PERSISTIDA junto com o
 *    `PUT /:id` (que recria a lista de campos na nova ordem).
 *
 * Shape de cada campo aceito pelo backend (`campoSchema`):
 *   { tipo, rotulo (≤100), descricaoAuxiliar? (≤300), obrigatorio,
 *     validacao? (regex ≤500), valorPadrao?, ordem (int ≥0), opcoes? }
 * Máximo de 50 campos por formulário (`MAX_CAMPOS`). Campos de seleção
 * (selecao_unica/selecao_multipla) exigem ao menos uma opção.
 *
 * _Requirements: 16.1, 16.2, 16.3, 16.4_
 */

/** Número máximo de campos por formulário (espelha `MAX_CAMPOS` do backend). */
export const MAX_CAMPOS_FORMULARIO = 50;

/** Formato padrão de erro da API (`{ error, code, field? }`). */
export interface ApiError {
  error?: string;
  code?: string;
  field?: string;
}

/**
 * Payload de um campo enviado ao backend. Espelha o `campoSchema` do backend.
 * `ordem` é derivada da posição do campo na lista pelo editor antes do envio.
 */
export interface CampoPayload {
  tipo: string;
  rotulo: string;
  descricaoAuxiliar?: string;
  obrigatorio: boolean;
  validacao?: string;
  valorPadrao?: string;
  opcoes?: string[];
  ordem: number;
}

/** Payload de criação de formulário (`POST /admin/config/formularios`). */
export interface CriarFormularioPayload {
  tipoProcessoId: string;
  unidadeId: string;
  campos: CampoPayload[];
}

/** Payload de salvamento de formulário (`PUT /admin/config/formularios/:id`). */
export interface SalvarFormularioPayload {
  campos: CampoPayload[];
}

// ---------------------------------------------------------------------------
// Query keys (React Query)
// ---------------------------------------------------------------------------

export const formulariosAdminQueryKeys = {
  all: ['admin', 'config', 'formularios'] as const,
  tipos: ['admin', 'config', 'tipos-processo', 'todos'] as const,
  unidades: ['admin', 'config', 'unidades'] as const,
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

// ---------------------------------------------------------------------------
// Operações — formulários
// ---------------------------------------------------------------------------

/** Lista todos os formulários com seus campos (ordenados por `ordem`). */
export async function listarFormularios(): Promise<FormularioComCampos[]> {
  const { data } = await axiosInstance.get<{ data: FormularioComCampos[] }>(
    '/admin/config/formularios',
  );
  return data.data;
}

/** Cria um novo formulário. Retorna o formulário criado com seus campos. */
export async function criarFormulario(
  payload: CriarFormularioPayload,
): Promise<FormularioComCampos> {
  const { data } = await axiosInstance.post<FormularioComCampos>(
    '/admin/config/formularios',
    payload,
  );
  return data;
}

/**
 * Salva (edita) um formulário existente, substituindo por completo a lista de
 * campos — o que também persiste a nova ordem (Req. 16.4).
 */
export async function salvarFormulario(
  id: string,
  payload: SalvarFormularioPayload,
): Promise<FormularioComCampos> {
  const { data } = await axiosInstance.put<FormularioComCampos>(
    `/admin/config/formularios/${id}`,
    payload,
  );
  return data;
}

// ---------------------------------------------------------------------------
// Catálogos de referência (Tipos de Processo + Unidades)
// ---------------------------------------------------------------------------

/** Tipo de Processo com as Unidades atendentes já incluídas (relação). */
export interface TipoProcessoComUnidades extends TipoProcesso {
  unidades: Array<{ unidadeId: string }>;
}

/**
 * Lista os Tipos de Processo para o seletor do editor.
 * `GET /admin/config/tipos-processo` retorna um array direto (verificado em
 * `config.api.ts` da task 16.1).
 */
export async function listarTiposProcesso(): Promise<TipoProcessoComUnidades[]> {
  const { data } = await axiosInstance.get<TipoProcessoComUnidades[]>(
    '/admin/config/tipos-processo',
  );
  return data;
}

/**
 * Lista as Unidades para o seletor do editor.
 * `GET /admin/config/unidades` responde `{ data: Unidade[] }`.
 */
export async function listarUnidades(): Promise<Unidade[]> {
  const { data } = await axiosInstance.get<{ data: Unidade[] }>('/admin/config/unidades');
  return data.data;
}
