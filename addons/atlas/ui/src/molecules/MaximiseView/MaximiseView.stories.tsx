import type { LegendItem } from '../../context/types.js';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { echartsEngine, type BarSeries } from '@open-tomato/charts';
import { userEvent, within } from 'storybook/test';

import { Legend } from '../../atoms/Legend/Legend.js';
import { SourceView } from '../SourceView/SourceView.js';

import { MaximiseView } from './MaximiseView.js';

const { BarChart } = echartsEngine;

const WEEKS = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'];

const SERIES: readonly BarSeries[] = [
  { id: 'input', label: 'Input', tone: 'series-1', values: [12, 14, 11, 16, 18, 17] },
  { id: 'output', label: 'Output', tone: 'series-2', values: [4, 5, 5, 6, 7, 6] },
];

const LEGEND: readonly LegendItem[] = SERIES.map(({ id, label, tone }) => ({ id, label, tone }));

const TABLE = {
  columns: ['Week', 'Input', 'Output'],
  rows: WEEKS.map((week, index) => [week, SERIES[0]?.values[index] ?? 0, SERIES[1]?.values[index] ?? 0]),
};

const meta = {
  title: 'Molecules/MaximiseView',
  component: MaximiseView,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    title: 'Tokens per week',
    onClose: () => undefined,
    legend: <Legend items={LEGEND} />,
    table: <SourceView table={TABLE} caption="Tokens per week" source="Fixed sample" />,
    children: ({ height }) => (
      <BarChart ariaLabel="Tokens per week by kind" categories={WEEKS} series={SERIES} height={height} animate={false} />
    ),
  },
  // The dialog sits in the top layer, so the root needs content of its own to count as visible.
  decorators: [(Story) => <div className="h-40"><p>The page under the dialog.</p><Story /></div>],
} satisfies Meta<typeof MaximiseView>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The default size, medium, with both toggles off. */
export const Default: Story = {};
/** The card asked for the large box. */
export const Large: Story = { args: { options: { size: 'large' } } };
/** The card shows its legend always and its table behind a toggle that starts on. */
export const AlwaysAndToggleOn: Story = { args: { options: { legend: 'always', table: 'toggle-on' } } };
export const LegendAndTableOn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Legend' }));
    await userEvent.click(await canvas.findByRole('button', { name: 'Table' }));
    // The extras add below the chart, so the body scrolls down to show them.
    (await canvas.findByRole('table')).scrollIntoView({ block: 'end' });
  },
};
/** A card with no table: the Table toggle is left out. */
export const WithoutTable: Story = { args: { table: undefined } };
