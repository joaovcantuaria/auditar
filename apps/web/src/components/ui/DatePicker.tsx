import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface DatePickerProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Visible label associated with the field via htmlFor/id. */
  label: string;
  /** Error message. When present the field is marked aria-invalid. */
  error?: string;
  /** Helper text shown below the field when there is no error. */
  helperText?: string;
  /** Marks the field as required and shows a visual required indicator. */
  required?: boolean;
  /** Minimum selectable date (YYYY-MM-DD). */
  min?: string;
  /** Maximum selectable date (YYYY-MM-DD). */
  max?: string;
}

/**
 * Accessible date field built on the native `<input type="date">`. Using the
 * native control gives keyboard support, locale-aware formatting and the OS
 * date picker for free, keeping the a11y contract identical to Input.
 */
export const DatePicker = forwardRef<HTMLInputElement, DatePickerProps>(function DatePicker(
  { label, error, helperText, required, id, className, ...rest },
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

      <input
        ref={ref}
        id={inputId}
        type="date"
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'w-full min-h-touch rounded-btn border bg-white px-3 py-2 text-base text-text-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          'disabled:cursor-not-allowed disabled:bg-bg-alt disabled:text-text-secondary',
          error ? 'border-danger' : 'border-neutral',
          className,
        )}
        {...rest}
      />

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

export default DatePicker;
