import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type BadgeColor = 'green' | 'yellow' | 'blue' | 'red' | 'neutral';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Semantic color of the badge. */
  color?: BadgeColor;
}

export const badgeColorClasses: Record<BadgeColor, string> = {
  green: 'bg-success/15 text-success',
  yellow: 'bg-warning/15 text-warning',
  blue: 'bg-primary/15 text-primary',
  red: 'bg-danger/15 text-danger',
  neutral: 'bg-neutral/20 text-text-secondary',
};

/**
 * Generic pill/badge base. `StatusBadge` composes this with a status color map.
 */
export function Badge({ color = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        badgeColorClasses[color],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

export default Badge;
