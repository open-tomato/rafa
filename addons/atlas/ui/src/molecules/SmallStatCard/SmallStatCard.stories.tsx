import type { Meta, StoryObj } from '@storybook/react-vite';

import { formatterFor } from '@open-tomato/charts';
import { Cpu, DollarSign } from 'lucide-react';

import { Sparkline } from '../../atoms/Sparkline/Sparkline.js';
import { Progress } from '../Progress/Progress.js';

import { SmallStatCard } from './SmallStatCard.js';

/** A fixed 30-point series. */
const TOKENS_30D = [
  22, 26, 30, 12, 10, 28, 34, 38, 31, 14,
  11, 33, 39, 41, 36, 15, 13, 38, 44, 40,
  37, 16, 14, 42, 47, 45, 41, 18, 46, 52,
];

const money = formatterFor({ kind: 'money' }, { locale: 'en-US', currency: 'USD' });

const meta = {
  title: 'Molecules/SmallStatCard',
  component: SmallStatCard,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  decorators: [(Story) => <div className="w-64"><Story /></div>],
} satisfies Meta<typeof SmallStatCard>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A goal suffix (`/ 4M`) and a sparkline in the aside column. */
export const Default: Story = {
  args: { title: 'tokens used', value: 1_070_000, goal: 4_000_000, aside: <Sparkline values={TOKENS_30D} tone="good" label="tokens per day" /> },
};

/** The top-right trend: a signed percentage from a ratio. */
export const WithTrend: Story = {
  args: { title: 'sessions', value: 247, trend: 0.12, aside: <Sparkline values={TOKENS_30D.map((value) => value % 7)} tone="good" label="sessions per day" /> },
};

/** The top-right decoration: an icon, a status dot, a label. */
export const WithDecoration: Story = {
  args: { title: 'live now', value: 3, unit: 'sessions', decoration: <span className="size-2 rounded-full bg-good" aria-label="active" role="status" /> },
};

/** A unit suffix, small and greyed, right of the value. */
export const WithUnit: Story = {
  args: { title: 'avg / session', value: 36_200, unit: 'tokens', decoration: <Cpu size={14} className="text-muted" aria-hidden="true" /> },
};

/** A formatted node as the value: money through the formatting layer. */
export const CurrencyValue: Story = {
  args: { title: 'cost today', value: money(12.86), trend: 0.08, decoration: <DollarSign size={14} className="text-muted" aria-hidden="true" /> },
};

/** A link as the pinned footer. */
export const WithLinkFooter: Story = {
  args: { title: 'errors', value: 4, trend: -0.3, footer: <a href="#sessions" className="text-series-1 underline-offset-2 hover:underline">View all sessions</a> },
};

/** A progress bar as the pinned footer. */
export const WithProgressFooter: Story = {
  args: { title: 'budget', value: 1_070_000, goal: 4_000_000, unit: 'tokens', footer: <Progress value={27} label="27% of budget" /> },
};

/** The two columns: the sparkline beside the value, the delta line under both at the whole width. */
export const TwoColumns: Story = {
  args: {
    title: 'Plans completed this week',
    value: <span>9 of 10</span>,
    aside: <Sparkline values={[7, 8, 6, 9, 8, 7, 9]} tone="good" label="plans per week" />,
    delta: { text: '90% completion, vs 71% four-week average', direction: 'up' },
  },
};

/** Compact (`size="sm"`): no footer room. */
export const Compact: Story = {
  args: { title: 'tool calls', value: 4_734, unit: 'calls', size: 'sm' },
};
