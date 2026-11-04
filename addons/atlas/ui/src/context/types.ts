/**
 * The chart-facing types the cascade needs beside the seam's: the tone is
 * the seam's `ChartTone`; a legend item and a table are local until the
 * seam exports its own.
 */
import type { ChartTone } from '@open-tomato/charts';

/** One tone a card's marks paint with: the seam's chart tone. */
export type CardTone = ChartTone;

/** How a legend draws its mark: a filled square for bars and areas, a short stroke for lines. */
export type LegendMark = 'rect' | 'line';

/** One series in a legend: its id (what a toggle hides), its label and its tone. */
export interface LegendItem {
  readonly id: string;
  readonly label: string;
  readonly tone: CardTone;
}

/** One table cell: text, or a number sorted numerically. */
export type TableCell = string | number;

/** The data behind a chart as a table: column headings, rows of cells, and how the Source entry shows them. */
export interface TableData {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly TableCell[])[];
  /** How many rows the Source entry shows before "n more"; the table's own default otherwise. */
  readonly limit?: number;
  /** Whether the Source entry's headers sort; true unless set. */
  readonly sortable?: boolean;
}
