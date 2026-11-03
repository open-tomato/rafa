import type { Meta, StoryObj } from '@storybook/react-vite';

import { InfoView } from './InfoView.js';

const meta = {
  title: 'Molecules/InfoView',
  component: InfoView,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    subtitle: 'Millions, last 30 days',
    description: 'Each bar is one day of input and output tokens, summed across models.',
    source: 'Fixed sample: tokens by day for one month.',
  },
  decorators: [(Story) => <div className="w-96"><Story /></div>],
} satisfies Meta<typeof InfoView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Described: Story = {};
export const Undescribed: Story = { args: { description: undefined } };
export const WithNoteAndLegend: Story = {
  args: {
    note: 'cache reads count as input.',
    legend: [
      { id: 'input', label: 'Input', tone: 'series-1' },
      { id: 'output', label: 'Output', tone: 'series-2' },
    ],
  },
};
