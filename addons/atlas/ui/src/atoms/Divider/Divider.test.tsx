import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { Divider } from './Divider.js';

describe('Divider', () => {
  it('renders a plain hairline separator', () => {
    render(<Divider />);
    const rule = screen.getByRole('separator');

    expect(rule.className).toContain('h-px');
    expect(rule.textContent).toBe('');
  });

  it('renders the label between two hairlines', () => {
    render(<Divider label="or with email" />);
    const rule = screen.getByRole('separator');

    expect(rule.textContent).toBe('or with email');
    expect(rule.querySelectorAll('span')).toHaveLength(3);
  });
});
