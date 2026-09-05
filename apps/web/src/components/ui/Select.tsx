import { forwardRef, useId } from 'react';
import type { SelectHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SelectOption {
  label: string;
  value: string | number;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Visible label associated with the select via htmlFor/id. */
  label: string;
  /** Error message. When present the field is marked aria-invalid. */
  error?: string;
  /** Helper text shown below the field when there is no error. */
  helperText?: string;
  /** Marks the field as required and shows a visual required indicator. */
  required?: boolean;
  /** Optional array of options. Alternatively pass <option> children. */
  options?: SelectOption[];
  /** Optional placeholder rendered as a disabled first option. */
  placeholder?: string;
  children?: ReactNode;
}

/**
 * Accessible native `<select>` sharing the same label/error/helper contract as Input.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, helperText, required, options, placeholder, id, className, children, ...rest },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const errorId = `${selectId}-error`;
  const helperId = `${selectId}-helper`;

  const describedBy = error ? errorId : helperText ? helperId : undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={selectId} className="text-sm font-medium text-text-primary">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>

      <select
        ref={ref}
        id={selectId}
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
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options
          ? options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))
          : children}
      </select>

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

export default Select;
