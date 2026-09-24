/**
 * The words `rafa cleanup` shows for what `src/cleanup/` read: the four
 * groups as text lines, one line per row, and the same reading as the
 * JSON data of the terminal result event. It prints nothing and deletes
 * nothing; `./cleanup.ts` writes these lines and, where there is a
 * terminal, asks over the same row lines.
 *
 * ## The text lines
 *
 * The notes come first, one `note: <line>` each, because they qualify
 * every row below them (a failed fetch, an unreachable provider). Then
 * the four groups in the order the spec's Design table lists them —
 * Merged, Stale, Not pushed, Worktrees — each under a heading naming
 * how many rows it holds, and each row one line, indented two spaces:
 * its name, its date and its reason, the names padded to one column
 * across all four groups so the dates line up. A group with no rows
 * still shows its heading and {@link NO_ROWS_TEXT}, so a listing always
 * names all four groups: the no-terminal run's definition of done is
 * that it prints them.
 *
 * A branch row's date is its last commit; a worktree row's is when it
 * was last modified, {@link UNKNOWN_DATE} when that could not be read.
 * Both are the UTC calendar day, `YYYY-MM-DD`, so a line reads the same
 * on every machine and in every test.
 *
 * ## The remote delete a Stale row names
 *
 * Nothing remote is deleted by the command. A Stale row has an upstream
 * that is not gone, so the remote branch is still there, and its line
 * ends naming the command the person may run: {@link remoteDeleteLine},
 * `git push origin --delete <b>`. The remote and the name are read off
 * the upstream (`origin/feature` → `origin`, `feature`) rather than
 * assumed, so a branch tracking another remote, or tracking under
 * another name, names the branch that is really there; for the usual
 * `origin/<b>` upstream that IS `git push origin --delete <b>`. The
 * split is at the first `/`, as git abbreviates an upstream
 * `<remote>/<branch>`; a remote whose own name holds a `/` would be
 * misread, and the line is only ever printed, never run. The branch is
 * shell-quoted as `src/cleanup/steps.ts` quotes its steps.
 *
 * ## The JSON data
 *
 * {@link cleanupData} is the reading as plain JSON: dates as ISO 8601
 * strings (null for a worktree whose modification time was not read),
 * each row's reason and whether it starts ticked, what each group's
 * rows carry beyond that (`mergedBy` and the pull request number,
 * `idleDays` and the remote delete line, the commit count, a
 * worktree's blocker kinds), the counts `cleanupCounts` gives, and the
 * notes. It holds no ticks the person made: with `--output=json` the
 * command asks nothing and removes nothing.
 */
import type {
  BranchRow,
  CleanupCounts,
  CleanupRead,
  MergedBy,
  MergedRow,
  NotPushedRow,
  StaleRow,
  WorktreeBlockKind,
  WorktreeRow,
} from '../cleanup/index.js';

import { cleanupCounts } from '../cleanup/index.js';
import { shellQuote } from '../pr/preflight-items.js';

/** The four group headings, in the order they are listed. */
export const CLEANUP_GROUP_TITLES = Object.freeze({
  merged: 'Merged',
  stale: 'Stale',
  notPushed: 'Not pushed',
  worktrees: 'Worktrees',
});

/** The line an empty group shows under its heading. */
export const NO_ROWS_TEXT = '(none)';

/** The date a worktree row shows when its modification time could not be read. */
export const UNKNOWN_DATE = 'unknown';

/** The remote a Stale row names when its upstream carries no `/`. */
const DEFAULT_REMOTE = 'origin';

/** How far a row line is indented under its group heading. */
const ROW_INDENT = '  ';

/** The gap between a row's columns. */
const COLUMN_GAP = '  ';

/** One branch row as JSON data: what every group's rows carry. */
interface BranchRowFields {
  readonly name: string;
  readonly upstream: string | null;
  /** The tip's committer date, ISO 8601. */
  readonly lastCommit: string;
  readonly reason: string;
  readonly ticked: boolean;
}

/** A Merged row as JSON data. */
export interface MergedRowData extends BranchRowFields {
  readonly mergedBy: readonly MergedBy[];
  /** The merged pull request whose head commit is the tip, or null. */
  readonly pullRequest: number | null;
}

/** A Stale row as JSON data. */
export interface StaleRowData extends BranchRowFields {
  readonly idleDays: number;
  /** The line the person may run to delete the remote branch; see the module note. */
  readonly remoteDelete: string;
}

/** A Not-pushed row as JSON data. */
export interface NotPushedRowData extends BranchRowFields {
  /** The commits deleting it would lose. */
  readonly commits: number;
}

/** A worktree row as JSON data. */
export interface WorktreeRowData {
  readonly path: string;
  readonly branch: string | null;
  /** When it was last modified, ISO 8601, or null when that could not be read. */
  readonly lastModified: string | null;
  readonly reason: string;
  readonly tickable: boolean;
  readonly ticked: boolean;
  readonly branchMerged: boolean;
  /** The kinds of rule that keep it from being ticked, in the order the row names them. */
  readonly blockers: readonly WorktreeBlockKind[];
}

/** The JSON data of the terminal result event; see the module note. */
export interface CleanupData {
  readonly base: string;
  readonly fetched: boolean;
  readonly counts: CleanupCounts;
  readonly merged: readonly MergedRowData[];
  readonly stale: readonly StaleRowData[];
  readonly notPushed: readonly NotPushedRowData[];
  readonly worktrees: readonly WorktreeRowData[];
  readonly notes: readonly string[];
}

/** `date` as the UTC calendar day, `YYYY-MM-DD`. */
export function cleanupDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The line a Stale row names for deleting its remote branch: the remote
 * and the branch read off `upstream`, else `origin` and `branch`.
 */
export function remoteDeleteLine(branch: string, upstream: string | null): string {
  const slash = upstream === null
    ? -1
    : upstream.indexOf('/');
  if (upstream === null || slash <= 0 || slash === upstream.length - 1) {
    return `git push ${DEFAULT_REMOTE} --delete ${shellQuote(branch)}`;
  }
  const remote = upstream.slice(0, slash);
  const name = upstream.slice(slash + 1);
  return `git push ${shellQuote(remote)} --delete ${shellQuote(name)}`;
}

/** A branch row's reason as its line shows it: a Stale row's ends naming the remote delete. */
export function branchRowReason(row: BranchRow): string {
  if (row.group !== 'stale') {
    return row.reason;
  }
  return `${row.reason}; to delete the remote branch: ${remoteDeleteLine(row.branch.name, row.branch.upstream)}`;
}

/** One branch row: its name padded to `width`, its last commit date and its reason. */
export function branchRowLine(row: BranchRow, width = 0): string {
  return columns(row.branch.name, width, cleanupDate(row.branch.lastCommit), branchRowReason(row));
}

/** One worktree row: its path padded to `width`, when it was last modified and its reason. */
export function worktreeRowLine(row: WorktreeRow, width = 0): string {
  const date = row.lastModified === null
    ? UNKNOWN_DATE
    : cleanupDate(row.lastModified);
  return columns(row.path, width, date, row.reason);
}

/** The widest name across all four groups: the column every row's name is padded to. */
export function cleanupNameWidth(read: CleanupRead): number {
  const names = [
    ...[...read.merged, ...read.stale, ...read.notPushed].map((row) => row.branch.name),
    ...read.worktrees.map((row) => row.path),
  ];
  return names.reduce((widest, name) => Math.max(widest, name.length), 0);
}

/** The lines text mode writes for `read`; see the module note. */
export function renderCleanup(read: CleanupRead): readonly string[] {
  const width = cleanupNameWidth(read);
  const branchLines = (rows: readonly BranchRow[]): string[] => rows.map((row) => branchRowLine(row, width));
  return [
    ...read.notes.map((note) => `note: ${note}`),
    ...groupLines(CLEANUP_GROUP_TITLES.merged, branchLines(read.merged)),
    ...groupLines(CLEANUP_GROUP_TITLES.stale, branchLines(read.stale)),
    ...groupLines(CLEANUP_GROUP_TITLES.notPushed, branchLines(read.notPushed)),
    ...groupLines(CLEANUP_GROUP_TITLES.worktrees, read.worktrees.map((row) => worktreeRowLine(row, width))),
  ];
}

/** `read` as the JSON data of the terminal result event; see the module note. */
export function cleanupData(read: CleanupRead): CleanupData {
  return {
    base: read.base,
    fetched: read.fetched,
    counts: cleanupCounts(read),
    merged: read.merged.map(mergedData),
    stale: read.stale.map(staleData),
    notPushed: read.notPushed.map(notPushedData),
    worktrees: read.worktrees.map(worktreeData),
    notes: [...read.notes],
  };
}

/** A group's heading with its row count, then its rows or {@link NO_ROWS_TEXT}. */
function groupLines(title: string, rows: readonly string[]): readonly string[] {
  const body = rows.length === 0
    ? [NO_ROWS_TEXT]
    : rows;
  return [`${title} (${String(rows.length)})`, ...body.map((line) => `${ROW_INDENT}${line}`)];
}

/** The three columns of a row line, the name padded to `width`. */
function columns(name: string, width: number, date: string, reason: string): string {
  return [name.padEnd(width), date, reason].join(COLUMN_GAP);
}

/** What every branch row's data carries. */
function branchFields(row: BranchRow): BranchRowFields {
  return {
    name: row.branch.name,
    upstream: row.branch.upstream,
    lastCommit: row.branch.lastCommit.toISOString(),
    reason: row.reason,
    ticked: row.ticked,
  };
}

function mergedData(row: MergedRow): MergedRowData {
  return {
    ...branchFields(row),
    mergedBy: [...row.mergedBy],
    pullRequest: row.pullRequest?.number ?? null,
  };
}

function staleData(row: StaleRow): StaleRowData {
  return {
    ...branchFields(row),
    idleDays: row.idleDays,
    remoteDelete: remoteDeleteLine(row.branch.name, row.branch.upstream),
  };
}

function notPushedData(row: NotPushedRow): NotPushedRowData {
  return { ...branchFields(row), commits: row.commits };
}

function worktreeData(row: WorktreeRow): WorktreeRowData {
  return {
    path: row.path,
    branch: row.branch,
    lastModified: row.lastModified?.toISOString() ?? null,
    reason: row.reason,
    tickable: row.tickable,
    ticked: row.ticked,
    branchMerged: row.branchMerged,
    blockers: row.blockers.map((blocker) => blocker.kind),
  };
}
