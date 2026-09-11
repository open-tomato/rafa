/**
 * Append-only newline-delimited JSON store for the effort collector.
 *
 * One file per row kind under `.ralph/effort/`, one JSON object per
 * line, and nothing is ever rewritten or removed. A collector run can
 * only ADD, so the store's whole incrementality is a set of the keys
 * it already holds — read back from the ROWS, never from a sidecar
 * index, which would be a second authority free to disagree with the
 * rows it indexes.
 *
 * NDJSON rather than the SQLite the reference implementation uses, and
 * the reason is the test surface rather than taste. The root suite runs
 * under vitest on NODE, where bun's built-in SQLite module does not
 * resolve at all — measured from a throwaway test under `tools/`, it
 * answers `Cannot find package 'bun:sqlite'` with `globalThis.Bun`
 * undefined. A SQLite store would put this whole layer outside every
 * test this repo can run. NDJSON reads and writes identically under
 * both runtimes, adds no dependency, and gives back the one property
 * of the reference store the collector actually depends on.
 *
 * Three consequences of append-only, all deliberate.
 *
 *   - A run killed mid-write leaves a PARTIAL last line. It is counted
 *     as unparsed and left exactly where it is: the row it half-held
 *     carries no key, so the next run collects that session again and
 *     appends a whole row for it. The repair needs no rewrite, which
 *     is the point — a store that repaired itself by rewriting would
 *     be a store that can lose rows.
 *   - An append onto a file not ending in a newline writes one first,
 *     so a whole row can never be glued onto a partial one. That is
 *     reported rather than silent; see {@link AppendResult}.
 *   - Duplicate suppression covers the BATCH as well as the disk. The
 *     on-disk set is read once, before any write, so two identical
 *     rows in one call would both pass a set that never learned about
 *     the first. Keys are folded in as they are written.
 *
 * A row with no key is REFUSED, and the whole batch is validated
 * before a byte is written. Such a row cannot participate in
 * incrementality at all, so appending it would duplicate it on every
 * future run — silently, and forever. Validating up front is what
 * keeps that refusal from leaving a half-written append behind.
 *
 * The read is a whole-file one, deliberately, where `session-log.ts`
 * beside it has to stream. The asymmetry is the row count: that module
 * reads one line per RECORD across roughly a gigabyte of logs, while
 * this one holds one row per SESSION — a few hundred rows, well under
 * a megabyte.
 *
 * A row's own arithmetic is carried the same way the session reader
 * carries it: `rows.length + unparsedLineCount === lineCount`. A line
 * that is valid JSON but not a plain object counts as unparsed rather
 * than becoming a row, so a scalar or an array on a line cannot reach
 * a caller typed for objects.
 *
 * Nothing under {@link EFFORT_STORE_DIR} is ever committed. The root
 * `.gitignore` is what enforces that; this module's half of the
 * bargain is that the directory is spelled ONCE, so the ignore entry
 * and the writer cannot drift to two different paths. The rows are a
 * measurement of one machine's runs, regenerable from the logs at any
 * time, and two checkouts would not produce the same ones.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The store directory, relative to the repo root.
 *
 * Spelled once on purpose — see the module note. `join` rather than a
 * literal so the separator is the platform's, which keeps a path built
 * here comparable to one a caller built with `join` of its own.
 */
export const EFFORT_STORE_DIR = join('.ralph', 'effort');

/** The row kinds the collector writes, one store file each. */
export type EffortRowKind = 'sessions' | 'commits';

/**
 * File name per row kind.
 *
 * A record rather than a template so the set is closed: a kind added
 * to the union without a name here is a compile error, where
 * `${kind}.ndjson` would silently accept anything.
 */
const STORE_FILE_NAMES: Readonly<Record<EffortRowKind, string>> = {
  sessions: 'sessions.ndjson',
  commits: 'commits.ndjson',
};

/** What one read of a store file found. */
export interface StoreReadResult<T> {
  /** Every plain-object line, in the order it was appended. */
  rows: T[];
  /** Lines the file held, excluding the trailing newline's empty tail. */
  lineCount: number;
  /** Lines that produced no row: blank, malformed, or not an object. */
  unparsedLineCount: number;
}

/** What one append did. */
export interface AppendResult {
  /** The file written, whether or not anything was written to it. */
  path: string;
  /** Rows appended. Zero writes nothing and creates no file. */
  appended: number;
  /** Rows whose key was already held, on disk or earlier in the batch. */
  skipped: number;
  /**
   * True when the file did not end in a newline and this append wrote
   * one before its first row. The partial line is left in place and
   * reads as unparsed forever, which is what makes the row it half
   * held get collected again.
   */
  separatedPartialLine: boolean;
}

/** A store bound to one file and one key projection. */
export interface EffortStore<T> {
  /** The file this store reads and appends to. */
  readonly path: string;
  /** Every row currently on disk, with the line arithmetic. */
  readRows: () => StoreReadResult<T>;
  /** The keys already held — what a collector skips. */
  collectedKeys: () => Set<string>;
  /** Appends the rows this store does not already hold. */
  append: (rows: readonly T[]) => AppendResult;
}

/** Narrows to a plain JSON object; arrays and scalars answer null. */
function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A non-empty string, or null — an empty key is no key. */
function normaliseKey(key: string | null | undefined): string | null {
  return typeof key === 'string' && key.length > 0
    ? key
    : null;
}

/** Resolves one store file under a repo root. */
export function effortStorePath(
  repoRoot: string,
  kind: EffortRowKind,
): string {
  return join(repoRoot, EFFORT_STORE_DIR, STORE_FILE_NAMES[kind]);
}

/**
 * Reads a store file's text, or null when there is none.
 *
 * A missing file is the FIRST-RUN case and answers null rather than
 * throwing — an empty store and no store are the same thing to every
 * caller here. Only absence is absorbed: a permission or IO failure
 * still throws, so a store nobody can read cannot pass for an empty
 * one and make a collector re-append everything it already holds.
 */
function readStoreText(path: string): string | null {
  return existsSync(path)
    ? readFileSync(path, 'utf8')
    : null;
}

/**
 * Parses store text into rows.
 *
 * The trailing empty element a final newline produces is dropped —
 * exactly one, so a genuinely blank last line is still counted.
 * Everything else that yields no row is counted as unparsed, which is
 * what keeps `rows + unparsed === lineCount` exact and makes a
 * truncated final line visible instead of silent.
 *
 * Splitting on `/\r?\n/` rather than the bare newline is currently
 * UNOBSERVABLE and kept anyway. Measured: the bare split leaves a
 * carriage return on the end of every line and every case still
 * passes, because `JSON.parse` tolerates trailing whitespace and a
 * lone `\r` trims to empty. That equivalence is two downstream
 * tolerances rather than a property of this function, and the next
 * check added here — a length test, a prefix test — would silently
 * depend on neither having changed. Taking the carriage return off at
 * the split is what keeps that from mattering.
 *
 * The `T` is the caller's assertion. The only structural check made
 * here is that the line parsed to a plain object.
 */
export function parseStoreText<T>(text: string | null): StoreReadResult<T> {
  const rows: T[] = [];
  if (text === null || text.length === 0) {
    return { rows, lineCount: 0, unparsedLineCount: 0 };
  }

  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();

  let unparsedLineCount = 0;
  for (const line of lines) {
    const record = parseRow(line);
    if (record === null) {
      unparsedLineCount += 1;
      continue;
    }
    rows.push(record as T);
  }
  return { rows, lineCount: lines.length, unparsedLineCount };
}

/** One line to a plain object, or null for the ways that can fail. */
function parseRow(line: string): Record<string, unknown> | null {
  if (line.trim().length === 0) return null;

  try {
    return asObject(JSON.parse(line));
  } catch {
    return null;
  }
}

/** Reads every row a store file holds, with its line arithmetic. */
export function readStoreRows<T>(path: string): StoreReadResult<T> {
  return parseStoreText<T>(readStoreText(path));
}

/**
 * Projects rows onto their keys.
 *
 * A row whose key is absent or empty contributes nothing rather than
 * seeding the set with a placeholder every other keyless row would
 * then collide with. {@link appendRows} refuses to write one in the
 * first place; this tolerates the ones a hand-edited store might hold.
 */
export function keysOfRows<T>(
  rows: readonly T[],
  keyOf: (row: T) => string | null | undefined,
): Set<string> {
  const keys = new Set<string>();

  for (const row of rows) {
    const key = normaliseKey(keyOf(row));
    if (key !== null) keys.add(key);
  }
  return keys;
}

/** The keys a store file already holds — what a collector skips. */
export function collectedKeys<T>(
  path: string,
  keyOf: (row: T) => string | null | undefined,
): Set<string> {
  return keysOfRows(readStoreRows<T>(path).rows, keyOf);
}

/**
 * Appends the rows a store file does not already hold.
 *
 * The batch is key-validated before anything is opened, so a keyless
 * row leaves the file untouched rather than half-appended. Rows are
 * serialised one per line: `JSON.stringify` escapes a newline inside
 * a string value, so no row content can ever split a line in two.
 *
 * Writing nothing writes NOTHING — no file, no directory, no trailing
 * newline. An empty first collect leaves no trace, which is the only
 * answer consistent with a store whose absence means "empty".
 */
export function appendRows<T>(
  path: string,
  rows: readonly T[],
  keyOf: (row: T) => string | null | undefined,
): AppendResult {
  const keys = rows.map((row) => normaliseKey(keyOf(row)));
  const keylessAt = keys.indexOf(null);
  if (keylessAt !== -1) {
    const at = `row ${keylessAt} of ${rows.length}`;
    throw new Error(`effort store: ${at} carries no key; batch refused`);
  }

  const text = readStoreText(path);
  const held = keysOfRows(parseStoreText<T>(text).rows, keyOf);
  const lines: string[] = [];
  let skipped = 0;

  for (const [index, row] of rows.entries()) {
    const key = keys[index] ?? null;
    if (key === null || held.has(key)) {
      skipped += 1;
      continue;
    }
    held.add(key);
    lines.push(JSON.stringify(row));
  }
  if (lines.length === 0) {
    return { path, appended: 0, skipped, separatedPartialLine: false };
  }

  const separatedPartialLine = text !== null
    && text.length > 0
    && !text.endsWith('\n');
  const lead = separatedPartialLine
    ? '\n'
    : '';

  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${lead}${lines.join('\n')}\n`, 'utf8');
  return {
    path,
    appended: lines.length,
    skipped,
    separatedPartialLine,
  };
}

/**
 * Binds a store file to the key projection it is deduplicated by.
 *
 * The binding is the point rather than the ergonomics. Incrementality
 * fails silently when the set a collector SKIPS by and the set an
 * append DEDUPES by are built from two different projections of a
 * row — the collector re-reads work it already holds, or the store
 * grows a duplicate per run, and both look like a store that is
 * simply working. One `keyOf` per store makes that unrepresentable.
 */
export function openEffortStore<T>(
  path: string,
  keyOf: (row: T) => string | null | undefined,
): EffortStore<T> {
  return {
    path,
    readRows: () => readStoreRows<T>(path),
    collectedKeys: () => collectedKeys<T>(path, keyOf),
    append: (rows: readonly T[]) => appendRows<T>(path, rows, keyOf),
  };
}
