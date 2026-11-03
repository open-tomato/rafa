import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, mock } from 'bun:test';

import { Button } from './Button.js';

describe('Button', () => {
  it('renders a button that never submits by default', () => {
    render(<Button>Try again</Button>);

    expect(screen.getByRole('button', { name: 'Try again' }).getAttribute('type')).toBe('button');
  });

  it('calls onClick', () => {
    const onClick = mock(() => undefined);
    render(<Button variant="icon" aria-label="Close" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('paints the critical tone and merges the passthrough last', () => {
    render(<Button variant="menuitem" tone="critical" className="ml-1">Errors</Button>);
    const button = screen.getByRole('button', { name: 'Errors' });

    expect(button.className).toContain('text-critical');
    expect(button.className.endsWith('ml-1')).toBe(true);
  });
});
