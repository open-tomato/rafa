import type { LegendItem } from '../../context/types.js';
import type { CardSpec } from '../../contract/schemas.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';

import { userEvent, within } from 'storybook/test';

import { Sparkline } from '../../atoms/Sparkline/Sparkline.js';

import { ChartCard, type ChartRenderArgs } from './ChartCard.js';

interface Weekly {
  readonly input: readonly number[];
  readonly output: readonly number[];
}

const DATA: Weekly = {
  input: [12, 14, 11, 16, 18, 17, 21, 19, 23, 22, 26, 28],
  output: [4, 5, 5, 6, 7, 6, 8, 8, 9, 9, 10, 11],
};

const LEGEND: readonly LegendItem[] = [
  { id: 'input', label: 'Input', tone: 'series-1' },
  { id: 'output', label: 'Output', tone: 'series-2' },
];

const CONFIG: CardSpec = {
  id: 'tokens',
  title: 'Tokens per week',
  subtitle: 'Thousands, twelve weeks',
  description: 'Input and output tokens per week, summed across models.',
  source: 'Fixed sample',
  chart: { primitive: 'line' },
  legend: { mark: 'line', toggleable: true },
};

/** The story's stand-in chart: one sparkline per shown series. */
function SampleChart({ data, hidden, maximised }: ChartRenderArgs<Weekly>): ReactNode {
  const width = maximised
    ? 640
    : 320;
  return (
    <div className="flex flex-col gap-2">
      {LEGEND.filter((item) => !hidden.has(item.id)).map((item) => (
        <Sparkline key={item.id} values={item.id === 'input'
          ? data.input
          : data.output} tone={item.tone} width={width} height={56} label={item.label} />
      ))}
    </div>
  );
}

const meta = {
  title: 'Organisms/ChartCard',
  component: ChartCard<Weekly>,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    config: CONFIG,
    data: DATA,
    legend: LEGEND,
    table: (data: Weekly) => ({ columns: ['Week', 'Input', 'Output'], rows: data.input.map((value, index) => [`W${index + 1}`, value, data.output[index] ?? 0]) }),
    children: SampleChart,
  },
  decorators: [(Story) => <div className="h-[28rem] w-[26rem]"><Story /></div>],
} satisfies Meta<typeof ChartCard<Weekly>>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Opens the card menu. */
async function openMenu(canvasElement: HTMLElement): Promise<ReturnType<typeof within>> {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Options for Tokens per week' }));
  return canvas;
}

export const Default: Story = {};
export const SeriesHidden: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Output' }));
  },
};
export const Loading: Story = { args: { data: undefined, status: 'loading' } };
export const NotInteractive: Story = { args: { interactive: false } };
export const MenuOpen: Story = { args: { configurable: true }, play: async ({ canvasElement }) => {
  await openMenu(canvasElement);
} };
export const ConfigOpen: Story = {
  args: { configurable: true },
  play: async ({ canvasElement }) => {
    const canvas = await openMenu(canvasElement);
    await userEvent.click(canvas.getByRole('menuitem', { name: 'Configure' }));
  },
};
