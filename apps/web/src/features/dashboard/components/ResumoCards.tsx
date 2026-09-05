import { StatusProcesso } from '@auditar/shared';
import { Alert } from '@/components/ui';
import { STATUS_COLOR_MAP } from '@/components/ui/StatusBadge';
import type { BadgeColor } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import type { Indicador } from '../dashboard.types';
import type { CardsResumo } from '../dashboardEstendida.types';

/**
 * Cards de resumo (Task 27.1, Req 9.7): 8 contagens por situação com rótulos
 * pt-BR e cores por status, reutilizando o mapeamento de cor do StatusBadge
 * ({@link STATUS_COLOR_MAP}) para os status que existem no enum. As métricas
 * transversais "Total" e "Atrasados" usam cores próprias (neutra / vermelha).
 *
 * O indicador chega embrulhado em {@link Indicador}: em caso de falha isolada
 * (`erro: true` ou `value == null`) mostra um Alert inline sem derrubar o resto
 * da página (Req 9.6).
 */

export interface ResumoCardsProps {
  /** Indicador `cards` da resposta de `GET /admin/dashboard/resumo`. */
  indicador: Indicador<CardsResumo> | undefined;
}

/** Descreve um card: rótulo pt-BR, chave no payload e cor semântica. */
interface CardDef {
  key: keyof CardsResumo;
  label: string;
  color: BadgeColor;
}

/**
 * Cor por card. Reutiliza `STATUS_COLOR_MAP` para os cards que correspondem a um
 * `StatusProcesso`; "total" é neutro e "atrasados" é vermelho (métrica de risco).
 */
const CARDS: CardDef[] = [
  { key: 'total', label: 'Total', color: 'neutral' },
  { key: 'abertos', label: 'Abertos', color: STATUS_COLOR_MAP[StatusProcesso.ABERTO] },
  {
    key: 'emAndamento',
    label: 'Em andamento',
    color: STATUS_COLOR_MAP[StatusProcesso.EM_ANDAMENTO],
  },
  {
    key: 'aguardandoDocs',
    label: 'Aguardando documentos',
    color: STATUS_COLOR_MAP[StatusProcesso.AGUARDANDO_DOCS],
  },
  { key: 'atrasados', label: 'Atrasados', color: 'red' },
  { key: 'aprovados', label: 'Aprovados', color: STATUS_COLOR_MAP[StatusProcesso.APROVADO] },
  {
    key: 'finalizados',
    label: 'Finalizados',
    color: STATUS_COLOR_MAP[StatusProcesso.FINALIZADO],
  },
  { key: 'rejeitados', label: 'Rejeitados', color: STATUS_COLOR_MAP[StatusProcesso.REJEITADO] },
];

/** Classes de destaque (barra superior + número) por cor semântica. */
const COLOR_ACCENT: Record<BadgeColor, string> = {
  green: 'text-success',
  yellow: 'text-warning',
  blue: 'text-primary',
  red: 'text-danger',
  neutral: 'text-text-primary',
};

const COLOR_BAR: Record<BadgeColor, string> = {
  green: 'bg-success',
  yellow: 'bg-warning',
  blue: 'bg-primary',
  red: 'bg-danger',
  neutral: 'bg-neutral',
};

export function ResumoCards({ indicador }: ResumoCardsProps) {
  const indisponivel = !indicador || indicador.erro || indicador.value == null;

  if (indisponivel) {
    return (
      <Alert variant="warning" title="Resumo indisponível">
        Não foi possível carregar os cards de resumo. Os demais indicadores continuam
        disponíveis.
      </Alert>
    );
  }

  const cards = indicador.value as CardsResumo;

  return (
    <ul
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      aria-label="Resumo de processos por situação"
    >
      {CARDS.map(({ key, label, color }) => (
        <li
          key={key}
          className="flex flex-col gap-2 overflow-hidden rounded-card border border-neutral/30 bg-white p-4 shadow-sm"
        >
          <span className={cn('h-1 w-8 rounded-full', COLOR_BAR[color])} aria-hidden="true" />
          <span className={cn('font-heading text-3xl font-semibold', COLOR_ACCENT[color])}>
            {cards[key]}
          </span>
          <span className="text-sm text-text-secondary">{label}</span>
        </li>
      ))}
    </ul>
  );
}

export default ResumoCards;
