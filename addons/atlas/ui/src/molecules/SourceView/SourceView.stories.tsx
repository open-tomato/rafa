import type { Meta, StoryObj } from '@storybook/react-vite';

import { SourceView } from './SourceView.js';

const TABLE = {
  columns: ['Model', 'Tokens', 'Share'],
  rows: [['Opus', 1204, '41%'], ['Sonnet', 980, '33%'], ['Haiku', 512, '17%']],
};

const meta = {
  title: 'Molecules/SourceView',
  component: SourceView,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { table: TABLE, caption: 'Tokens by model', source: 'Fixed sample: tokens by model for one week.' },
  decorators: [(Story) => <div className="w-96"><Story /></div>],
} satisfies Meta<typeof SourceView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WithSource: Story = {};
export const WithoutSource: Story = { args: { source: undefined } };
export const Limited: Story = { args: { limit: 1 } };
