import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../Button';

describe('Button', () => {
  it('renders its children', () => {
    render(<Button>Salvar</Button>);
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument();
  });

  it('fires onClick when pressed', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Enviar</Button>);

    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Enviar
      </Button>,
    );

    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows a spinner and sets aria-busy when loading', () => {
    render(<Button loading>Carregando</Button>);

    const button = screen.getByRole('button', { name: /Carregando/ });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    // Spinner exposes role="status".
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('keeps a minimum 44px touch target', () => {
    render(<Button>Ok</Button>);
    const button = screen.getByRole('button', { name: 'Ok' });
    expect(button.className).toContain('min-h-touch');
    expect(button.className).toContain('min-w-touch');
  });
});
