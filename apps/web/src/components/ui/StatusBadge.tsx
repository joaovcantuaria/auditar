import { StatusProcesso } from '@auditar/shared';
import { Badge, type BadgeColor } from './Badge';

export interface StatusBadgeProps {
  /** Process status to render. */
  status: StatusProcesso;
  className?: string;
}

/**
 * Maps a `StatusProcesso` to its semantic color per the design STATUS_COLORS:
 *  - aprovado / finalizado          -> green  (#27AE60)
 *  - em_andamento                   -> yellow (#F39C12)
 *  - aberto / aguardando_docs /
 *    aguardando_cidadao             -> blue   (#0066CC)
 *  - vencido / rejeitado            -> red    (#E74C3C)
 */
export const STATUS_COLOR_MAP: Record<StatusProcesso, BadgeColor> = {
  [StatusProcesso.ABERTO]: 'blue',
  [StatusProcesso.EM_ANDAMENTO]: 'yellow',
  [StatusProcesso.AGUARDANDO_DOCS]: 'blue',
  [StatusProcesso.AGUARDANDO_CIDADAO]: 'blue',
  [StatusProcesso.VENCIDO]: 'red',
  [StatusProcesso.APROVADO]: 'green',
  [StatusProcesso.REJEITADO]: 'red',
  [StatusProcesso.FINALIZADO]: 'green',
};

/** Human-readable Portuguese label per status. */
export const STATUS_LABEL_MAP: Record<StatusProcesso, string> = {
  [StatusProcesso.ABERTO]: 'Aberto',
  [StatusProcesso.EM_ANDAMENTO]: 'Em andamento',
  [StatusProcesso.AGUARDANDO_DOCS]: 'Aguardando documentos',
  [StatusProcesso.AGUARDANDO_CIDADAO]: 'Aguardando cidadão',
  [StatusProcesso.VENCIDO]: 'Vencido',
  [StatusProcesso.APROVADO]: 'Aprovado',
  [StatusProcesso.REJEITADO]: 'Rejeitado',
  [StatusProcesso.FINALIZADO]: 'Finalizado',
};

/**
 * Badge specialized for process status. Renders the localized label and the
 * color mapped from the status enum.
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <Badge color={STATUS_COLOR_MAP[status]} className={className}>
      {STATUS_LABEL_MAP[status]}
    </Badge>
  );
}

export default StatusBadge;
