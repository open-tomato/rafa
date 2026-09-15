/**
 * Rendering `progress.txt` from the stored findings.
 *
 * `progress.txt` used to be AUTHORED. Every task session was told to read
 * it in full and to append what it learned, and a between-task cadence
 * decided when a compaction session should shrink it again. Findings now
 * arrive as rows instead: a task session ends its output with a
 * `rafa:report` block, and `effort/store/findings.ts` writes one row per
 * entry of its findings list. So the file is DERIVED. The loop renders it
 * from those rows before a dispatch, each render replacing the whole file,
 * and nothing is compacted because nothing accumulates. A render over a
 * file a session wrote by hand replaces what was written there.
 *
 * ## What a render holds
 *
 *   - Findings reported under the plan's stub, and global ones. A global
 *     finding is a row whose `plan_stub` is null, the only scope the
 *     findings table records. A dispatch with no stub therefore renders
 *     the global findings alone: SQL's `plan_stub = NULL` is never true.
 *   - Every row of the table, whichever writer wrote it. Beside the
 *     report's findings, `effort/store/tracker-refs.ts` inserts a row
 *     holding an artifact and a filed issue's reference and no report
 *     field, where the session reported no finding under that artifact,
 *     and a render holds it as the bullet `- artifact: <artifact>`.
 *   - Most recent first, by `seq` descending, the store's append order.
 *     `collected_at` cannot order them: one write stamps every row it
 *     holds with the same time, and a clock stepped back would reorder
 *     writes.
 *   - At most {@link PROGRESS_CAP_BYTES} UTF-8 bytes, in whole entries.
 *     Entries are taken in order while the next one fits, and the first
 *     that does not ends the render, so the file never holds an entry
 *     older than one it left out. An entry larger than the whole cap is
 *     the exception: it could never fit, and ending the render at it would
 *     hide every older finding for as long as it is stored, so it is
 *     skipped and counted as oversized.
 *
 * ## Why 16,000 bytes
 *
 * It is the sibling loop's cap, and `plan.ts` truncates the findings it
 * injects into plan generation at 16,000 characters by keeping the TAIL.
 * In an appended file the tail was the newest finding; in a rendered one
 * it is the oldest. A render never reaches that truncation, because a
 * string's UTF-8 byte count is never below its UTF-16 length: a file
 * within 16,000 bytes is within 16,000 characters. The colocated suite
 * holds the two together by passing a cap-filling render through
 * `formatProgressSection`.
 *
 * ## The text
 *
 * One markdown bullet per finding, headed by `what`, with every other
 * field the row carries listed under it as `key: value`, in the report's
 * key order and under the report's key names. A null field is left out;
 * with no `what`, the first listed field opens the bullet. A value
 * spanning several lines continues on lines indented past its field, with
 * the line feeds ending it dropped.
 *
 * Characters the control-byte gate (`scripts/control-byte-gate/`) refuses
 * in a tracked file are written as six-character escapes: a backslash,
 * `u` and four hex digits. That is every C0 control but TAB and the line
 * feed that splits a value, DEL, the bidirectional and invisible code
 * points, and both emoji joiners wherever they stand, with the carriage
 * return added so that one line stays one line. An artifact is quoted
 * from output, which carries ANSI escapes readily, and this repo's
 * `progress.txt` is tracked despite `.gitignore`. Measured, the gate
 * refuses a staged `progress.txt` holding one ESC with exit 1, and the
 * pre-commit hook runs that gate. The escape is a view: the store keeps
 * the bytes the report gave.
 *
 * ## Failures
 *
 * No store file renders an empty file and creates no store: nothing has
 * been reported yet. A store that exists and cannot be read throws, a
 * directory at its path or a schema newer than this code, and it throws
 * before `progress.txt` is written, so the last render stays in place
 * rather than being blanked as if the store were empty. A store an older
 * schema wrote is brought forward first, as every call into it is.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { sqliteStorePath, withSqliteStore } from '../effort/store/sqlite.js';

/** The rendered findings file, at the top of a repo root. */
export const PROGRESS_FILE_NAME = 'progress.txt';

/** The most one render writes, in UTF-8 bytes, line feeds included. */
export const PROGRESS_CAP_BYTES = 16_000;

/** One stored finding, as a render reads it. */
export interface ProgressFinding {
  /** The store's append order: a higher `seq` was written later. */
  readonly seq: number;
  /** The plan it was reported under, or null for a global finding. */
  readonly planStub: string | null;
  readonly kind: string | null;
  readonly trigger: string | null;
  readonly what: string | null;
  readonly cause: string | null;
  readonly resolution: string | null;
  readonly artifact: string | null;
  readonly signal: string | null;
}

/** What one render made of a list of findings. */
export interface ProgressText {
  /** The file's content: every rendered entry, each ending in a line feed. */
  readonly text: string;
  /** `text` in UTF-8 bytes, never above the cap. */
  readonly bytes: number;
  /** Findings rendered. */
  readonly rendered: number;
  /** Findings skipped because their entry alone is larger than the cap. */
  readonly oversized: number;
  /**
   * Findings left out once an entry did not fit. With the other two,
   * `rendered + oversized + omitted` is the length of the list.
   */
  readonly omitted: number;
}

/** What one write did. */
export interface ProgressWrite extends ProgressText {
  /** The `progress.txt` written. */
  readonly path: string;
  /** The store read, whether or not it exists. */
  readonly storePath: string;
}

/** A findings row, as the render's query selects it. */
interface FindingRow {
  readonly seq: number;
  readonly plan_stub: string | null;
  readonly kind: string | null;
  readonly trigger: string | null;
  readonly what: string | null;
  readonly cause: string | null;
  readonly resolution: string | null;
  readonly artifact: string | null;
  readonly signal: string | null;
}

/** The fields listed under an entry's head, in the report's key order. */
const LISTED_FIELDS = [
  'trigger',
  'kind',
  'cause',
  'resolution',
  'artifact',
  'signal',
] as const;

/**
 * The findings a render may hold, most recent first. A null stub binds a
 * null, which `plan_stub = ?` never equals, leaving the global findings.
 */
const SELECT_FINDINGS = `
  SELECT seq, plan_stub, kind, trigger, what, cause, resolution, artifact, signal
  FROM findings
  WHERE plan_stub IS NULL OR plan_stub = ?
  ORDER BY seq DESC
`;

/** A backslash and a `u`, built from code points. */
const BACKSLASH_U = `${String.fromCharCode(0x5c)}u`;

/**
 * The code points a render escapes: the control-byte gate's refusals, with
 * the carriage return added and both emoji joiners taken wherever they
 * stand. TAB and the line feed pass. Spelled as numbers, because an escape
 * written through an agent's tool call can reach the file as the character
 * itself. The colocated suite holds this set to the gate's own, so a code
 * point the gate starts refusing reddens there.
 */
const ESCAPED_CODE_POINTS: ReadonlySet<number> = new Set([
  ...Array.from({ length: 0x20 }, (_, code) => code)
    .filter((code) => code !== 0x09 && code !== 0x0a),
  0x7f,
  0x00ad, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0xfeff,
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2066, 0x2067, 0x2068, 0x2069,
  0x2028, 0x2029,
]);

/** Where `progress.txt` lives under a repo root. */
export function progressFilePath(repoRoot: string): string {
  return join(repoRoot, PROGRESS_FILE_NAME);
}

/** A value with every code point in {@link ESCAPED_CODE_POINTS} escaped. */
function escapeValue(value: string): string {
  let escaped = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    escaped += ESCAPED_CODE_POINTS.has(code)
      ? `${BACKSLASH_U}${code.toString(16).padStart(4, '0')}`
      : char;
  }
  return escaped;
}

/** A value's lines, escaped, without the line feeds ending it. */
function valueLines(value: string): string[] {
  return escapeValue(value.replace(/\n+$/, '')).split('\n');
}

/** A value's later line, indented past its field. A blank one stays bare. */
function continuation(line: string): string {
  return line.length === 0
    ? ''
    : `    ${line}`;
}

/** A field's lines under the head, or none for a null field. */
function fieldLines(key: string, value: string | null): string[] {
  if (value === null) return [];
  const [first = '', ...rest] = valueLines(value);
  return [`  ${key}: ${first}`, ...rest.map(continuation)];
}

/**
 * One finding's entry, without the line feed that ends it. The module note
 * gives the layout and the escape rule.
 */
export function formatFinding(finding: ProgressFinding): string {
  const listed = LISTED_FIELDS.flatMap((key) => fieldLines(key, finding[key]));
  if (finding.what === null) {
    const [opening = '', ...rest] = listed;
    return [`- ${opening.trimStart()}`, ...rest].join('\n');
  }

  const [head = '', ...rest] = valueLines(finding.what);
  return [`- ${head}`, ...rest.map(continuation), ...listed].join('\n');
}

/**
 * Renders findings, given most recent first, into the text of
 * `progress.txt`: whole entries while the next one fits `capBytes`,
 * skipping any entry larger than the cap on its own.
 *
 * Pure. Throws a `RangeError` for a cap that is not a non-negative safe
 * integer, which only code can supply.
 */
export function renderProgressText(
  findings: readonly ProgressFinding[],
  capBytes = PROGRESS_CAP_BYTES,
): ProgressText {
  if (!Number.isSafeInteger(capBytes) || capBytes < 0) {
    throw new RangeError(`progress: a cap of ${capBytes} bytes is not a non-negative integer`);
  }

  const entries: string[] = [];
  let bytes = 0;
  let oversized = 0;
  let full = false;
  for (const finding of findings) {
    const entry = `${formatFinding(finding)}\n`;
    const size = Buffer.byteLength(entry, 'utf8');
    if (size > capBytes) {
      oversized += 1;
    } else if (!full && bytes + size <= capBytes) {
      entries.push(entry);
      bytes += size;
    } else {
      full = true;
    }
  }

  const rendered = entries.length;
  const omitted = findings.length - rendered - oversized;
  return { text: entries.join(''), bytes, rendered, oversized, omitted };
}

/**
 * The stored findings a render for this plan may hold, most recent first.
 *
 * Answers none, opening and creating nothing, when the store file does not
 * exist. Throws when it exists and cannot be read. The findings table sits
 * in the SQLite store's file whichever backend `store` selects.
 */
export function readProgressFindings(
  repoRoot: string,
  planStub: string | null,
): ProgressFinding[] {
  const path = sqliteStorePath(repoRoot);
  if (!existsSync(path)) return [];

  const rows = withSqliteStore(path, false, (db) => {
    const query = db.query<FindingRow, [string | null]>(SELECT_FINDINGS);
    return query.all(planStub);
  });
  return rows.map((row) => ({
    seq: row.seq,
    planStub: row.plan_stub,
    kind: row.kind,
    trigger: row.trigger,
    what: row.what,
    cause: row.cause,
    resolution: row.resolution,
    artifact: row.artifact,
    signal: row.signal,
  }));
}

/**
 * Renders `progress.txt` for a dispatch of this plan, and answers the
 * render.
 *
 * The store is read before the file is written, so a store that cannot be
 * read throws with the file as it was. Otherwise the file is replaced
 * whole, and is empty for a plan nothing has been reported under.
 */
export function writeProgress(
  repoRoot: string,
  planStub: string | null,
): ProgressWrite {
  const render = renderProgressText(readProgressFindings(repoRoot, planStub));
  const path = progressFilePath(repoRoot);
  writeFileSync(path, render.text, 'utf8');
  return { ...render, path, storePath: sqliteStorePath(repoRoot) };
}
