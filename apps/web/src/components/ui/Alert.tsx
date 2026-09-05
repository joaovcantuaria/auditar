import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  /** Semantic variant that sets color and default icon. */
  variant?: AlertVariant;
  /** Optional heading rendered above the message. */
  title?: ReactNode;
  /** Override the default icon. Pass null to hide it. */
  icon?: ReactNode;
}

const variantClasses: Record<AlertVariant, string> = {
  info: 'bg-primary-light text-primary-dark border-primary',
  success: 'bg-success/10 text-success border-success',
  warning: 'bg-warning/10 text-warning border-warning',
  danger: 'bg-danger/10 text-danger border-danger',
};

const defaultIcons: Record<AlertVariant, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  danger: '✕',
};

/**
 * Contextual feedback message. Uses `role="alert"` for danger/warning so
 * assistive tech announces urgent messages, and `role="status"` for info/success.
 */
export function Alert({
  variant = 'info',
  title,
  icon,
  className,
  children,
  ...rest
}: AlertProps) {
  const assertive = variant === 'danger' || variant === 'warning';
  const resolvedIcon = icon === undefined ? defaultIcons[variant] : icon;

  return (
    <div
      role={assertive ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-card border-l-4 p-4',
        variantClasses[variant],
        className,
      )}
      {...rest}
    >
      {resolvedIcon !== null && (
        <span aria-hidden="true" className="mt-0.5 select-none font-bold leading-none">
          {resolvedIcon}
        </span>
      )}
      <div className="flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className="text-sm text-text-primary">{children}</div>
      </div>
    </div>
  );
}

export default Alert;
