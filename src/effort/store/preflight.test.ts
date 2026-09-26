/**
 * Tests for the preflight writer and reader, and the migration that
 * creates their table.
 *
 * Every store sits under a fresh temporary repo root, and the disk is
 * real. Every reading of a row goes through `bun:sqlite` directly and
 * never through the module, so the columns, the closed sets and the key
 * are spelled here rather than read off the code under test. The checks
 * the row and reader cases write are `runPreflight`'s own answers, run
 * through its seams: a stand-in probe runner, an environment holding one
 * variable and no `PATH`, and a clock of the case's, so no probe spawns,
 * no request is sent and no case reads this process's environment.
 *
 * The reader's halts are held to the runner's: each run is written from a
 * report, and a run is listed exactly when its report carried a halt,
 * naming exactly the lines that halt names.
 *
 * Twenty-five mutations of `preflight.ts` and of the migration's sixth
 * entry were driven on 2026-09-15 against this file,
 * `effort/report.test.ts`, `effort/report-format.test.ts` and the four
 * suites whose full table lists name the table, with 256 pass before and
 * after and each module restored sha256-identical. Every one reddened at
 * least one case, counted across those seven suites: optional failures
 * listed as halts (3), a timeout not listed (1), runs ordered by id (1),
 * every run counting one check (3), an absent store created by the reader
 * (1), the inserts outside a transaction (1), an empty write creating the
 * store (1), every position 0 (8), the write unchecked (15), a failure on
 * a pass unchecked (1), the duration unchecked (2), the kind unchecked
 * (1), a null probe refused (13), tier and outcome bound swapped (21),
 * `timeout` dropped from the outcome set (5), one failed check kept per
 * run (1), a null item allowed (1) and a missing failure allowed (1); in
 * the migration, the failure pairing CHECK dropped (1), `(run_id,
 * position)` not UNIQUE (3), a fractional duration accepted (1), `tier`
 * left open (1), `timeout` refused (4), the table folded into the fifth
 * entry (1) and a blank probe allowed (1).
 */
import type { OptionalPrerequisiteItem, PrerequisiteItem } from '../../config.js';
import type { PreflightCheck, PreflightReport, ProbeRun } from '../../preflight/run.js';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { loadConfig } from '../../config-load.js';
import { PREREQUISITE_KINDS } from '../../config.js';
import { runPreflight } from '../../preflight/run.js';

import {
  PREFLIGHT_OUTCOMES,
  PREFLIGHT_TIERS,
  readPreflightHalts,
  writePreflightChecks,
} from './preflight.js';
import { migrateSchema, SQLITE_MIGRATIONS, SQLITE_SCHEMA_VERSION } from './sqlite.js';

/** A preflight row as the table holds it. */
interface StoredCheck {
  seq: number;
  run_id: string;
  position: number;
  tier: string;
  kind: string;
  item: string;
  probe: string | null;
  outcome: string;
  duration_ms: number;
  failure: string | null;
  collected_at: string;
}

/** A column value, as a raw insert binds it. */
type Bound = string | number | null;

/** The table's columns, in order. */
const COLUMNS = [
  'seq',
  'run_id',
  'position',
  'tier',
  'kind',
  'item',
  'probe',
  'outcome',
  'duration_ms',
  'failure',
  'collected_at',
];

/** Every table a store at the last version holds, by name. */
const TABLES = [
  'blockers',
  'changes',
  'commits',
  'dispatches',
  'findings',
  'out_of_scope_bugs',
  'preflight',
  'report_absences',
  'sessions',
  'skill_invocations',
  'task_reports',
];

/** A lone high surrogate, built from its code unit. */
const LONE_HIGH = String.fromCharCode(0xd800);

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-preflight-store-'));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A repo root of its own, not yet on disk, so no case sees another's. */
function freshRoot(name: string): string {
  planted += 1;
  return join(tempBase, `${planted}-${name}`);
}

/** The store file under a root. */
function storeFile(root: string): string {
  return join(root, '.rafa', 'effort', 'effort.sqlite');
}

/** The store file's bytes, or null when nothing was ever written. */
function readRaw(root: string): Buffer | null {
  const path = storeFile(root);
  return existsSync(path)
    ? readFileSync(path)
    : null;
}

/** Runs one query against the store file, read-only, module uninvolved. */
function rawQuery<T>(root: string, sql: string, ...bindings: string[]): T[] {
  const db = new Database(storeFile(root), { readonly: true });
  try {
    return db.query<T, string[]>(sql).all(...bindings);
  } finally {
    db.close();
  }
}

/** Every table the store file holds, by name. */
function tablesOf(root: string): string[] {
  const sql = 'SELECT name FROM sqlite_master WHERE type = ? ORDER BY name';
  return rawQuery<{ name: string }>(root, sql, 'table').map(({ name }) => name);
}

/** Every preflight row, in append order. */
function rowsOf(root: string): StoredCheck[] {
  return rawQuery<StoredCheck>(root, 'SELECT * FROM preflight ORDER BY seq');
}

/**
 * Inserts one preflight row by hand, bypassing the writer, with every
 * column valid unless overridden. A failed required check, so it halts.
 */
function rawInsert(root: string, overrides: Partial<Record<keyof StoredCheck, Bound>> = {}): void {
  planted += 1;
  const row: Record<string, Bound> = {
    run_id: `raw-run-${planted}`,
    position: 0,
    tier: 'required',
    kind: 'tool',
    item: 'bun',
    probe: 'bun --version',
    outcome: 'fail',
    duration_ms: 12,
    failure: 'probe `bun --version` exited 127',
    collected_at: '2026-09-15T00:00:00.000Z',
    ...overrides,
  };
  const names = Object.keys(row);
  const holes = names.map(() => '?').join(', ');
  const db = new Database(storeFile(root), { readwrite: true, create: false });
  try {
    const sql = `INSERT INTO preflight (${names.join(', ')}) VALUES (${holes})`;
    db.query<unknown, Bound[]>(sql).run(...Object.values(row));
  } finally {
    db.close();
  }
}

/** The message a call throws. Fails the case when it throws nothing. */
function refusalOf(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    return error instanceof Error
      ? error.message
      : String(error);
  }
  throw new Error('expected the call to throw');
}

/** A required item. */
function required(kind: PrerequisiteItem['kind'], name: string, probe: string | null = null): PrerequisiteItem {
  return Object.freeze({ kind, name, probe });
}

/** An optional item. */
function optional(kind: PrerequisiteItem['kind'], name: string, probe: string | null = null): OptionalPrerequisiteItem {
  return Object.freeze({ kind, name, probe, reason: null });
}

/** What each stand-in probe answers, by its command. */
const PROBE_RUNS: Readonly<Record<string, ProbeRun>> = {
  'bun --version': { exitCode: 0, stderr: '', timedOut: false },
  'gh auth status': { exitCode: 1, stderr: '\nYou are not logged into any GitHub hosts.\n', timedOut: false },
  'mgrep --version': { exitCode: 137, stderr: '', timedOut: true },
};

/** A required item whose probe passes. */
const BUN = required('tool', 'bun', 'bun --version');

/** A required presence check on a variable the environment does not hold. */
const UNSET = required('env', 'UNSET_TOKEN');

/** A required item whose probe exits 1 with a line of stderr. */
const GH = required('service', 'https://api.github.com', 'gh auth status');

/** A required item whose probe times out. */
const MGREP_REQUIRED = required('tool', 'mgrep', 'mgrep --version');

/** An optional item whose probe times out. */
const MGREP = optional('tool', 'mgrep', 'mgrep --version');

/** An optional presence check no `PATH` can satisfy. */
const TYPESCRIPT = optional('lsp', 'typescript');

/**
 * Runs the preflight over two tiers through its seams: each probe answers
 * from {@link PROBE_RUNS}, the environment holds `SET_TOKEN` alone and no
 * `PATH`, and the clock steps 7 ms per reading, so every check takes 7 ms.
 */
function preflightOf(
  requiredItems: readonly PrerequisiteItem[],
  optionalItems: readonly OptionalPrerequisiteItem[] = [],
): Promise<PreflightReport> {
  let clock = 0;
  return runPreflight({ required: requiredItems, optional: optionalItems }, {
    cwd: tempBase,
    env: { SET_TOKEN: 'set' },
    timeoutMs: 200,
    runProbe: (probe) => {
      const run = PROBE_RUNS[probe];
      return run === undefined
        ? Promise.reject(new Error(`no stand-in answers the probe ${probe}`))
        : Promise.resolve(run);
    },
    request: () => Promise.reject(new Error('no case sends a request')),
    warn: () => undefined,
    now: () => {
      clock += 7;
      return clock;
    },
  });
}

/** A write clock fixed at `stamp`. */
function at(stamp: string): { now: () => Date } {
  return { now: () => new Date(stamp) };
}

/** The clock most writes run under. */
const CLOCK = at('2026-09-15T10:00:00.000Z');

/** A required check that passed, written as the runner answers one. */
const PASS_CHECK: PreflightCheck = Object.freeze({
  tier: 'required',
  item: BUN,
  outcome: 'pass',
  durationMs: 7,
  failure: null,
});

/** A required check that failed, written as the runner answers one. */
const FAIL_CHECK: PreflightCheck = Object.freeze({
  tier: 'required',
  item: UNSET,
  outcome: 'fail',
  durationMs: 3,
  failure: 'presence check: UNSET_TOKEN is not set',
});

describe('the preflight migration', () => {
  it('creates the table with its columns, in order, at the last version', () => {
    const root = freshRoot('columns');
    const result = writePreflightChecks(root, { runId: 'run-columns', checks: [PASS_CHECK] }, CLOCK);
    const columns = 'SELECT name FROM pragma_table_info(?) ORDER BY cid';

    expect(result).toEqual({ path: storeFile(root), appended: 1 });
    expect(result.path.startsWith(`${tempBase}/`)).toBe(true);
    expect(rawQuery<{ name: string }>(root, columns, 'preflight').map(({ name }) => name)).toEqual(COLUMNS);
    expect(tablesOf(root)).toEqual(TABLES);
    expect(rawQuery(root, 'PRAGMA user_version')).toEqual([{ user_version: SQLITE_SCHEMA_VERSION }]);
  });

  it('brings a version-5 store forward through a new entry, keeping the rows it holds', () => {
    const root = freshRoot('from-v5');
    mkdirSync(dirname(storeFile(root)), { recursive: true });
    const db = new Database(storeFile(root), { create: true, readwrite: true });
    migrateSchema(db, storeFile(root), SQLITE_MIGRATIONS.slice(0, 5));
    db.run(
      'INSERT INTO task_reports (id, session_id, task_line, status, outcome, collected_at)'
        + ' VALUES (?, ?, ?, ?, ?, ?)',
      ['t-1', 's-1', 'A task', 'done', 'done', '2026-09-14T00:00:00.000Z'],
    );
    db.close();

    // The control: the first five entries make every earlier table and no
    // preflight table, so the table this write fills came from a later
    // entry, and was not added to a shipped one.
    expect(tablesOf(root)).toEqual(
      TABLES.filter((table) => table !== 'preflight' && table !== 'dispatches' && table !== 'changes' && table !== 'skill_invocations'),
    );

    const result = writePreflightChecks(root, { runId: 'run-v5', checks: [PASS_CHECK] }, CLOCK);

    expect(result.appended).toBe(1);
    expect(rawQuery(root, 'PRAGMA user_version')).toEqual([{ user_version: SQLITE_SCHEMA_VERSION }]);
    expect(rawQuery(root, 'SELECT id FROM task_reports')).toEqual([{ id: 't-1' }]);
    expect(rowsOf(root).map(({ run_id }) => run_id)).toEqual(['run-v5']);
  });

  it('refuses a blank or missing column, a repeated position in one run, and a number that is not whole', () => {
    const root = freshRoot('schema');
    writePreflightChecks(root, { runId: 'run-schema', checks: [PASS_CHECK] }, CLOCK);

    // The control: a row with nothing wrong in it goes in, so each
    // refusal below is its own column's.
    expect(() => rawInsert(root)).not.toThrow();
    for (const column of ['run_id', 'kind', 'item', 'probe', 'failure'] as const) {
      expect(() => rawInsert(root, { [column]: '' })).toThrow(/CHECK constraint failed/);
    }
    const notNull = ['run_id', 'position', 'tier', 'kind', 'item', 'outcome', 'duration_ms', 'collected_at'] as const;
    for (const column of notNull) {
      expect(() => rawInsert(root, { [column]: null })).toThrow(`NOT NULL constraint failed: preflight.${column}`);
    }
    for (const column of ['position', 'duration_ms'] as const) {
      for (const value of [-1, 1.5, 'abc']) {
        expect(() => rawInsert(root, { [column]: value })).toThrow(/CHECK constraint failed/);
      }
    }
    expect(() => rawInsert(root, { run_id: 'run-schema', position: 0 }))
      .toThrow('UNIQUE constraint failed: preflight.run_id, preflight.position');

    // The key is the pair: the same run at another position goes in.
    expect(() => rawInsert(root, { run_id: 'run-schema', position: 1 })).not.toThrow();
  });

  it('stores an integer given as text as the integer, as SQLite affinity does', () => {
    const root = freshRoot('affinity');
    writePreflightChecks(root, { runId: 'run-affinity', checks: [PASS_CHECK] }, CLOCK);
    rawInsert(root, { run_id: 'run-text', duration_ms: '7' });

    expect(rawQuery(root, 'SELECT typeof(duration_ms) AS type, duration_ms FROM preflight WHERE run_id = ?', 'run-text'))
      .toEqual([{ type: 'integer', duration_ms: 7 }]);
  });

  it('holds exactly the tiers and outcomes the runner answers', () => {
    const root = freshRoot('closed-sets');
    writePreflightChecks(root, { runId: 'run-sets', checks: [PASS_CHECK] }, CLOCK);

    expect(PREFLIGHT_TIERS).toEqual(['required', 'optional']);
    expect(PREFLIGHT_OUTCOMES).toEqual(['pass', 'fail', 'timeout']);
    for (const tier of PREFLIGHT_TIERS) {
      expect(() => rawInsert(root, { tier })).not.toThrow();
    }
    for (const outcome of PREFLIGHT_OUTCOMES) {
      const failure = outcome === 'pass'
        ? null
        : 'it failed';
      expect(() => rawInsert(root, { outcome, failure })).not.toThrow();
    }
    for (const tier of ['Required', 'reminder', '']) {
      expect(() => rawInsert(root, { tier })).toThrow(/CHECK constraint failed/);
    }
    for (const outcome of ['passed', 'error', '']) {
      expect(() => rawInsert(root, { outcome })).toThrow(/CHECK constraint failed/);
    }
  });

  it('refuses a failure on a pass, and a missing one beside any other outcome', () => {
    const root = freshRoot('failure-pairs');
    writePreflightChecks(root, { runId: 'run-pairs', checks: [PASS_CHECK] }, CLOCK);

    expect(() => rawInsert(root, { outcome: 'pass', failure: null })).not.toThrow();
    expect(() => rawInsert(root, { outcome: 'fail', failure: 'it failed' })).not.toThrow();
    expect(() => rawInsert(root, { outcome: 'timeout', failure: 'it timed out' })).not.toThrow();
    expect(() => rawInsert(root, { outcome: 'pass', failure: 'it failed' })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { outcome: 'fail', failure: null })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { outcome: 'timeout', failure: null })).toThrow(/CHECK constraint failed/);
  });

  it('leaves kind open, so a kind the config reader learns needs no migration', () => {
    const root = freshRoot('open-kind');
    writePreflightChecks(root, { runId: 'run-kind', checks: [PASS_CHECK] }, CLOCK);

    expect(() => rawInsert(root, { kind: 'module' })).not.toThrow();
  });
});

describe('writePreflightChecks rows', () => {
  it('stores every check runPreflight answered, one row per check, in order', async () => {
    const root = freshRoot('rows');
    const report = await preflightOf([BUN, UNSET, GH], [MGREP, TYPESCRIPT]);
    const failures = report.checks.map(({ failure }) => failure);

    // The control: the runner halted on this report, and answered every
    // outcome a row can hold, each failure worded.
    expect(report.halt).not.toBeNull();
    expect(report.checks.map(({ outcome }) => outcome)).toEqual(['pass', 'fail', 'fail', 'timeout', 'fail']);
    expect(failures.slice(1).every((failure) => typeof failure === 'string' && failure !== '')).toBe(true);

    const result = writePreflightChecks(root, { runId: 'run-rows', checks: report.checks }, CLOCK);

    expect(result).toEqual({ path: storeFile(root), appended: 5 });
    const stamp = '2026-09-15T10:00:00.000Z';
    expect(rowsOf(root)).toEqual([
      { seq: 1, run_id: 'run-rows', position: 0, tier: 'required', kind: 'tool', item: 'bun', probe: 'bun --version', outcome: 'pass', duration_ms: 7, failure: null, collected_at: stamp },
      { seq: 2, run_id: 'run-rows', position: 1, tier: 'required', kind: 'env', item: 'UNSET_TOKEN', probe: null, outcome: 'fail', duration_ms: 7, failure: failures[1] ?? '', collected_at: stamp },
      { seq: 3, run_id: 'run-rows', position: 2, tier: 'required', kind: 'service', item: 'https://api.github.com', probe: 'gh auth status', outcome: 'fail', duration_ms: 7, failure: failures[2] ?? '', collected_at: stamp },
      { seq: 4, run_id: 'run-rows', position: 3, tier: 'optional', kind: 'tool', item: 'mgrep', probe: 'mgrep --version', outcome: 'timeout', duration_ms: 7, failure: failures[3] ?? '', collected_at: stamp },
      { seq: 5, run_id: 'run-rows', position: 4, tier: 'optional', kind: 'lsp', item: 'typescript', probe: null, outcome: 'fail', duration_ms: 7, failure: failures[4] ?? '', collected_at: stamp },
    ]);
  });

  it('stores one item checked twice in a run at two positions', async () => {
    const root = freshRoot('twice');
    const report = await preflightOf([BUN, BUN]);

    writePreflightChecks(root, { runId: 'run-twice', checks: report.checks }, CLOCK);

    expect(rowsOf(root).map(({ position, item }) => [position, item])).toEqual([[0, 'bun'], [1, 'bun']]);
  });

  it('writes nothing, creating nothing, for a run that checked no item', () => {
    const root = freshRoot('empty');
    const result = writePreflightChecks(root, { runId: 'run-empty', checks: [] }, CLOCK);

    expect(result).toEqual({ path: storeFile(root), appended: 0 });
    expect(existsSync(root)).toBe(false);

    // The control: the same root with one check holds a store, and a
    // second empty write leaves its bytes as they were.
    writePreflightChecks(root, { runId: 'run-one', checks: [PASS_CHECK] }, CLOCK);
    const before = readRaw(root);
    expect(before).not.toBeNull();
    expect(writePreflightChecks(root, { runId: 'run-empty', checks: [] }, CLOCK).appended).toBe(0);
    expect(readRaw(root)).toEqual(before);
  });

  it('brings a version-5 store forward on a write with no check', () => {
    const root = freshRoot('empty-v5');
    mkdirSync(dirname(storeFile(root)), { recursive: true });
    const db = new Database(storeFile(root), { create: true, readwrite: true });
    migrateSchema(db, storeFile(root), SQLITE_MIGRATIONS.slice(0, 5));
    db.close();

    writePreflightChecks(root, { runId: 'run-empty', checks: [] }, CLOCK);

    expect(rawQuery(root, 'PRAGMA user_version')).toEqual([{ user_version: SQLITE_SCHEMA_VERSION }]);
    expect(tablesOf(root)).toEqual(TABLES);
    expect(rowsOf(root)).toEqual([]);
  });

  it('writes into the SQLite file when the config selects the NDJSON backend', () => {
    const root = freshRoot('ndjson-selected');
    mkdirSync(join(root, '.rafa'), { recursive: true });
    writeFileSync(join(root, '.rafa', 'config.yaml'), 'store: ndjson\n');

    // The control: the planted config really selects the other backend.
    expect(loadConfig({ root, home: join(tempBase, 'home') }, {}, () => undefined).config.store).toBe('ndjson');

    writePreflightChecks(root, { runId: 'run-ndjson', checks: [PASS_CHECK] }, CLOCK);

    expect(readdirSync(dirname(storeFile(root)))).toEqual(['effort.sqlite']);
    expect(rowsOf(root).map(({ run_id }) => run_id)).toEqual(['run-ndjson']);
  });
});

describe('one write per run', () => {
  it('throws on a second write under a run id already stored, leaving the first rows as they were', () => {
    const root = freshRoot('second-write');
    writePreflightChecks(root, { runId: 'run-once', checks: [PASS_CHECK, FAIL_CHECK] }, CLOCK);
    const before = readRaw(root);

    expect(() => writePreflightChecks(root, { runId: 'run-once', checks: [FAIL_CHECK] }, CLOCK))
      .toThrow('UNIQUE constraint failed: preflight.run_id, preflight.position');
    expect(readRaw(root)).toEqual(before);

    // The control: the same checks under another run id go in.
    expect(writePreflightChecks(root, { runId: 'run-other', checks: [FAIL_CHECK] }, CLOCK).appended).toBe(1);
  });

  it('rolls the whole write back when a later check conflicts', () => {
    const root = freshRoot('rollback');
    writePreflightChecks(root, { runId: 'run-first', checks: [PASS_CHECK] }, CLOCK);
    rawInsert(root, { run_id: 'run-partial', position: 1 });

    // Position 0 of this write has no row to conflict with, so only a
    // write in one transaction leaves it out once position 1 conflicts.
    expect(() => writePreflightChecks(root, { runId: 'run-partial', checks: [PASS_CHECK, FAIL_CHECK] }, CLOCK))
      .toThrow('UNIQUE constraint failed: preflight.run_id, preflight.position');
    expect(rowsOf(root).map(({ run_id, position }) => [run_id, position]))
      .toEqual([['run-first', 0], ['run-partial', 1]]);
  });
});

describe('what a preflight write refuses', () => {
  const refusals: readonly (readonly [string, () => unknown, string])[] = [
    ['an empty run id', () => ({ runId: '', checks: [PASS_CHECK] }), 'has a run id that is blank'],
    ['a run id that is not a string', () => ({ runId: 7, checks: [] }), 'has a run id that is 7, not a string'],
    [
      'a run id holding a lone surrogate',
      () => ({ runId: `run${LONE_HIGH}`, checks: [PASS_CHECK] }),
      'has a run id that holds a lone UTF-16 surrogate',
    ],
    [
      'a tier outside the set',
      () => ({ runId: 'run', checks: [PASS_CHECK, { ...FAIL_CHECK, tier: 'later' }] }),
      'check 1 of 2 has tier "later", not one of required, optional',
    ],
    [
      'a kind outside the set',
      () => ({ runId: 'run', checks: [{ ...PASS_CHECK, item: { ...BUN, kind: 'binary' } }] }),
      `check 0 of 1 has kind "binary", not one of ${PREREQUISITE_KINDS.join(', ')}`,
    ],
    [
      'a blank item',
      () => ({ runId: 'run', checks: [{ ...PASS_CHECK, item: { ...BUN, name: '  ' } }] }),
      'check 0 of 1 has an item that is blank',
    ],
    [
      'an item that is null',
      () => ({ runId: 'run', checks: [{ ...PASS_CHECK, item: { ...BUN, name: null } }] }),
      'check 0 of 1 has an item that is null, not a string',
    ],
    [
      'a blank probe',
      () => ({ runId: 'run', checks: [{ ...PASS_CHECK, item: { ...BUN, probe: '' } }] }),
      'check 0 of 1 has a probe that is blank',
    ],
    [
      'an outcome outside the set',
      () => ({ runId: 'run', checks: [{ ...FAIL_CHECK, outcome: 'skipped' }] }),
      'check 0 of 1 has outcome "skipped", not one of pass, fail, timeout',
    ],
    [
      'a negative duration',
      () => ({ runId: 'run', checks: [{ ...PASS_CHECK, durationMs: -1 }] }),
      'check 0 of 1 has duration -1, not a whole number of milliseconds from 0',
    ],
    [
      'a fractional duration',
      () => ({ runId: 'run', checks: [{ ...PASS_CHECK, durationMs: 1.5 }] }),
      'check 0 of 1 has duration 1.5, not a whole number of milliseconds from 0',
    ],
    [
      'a pass carrying a failure',
      () => ({ runId: 'run', checks: [{ ...PASS_CHECK, failure: 'it failed' }] }),
      'check 0 of 1 passed with failure "it failed", where a pass has none',
    ],
    [
      'a failed check with no failure',
      () => ({ runId: 'run', checks: [{ ...FAIL_CHECK, failure: null }] }),
      'check 0 of 1 has outcome "fail" and no failure to say why',
    ],
    [
      'a timed-out check with a blank failure',
      () => ({ runId: 'run', checks: [{ ...FAIL_CHECK, outcome: 'timeout', failure: ' ' }] }),
      'check 0 of 1 has a failure that is blank',
    ],
  ];

  it.each(refusals)('refuses %s whole, creating nothing', (_name, writeFor, message) => {
    const root = freshRoot('refused');
    const refusal = refusalOf(() => writePreflightChecks(root, writeFor() as never, CLOCK));

    expect(refusal).toContain(message);
    expect(refusal.startsWith('effort store: preflight write ')).toBe(true);
    expect(refusal.endsWith('; nothing written')).toBe(true);
    expect(existsSync(root)).toBe(false);
  });

  it('refuses the whole write for one bad check, leaving a store that exists byte-identical', () => {
    const root = freshRoot('refused-existing');
    writePreflightChecks(root, { runId: 'run-kept', checks: [PASS_CHECK] }, CLOCK);
    const before = readRaw(root);
    const good = { runId: 'run-refused', checks: [PASS_CHECK, FAIL_CHECK] };
    const refused = { ...good, checks: [PASS_CHECK, { ...FAIL_CHECK, outcome: 'skipped' }] };

    // The control: the same write with its second check whole changes a
    // store's bytes, so an unchanged file below is the refusal's doing.
    const control = freshRoot('refused-existing-control');
    writePreflightChecks(control, { runId: 'run-kept', checks: [PASS_CHECK] }, CLOCK);
    const controlBefore = readRaw(control);
    writePreflightChecks(control, good, CLOCK);
    expect(readRaw(control)).not.toEqual(controlBefore);

    expect(() => writePreflightChecks(root, refused as never, CLOCK)).toThrow('nothing written');
    expect(readRaw(root)).toEqual(before);
  });

  it('refuses a store past the last version, touching nothing', () => {
    const root = freshRoot('newer');
    writePreflightChecks(root, { runId: 'run-newer', checks: [PASS_CHECK] }, CLOCK);
    const db = new Database(storeFile(root), { readwrite: true });
    db.run(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION + 1}`);
    db.close();
    const before = readRaw(root);

    expect(() => writePreflightChecks(root, { runId: 'run-newer-2', checks: [PASS_CHECK] }, CLOCK))
      .toThrow(`past the ${SQLITE_SCHEMA_VERSION} this rafa knows`);
    expect(() => writePreflightChecks(root, { runId: 'run-newer-3', checks: [] }, CLOCK))
      .toThrow(`past the ${SQLITE_SCHEMA_VERSION} this rafa knows`);
    expect(readRaw(root)).toEqual(before);
  });
});

/** The lines a runner's halt names, one per failed required item, without the heading. */
function haltLinesOf(report: PreflightReport): string[] {
  return report.halt === null
    ? []
    : report.halt.split('\n').slice(1);
}

describe('readPreflightHalts', () => {
  it('answers none and creates nothing when no store exists', () => {
    const root = freshRoot('halts-absent');

    expect(readPreflightHalts(root)).toEqual([]);
    expect(existsSync(root)).toBe(false);
  });

  it('lists a run exactly when its runner halted, naming the checks that halt names', async () => {
    const root = freshRoot('halts');
    const runs: readonly (readonly [string, PreflightReport])[] = [
      ['run-passed', await preflightOf([BUN])],
      ['run-halted', await preflightOf([BUN, UNSET, GH], [MGREP])],
      ['run-warned', await preflightOf([BUN], [MGREP, TYPESCRIPT])],
      ['run-timed-out', await preflightOf([MGREP_REQUIRED])],
    ];
    for (const [index, [runId, report]] of runs.entries()) {
      writePreflightChecks(root, { runId, checks: report.checks }, at(`2026-09-15T1${index}:00:00.000Z`));
    }

    // The control, read without the module: every run's rows went in, and
    // the two that are not listed below hold failed checks of their own.
    expect(rowsOf(root)).toHaveLength(9);
    const failedOf = (runId: string) => rowsOf(root).filter((row) => row.run_id === runId && row.outcome !== 'pass');
    expect(failedOf('run-passed')).toHaveLength(0);
    expect(failedOf('run-warned').map(({ tier }) => tier)).toEqual(['optional', 'optional']);

    const halts = readPreflightHalts(root);
    const halted = runs.filter(([, report]) => report.halt !== null).map(([runId]) => runId);

    expect(halted).toEqual(['run-halted', 'run-timed-out']);
    expect(halts.map(({ runId }) => runId)).toEqual(halted);
    for (const halt of halts) {
      const report = runs.find(([runId]) => runId === halt.runId)?.[1];
      expect(report).toBeDefined();
      expect(halt.failed.map((check) => `  ${check.kind} ${JSON.stringify(check.item)}: ${check.failure}`))
        .toEqual(haltLinesOf(report!));
    }
    expect(halts.map(({ checks, collectedAt }) => [checks, collectedAt])).toEqual([
      [4, '2026-09-15T11:00:00.000Z'],
      [1, '2026-09-15T13:00:00.000Z'],
    ]);
    const timedOut = runs[3]?.[1].checks[0]?.failure;
    expect(typeof timedOut).toBe('string');
    expect(halts[1]?.failed).toEqual([{
      kind: 'tool',
      item: 'mgrep',
      probe: 'mgrep --version',
      outcome: 'timeout',
      durationMs: 7,
      failure: timedOut ?? '',
    }]);
    expect(halts[0]?.failed.map(({ probe, outcome, durationMs }) => [probe, outcome, durationMs]))
      .toEqual([[null, 'fail', 7], ['gh auth status', 'fail', 7]]);
  });

  it('orders runs by when they were written, not by their ids', () => {
    const root = freshRoot('halts-order');
    writePreflightChecks(root, { runId: 'run-z', checks: [FAIL_CHECK] }, CLOCK);
    writePreflightChecks(root, { runId: 'run-a', checks: [PASS_CHECK, FAIL_CHECK] }, CLOCK);

    expect(readPreflightHalts(root).map(({ runId, checks }) => [runId, checks])).toEqual([['run-z', 1], ['run-a', 2]]);
  });

  it('leaves a store at the last version byte-identical', () => {
    const root = freshRoot('halts-bytes');
    writePreflightChecks(root, { runId: 'run-bytes', checks: [FAIL_CHECK] }, CLOCK);
    const before = readRaw(root);

    expect(readPreflightHalts(root)).toHaveLength(1);
    expect(before).not.toBeNull();
    expect(readRaw(root)).toEqual(before);
  });

  it('refuses a store past the last version, as a write does', () => {
    const root = freshRoot('halts-newer');
    writePreflightChecks(root, { runId: 'run-newer', checks: [FAIL_CHECK] }, CLOCK);

    // The control: the same store reads before its version is moved.
    expect(readPreflightHalts(root)).toHaveLength(1);

    const db = new Database(storeFile(root), { readwrite: true });
    db.run(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION + 1}`);
    db.close();
    const before = readRaw(root);

    expect(() => readPreflightHalts(root)).toThrow(`past the ${SQLITE_SCHEMA_VERSION} this rafa knows`);
    expect(readRaw(root)).toEqual(before);
  });
});
