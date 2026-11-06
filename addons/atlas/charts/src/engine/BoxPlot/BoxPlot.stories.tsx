import type { Meta, StoryObj } from '@storybook/react-vite';

import { BOX_GROUPS } from '../fixtures.js';

import { BoxPlot } from './BoxPlot.js';

const meta = {
  title: 'Engine/BoxPlot',
  component: BoxPlot,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    ariaLabel: 'Task minutes by change kind',
    groups: BOX_GROUPS,
    unit: 'min',
    height: 260,
    animate: false,
  },
} satisfies Meta<typeof BoxPlot>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
