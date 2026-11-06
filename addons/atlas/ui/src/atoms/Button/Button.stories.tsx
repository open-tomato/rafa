import type { Meta, StoryObj } from '@storybook/react-vite';

import { EllipsisVertical, RotateCcw } from 'lucide-react';

import { Button } from './Button.js';

const meta = {
  title: 'Atoms/Button',
  component: Button,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { variant: 'text', tone: 'default', children: 'Try again' },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Icon: Story = {
  args: { variant: 'icon', 'aria-label': 'Card options', children: <EllipsisVertical size={16} aria-hidden="true" /> },
};
export const Text: Story = { args: { variant: 'text', children: <><RotateCcw size={12} aria-hidden="true" />Try again</> } };
export const MenuItem: Story = { args: { variant: 'menuitem', children: 'Source' } };
export const Primary: Story = { args: { variant: 'primary', children: 'Apply' } };
export const Critical: Story = { args: { variant: 'menuitem', tone: 'critical', children: 'Errors' } };
export const Disabled: Story = { args: { variant: 'text', disabled: true, children: 'Disabled' } };
export const Pressed: Story = { args: { variant: 'text', 'aria-pressed': true, children: 'Legend' } };
