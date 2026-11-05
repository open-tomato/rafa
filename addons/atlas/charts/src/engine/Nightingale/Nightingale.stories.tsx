import type { Meta, StoryObj } from '@storybook/react-vite';

import { LAYER_TONES, ROSE_SLICES } from '../fixtures.js';

import { Nightingale } from './Nightingale.js';

const meta = {
  title: 'Engine/Nightingale',
  component: Nightingale,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    ariaLabel: 'Package size by lines',
    slices: ROSE_SLICES,
    groupTones: LAYER_TONES,
    unit: 'lines',
    height: 320,
    animate: false,
  },
} satisfies Meta<typeof Nightingale>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
