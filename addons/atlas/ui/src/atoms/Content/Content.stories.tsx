import type { Meta, StoryObj } from '@storybook/react-vite';

import { ContentTiles } from '../../stories/fixtures.js';

import { Content } from './Content.js';

const meta = {
  title: 'Atoms/Content',
  component: Content,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { children: <ContentTiles /> },
} satisfies Meta<typeof Content>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Defaults: a column, the medium gap, stretched children. */
export const Default: Story = {};
export const Row: Story = { args: { direction: 'row' } };
export const GapXl: Story = { args: { gap: 'xl' } };
export const AlignCenter: Story = { args: { direction: 'row', align: 'center' } };
export const JustifyBetween: Story = { args: { direction: 'row', justify: 'between' } };
export const Wrapping: Story = { args: { direction: 'row', wrap: true, children: <ContentTiles count={9} /> } };
