/**
 * The preflight writer: one row in the store's `preflight` table for each
 * item a run's preflight checked, and the reader `rafa effort report`
 * lists the runs that halted through.
 *
 * `preflight/run.ts` checks every item and answers a report.
 * {@link writePreflightChecks} keeps that report's checks under the run
 * they belong to, so a run that halted, and so dispatched no session and
 * left no session row, still shows in `rafa effort report`.
 *
 * ## The row
 *
 * | Column | From |
 * | --- | --- |
 * | `run_id` | the run, whose id is generated before its preflight |
 * | `position` | the check's place in the report, from 0 |
 * | `tier` | the check: `required` or `optional` |
 * | `kind`, `item`, `probe` | the item: its key, what the key named, and its probe or NULL |
 * | `outcome` | the check: `pass`, `fail` or `timeout` |
 * | `duration_ms` | the check: how long it took, in whole milliseconds |
 * | `failure` | the check: what failed, as the halt words it, or NULL for a pass |
 * | `collected_at` | the write's time, ISO 8601, one per write |
 *
 * `seq` comes first, the append order, as in every table of the store.
 * There is no `id` column: `(run_id, position)` names a row, and nothing
 * else joins to one. A run can check one item twice, since a plan's
 * PREREQUISITES items are appended to the config's without being
 * deduplicated (`mergePlanPrerequisites`), so the item is no key and the
 * position is. An optional item's `reason` is not stored: it words the
 * prompt line, and says nothing of how the check went.
 *
 * The table sits in the SQLite store's file, created by the sixth entry
 * of `SQLITE_MIGRATIONS`, whichever backend the `store` setting selects.
 * It is the one table outside the port's row map that no task report
 * fills; `findings.ts` says why such a table is not a kind.
 *
 * ## Which runs halted
 *
 * A run halted when one of its REQUIRED checks did not pass, whether it
 * failed or timed out. That is the rule `runPreflight` halts by, read
 * back off the rows, so the table holds no `halted` column that could
 * disagree with them. An optional check that did not pass warns, and
 * never halts.
 *
 * {@link readPreflightHalts} answers one halt per such run: the run id,
 * the time its rows were written, how many items it checked, and each
 * required check that did not pass, in the order it was checked. Runs
 * come in the order they were written. It opens and creates nothing when
 * the store file does not exist, and answers none. A store that exists
 * is opened through `withSqliteStore`, as `readTaskReportTallies` opens
 * it, so its schema is brought forward, or refused, as it is for a write.
 *
 * ## One write per run
 *
 * A run's checks are inserted in one transaction, and land whole or not
 * at all. `(run_id, position)` is UNIQUE and nothing absorbs a conflict,
 * so a second write under a run id already stored throws
 * `UNIQUE constraint failed: preflight.run_id, preflight.position` and
 * rolls back, leaving the first write's rows as they were. The loop
 * generates a run id once, before the one preflight it checks, so a
 * second write under it is a fault to surface rather than a retry to
 * skip, and a halt read off rows from two writes would say neither.
 *
 * A write with no check inserts nothing and goes through
 * `writeSqliteStore`, as `findings.ts` does: on a store that does not
 * exist it opens nothing, and on one that exists it still brings the
 * schema forward or refuses it.
 *
 * ## What is refused
 *
 * Everything this writer is handed comes from code: the run id from the
 * loop, the checks from `runPreflight`. So every refusal refuses the WHOLE
 * write, thrown before the store is opened, leaving no file behind and no
 * byte of one changed, and naming the check at fault by its index:
 *
 *   - A run id that is not a string, is blank, or holds a lone UTF-16
 *     surrogate (`textProblem`).
 *   - A tier outside {@link PREFLIGHT_TIERS}, a kind outside
 *     `PREREQUISITE_KINDS`, or an outcome outside
 *     {@link PREFLIGHT_OUTCOMES}.
 *   - An item name, a probe or a failure that `textProblem` refuses. The
 *     config reader refuses a blank item or probe, and the PREREQUISITES
 *     parser takes a blank backticked span for no probe, so neither is
 *     one a run can hold.
 *   - A duration that is not a whole number of milliseconds from 0.
 *   - A pass carrying a failure, or a check that did not pass carrying
 *     none.
 *
 * `tier` and `outcome` have a CHECK, each the runner's own closed set,
 * which the suite pins to the two lists here; widening either is a new
 * migration. `kind` has none, for the reason `absences.ts` gives its
 * `reason`: the set is the config reader's, which can grow, and SQLite
 * cannot widen a CHECK in place. The table also refuses a failure on a
 * pass, or none beside another outcome, and a `duration_ms` or `position`
 * whose type is not `integer`. SQLite gives an INTEGER column's text its
 * integer affinity first, so, measured on SQLite 3.51.0, the text `'7'`
 * is stored as the integer 7 and `'abc'` or `1.5` is refused.
 */
import type { FindingsWriterSeams } from './findings.js';
import type {
  CheckOutcome,
  PreflightCheck,
  PreflightTier,
} from '../../preflight/run.js';
import type { Database } from 'bun:sqlite';

import { existsSync } from 'node:fs';

import { PREREQUISITE_KINDS } from '../../config.js';

import { describeValue, textProblem } from './findings.js';
import { sqliteStorePath, withSqliteStore, writeSqliteStore } from './sqlite.js';

/**
 * Every tier `runPreflight` checks, keyed by the runner's own type, so a
 * tier added there fails to compile here until it is named.
 */
const TIERS: Readonly<Record<PreflightTier, true>> = {
  required: true,
  optional: true,
};

/** The tiers a preflight row may record, as the migration's CHECK spells them. */
export const PREFLIGHT_TIERS: readonly PreflightTier[] = Object.freeze(
  Object.keys(TIERS) as PreflightTier[],
);

/** Every outcome `runPreflight` answers, keyed by the runner's own type. */
const OUTCOMES: Readonly<Record<CheckOutcome, true>> = {
  pass: true,
  fail: true,
  timeout: true,
};

/** The outcomes a preflight row may record, as the migration's CHECK spells them. */
export const PREFLIGHT_OUTCOMES: readonly CheckOutcome[] = Object.freeze(
  Object.keys(OUTCOMES) as CheckOutcome[],
);

/** One write: the checks of one run's preflight. */
export interface PreflightWrite {
  /** The run the checks belong to, generated before its preflight. */
  readonly runId: string;
  /** The report's checks, in the order `runPreflight` answered them. */
  readonly checks: readonly PreflightCheck[];
}

/** The seam for the one value a write generates. */
export type PreflightWriterSeams = Pick<FindingsWriterSeams, 'now'>;

/** What one write did. */
export interface PreflightWriteResult {
  /** The store's file, whether or not anything was written to it. */
  readonly path: string;
  /** Rows written: one per check. */
  readonly appended: number;
}

/** A column value, as it is bound. */
type Bound = string | number | null;

/** The insert. It names no conflict target, so every conflict throws. */
const INSERT_CHECK = `
  INSERT INTO preflight (
    run_id, position,
    tier, kind, item, probe,
    outcome, duration_ms, failure,
    collected_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/** A whole-write refusal, thrown before the store is opened. */
function refusedWrite(reason: string): Error {
  return new Error(`effort store: preflight write ${reason}; nothing written`);
}

/** Whether `value` is one of `choices`. */
function isOneOf(choices: readonly string[], value: unknown): boolean {
  return (choices as readonly unknown[]).includes(value);
}

/** Why a value outside a closed set cannot be stored, or null when it is in it. */
function choiceProblem(field: string, choices: readonly string[], value: unknown): string | null {
  return isOneOf(choices, value)
    ? null
    : `has ${field} ${describeValue(value)}, not one of ${choices.join(', ')}`;
}

/**
 * Why a text field cannot be stored, or null when it can: `field` names
 * it with its article, and a null passes only a `nullable` field.
 */
function textFieldProblem(field: string, value: unknown, nullable: boolean): string | null {
  const problem = value === null && !nullable
    ? 'is null, not a string'
    : textProblem(value);
  return problem === null
    ? null
    : `has ${field} that ${problem}`;
}

/** Why a check's item cannot be stored, or null when it can. */
function itemProblem(check: PreflightCheck): string | null {
  const { kind, name, probe } = check.item;
  return choiceProblem('kind', PREREQUISITE_KINDS, kind)
    ?? textFieldProblem('an item', name, false)
    ?? textFieldProblem('a probe', probe, true);
}

/** Why a check's result cannot be stored, or null when it can. */
function resultProblem(check: PreflightCheck): string | null {
  const { outcome, durationMs, failure } = check;
  const outcomeProblem = choiceProblem('outcome', PREFLIGHT_OUTCOMES, outcome);
  if (outcomeProblem !== null) return outcomeProblem;
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
    return `has duration ${describeValue(durationMs)}, not a whole number of milliseconds from 0`;
  }
  if (outcome === 'pass') {
    return failure === null
      ? null
      : `passed with failure ${describeValue(failure)}, where a pass has none`;
  }
  if (failure === null) return `has outcome ${describeValue(outcome)} and no failure to say why`;
  return textFieldProblem('a failure', failure, false);
}

/** Throws unless a run id and every check can be stored. */
function checkWrite(write: PreflightWrite): void {
  const runIdProblem = textFieldProblem('a run id', write.runId, false);
  if (runIdProblem !== null) throw refusedWrite(runIdProblem);

  const { checks } = write;
  for (const [index, check] of checks.entries()) {
    const problem = choiceProblem('tier', PREFLIGHT_TIERS, check.tier)
      ?? itemProblem(check)
      ?? resultProblem(check);
    if (problem !== null) throw refusedWrite(`check ${index} of ${checks.length} ${problem}`);
  }
}

/** One check as the insert binds it. */
function boundRow(runId: string, position: number, check: PreflightCheck, collectedAt: string): Bound[] {
  const { kind, name, probe } = check.item;
  return [
    runId, position,
    check.tier, kind, name, probe,
    check.outcome, check.durationMs, check.failure,
    collectedAt,
  ];
}

/** Inserts every row in one transaction and answers how many went in. */
function insertRows(db: Database, rows: readonly Bound[][]): number {
  const insert = db.query<unknown, Bound[]>(INSERT_CHECK);
  const insertAll = db.transaction(() => rows.reduce(
    (appended, row) => appended + insert.run(...row).changes,
    0,
  ));
  return insertAll.immediate();
}

/**
 * Records the checks of one run's preflight, one row per check, in one
 * transaction.
 *
 * Throws, having opened nothing, when the run id or a check cannot be
 * stored, and throws, having written nothing, when the run id already
 * has rows. See the module note.
 */
export function writePreflightChecks(
  repoRoot: string,
  write: PreflightWrite,
  seams: PreflightWriterSeams = {},
): PreflightWriteResult {
  checkWrite(write);
  const path = sqliteStorePath(repoRoot);
  const collectedAt = (seams.now ?? (() => new Date()))().toISOString();
  const rows = write.checks.map((check, position) => boundRow(write.runId, position, check, collectedAt));

  const appended = writeSqliteStore(path, rows.length, 0, (db) => insertRows(db, rows));
  return { path, appended };
}

/** A required check that did not pass, as a halt lists it. */
export interface HaltedCheck {
  /** The item's key. Open, as the column is. */
  readonly kind: string;
  /** What the key named. */
  readonly item: string;
  /** The item's probe, or null for a presence check. */
  readonly probe: string | null;
  readonly outcome: Exclude<CheckOutcome, 'pass'>;
  /** How long the check took, in whole milliseconds. */
  readonly durationMs: number;
  /** What failed, as the halt worded it. */
  readonly failure: string;
}

/** One run whose preflight halted. */
export interface PreflightHalt {
  readonly runId: string;
  /** When the run's rows were written, ISO 8601. */
  readonly collectedAt: string;
  /** How many items the run checked, on both tiers. */
  readonly checks: number;
  /** Every required check that did not pass, in the order it was checked. */
  readonly failed: readonly HaltedCheck[];
}

/** A halted check, as the query answers it. */
interface HaltedRow {
  readonly run_id: string;
  readonly collected_at: string;
  readonly checks: number;
  readonly kind: string;
  readonly item: string;
  readonly probe: string | null;
  readonly outcome: Exclude<CheckOutcome, 'pass'>;
  readonly duration_ms: number;
  readonly failure: string;
}

/**
 * Every required check that did not pass, in append order, beside how
 * many checks its run holds.
 */
const SELECT_HALTED = `
  SELECT
    failed.run_id, failed.collected_at,
    (SELECT COUNT(*) FROM preflight AS run WHERE run.run_id = failed.run_id) AS checks,
    failed.kind, failed.item, failed.probe,
    failed.outcome, failed.duration_ms, failed.failure
  FROM preflight AS failed
  WHERE failed.tier = 'required' AND failed.outcome <> 'pass'
  ORDER BY failed.seq
`;

/** One row's check, as a halt lists it. */
function haltedCheckOf(row: HaltedRow): HaltedCheck {
  return {
    kind: row.kind,
    item: row.item,
    probe: row.probe,
    outcome: row.outcome,
    durationMs: row.duration_ms,
    failure: row.failure,
  };
}

/**
 * Lists the runs whose preflight halted, in the order they were written,
 * each with the required checks that did not pass.
 *
 * Answers none, opening and creating nothing, when the store file does
 * not exist. Throws when it exists and cannot be read. See the module
 * note.
 */
export function readPreflightHalts(repoRoot: string): PreflightHalt[] {
  const path = sqliteStorePath(repoRoot);
  if (!existsSync(path)) return [];

  const rows = withSqliteStore(path, false, (db) => db.query<HaltedRow, []>(SELECT_HALTED).all());
  const halts = new Map<string, PreflightHalt & { failed: HaltedCheck[] }>();
  for (const row of rows) {
    const held = halts.get(row.run_id);
    if (held !== undefined) {
      held.failed.push(haltedCheckOf(row));
      continue;
    }
    halts.set(row.run_id, {
      runId: row.run_id,
      collectedAt: row.collected_at,
      checks: row.checks,
      failed: [haltedCheckOf(row)],
    });
  }
  return [...halts.values()];
}
