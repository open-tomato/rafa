import type { CardSpec } from '../../contract/schemas.js';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { SnapshotCard } from './SnapshotCard.js';

const CONFIG: CardSpec = {
  id: 'tokens',
  title: 'Tokens',
  subtitle: 'per day',
  source: 'Fixed sample',
  chart: { primitive: 'bar' },
  legend: { toggleable: true },
};

const LEGEND = [
  { id: 'input', label: 'Input', tone: 'series-1' },
  { id: 'output', label: 'Output', tone: 'series-2' },
] as const;

describe('SnapshotCard', () => {
  it('renders to static markup on the server, with the header, legend and chart', () => {
    const html = renderToStaticMarkup(
      <SnapshotCard config={CONFIG} data={{ total: 160 }} legend={LEGEND}>
        {({ data, animate }) => <p>{`total ${data.total}, animate ${String(animate)}`}</p>}
      </SnapshotCard>,
    );

    expect(html).toContain('<h3');
    expect(html).toContain('Tokens');
    expect(html).toContain('Input');
    expect(html).toContain('total 160, animate false');
    expect(html).toContain('Source: Fixed sample');
    expect(html).not.toContain('aria-haspopup');
    expect(html).not.toContain('<button');
  });

  it('has no menu, modals or legend toggles in the DOM either', () => {
    render(<SnapshotCard config={CONFIG} data={1} legend={LEGEND}>{() => 'chart'}</SnapshotCard>);

    expect(screen.getByRole('region', { name: 'Tokens' })).toBeDefined();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
