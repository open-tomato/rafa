import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { CardHeader } from './CardHeader.js';

describe('CardHeader', () => {
  it('renders the title as a heading with its subtitle', () => {
    render(<CardHeader title="Tokens" subtitle="per day" />);

    expect(screen.getByRole('heading', { name: 'Tokens' })).toBeDefined();
    expect(screen.getByText('per day')).toBeDefined();
  });

  it('renders the actions slot', () => {
    render(<CardHeader title="Tokens" actions={<button type="button">Pick</button>} />);

    expect(screen.getByRole('button', { name: 'Pick' })).toBeDefined();
  });
});
