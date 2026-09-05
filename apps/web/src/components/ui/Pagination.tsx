import { cn } from '@/lib/cn';

export interface PaginationProps {
  /** Current page (1-based). */
  page: number;
  /** Total number of pages (>= 1). */
  totalPages: number;
  /** Called with the target page when the user navigates. */
  onPageChange: (page: number) => void;
  /** Accessible label for the navigation landmark. */
  ariaLabel?: string;
  /** Max number of numbered page buttons to show before truncating. Defaults to 7. */
  maxButtons?: number;
  className?: string;
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2';

const baseButton =
  'inline-flex items-center justify-center min-h-touch min-w-touch rounded-btn px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed';

/**
 * Builds the list of page tokens to render, inserting `'ellipsis'` markers when
 * there are more pages than `maxButtons`. Always keeps first, last and a window
 * around the current page.
 */
export function getPageItems(
  page: number,
  totalPages: number,
  maxButtons: number,
): Array<number | 'ellipsis'> {
  if (totalPages <= maxButtons) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const items: Array<number | 'ellipsis'> = [];
  const siblings = 1;
  const first = 1;
  const last = totalPages;

  const start = Math.max(first + 1, page - siblings);
  const end = Math.min(last - 1, page + siblings);

  items.push(first);
  if (start > first + 1) items.push('ellipsis');
  for (let p = start; p <= end; p += 1) items.push(p);
  if (end < last - 1) items.push('ellipsis');
  items.push(last);

  return items;
}

/**
 * Accessible page navigation. Renders Prev/Next controls (disabled at the
 * bounds) plus numbered page buttons. The active page is marked with
 * `aria-current="page"`. Every control has a >=44px touch target and a visible
 * focus ring, and the whole thing is keyboard operable via native buttons.
 */
export function Pagination({
  page,
  totalPages,
  onPageChange,
  ariaLabel = 'Paginação',
  maxButtons = 7,
  className,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const clampedPage = Math.min(Math.max(page, 1), totalPages);
  const isFirst = clampedPage <= 1;
  const isLast = clampedPage >= totalPages;

  const items = getPageItems(clampedPage, totalPages, maxButtons);

  const go = (target: number) => {
    if (target < 1 || target > totalPages || target === clampedPage) return;
    onPageChange(target);
  };

  return (
    <nav aria-label={ariaLabel} className={cn('flex items-center gap-1', className)}>
      <button
        type="button"
        onClick={() => go(clampedPage - 1)}
        disabled={isFirst}
        aria-label="Página anterior"
        className={cn(
          baseButton,
          focusRing,
          'border border-neutral bg-white text-text-primary hover:bg-bg-alt disabled:opacity-50',
        )}
      >
        <span aria-hidden="true">‹</span>
      </button>

      <ul className="flex items-center gap-1">
        {items.map((item, index) =>
          item === 'ellipsis' ? (
            <li key={`ellipsis-${index}`} aria-hidden="true" className="px-2 text-text-secondary">
              …
            </li>
          ) : (
            <li key={item}>
              <button
                type="button"
                onClick={() => go(item)}
                aria-current={item === clampedPage ? 'page' : undefined}
                aria-label={`Página ${item}`}
                className={cn(
                  baseButton,
                  focusRing,
                  item === clampedPage
                    ? 'bg-primary text-white'
                    : 'border border-neutral bg-white text-text-primary hover:bg-bg-alt',
                )}
              >
                {item}
              </button>
            </li>
          ),
        )}
      </ul>

      <button
        type="button"
        onClick={() => go(clampedPage + 1)}
        disabled={isLast}
        aria-label="Próxima página"
        className={cn(
          baseButton,
          focusRing,
          'border border-neutral bg-white text-text-primary hover:bg-bg-alt disabled:opacity-50',
        )}
      >
        <span aria-hidden="true">›</span>
      </button>
    </nav>
  );
}

export default Pagination;
