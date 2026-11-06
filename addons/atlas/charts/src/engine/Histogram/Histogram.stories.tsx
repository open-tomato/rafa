import type { Meta, StoryObj } from '@storybook/react-vite';

import { HISTOGRAM_BINS } from '../fixtures.js';

import { Histogram } from './Histogram.js';

const meta = {
  title: 'Engine/Histogram',
  component: Histogram,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    ariaLabel: 'Task duration distribution',
    bins: HISTOGRAM_BINS,
    unit: 'min',
    height: 240,
    animate: false,
  },
} satisfies Meta<typeof Histogram>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
