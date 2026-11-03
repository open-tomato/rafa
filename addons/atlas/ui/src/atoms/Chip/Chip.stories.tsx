import type { Meta, StoryObj } from '@storybook/react-vite';

import { Filter } from 'lucide-react';

import { Chip } from './Chip.js';

const meta = {
  title: 'Atoms/Chip',
  component: Chip,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Chip>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Removable: the default shape. */
export const Default: Story = { args: { children: 'status: running', onRemove: () => undefined } };
export const NotRemovable: Story = { args: { children: 'assigned: me' } };
export const WithIcon: Story = { args: { children: 'assigned: me', icon: <Filter size={13} aria-hidden="true" /> } };
