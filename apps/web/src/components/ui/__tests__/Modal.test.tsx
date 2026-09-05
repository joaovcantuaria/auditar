import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '../Modal';

describe('Modal', () => {
  it('exposes an accessible dialog role and modal semantics', () => {
    render(
      <Modal open onClose={() => {}} title="Confirmar">
        <p>Conteúdo</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // Title is linked via aria-labelledby.
    expect(dialog).toHaveAccessibleName('Confirmar');
  });

  it('does not render when closed', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Oculto">
        <p>Conteúdo</p>
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Editar">
        <p>Conteúdo</p>
      </Modal>,
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on backdrop click', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Editar">
        <p>Conteúdo</p>
      </Modal>,
    );

    await user.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus inside on open and restores it on close', async () => {
    const Trigger = () => <button type="button">gatilho</button>;
    const { rerender } = render(
      <>
        <Trigger />
        <Modal open={false} onClose={() => {}} title="Foco">
          <button type="button">interno</button>
        </Modal>
      </>,
    );

    const trigger = screen.getByRole('button', { name: 'gatilho' });
    trigger.focus();
    expect(trigger).toHaveFocus();

    rerender(
      <>
        <Trigger />
        <Modal open onClose={() => {}} title="Foco">
          <button type="button">interno</button>
        </Modal>
      </>,
    );
    // Focus moved into the dialog (first focusable element).
    expect(screen.getByRole('button', { name: 'interno' })).toHaveFocus();

    rerender(
      <>
        <Trigger />
        <Modal open={false} onClose={() => {}} title="Foco">
          <button type="button">interno</button>
        </Modal>
      </>,
    );
    // Focus returned to the trigger.
    expect(trigger).toHaveFocus();
  });
});
