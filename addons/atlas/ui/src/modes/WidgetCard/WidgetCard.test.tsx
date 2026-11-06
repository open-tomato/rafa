import type { CardSpec } from '../../contract/schemas.js';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { WidgetCard } from './WidgetCard.js';

const CONFIG: CardSpec = { id: 'tokens', title: 'Tokens', description: 'Pushed by the host.', chart: { primitive: 'bar' } };

describe('WidgetCard', () => {
  it('renders the data it is pushed and re-renders on a new push', () => {
    const { rerender } = render(<WidgetCard config={CONFIG} data={1}>{({ data }) => `value ${data}`}</WidgetCard>);

    expect(screen.getByText('value 1')).toBeDefined();
    rerender(<WidgetCard config={CONFIG} data={2}>{({ data }) => `value ${data}`}</WidgetCard>);
    expect(screen.getByText('value 2')).toBeDefined();
  });

  it('shows loading until the first push', () => {
    render(<WidgetCard<number> config={CONFIG} data={undefined}>{({ data }) => `value ${data}`}</WidgetCard>);

    expect(screen.getByRole('status').textContent).toContain('Loading');
  });

  it('keeps the menu and modals on', () => {
    render(<WidgetCard config={CONFIG} data={1}>{() => 'chart'}</WidgetCard>);
    fireEvent.click(screen.getByRole('button', { name: 'Options for Tokens' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Info' }));

    expect(screen.getByRole('dialog', { name: 'Tokens' }).textContent).toContain('Pushed by the host.');
  });
});
