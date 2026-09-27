/**
 * The table `rafa roadmap` prints when its Roadmap names epics: the epic
 * rows `src/board/roadmap-epic-rows.ts` read, under one heading per
 * horizon, then the spec lines as today's table under a `Specs` heading
 * (`.rafa/specs/rafa-244-epics-group-issues-features.md`). The spec's
 * sample, which `./roadmap-epic-table.test.ts` reproduces byte for byte
 * up to the `title` cell; the sample pads `title` to 21 columns where
 * the width rule below pads it to its widest cell, 16:
 *
 * ```text
 * Roadmap #31 · now
 *    #  state        done/total  blocked  title                  date
 * #252  in-progress  3/7         -        Epics and boards       -
 * ```
 *
 * ## No epic line, no change
 *
 * A reading with no epic line, shown or hidden, and a listing that was
 * read is printed as {@link renderRoadmapTable} prints its spec rows,
 * with no heading: a roadmap with no epic line prints today's table
 * byte for byte, as the spec asks.
 *
 * ## The groups
 *
 * Otherwise the output is a run of groups, one blank line between two:
 *
 *  - one per shown horizon, in the order the reading gives them, headed
 *    {@link epicGroupHeading} `Roadmap #<n> · <horizon>`, then the column
 *    header and one line per epic row, in roadmap order;
 *  - when the listing failed, the line {@link unknownLine} in place of
 *    the epic groups, since no line could be told an epic: every line is
 *    then a spec row and the epics read `unknown` with the reason;
 *  - when epic rows are hidden by horizon, the line {@link hiddenLine},
 *    so a roadmap whose epics are all `next` or `later` does not read as
 *    one with no epic at all;
 *  - when spec rows remain, {@link SPECS_HEADING} and today's table over
 *    them, with its own nine columns and width rule.
 *
 * ## The six columns
 *
 *  - `#` — the epic's number, as `#252`, right-aligned.
 *  - `state` — the COMPUTED state: `backlog`, `in-progress`, `done`,
 *    `empty` or `unknown`.
 *  - `done/total` — the counted members closed over the counted members;
 *    a member closed as not planned counts on neither side.
 *  - `blocked` — the epics this epic's open members wait on, as
 *    `#12, #14`.
 *  - `title` — the epic's title; the Roadmap line's `why` when the epic
 *    has none, as an `unknown` epic has not.
 *  - `date` — the body's date, followed by ` late` when the epic is late.
 *
 * A cell with nothing to print is {@link EMPTY_CELL}, the one spelling
 * today's table uses. Columns are padded to their widest cell or header
 * and separated by {@link COLUMN_GAP}; the last, `date`, is unpadded.
 *
 * ## The disagreement line
 *
 * An epic whose stored state disagrees with its computed one is followed
 * by the line `readEpics` spelled for it (`done, but epic #252 is still
 * open`), indented to start under the `state` column so it reads as
 * belonging to the row above. It is printed, never resolved.
 *
 * ## The width rule
 *
 * Only `title` is cut, and only when a terminal width is given and the
 * table is wider than it, down to {@link TITLE_FLOOR}, ending with `…`.
 * The other five columns are short by construction. With no width,
 * nothing is cut.
 */
import type { RoadmapEpicRows, EpicHorizonGroup, EpicRow } from '../../board/roadmap-epic-rows.js';

import { hasEpicLines } from '../../board/roadmap-epic-rows.js';

import { COLUMN_GAP, cutCell, EMPTY_CELL, renderRoadmapTable, TITLE_FLOOR } from './roadmap-table.js';

/** The six columns, in order, as the header line spells them. */
export const EPIC_COLUMNS = Object.freeze(['#', 'state', 'done/total', 'blocked', 'title', 'date'] as const);

/** What the table is printed from: the reading's shown parts, `specs` as the caller narrowed them. */
export type EpicTableRows = Pick<RoadmapEpicRows, 'roadmap' | 'groups' | 'hidden' | 'unknown' | 'specs'>;

/** The heading over the spec rows when the Roadmap also names epics. */
export const SPECS_HEADING = 'Specs';

/** What follows the date of an epic that is late. */
export const LATE_MARK = 'late';

/** Where each column the renderer treats apart sits in {@link EPIC_COLUMNS}. */
const NUMBER_COLUMN = 0;
const TITLE_COLUMN = 4;

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

/** The heading over one horizon's epic rows. */
export function epicGroupHeading(roadmap: number, group: EpicHorizonGroup): string {
  return `Roadmap #${String(roadmap)} · ${group.horizon}`;
}

/** The line printed for epics when the listing failed. */
export function unknownLine(roadmap: number, reason: string): string {
  return `Roadmap #${String(roadmap)} · epics unknown: ${reason}`;
}

/** The line printed when `hidden` epic rows sit under a horizon not shown. */
export function hiddenLine(roadmap: number, hidden: number): string {
  const epics = hidden === 1
    ? '1 epic'
    : `${String(hidden)} epics`;
  return `Roadmap #${String(roadmap)} · ${epics} not in now; --all shows every horizon`;
}

/** One epic row's six cells, uncut and unpadded. */
export function epicCells(row: EpicRow): readonly string[] {
  const { epic } = row;
  const date = epic.body?.date ?? '';
  const dateText = epic.late && date !== ''
    ? `${date} ${LATE_MARK}`
    : date;
  return Object.freeze([
    `#${String(epic.number)}`,
    epic.state,
    `${String(epic.progress.done)}/${String(epic.progress.total)}`,
    cell(epic.blockedBy.map((number) => `#${String(number)}`).join(', ')),
    cell(epic.title === ''
      ? row.line.why
      : epic.title),
    cell(dateText),
  ]);
}

/** Each column's width: its widest cell or header, `title` cut toward its floor to fit `width`. */
function columnWidths(table: readonly (readonly string[])[], width: number | undefined): readonly number[] {
  const natural = EPIC_COLUMNS.map((_, index) => Math.max(...table.map((cells) => widthOf(cells[index] ?? ''))));
  if (width === undefined || !Number.isSafeInteger(width) || width <= 0) return natural;
  const total = natural.reduce((sum, column) => sum + column, 0) + COLUMN_GAP.length * (natural.length - 1);
  const title = natural[TITLE_COLUMN] ?? 0;
  const cut = Math.min(Math.max(0, total - width), Math.max(0, title - TITLE_FLOOR));
  return natural.map((column, index) => index === TITLE_COLUMN
    ? column - cut
    : column);
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

/** One horizon group's lines: heading, header, then each row and its disagreement line. */
function groupLines(roadmap: number, group: EpicHorizonGroup, width: number | undefined): string[] {
  const table = [[...EPIC_COLUMNS], ...group.rows.map(epicCells)];
  const widths = columnWidths(table, width);
  const indent = ' '.repeat((widths[NUMBER_COLUMN] ?? 0) + COLUMN_GAP.length);
  const rows = group.rows.flatMap((row, index) => {
    const line = lineOf(table[index + 1] ?? [], widths);
    return row.epic.disagreement === null
      ? [line]
      : [line, `${indent}${row.epic.disagreement}`];
  });
  return [epicGroupHeading(roadmap, group), lineOf(table[0] ?? [], widths), ...rows];
}

/**
 * The lines text mode prints for `rows`: today's table alone when the
 * Roadmap names no epic and the listing was read, else the groups the
 * module note lists, a blank line between two. `width` is the
 * terminal's, or undefined for none.
 */
export function renderEpicTable(rows: EpicTableRows, width?: number): string[] {
  if (!hasEpicLines(rows) && rows.unknown === null) return renderRoadmapTable(rows.specs, width);
  const epicGroups = rows.groups.map((group) => groupLines(rows.roadmap, group, width));
  const unknown = rows.unknown === null
    ? []
    : [[unknownLine(rows.roadmap, rows.unknown)]];
  const hidden = rows.hidden > 0
    ? [[hiddenLine(rows.roadmap, rows.hidden)]]
    : [];
  const specs = rows.specs.length > 0
    ? [[SPECS_HEADING, ...renderRoadmapTable(rows.specs, width)]]
    : [];
  return [...epicGroups, ...unknown, ...hidden, ...specs]
    .flatMap((group, index) => index === 0
      ? group
      : ['', ...group]);
}
