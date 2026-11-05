import type { Meta, StoryObj } from '@storybook/react-vite';

import { useState } from 'react';

import { makeColumns, SESSIONS, type Session } from '../../stories/sessions.js';

import { Table } from './Table.js';

const SessionTable = Table<Session>;

const meta = {
  title: 'Organisms/Table',
  component: SessionTable,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    columns: makeColumns('clamp'),
    data: SESSIONS,
    getRowId: (row: Session) => row.id,
    initialSort: { key: 'updated', dir: 'asc' },
  },
} satisfies Meta<typeof SessionTable>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The scroll layout with a totals footer and a two-line clamp. */
export const Default: Story = { args: { layout: 'scroll', maxHeight: 360, stickyFooter: true } };
/** `fit`: natural height, no gutter, no footer. */
export const Fit: Story = {};
export const Compact: Story = { args: { ...Default.args, density: 'compact' } };
/** The goal column truncated to one line; hover a clipped cell for its tip. */
export const Truncate: Story = { args: { ...Default.args, columns: makeColumns('truncate') } };
/** `frame={false}`: a wrapper owns the border and the radius. */
export const Unframed: Story = {
  args: { frame: false },
  decorators: [(Story) => <div className="overflow-hidden rounded-lg border border-grid bg-surface shadow-xs"><Story /></div>],
};
/** Odd and even rows striped. */
export const Striped: Story = { args: { striped: true } };

function SelectableDemo(): React.ReactElement {
  const [ids, setIds] = useState<readonly string[]>(['ses_4f09', 'ses_2c77']);
  return (
    <SessionTable
      columns={makeColumns('clamp')}
      data={SESSIONS}
      getRowId={(row) => row.id}
      selectable
      selectedIds={ids}
      onSelectionChange={setIds}
      isRowSelectable={(row) => row.status !== 'running'}
    />
  );
}

/** The checkbox column: the table draws the boxes, the parent owns the ids; running rows opt out. */
export const Selectable: Story = { render: () => <SelectableDemo /> };

function ReorderableDemo(): React.ReactElement {
  const [rows, setRows] = useState<readonly Session[]>(SESSIONS);
  return (
    <SessionTable
      columns={makeColumns('clamp')}
      data={rows}
      getRowId={(row) => row.id}
      reorderable
      onReorder={setRows}
      isRowReorderable={(row) => row.status !== 'running'}
    />
  );
}

/** The grip column: drag a row by its grip; the sort headers are off while the order is by hand. */
export const Reorderable: Story = { render: () => <ReorderableDemo /> };
