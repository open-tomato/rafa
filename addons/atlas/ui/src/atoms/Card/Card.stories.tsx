import type { Meta, StoryObj } from '@storybook/react-vite';

import { ChevronDown } from 'lucide-react';

import { CardFiller } from '../../stories/fixtures.js';

import { Card } from './Card.js';

/** Header content for the header slot. */
function DemoHeader() {
  return (
    <>
      <span className="text-sm font-semibold text-ink">Card header</span>
      <ChevronDown size={16} className="shrink-0 text-muted" aria-hidden="true" />
    </>
  );
}

const meta = {
  title: 'Atoms/Card',
  component: Card,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { label: 'Tokens per day', children: <CardFiller />, surface: 'raised', padding: 'md' },
  decorators: [(Story) => <div className="w-[300px]"><Story /></div>],
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Defaults: raised surface, xl radius, md padding, comfortable rhythm. */
export const Default: Story = {};
export const Raised: Story = { args: { surface: 'raised' } };
export const Flat: Story = { args: { surface: 'flat' } };
export const Sunken: Story = { args: { surface: 'sunken' } };
export const WithHeader: Story = { args: { header: <DemoHeader /> } };
export const Compact: Story = { args: { density: 'compact', header: <DemoHeader /> } };
export const PaddingNone: Story = { args: { padding: 'none' } };
export const PaddingSmall: Story = { args: { padding: 'sm' } };
export const PaddingMedium: Story = { args: { padding: 'md' } };
export const PaddingLg: Story = { args: { padding: 'lg' } };
export const RoundedMd: Story = { args: { rounded: 'md' } };
export const RoundedLg: Story = { args: { rounded: 'lg' } };
export const RoundedXl: Story = { args: { rounded: 'xl' } };
export const SpanOne: Story = { args: { span: 'one' } };
export const SpanTwo: Story = { args: { span: 'two' } };
export const SpanFull: Story = { args: { span: 'full' } };
