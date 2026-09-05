import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Alert } from '../Alert';

describe('Alert', () => {
  it('uses role="alert" for danger and shows the message', () => {
    render(<Alert variant="danger">Falha ao salvar</Alert>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Falha ao salvar');
  });

  it('uses role="status" for info', () => {
    render(<Alert variant="info">Processo atualizado</Alert>);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Processo atualizado');
  });

  it('renders an optional title', () => {
    render(
      <Alert variant="success" title="Sucesso">
        Tudo certo
      </Alert>,
    );
    expect(screen.getByText('Sucesso')).toBeInTheDocument();
    expect(screen.getByText('Tudo certo')).toBeInTheDocument();
  });
});
