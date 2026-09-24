/**
 * The row every `rafa doctor --deep` section is read into, the section
 * holding them, and the text lines both render to.
 *
 * Each deep section module (`./doctor-deep-*.ts`) reads the machine into
 * {@link DeepSection} data and renders it through this module, so every
 * section words its rows alike. A deep row is never a `PreflightCheck`
 * and never moves doctor's exit code: its status is one of three
 * readings, none of them a failure.
 *
 * | Status | Meaning |
 * |---|---|
 * | `ok` | the reading is as a loop session needs it |
 * | `warn` | a session will likely miss something |
 * | `note` | worth knowing, not wrong |
 *
 * ## The lines
 *
 * A section renders its title, then one line per row: the status padded
 * to {@link STATUS_WIDTH}, the name, a colon and the detail. A row with a
 * fix adds a line under it, indented past the status, starting `fix: `.
 * A section with no rows says so in one line rather than printing a bare
 * title, so a reader can tell an empty reading from a missing one.
 */

/** How a deep row reads; none of the three is a failure. */
export type DeepRowStatus = 'ok' | 'warn' | 'note';

/** One reading of a deep section. */
export interface DeepRow {
  readonly status: DeepRowStatus;
  /** What was read, such as a tool or a setting source. */
  readonly name: string;
  /** What the reading found. */
  readonly detail: string;
  /** What to do about it, when there is something to do. */
  readonly fix?: string;
}

/** A titled group of deep rows, such as Environment or Stack tools. */
export interface DeepSection {
  readonly title: string;
  readonly rows: readonly DeepRow[];
}

/** The width the status column is padded to: the longest status and a space. */
export const STATUS_WIDTH = 5;

/** The indent of every row line under its section title. */
const ROW_INDENT = '  ';

/** The line a section with no rows shows under its title. */
export const EMPTY_SECTION_LINE = `${ROW_INDENT}nothing to report`;

/** The lines one row renders to: the row, and its fix when it has one. */
export function renderDeepRow(row: DeepRow): readonly string[] {
  const line = `${ROW_INDENT}${row.status.padEnd(STATUS_WIDTH)} ${row.name}: ${row.detail}`;
  if (row.fix === undefined) return [line];
  const fixIndent = ' '.repeat(ROW_INDENT.length + STATUS_WIDTH + 1);
  return [line, `${fixIndent}fix: ${row.fix}`];
}

/** The lines one section renders to: its title and its rows; see the module note. */
export function renderDeepSection(section: DeepSection): readonly string[] {
  const rows = section.rows.length === 0
    ? [EMPTY_SECTION_LINE]
    : section.rows.flatMap(renderDeepRow);
  return [`${section.title}:`, ...rows];
}
