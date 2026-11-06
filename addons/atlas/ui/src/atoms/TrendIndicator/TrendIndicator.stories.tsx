import type { Meta, StoryObj } from '@storybook/react-vite';

import { TrendIndicator } from './TrendIndicator.js';

const meta = {
  title: 'Atoms/TrendIndicator',
  component: TrendIndicator,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof TrendIndicator>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Up, with the value: good ink, `+10%`. */
export const Default: Story = { args: { trend: 0.1, showValue: true } };
/** Down, with the value: critical ink. */
export const Down: Story = { args: { trend: -0.3, showValue: true } };
/** The glyph alone. */
export const ArrowOnly: Story = { args: { trend: 0.25 } };
/** A flat trend: the muted dash. */
export const Flat: Story = { args: { trend: 0 } };
/** One fraction digit. */
export const Precise: Story = { args: { trend: 0.153, showValue: true, precision: 1 } };
/** The stat card header pattern: the label left, the trend right. */
export const InStatHeader: Story = {
  args: { trend: -0.08, showValue: true },
  render: (args) => (
    <div className="flex w-56 items-center justify-between rounded-lg border border-grid bg-surface px-4 py-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">errors</span>
      <TrendIndicator {...args} />
    </div>
  ),
};
