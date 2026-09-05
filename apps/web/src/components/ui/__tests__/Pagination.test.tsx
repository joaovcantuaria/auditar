import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pagination, getPageItems } from '../Pagination';

describe('Pagination', () => {
  it('renders nothing for a single page', () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} onPageChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('disables Prev on the first page', () => {
    render(<Pagination page={1} totalPages={5} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Próxima página' })).toBeEnabled();
  });

  it('disables Next on the last page', () => {
    render(<Pagination page={5} totalPages={5} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Próxima página' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeEnabled();
  });

  it('marks the active page with aria-current', () => {
    render(<Pagination page={3} totalPages={5} onPageChange={() => {}} />);
    const active = screen.getByRole('button', { name: 'Página 3' });
    expect(active).toHaveAttribute('aria-current', 'page');
  });

  it('calls onPageChange with the target page', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={2} totalPages={5} onPageChange={onPageChange} />);

    await user.click(screen.getByRole('button', { name: 'Página 4' }));
    expect(onPageChange).toHaveBeenCalledWith(4);

    await user.click(screen.getByRole('button', { name: 'Próxima página' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('does not call onPageChange for the current page', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={2} totalPages={5} onPageChange={onPageChange} />);

    await user.click(screen.getByRole('button', { name: 'Página 2' }));
    expect(onPageChange).not.toHaveBeenCalled();
  });

  describe('getPageItems', () => {
    it('lists every page when they fit', () => {
      expect(getPageItems(1, 5, 7)).toEqual([1, 2, 3, 4, 5]);
    });

    it('truncates with ellipsis for many pages', () => {
      const items = getPageItems(10, 20, 7);
      expect(items[0]).toBe(1);
      expect(items[items.length - 1]).toBe(20);
      expect(items).toContain('ellipsis');
      expect(items).toContain(10);
    });
  });
});
