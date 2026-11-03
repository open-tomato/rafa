import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { SmallStatCard } from './SmallStatCard.js';

describe('SmallStatCard', () => {
  it('renders a region named by its title, the value compact, and the goal and unit as a suffix', () => {
    render(<SmallStatCard title="budget" value={1_070_000} goal={4_000_000} unit="tokens" />);
    const card = screen.getByRole('region', { name: 'budget' });

    expect(card.textContent).toContain('1.1M');
    expect(screen.getByText('/ 4M tokens').className).toContain('font-mono');
  });

  it('puts the trend in the top-right slot ahead of a decoration', () => {
    render(<SmallStatCard title="sessions" value={247} trend={0.12} decoration={<span>dot</span>} />);

    expect(screen.getByRole('img', { name: 'trending up +12%' })).toBeTruthy();
    expect(screen.queryByText('dot')).toBeNull();
  });

  it('lays the aside beside the value and the delta line under them, inked by its reading', () => {
    render(
      <SmallStatCard
        title="Plans completed this week"
        value={<span>9 of 10</span>}
        aside={<svg data-testid="spark" />}
        delta={{ text: '90% completion, vs 71% four-week average', direction: 'up' }}
        footer="proxy"
      />,
    );
    const row = screen.getByTestId('spark').parentElement?.parentElement;
    const delta = screen.getByText('90% completion, vs 71% four-week average');

    expect(row?.textContent).toBe('9 of 10');
    expect(row?.nextElementSibling).toBe(delta);
    expect(delta.className).toContain('text-delta-up');
    expect(screen.getByText('proxy').className).toContain('mt-auto');
  });
});
