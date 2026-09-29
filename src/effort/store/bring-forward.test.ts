/**
 * Tests for `bringForward` (`bring-forward.ts`): the migration log it
 * creates, adoption of a store no log-aware rafa has opened, pending
 * migrations applied with their log rows and the gate in one
 * `BEGIN IMMEDIATE` transaction, and the second plan under that lock.
 *
 * Every store is a real file under a fresh temporary directory, so a
 * case can compare the file's bytes before and after an open, and a
 * second connection can contend for its lock. A synthetic tail is
 * passed through the `migrations` option, never appended to
 * `SQLITE_MIGRATIONS`.
 */
import type { SqliteMigration } from './migrations.js';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { RAFA_VERSION } from '../../cli/version.js';

import { bringForward, MIGRATION_LOG_TABLE, SchemaRefusedError } from './bring-forward.js';
import {
  LEGACY_GATE_CLOSED,
  LEGACY_GATE_OPEN,
  migrationChecksum,
  SQLITE_MIGRATIONS,
} from './migrations.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-bring-forward-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let storeCount = 0;

/** A fresh store path under the temporary directory; nothing is made there. */
function freshPath(): string {
  storeCount += 1;
  return join(tempBase, `effort-${String(storeCount)}.sqlite`);
}

const NOW = new Date('2026-09-28T18:43:14.000Z');
const OPTIONS = { appliedBy: '0.25.0', now: () => NOW };

const LEGACY_IDS = SQLITE_MIGRATIONS.slice(0, LEGACY_GATE_OPEN).map(({ id }) => id);

/** The ids past the legacy entries, which adopting a pre-log store also applies. */
const PAST_LEGACY_IDS = SQLITE_MIGRATIONS.slice(LEGACY_GATE_OPEN).map(({ id }) => id);

/** Runs `use` over a connection to `path`, closing it whatever `use` did. */
function withDb<T>(path: string, use: (db: Database) => T): T {
  const db = new Database(path, { readwrite: true, create: true });
  try {
    return use(db);
  } finally {
    db.close();
  }
}

/** What a pre-log release leaves: the first `count` entries run, `user_version` at `count`. */
function plantPreLog(path: string, count: number): void {
  withDb(path, (db) => {
    for (const { sql } of SQLITE_MIGRATIONS.slice(0, count)) db.run(sql);
    db.run(`PRAGMA user_version = ${String(count)}`);
  });
}

/** A store this build has already brought forward, with its log. */
function plantCurrent(path: string, migrations: readonly SqliteMigration[] = SQLITE_MIGRATIONS): void {
  withDb(path, (db) => bringForward(db, path, 'write', 'open', { ...OPTIONS, migrations }));
}

interface LogRow {
  readonly id: string;
  readonly sha256: string;
  readonly breaks: string;
  readonly applied_at: string;
  readonly applied_by: string;
}

/** The migration log in apply order, or null when the store has none. */
function logOf(path: string): readonly LogRow[] | null {
  return withDb(path, (db) => {
    const table = db
      .query<{ name: string }, [string]>('SELECT name FROM sqlite_master WHERE type = \'table\' AND name = ?')
      .get(MIGRATION_LOG_TABLE);
    return table === null
      ? null
      : db
        .query<LogRow, []>('SELECT id, sha256, breaks, applied_at, applied_by FROM schema_migrations ORDER BY seq')
        .all();
  });
}

/** The ids the store's log holds, in apply order; none when it has no log. */
function loggedIds(path: string): readonly string[] {
  return (logOf(path) ?? []).map(({ id }) => id);
}

/** `PRAGMA user_version` of the store at `path`. */
function userVersionOf(path: string): number {
  return withDb(path, (db) => db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version ?? 0);
}

/** Every table the store holds, by name. */
function tablesOf(path: string): readonly string[] {
  return withDb(path, (db) => db
    .query<{ name: string }, []>('SELECT name FROM sqlite_master WHERE type = \'table\' ORDER BY name')
    .all()
    .map(({ name }) => name));
}

/** A synthetic additive migration creating one table. */
function additive(id: string): SqliteMigration {
  return { id, breaks: [], sql: `CREATE TABLE ${id.replaceAll('-', '_')} (seq INTEGER PRIMARY KEY, note TEXT);` };
}

/** A synthetic migration that breaks both older readers and writers. */
function breaking(id: string): SqliteMigration {
  return {
    id,
    breaks: ['readers', 'writers'],
    contract: { expand: null, why: 'a fixture' },
    sql: `CREATE TABLE ${id.replaceAll('-', '_')} (seq INTEGER PRIMARY KEY);`,
  };
}

/** Plants a log row the build under test does not know. */
function plantUnknown(path: string, id: string, breaks: readonly string[]): void {
  withDb(path, (db) => db.run(
    'INSERT INTO schema_migrations (id, sha256, breaks, applied_at, applied_by) VALUES (?, ?, ?, ?, ?)',
    [id, migrationChecksum({ sql: id }), JSON.stringify(breaks), '2026-09-27T09:00:00.000Z', '0.26.0+dev:/src/rafa'],
  ));
}

/** Runs `open`, answering the refusal it throws; fails the case when it throws none or another error. */
function refusalOf(open: () => unknown): SchemaRefusedError {
  try {
    open();
  } catch (error) {
    if (error instanceof SchemaRefusedError) return error;
    throw error;
  }
  throw new Error('expected a SchemaRefusedError, and the open returned');
}

describe('a fresh store', () => {
  it('creates the log, applies every migration, logs each with its checksum, and opens the gate', () => {
    const path = freshPath();

    const result = withDb(path, (db) => bringForward(db, path, 'write', 'open', OPTIONS));

    expect(result).toEqual({ adopted: [], applied: SQLITE_MIGRATIONS.map(({ id }) => id), userVersion: LEGACY_GATE_OPEN });
    expect(logOf(path)).toEqual(SQLITE_MIGRATIONS.map((migration) => ({
      id: migration.id,
      sha256: migrationChecksum(migration),
      breaks: '[]',
      applied_at: NOW.toISOString(),
      applied_by: '0.25.0',
    })));
    expect(userVersionOf(path)).toBe(LEGACY_GATE_OPEN);
    expect(tablesOf(path)).toContain('plan_ci');
  });

  it('counts a read open as a write, since it has migrations to apply', () => {
    const path = freshPath();

    const result = withDb(path, (db) => bringForward(db, path, 'read', 'open', OPTIONS));

    expect(result.applied).toHaveLength(SQLITE_MIGRATIONS.length);
    expect(logOf(path)).toHaveLength(SQLITE_MIGRATIONS.length);
  });

  it('logs this build\'s version as applied_by, and the wall clock as applied_at, when the caller names neither', () => {
    const path = freshPath();
    const before = Date.now();

    withDb(path, (db) => bringForward(db, path, 'write', 'open'));

    const [first] = logOf(path) ?? [];
    expect(first?.applied_by).toBe(RAFA_VERSION);
    expect(Date.parse(first?.applied_at ?? '')).toBeGreaterThanOrEqual(before - 1000);
  });
});

describe('adopting a store with no log', () => {
  for (let count = 1; count <= LEGACY_GATE_OPEN; count += 1) {
    it(`at user_version ${String(count)} logs the ${String(count)} it holds unrun, then runs the rest`, () => {
      const path = freshPath();
      plantPreLog(path, count);

      const result = withDb(path, (db) => bringForward(db, path, 'write', 'open', OPTIONS));

      // Running an adopted entry again would throw on its `CREATE TABLE`,
      // so reaching here is what shows the held ones were not run.
      expect(result).toEqual({
        adopted: LEGACY_IDS.slice(0, count),
        applied: [...LEGACY_IDS.slice(count), ...PAST_LEGACY_IDS],
        userVersion: LEGACY_GATE_OPEN,
      });
      expect(logOf(path)?.map(({ id, sha256 }) => ({ id, sha256 }))).toEqual(SQLITE_MIGRATIONS.map((migration) => ({
        id: migration.id,
        sha256: migrationChecksum(migration),
      })));
      expect(userVersionOf(path)).toBe(LEGACY_GATE_OPEN);
    });
  }

  it('adopts on a read open too, since adoption counts as a write', () => {
    const path = freshPath();
    plantPreLog(path, LEGACY_GATE_OPEN);

    const result = withDb(path, (db) => bringForward(db, path, 'read', 'open', OPTIONS));

    expect(result).toEqual({ adopted: LEGACY_IDS, applied: PAST_LEGACY_IDS, userVersion: LEGACY_GATE_OPEN });
    expect(logOf(path)).toHaveLength(SQLITE_MIGRATIONS.length);
  });

  it('refuses a store at 14 with no log, naming its way out, and leaves it byte-identical', () => {
    const path = freshPath();
    plantPreLog(path, LEGACY_GATE_OPEN);
    withDb(path, (db) => db.run('PRAGMA user_version = 14'));
    const before = readFileSync(path);

    const refusal = refusalOf(() => withDb(path, (db) => bringForward(db, path, 'read', 'open', OPTIONS)));

    expect(refusal.reason).toBe('pre-log-unreleased');
    expect(refusal.message).toBe(`effort store: ${path} is at schema version 14 with no migration log;`
      + ' no released rafa wrote that. Refusing to read or write it.'
      + ' Next safe step: rafa effort fix-schema --dry-run');
    expect(refusal.nextStep).toBe('rafa effort fix-schema --dry-run');
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(logOf(path)).toBeNull();
  });
});

describe('a store with nothing to adopt or apply', () => {
  it('writes nothing on a read or a write open, leaving the file byte-identical', () => {
    const path = freshPath();
    plantCurrent(path);
    const before = readFileSync(path);

    const read = withDb(path, (db) => bringForward(db, path, 'read', 'open', OPTIONS));
    const write = withDb(path, (db) => bringForward(db, path, 'write', 'open', OPTIONS));

    expect(read).toEqual({ adopted: [], applied: [], userVersion: LEGACY_GATE_OPEN });
    expect(write).toEqual(read);
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it('takes no lock: it opens while another connection holds the write lock, where a pending migration cannot', () => {
    const path = freshPath();
    plantCurrent(path);
    const holder = new Database(path, { readwrite: true });
    holder.run('BEGIN IMMEDIATE');
    const pending = { ...OPTIONS, migrations: [...SQLITE_MIGRATIONS, additive('fixture-notes')] };

    try {
      const current = withDb(path, (db) => bringForward(db, path, 'write', 'open', OPTIONS));
      expect(current.applied).toEqual([]);
      // Control: with something to apply, the same open needs the lock the holder has.
      expect(() => withDb(path, (db) => bringForward(db, path, 'write', 'open', pending))).toThrow('database is locked');
    } finally {
      holder.run('ROLLBACK');
      holder.close();
    }
  });

  it('control: the same store with a migration pending does change its bytes', () => {
    const path = freshPath();
    plantCurrent(path);
    const before = readFileSync(path);

    withDb(path, (db) => bringForward(db, path, 'read', 'open', {
      ...OPTIONS,
      migrations: [...SQLITE_MIGRATIONS, additive('fixture-notes')],
    }));

    expect(readFileSync(path).equals(before)).toBe(false);
  });

  it('keeps the user_version it holds when its log would give another gate', () => {
    const path = freshPath();
    plantCurrent(path);
    withDb(path, (db) => db.run(`PRAGMA user_version = ${String(LEGACY_GATE_CLOSED)}`));

    const result = withDb(path, (db) => bringForward(db, path, 'write', 'open', OPTIONS));

    expect(result.userVersion).toBe(LEGACY_GATE_CLOSED);
    expect(userVersionOf(path)).toBe(LEGACY_GATE_CLOSED);
  });

  it('reads through an unknown additive migration, and writes nothing', () => {
    const path = freshPath();
    plantCurrent(path);
    plantUnknown(path, 'from-a-newer-rafa', []);
    const before = readFileSync(path);

    const result = withDb(path, (db) => bringForward(db, path, 'write', 'open', OPTIONS));

    expect(result.applied).toEqual([]);
    expect(readFileSync(path).equals(before)).toBe(true);
  });
});

describe('a synthetic tail', () => {
  it('applies an additive tail with its log rows and leaves the gate open', () => {
    const path = freshPath();
    plantCurrent(path);
    const migrations = [...SQLITE_MIGRATIONS, additive('fixture-notes'), additive('fixture-marks')];

    const result = withDb(path, (db) => bringForward(db, path, 'write', 'open', { ...OPTIONS, migrations }));

    expect(result).toEqual({ adopted: [], applied: ['fixture-notes', 'fixture-marks'], userVersion: LEGACY_GATE_OPEN });
    expect(loggedIds(path).slice(-2)).toEqual(['fixture-notes', 'fixture-marks']);
    expect(tablesOf(path)).toEqual(expect.arrayContaining(['fixture_notes', 'fixture_marks']));
    expect(userVersionOf(path)).toBe(LEGACY_GATE_OPEN);
  });

  it('adopts and applies a tail in one open of a pre-log store', () => {
    const path = freshPath();
    plantPreLog(path, LEGACY_GATE_OPEN);
    const migrations = [...SQLITE_MIGRATIONS, additive('fixture-notes')];

    const result = withDb(path, (db) => bringForward(db, path, 'write', 'open', { ...OPTIONS, migrations }));

    expect(result).toEqual({ adopted: LEGACY_IDS, applied: [...PAST_LEGACY_IDS, 'fixture-notes'], userVersion: LEGACY_GATE_OPEN });
  });

  it('applies an additive migration late, after one that follows it in the catalogue', () => {
    const path = freshPath();
    plantCurrent(path, [...SQLITE_MIGRATIONS, additive('branch-b')]);
    const migrations = [...SQLITE_MIGRATIONS, additive('branch-a'), additive('branch-b')];

    const result = withDb(path, (db) => bringForward(db, path, 'write', 'open', { ...OPTIONS, migrations }));

    expect(result.applied).toEqual(['branch-a']);
    expect(loggedIds(path).slice(-2)).toEqual(['branch-b', 'branch-a']);
  });

  it('refuses a pending breaking migration on an ordinary open, leaving the store byte-identical', () => {
    const path = freshPath();
    plantCurrent(path);
    const before = readFileSync(path);
    const migrations = [...SQLITE_MIGRATIONS, breaking('fixture-rebuild')];

    const refusal = refusalOf(() => withDb(path, (db) => bringForward(db, path, 'write', 'open', { ...OPTIONS, migrations })));

    expect(refusal.reason).toBe('breaking-pending');
    expect(refusal.message).toBe(`effort store: ${path} needs migration fixture-rebuild, which breaks older`
      + ' runtimes and is applied only by \'rafa effort migrate\'; refusing to read or write the store until then.'
      + ' Next safe step: rafa effort migrate --dry-run');
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it('applies a breaking migration for `rafa effort migrate`, logs its words, and closes the gate', () => {
    const path = freshPath();
    plantCurrent(path);
    const migrations = [...SQLITE_MIGRATIONS, breaking('fixture-rebuild')];

    const result = withDb(path, (db) => bringForward(db, path, 'write', 'migrate', { ...OPTIONS, migrations }));

    expect(result).toEqual({ adopted: [], applied: ['fixture-rebuild'], userVersion: LEGACY_GATE_CLOSED });
    expect(logOf(path)?.at(-1)?.breaks).toBe('["readers","writers"]');
    expect(userVersionOf(path)).toBe(LEGACY_GATE_CLOSED);
  });

  it('rolls back the log, the tables and user_version together when a migration throws', () => {
    const path = freshPath();
    plantPreLog(path, LEGACY_GATE_OPEN);
    const before = readFileSync(path);
    const failing: SqliteMigration = { id: 'fixture-broken', breaks: [], sql: 'CREATE TABLE fixture_ok (x TEXT); CREATE TABLE plan_ci (x TEXT);' };
    const migrations = [...SQLITE_MIGRATIONS, additive('fixture-notes'), failing];

    expect(() => withDb(path, (db) => bringForward(db, path, 'write', 'open', { ...OPTIONS, migrations })))
      .toThrow('table plan_ci already exists');

    expect(readFileSync(path).equals(before)).toBe(true);
    expect(logOf(path)).toBeNull();
    expect(userVersionOf(path)).toBe(LEGACY_GATE_OPEN);
    expect(tablesOf(path)).not.toContain('fixture_notes');
  });
});

describe('the log it reads', () => {
  it('refuses a log row whose breaks is not a JSON array of words', () => {
    const path = freshPath();
    plantCurrent(path);
    withDb(path, (db) => db.run('UPDATE schema_migrations SET breaks = ? WHERE id = ?', ['readers', 'plan-ci']));

    expect(() => withDb(path, (db) => bringForward(db, path, 'read', 'open', OPTIONS)))
      .toThrow(`effort store: ${path} logs migration plan-ci with breaks readers, which is not a JSON array of words`);
  });

  it('refuses a log row whose breaks is an array holding something other than a word', () => {
    const path = freshPath();
    plantCurrent(path);
    withDb(path, (db) => db.run('UPDATE schema_migrations SET breaks = ? WHERE id = ?', ['[1]', 'plan-ci']));

    expect(() => withDb(path, (db) => bringForward(db, path, 'read', 'open', OPTIONS)))
      .toThrow('which is not a JSON array of words');
  });

  it('refuses a store holding an unknown migration that breaks readers, naming who applied it', () => {
    const path = freshPath();
    plantCurrent(path);
    plantUnknown(path, 'from-a-newer-rafa', ['readers']);

    const refusal = refusalOf(() => withDb(path, (db) => bringForward(db, path, 'read', 'open', OPTIONS)));

    expect(refusal.reason).toBe('unknown-breaks-readers');
    expect(refusal.message).toContain('holds migration from-a-newer-rafa (applied by 0.26.0+dev:/src/rafa on 2026-09-27)');
  });
});

/**
 * A `Database` that runs `race` on a second connection when the first
 * one asks for its transaction, standing in for another process that
 * got to the store between this open's first plan and its lock.
 */
function racedBy(db: Database, race: () => void): Database {
  return new Proxy(db, {
    get(target, property) {
      if (property === 'transaction') {
        return (fn: () => unknown) => {
          race();
          return target.transaction(fn);
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function'
        ? value.bind(target)
        : value;
    },
  });
}

describe('planning again under the lock', () => {
  it('finds nothing left to apply when another open applied it first, and writes no second log row', () => {
    const path = freshPath();
    plantPreLog(path, LEGACY_GATE_OPEN);
    const migrations = [...SQLITE_MIGRATIONS, additive('fixture-notes')];
    const other = { ...OPTIONS, migrations, appliedBy: 'the-other-process' };

    const result = withDb(path, (db) => bringForward(
      racedBy(db, () => withDb(path, (second) => bringForward(second, path, 'write', 'open', other))),
      path,
      'write',
      'open',
      { ...OPTIONS, migrations },
    ));

    expect(result).toEqual({ adopted: [], applied: [], userVersion: LEGACY_GATE_OPEN });
    const log = logOf(path) ?? [];
    expect(log).toHaveLength(SQLITE_MIGRATIONS.length + 1);
    expect(new Set(log.map(({ applied_by: by }) => by))).toEqual(new Set(['the-other-process']));
  });

  it('refuses a write when another open logged a migration that breaks writers meanwhile', () => {
    const path = freshPath();
    plantCurrent(path);
    const migrations = [...SQLITE_MIGRATIONS, additive('fixture-notes')];

    const refusal = refusalOf(() => withDb(path, (db) => bringForward(
      racedBy(db, () => plantUnknown(path, 'from-a-newer-rafa', ['writers'])),
      path,
      'write',
      'open',
      { ...OPTIONS, migrations },
    )));

    expect(refusal.reason).toBe('unknown-breaks-writers');
    expect(loggedIds(path)).not.toContain('fixture-notes');
  });

  it('holds the write lock while it plans again: a second connection cannot begin a write', () => {
    const path = freshPath();
    plantCurrent(path);
    const migrations = [...SQLITE_MIGRATIONS, additive('fixture-notes')];
    const probe = new Database(path, { readwrite: true });
    const attempts: string[] = [];
    /** Tries to take the write lock from the probe connection, and records what happened. */
    const tryWriteLock = (): void => {
      try {
        probe.run('BEGIN IMMEDIATE');
        probe.run('ROLLBACK');
        attempts.push('took the lock');
      } catch (error) {
        attempts.push(error instanceof Error
          ? error.message
          : String(error));
      }
    };
    const probed = (db: Database): Database => new Proxy(db, {
      get(target, property) {
        if (property === 'transaction') return (fn: () => unknown) => target.transaction(() => {
          tryWriteLock();
          return fn();
        });
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function'
          ? value.bind(target)
          : value;
      },
    });

    try {
      // Control: outside any transaction the probe takes the lock freely.
      tryWriteLock();
      withDb(path, (db) => bringForward(probed(db), path, 'write', 'open', { ...OPTIONS, migrations }));
    } finally {
      probe.close();
    }

    expect(attempts).toEqual(['took the lock', 'database is locked']);
  });
});
