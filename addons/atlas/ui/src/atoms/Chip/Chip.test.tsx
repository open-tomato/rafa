import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, mock } from 'bun:test';

import { Chip } from './Chip.js';

describe('Chip', () => {
  it('renders the remove button and calls back when it is pressed', () => {
    const onRemove = mock(() => undefined);
    render(<Chip onRemove={onRemove}>status: running</Chip>);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.getByText('status: running').className).toContain('pr-1.5');
  });

  it('has no button and the even padding without a remove handler', () => {
    render(<Chip icon={<svg data-testid="icon" />}>assigned: me</Chip>);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('assigned: me').className).toContain('px-3');
    expect(screen.getByTestId('icon').parentElement?.className).toContain('text-series-1');
  });
});
