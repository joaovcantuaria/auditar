import { isAxiosError } from 'axios';
import { axiosInstance } from '@/lib/axiosInstance';
import type { RespostaFormularioInput } from '@/features/formularios';

/**
 * Camada de acesso à API da abertura de Processo pelo Servidor (Task 28.3,
 * Req 23). A baseURL do axios já inclui `/api/v1`, então os paths são
 * relativos.
 *
 * Contratos confirmados no backend:
 *  - `GET /admin/cidadaos?cpf={cpf}` → `{ data: IdentificacaoCidadao }` (200) ou
 *    404 sinalizando que um novo Cidadão pode ser cadastrado (Req 23.2, 23.3).
 *    Requer permissão `editar` (`cidadaos.admin.router.ts`).
 *  - `POST /admin/processos` body `{ cidadaoId, tipoProcessoId, unidadeId,
 *    respostas, documentoIds? }` → `{ protocolo, processoId }` (201). Requer
 *    permissão `editar` (`processos.admin.router.ts` /
 *    `processos.abertura.controller.ts`).
 *
 * _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 23.7_
 */

/** Formato padrão de erro da API (`{ error, code, field? }`). */
export interface ApiError {
  error?: string;
  code?: string;
  field?: string;
}

/**
 * Dados de identificação do Cidadão retornados pela busca por CPF
 * (`IdentificacaoCidadao` do backend). Nunca inclui a senha.
 */
export interface IdentificacaoCidadao {
  id: string;
  /** CPF apenas com os 11 dígitos. */
  cpf: string;
  /** CPF formatado para exibição (`000.000.000-00`). */
  cpfFormatado: string;
  nome: string;
  email: string;
  telefone: string;
}

/** Resultado da abertura de Processo (`CriarProcessoResultado` do backend). */
export interface AbrirProcessoResultado {
  protocolo: string;
  processoId: string;
}

/** Payload de abertura administrativa (`abrirProcessoAdminSchema`). */
export interface AbrirProcessoAdminPayload {
  cidadaoId: string;
  tipoProcessoId: string;
  unidadeId: string;
  respostas: RespostaFormularioInput[];
  documentoIds?: string[];
}

/** Extrai a mensagem amigável de erro de uma resposta da API. */
export function extrairMensagemErro(err: unknown, fallback: string): string {
  if (isAxiosError<ApiError>(err)) {
    return err.response?.data?.error ?? fallback;
  }
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

/** Indica se o erro é um 404 (Cidadão não encontrado → oferecer cadastro). */
export function isCidadaoNaoEncontrado(err: unknown): boolean {
  return isAxiosError(err) && err.response?.status === 404;
}

/**
 * Busca um Cidadão por CPF para a abertura administrativa (Req 23.2, 23.3).
 * Lança em 404 (Cidadão inexistente) — o consumidor trata com
 * `isCidadaoNaoEncontrado` para oferecer o cadastro.
 */
export async function buscarCidadaoPorCpf(cpf: string): Promise<IdentificacaoCidadao> {
  const { data } = await axiosInstance.get<{ data: IdentificacaoCidadao }>('/admin/cidadaos', {
    params: { cpf },
  });
  return data.data;
}

/**
 * Abre um Processo em nome de um Cidadão (Req 23.4–23.7). Retorna
 * `{ protocolo, processoId }`. Falhas propagam para o consumidor preservar os
 * dados e permitir nova tentativa (Req 23.7).
 */
export async function abrirProcessoAdmin(
  payload: AbrirProcessoAdminPayload,
): Promise<AbrirProcessoResultado> {
  const { data } = await axiosInstance.post<AbrirProcessoResultado>('/admin/processos', payload);
  return data;
}
