/**
 * `REPOSITORY_FACTS` against the schema every migration builds.
 *
 * The schema is read from a real store under `tmpdir()`, brought through
 * `bringForward` with the migrations as its seam, so a scratch migration
 * is added to that one store and never to `SQLITE_MIGRATIONS`. Each check
 * has a planted case beside it that makes it fail, and each planted case
 * comes before the check on the real schema, so a clean reading cannot
 * come from a check that finds nothing.
 *
 * Three faults are read: a merged table holding a `read_at` column with
 * no entry, an entry naming a table the store lacks, and an entry naming
 * a fact or time column its table lacks.
 *
 * A fourth, the reader case, reads the production sources: a module that
 * names `plan_ci` in a `SELECT` or imports `readPlanCi` reads CI readings
 * one row each, past the facts, and fails unless it is `plan-ci.ts` or
 * `repository-facts.ts`. There is no exemption beyond those two.
 */
import type { MergeRule } from '@open-tomato/rafa/store/merge-rules';
import type { RepositoryFactColumns } from '@open-tomato/rafa/store/repository-facts';

import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test';

import { bringForward } from '@open-tomato/rafa/store/bring-forward';
import { MERGE_RULES } from '@open-tomato/rafa/store/merge-rules';
import { SQLITE_MIGRATIONS } from '@open-tomato/rafa/store/migrations';
import { REPOSITORY_FACTS } from '@open-tomato/rafa/store/repository-facts';

import { SWEEP_TIMEOUT } from '../../../sweep-timeout.js';

setDefaultTimeout(SWEEP_TIMEOUT);

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-repository-facts-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** The clock and version every store here is logged under. */
const OPENED = { appliedBy: '0.25.0', now: () => new Date('2026-09-29T10:00:00.000Z') };

/** The column that marks a table as holding readings. */
const TIME_COLUMN = 'read_at';

/** A store's tables with their column names. */
type Columns = Readonly<Record<string, readonly string[]>>;

/** The registry as the sweep reads it. */
type Registry = Readonly<Record<string, RepositoryFactColumns>>;

let planted = 0;

/** The columns of every table of a store brought through `SQLITE_MIGRATIONS` and then `extra`. */
function columnsAfter(extra: readonly { id: string; sql: string }[]): Columns {
  planted += 1;
  const path = join(scope, `${String(planted)}.sqlite`);
  const db = new Database(path, { readwrite: true, create: true });
  try {
    const migrations = [...SQLITE_MIGRATIONS, ...extra.map((migration) => ({ ...migration, breaks: [] }))];
    bringForward(db, path, 'write', 'open', { ...OPENED, migrations });
    const tables = db
      .query<{ name: string }, []>('SELECT name FROM sqlite_master WHERE type = \'table\' AND name NOT LIKE \'sqlite_%\'')
      .all()
      .map(({ name }) => name);
    return Object.fromEntries(tables.map((table) => [table, db
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all()
      .map(({ name }) => name)]));
  } finally {
    db.close();
  }
}

/** Every way `registry` and the store's `columns` disagree, one line each, sorted. */
function registryFaults(
  columns: Columns,
  registry: Registry,
  rules: Readonly<Record<string, MergeRule>>,
): string[] {
  const unlisted = Object.entries(columns)
    .filter(([name, held]) => rules[name]?.scope === 'merged' && held.includes(TIME_COLUMN) && !Object.hasOwn(registry, name))
    .map(([name]) => `${name}: holds ${TIME_COLUMN} with no REPOSITORY_FACTS entry`);
  const listed = Object.entries(registry).flatMap(([name, entry]) => {
    const held = columns[name];
    if (held === undefined) return [`${name}: REPOSITORY_FACTS entry with no table`];
    return [...entry.facts, entry.time]
      .filter((column) => !held.includes(column))
      .map((column) => `${name}: entry column ${column} is not a column`);
  });
  return [...unlisted, ...listed].sort();
}

/** A scratch migration adding `scratch_readings` with the columns `body`. */
function scratchReadings(body: string): { id: string; sql: string } {
  return {
    id: 'scratch-readings',
    sql: `CREATE TABLE scratch_readings (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, ${body}, origin_store TEXT, origin_seq INTEGER);`,
  };
}

/** The rules with `scratch_readings` merged by `id`. */
const WITH_SCRATCH: Readonly<Record<string, MergeRule>> = {
  ...MERGE_RULES,
  scratch_readings: { scope: 'merged', identity: ['id'], edited: {} },
};

describe('REPOSITORY_FACTS against the schema every migration builds', () => {
  it('fails on a merged table holding read_at with no entry (planted)', () => {
    const columns = columnsAfter([scratchReadings('verdict TEXT, read_at TEXT')]);

    expect(registryFaults(columns, REPOSITORY_FACTS, WITH_SCRATCH))
      .toEqual([`scratch_readings: holds ${TIME_COLUMN} with no REPOSITORY_FACTS entry`]);
  });

  it('passes the same table once it has its entry (planted)', () => {
    const columns = columnsAfter([scratchReadings('verdict TEXT, read_at TEXT')]);
    const registry = { ...REPOSITORY_FACTS, scratch_readings: { facts: ['verdict'], time: 'read_at' } };

    expect(registryFaults(columns, registry, WITH_SCRATCH)).toEqual([]);
  });

  it('passes a local table holding read_at with no entry (planted)', () => {
    const columns = columnsAfter([scratchReadings('read_at TEXT')]);
    const rules = { ...MERGE_RULES, scratch_readings: { scope: 'local' } } as const;

    expect(registryFaults(columns, REPOSITORY_FACTS, rules)).toEqual([]);
  });

  it('fails on an entry naming a table the store lacks (planted)', () => {
    const registry = { ...REPOSITORY_FACTS, ref_readings: { facts: ['verdict'], time: 'read_at' } };

    expect(registryFaults(columnsAfter([]), registry, MERGE_RULES))
      .toEqual(['ref_readings: REPOSITORY_FACTS entry with no table']);
  });

  it('fails on an entry naming a fact or time column its table lacks (planted)', () => {
    const columns = columnsAfter([scratchReadings('verdict TEXT, read_at TEXT')]);
    const registry = { ...REPOSITORY_FACTS, scratch_readings: { facts: ['verdict', 'colour'], time: 'seen_at' } };

    expect(registryFaults(columns, registry, WITH_SCRATCH)).toEqual([
      'scratch_readings: entry column colour is not a column',
      'scratch_readings: entry column seen_at is not a column',
    ]);
  });

  it('finds no fault between the registry and the store every migration builds', () => {
    const columns = columnsAfter([]);

    expect(columns).toHaveProperty('plan_ci');
    expect(registryFaults(columns, REPOSITORY_FACTS, MERGE_RULES)).toEqual([]);
  });
});

/** The checkout root. */
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

/** The only production modules that may read `plan_ci` rows or import `readPlanCi`. */
const PLAN_CI_READERS: ReadonlySet<string> = new Set([
  'packages/rafa/src/effort/store/plan-ci.ts',
  'packages/rafa/src/effort/store/repository-facts.ts',
]);

/** A `SELECT` naming `plan_ci` before the statement or string ends. */
const SELECT_PLAN_CI = /\bSELECT\b[^;'"`]*\bplan_ci\b/i;

/** A `readPlanCi` name (not `readPlanCiFacts`) in an import clause. */
const IMPORT_READ_PLAN_CI = /\bimport\b[^;]*?\breadPlanCi\b[^;]*?\bfrom\b/s;

/** Whether `text` reads `plan_ci` rows or imports `readPlanCi`. */
function readsPlanCi(text: string): boolean {
  return SELECT_PLAN_CI.test(text) || IMPORT_READ_PLAN_CI.test(text);
}

/** Every production `.ts` file under `src/` and `packages/<name>/src/`, repo-relative with its text. */
function productionSources(): { path: string; text: string }[] {
  const roots = [
    join(REPO_ROOT, 'src'),
    ...readdirSync(join(REPO_ROOT, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(REPO_ROOT, 'packages', entry.name, 'src')),
  ];
  return roots.flatMap((root) => {
    let entries: string[];
    try {
      entries = readdirSync(root, { recursive: true, encoding: 'utf8' });
    } catch {
      return [];
    }
    return entries
      .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
      .map((entry) => ({ path: relative(REPO_ROOT, join(root, entry)), text: readFileSync(join(root, entry), 'utf8') }));
  });
}

/** The paths among `files` that read `plan_ci` and are not an allowed reader, sorted. */
function strayReaders(files: readonly { path: string; text: string }[]): string[] {
  return files
    .filter((file) => !PLAN_CI_READERS.has(file.path) && readsPlanCi(file.text))
    .map((file) => file.path)
    .sort();
}

describe('readers of plan_ci rows', () => {
  it('fails a module selecting from plan_ci outside the two readers (planted)', () => {
    const files = [{ path: 'packages/x/src/stray.ts', text: 'db.query(`SELECT pr, verdict\n FROM plan_ci WHERE pr = 1`);' }];

    expect(strayReaders(files)).toEqual(['packages/x/src/stray.ts']);
  });

  it('fails a module importing readPlanCi outside the two readers (planted)', () => {
    const files = [{ path: 'packages/x/src/stray.ts', text: 'import {\n  readPlanCi,\n} from \'@open-tomato/rafa/store/plan-ci\';' }];

    expect(strayReaders(files)).toEqual(['packages/x/src/stray.ts']);
  });

  it('passes readPlanCiFacts, a DDL naming plan_ci and the two readers themselves (planted)', () => {
    const files = [
      { path: 'packages/x/src/facts.ts', text: 'import { readPlanCiFacts } from \'@open-tomato/rafa/store/plan-ci\';' },
      { path: 'packages/x/src/ddl.ts', text: 'CREATE TABLE plan_ci (pr INTEGER);\nINSERT INTO plan_ci (pr) VALUES (1);' },
      { path: 'packages/rafa/src/effort/store/plan-ci.ts', text: 'SELECT pr FROM plan_ci' },
      { path: 'packages/rafa/src/effort/store/repository-facts.ts', text: 'SELECT pr FROM plan_ci' },
    ];

    expect(strayReaders(files)).toEqual([]);
  });

  it('finds no production module outside plan-ci.ts and repository-facts.ts reading plan_ci', () => {
    const files = productionSources();

    expect(files.some((file) => file.path === 'packages/rafa/src/effort/store/plan-ci.ts')).toBe(true);
    expect(strayReaders(files)).toEqual([]);
  });
});
