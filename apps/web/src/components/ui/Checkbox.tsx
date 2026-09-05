import { forwardRef, useEffect, useId, useRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Visible label associated with the checkbox. */
  label: string;
  /** Error message shown below the checkbox. */
  error?: string;
  /** Helper text shown below the checkbox when there is no error. */
  helperText?: string;
  /** Sets the indeterminate visual state (tri-state checkboxes). */
  indeterminate?: boolean;
}

/**
 * Accessible checkbox with an associated label. Native `<input type="checkbox">`
 * gives keyboard toggling (Space) for free. Supports the indeterminate state.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, error, helperText, indeterminate = false, id, className, disabled, ...rest },
  ref,
) {
  const generatedId = useId();
  const checkboxId = id ?? generatedId;
  const errorId = `${checkboxId}-error`;
  const helperId = `${checkboxId}-helper`;
  const innerRef = useRef<HTMLInputElement | null>(null);

  const describedBy = error ? errorId : helperText ? helperId : undefined;

  useEffect(() => {
    if (innerRef.current) {
      innerRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          ref={(node) => {
            innerRef.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          id={checkboxId}
          type="checkbox"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          aria-checked={indeterminate ? 'mixed' : undefined}
          className={cn(
            'h-5 w-5 rounded border-neutral text-primary accent-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-60',
            className,
          )}
          {...rest}
        />
        <label
          htmlFor={checkboxId}
          className={cn('text-sm text-text-primary', disabled && 'text-text-secondary')}
        >
          {label}
        </label>
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

export default Checkbox;
