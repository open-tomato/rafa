import type { CardSpec } from '../../contract/schemas.js';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Sparkline } from '../../atoms/Sparkline/Sparkline.js';

import { SnapshotCard } from './SnapshotCard.js';

interface Weekly {
  readonly input: readonly number[];
  readonly output: readonly number[];
}

const CONFIG: CardSpec = {
  id: 'tokens',
  title: 'Tokens per week',
  subtitle: 'Thousands, twelve weeks',
  source: 'Fixed sample',
  chart: { primitive: 'line' },
  legend: { mark: 'line' },
};

const DATA: Weekly = {
  input: [12, 14, 11, 16, 18, 17, 21, 19, 23, 22, 26, 28],
  output: [4, 5, 5, 6, 7, 6, 8, 8, 9, 9, 10, 11],
};

const meta = {
  title: 'Modes/SnapshotCard',
  component: SnapshotCard<Weekly>,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    config: CONFIG,
    data: DATA,
    legend: [
      { id: 'input', label: 'Input', tone: 'series-1' },
      { id: 'output', label: 'Output', tone: 'series-2' },
    ],
    children: ({ data }) => (
      <div className="flex flex-col gap-2">
        <Sparkline values={data.input} tone="series-1" width={320} height={56} label="Input" />
        <Sparkline values={data.output} tone="series-2" width={320} height={56} label="Output" />
      </div>
    ),
  },
  decorators: [(Story) => <div className="w-[26rem]"><Story /></div>],
} satisfies Meta<typeof SnapshotCard<Weekly>>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Snapshot: Story = {};
export const WithoutLegend: Story = { args: { legend: undefined, config: { ...CONFIG, source: undefined } } };
