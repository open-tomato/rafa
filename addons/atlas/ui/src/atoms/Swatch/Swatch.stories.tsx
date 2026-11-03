import type { Meta, StoryObj } from '@storybook/react-vite';

import { Swatch } from './Swatch.js';

const meta = {
  title: 'Atoms/Swatch',
  component: Swatch,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { label: 'Series', tone: 'series-1', size: 'md' },
} satisfies Meta<typeof Swatch>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Series1: Story = { args: { tone: 'series-1', label: 'Series 1' } };
export const Series2: Story = { args: { tone: 'series-2', label: 'Series 2' } };
export const Series3: Story = { args: { tone: 'series-3', label: 'Series 3' } };
export const Series4: Story = { args: { tone: 'series-4', label: 'Series 4' } };
export const Series5: Story = { args: { tone: 'series-5', label: 'Series 5' } };
export const Series6: Story = { args: { tone: 'series-6', label: 'Series 6' } };
export const Series7: Story = { args: { tone: 'series-7', label: 'Series 7' } };
export const Series8: Story = { args: { tone: 'series-8', label: 'Series 8' } };
export const Good: Story = { args: { tone: 'good', label: 'Good' } };
export const Warning: Story = { args: { tone: 'warning', label: 'Warning' } };
export const Serious: Story = { args: { tone: 'serious', label: 'Serious' } };
export const Critical: Story = { args: { tone: 'critical', label: 'Critical' } };
export const Small: Story = { args: { size: 'sm', label: 'Small' } };
export const Medium: Story = { args: { size: 'md', label: 'Medium' } };
export const Large: Story = { args: { size: 'lg', label: 'Large' } };
