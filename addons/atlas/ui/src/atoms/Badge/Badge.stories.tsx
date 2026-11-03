import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge } from './Badge.js';

const meta = {
  title: 'Atoms/Badge',
  component: Badge,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Badge>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Defaults: the good tone, medium; the "running" state. */
export const Default: Story = { args: { children: 'running', dot: true } };
export const Warning: Story = { args: { tone: 'warning', dot: true, children: 'waiting' } };
export const Danger: Story = { args: { tone: 'critical', children: 'failed' } };
export const Info: Story = { args: { tone: 'info', children: 'done' } };
export const Neutral: Story = { args: { tone: 'neutral', children: 'idle' } };
export const Accent: Story = { args: { tone: 'accent', children: 'agent' } };
export const SmallSize: Story = { args: { size: 'sm', children: 'running' } };
