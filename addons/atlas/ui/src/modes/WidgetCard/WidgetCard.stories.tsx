import type { CardSpec } from '../../contract/schemas.js';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { userEvent, within } from 'storybook/test';

import { StatTile } from '../../atoms/StatTile/StatTile.js';

import { WidgetCard } from './WidgetCard.js';

interface Landed {
  readonly count: number;
  readonly trend: readonly number[];
}

const CONFIG: CardSpec = {
  id: 'landed',
  title: 'Tasks landed',
  subtitle: 'This week',
  description: 'Tasks whose pull request merged this week, pushed by the host app.',
  chart: { primitive: 'stat' },
};

const meta = {
  title: 'Modes/WidgetCard',
  component: WidgetCard<Landed>,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    config: CONFIG,
    data: { count: 128, trend: [12, 14, 11, 16, 18, 17, 21, 19, 23, 22, 26, 28] },
    table: (data: Landed) => ({ columns: ['Week', 'Landed'], rows: data.trend.map((value, index) => [`W${index + 1}`, value]) }),
    children: ({ data }) => <StatTile label="Landed" value={String(data.count)} trend={data.trend} delta={{ text: '+12% vs last 4 weeks', direction: 'up' }} />,
  },
  decorators: [(Story) => <div className="h-80 w-80"><Story /></div>],
} satisfies Meta<typeof WidgetCard<Landed>>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Widget: Story = {};
export const AwaitingFirstPush: Story = { args: { data: undefined } };
export const InfoOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Options for Tasks landed' }));
    await userEvent.click(canvas.getByRole('menuitem', { name: 'Info' }));
  },
};
