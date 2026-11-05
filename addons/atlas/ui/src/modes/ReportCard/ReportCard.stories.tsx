import type { CardSpec, TimeRange } from '../../contract/schemas.js';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { userEvent, within } from 'storybook/test';

import { Sparkline } from '../../atoms/Sparkline/Sparkline.js';

import { ReportCard } from './ReportCard.js';

/** One fixed series per range, so the story is the same on every run. */
const SERIES: Readonly<Record<TimeRange, readonly number[]>> = {
  'now': [3, 4],
  'last-week': [12, 14, 11, 16, 18, 17, 21],
  'past-month': [12, 14, 11, 16, 18, 17, 21, 19, 23, 22, 26, 28],
  'last-year': [40, 52, 48, 61, 66, 70, 74, 80, 77, 85, 90, 96],
};

const CONFIG: CardSpec = {
  id: 'tokens',
  title: 'Tokens',
  subtitle: 'Thousands',
  description: 'Tokens per period for the range the card is set to.',
  range: 'past-month',
  chart: { primitive: 'line' },
};

const meta = {
  title: 'Modes/ReportCard',
  component: ReportCard<readonly number[]>,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    config: CONFIG,
    source: async (range: TimeRange | undefined) => SERIES[range ?? 'past-month'],
    table: (data: readonly number[]) => ({ columns: ['Period', 'Tokens'], rows: data.map((value, index) => [`P${index + 1}`, value]) }),
    children: ({ data }) => <Sparkline values={data} tone="series-1" width={320} height={100} label="Tokens" />,
  },
  decorators: [(Story) => <div className="h-[30rem] w-[26rem]"><Story /></div>],
} satisfies Meta<typeof ReportCard<readonly number[]>>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Report: Story = {};
export const ConfigOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Options for Tokens' }));
    await userEvent.click(canvas.getByRole('menuitem', { name: 'Configure' }));
  },
};
