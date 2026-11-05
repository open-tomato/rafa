import type { CardSpec, TimeRange } from '../../contract/schemas.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactElement } from 'react';

import { Sparkline } from '../../atoms/Sparkline/Sparkline.js';
import { DashboardData, useDashboard } from '../../context/DashboardData.js';
import { RangeSelector } from '../../molecules/RangeSelector/RangeSelector.js';

import { DashboardCard } from './DashboardCard.js';

interface PageResult {
  readonly tokens: readonly number[];
  readonly runs: readonly number[];
}

/** One fixed result set per range, so the story is the same on every run. */
const RESULTS: Readonly<Record<TimeRange, PageResult>> = {
  'now': { tokens: [3, 4], runs: [1, 2] },
  'last-week': { tokens: [12, 14, 11, 16, 18, 17, 21], runs: [3, 4, 4, 5, 3, 6, 5] },
  'past-month': { tokens: [12, 14, 11, 16, 18, 17, 21, 19, 23, 22, 26, 28], runs: [3, 4, 4, 5, 3, 6, 5, 7, 6, 8, 7, 9] },
  'last-year': { tokens: [40, 52, 48, 61, 66, 70, 74, 80, 77, 85, 90, 96], runs: [10, 12, 15, 14, 18, 20, 19, 23, 25, 24, 28, 30] },
};

const TOKENS: CardSpec = { id: 'tokens', title: 'Tokens', subtitle: 'Thousands', chart: { primitive: 'line' } };
const RUNS: CardSpec = { id: 'runs', title: 'Loop runs', subtitle: 'Count', chart: { primitive: 'line' } };

/** The page's toolbar: the range selector over the page's range. */
function Toolbar(): ReactElement {
  const { range, setRange } = useDashboard<PageResult>();
  return <RangeSelector value={range} onChange={setRange} size="sm" className="self-start" />;
}

const meta = {
  title: 'Modes/DashboardCard',
  component: DashboardCard<PageResult, readonly number[]>,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    config: TOKENS,
    select: (result: PageResult) => result.tokens,
    children: ({ data }) => <Sparkline values={data} tone="series-1" width={260} height={80} label="Tokens" />,
  },
  render: (args) => (
    <DashboardData source={async (range) => RESULTS[range]}>
      <div className="flex w-[40rem] flex-col gap-3">
        <Toolbar />
        <div className="grid grid-cols-2 gap-3">
          <DashboardCard {...args} />
          <DashboardCard<PageResult, readonly number[]> config={RUNS} select={(result) => result.runs}>
            {({ data }) => <Sparkline values={data} tone="series-3" width={260} height={80} label="Loop runs" />}
          </DashboardCard>
        </div>
      </div>
    </DashboardData>
  ),
} satisfies Meta<typeof DashboardCard<PageResult, readonly number[]>>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Dashboard: Story = {};
