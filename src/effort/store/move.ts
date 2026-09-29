/**
 * `moveToSqlite`: a `store: ndjson` project's sessions and commits
 * appended to its SQLite store, the counts checked, and then
 * `store: sqlite` set in the project's `.rafa/config.yaml`. It is what
 * `rafa effort move --to=sqlite` (`src/commands/effort/move.ts`) runs,
 * and the step `rafa effort merge` names for a `store: ndjson` project
 * (`MOVE_TO_SQLITE` in `merge-store.ts`), since only SQLite stores merge.
 *
 * ## Through the port, and nothing else
 *
 * The rows are read with the NDJSON backend's `readRows` and appended
 * with the SQLite backend's `append`, the two openers `selectEffortStore`
 * chooses between. So the move writes a row exactly as `rafa effort
 * collect` would have under `store: sqlite`: the same key projection
 * dedupes it (`EFFORT_KEY_PROJECTIONS`), the same open brings the store
 * forward, and a development build over a store it does not own is
 * refused by that open (`refuseUnownedDevelopmentWrite`) before a row is
 * written. Both backends resolve their files under `effortStoreDir`, so
 * `RAFA_EFFORT_DIR` moves both sides together.
 *
 * Appending is keyed, so a move run again adds nothing: every row it
 * reads is already held and counted as skipped, and the config, already
 * `store: sqlite`, is left byte for byte. That is also how rows an older
 * loop appended to the NDJSON files after a move reach the SQLite store:
 * a loop resolves its config when it starts, so one started before the
 * move keeps writing NDJSON until it ends, and running the move again
 * afterwards brings those rows in.
 *
 * The NDJSON files are left where they are. A line that does not parse,
 * and a row that carries no key, are counted and not moved: the port
 * refuses a keyless row, and it could never be deduplicated anyway.
 *
 * ## The order, and what each step refuses
 *
 *   1. The config text that would be written is built and parsed back
 *      first, so a config this move cannot edit refuses before any row
 *      is moved ({@link MoveRefusal} `config`).
 *   2. Each kind is read, appended, and checked: the SQLite store's
 *      keys afterwards hold every key read, and number the keys it held
 *      before plus the rows appended. A failed check refuses
 *      (`count`), and the config is not written, so the project keeps
 *      reading the NDJSON files it was reading.
 *   3. The config is written, unless the project file already reads
 *      `store: sqlite`. A write that fails refuses (`config`), naming
 *      the rows as moved, since a second move adds nothing.
 *
 * ## The config edit
 *
 * {@link withSqliteStoreSetting} edits the text rather than
 * re-serialising it, so every comment `rafa init` wrote stays, the rule
 * `src/release/setting.ts` spells out for `release.enabled`. An
 * uncommented top-level `store:` line is replaced, the commented one
 * `rafa init` writes is uncommented as `store: sqlite`, and a file
 * naming no `store` gains the line at its end. A file naming `store`
 * any other way is refused, not appended to: `Bun.YAML.parse` answers
 * the last of two duplicate keys, so an appended line would read back
 * right with the key in the file twice. Whatever comes back is parsed
 * through `parseConfigText`, the reader `loadConfig` uses, and written
 * only when it reads `store: sqlite`.
 */
import type { NdjsonEffortStore } from './ndjson.js';
import type { SqliteEffortStore } from './sqlite.js';
import type { EffortRow, EffortRowKind } from './types.js';

import { readFileSync, writeFileSync } from 'node:fs';

import { isMapping, messageOf } from '../../config-sections.js';
import { configFilePath, parseConfigText } from '../../config.js';

import { openNdjsonStore } from './ndjson.js';
import { openSqliteStore } from './sqlite.js';
import { EFFORT_KEY_PROJECTIONS } from './types.js';

/** The kinds a move carries, in the order it carries them. */
export const MOVED_KINDS: readonly EffortRowKind[] = Object.freeze(['sessions', 'commits']);

/** The one backend a move writes to. */
export const MOVE_TARGET = 'sqlite';

/** The line the edit writes. */
const STORE_LINE = `store: ${MOVE_TARGET}`;

/** An uncommented top-level `store:` line, whatever value and comment it carries. */
const STORE_KEY = /^store\s*:/u;

/** The same key commented out, as `rafa init` writes it. */
const COMMENTED_STORE_KEY = /^#\s*store\s*:/u;

/** Why a move stopped. */
export type MoveRefusalReason = 'config' | 'count';

/** A move that stopped, naming why. See the module note for when each is thrown. */
export class MoveRefusal extends Error {
  /** Which step refused. */
  readonly reason: MoveRefusalReason;

  constructor(reason: MoveRefusalReason, message: string) {
    super(message);
    this.name = 'MoveRefusal';
    this.reason = reason;
  }
}

/** What moving one kind did. */
export interface KindMove {
  readonly kind: EffortRowKind;
  /** The NDJSON file the rows were read from. */
  readonly from: string;
  /** Rows read that carry a key. */
  readonly read: number;
  /** Rows the SQLite store did not hold, now appended. */
  readonly added: number;
  /** Rows it already held, including a key repeated in the file. */
  readonly skipped: number;
  /** Rows read that carry no key, not moved. */
  readonly unkeyed: number;
  /** Lines of the file that are no row, not moved. */
  readonly unparsed: number;
}

/** What one move did. */
export interface MoveResult {
  /** The SQLite store file the rows went to. */
  readonly to: string;
  readonly kinds: readonly KindMove[];
  /** The project config the setting is in. */
  readonly configPath: string;
  /** True when this move wrote `store: sqlite`; false when the file already read it. */
  readonly configChanged: boolean;
}

/** What a caller hands a move. */
export interface MoveOptions {
  /** The project root; its `.rafa/config.yaml` is edited. */
  readonly root: string;
  /** The NDJSON backend read; `openNdjsonStore(root)` by default. */
  readonly source?: NdjsonEffortStore;
  /** The SQLite backend written; `openSqliteStore(root)` by default. */
  readonly target?: SqliteEffortStore;
}

/** True when `text` parses to a document that names `store` at the top level. */
function namesStore(text: string): boolean {
  let document: unknown;
  try {
    document = Bun.YAML.parse(text);
  } catch {
    return false;
  }
  return isMapping(document) && Object.hasOwn(document, 'store');
}

/**
 * `text` with `store: sqlite` set and every other line kept, or null
 * when the file spells `store` in a shape this edit does not cover. Pure
 * and unchecked: the caller parses what comes back. See the module note.
 */
export function withSqliteStoreSetting(text: string): string | null {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => STORE_KEY.test(line));
  const commented = lines.findIndex((line) => COMMENTED_STORE_KEY.test(line));
  const target = at >= 0
    ? at
    : commented;
  if (target >= 0) return [...lines.slice(0, target), STORE_LINE, ...lines.slice(target + 1)].join('\n');

  if (namesStore(text)) return null;
  const body = lines.at(-1) === ''
    ? lines.slice(0, -1)
    : lines;
  return [...body, STORE_LINE, ''].join('\n');
}

/** The config text a move writes, or null when the file already reads `store: sqlite`. Throws a `config` refusal otherwise. */
function plannedConfig(path: string): string | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new MoveRefusal('config', `${path} could not be read: ${messageOf(error)}. Nothing was moved.`);
  }
  const refuse = (why: string): MoveRefusal => new MoveRefusal(
    'config',
    `${path} ${why}, so this move cannot set ${STORE_LINE}. Nothing was moved. Set it by hand, then run the move again.`,
  );
  try {
    if (parseConfigText(text, path).values.store === MOVE_TARGET) return null;
  } catch (error) {
    throw refuse(`cannot be read as a config (${messageOf(error)})`);
  }

  const written = withSqliteStoreSetting(text);
  if (written === null) throw refuse('spells store in a shape this command does not edit');
  let read: unknown;
  try {
    read = parseConfigText(written, path).values.store;
  } catch (error) {
    throw refuse(`would not parse once edited (${messageOf(error)})`);
  }
  if (read !== MOVE_TARGET) throw refuse(`would read store as ${String(read)} once edited`);
  return written;
}

/** The keys of `rows` under `kind`'s projection, and how many rows carry none. */
function keyedRows<K extends EffortRowKind>(kind: K, rows: readonly EffortRow<K>[]): { keyed: EffortRow<K>[]; unkeyed: number } {
  const project = EFFORT_KEY_PROJECTIONS[kind];
  const keyed = rows.filter((row) => project(row) !== null);
  return { keyed, unkeyed: rows.length - keyed.length };
}

/** Refuses when the SQLite keys after an append are not the keys before plus the rows added, holding every key read. */
function checkCounts(kind: EffortRowKind, before: number, added: number, read: readonly string[], after: ReadonlySet<string>): void {
  const missing = read.filter((key) => !after.has(key));
  if (after.size === before + added && missing.length === 0) return;
  throw new MoveRefusal(
    'count',
    `the ${kind} check failed: the SQLite store held ${String(before)}, ${String(added)} were appended, and it now holds`
      + ` ${String(after.size)}, missing ${String(missing.length)} of the keys read. The config was not changed, so the`
      + ' project still reads its NDJSON files.',
  );
}

/** Moves one kind, checked. */
function moveKind<K extends EffortRowKind>(kind: K, source: NdjsonEffortStore, target: SqliteEffortStore): KindMove {
  const reading = source.readRows(kind);
  const { keyed, unkeyed } = keyedRows(kind, reading.rows);
  const project = EFFORT_KEY_PROJECTIONS[kind];
  const before = target.keys(kind).size;
  const appended = target.append(kind, keyed);
  const keys = keyed.map((row) => project(row) ?? '');
  checkCounts(kind, before, appended.appended, keys, target.keys(kind));
  return {
    kind,
    from: source.path(kind),
    read: keyed.length,
    added: appended.appended,
    skipped: appended.skipped,
    unkeyed,
    unparsed: reading.unparsedLineCount,
  };
}

/** Writes the edited config, or refuses naming the rows already moved. */
function writeConfig(path: string, text: string): void {
  try {
    writeFileSync(path, text, 'utf8');
  } catch (error) {
    throw new MoveRefusal(
      'config',
      `${path} could not be written (${messageOf(error)}). The rows were moved and checked; set ${STORE_LINE}`
        + ' there by hand, or run the move again, which adds nothing.',
    );
  }
}

/** Runs one move. See the module note for its order and its refusals. */
export function moveToSqlite(options: MoveOptions): MoveResult {
  const source = options.source ?? openNdjsonStore(options.root);
  const target = options.target ?? openSqliteStore(options.root);
  const configPath = configFilePath(options.root);
  const config = plannedConfig(configPath);

  const kinds = MOVED_KINDS.map((kind) => moveKind(kind, source, target));

  if (config !== null) writeConfig(configPath, config);
  return { to: target.path('sessions'), kinds, configPath, configChanged: config !== null };
}
