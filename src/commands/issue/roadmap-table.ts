/**
 * The table `rafa issue list --roadmap` prints: one line per
 * {@link RoadmapRow}, in the order the rows arrive, under a header line
 * naming the eight columns (`.rafa/specs/rafa-123-rafa-issue-list-roadmap.md`).
 *
 * ## The columns
 *
 * In order, each from what `src/board/roadmap-rows.ts` read:
 *
 *  - `#` — the Roadmap line's issue, as `#123`, right-aligned.
 *  - `state` — the board's state, `open` or `closed`.
 *  - `type` — the type the labels carry, as the github tracker reads it.
 *  - `spec` — {@link specText}, the spelling the row reading owns.
 *  - `blocked by` — {@link blockersText}: `#24 open, #26 closed`.
 *  - `has` — {@link hasText}: `plan, branch, pr #40`.
 *  - `labels` — every label on the issue, joined with `, `.
 *  - `title` — the issue's title; with no issue on the row, the Roadmap
 *    line's own `why`, so a row read while the board was unreachable
 *    still says what it is.
 *
 * The three reading columns are spelled by the functions the row module
 * exports and never here, so `issue list --roadmap` and any later caller
 * cannot spell one reading two ways.
 *
 * ## An empty cell
 *
 * A cell with nothing to print is {@link EMPTY_CELL}, `-`, in every
 * column alike: no issue on the row (the board unreachable, or the
 * listing not holding it), no `Blocked by:` line, nothing in `has`, no
 * labels, and a title-less row with no `why`. A blank cell would leave
 * a gap that reads as a misaligned column, and one spelling for all
 * eight keeps "nothing here" one thing to look for.
 *
 * ## The width rule
 *
 * Columns are separated by {@link COLUMN_GAP}, each padded to its widest
 * cell or header, the last (`title`) unpadded, so a line is exactly as
 * wide as its content. Width is counted in code points: a title holding
 * a character a terminal draws two cells wide is counted as one, and
 * such a line can overflow by that much.
 *
 * With no terminal width — `process.stdout.columns` is undefined when
 * stdout is a pipe or a file, and so is anything but a positive whole
 * number here — nothing is cut: a capture holds every character.
 *
 * With a width and a table wider than it, `title` is cut first, down to
 * {@link TITLE_FLOOR}, and only then `labels`, down to
 * {@link LABELS_FLOOR}; a cut cell ends with `…`. The other six columns
 * are never cut: they are short by construction and are the reason the
 * table is printed. A table still wider than the terminal with both at
 * their floors is printed as it then stands and wraps; a column cut
 * below its floor would stop being readable at all. A table that fits
 * exactly is not cut.
 */
import type { RoadmapRow } from '../../board/roadmap-rows.js';

import { blockersText, hasText, specText } from '../../board/roadmap-rows.js';

/** What a cell with nothing to print holds; see the module note. */
export const EMPTY_CELL = '-';

/** What stands between two columns. */
export const COLUMN_GAP = '  ';

/** The narrowest `title` is cut to before `labels` is cut at all. */
export const TITLE_FLOOR = 20;

/** The narrowest `labels` is cut to. */
export const LABELS_FLOOR = 12;

/** What ends a cut cell. */
const ELLIPSIS = '…';

/** The eight columns, in order, as the header line spells them. */
export const ROADMAP_COLUMNS = Object.freeze([
  '#',
  'state',
  'type',
  'spec',
  'blocked by',
  'has',
  'labels',
  'title',
] as const);

/** Where each column the width rule touches sits in {@link ROADMAP_COLUMNS}. */
const NUMBER_COLUMN = 0;
const LABELS_COLUMN = 6;
const TITLE_COLUMN = 7;

/** `text`, or {@link EMPTY_CELL} when it is empty. */
function cell(text: string): string {
  return text === ''
    ? EMPTY_CELL
    : text;
}

/** How wide `text` is, counted in code points. */
function widthOf(text: string): number {
  return [...text].length;
}

/** The title a row prints: the issue's, else the Roadmap line's `why`. */
function titleOf(row: RoadmapRow): string {
  return row.issue === null
    ? row.line.why
    : row.issue.title;
}

/** One row's eight cells, uncut and unpadded. */
export function roadmapCells(row: RoadmapRow): readonly string[] {
  const state = row.issue === null
    ? ''
    : row.issue.state.toLowerCase();
  return Object.freeze([
    `#${String(row.line.issue)}`,
    cell(state),
    cell(row.issue?.type ?? ''),
    cell(specText(row.spec)),
    cell(blockersText(row.blockers)),
    cell(hasText(row.has)),
    cell(row.issue?.labels.join(', ') ?? ''),
    cell(titleOf(row)),
  ]);
}

/** `text` cut to `width` code points, ending with `…` when it was cut. */
export function cutCell(text: string, width: number): string {
  const points = [...text];
  if (points.length <= width) return text;
  return `${points.slice(0, Math.max(0, width - 1)).join('')}${ELLIPSIS}`;
}

/** True when `width` is one the width rule applies: a positive whole number. */
function isTerminalWidth(width: number | undefined): width is number {
  return width !== undefined && Number.isSafeInteger(width) && width > 0;
}

/** How far `natural` can shrink toward `floor` to pay `excess`: never below the floor, never negative. */
function cutBy(natural: number, floor: number, excess: number): number {
  return Math.min(Math.max(0, excess), Math.max(0, natural - floor));
}

/**
 * Each column's width once the width rule has run over `natural`: the
 * widths as they are with no terminal width or when the table fits,
 * else `title` cut toward {@link TITLE_FLOOR} first and `labels` toward
 * {@link LABELS_FLOOR} after it.
 */
export function fitColumnWidths(natural: readonly number[], width: number | undefined): readonly number[] {
  if (!isTerminalWidth(width)) return Object.freeze([...natural]);
  const total = natural.reduce((sum, column) => sum + column, 0) + COLUMN_GAP.length * (natural.length - 1);
  const excess = total - width;
  const titleCut = cutBy(natural[TITLE_COLUMN] ?? 0, TITLE_FLOOR, excess);
  const labelsCut = cutBy(natural[LABELS_COLUMN] ?? 0, LABELS_FLOOR, excess - titleCut);
  return Object.freeze(natural.map((column, index) => {
    if (index === TITLE_COLUMN) return column - titleCut;
    if (index === LABELS_COLUMN) return column - labelsCut;
    return column;
  }));
}

/** One line of cells at `widths`: `#` right-aligned, the rest left, the last unpadded. */
function lineOf(cells: readonly string[], widths: readonly number[]): string {
  return cells.map((text, index) => {
    const width = widths[index] ?? 0;
    const cut = cutCell(text, width);
    if (index === cells.length - 1) return cut;
    const pad = ' '.repeat(Math.max(0, width - widthOf(cut)));
    return index === NUMBER_COLUMN
      ? `${pad}${cut}`
      : `${cut}${pad}`;
  }).join(COLUMN_GAP);
}

/**
 * The lines text mode prints for `rows`: the header, then one line per
 * row in the order given; the header alone when there is no row. `width`
 * is the terminal's, or undefined for none; see the module note for what
 * it cuts.
 */
export function renderRoadmapTable(rows: readonly RoadmapRow[], width?: number): string[] {
  const table = [[...ROADMAP_COLUMNS], ...rows.map(roadmapCells)];
  const natural = ROADMAP_COLUMNS.map((_, index) => Math.max(...table.map((cells) => widthOf(cells[index] ?? ''))));
  const widths = fitColumnWidths(natural, width);
  return table.map((cells) => lineOf(cells, widths));
}
