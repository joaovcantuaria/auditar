import { StatusBadge } from '@/components/ui';
import { StatusProcesso } from '@auditar/shared';
import type { PorStatus } from './dashboard.types';
import { STATUS_KEYS } from './dashboard.types';

export interface StatusCountsProps {
  porStatus: PorStatus;
}

/**
 * Grade de contagens por status: para cada status conhecido, mostra o
 * StatusBadge (com a cor do design) e a contagem correspondente (0 quando
 * ausente). Usado nos cartões "Processos por status" (Req 9.1, 9.2).
 */
export function StatusCounts({ porStatus }: StatusCountsProps) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {STATUS_KEYS.map((status) => (
        <li
          key={status as string}
          className="flex flex-col items-start gap-1 rounded-card bg-neutral/5 p-2"
        >
          <StatusBadge status={status as StatusProcesso} />
          <span className="font-heading text-xl font-semibold text-text-primary">
            {porStatus[status] ?? 0}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default StatusCounts;
