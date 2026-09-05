import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from '../Input';

describe('Input', () => {
  it('associates the label with the control', () => {
    render(<Input label="Nome completo" />);
    // getByLabelText only resolves when label/control are correctly associated.
    expect(screen.getByLabelText('Nome completo')).toBeInTheDocument();
  });

  it('marks the field invalid and announces the error', () => {
    render(<Input label="Email" error="Email inválido" />);

    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');

    const error = screen.getByText('Email inválido');
    expect(error).toHaveAttribute('role', 'alert');
    // Error is referenced by the input via aria-describedby.
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
  });

  it('shows helper text when there is no error', () => {
    render(<Input label="Senha" helperText="Mínimo 8 caracteres" />);

    const input = screen.getByLabelText('Senha');
    const helper = screen.getByText('Mínimo 8 caracteres');
    expect(input.getAttribute('aria-describedby')).toBe(helper.id);
    expect(input).not.toHaveAttribute('aria-invalid');
  });
});
