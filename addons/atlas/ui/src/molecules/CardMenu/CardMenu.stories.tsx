import type { Meta, StoryObj } from '@storybook/react-vite';

import { Bug, Info, Maximize2, Table2 } from 'lucide-react';
import { userEvent, within } from 'storybook/test';

import { CardMenu } from './CardMenu.js';

const ITEMS = [
  { key: 'info', label: 'Info', icon: Info, onSelect: () => undefined },
  { key: 'source', label: 'Source', icon: Table2, onSelect: () => undefined },
  { key: 'maximise', label: 'Maximise', icon: Maximize2, onSelect: () => undefined },
];

const meta = {
  title: 'Molecules/CardMenu',
  component: CardMenu,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { items: ITEMS, label: 'Options for Tokens per day' },
  decorators: [(Story) => <div className="flex h-48 w-72 justify-end"><Story /></div>],
} satisfies Meta<typeof CardMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Options for Tokens per day' }));
  },
};

export const WithErrors: Story = {
  args: { items: [...ITEMS, { key: 'errors', label: 'Errors', icon: Bug, tone: 'critical', onSelect: () => undefined }] },
  play: Open.play,
};
