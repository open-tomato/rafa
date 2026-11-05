import type { Meta, StoryObj } from '@storybook/react-vite';

import { Check, Key, Shield, ShieldCheck } from 'lucide-react';

import { IconTile } from './IconTile.js';

const meta = {
  title: 'Atoms/IconTile',
  component: IconTile,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof IconTile>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A 36px accent tile. */
export const Default: Story = { args: { icon: <Shield size={17} aria-hidden="true" /> } };
export const Neutral: Story = { args: { icon: <Key size={17} aria-hidden="true" />, tone: 'neutral' } };
/** A confirmation screen's status circle. */
export const StatusCircle: Story = { args: { icon: <ShieldCheck size={32} aria-hidden="true" />, tone: 'good', size: 'lg', shape: 'circle' } };
/** The 80px pulsing success mark. */
export const Pulsing: Story = { args: { icon: <Check size={36} aria-hidden="true" />, tone: 'good', size: '2xl', shape: 'circle', pulse: true } };
