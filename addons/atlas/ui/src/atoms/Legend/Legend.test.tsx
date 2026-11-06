import type { LegendItem } from '../../context/types.js';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, mock } from 'bun:test';
import { useState, type ReactElement } from 'react';

import { Legend } from './Legend.js';
import { nextHidden } from './toggle.js';

const ITEMS: readonly LegendItem[] = [
  { id: 'a', label: 'Alpha', tone: 'series-1' },
  { id: 'b', label: 'Beta', tone: 'series-2' },
];

function Toggling(): ReactElement {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  return <Legend items={ITEMS} hidden={hidden} onToggle={(id) => setHidden((current) => nextHidden(current, id, ITEMS.length))} />;
}

describe('nextHidden', () => {
  it('hides a shown series and shows a hidden one', () => {
    const hidden = nextHidden(new Set(), 'a', 3);

    expect([...hidden]).toEqual(['a']);
    expect([...nextHidden(hidden, 'a', 3)]).toEqual([]);
  });

  it('keeps the last shown series shown, returning the same set', () => {
    const hidden: ReadonlySet<string> = new Set(['a']);

    expect(nextHidden(hidden, 'b', 2)).toBe(hidden);
  });
});

describe('Legend', () => {
  it('renders nothing for a single series', () => {
    const { container } = render(<Legend items={ITEMS.slice(0, 1)} />);

    expect(container.innerHTML).toBe('');
  });

  it('renders static entries without buttons', () => {
    render(<Legend items={ITEMS} />);

    expect(screen.getByRole('list', { name: 'Legend' })).toBeDefined();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('toggles a series with aria-pressed, and keeps the last one shown', () => {
    render(<Toggling />);
    const alpha = screen.getByRole('button', { name: 'Alpha' });
    const beta = screen.getByRole('button', { name: 'Beta' });

    fireEvent.click(alpha);
    expect(alpha.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(beta);
    expect(beta.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(alpha);
    expect(alpha.getAttribute('aria-pressed')).toBe('true');
  });

  it('calls onToggle with the item id', () => {
    const onToggle = mock<(id: string) => void>(() => undefined);
    render(<Legend items={ITEMS} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));

    expect(onToggle).toHaveBeenCalledWith('b');
  });

  it('stacks its entries beside a maximised chart with the side layout', () => {
    render(<Legend items={ITEMS} layout="side" />);

    expect(screen.getByRole('list', { name: 'Legend' }).className).toContain('landscape:flex-col');
  });
});
