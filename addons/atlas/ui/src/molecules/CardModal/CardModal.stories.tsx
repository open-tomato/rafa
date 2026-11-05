import type { Meta, StoryObj } from '@storybook/react-vite';

import { Card } from '../../atoms/Card/Card.js';

import { CardModal } from './CardModal.js';

const meta = {
  title: 'Molecules/CardModal',
  component: CardModal,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    title: 'Tokens per day',
    onClose: () => undefined,
    children: <p>Each bar is one day&apos;s input and output tokens, summed across models.</p>,
  },
  decorators: [(Story) => <Card label="Host card" className="h-64 w-96"><p>Card body under the modal.</p><Story /></Card>],
} satisfies Meta<typeof CardModal>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Contained: Story = { args: { placement: 'contained' } };
export const Page: Story = { args: { placement: 'page' } };
export const PageFit: Story = { args: { placement: 'page', size: 'fit-70' } };
