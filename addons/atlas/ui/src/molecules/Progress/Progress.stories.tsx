import type { Meta, StoryObj } from '@storybook/react-vite';

import { Progress } from './Progress.js';

const meta = {
  title: 'Molecules/Progress',
  component: Progress,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="mx-auto w-[420px]"><Story /></div>],
} satisfies Meta<typeof Progress>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Determinate: the token budget at 34%. */
export const Default: Story = { args: { value: 34, label: 'Token budget' } };
/** Past the caller's threshold: the critical tone. */
export const DangerThreshold: Story = { args: { value: 92, tone: 'critical', label: 'Token budget' } };
/** Indeterminate: a sweeping fill. */
export const Indeterminate: Story = { args: { indeterminate: true, label: 'Working' } };
