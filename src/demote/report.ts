/**
 * The demotion pass's ledger: the file `rafa skill demote` writes
 * before it moves anything, and reads back before it moves anything.
 *
 * The pass classifies files it did not write, so every verdict is a
 * proposal a human settles. This module is the shape that proposal
 * travels in — `<scope>/.rafa/demoted/report.md`, a `status` header
 * over one row per file — and it is deliberately the whole contract
 * between the two halves of the pass: {@link writeDemotionReport}
 * renders what the classifier said, a reviewer edits the file by hand
 * in an editor, and {@link parseDemotionReport} reads back what
 * survived that edit. Nothing here opens a file, hashes a file on
 * disk, or moves one; the command owns every side effect and this
 * module owns only the text.
 *
 * ## Why the status is frontmatter and the rows are a table
 *
 * The header is a `---` block read by `../schema/frontmatter.ts`, the
 * repo's one frontmatter reader, so `status: reviewed` is typed the
 * same way as every other field a human edits in this repo and is read
 * by the same parser. The rows are a GitHub-flavoured markdown table
 * because the review step is a person reading the report rendered, and
 * because a table row is the smallest unit an editor can lose without
 * the loss being visible.
 *
 * Neither choice is decorative for the reader: everything outside the
 * frontmatter and the table is prose the writer emits for the reviewer
 * and the reader skips entirely, so a reviewer may add notes above or
 * below the table and the pass will not notice. Notes INSIDE the table
 * are a different matter — the reader consumes rows until the first
 * line holding no unescaped `|`, so a note between two rows truncates
 * the table and the rows under it are silently lost. That is why the
 * command compares the report's row set against the directory rather
 * than trusting its length, and why {@link DEMOTION_REPORT_COLUMNS} is
 * checked against the header row rather than assumed.
 *
 * ## The escaping, and why a cell is escaped at all
 *
 * A bare `|` inside a cell splits a markdown table row silently. Five
 * of the six columns are written by rafa and could be trusted; the
 * sixth, the override reason, is typed by a reviewer who will not be
 * thinking about table syntax when they type `use | over xargs`. So
 * every cell is escaped on the way out (`\` as `\\`, `|` as `\|`) and
 * unescaped on the way back in, and {@link splitTableRow} splits on
 * unescaped pipes only. A reviewer who types a bare `|` anyway gets a
 * `wrong-cell-count` issue naming the row rather than a report that
 * reads back with the reason and the override silently shifted by one
 * column.
 *
 * ## What is an issue, and what is merely a draft
 *
 * `status: draft` is not an issue. A draft report is the normal output
 * of the first half of the pass, it parses clean, and refusing to
 * apply it is the command's rule rather than the schema's. What IS an
 * issue is a half-finished review, because that is the edit a reviewer
 * makes and does not notice: an override verdict with no reason
 * ({@link DemotionReportIssueCode} `override-without-reason`) and an
 * override reason with no verdict (`override-reason-without-verdict`)
 * are both refused, so a row that was being reconsidered when the
 * session ended cannot be applied as though it had been decided.
 *
 * As in `../schema/instinct.ts`, a parse that produced any issue
 * answers a null report rather than a partial one: `--apply` acts on
 * every row at once and a report half of which is readable is not a
 * report the pass may act on.
 */

import type { DemotionVerdict } from './classify.js';

import { createHash } from 'node:crypto';

import { readFrontmatterDocument, renderFrontmatter } from '../schema/frontmatter.js';

import { DEMOTION_VERDICTS } from './classify.js';

/** Whether the report has been through the review. */
export type DemotionReportStatus = 'draft' | 'reviewed';

/** Every status, in the order a report passes through them. */
export const DEMOTION_REPORT_STATUSES: readonly DemotionReportStatus[] = ['draft', 'reviewed'];

/** The frontmatter key carrying {@link DemotionReportStatus}. */
export const STATUS_FIELD = 'status';

/** The status a freshly written report carries. */
export const DRAFT_STATUS: DemotionReportStatus = 'draft';

/** The status `--apply` requires. */
export const REVIEWED_STATUS: DemotionReportStatus = 'reviewed';

/** The table's columns, in order, as the header row spells them. */
export const DEMOTION_REPORT_COLUMNS: readonly string[] = [
  'file',
  'sha256',
  'verdict',
  'reason',
  'override',
  'override reason',
];

/**
 * What an empty override cell is written as. An empty cell renders as
 * a gap a reviewer cannot tell from a cell they lost, so the writer
 * fills it; the reader accepts either.
 */
export const EMPTY_CELL = '-';

/** The hash column's shape: sha256 in lower-case hex. */
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** The heading the written report opens its body with. */
export const REPORT_TITLE = '# Demotion report';

/** One file the pass looked at, and what is to become of it. */
export interface DemotionReportRow {
  /** Its path relative to the skills directory, in posix form. */
  readonly path: string;
  /** {@link sourceHash} of the file as the pass read it. */
  readonly hash: string;
  /** What the classifier said. */
  readonly verdict: DemotionVerdict;
  /** The one line naming the rule that decided {@link DemotionReportRow.verdict}. */
  readonly reason: string;
  /** What the review said instead, or null where it let the verdict stand. */
  readonly override: DemotionVerdict | null;
  /** Why the review overrode it, or null where it did not. */
  readonly overrideReason: string | null;
}

/** A whole report: its header and its rows. */
export interface DemotionReport {
  /** `status`, {@link DRAFT_STATUS} until the review marks it. */
  readonly status: DemotionReportStatus;
  /** One row per file, in the order the report lists them. */
  readonly rows: readonly DemotionReportRow[];
}

/** Why a report was refused. One code per RULE. */
export type DemotionReportIssueCode =
  /** The text opens with no readable `---` block. */
  | 'missing-frontmatter'
  /** No {@link STATUS_FIELD} key, or one carrying nothing. */
  | 'missing-status'
  /** A status outside {@link DEMOTION_REPORT_STATUSES}. */
  | 'unknown-status'
  /** No table with a header row and a delimiter under it. */
  | 'missing-table'
  /** A table whose header is not {@link DEMOTION_REPORT_COLUMNS}. */
  | 'unknown-columns'
  /** A row holding some number of cells other than the header's. */
  | 'wrong-cell-count'
  /** A row whose file cell is empty. */
  | 'missing-path'
  /** A hash cell that is not {@link SHA256_PATTERN}-shaped. */
  | 'invalid-hash'
  /** A verdict outside {@link DEMOTION_VERDICTS}. */
  | 'unknown-verdict'
  /** A row whose reason cell is empty. */
  | 'missing-reason'
  /** An override cell that is neither empty nor a verdict. */
  | 'unknown-override'
  /** An override verdict with no reason beside it. */
  | 'override-without-reason'
  /** An override reason with no verdict beside it. */
  | 'override-reason-without-verdict'
  /** Two rows naming the same file. */
  | 'duplicate-path';

/** Every code, in the order this module documents them. */
export const DEMOTION_REPORT_ISSUE_CODES: readonly DemotionReportIssueCode[] = [
  'missing-frontmatter',
  'missing-status',
  'unknown-status',
  'missing-table',
  'unknown-columns',
  'wrong-cell-count',
  'missing-path',
  'invalid-hash',
  'unknown-verdict',
  'missing-reason',
  'unknown-override',
  'override-without-reason',
  'override-reason-without-verdict',
  'duplicate-path',
];

/** One thing the report said that the reader cannot accept. */
export interface DemotionReportIssue {
  /** Which rule was broken. */
  readonly code: DemotionReportIssueCode;
  /** The column or the header key it concerns. */
  readonly field: string;
  /** A sentence a caller prints unedited, with no leading field name. */
  readonly message: string;
  /** The 1-based line of the report it was read on, for an editor. */
  readonly line: number;
}

/** What {@link parseDemotionReport} answers. */
export interface DemotionReportParseResult {
  /** Every rule broken, in report order. Empty on a clean report. */
  readonly issues: readonly DemotionReportIssue[];
  /** The report read, or null when `issues` is non-empty. */
  readonly report: DemotionReport | null;
}

/** A table delimiter cell: `---`, `:--`, `--:` or `:-:`. */
const DELIMITER_CELL = /^:?-{2,}:?$/;

/**
 * `sha256(text)` in hex over the file's UTF-8 bytes: the hash column,
 * and the one thing `--apply` checks a file against before it moves
 * it. Taken over the text rather than over the bytes as read, so a
 * caller that already holds a file's text never has to reopen it; the
 * two agree for every file this pass reads, which are all decoded as
 * UTF-8 by the same reader.
 */
export function sourceHash(text: string): string {
  return createHash('sha256').update(text, 'utf8')
    .digest('hex');
}

/**
 * The verdict a row is to be applied under: its override where the
 * review wrote one, its classified verdict otherwise. The one place
 * the override column's meaning is spelled, so the apply step and the
 * counts can never disagree about it.
 */
export function effectiveVerdict(row: DemotionReportRow): DemotionVerdict {
  return row.override ?? row.verdict;
}

/** How many rows carry each {@link effectiveVerdict}, verdicts with none at 0. */
export function countVerdicts(
  rows: readonly DemotionReportRow[],
): Readonly<Record<DemotionVerdict, number>> {
  const counts = Object.fromEntries(
    DEMOTION_VERDICTS.map((verdict) => [verdict, 0]),
  ) as Record<DemotionVerdict, number>;

  for (const row of rows) counts[effectiveVerdict(row)] += 1;
  return counts;
}

/** `value` as a cell: whitespace collapsed, `\` and `|` escaped. */
function escapeCell(value: string): string {
  return value.replace(/\s+/g, ' ')
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|');
}

/** One table line from `cells`, pipe-fenced at both ends. */
function tableLine(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

/** A row's cells, or null when `line` holds no unescaped `|` at all. */
export function splitTableRow(line: string): string[] | null {
  const cells: string[] = [];
  let cell = '';
  let escaped = false;
  let split = false;

  for (const char of line) {
    if (escaped) {
      if (char === '|' || char === '\\') cell += char;
      else cell += `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '|') {
      cells.push(cell.trim());
      cell = '';
      split = true;
      continue;
    }
    cell += char;
  }

  if (escaped) cell += '\\';
  cells.push(cell.trim());
  if (!split) return null;

  if (cells[0] === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/** True when every cell is a delimiter, and there is at least one. */
function isDelimiterRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((cell) => DELIMITER_CELL.test(cell));
}

/** The report's frontmatter as a rendered block, fences included. */
function renderHeader(status: DemotionReportStatus): string {
  return `---\n${renderFrontmatter({ [STATUS_FIELD]: status })}\n---`;
}

/** The sentence under {@link REPORT_TITLE}, naming the counts. */
function summaryLine(rows: readonly DemotionReportRow[]): string {
  const counts = countVerdicts(rows);
  const files = rows.length === 1
    ? '1 file'
    : `${rows.length} files`;
  const parts = DEMOTION_VERDICTS.map((verdict) => `${counts[verdict]} ${verdict}`);

  return `${files}: ${parts.join(', ')}.`;
}

/**
 * `report` as the file it is stored in: a {@link STATUS_FIELD} header,
 * a title, a line of counts for the reviewer, and one table row per
 * file in the order `report` lists them. Rows are written unsorted and
 * unpadded on purpose — the caller decides the order, and padding a
 * 64-character hash beside a sentence-long reason produces lines no
 * reviewer can read in an editor.
 */
export function writeDemotionReport(report: DemotionReport): string {
  const rows = report.rows.map((row) => tableLine([
    escapeCell(row.path),
    escapeCell(row.hash),
    escapeCell(row.verdict),
    escapeCell(row.reason),
    escapeCell(row.override ?? EMPTY_CELL),
    escapeCell(row.overrideReason ?? EMPTY_CELL),
  ]));

  return [
    renderHeader(report.status),
    '',
    REPORT_TITLE,
    '',
    summaryLine(report.rows),
    '',
    tableLine(DEMOTION_REPORT_COLUMNS),
    tableLine(DEMOTION_REPORT_COLUMNS.map(() => '---')),
    ...rows,
    '',
  ].join('\n');
}

/** One issue, spelled once so every check reads the same. */
function issue(
  code: DemotionReportIssueCode,
  field: string,
  message: string,
  line: number,
): DemotionReportIssue {
  return { code, field, message, line };
}

/** The status `data` names, or an issue saying why it names none. */
function readStatus(
  data: Readonly<Record<string, unknown>>,
): DemotionReportStatus | DemotionReportIssue {
  const value = data[STATUS_FIELD];
  if (value === undefined || value === null || value === '') {
    return issue('missing-status', STATUS_FIELD, `no \`${STATUS_FIELD}\` in the header`, 1);
  }

  const found = DEMOTION_REPORT_STATUSES.find((status) => status === value);
  if (found === undefined) {
    return issue(
      'unknown-status',
      STATUS_FIELD,
      `status ${JSON.stringify(String(value))} is not `
      + `${DEMOTION_REPORT_STATUSES.join(' or ')}`,
      1,
    );
  }

  return found;
}

/** The verdict `cell` names, or null when it names none. */
function readVerdict(cell: string): DemotionVerdict | null {
  return DEMOTION_VERDICTS.find((verdict) => verdict === cell) ?? null;
}

/** An empty cell, written or left blank. */
function isEmptyCell(cell: string): boolean {
  return cell === '' || cell === EMPTY_CELL;
}

/** The lines of the table in `lines`, or null when there is none. */
function findTable(lines: readonly string[]): { header: string[]; start: number } | null {
  for (let index = 0; index + 1 < lines.length; index += 1) {
    const header = splitTableRow(lines[index] ?? '');
    if (header === null) continue;

    const delimiter = splitTableRow(lines[index + 1] ?? '');
    if (delimiter !== null && isDelimiterRow(delimiter)) {
      return { header, start: index };
    }
  }

  return null;
}

/** One row's cells read into a row, with every rule it broke. */
function readRow(
  cells: readonly string[],
  line: number,
  seen: ReadonlySet<string>,
): { row: DemotionReportRow | null; issues: readonly DemotionReportIssue[] } {
  const issues: DemotionReportIssue[] = [];
  const [
    path = '',
    hash = '',
    verdictCell = '',
    reason = '',
    overrideCell = '',
    overrideReason = '',
  ] = cells;

  if (path === '') issues.push(issue('missing-path', 'file', 'the file cell is empty', line));
  else if (seen.has(path)) {
    issues.push(issue('duplicate-path', 'file', `${path} has a row already`, line));
  }
  if (!SHA256_PATTERN.test(hash)) {
    issues.push(issue('invalid-hash', 'sha256', `${JSON.stringify(hash)} is not a sha256 digest`, line));
  }

  const verdict = readVerdict(verdictCell);
  if (verdict === null) {
    issues.push(issue(
      'unknown-verdict',
      'verdict',
      `verdict ${JSON.stringify(verdictCell)} is not one of ${DEMOTION_VERDICTS.join(', ')}`,
      line,
    ));
  }
  if (reason === '') issues.push(issue('missing-reason', 'reason', 'the reason cell is empty', line));

  const override = isEmptyCell(overrideCell)
    ? null
    : readVerdict(overrideCell);
  if (!isEmptyCell(overrideCell) && override === null) {
    issues.push(issue(
      'unknown-override',
      'override',
      `override ${JSON.stringify(overrideCell)} is not one of ${DEMOTION_VERDICTS.join(', ')}`,
      line,
    ));
  }

  const written = isEmptyCell(overrideReason)
    ? null
    : overrideReason;
  if (override !== null && written === null) {
    issues.push(issue('override-without-reason', 'override reason', 'an override needs a reason', line));
  }
  if (isEmptyCell(overrideCell) && written !== null) {
    issues.push(issue(
      'override-reason-without-verdict',
      'override',
      'an override reason needs an override verdict',
      line,
    ));
  }

  if (issues.length > 0 || verdict === null) return { row: null, issues };
  return {
    row: { path, hash, verdict, reason, override, overrideReason: written },
    issues,
  };
}

/**
 * `text` read as a report: its {@link STATUS_FIELD} header and every
 * row of its table. A text that broke any rule answers a null report
 * beside the rules it broke, because `--apply` acts on every row at
 * once and half a report is not one the pass may act on.
 *
 * Everything outside the frontmatter and the table is ignored, so the
 * title, the counts and any note a reviewer added survive a read. The
 * table ends at the first line holding no unescaped `|`.
 */
export function parseDemotionReport(text: string): DemotionReportParseResult {
  const document = readFrontmatterDocument(text);
  if (document === null) {
    return {
      issues: [issue('missing-frontmatter', STATUS_FIELD, 'the report opens with no `---` block', 1)],
      report: null,
    };
  }

  const issues: DemotionReportIssue[] = [];
  const status = readStatus(document.data);
  if (typeof status !== 'string') issues.push(status);

  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));
  const bodyStart = lines.length - document.body.split('\n').length;
  const table = findTable(lines.slice(bodyStart));

  if (table === null) {
    issues.push(issue('missing-table', 'file', 'the report holds no row table', 1));
    return { issues, report: null };
  }

  const headerLine = bodyStart + table.start + 1;
  const expected = DEMOTION_REPORT_COLUMNS.join(' | ');
  if (table.header.map((cell) => cell.toLowerCase()).join(' | ') !== expected) {
    issues.push(issue(
      'unknown-columns',
      'file',
      `the table header is not \`${expected}\``,
      headerLine,
    ));
    return { issues, report: null };
  }

  const rows: DemotionReportRow[] = [];
  const seen = new Set<string>();

  for (let index = bodyStart + table.start + 2; index < lines.length; index += 1) {
    const cells = splitTableRow(lines[index] ?? '');
    if (cells === null) break;

    if (cells.length !== DEMOTION_REPORT_COLUMNS.length) {
      issues.push(issue(
        'wrong-cell-count',
        'file',
        `the row holds ${cells.length} cells, not ${DEMOTION_REPORT_COLUMNS.length}`,
        index + 1,
      ));
      continue;
    }

    const read = readRow(cells, index + 1, seen);
    issues.push(...read.issues);
    if (read.row !== null) {
      seen.add(read.row.path);
      rows.push(read.row);
    }
  }

  if (issues.length > 0 || typeof status !== 'string') return { issues, report: null };
  return { issues, report: { status, rows } };
}
