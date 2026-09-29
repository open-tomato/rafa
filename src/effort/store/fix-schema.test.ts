/**
 * `fixStoreSchema` over stores planted in a temp directory. A pre-log
 * store "past this rafa" is planted by migrating a fresh file with the
 * store's own history plus extra entries by position, the way a branch
 * cut before the migration log leaves the project's store when its code
 * opens it. A logged store is planted through `bringForward`, then
 * tampered with as another rafa would have written it: a migration log
 * row this rafa does not know, a checksum it holds otherwise, a gate it
 * does not match.
 *
 * The suite runs as a development build, which is refused every swap,
 * so each case that swaps passes an installed identity; the refusal
 * itself has its own cases.
 */
import type { SqliteMigration } from './migrations.js';
import type { RuntimeIdentity } from '../../runtime/identity.js';

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
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { RAFA_VERSION } from '../../cli/version.js';

import { bringForward, MIGRATION_LOG_TABLE } from './bring-forward.js';
import { fixStoreSchema, SchemaFixRefusal } from './fix-schema.js';
import { LEGACY_GATE_OPEN } from './migrations.js';
import { sqliteCatalogue } from './schema-plan.js';
import { migrateSchema, SQLITE_MIGRATIONS, SQLITE_SCHEMA_VERSION } from './sqlite.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-fix-schema-'));
afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let planted = 0;

/** A fresh directory for one case. */
function caseDir(): string {
  planted += 1;
  const dir = join(tempRoot, `case-${String(planted)}`);
  mkdirSync(dir);
  return dir;
}

/** A column added to a table this rafa knows, as a later rafa's migration might. */
const ADDED_COLUMN: SqliteMigration = {
  id: 'future-note',
  breaks: [],
  sql: 'ALTER TABLE sessions ADD COLUMN future_note TEXT;',
};

/** A table this rafa does not know, as a later rafa's migration might. */
const ADDED_TABLE: SqliteMigration = {
  id: 'future-readings',
  breaks: [],
  sql: `
  CREATE TABLE future_readings (
    seq INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    name TEXT
  );
  CREATE UNIQUE INDEX future_readings_by_use ON future_readings (session_id, ifnull(name, ''));
`,
};

/** A newer history that drops a column this rafa writes: not additive. */
const DROPPED_COLUMN: SqliteMigration = {
  id: 'commits-drop-row-json',
  breaks: ['readers', 'writers'],
  contract: { expand: null, why: 'a fixture: a newer history no older rafa can use' },
  sql: 'ALTER TABLE commits DROP COLUMN row_json;',
};

const STAMP = '20260926T101500Z';

const NOW = new Date('2026-09-26T10:15:00.000Z');

/** An installed runtime, which may swap a rebuild in. */
const INSTALLED: RuntimeIdentity = { kind: 'installed', entry: '/home/u/.rafa/runtime/0.24.1/cli.js' };

/** A development build, which may only dry-run. */
const DEVELOPMENT: RuntimeIdentity = { kind: 'development', entry: '/work/rafa/src/rafa.ts', checkout: '/work/rafa' };

/** The options every case passes: the stamp, the clock, and an installed identity unless it says otherwise. */
function fixOptions(path: string, dryRun: boolean, extra: { identity?: RuntimeIdentity; stamp?: string; migrations?: readonly SqliteMigration[] } = {}): Parameters<typeof fixStoreSchema>[0] {
  return { path, dryRun, stamp: STAMP, now: () => NOW, identity: INSTALLED, ...extra };
}

/** Plants a store at `path` this build brought forward: logged, every known id, gate open. */
function plantLogged(path: string, fill: (db: Database) => void = () => {}): void {
  const db = new Database(path, { create: true, readwrite: true });
  try {
    bringForward(db, path, 'write', 'open', { appliedBy: '0.25.0', now: () => NOW });
    fill(db);
  } finally {
    db.close();
  }
}

/** A log row this rafa does not know, breaking `breaks`, as a newer rafa would have logged it. */
function unknownLogRow(id: string, breaks: readonly string[]): string {
  return `INSERT INTO ${MIGRATION_LOG_TABLE} (id, sha256, breaks, applied_at, applied_by)`
    + ` VALUES ('${id}', '${'a'.repeat(64)}', '${JSON.stringify(breaks)}', '2026-10-01T09:00:00.000Z', '0.30.0')`;
}

/** What a newer rafa's unknown migration `future-readings` left in a logged store, breaking `breaks`, with rows. */
function newerLogged(breaks: readonly string[]): (db: Database) => void {
  return (db) => {
    db.run(ADDED_COLUMN.sql);
    db.run(ADDED_TABLE.sql);
    db.run(unknownLogRow('future-readings', breaks));
    fillNewer(db);
  };
}

/** The store's migration log rows, in apply order. */
function logOf(path: string): { id: string; sha256: string; applied_by: string; applied_at: string }[] {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<{ id: string; sha256: string; applied_by: string; applied_at: string }, []>(
      `SELECT id, sha256, applied_by, applied_at FROM ${MIGRATION_LOG_TABLE} ORDER BY seq`,
    ).all();
  } finally {
    db.close();
  }
}

/** Runs `statements` on the store at `path`. */
function tamper(path: string, statements: readonly string[]): void {
  const db = new Database(path, { readwrite: true });
  try {
    for (const statement of statements) db.run(statement);
  } finally {
    db.close();
  }
}

/** Plants a store at `path` migrated with `migrations`, then runs `fill` on it. */
function plantStore(path: string, migrations: readonly SqliteMigration[], fill: (db: Database) => void = () => {}): void {
  const db = new Database(path, { create: true, readwrite: true });
  try {
    migrateSchema(db, path, migrations);
    fill(db);
  } finally {
    db.close();
  }
}

/** Rows in the known tables and in the two additions. */
function fillNewer(db: Database): void {
  db.run('INSERT INTO sessions (session_id, row_json, future_note) VALUES (\'s-1\', \'{"sessionId":"s-1"}\', \'tag\')');
  db.run('INSERT INTO sessions (session_id, row_json, future_note) VALUES (\'s-2\', \'{"sessionId":"s-2"}\', NULL)');
  db.run('INSERT INTO commits (sha, row_json) VALUES (\'abc123\', \'{"sha":"abc123"}\')');
  db.run('INSERT INTO future_readings (session_id, name) VALUES (\'s-1\', \'tdd-workflow\')');
  db.run('INSERT INTO future_readings (session_id, name) VALUES (\'s-2\', \'verification-loop\')');
  db.run('INSERT INTO future_readings (session_id, name) VALUES (\'s-2\', \'git-workflow\')');
}

/** The store's `user_version`, read without migrating it. */
function versionOf(path: string): number {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version ?? 0;
  } finally {
    db.close();
  }
}

/** One count query against the file at `path`. */
function countOf(path: string, sql: string): number {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<{ n: number }, []>(sql).get()?.n ?? 0;
  } finally {
    db.close();
  }
}

const NEWER = [...SQLITE_MIGRATIONS, ADDED_COLUMN, ADDED_TABLE];

describe('fixStoreSchema on a pre-log store past this rafa', () => {
  it('builds and removes a parallel store under --dry-run, leaving the live file byte-identical', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, NEWER, fillNewer);
    const before = readFileSync(path);

    const result = fixStoreSchema(fixOptions(path, true));

    expect(result.status).toBe('would-rebuild');
    expect(result.reason).toBe('pre-log-unreleased');
    expect(result.storeVersion).toBe(SQLITE_SCHEMA_VERSION + 2);
    expect(result.known).toEqual(SQLITE_MIGRATIONS.map(({ id }) => id));
    expect(result.backupPath).toBeNull();
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dir)).toEqual(['effort.sqlite']);
  });

  it('reports every kept table with its rows, and what is left behind', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, NEWER, fillNewer);

    const result = fixStoreSchema(fixOptions(path, true));

    expect(result.kept).toContainEqual({ table: 'sessions', rows: 2 });
    expect(result.kept).toContainEqual({ table: 'commits', rows: 1 });
    expect(result.kept.map((row) => row.table)).not.toContain('future_readings');
    expect(result.leftTables).toEqual([{ table: 'future_readings', rows: 3 }]);
    expect(result.leftColumns).toEqual([{ table: 'sessions', column: 'future_note', values: 1 }]);
  });

  it('can run --dry-run twice, each time leaving nothing behind', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, NEWER, fillNewer);

    fixStoreSchema(fixOptions(path, true));
    const second = fixStoreSchema(fixOptions(path, true));

    expect(second.status).toBe('would-rebuild');
    expect(readdirSync(dir)).toEqual(['effort.sqlite']);
  });

  it('swaps in the rebuilt store at this version and keeps the original as a backup', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, NEWER, fillNewer);
    const original = readFileSync(path);

    const result = fixStoreSchema(fixOptions(path, false));

    const backup = join(dir, `effort.sqlite.v${String(SQLITE_SCHEMA_VERSION + 2)}-${STAMP}.bak`);
    expect(result.status).toBe('rebuilt');
    expect(result.backupPath).toBe(backup);
    expect(readFileSync(backup).equals(original)).toBe(true);
    expect(versionOf(path)).toBe(LEGACY_GATE_OPEN);
    expect(countOf(path, 'SELECT count(*) AS n FROM sessions')).toBe(2);
    expect(countOf(path, 'SELECT count(*) AS n FROM commits')).toBe(1);
    expect(countOf(path, 'SELECT count(*) AS n FROM sqlite_master WHERE name = \'future_readings\'')).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(['effort.sqlite', `effort.sqlite.v${String(SQLITE_SCHEMA_VERSION + 2)}-${STAMP}.bak`]);
  });

  it('rebuilds a pre-log store at 15 at the known ids, with a log naming this runtime', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, NEWER, fillNewer);
    expect(versionOf(path)).toBe(15);
    expect(countOf(path, `SELECT count(*) AS n FROM sqlite_master WHERE name = '${MIGRATION_LOG_TABLE}'`)).toBe(0);

    const result = fixStoreSchema(fixOptions(path, false));

    expect(result.status).toBe('rebuilt');
    expect(result.reason).toBe('pre-log-unreleased');
    expect(result.appliedBy).toBe(RAFA_VERSION);
    expect(logOf(path)).toEqual(sqliteCatalogue(SQLITE_MIGRATIONS).map(({ id, sha256 }) => ({
      id,
      sha256,
      applied_by: RAFA_VERSION,
      applied_at: NOW.toISOString(),
    })));
    expect(versionOf(path)).toBe(LEGACY_GATE_OPEN);
    expect(result.leftTables).toEqual([{ table: 'future_readings', rows: 3 }]);
    expect(result.leftColumns).toEqual([{ table: 'sessions', column: 'future_note', values: 1 }]);
  });

  it('keeps each row\'s key and body byte for byte', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, NEWER, fillNewer);

    fixStoreSchema(fixOptions(path, false));

    const db = new Database(path, { readonly: true });
    try {
      const rows = db.query<{ seq: number; session_id: string; row_json: string }, []>(
        'SELECT seq, session_id, row_json FROM sessions ORDER BY seq',
      ).all();
      expect(rows).toEqual([
        { seq: 1, session_id: 's-1', row_json: '{"sessionId":"s-1"}' },
        { seq: 2, session_id: 's-2', row_json: '{"sessionId":"s-2"}' },
      ]);
    } finally {
      db.close();
    }
  });

  it('finds nothing to do on a second run, once the store is at this version', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, NEWER, fillNewer);

    fixStoreSchema(fixOptions(path, false));
    const second = fixStoreSchema(fixOptions(path, false, { stamp: '20260926T101600Z' }));

    expect(second.status).toBe('current');
    expect(second.backupPath).toBeNull();
    expect(readdirSync(dir)).toHaveLength(2);
  });

  it('refuses a newer store that no longer holds a column this rafa knows, touching nothing', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, [...SQLITE_MIGRATIONS, DROPPED_COLUMN]);
    const before = readFileSync(path);

    expect(() => fixStoreSchema(fixOptions(path, false))).toThrow(SchemaFixRefusal);
    expect(() => fixStoreSchema(fixOptions(path, false))).toThrow(/commits\.row_json/);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dir)).toEqual(['effort.sqlite']);
  });

  it('refuses the swap from a development build before building anything, naming the next step', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, NEWER, fillNewer);
    const before = readFileSync(path);

    const swap = (): unknown => fixStoreSchema(fixOptions(path, false, { identity: DEVELOPMENT }));

    expect(swap).toThrow(SchemaFixRefusal);
    expect(swap).toThrow('this rafa is a development build (/work/rafa)');
    expect(swap).toThrow(/Next safe step: rafa effort fix-schema$/);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dir)).toEqual(['effort.sqlite']);
  });

  it('runs a development build\'s --dry-run, logging it as the checkout it runs from', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, NEWER, fillNewer);
    const before = readFileSync(path);

    const result = fixStoreSchema(fixOptions(path, true, { identity: DEVELOPMENT }));

    expect(result.status).toBe('would-rebuild');
    expect(result.appliedBy).toBe(`${RAFA_VERSION}+dev:/work/rafa`);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dir)).toEqual(['effort.sqlite']);
  });

  it('refuses while a rollback journal sits beside the store, touching nothing', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, NEWER, fillNewer);
    writeFileSync(`${path}-journal`, 'hot');
    const before = readFileSync(path);

    expect(() => fixStoreSchema(fixOptions(path, false))).toThrow(/-journal/);
    expect(readFileSync(path).equals(before)).toBe(true);
  });
});

describe('fixStoreSchema on a logged store this rafa refuses', () => {
  it('rebuilds a store logging an unknown migration that breaks writers, leaving it and its tables and columns behind', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantLogged(path, newerLogged(['writers']));
    const original = readFileSync(path);

    const result = fixStoreSchema(fixOptions(path, false));

    expect(result.status).toBe('rebuilt');
    expect(result.reason).toBe('unknown-breaks-writers');
    expect(result.unknown.map(({ id, appliedBy }) => ({ id, appliedBy }))).toEqual([{ id: 'future-readings', appliedBy: '0.30.0' }]);
    expect(result.leftTables).toEqual([{ table: 'future_readings', rows: 3 }]);
    expect(result.leftColumns).toEqual([{ table: 'sessions', column: 'future_note', values: 1 }]);
    expect(logOf(path).map(({ id }) => id)).toEqual(SQLITE_MIGRATIONS.map(({ id }) => id));
    expect(countOf(path, 'SELECT count(*) AS n FROM sqlite_master WHERE name = \'future_readings\'')).toBe(0);
    expect(countOf(path, 'SELECT count(*) AS n FROM sessions')).toBe(2);
    const backup = join(dir, `effort.sqlite.v${String(LEGACY_GATE_OPEN)}-${STAMP}.bak`);
    expect(readFileSync(backup).equals(original)).toBe(true);
    expect(countOf(backup, `SELECT count(*) AS n FROM ${MIGRATION_LOG_TABLE} WHERE id = 'future-readings'`)).toBe(1);
  });

  it('rebuilds a store logging an unknown migration that breaks readers', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantLogged(path, newerLogged(['readers', 'writers']));

    const result = fixStoreSchema(fixOptions(path, true));

    expect(result.status).toBe('would-rebuild');
    expect(result.reason).toBe('unknown-breaks-readers');
    expect(result.leftTables.map(({ table }) => table)).toEqual(['future_readings']);
  });

  it('rebuilds a store whose gate a build older than the log moved', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantLogged(path, (db) => {
      db.run('PRAGMA user_version = 12');
    });

    const result = fixStoreSchema(fixOptions(path, false));

    expect(result.status).toBe('rebuilt');
    expect(result.reason).toBe('gate-mismatch');
    expect(result.backupPath).toBe(join(dir, `effort.sqlite.v12-${STAMP}.bak`));
    expect(versionOf(path)).toBe(LEGACY_GATE_OPEN);
  });

  it('rebuilds a store logging a known id under another checksum, logging the one this rafa holds', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantLogged(path);
    tamper(path, [`UPDATE ${MIGRATION_LOG_TABLE} SET sha256 = '${'0'.repeat(64)}' WHERE id = 'findings'`]);

    const result = fixStoreSchema(fixOptions(path, false));

    const findings = sqliteCatalogue(SQLITE_MIGRATIONS).find(({ id }) => id === 'findings');
    expect(result.reason).toBe('edited');
    expect(logOf(path).find(({ id }) => id === 'findings')?.sha256).toBe(String(findings?.sha256));
  });

  it('refuses a store whose pending migration breaks older runtimes, naming the plan\'s next step, touching nothing', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantLogged(path);
    const before = readFileSync(path);

    const fix = (): unknown => fixStoreSchema(fixOptions(path, false, { migrations: [...SQLITE_MIGRATIONS, DROPPED_COLUMN] }));

    expect(fix).toThrow('does not repair breaking-pending');
    expect(fix).toThrow(/Next safe step: rafa effort migrate --dry-run$/);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dir)).toEqual(['effort.sqlite']);
  });
});

describe('fixStoreSchema on a store this rafa can already use', () => {
  it('answers missing when there is no store file, creating none', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');

    const result = fixStoreSchema(fixOptions(path, false));

    expect(result.status).toBe('missing');
    expect(result.storeVersion).toBeNull();
    expect(existsSync(path)).toBe(false);
  });

  it('answers current for a logged store holding every known id, leaving it byte-identical', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantLogged(path);
    const before = readFileSync(path);

    const result = fixStoreSchema(fixOptions(path, false));

    expect(result.status).toBe('current');
    expect(result.unknown).toEqual([]);
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it('answers current for a logged store holding an unknown additive migration, leaving it byte-identical', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantLogged(path, newerLogged([]));
    const before = readFileSync(path);

    const result = fixStoreSchema(fixOptions(path, false));

    expect(result.status).toBe('current');
    expect(result.reason).toBeNull();
    expect(result.unknown.map(({ id, breaks }) => ({ id, breaks }))).toEqual([{ id: 'future-readings', breaks: [] }]);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dir)).toEqual(['effort.sqlite']);
  });

  it('answers behind for a pre-log store at the legacy entries, which the next open adopts, leaving it byte-identical', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, SQLITE_MIGRATIONS);
    const before = readFileSync(path);

    const result = fixStoreSchema(fixOptions(path, false));

    expect(result.status).toBe('behind');
    expect(result.pending).toEqual([MIGRATION_LOG_TABLE]);
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it('answers behind for an older store, which the next ordinary open migrates, leaving it byte-identical', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, SQLITE_MIGRATIONS.slice(0, 3));
    const before = readFileSync(path);

    const result = fixStoreSchema(fixOptions(path, false));

    expect(result.status).toBe('behind');
    expect(result.storeVersion).toBe(3);
    expect(result.pending).toEqual([MIGRATION_LOG_TABLE, ...SQLITE_MIGRATIONS.slice(3).map(({ id }) => id)]);
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it('leaves a current store alone from a development build too', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantLogged(path);

    expect(fixStoreSchema(fixOptions(path, false, { identity: DEVELOPMENT })).status).toBe('current');
  });
});
