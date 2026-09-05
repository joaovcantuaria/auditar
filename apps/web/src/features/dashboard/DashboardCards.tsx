import type { ReactNode } from 'react';
import { Alert } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { Indicador } from './dashboard.types';

/**
 * Wrappers reutilizáveis de cartão de dashboard.
 *
 * `IndicatorCard`/`ChartCard` centralizam a resiliência por indicador (Req 9.6):
 * quando o indicador está ausente (`value == null`) ou marcado com `erro: true`,
 * o cartão renderiza um Alert inline "Dados indisponíveis" no lugar do conteúdo,
 * enquanto os demais cartões do dashboard continuam exibindo seus dados.
 */

interface CardShellProps {
  title: string;
  children: ReactNode;
  className?: string;
}

/** Moldura visual comum a todos os cartões (título + corpo). */
function CardShell({ title, children, className }: CardShellProps) {
  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded-card border border-neutral/30 bg-white p-4 shadow-sm',
        className,
      )}
      aria-label={title}
    >
      <h3 className="font-heading text-sm font-semibold text-text-secondary">{title}</h3>
      <div className="flex-1">{children}</div>
    </section>
  );
}

/** Alert inline exibido quando um indicador específico falhou (Req 9.6). */
function IndicadorIndisponivel() {
  return (
    <Alert variant="warning" title="Dados indisponíveis">
      Não foi possível carregar este indicador. Os demais continuam disponíveis.
    </Alert>
  );
}

export interface IndicatorCardProps<T> {
  /** Título acessível do cartão. */
  title: string;
  /** Indicador vindo do backend (pode estar em estado de erro — Req 9.6). */
  indicador: Indicador<T> | undefined;
  /** Render do conteúdo quando o valor está disponível. */
  children: (value: T) => ReactNode;
  className?: string;
}

/**
 * Cartão genérico ligado a um {@link Indicador}. Se o indicador falhou ou está
 * ausente, mostra o Alert inline; caso contrário delega ao `children(value)`.
 */
export function IndicatorCard<T>({
  title,
  indicador,
  children,
  className,
}: IndicatorCardProps<T>) {
  const indisponivel = !indicador || indicador.erro || indicador.value == null;
  return (
    <CardShell title={title} className={className}>
      {indisponivel ? <IndicadorIndisponivel /> : children(indicador.value as T)}
    </CardShell>
  );
}

/** Alias semântico para cartões cujo corpo é um gráfico. Mesma semântica de erro. */
export const ChartCard = IndicatorCard;

export interface KpiValueProps {
  /** Valor numérico/textual em destaque. */
  value: ReactNode;
  /** Unidade/legenda opcional exibida ao lado do valor. */
  unit?: string;
}

/** Bloco de valor grande (KPI) reutilizável dentro de um IndicatorCard. */
export function KpiValue({ value, unit }: KpiValueProps) {
  return (
    <p className="flex items-baseline gap-1">
      <span className="font-heading text-3xl font-semibold text-text-primary">{value}</span>
      {unit && <span className="text-sm text-text-secondary">{unit}</span>}
    </p>
  );
}
