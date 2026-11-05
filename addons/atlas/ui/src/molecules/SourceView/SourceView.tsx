import type { TableData } from '../../context/types.js';
import type { ReactElement } from 'react';

import { cn } from '@open-tomato/charts';

import { DataTable } from '../../atoms/DataTable/DataTable.js';

import { sourceLineVariants, sourceViewVariants } from './SourceView.variants.js';

/** A source view's props: the table, its caption, the source line and the table's options. */
export interface SourceViewProps {
  readonly table: TableData;
  /** Names the table: usually the card title. */
  readonly caption: string;
  /** Where the values come from, in one line. */
  readonly source?: string;
  /** Overrides the table's own `sortable`; true when neither says. */
  readonly sortable?: boolean;
  /** Overrides the table's own `limit`. */
  readonly limit?: number;
  /** Layout context from the parent; never colour or size. */
  readonly className?: string;
}

/** The data behind a chart: one line naming the source, then the table, sortable by default, capped as the table or the props say. */
export function SourceView({ table, caption, source, sortable, limit, className }: SourceViewProps): ReactElement {
  return (
    <div className={cn(sourceViewVariants(), className)}>
      {source && <p className={sourceLineVariants()}>Source: {source}</p>}
      <DataTable caption={caption} columns={table.columns} rows={table.rows} sortable={sortable ?? table.sortable ?? true} limit={limit ?? table.limit} />
    </div>
  );
}
