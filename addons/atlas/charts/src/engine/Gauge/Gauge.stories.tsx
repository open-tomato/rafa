import type { Meta, StoryObj } from '@storybook/react-vite';

import { Gauge } from './Gauge.js';

const meta = {
  title: 'Engine/Gauge',
  component: Gauge,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    ariaLabel: 'Token budget burn',
    value: 6_000_000,
    max: 12_000_000,
    label: 'of the allowance',
    height: 240,
    animate: false,
  },
} satisfies Meta<typeof Gauge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Warning: Story = { args: { value: 9_000_000, thresholds: { warning: 0.7, critical: 0.9 } } };
export const Critical: Story = { args: { value: 11_400_000, thresholds: { warning: 0.7, critical: 0.9 } } };
export const WithCompare: Story = { args: { value: 7_000_000, compare: { value: 5_000_000, label: 'last week' } } };
export const OverTheMax: Story = { args: { value: 14_880_000, compare: { value: 9_000_000, label: 'last week' } } };
