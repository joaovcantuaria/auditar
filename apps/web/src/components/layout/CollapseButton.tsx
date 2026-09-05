import { cn } from '@/lib/cn';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

export interface CollapseButtonProps {
  /** Estado atual: sidebar recolhida. */
  collapsed: boolean;
  /** Alterna o estado de colapso. */
  onToggle: () => void;
  className?: string;
}

/**
 * Botão que recolhe/expande a Sidebar no desktop. Mantém o alvo de toque de
 * 44px e expõe `aria-expanded` para tecnologias assistivas.
 */
export function CollapseButton({ collapsed, onToggle, className }: CollapseButtonProps) {
  const label = collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral';

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-expanded={!collapsed}
      title={label}
      className={cn(
        'inline-flex min-h-touch min-w-touch items-center justify-center rounded-btn',
        'text-text-secondary hover:bg-primary-light hover:text-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        className,
      )}
    >
      {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
    </button>
  );
}

export default CollapseButton;
