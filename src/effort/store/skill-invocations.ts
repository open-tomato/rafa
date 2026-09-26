/**
 * The skill-invocation writer and reader: the store's `skill_invocations`
 * table, which says how often each task session invoked each skill, in its
 * main thread and in its sidechains.
 *
 * The session row `effort collect` reads from a log carries token counts
 * and no tool input, so nothing else the store holds says which skills a
 * session actually used. `dispatches` says which ones its prompt offered;
 * this table is the other half of that comparison. The collector in
 * `effort/skill-use.ts` reads the counts off a session's logs, and the
 * skill half of `effort collect` (`effort/collect-skills.ts`) hands them
 * to {@link writeSkillInvocations}.
 *
 * ## The row
 *
 * | Column | From |
 * | --- | --- |
 * | `session_id` | the session the logs belong to |
 * | `name` | the skill's bare name, or NULL on an `unknown` row |
 * | `sidechain` | 1 for the calls a sidechain made, 0 for the main thread's, or NULL on an `unknown` row |
 * | `count` | how many calls, above zero, or NULL on an `unknown` row |
 *
 * `seq` comes first, the append order, as in every table of the store. No
 * other column is kept, not even the write's time: the table holds the
 * session, the skill, the side and the count, and nothing a prompt or a
 * tool output said.
 *
 * One skill invoked from both sides is two rows, one per side, so the
 * unique index is `(session_id, name, sidechain)`. The table sits in the
 * SQLite store's file, created by the eleventh entry of
 * `SQLITE_MIGRATIONS`, whichever backend the `store` setting selects.
 *
 * ## An unknown count is not zero
 *
 * The collector reads a log format it was written against. A session whose
 * log it cannot vouch for is written as `unknown`: one row holding the
 * session and NULL in `name`, `sidechain` and `count`, which a CHECK keeps
 * NULL together. {@link readSkillInvocations} answers that row with a
 * `count` of `'unknown'`, never 0, so a reading nobody could take is not
 * averaged in as a session that used no skill.
 *
 * A session read and found to invoke no skill stores no row: there is
 * nothing to count, and its `sessions` row already says it was collected.
 * A write left with nothing to insert therefore goes through
 * `writeSqliteStore`, so it still meets the schema check on a store that
 * exists and creates nothing on one that does not.
 *
 * ## One reading per session
 *
 * A session already holding any row is skipped whole, its rows counted as
 * skipped: a session is read once, and a second reading, the backfill's
 * over a session already collected, adds nothing. That keeps a session
 * from holding an `unknown` row beside counted ones, which no single
 * reading writes. Every reading of a write is inserted in one transaction.
 *
 * ## Reading it back
 *
 * {@link readSkillInvocations} answers every row in append order. It
 * opens and creates nothing when the store file does not exist, and
 * answers none. A store that exists is opened through `withSqliteStore`,
 * so its schema is brought forward, or refused, as it is for a write.
 *
 * ## What is refused
 *
 * Everything this writer is handed comes from code, so every refusal
 * refuses the WHOLE write, thrown before the store is opened, leaving no
 * file behind:
 *
 *   - A session id that is not a non-empty string, or one named by two
 *     readings of the write.
 *   - Uses that are neither `'unknown'` nor a list.
 *   - A use whose name is not a non-blank string, whose `sidechain` is
 *     not a boolean, or whose count is not a whole number above zero.
 *   - One name on one side twice in a session's uses.
 *   - Any text holding a lone UTF-16 surrogate, which SQLite text cannot
 *     hold.
 */
import type { Database } from 'bun:sqlite';

import { existsSync } from 'node:fs';

import { describeValue, textProblem } from './findings.js';
import { sqliteStorePath, withSqliteStore, writeSqliteStore } from './sqlite.js';

/** The count a session reads when its log could not be read for skill calls. */
export const UNKNOWN_SKILL_COUNT = 'unknown';

/** One skill, on one side of a session, and how often it was invoked there. */
export interface SkillUse {
  /** The skill's bare name. */
  readonly name: string;
  /** True for the calls a sidechain made, false for the main thread's. */
  readonly sidechain: boolean;
  /** How many calls, a whole number above zero. */
  readonly count: number;
}

/** What one session's logs were read to hold. */
export interface SkillUseReading {
  /** The session's id. */
  readonly sessionId: string;
  /** Each skill it invoked, `[]` for none, or `unknown` when its log could not be read. */
  readonly uses: readonly SkillUse[] | typeof UNKNOWN_SKILL_COUNT;
}

/** What one write did. */
export interface SkillInvocationWriteResult {
  /** The store's file, whether or not anything was written to it. */
  readonly path: string;
  /** The rows written. */
  readonly appended: number;
  /** The rows not written because their session already held a row. */
  readonly skipped: number;
}

/** One row read back: a counted skill, or a session whose count is unknown. */
export type SkillInvocation =
  | { readonly sessionId: string; readonly name: string; readonly sidechain: boolean; readonly count: number }
  | { readonly sessionId: string; readonly name: null; readonly sidechain: null; readonly count: typeof UNKNOWN_SKILL_COUNT };

/** A column value, as it is bound. */
type Bound = string | number | null;

/** One row to insert, its values in {@link INSERT_INVOCATION}'s order. */
type RowValues = readonly [string, string | null, number | null, number | null];

/** A row as the query answers it. */
interface StoredInvocation {
  readonly session_id: string;
  readonly name: string | null;
  readonly sidechain: number | null;
  readonly count: number | null;
}

/** The insert. No conflict is absorbed: a duplicate is refused before the store opens. */
const INSERT_INVOCATION = `
  INSERT INTO skill_invocations (session_id, name, sidechain, count)
  VALUES (?, ?, ?, ?)
`;

/** Whether a session already holds a row. */
const SELECT_HELD = 'SELECT 1 AS held FROM skill_invocations WHERE session_id = ? LIMIT 1';

/** Every row, in append order. */
const SELECT_ALL = 'SELECT session_id, name, sidechain, count FROM skill_invocations ORDER BY seq';

/** A whole-write refusal, thrown before the store is opened. */
function refusedWrite(reason: string): Error {
  return new Error(`effort store: skill invocation write ${reason}; nothing written`);
}

/** Throws unless `value` is a non-blank string SQLite can hold. */
function checkText(name: string, value: unknown): void {
  const problem = value === null
    ? 'is null'
    : textProblem(value);
  if (problem !== null) throw refusedWrite(`has a ${name} that ${problem}`);
}

/** Throws unless `use` can be stored, and was not already listed for its side. */
function checkUse(use: SkillUse, seen: Set<string>): void {
  checkText('skill name', use.name);
  const sidechain: unknown = use.sidechain;
  if (typeof sidechain !== 'boolean') {
    throw refusedWrite(`has sidechain ${describeValue(sidechain)} for ${use.name}, not a boolean`);
  }
  if (!Number.isSafeInteger(use.count) || use.count <= 0) {
    throw refusedWrite(`has count ${describeValue(use.count)} for ${use.name}, not a whole number above zero`);
  }
  const key = JSON.stringify([use.name, sidechain]);
  if (seen.has(key)) throw refusedWrite(`names ${use.name} twice on one side of a session`);
  seen.add(key);
}

/** Throws, having opened nothing, unless every reading can be stored. */
function checkReadings(readings: readonly SkillUseReading[]): void {
  const sessions = new Set<string>();
  for (const { sessionId, uses } of readings) {
    checkText('session id', sessionId);
    if (sessions.has(sessionId)) throw refusedWrite(`reads session ${sessionId} twice`);
    sessions.add(sessionId);
    if (uses === UNKNOWN_SKILL_COUNT) continue;
    if (!Array.isArray(uses)) {
      throw refusedWrite(`has uses ${describeValue(uses)} for ${sessionId}, not a list or ${UNKNOWN_SKILL_COUNT}`);
    }
    const seen = new Set<string>();
    for (const use of uses) checkUse(use, seen);
  }
}

/** The rows one reading stores: one per use, or the one `unknown` row. */
function rowsOf({ sessionId, uses }: SkillUseReading): RowValues[] {
  if (uses === UNKNOWN_SKILL_COUNT) return [[sessionId, null, null, null]];
  return uses.map(({ name, sidechain, count }) => [
    sessionId,
    name,
    sidechain
      ? 1
      : 0,
    count,
  ]);
}

/** Inserts each session's rows unless it already holds one, in one transaction; answers the rows added. */
function insertReadings(db: Database, readings: readonly RowValues[][]): number {
  const held = db.query<{ held: number }, [string]>(SELECT_HELD);
  const insert = db.query<unknown, Bound[]>(INSERT_INVOCATION);
  const insertAll = db.transaction(() => readings.reduce((appended, rows) => {
    const [first] = rows;
    if (first === undefined || held.get(first[0]) !== null) return appended;
    return rows.reduce((added, row) => added + insert.run(...row).changes, appended);
  }, 0));
  return insertAll.immediate();
}

/**
 * Records what each session's logs were read to hold, skipping a session
 * that already holds a row.
 *
 * Throws, having opened nothing, when a value cannot be stored. See the
 * module note for each refusal.
 */
export function writeSkillInvocations(
  repoRoot: string,
  readings: readonly SkillUseReading[],
): SkillInvocationWriteResult {
  checkReadings(readings);
  const path = sqliteStorePath(repoRoot);

  const rows = readings.map(rowsOf).filter((sessionRows) => sessionRows.length > 0);
  const rowCount = rows.reduce((total, sessionRows) => total + sessionRows.length, 0);
  const appended = writeSqliteStore(path, rowCount, 0, (db) => insertReadings(db, rows));
  return { path, appended, skipped: rowCount - appended };
}

/** One stored row as a reading answers it, a NULL count as `unknown`. */
function invocationOf(row: StoredInvocation): SkillInvocation {
  if (row.count === null || row.name === null || row.sidechain === null) {
    return { sessionId: row.session_id, name: null, sidechain: null, count: UNKNOWN_SKILL_COUNT };
  }
  return { sessionId: row.session_id, name: row.name, sidechain: row.sidechain === 1, count: row.count };
}

/**
 * Every stored row, in the order it was written, a NULL count read as
 * `unknown`.
 *
 * Answers none, opening and creating nothing, when the store file does
 * not exist. Throws when it exists and cannot be read. See the module
 * note.
 */
export function readSkillInvocations(repoRoot: string): SkillInvocation[] {
  const path = sqliteStorePath(repoRoot);
  if (!existsSync(path)) return [];

  const rows = withSqliteStore(path, false, (db) => db.query<StoredInvocation, []>(SELECT_ALL).all());
  return rows.map(invocationOf);
}
