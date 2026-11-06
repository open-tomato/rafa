import type { Meta, StoryObj } from '@storybook/react-vite';

import { Check, Terminal } from 'lucide-react';

import { Tag } from './Tag.js';

const meta = {
  title: 'Atoms/Tag',
  component: Tag,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Tag>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Defaults: neutral, mono; an id. */
export const Default: Story = { args: { children: 'agt_8x21' } };
export const Info: Story = { args: { tone: 'info', children: 'sonnet-4.5' } };
export const SuccessVerified: Story = { args: { tone: 'good', children: 'verified', icon: <Check size={13} aria-hidden="true" /> } };
export const WithToolIcon: Story = { args: { children: 'read_file', icon: <Terminal size={13} aria-hidden="true" /> } };
export const Warning: Story = { args: { tone: 'warning', children: 'deprecated' } };
export const Danger: Story = { args: { tone: 'critical', children: 'revoked' } };
