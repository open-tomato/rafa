/**
 * One effort row per commit, parsed from `git log` output.
 *
 * The sibling modules measure what a loop SPENT; this one measures
 * what it PRODUCED, so a report can hold tokens and wall-clock against
 * the commits a plan actually landed. A row carries identifiers and
 * counters only — the subject line, never a commit message body — so
 * the store it feeds cannot become a second copy of the history.
 *
 * The capture is one `git log` invocation and the parse is pure over
 * its text, which is what lets the whole shape below be driven from a
 * planted capture with no repository at all.
 *
 * Output shape, measured against this repo rather than assumed:
 *
 *   - A commit is a MARKER line followed by its `--numstat` lines,
 *     separated from them by one blank line. Blank lines are
 *     structural and are neither counted nor reported.
 *   - A numstat line is `<added>\t<deleted>\t<path>`, and both
 *     counters read `-` for a binary file. Such a file still counts
 *     toward {@link CommitStats.filesChanged} and contributes zero to
 *     the two token counters, so a binary-heavy commit understates its
 *     insertions by design rather than by accident.
 *   - Rename detection is git's own default, under which a rename is
 *     ONE numstat line naming both paths. A caller passing
 *     `--no-renames` would see the same commit as two files.
 *   - A MERGE commit prints no diff at all, so it parses to zero files
 *     and zero lines. That is git's behaviour and not a fault:
 *     {@link CommitStats.parentCount} is what separates it from an
 *     empty commit, and it is the only reason that field is on the
 *     row. `-m` is deliberately NOT passed — it prints the commit once
 *     PER PARENT, so a parser folding those records would count one
 *     merge twice and inflate every total downstream of it.
 *
 * The header is TAB-separated with the SUBJECT LAST, and that order is
 * load-bearing: a subject is free to contain a tab, so the fixed
 * fields are taken by index and everything after them is rejoined.
 * Splitting a header on tabs and expecting a fixed arity would drop
 * exactly the commits whose message someone pasted into.
 *
 * `branch` is `%S` under `--source`, which is the ref the WALK reached
 * the commit from and not a property of the commit. It answers the ref
 * EXACTLY AS SPELLED on the command line, and the consequence bites
 * the reflexive spelling: measured here, a walk over `main..HEAD`
 * answers `HEAD` for every commit — normalised to null, because HEAD
 * names no branch — where the same range spelled
 * `main..feat/q19-loop-economics` answers the branch, and `--all`
 * answers the fully qualified `refs/heads/...` form. A caller that
 * wants the branch field populated has to NAME the branch. With
 * several refs named at once a commit both reach is attributed to
 * whichever the walk got to it from first, which is a property of the
 * walk rather than of the commit.
 *
 * The timestamp is the AUTHOR date rather than the commit date. A
 * rebase rewrites commit dates to the moment of the rebase, which
 * would collapse every gap in a rebased range to seconds; author dates
 * survive it and are when the work was actually done.
 *
 * Elapsed minutes are computed against the preceding commit in TIME
 * order while the rows stay in the order the log emitted them. Two
 * consequences worth stating: the oldest commit in the range answers
 * null because the range has no predecessor for it, and every gap is a
 * property of the RANGE rather than of the repository — an
 * incremental run bounded by `--since` measures its own first commit
 * against nothing.
 *
 * A parse carries its own arithmetic cross-check, exactly as the
 * session reader does:
 * `rows.length + sum(filesChanged) + unparsedLineCount === lineCount`
 * over non-blank lines. A numstat line arriving before any header has
 * no commit to attribute to and is counted as unparsed, which is what
 * keeps that identity exact instead of approximately true.
 */
import { execFileSync } from 'node:child_process';

/**
 * Line prefix marking a commit header inside the log capture.
 *
 * It has to be a string a `--numstat` line can never begin with — one
 * of those starts with a digit or with `-` — and it must survive being
 * read back from a file, so it carries no control byte of its own.
 */
export const COMMIT_RECORD_MARKER = '@@ralph-commit@@';

/**
 * The header's fields, in order, subject LAST.
 *
 * Spelled once: {@link COMMIT_LOG_FORMAT} builds git's format string
 * from this list and the parser takes its arity from the same one, so
 * a field added here cannot leave the two halves disagreeing about
 * where the subject starts.
 */
const HEADER_PLACEHOLDERS = ['%H', '%aI', '%P', '%an', '%S', '%s'] as const;

/** Field separator, as git emits it and as the parser splits on it. */
const FIELD_SEPARATOR = '\t';

/** `--format=` argument matching {@link HEADER_PLACEHOLDERS}. */
export const COMMIT_LOG_FORMAT = [
  COMMIT_RECORD_MARKER,
  ...HEADER_PLACEHOLDERS,
].join('%x09');

/** Milliseconds in a minute, so the conversion is not a bare literal. */
const MS_PER_MINUTE = 60_000;

/**
 * Decimal places kept on an elapsed-minute gap.
 *
 * A store row is JSON, so an unrounded quotient makes a row's bytes
 * depend on how a runtime formats a repeating float. Three places is a
 * tenth of a second — finer than anything a cost report reads, and
 * stable across the two runtimes this repo runs under.
 */
const ELAPSED_DECIMALS = 3;

/** One row per commit. */
export interface CommitStats {
  /** Full 40-character sha, and the store's key projection. */
  sha: string;
  /** Author date, ISO 8601 with offset, as `%aI` emits it. */
  timestamp: string;
  /** Subject line only. No commit message body reaches the row. */
  subject: string;
  /** Author name, as `%an` emits it. */
  author: string;
  /** Ref the walk reached this commit from, or null for `HEAD`. */
  branch: string | null;
  /** Numstat lines attributed to the commit, binary files included. */
  filesChanged: number;
  /** Summed added lines; a binary file contributes zero. */
  insertions: number;
  /** Summed removed lines; a binary file contributes zero. */
  deletions: number;
  /** Parents. Two or more is a merge, which prints no diff. */
  parentCount: number;
  /** Minutes since the preceding commit in time order, or null. */
  minutesSincePrevious: number | null;
}

/** What one parse of a log capture found. */
export interface CommitLogParseResult {
  /** One row per commit, in the order the log emitted them. */
  rows: CommitStats[];
  /** Non-blank lines read. Blank lines are structural and skipped. */
  lineCount: number;
  /** Non-blank lines that were neither a header nor a stat line. */
  unparsedLineCount: number;
}

/** How a capture is taken. */
export interface CommitLogOptions {
  /** Directory to run git in. Defaults to the current one. */
  cwd?: string;
  /** A `--since` argument, which is what makes a run incremental. */
  since?: string;
  /** A revision range such as `main..HEAD`. Also names the branch. */
  revisionRange?: string;
  /** A `--max-count` bound, for a probe that wants a few rows. */
  maxCount?: number;
}

/** Strips the `refs/heads/` prefix; `HEAD` names no branch at all. */
function normaliseBranch(source: string): string | null {
  if (source.length === 0 || source === 'HEAD') return null;

  return source.startsWith('refs/heads/')
    ? source.slice('refs/heads/'.length)
    : source;
}

/** A numstat counter, or null for the `-` a binary file carries. */
function parseStatCount(field: string): number | null {
  return /^\d+$/.test(field)
    ? Number(field)
    : null;
}

/**
 * Reads a header line into a row with its counters zeroed, or answers
 * null when the line is not a header.
 *
 * The fixed fields are taken by index and every remaining field is
 * rejoined into the subject, so a tab inside a commit subject widens
 * that last field instead of shifting the whole record. The stat lines
 * that follow are folded onto the row this returns, which is why there
 * is no separate accumulator type: a row under construction differs
 * from a finished one only by counters that start at zero.
 */
export function parseCommitHeader(line: string): CommitStats | null {
  const parts = line.split(FIELD_SEPARATOR);
  if (parts[0] !== COMMIT_RECORD_MARKER) return null;
  if (parts.length <= HEADER_PLACEHOLDERS.length) return null;

  const [sha, timestamp, parents, author, source] = parts.slice(1);
  if (sha === undefined || sha.length === 0) return null;

  return {
    sha,
    timestamp: timestamp ?? '',
    subject: parts.slice(HEADER_PLACEHOLDERS.length).join(FIELD_SEPARATOR),
    author: author ?? '',
    branch: normaliseBranch(source ?? ''),
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    parentCount: countParents(parents ?? ''),
    minutesSincePrevious: null,
  };
}

/** Parents come as a space-separated sha list, empty at the root. */
function countParents(parents: string): number {
  return parents.trim().length === 0
    ? 0
    : parents.trim().split(/ +/).length;
}

/**
 * Folds one `--numstat` line into the commit it belongs to.
 *
 * Answers false for a line that is not one, which is what lets the
 * caller count it as unparsed rather than silently attributing an
 * unrecognised line to whatever commit was open.
 */
function applyStatLine(row: CommitStats, line: string): boolean {
  const parts = line.split(FIELD_SEPARATOR);
  if (parts.length < 3) return false;

  const added = parts[0] ?? '';
  const removed = parts[1] ?? '';
  const isBinary = added === '-' && removed === '-';
  const addedCount = parseStatCount(added);
  const removedCount = parseStatCount(removed);
  if (!isBinary && (addedCount === null || removedCount === null)) {
    return false;
  }

  row.filesChanged += 1;
  row.insertions += addedCount ?? 0;
  row.deletions += removedCount ?? 0;
  return true;
}

/**
 * Minutes between two ISO timestamps, or null when either fails to
 * parse. Rounded to {@link ELAPSED_DECIMALS}; never negative, because
 * the caller orders the pair before asking.
 */
export function minutesBetween(
  earlier: string,
  later: string,
): number | null {
  const from = Date.parse(earlier);
  const to = Date.parse(later);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;

  const minutes = (to - from) / MS_PER_MINUTE;
  return Number(minutes.toFixed(ELAPSED_DECIMALS));
}

/**
 * Fills each row's gap against its predecessor in TIME order.
 *
 * The rows are left in log order and only the field is written, so a
 * caller reading `rows[0]` still gets whatever the log emitted first.
 * A row whose timestamp does not parse takes null and is left out of
 * the ordering entirely rather than being sorted to one end, where it
 * would hand a neighbouring row a gap measured against nothing.
 */
function assignElapsedMinutes(rows: CommitStats[]): void {
  const ordered = rows
    .map((row, index) => ({ index, epoch: Date.parse(row.timestamp) }))
    .filter((entry) => !Number.isNaN(entry.epoch))
    .sort((a, b) => a.epoch - b.epoch);

  for (let position = 1; position < ordered.length; position += 1) {
    const entry = ordered[position];
    const previous = ordered[position - 1];
    if (entry === undefined || previous === undefined) continue;

    const row = rows[entry.index];
    const earlier = rows[previous.index];
    if (row === undefined || earlier === undefined) continue;

    row.minutesSincePrevious = minutesBetween(
      earlier.timestamp,
      row.timestamp,
    );
  }
}

/**
 * Parses a `git log` capture into one row per commit.
 *
 * Pure over its text, which is the seam the whole suite drives: a
 * planted capture exercises merges, binary files, empty commits and a
 * truncated tail with no repository to construct them in.
 */
export function parseCommitLog(text: string): CommitLogParseResult {
  const rows: CommitStats[] = [];
  let lineCount = 0;
  let unparsedLineCount = 0;
  let open: CommitStats | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.trim().length === 0) continue;
    lineCount += 1;

    const header = parseCommitHeader(line);
    if (header !== null) {
      rows.push(header);
      open = header;
      continue;
    }
    if (open === null || !applyStatLine(open, line)) {
      unparsedLineCount += 1;
    }
  }

  assignElapsedMinutes(rows);
  return { rows, lineCount, unparsedLineCount };
}

/**
 * The argv a capture is taken with.
 *
 * Exported so a caller can see — and a test can assert — exactly what
 * was run, rather than inferring it from output that looks right.
 * `--source` is what populates `%S`; without it every commit answers
 * `HEAD` and the branch field silently becomes null for the whole run.
 */
export function commitLogArgs(options: CommitLogOptions = {}): string[] {
  const args = [
    'log',
    '--source',
    `--format=${COMMIT_LOG_FORMAT}`,
    '--numstat',
  ];
  if (options.since !== undefined) args.push(`--since=${options.since}`);
  if (options.maxCount !== undefined) {
    args.push(`--max-count=${options.maxCount}`);
  }
  if (options.revisionRange !== undefined) args.push(options.revisionRange);
  return args;
}

/**
 * Runs git and parses what it printed.
 *
 * A git that FAILED throws rather than reading as an empty history:
 * an empty parse is indistinguishable from a range with no commits,
 * and a collector told the latter would record a plan as having
 * produced nothing. The buffer is raised because a numstat capture
 * over a long range is several megabytes of stat lines.
 */
export function readCommitLog(
  options: CommitLogOptions = {},
): CommitLogParseResult {
  const stdout = execFileSync('git', commitLogArgs(options), {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return parseCommitLog(stdout);
}
