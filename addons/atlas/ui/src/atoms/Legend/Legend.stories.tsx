import type { LegendItem } from '../../context/types.js';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Legend } from './Legend.js';

const ITEMS: readonly LegendItem[] = [
  { id: 'opus', label: 'Opus', tone: 'series-1' },
  { id: 'sonnet', label: 'Sonnet', tone: 'series-2' },
  { id: 'haiku', label: 'Haiku', tone: 'series-3' },
];

const meta = {
  title: 'Atoms/Legend',
  component: Legend,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { items: ITEMS, mark: 'rect' },
} satisfies Meta<typeof Legend>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Rect: Story = { args: { mark: 'rect' } };
export const Line: Story = { args: { mark: 'line' } };
export const Toggleable: Story = { args: { hidden: new Set(['sonnet']), onToggle: () => undefined } };
export const StatusTones: Story = {
  args: {
    items: [
      { id: 'good', label: 'Good', tone: 'good' },
      { id: 'warning', label: 'Warning', tone: 'warning' },
      { id: 'serious', label: 'Serious', tone: 'serious' },
      { id: 'critical', label: 'Critical', tone: 'critical' },
      { id: 'neutral', label: 'Neutral', tone: 'neutral' },
      { id: 'muted', label: 'Muted', tone: 'muted' },
    ],
  },
};
