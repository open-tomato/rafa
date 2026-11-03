import type { Meta, StoryObj } from '@storybook/react-vite';

import { GridTiles, SpanTile } from '../../stories/fixtures.js';
import { Grid } from '../Grid/Grid.js';

import { GridItem } from './GridItem.js';

const meta = {
  title: 'Atoms/GridItem',
  component: GridItem,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  // A three-column grid, the item first, then filler.
  decorators: [
    (Story) => (
      <Grid cols="3" gap="sm">
        <Story />
        <GridTiles count={4} />
      </Grid>
    ),
  ],
} satisfies Meta<typeof GridItem>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Defaults: span 1, self-auto; the same as a plain child. */
export const Default: Story = { args: { children: <SpanTile label="span 1" /> } };
export const Span2: Story = { args: { span: '2', children: <SpanTile label="span 2" /> } };
export const Span3: Story = { args: { span: '3', children: <SpanTile label="span 3" /> } };
export const SpanFull: Story = { args: { span: 'full', children: <SpanTile label="span full" /> } };
export const AlignCenter: Story = { args: { align: 'center', children: <SpanTile label="centered" /> } };
