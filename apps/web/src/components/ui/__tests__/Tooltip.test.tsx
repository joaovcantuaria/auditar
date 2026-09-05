import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from '../Tooltip';

describe('Tooltip', () => {
  it('reveals content on focus and links it via aria-describedby', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Texto de ajuda">
        <button type="button">Ajuda</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Ajuda' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.tab();
    expect(trigger).toHaveFocus();

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Texto de ajuda');
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);
  });

  it('dismisses on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Texto de ajuda">
        <button type="button">Ajuda</button>
      </Tooltip>,
    );

    await user.tab();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
