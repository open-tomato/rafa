import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../../atoms/Button/Button.js';

import { CardHeader } from './CardHeader.js';

const meta = {
  title: 'Molecules/CardHeader',
  component: CardHeader,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { title: 'Tokens per day', subtitle: 'Millions, last 30 days' },
  decorators: [(Story) => <div className="w-96"><Story /></div>],
} satisfies Meta<typeof CardHeader>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Small: Story = { args: { size: 'sm' } };
export const Medium: Story = { args: { size: 'md' } };
export const TitleOnly: Story = { args: { subtitle: undefined } };
export const WithActions: Story = { args: { actions: <Button>Indices…</Button> } };
