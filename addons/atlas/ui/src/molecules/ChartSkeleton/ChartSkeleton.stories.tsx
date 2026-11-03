import type { Meta, StoryObj } from '@storybook/react-vite';

import { ChartSkeleton } from './ChartSkeleton.js';

const meta = {
  title: 'Molecules/ChartSkeleton',
  component: ChartSkeleton,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="w-[420px]"><Story /></div>],
} satisfies Meta<typeof ChartSkeleton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Bars: Story = { args: { kind: 'bars' } };
export const Line: Story = { args: { kind: 'line' } };
export const Ring: Story = { args: { kind: 'ring' } };
export const Rows: Story = { args: { kind: 'rows' } };
/** The stat tile's outline, at a tile's height. */
export const Tile: Story = { args: { kind: 'tile', height: 84 } };
