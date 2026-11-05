import type { Meta, StoryObj } from '@storybook/react-vite';

import { AREA_SERIES, LINE_SERIES } from '../fixtures.js';

import { LineChart } from './LineChart.js';

const meta = {
  title: 'Engine/LineChart',
  component: LineChart,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    ariaLabel: 'Tokens per day by model',
    series: LINE_SERIES,
    height: 260,
    animate: false,
  },
} satisfies Meta<typeof LineChart>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Line: Story = { args: { variant: 'line' } };
export const Area: Story = { args: { variant: 'area', series: AREA_SERIES } };
export const StackedArea: Story = { args: { variant: 'stacked-area' } };
export const WithBaseline: Story = { args: { baseline: { value: 1_200_000, label: 'average' } } };
export const WithZoom: Story = { args: { zoom: true, height: 300 } };
