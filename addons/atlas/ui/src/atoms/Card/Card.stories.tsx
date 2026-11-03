import type { Meta, StoryObj } from '@storybook/react-vite';

import { Card } from './Card.js';

const meta = {
  title: 'Atoms/Card',
  component: Card,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { label: 'Tokens per day', children: 'Card body', surface: 'raised', padding: 'md' },
  decorators: [(Story) => <div className="w-80"><Story /></div>],
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Raised: Story = { args: { surface: 'raised' } };
export const Flat: Story = { args: { surface: 'flat' } };
export const Sunken: Story = { args: { surface: 'sunken' } };
export const PaddingNone: Story = { args: { padding: 'none' } };
export const PaddingSmall: Story = { args: { padding: 'sm' } };
export const PaddingMedium: Story = { args: { padding: 'md' } };
export const SpanOne: Story = { args: { span: 'one' } };
export const SpanTwo: Story = { args: { span: 'two' } };
export const SpanFull: Story = { args: { span: 'full' } };
