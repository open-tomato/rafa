import type { Meta, StoryObj } from '@storybook/react-vite';

import { Sparkline } from './Sparkline.js';

const VALUES = [12, 14, 11, 16, 18, 17, 21, 19, 23, 22, 26, 28];

const meta = {
  title: 'Atoms/Sparkline',
  component: Sparkline,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { values: VALUES, label: 'Tokens over twelve weeks' },
} satisfies Meta<typeof Sparkline>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Muted: Story = { args: { tone: 'muted' } };
export const Series1: Story = { args: { tone: 'series-1' } };
export const Good: Story = { args: { tone: 'good' } };
export const Critical: Story = { args: { tone: 'critical', values: [...VALUES].reverse() } };
export const Flat: Story = { args: { tone: 'neutral', values: [5, 5, 5, 5] } };
export const Wide: Story = { args: { tone: 'series-2', width: 200, height: 40 } };
