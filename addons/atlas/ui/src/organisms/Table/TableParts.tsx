import type { ReactElement, ReactNode } from 'react';

import { ArrowDown, ArrowUp, Check, ChevronDown, GripVertical, Minus } from 'lucide-react';
import { useRef } from 'react';

import {
  tableCellContentVariants,
  tableCheckboxBoxVariants,
  tableCheckboxVariants,
  tableSortGlyphVariants,
  tableSortHandleVariants,
  type TableAlign,
  type TableOverflow,
} from './Table.variants.js';

/** The glyph sizes, in pixels. */
const SORT_GLYPH_SIZE = 13;
const CHECK_GLYPH_SIZE = 13;
const CHECK_GLYPH_STROKE = 2.5;
const GRIP_GLYPH_SIZE = 15;

/** The tolerance, in pixels, past which a cell counts as clipped. */
const CLIP_SLACK = 1;

/** A clipped cell's tip: its text and where its top centre is. */
export interface TableTip {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

/** The sort glyph's props. */
export interface SortGlyphProps {
  readonly sortable?: boolean;
  readonly active: boolean;
  readonly dir: 'asc' | 'desc';
}

/** The header's sort affordance: a faint chevron, or the accent arrow of the active direction. */
export function SortGlyph({ sortable, active, dir }: SortGlyphProps): ReactElement | null {
  if (!sortable) return null;
  if (!active) {
    return (
      <span className={tableSortGlyphVariants({ active: false })}>
        <ChevronDown size={SORT_GLYPH_SIZE} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={tableSortGlyphVariants({ active: true })}>
      {dir === 'asc'
        ? <ArrowUp size={SORT_GLYPH_SIZE} aria-hidden="true" />
        : <ArrowDown size={SORT_GLYPH_SIZE} aria-hidden="true" />}
    </span>
  );
}

/** A table cell's props: how it clips, its lines, its alignment and the tip callbacks. */
export interface TableCellContentProps {
  readonly mode?: TableOverflow;
  readonly lines?: number;
  readonly align?: TableAlign;
  readonly children?: ReactNode;
  readonly onTip?: (tip: TableTip) => void;
  readonly offTip?: () => void;
}

/** The clamp's default line count. */
const DEFAULT_CLAMP_LINES = 2;

/**
 * The overflow-aware cell. `text-overflow` never clips a `<td>` itself:
 * the table is fixed, the cell is capped at `max-w-0`, and the clip
 * lives on this block child. A tip is raised only when the text is
 * truly clipped, measured on hover.
 */
export function TableCellContent({ mode = 'wrap', lines = DEFAULT_CLAMP_LINES, align = 'start', children, onTip, offTip }: TableCellContentProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const enter = (): void => {
    if (mode === 'wrap' || onTip === undefined) return;
    const element = ref.current;
    if (element === null) return;
    const clipped = mode === 'truncate'
      ? element.scrollWidth > element.clientWidth + CLIP_SLACK
      : element.scrollHeight > element.clientHeight + CLIP_SLACK;
    if (!clipped) return;
    const rect = element.getBoundingClientRect();
    onTip({ text: element.textContent ?? '', x: rect.left + rect.width / 2, y: rect.top });
  };
  // The line count is per column and measured by the browser, so the
  // clamp is the one style set at the site.
  const clampStyle = mode === 'clamp'
    ? { WebkitLineClamp: lines }
    : undefined;
  return (
    <div ref={ref} onMouseEnter={enter} onMouseLeave={offTip} className={tableCellContentVariants({ mode, align })} style={clampStyle}>
      {children}
    </div>
  );
}

/** The row checkbox's props. */
export interface TableRowCheckboxProps {
  readonly checked: boolean;
  /** The header's mixed state: some rows selected, not all. */
  readonly indeterminate?: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
  /** The accessible name: "Select row ses_1a55", "Select all rows". */
  readonly label: string;
}

/** The checkbox in the selection column; the table renders it and the parent owns the selection. */
export function TableRowCheckbox({ checked, indeterminate = false, disabled = false, onChange, label }: TableRowCheckboxProps): ReactElement {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate
        ? 'mixed'
        : checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={tableCheckboxVariants({ disabled })}
    >
      <span className={tableCheckboxBoxVariants({ checked: on })}>
        {on && (indeterminate
          ? <Minus size={CHECK_GLYPH_SIZE} strokeWidth={CHECK_GLYPH_STROKE} aria-hidden="true" />
          : <Check size={CHECK_GLYPH_SIZE} strokeWidth={CHECK_GLYPH_STROKE} aria-hidden="true" />)}
      </span>
    </button>
  );
}

/** The grip's props. */
export interface TableSortHandleProps {
  readonly disabled?: boolean;
}

/** The grip in the reorder column; drag-only, hidden from assistive technology. */
export function TableSortHandle({ disabled = false }: TableSortHandleProps): ReactElement {
  return (
    <span aria-hidden="true" className={tableSortHandleVariants({ disabled })}>
      <GripVertical size={GRIP_GLYPH_SIZE} aria-hidden="true" />
    </span>
  );
}
