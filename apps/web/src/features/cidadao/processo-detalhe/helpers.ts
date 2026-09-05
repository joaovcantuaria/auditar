import { StatusProcesso, calcularDiasRestantes } from '@auditar/shared';

/**
 * Helpers puros da tela de Detalhe do Processo (Task 13.3).
 *
 * Concentram formatação de datas/tamanhos e o cálculo visual de prazo (aba
 * Prazos, Req 5.8) — tudo client-side, sem endpoint dedicado.
 */

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

/** Status que encerram o Processo — bloqueiam envio de mensagens (Req 13.8). */
const STATUS_TERMINAIS: ReadonlySet<string> = new Set<string>([
  StatusProcesso.APROVADO,
  StatusProcesso.REJEITADO,
  StatusProcesso.FINALIZADO,
]);

/** Indica se o Processo está encerrado (composer de mensagens desabilitado). */
export function isStatusTerminal(status: string): boolean {
  return STATUS_TERMINAIS.has(status);
}

// ---------------------------------------------------------------------------
// Aba Prazos — indicador visual de prazo (Req 5.8, 5.9)
// ---------------------------------------------------------------------------

/** Nível de urgência do prazo, mapeado a uma cor semântica. */
export type PrazoNivel = 'ok' | 'atencao' | 'vencido';

/** Resultado do cálculo de prazo exibido na aba Prazos. */
export interface PrazoInfo {
  /** Dias úteis restantes até o prazo final (0 quando já vencido). */
  diasRestantes: number;
  /** True quando a data atual já ultrapassou o prazo final. */
  vencido: boolean;
  /** Nível de urgência: verde (>3), amarelo (≤3), vermelho (vencido). */
  nivel: PrazoNivel;
}

/**
 * Calcula o estado do prazo a partir da data-limite (`prazoFinal`), relativo a
 * `agora` (default: momento atual). Regras (Req 5.8):
 *  - `vencido`  → prazo já ultrapassado (vermelho);
 *  - `atencao`  → ≤ 3 dias úteis restantes (amarelo);
 *  - `ok`       → > 3 dias úteis restantes (verde).
 */
export function calcularPrazo(prazoFinalIso: string, agora: Date = new Date()): PrazoInfo {
  const prazo = new Date(prazoFinalIso);
  if (Number.isNaN(prazo.getTime())) {
    return { diasRestantes: 0, vencido: false, nivel: 'ok' };
  }

  if (prazo.getTime() <= agora.getTime()) {
    return { diasRestantes: 0, vencido: true, nivel: 'vencido' };
  }

  const diasRestantes = calcularDiasRestantes(agora, prazo);
  const nivel: PrazoNivel = diasRestantes <= 3 ? 'atencao' : 'ok';
  return { diasRestantes, vencido: false, nivel };
}
