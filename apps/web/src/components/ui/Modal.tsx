import { useCallback, useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalProps {
  /** Whether the modal is visible. */
  open: boolean;
  /** Called when the user requests to close (Escape, backdrop click, close button). */
  onClose: () => void;
  /** Accessible dialog title, referenced by aria-labelledby. */
  title: ReactNode;
  children: ReactNode;
  /** Optional footer area (e.g. action buttons). */
  footer?: ReactNode;
  /** Max width preset. */
  size?: ModalSize;
  /** Close when clicking the backdrop. Defaults to true. */
  closeOnBackdrop?: boolean;
  /** Show the header close (X) button. Defaults to true. */
  showCloseButton?: boolean;
  className?: string;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog rendered in a portal on document.body.
 * - role="dialog" + aria-modal="true" + aria-labelledby (title)
 * - Focus moves inside on open and returns to the trigger on close
 * - Tab is trapped within the dialog
 * - Escape and backdrop click close it
 * - Body scroll is locked while open
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  showCloseButton = true,
  className,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);

        if (focusable.length === 0) {
          event.preventDefault();
          dialogRef.current.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    // Move focus into the dialog (first focusable element, else the dialog itself).
    const node = dialogRef.current;
    if (node) {
      const focusable = node.querySelector<HTMLElement>(FOCUSABLE);
      (focusable ?? node).focus();
    }

    // Lock body scroll.
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = originalOverflow;
      // Return focus to the element that was focused before opening.
      previouslyFocused.current?.focus?.();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="modal-overlay"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        data-testid="modal-backdrop"
        onClick={closeOnBackdrop ? onClose : undefined}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative z-10 flex w-full max-h-[90vh] flex-col rounded-card bg-white shadow-xl outline-none',
          sizeClasses[size],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-bg-alt p-4">
          <h2 id={titleId} className="font-heading text-h3 text-text-primary">
            {title}
          </h2>
          {showCloseButton && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className={cn(
                'min-h-touch min-w-touch inline-flex items-center justify-center rounded-btn text-text-secondary',
                'hover:bg-bg-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              )}
            >
              <span aria-hidden="true" className="text-xl leading-none">
                ×
              </span>
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">{children}</div>

        {footer && (
          <div className="flex justify-end gap-2 border-t border-bg-alt p-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default Modal;
