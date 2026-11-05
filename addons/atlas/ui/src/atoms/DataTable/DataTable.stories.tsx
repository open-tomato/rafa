import type { Meta, StoryObj } from '@storybook/react-vite';

import { DataTable } from './DataTable.js';

const COLUMNS = ['Model', 'Tokens', 'Share'];
const ROWS = [
  ['Opus', 1204, '41%'],
  ['Sonnet', 980, '33%'],
  ['Haiku', 512, '17%'],
  ['Other', 260, '9%'],
];

const meta = {
  title: 'Atoms/DataTable',
  component: DataTable,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { caption: 'Tokens by model', columns: COLUMNS, rows: ROWS },
  decorators: [(Story) => <div className="w-80"><Story /></div>],
} satisfies Meta<typeof DataTable>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Plain: Story = {};
export const Sortable: Story = { args: { sortable: true } };
export const Limited: Story = { args: { limit: 2 } };
