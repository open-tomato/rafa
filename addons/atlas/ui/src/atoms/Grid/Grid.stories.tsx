import type { Meta, StoryObj } from '@storybook/react-vite';

import { GridTiles } from '../../stories/fixtures.js';

import { Grid } from './Grid.js';

const meta = {
  title: 'Atoms/Grid',
  component: Grid,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { children: <GridTiles /> },
} satisfies Meta<typeof Grid>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Defaults: auto-fill columns at 180px, the medium gap. */
export const Default: Story = {};
export const Cols2: Story = { args: { cols: '2' } };
export const Cols3: Story = { args: { cols: '3' } };
export const Cols4: Story = { args: { cols: '4' } };
export const GapSm: Story = { args: { cols: '3', gap: 'sm' } };
export const GapLg: Story = { args: { cols: '3', gap: 'lg' } };
