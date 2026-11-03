import type { Meta, StoryObj } from '@storybook/react-vite';

import { StatTile } from './StatTile.js';

const TREND = [12, 14, 11, 16, 18, 17, 21, 19, 23, 22, 26, 28];

const meta = {
  title: 'Atoms/StatTile',
  component: StatTile,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { label: 'Tasks landed', value: '128', trend: TREND },
  decorators: [(Story) => <div className="w-72"><Story /></div>],
} satisfies Meta<typeof StatTile>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Plain: Story = {};
export const Hero: Story = { args: { hero: true } };
export const Good: Story = { args: { delta: { text: '+12% vs last 4 weeks', direction: 'up' } } };
export const Bad: Story = { args: { label: 'Failed runs', value: '9', delta: { text: '+3 vs last week', direction: 'up', upIsGood: false } } };
export const Flat: Story = { args: { delta: { text: 'no change vs last week', direction: 'flat' } } };
export const WithNote: Story = { args: { note: 'Proxy: merged pull requests' } };
