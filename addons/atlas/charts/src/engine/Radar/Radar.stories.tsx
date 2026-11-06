import type { Meta, StoryObj } from '@storybook/react-vite';

import { RADAR_AXES, RADAR_POLES, RADAR_SERIES } from '../fixtures.js';

import { Radar } from './Radar.js';

const meta = {
  title: 'Engine/Radar',
  component: Radar,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    ariaLabel: 'Balance of shipping, failing and foundation work',
    axes: RADAR_AXES,
    poles: RADAR_POLES,
    series: RADAR_SERIES,
    max: 2,
    baseline: { value: 1, label: 'as usual' },
    height: 380,
    animate: false,
  },
} satisfies Meta<typeof Radar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SettledBaseline: Story = { args: { history: { weeks: 12, of: 12 } } };
export const YoungBaseline: Story = { args: { history: { weeks: 2, of: 12 } } };
export const NoBaseline: Story = { args: { baseline: undefined } };
