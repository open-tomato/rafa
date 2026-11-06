import type { Meta, StoryObj } from '@storybook/react-vite';

import { RangeSelector } from './RangeSelector.js';

const meta = {
  title: 'Molecules/RangeSelector',
  component: RangeSelector,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { value: 'past-month', onChange: () => undefined },
} satisfies Meta<typeof RangeSelector>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Now: Story = { args: { value: 'now' } };
export const LastWeek: Story = { args: { value: 'last-week' } };
export const PastMonth: Story = { args: { value: 'past-month' } };
export const LastYear: Story = { args: { value: 'last-year' } };
export const Small: Story = { args: { size: 'sm' } };
