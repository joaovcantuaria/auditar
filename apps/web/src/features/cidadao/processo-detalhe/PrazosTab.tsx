import { Alert } from '@/components/ui';
import type { ProcessoDetalhe } from './api';
import { calcularPrazo, formatarData, type PrazoNivel } from './helpers';

/**
 * Aba Prazos do Detalhe do Processo (Req 5.8, 5.9).
 *
 * Indicador visual do prazo final calculado inteiramente no cliente a partir
 * de `prazoFinal` (nenhum endpoint dedicado). O cálculo é refeito a cada
 * render — como o detalhe é revalidado em tempo real via socket
 * (`queryKeys.processo(id)`), a cor acompanha atualizações de status/etapa.
 */
export interface PrazosTabProps {
  processo: ProcessoDetalhe;
}

/** Classes de cor por nível de urgência (verde/amarelo/vermelho). */
const NIVEL_CLASSES: Record<PrazoNivel, string> = {
  ok: 'border-success bg-success/10 text-success',
  atencao: 'border-warning bg-warning/10 text-warning',
  vencido: 'border-danger bg-danger/10 text-danger',
};

/** Variante do Alert equivalente ao nível de urgência. */
const NIVEL_ALERT: Record<PrazoNivel, 'success' | 'warning' | 'danger'> = {
  ok: 'success',
  atencao: 'warning',
  vencido: 'danger',
};

export function PrazosTab({ processo }: PrazosTabProps) {
  const prazo = calcularPrazo(processo.prazoFinal);

  const mensagem = prazo.vencido
    ? 'O prazo final deste processo foi ultrapassado.'
    : prazo.diasRestantes <= 3
      ? `Faltam ${prazo.diasRestantes} dia(s) útil(eis) para o prazo final.`
      : `Restam ${prazo.diasRestantes} dias úteis até o prazo final.`;

  return (
    <div className="flex flex-col gap-4">
      <div
        className={`flex items-center gap-4 rounded-card border-l-4 p-4 ${NIVEL_CLASSES[prazo.nivel]}`}
      >
        <span
          className="text-3xl font-bold tabular-nums"
          aria-hidden="true"
        >
          {prazo.vencido ? '!' : prazo.diasRestantes}
        </span>
        <div>
          <p className="text-sm font-medium text-text-secondary">Prazo final</p>
          <p className="text-base font-semibold text-text-primary">
            {formatarData(processo.prazoFinal)}
          </p>
        </div>
      </div>

      <Alert variant={NIVEL_ALERT[prazo.nivel]}>{mensagem}</Alert>
    </div>
  );
}

export default PrazosTab;
