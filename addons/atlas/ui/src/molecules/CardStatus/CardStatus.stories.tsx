import type { Meta, StoryObj } from '@storybook/react-vite';

import { CardStatus } from './CardStatus.js';

const meta = {
  title: 'Molecules/CardStatus',
  component: CardStatus,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { kind: 'loading' },
  decorators: [(Story) => <div className="w-80"><Story /></div>],
} satisfies Meta<typeof CardStatus>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Loading: Story = { args: { kind: 'loading' } };
export const Empty: Story = { args: { kind: 'empty', detail: 'Pick a longer range.' } };
export const Failed: Story = { args: { kind: 'error', detail: 'The details are under the card menu\'s Errors item.' } };
