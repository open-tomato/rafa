import type { Meta, StoryObj } from '@storybook/react-vite';

import { Divider } from './Divider.js';

const meta = {
  title: 'Atoms/Divider',
  component: Divider,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  decorators: [(Story) => <div className="w-80"><Story /></div>],
} satisfies Meta<typeof Divider>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Plain: Story = {};
export const Labeled: Story = { args: { label: 'or with email' } };
