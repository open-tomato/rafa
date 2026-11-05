import type { Meta, StoryObj } from '@storybook/react-vite';

import { Segmented } from './Segmented.js';

const OPTIONS = [
  { value: '2', label: '2 wk' },
  { value: '6', label: '6 wk' },
  { value: '12', label: '12 wk' },
] as const;

const meta = {
  title: 'Atoms/Segmented',
  component: Segmented,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { value: '6', options: OPTIONS, label: 'Weeks of history', onChange: () => undefined },
} satisfies Meta<typeof Segmented>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Small: Story = { args: { size: 'sm' } };
export const Medium: Story = { args: { size: 'md' } };
