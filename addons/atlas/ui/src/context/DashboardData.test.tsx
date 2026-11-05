import type { TimeRange } from '../contract/schemas.js';
import type { ReactElement } from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { DashboardData, useDashboard, useDashboardSlice } from './DashboardData.js';

interface PageResult {
  readonly tokens: number;
  readonly range: TimeRange;
}

/** A page source that answers a bigger total each time it is asked. */
function countingSource(): { source: (range: TimeRange) => Promise<PageResult>; calls: () => number } {
  let calls = 0;
  return {
    source: async (range) => {
      calls += 1;
      return { tokens: calls * 100, range };
    },
    calls: () => calls,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function TokensSlice(): ReactElement {
  const slice = useDashboardSlice((result: PageResult) => `${result.tokens} tokens over ${result.range}`, 'tokens');
  return <p data-testid="slice">{slice.data ?? slice.status}{` r${slice.revision}`}</p>;
}

function Toolbar(): ReactElement {
  const { refresh, setRange, refreshCard } = useDashboard<PageResult>();
  return (
    <>
      <button type="button" onClick={refresh}>refresh page</button>
      <button type="button" onClick={() => setRange('last-year')}>last year</button>
      <button type="button" onClick={() => refreshCard('tokens')}>refresh card</button>
    </>
  );
}

describe('DashboardData', () => {
  it('feeds a slice from the page result for the default range', async () => {
    const { source } = countingSource();
    render(<DashboardData source={source}><TokensSlice /></DashboardData>);

    expect(screen.getByTestId('slice').textContent).toBe('loading r0');
    await flush();
    expect(screen.getByTestId('slice').textContent).toBe('100 tokens over past-month r0');
  });

  it('re-renders the slice from a page refresh', async () => {
    const { source, calls } = countingSource();
    render(<DashboardData source={source}><Toolbar /><TokensSlice /></DashboardData>);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'refresh page' }));
    await flush();

    expect(screen.getByTestId('slice').textContent).toBe('200 tokens over past-month r0');
    expect(calls()).toBe(2);
  });

  it('asks again for a new page range', async () => {
    const { source } = countingSource();
    render(<DashboardData source={source} defaultRange="now"><Toolbar /><TokensSlice /></DashboardData>);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'last year' }));
    await flush();

    expect(screen.getByTestId('slice').textContent).toBe('200 tokens over last-year r0');
  });

  it('refreshes one card alone without asking the source', async () => {
    const { source, calls } = countingSource();
    render(<DashboardData source={source}><Toolbar /><TokensSlice /></DashboardData>);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'refresh card' }));

    expect(screen.getByTestId('slice').textContent).toBe('100 tokens over past-month r1');
    expect(calls()).toBe(1);
  });

  it('takes a static result set', () => {
    render(<DashboardData data={{ tokens: 7, range: 'now' }}><TokensSlice /></DashboardData>);

    expect(screen.getByTestId('slice').textContent).toBe('7 tokens over now r0');
  });
});
