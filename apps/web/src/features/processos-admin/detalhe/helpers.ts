import { StatusProcesso } from '@auditar/shared';
import { AxiosError } from 'axios';

/**
 * Helpers puros da tela de Detalhe do Processo no Painel Administrativo
 * (Task 15.2). Formatação de datas/tamanhos, detecção de status terminal
 * (bloqueia envio de mensagens — Req 13.8) e extração da mensagem de erro da
 * API para exibição em `Alert`.
 */

/** Máximo de caracteres de uma observação (Req 11.4/11.5). */
export const MAX_OBSERVACAO = 2000;

/** Máximo de caracteres do conteúdo de mensagem (espelha os schemas do backend). */
export const MAX_MENSAGEM = 4000;

/** Máximo de caracteres do motivo de rejeição (espelha `rejeitarSchema`). */
export const MAX_MOTIVO = 2000;

/** Formata uma data ISO em `dd/mm/aaaa` (locale pt-BR); vazio se inválida. */
export function formatarData(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR');
}

/** Formata uma data ISO em `dd/mm/aaaa hh:mm` (locale pt-BR); vazio se inválida. */
export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Formata um tamanho em bytes em unidade legível (B, KB, MB). */
export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Status TERMINAIS de um Processo — enquanto o Processo estiver em um destes,
 * o envio de novas mensagens (público e interno) é bloqueado (Req 13.8). Mesmo
 * conjunto usado no backend (`STATUS_ENCERRADOS`).
 */
const STATUS_TERMINAIS: ReadonlySet<string> = new Set<string>([
  StatusProcesso.APROVADO,
  StatusProcesso.REJEITADO,
  StatusProcesso.FINALIZADO,
]);

/** Indica se o Processo está encerrado (composers de mensagem desabilitados). */
export function isStatusTerminal(status: string): boolean {
  return STATUS_TERMINAIS.has(status);
}

/** Verifica se um valor corresponde ao enum `StatusProcesso`. */
export function comoStatusProcesso(status: string): StatusProcesso | null {
  const valores = Object.values(StatusProcesso) as string[];
  return valores.includes(status) ? (status as StatusProcesso) : null;
}

/** Formato de erro padronizado da API (`{ error, code, field? }`). */
export interface ApiError {
  error: string;
  code: string;
  field?: string;
}

/** Extrai a mensagem de erro da API de forma segura, com fallback amigável. */
export function extractApiError(
  err: unknown,
  fallback = 'Não foi possível concluir a solicitação. Tente novamente.',
): string {
  if (err instanceof AxiosError && err.response?.data) {
    const data = err.response.data as Partial<ApiError>;
    if (typeof data.error === 'string') return data.error;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** Indica se o erro é um 404 (Processo inexistente — leva à tela de "não encontrado"). */
export function is404(err: unknown): boolean {
  return err instanceof AxiosError && err.response?.status === 404;
}
