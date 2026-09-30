/**
 * The table `rafa roadmap` prints when its Roadmap names epics: the epic
 * rows `src/board/roadmap-epic-rows.ts` read, under one heading per
 * horizon (`.rafa/specs/rafa-244-epics-group-issues-features.md`). The
 * spec's sample put `date` last; it now stands before `title`, so the
 * title is the last column and takes the rest of the line, as the issue
 * table's does:
 *
 * ```text
 * Roadmap #31 · now
 *    #  state        done/total  blocked  date  title
 * #252  in-progress  3/7         -        -     Epics and boards
 * ```
 *
 * A Roadmap is a list of epics, and an epic a list of issues, so this is
 * the epic level alone: no issue row is printed beside an epic row
 * unless `--full` asks for each epic's issues under it.
 *
 * ## No epic line, no change
 *
 * A reading with no epic line, shown or hidden, and a listing that was
 * read is printed as {@link renderRoadmapTable} prints its spec rows,
 * with no heading: a roadmap that names no epic is a list of issues, and
 * prints as one.
 *
 * ## The groups
 *
 * Otherwise the output is a run of groups, one blank line between two:
 *
 *  - one per shown horizon, in the order the reading gives them, headed
 *    {@link epicGroupHeading} `Roadmap #<n> · <horizon>`, then the column
 *    header and one line per epic row, in roadmap order;
 *  - when the listing failed, the line {@link unknownLine} in place of
 *    the epic groups, since no line could be told an epic, and every line
 *    as the issue table under {@link SPECS_HEADING};
 *  - when epic rows are hidden by horizon, the line {@link hiddenLine},
 *    so a roadmap whose epics are all `next` or `later` does not read as
 *    one with no epic at all;
 *  - when lines naming no epic remain beside the epics, the line
 *    {@link looseLine} counting them and naming the first few, or, under
 *    `--full`, the heading {@link looseHeading} and today's issue table
 *    over them. They are the Roadmap's to move into an epic, and one line
 *    says so without turning the epic view back into an issue list.
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
 *  - `date` — the body's date, followed by ` late` when the epic is late.
 *  - `title` — the epic's title; the Roadmap line's `why` when the epic
 *    has none, as an `unknown` epic has not.
 *
 * A cell with nothing to print is {@link EMPTY_CELL}, the one spelling
 * the issue table uses. Columns are padded to their widest cell or header
 * and separated by {@link COLUMN_GAP}; the last, `title`, is unpadded.
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
 * nothing is cut. Width is counted in terminal cells, as the issue table
 * counts it.
 *
 * ## Under --full
 *
 * With `full`, each epic row is followed, after its disagreement line,
 * by its members ({@link memberLines}), indented to start under the
 * `state` column as the disagreement line is:
 *
 * ```text
 * #60  in-progress  1/2         -        Epic alpha  -
 *        #61  closed  Alpha one
 *        #62  open    Alpha two
 *                     └→ 🔴 #13
 * ```
 *
 *  - The first row is the member's number, right-aligned to the epic's
 *    widest, its state ({@link memberState}: `open`, `closed`, or
 *    `not-planned` for one closed as not planned, which the `done/total`
 *    cell counts on neither side) padded to the epic's widest, and its
 *    title.
 *  - A second row, under the member's state and led by `└→`, carries its
 *    blockers while it is open — grouped by their state as the issue
 *    table groups them — and, under `--labels`, its labels after them. In
 *    `labels` mode the blockers are the issues its `Blocked by:` line
 *    names, read with `readBlockedBy` (`src/board/blocked.ts`), each
 *    state off the listing; in `native` mode they are what the rows'
 *    `memberBlockers` answers, the port's reading of its `blockedBy`
 *    nodes, each with the state GitHub holds for it, a foreign one named
 *    `owner/name#<n>`. A closed member's blockers are history and are not
 *    printed, so a closed member with no label to print, like an open one
 *    with no blocker, has no second row.
 *
 * Members come in the epic's checklist order, then the rest by number
 * ({@link orderedMembers}): the label says which epic, the checklist in
 * what order. A `native` epic ({@link Epic.order} `sub-issues`) keeps its
 * members in the sub-issue order they were read in, whatever its body
 * lists. An epic with no members adds no line; its row already
 * reads `empty`. With a terminal width, a member's title is cut to fit,
 * and then its second row, each down to its floor.
 */
import type { TableStyle } from './roadmap-table.js';
import type { Epic } from '../../board/epics.js';
import type { BoardIssue, BoardIssueState } from '../../board/roadmap-board.js';
import type { RoadmapEpicRows, EpicHorizonGroup, EpicRow, MemberBlockers } from '../../board/roadmap-epic-rows.js';
import type { BlockerCell, RoadmapRow } from '../../board/roadmap-rows.js';

import { readBlockedBy } from '../../board/blocked.js';
import { isNotPlanned } from '../../board/epics.js';
import { hasEpicLines } from '../../board/roadmap-epic-rows.js';
import { UNKNOWN_STATE } from '../../board/roadmap-rows.js';

import {
  blockersCell,
  COLUMN_GAP,
  cutCell,
  DEFAULT_STYLE,
  EMPTY_CELL,
  LABELS_FLOOR,
  LABELS_LEAD,
  renderRoadmapTable,
  TITLE_FLOOR,
  widthOf,
} from './roadmap-table.js';

/** The six columns, in order, as the header line spells them. */
export const EPIC_COLUMNS = Object.freeze(['#', 'state', 'done/total', 'blocked', 'date', 'title'] as const);

/** What the table is printed from: the reading's shown parts, `specs` as the caller narrowed them. */
export type EpicTableRows = Pick<RoadmapEpicRows, 'roadmap' | 'groups' | 'hidden' | 'unknown' | 'specs'>
  & Partial<Pick<RoadmapEpicRows, 'states' | 'memberBlockers'>>;

/** The heading over every line when the listing failed, so no line could be told an epic. */
export const SPECS_HEADING = 'Specs';

/** The heading over the lines naming no epic, under `--full`. */
export function looseHeading(roadmap: number): string {
  return `Roadmap #${String(roadmap)} · no epic`;
}

/** How many of the lines naming no epic {@link looseLine} names before it counts the rest. */
export const LOOSE_NAMED = 8;

/** What follows the date of an epic that is late. */
export const LATE_MARK = 'late';

/** Where each column the renderer treats apart sits in {@link EPIC_COLUMNS}. */
const NUMBER_COLUMN = 0;
const TITLE_COLUMN = 5;

/** `text`, or {@link EMPTY_CELL} when it is empty. */
function cell(text: string): string {
  return text === ''
    ? EMPTY_CELL
    : text;
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

/** The line counting the Roadmap's lines that name no epic, the first {@link LOOSE_NAMED} named; see the module note. */
export function looseLine(roadmap: number, rows: readonly RoadmapRow[]): string {
  const lines = rows.length === 1
    ? '1 line names'
    : `${String(rows.length)} lines name`;
  const named = rows
    .slice(0, LOOSE_NAMED)
    .map((row) => `#${String(row.line.issue)}`)
    .join(' ');
  const rest = rows.length > LOOSE_NAMED
    ? ` and ${String(rows.length - LOOSE_NAMED)} more`
    : '';
  return `Roadmap #${String(roadmap)} · ${lines} no epic: ${named}${rest}; --full lists them`;
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
    cell(dateText),
    cell(epic.title === ''
      ? row.line.why
      : epic.title),
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

/** A member's state as `--full` prints it; see the module note. */
export function memberState(member: BoardIssue): string {
  if (isNotPlanned(member)) return 'not-planned';
  return member.state.toLowerCase();
}

/** `epic`'s members in its checklist's order, then the rest by number; a `native` epic's in sub-issue order. */
export function orderedMembers(epic: Epic): readonly BoardIssue[] {
  if (epic.order === 'sub-issues') return epic.members;
  const listed = (epic.body?.lines ?? []).map((line) => line.issue);
  const rank = (member: BoardIssue): number => {
    const at = listed.indexOf(member.number);
    return at === -1
      ? listed.length
      : at;
  };
  return Object.freeze([...epic.members].sort((left, right) => rank(left) - rank(right) || left.number - right.number));
}

/** The issues `member`'s `Blocked by:` line names, when it reads `blocked`, each with its state off `states`. */
export function memberBlockers(member: BoardIssue, states: ReadonlyMap<number, BoardIssueState>): readonly BlockerCell[] {
  const read = readBlockedBy(member.number, member.body);
  if (read.kind !== 'blocked') return [];
  return read.blockers.map((number): BlockerCell => {
    const state = states.get(number);
    return {
      reference: `#${String(number)}`,
      state: state === undefined
        ? UNKNOWN_STATE
        : state === 'OPEN'
          ? 'open'
          : 'closed',
    };
  });
}

/**
 * `text` cut toward `floor` so a line holding `rest` cells beside it
 * fits `width`, never below the floor; uncut with no width.
 */
function fitCell(text: string, floor: number, rest: number, width: number | undefined): string {
  if (width === undefined || !Number.isSafeInteger(width) || width <= 0) return text;
  const natural = widthOf(text);
  const excess = Math.max(0, rest + natural - width);
  return cutCell(text, natural - Math.min(excess, Math.max(0, natural - floor)));
}

/**
 * The rows each of `epic`'s members prints under its epic row, starting
 * `indent` columns in, in {@link orderedMembers} order; the module note
 * holds what each row says. `width` is the terminal's, or undefined for
 * none. `blockersOf` reads an open member's blockers in `native` mode;
 * left out, they are its `Blocked by:` line's, each state off `states`.
 */
export function memberLines(
  epic: Epic,
  indent: number,
  width?: number,
  style: TableStyle = DEFAULT_STYLE,
  states: ReadonlyMap<number, BoardIssueState> = new Map(),
  blockersOf: MemberBlockers = (member) => memberBlockers(member, states),
): string[] {
  const members = orderedMembers(epic);
  if (members.length === 0) return [];
  const numberWidth = Math.max(...members.map((member) => widthOf(`#${String(member.number)}`)));
  const stateWidth = Math.max(...members.map((member) => widthOf(memberState(member))));
  const lead = ' '.repeat(indent);
  const under = `${' '.repeat(indent + numberWidth + COLUMN_GAP.length)}${LABELS_LEAD}`;
  return members.flatMap((member) => {
    const number = `#${String(member.number)}`.padStart(numberWidth);
    const head = `${lead}${number}${COLUMN_GAP}${memberState(member).padEnd(stateWidth)}${COLUMN_GAP}`;
    const first = `${head}${fitCell(cell(member.title), TITLE_FLOOR, widthOf(head), width)}`;
    const second = [
      member.state === 'OPEN'
        ? blockersCell(blockersOf(member), style)
        : '',
      style.labels
        ? cell(member.labels.join(', '))
        : '',
    ]
      .filter((part) => part !== '')
      .join(' · ');
    return second === ''
      ? [first]
      : [first, `${under}${fitCell(second, LABELS_FLOOR, widthOf(under), width)}`];
  });
}

/** One horizon group's lines: heading, header, then each row, its disagreement line and, with `full`, its members. */
function groupLines(
  rows: EpicTableRows,
  group: EpicHorizonGroup,
  width: number | undefined,
  full: boolean,
  style: TableStyle,
): string[] {
  const table = [[...EPIC_COLUMNS], ...group.rows.map(epicCells)];
  const widths = columnWidths(table, width);
  const indentWidth = (widths[NUMBER_COLUMN] ?? 0) + COLUMN_GAP.length;
  const indent = ' '.repeat(indentWidth);
  const lines = group.rows.flatMap((row, index) => {
    const line = lineOf(table[index + 1] ?? [], widths);
    const disagreement = row.epic.disagreement === null
      ? []
      : [`${indent}${row.epic.disagreement}`];
    const members = full
      ? memberLines(row.epic, indentWidth, width, style, rows.states, rows.memberBlockers)
      : [];
    return [line, ...disagreement, ...members];
  });
  return [epicGroupHeading(rows.roadmap, group), lineOf(table[0] ?? [], widths), ...lines];
}

/**
 * The lines naming no epic beside the epics: one counting line, or under
 * `--full` the issue table over them. With the listing failed nothing
 * says which line was an epic, so every line is printed as the issue
 * table under {@link SPECS_HEADING}, as it was read.
 */
function looseGroup(rows: EpicTableRows, width: number | undefined, full: boolean, style: TableStyle): string[][] {
  if (rows.specs.length === 0) return [];
  if (rows.unknown !== null) return [[SPECS_HEADING, ...renderRoadmapTable(rows.specs, width, style)]];
  return full
    ? [[looseHeading(rows.roadmap), ...renderRoadmapTable(rows.specs, width, style)]]
    : [[looseLine(rows.roadmap, rows.specs)]];
}

/**
 * The lines text mode prints for `rows`: the issue table alone when the
 * Roadmap names no epic and the listing was read, else the groups the
 * module note lists, a blank line between two, each epic's members
 * under it when `full` is set. `width` is the terminal's, or undefined
 * for none.
 */
export function renderEpicTable(rows: EpicTableRows, width?: number, full = false, style: TableStyle = DEFAULT_STYLE): string[] {
  if (!hasEpicLines(rows) && rows.unknown === null) return renderRoadmapTable(rows.specs, width, style);
  const epicGroups = rows.groups.map((group) => groupLines(rows, group, width, full, style));
  const unknown = rows.unknown === null
    ? []
    : [[unknownLine(rows.roadmap, rows.unknown)]];
  const hidden = rows.hidden > 0
    ? [[hiddenLine(rows.roadmap, rows.hidden)]]
    : [];
  return [...epicGroups, ...unknown, ...hidden, ...looseGroup(rows, width, full, style)]
    .flatMap((group, index) => index === 0
      ? group
      : ['', ...group]);
}
