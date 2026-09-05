import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Cartão selecionável acessível usado nos steps de seleção do wizard
 * (Categoria, Tipo, Unidade). Renderiza um `<label>` envolvendo um
 * `<input type="radio">` visualmente oculto, mantendo semântica de grupo de
 * rádio (navegação por teclado e leitura por tecnologia assistiva).
 */
export interface OpcaoCardProps {
  /** Nome do grupo de rádio (compartilhado entre as opções de um step). */
  name: string;
  /** Se esta opção está selecionada. */
  selected: boolean;
  /** Título principal da opção. */
  title: string;
  /** Descrição opcional (linha secundária). */
  description?: string;
  /** Conteúdo adicional (ex.: metadados da unidade). */
  children?: ReactNode;
  /** Desabilita a opção. */
  disabled?: boolean;
  /** Chamado ao selecionar. */
  onSelect: () => void;
}

export function OpcaoCard({
  name,
  selected,
  title,
  description,
  children,
  disabled = false,
  onSelect,
}: OpcaoCardProps) {
  return (
    <label
      className={cn(
        'flex cursor-pointer flex-col gap-1 rounded-card border p-4 transition-colors',
        'focus-within:ring-2 focus-within:ring-primary',
        selected ? 'border-primary bg-primary-light' : 'border-neutral bg-white hover:bg-bg-alt',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="radio"
          name={name}
          className="sr-only"
          checked={selected}
          disabled={disabled}
          onChange={onSelect}
        />
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
            selected ? 'border-primary' : 'border-neutral',
          )}
        >
          {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-text-primary">{title}</span>
          {description && <span className="text-sm text-text-secondary">{description}</span>}
          {children}
        </span>
      </div>
    </label>
  );
}

export default OpcaoCard;
