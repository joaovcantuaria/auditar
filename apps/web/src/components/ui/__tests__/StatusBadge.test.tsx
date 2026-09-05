import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusProcesso } from '@auditar/shared';
import { StatusBadge } from '../StatusBadge';

describe('StatusBadge', () => {
  it('renders green with the Portuguese label for aprovado', () => {
    render(<StatusBadge status={StatusProcesso.APROVADO} />);
    const badge = screen.getByText('Aprovado');
    expect(badge.className).toContain('text-success');
  });

  it('renders yellow for em_andamento', () => {
    render(<StatusBadge status={StatusProcesso.EM_ANDAMENTO} />);
    const badge = screen.getByText('Em andamento');
    expect(badge.className).toContain('text-warning');
  });

  it('renders red for rejeitado', () => {
    render(<StatusBadge status={StatusProcesso.REJEITADO} />);
    const badge = screen.getByText('Rejeitado');
    expect(badge.className).toContain('text-danger');
  });

  it('renders blue for aberto and aguardando statuses', () => {
    const { rerender } = render(<StatusBadge status={StatusProcesso.ABERTO} />);
    expect(screen.getByText('Aberto').className).toContain('text-primary');

    rerender(<StatusBadge status={StatusProcesso.AGUARDANDO_DOCS} />);
    expect(screen.getByText('Aguardando documentos').className).toContain('text-primary');
  });
});
