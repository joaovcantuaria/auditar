import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visible label associated with the input via htmlFor/id. */
  label: string;
  /** Error message. When present the field is marked aria-invalid. */
  error?: string;
  /** Helper text shown below the field when there is no error. */
  helperText?: string;
  /** Marks the field as required and shows a visual required indicator. */
  required?: boolean;
  /** Optional content rendered on the right side of the field (e.g. an icon). */
  trailing?: ReactNode;
}

/**
 * Text input with an associated label, accessible error state
 * (aria-invalid + aria-describedby) and optional helper text.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, helperText, required, trailing, id, className, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const helperId = `${inputId}-helper`;

  const describedBy = error ? errorId : helperText ? helperId : undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-text-primary">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>

      <div className="relative flex items-center">
        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'w-full min-h-touch rounded-btn border bg-white px-3 py-2 text-base text-text-primary',
            'placeholder:text-text-secondary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            'disabled:cursor-not-allowed disabled:bg-bg-alt disabled:text-text-secondary',
            error ? 'border-danger' : 'border-neutral',
            trailing && 'pr-10',
            className,
          )}
          {...rest}
        />
        {trailing && (
          <span className="absolute right-3 flex items-center text-text-secondary">{trailing}</span>
        )}
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : helperText ? (
        <p id={helperId} className="text-sm text-text-secondary">
          {helperText}
        </p>
      ) : null}
    </div>
  );
});

export default Input;
