import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, mock } from 'bun:test';

import { ErrorsView } from './ErrorsView.js';

describe('ErrorsView', () => {
  it('shows the name and message, and retries', () => {
    const onRetry = mock(() => undefined);
    render(<ErrorsView error={new RangeError('bad range')} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('RangeError: bad range')).toBeDefined();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('has no Try again without a retry', () => {
    render(<ErrorsView error={new Error('x')} showStack={false} />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});
