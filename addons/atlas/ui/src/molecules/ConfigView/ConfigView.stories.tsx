import type { Meta, StoryObj } from '@storybook/react-vite';

import { ConfigView } from './ConfigView.js';

const meta = {
  title: 'Molecules/ConfigView',
  component: ConfigView,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    value: { title: 'Tokens per day', subtitle: 'Millions', range: 'past-month', span: 'two' },
    onSubmit: () => undefined,
    onCancel: () => undefined,
  },
  decorators: [(Story) => <div className="w-96"><Story /></div>],
} satisfies Meta<typeof ConfigView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Filled: Story = {};
export const Defaults: Story = { args: { value: { title: 'Tokens per day' } } };
