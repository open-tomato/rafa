import type { Meta, StoryObj } from '@storybook/react-vite';

import { DONUT_PREVIOUS, DONUT_SLICES } from '../fixtures.js';

import { Donut } from './Donut.js';

const meta = {
  title: 'Engine/Donut',
  component: Donut,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    ariaLabel: 'Minutes by change kind',
    slices: DONUT_SLICES,
    centerValue: '10.7K',
    centerLabel: 'minutes',
    height: 260,
    animate: false,
  },
} satisfies Meta<typeof Donut>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithCompare: Story = { args: { compare: { label: 'last month', slices: DONUT_PREVIOUS } } };
