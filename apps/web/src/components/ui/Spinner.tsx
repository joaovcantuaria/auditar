import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  /** Visual size of the spinner. */
  size?: SpinnerSize;
  /** Accessible label announced by assistive technology. */
  label?: string;
}

const sizeClasses: Record<SpinnerSize, string> = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-8 w-8 border-[3px]',
};

/**
 * Accessible loading indicator. Exposes `role="status"` and a visually hidden
 * label so screen readers announce the loading state.
 */
export function Spinner({ size = 'md', label = 'Carregando...', className, ...rest }: SpinnerProps) {
  return (
    <span role="status" className={cn('inline-flex items-center', className)} {...rest}>
      <span
        aria-hidden="true"
        className={cn(
          'inline-block animate-spin rounded-full border-solid border-current border-r-transparent align-[-0.125em]',
          sizeClasses[size],
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export default Spinner;
