import type { Meta, StoryObj } from '@storybook/react-vite';

import { Bullet } from './Bullet.js';

const meta = {
  title: 'Engine/Bullet',
  component: Bullet,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    ariaLabel: 'Plans completed on time',
    value: 78,
    target: 85,
    max: 100,
    ranges: [0.5, 0.8],
    label: 'on time, %',
    height: 90,
    animate: false,
  },
} satisfies Meta<typeof Bullet>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const LowerIsBetter: Story = {
  args: { ariaLabel: 'Failing share', value: 14, target: 10, max: 30, ranges: [0.33, 0.66], label: 'failing, %', higherIsBetter: false },
};
