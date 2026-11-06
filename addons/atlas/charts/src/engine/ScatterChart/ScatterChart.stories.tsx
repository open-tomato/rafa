import type { Meta, StoryObj } from '@storybook/react-vite';

import { SCATTER_POINTS, SCATTER_TREND } from '../fixtures.js';

import { ScatterChart } from './ScatterChart.js';

const meta = {
  title: 'Engine/ScatterChart',
  component: ScatterChart,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    ariaLabel: 'Task minutes over time',
    points: SCATTER_POINTS,
    pointsLabel: 'task',
    yLabel: 'min',
    height: 260,
    animate: false,
  },
} satisfies Meta<typeof ScatterChart>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Dots: Story = {};
export const WithTrend: Story = { args: { trend: SCATTER_TREND, trendLabel: '3-task average' } };
