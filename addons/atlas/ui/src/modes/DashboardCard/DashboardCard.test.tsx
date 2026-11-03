import type { CardSpec } from '../../contract/schemas.js';
import type { ReactElement } from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { DashboardData, useDashboard } from '../../context/DashboardData.js';

import { DashboardCard } from './DashboardCard.js';

interface PageResult {
  readonly tokens: number;
  readonly runs: number;
}

const TOKENS: CardSpec = { id: 'tokens', title: 'Tokens', chart: { primitive: 'bar' } };
const RUNS: CardSpec = { id: 'runs', title: 'Runs', chart: { primitive: 'line' } };

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function Toolbar(): ReactElement {
  const { refresh, refreshCard } = useDashboard<PageResult>();
  return (
    <>
      <button type="button" onClick={refresh}>refresh page</button>
      <button type="button" onClick={() => refreshCard('tokens')}>refresh tokens</button>
    </>
  );
}

describe('DashboardCard', () => {
  it('renders its slice of the page result, and every card re-renders on a page refresh', async () => {
    let calls = 0;
    const source = async (): Promise<PageResult> => {
      calls += 1;
      return { tokens: calls * 100, runs: calls };
    };
    render(
      <DashboardData source={source}>
        <Toolbar />
        <DashboardCard config={TOKENS} select={(result: PageResult) => result.tokens}>{({ data }) => `tokens ${data}`}</DashboardCard>
        <DashboardCard config={RUNS} select={(result: PageResult) => result.runs}>{({ data }) => `runs ${data}`}</DashboardCard>
      </DashboardData>,
    );
    await flush();

    expect(screen.getByText('tokens 100')).toBeDefined();
    expect(screen.getByText('runs 1')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'refresh page' }));
    await flush();
    expect(screen.getByText('tokens 200')).toBeDefined();
    expect(screen.getByText('runs 2')).toBeDefined();
  });

  it('starts one card over on its own refresh, leaving the others', async () => {
    const legend = [
      { id: 'a', label: 'A', tone: 'series-1' },
      { id: 'b', label: 'B', tone: 'series-2' },
    ] as const;
    const config: CardSpec = { ...TOKENS, legend: { toggleable: true } };
    render(
      <DashboardData data={{ tokens: 5, runs: 1 }}>
        <Toolbar />
        <DashboardCard config={config} legend={legend} select={(result: PageResult) => result.tokens}>
          {({ hidden }) => `hidden ${[...hidden].join(',') || 'none'}`}
        </DashboardCard>
      </DashboardData>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'B' }));

    expect(screen.getByText('hidden b')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'refresh tokens' }));
    expect(screen.getByText('hidden none')).toBeDefined();
  });
});
