import type { Meta, StoryObj } from '@storybook/react-vite';

import { BAR_CATEGORIES, BAR_SERIES } from '../fixtures.js';

import { BarChart } from './BarChart.js';

const meta = {
  title: 'Engine/BarChart',
  component: BarChart,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    ariaLabel: 'Minutes by agent and change kind',
    categories: BAR_CATEGORIES,
    series: BAR_SERIES,
    height: 260,
    animate: false,
  },
} satisfies Meta<typeof BarChart>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Grouped: Story = { args: { mode: 'grouped' } };
export const Stacked: Story = { args: { mode: 'stacked' } };
export const Stacked100: Story = { args: { mode: 'stacked100' } };
export const Horizontal: Story = { args: { orientation: 'horizontal' } };
export const WithLimit: Story = { args: { mode: 'stacked', limit: { value: 700, label: 'WIP limit' } } };
/** `height: 'fill'`: the chart takes the full height of a 24rem box. */
export const Fill: Story = {
  args: { mode: 'grouped', height: 'fill' },
  decorators: [(Story) => <div className="h-96"><Story /></div>],
};
