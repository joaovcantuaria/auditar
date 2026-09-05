import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox } from '../Checkbox';

describe('Checkbox', () => {
  it('associates the label with the control', () => {
    render(<Checkbox label="Aceito os termos" />);
    expect(screen.getByLabelText('Aceito os termos')).toBeInTheDocument();
  });

  it('toggles via keyboard (Space) and fires onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox label="Aceito os termos" onChange={onChange} />);

    const checkbox = screen.getByLabelText('Aceito os termos') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    checkbox.focus();
    await user.keyboard(' ');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(checkbox.checked).toBe(true);
  });

  it('reflects the indeterminate state', () => {
    render(<Checkbox label="Selecionar tudo" indeterminate />);
    const checkbox = screen.getByLabelText('Selecionar tudo') as HTMLInputElement;
    expect(checkbox.indeterminate).toBe(true);
    expect(checkbox).toHaveAttribute('aria-checked', 'mixed');
  });
});
