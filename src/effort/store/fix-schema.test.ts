/**
 * `fixStoreSchema` over stores planted in a temp directory. A store "past
 * this rafa" is planted by migrating a fresh file with the store's own
 * history plus extra entries, the way a branch that adds migrations
 * leaves the project's store when its code opens it.
 */
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

import { fixStoreSchema, SchemaFixRefusal } from './fix-schema.js';
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

/** A column added to a table this rafa knows, as rafa-23's version 10 did. */
const ADDED_COLUMN = 'ALTER TABLE sessions ADD COLUMN resolver TEXT;';

/** A table this rafa does not know, as rafa-23's version 11 did. */
const ADDED_TABLE = `
  CREATE TABLE skill_invocations (
    seq INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    name TEXT
  );
  CREATE UNIQUE INDEX skill_invocations_by_use ON skill_invocations (session_id, ifnull(name, ''));
`;

/** A newer history that drops a column this rafa writes: not additive. */
const DROPPED_COLUMN = 'ALTER TABLE commits DROP COLUMN row_json;';

const STAMP = '20260926T101500Z';

/** Plants a store at `path` migrated with `migrations`, then runs `fill` on it. */
function plantStore(path: string, migrations: readonly string[], fill: (db: Database) => void = () => {}): void {
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
  db.run('INSERT INTO sessions (session_id, row_json, resolver) VALUES (\'s-1\', \'{"sessionId":"s-1"}\', \'tag\')');
  db.run('INSERT INTO sessions (session_id, row_json, resolver) VALUES (\'s-2\', \'{"sessionId":"s-2"}\', NULL)');
  db.run('INSERT INTO commits (sha, row_json) VALUES (\'abc123\', \'{"sha":"abc123"}\')');
  db.run('INSERT INTO skill_invocations (session_id, name) VALUES (\'s-1\', \'tdd-workflow\')');
  db.run('INSERT INTO skill_invocations (session_id, name) VALUES (\'s-2\', \'verification-loop\')');
  db.run('INSERT INTO skill_invocations (session_id, name) VALUES (\'s-2\', \'git-workflow\')');
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

describe('fixStoreSchema on a store past this rafa', () => {
  it('builds and removes a parallel store under --dry-run, leaving the live file byte-identical', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, NEWER, fillNewer);
    const before = readFileSync(path);

    const result = fixStoreSchema({ path, dryRun: true, stamp: STAMP });

    expect(result.status).toBe('would-rebuild');
    expect(result.storeVersion).toBe(SQLITE_SCHEMA_VERSION + 2);
    expect(result.knownVersion).toBe(SQLITE_SCHEMA_VERSION);
    expect(result.backupPath).toBeNull();
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dir)).toEqual(['effort.sqlite']);
  });

  it('reports every kept table with its rows, and what is left behind', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, NEWER, fillNewer);

    const result = fixStoreSchema({ path, dryRun: true, stamp: STAMP });

    expect(result.kept).toContainEqual({ table: 'sessions', rows: 2 });
    expect(result.kept).toContainEqual({ table: 'commits', rows: 1 });
    expect(result.kept.map((row) => row.table)).not.toContain('skill_invocations');
    expect(result.leftTables).toEqual([{ table: 'skill_invocations', rows: 3 }]);
    expect(result.leftColumns).toEqual([{ table: 'sessions', column: 'resolver', values: 1 }]);
  });

  it('can run --dry-run twice, each time leaving nothing behind', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, NEWER, fillNewer);

    fixStoreSchema({ path, dryRun: true, stamp: STAMP });
    const second = fixStoreSchema({ path, dryRun: true, stamp: STAMP });

    expect(second.status).toBe('would-rebuild');
    expect(readdirSync(dir)).toEqual(['effort.sqlite']);
  });

  it('swaps in the rebuilt store at this version and keeps the original as a backup', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, NEWER, fillNewer);
    const original = readFileSync(path);

    const result = fixStoreSchema({ path, dryRun: false, stamp: STAMP });

    const backup = join(dir, `effort.sqlite.v${String(SQLITE_SCHEMA_VERSION + 2)}-${STAMP}.bak`);
    expect(result.status).toBe('rebuilt');
    expect(result.backupPath).toBe(backup);
    expect(readFileSync(backup).equals(original)).toBe(true);
    expect(versionOf(path)).toBe(SQLITE_SCHEMA_VERSION);
    expect(countOf(path, 'SELECT count(*) AS n FROM sessions')).toBe(2);
    expect(countOf(path, 'SELECT count(*) AS n FROM commits')).toBe(1);
    expect(countOf(path, 'SELECT count(*) AS n FROM sqlite_master WHERE name = \'skill_invocations\'')).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(['effort.sqlite', `effort.sqlite.v${String(SQLITE_SCHEMA_VERSION + 2)}-${STAMP}.bak`]);
  });

  it('keeps each row\'s key and body byte for byte', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, NEWER, fillNewer);

    fixStoreSchema({ path, dryRun: false, stamp: STAMP });

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

    fixStoreSchema({ path, dryRun: false, stamp: STAMP });
    const second = fixStoreSchema({ path, dryRun: false, stamp: '20260926T101600Z' });

    expect(second.status).toBe('current');
    expect(second.backupPath).toBeNull();
    expect(readdirSync(dir)).toHaveLength(2);
  });

  it('refuses a newer store that no longer holds a column this rafa knows, touching nothing', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, [...SQLITE_MIGRATIONS, DROPPED_COLUMN]);
    const before = readFileSync(path);

    expect(() => fixStoreSchema({ path, dryRun: false, stamp: STAMP })).toThrow(SchemaFixRefusal);
    expect(() => fixStoreSchema({ path, dryRun: false, stamp: STAMP })).toThrow(/commits\.row_json/);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dir)).toEqual(['effort.sqlite']);
  });

  it('refuses while a rollback journal sits beside the store, touching nothing', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, NEWER, fillNewer);
    writeFileSync(`${path}-journal`, 'hot');
    const before = readFileSync(path);

    expect(() => fixStoreSchema({ path, dryRun: false, stamp: STAMP })).toThrow(/-journal/);
    expect(readFileSync(path).equals(before)).toBe(true);
  });
});

describe('fixStoreSchema on a store this rafa can already open', () => {
  it('answers missing when there is no store file, creating none', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');

    const result = fixStoreSchema({ path, dryRun: false, stamp: STAMP });

    expect(result.status).toBe('missing');
    expect(result.storeVersion).toBeNull();
    expect(existsSync(path)).toBe(false);
  });

  it('answers current for a store at this version, leaving it byte-identical', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, SQLITE_MIGRATIONS);
    const before = readFileSync(path);

    const result = fixStoreSchema({ path, dryRun: false, stamp: STAMP });

    expect(result.status).toBe('current');
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it('answers behind for an older store, which the next ordinary open migrates, leaving it byte-identical', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    plantStore(path, SQLITE_MIGRATIONS.slice(0, 3));
    const before = readFileSync(path);

    const result = fixStoreSchema({ path, dryRun: false, stamp: STAMP });

    expect(result.status).toBe('behind');
    expect(result.storeVersion).toBe(3);
    expect(readFileSync(path).equals(before)).toBe(true);
  });
});
