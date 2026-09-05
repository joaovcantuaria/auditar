import { cloneElement, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  /** Content shown inside the tooltip bubble. */
  content: ReactNode;
  /** Single focusable element that triggers the tooltip. */
  children: ReactElement;
  /** Where the bubble is placed relative to the trigger. Defaults to 'top'. */
  placement?: TooltipPlacement;
  className?: string;
}

const placementClasses: Record<TooltipPlacement, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

/**
 * Accessible tooltip. Reveals `content` on hover and on keyboard focus of the
 * trigger, associates it to the trigger via `aria-describedby`, exposes
 * `role="tooltip"`, and is dismissible with Escape.
 *
 * The single `children` element must be focusable (e.g. a button or link) so
 * keyboard users can reveal the tooltip.
 */
export function Tooltip({ content, children, placement = 'top', className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const tooltipId = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => setVisible(true), []);
  const hide = useCallback(() => setVisible(false), []);

  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setVisible(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible]);

  // Merge our handlers/aria onto the trigger without clobbering existing ones.
  const child = children as ReactElement<{
    'aria-describedby'?: string;
    onFocus?: (e: unknown) => void;
    onBlur?: (e: unknown) => void;
    onMouseEnter?: (e: unknown) => void;
    onMouseLeave?: (e: unknown) => void;
  }>;

  const trigger = cloneElement(child, {
    'aria-describedby': cn(child.props['aria-describedby'], visible ? tooltipId : undefined) || undefined,
    onFocus: (event: unknown) => {
      child.props.onFocus?.(event);
      show();
    },
    onBlur: (event: unknown) => {
      child.props.onBlur?.(event);
      hide();
    },
    onMouseEnter: (event: unknown) => {
      child.props.onMouseEnter?.(event);
      show();
    },
    onMouseLeave: (event: unknown) => {
      child.props.onMouseLeave?.(event);
      hide();
    },
  });

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex"
      onMouseLeave={hide}
    >
      {trigger}
      {visible && (
        <span
          id={tooltipId}
          role="tooltip"
          className={cn(
            'absolute z-50 whitespace-nowrap rounded-btn bg-text-primary px-2 py-1 text-xs font-medium text-white shadow-md',
            placementClasses[placement],
            className,
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}

export default Tooltip;
