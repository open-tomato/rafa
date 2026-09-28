/**
 * Tests for the named migration catalogue (`migrations.ts`): the thirteen
 * legacy ids, the legacy gate as a pre-log release reads it, and the lock
 * that freezes each entry's SQL.
 *
 * The pre-log rule is 0.24.1's own `checkedVersion`, transcribed below.
 * It refuses any `user_version` above 13, the length of that release's
 * history. A control reads the installed 0.24.1 bundle, when there is
 * one, and holds the transcription and the thirteen SQL bodies to it
 * byte for byte. Every store is planted under this file's own temporary
 * directory. A synthetic tail is passed as an argument and never
 * appended to `SQLITE_MIGRATIONS`.
 */
import type { MigrationLock, SqliteMigration } from './migrations.js';

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import {
  LEGACY_GATE_CLOSED,
  LEGACY_GATE_OPEN,
  legacyGate,
  lockMismatches,
  migrationChecksum,
  SQLITE_MIGRATIONS,
} from './migrations.js';
import LOCK_FILE from './migrations.lock.json';

const LOCK: MigrationLock = LOCK_FILE;

/** A temporary directory of this file's own, its real path. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-migrations-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The ids of the history releases 0.23.0 to 0.24.1 shipped, in order. */
const LEGACY_IDS = [
  'kind-tables',
  'findings',
  'blockers-and-bugs',
  'report-absences',
  'task-reports',
  'preflight',
  'dispatches',
  'changes',
  'out-of-scope-bug-scope',
  'dispatch-skills',
  'skill-invocations',
  'task-report-skills',
  'plan-ci',
];

/** The length of 0.24.1's history, and so the `latest` its rule compares with. */
const RELEASED_LATEST = 13;

/**
 * 0.24.1's `checkedVersion` from `sqlite.ts`, transcribed. Its
 * `migrateSchema` calls it with its history's length, and runs nothing
 * when the answer equals that length.
 */
function releasedCheckedVersion(db: Database, path: string, latest: number): number {
  const version = db
    .query<{ user_version: number }, []>('PRAGMA user_version')
    .get()?.user_version ?? 0;
  if (version > latest) {
    throw new Error(
      `effort store: ${path} is at schema version ${version}, past the`
        + ` ${latest} this rafa knows; refusing to read or write it`,
    );
  }
  return version;
}

/** What 0.24.1 answers when it opens the store at `path`. */
function releasedOpen(path: string): number {
  const db = new Database(path, { readwrite: true, create: false });
  try {
    return releasedCheckedVersion(db, path, RELEASED_LATEST);
  } finally {
    db.close();
  }
}

let planted = 0;

/**
 * A store file under the temporary directory holding `migrations`, with
 * `user_version` set to `version`, or to the gate those migrations
 * give. All of it is written in one transaction.
 */
function plantStore(migrations: readonly SqliteMigration[], version = legacyGate(migrations)): string {
  planted += 1;
  const path = join(tempBase, `store-${String(planted)}.sqlite`);
  const db = new Database(path, { readwrite: true, create: true });
  try {
    db.transaction(() => {
      for (const { sql } of migrations) db.run(sql);
      db.run(`PRAGMA user_version = ${String(version)}`);
    }).immediate();
  } finally {
    db.close();
  }
  return path;
}

/** The names of the tables the store at `path` holds. */
function tablesAt(path: string): string[] {
  const db = new Database(path, { readonly: true });
  try {
    return db
      .query<{ name: string }, []>('SELECT name FROM sqlite_master WHERE type = \'table\' ORDER BY name')
      .all()
      .map(({ name }) => name);
  } finally {
    db.close();
  }
}

/** A synthetic additive tail: a nullable column on a legacy table and a new table. */
const ADDITIVE_TAIL: readonly SqliteMigration[] = [
  { id: 'synthetic-session-note', breaks: [], sql: 'ALTER TABLE sessions ADD COLUMN note TEXT;' },
  {
    id: 'synthetic-readings',
    breaks: [],
    sql: 'CREATE TABLE synthetic_readings (seq INTEGER PRIMARY KEY, name TEXT CHECK (name <> \'\'));',
  },
];

/** A synthetic breaking entry: it drops a column 0.24.1 writes. */
const BREAKING_ENTRY: SqliteMigration = {
  id: 'synthetic-drop-bug-scope',
  breaks: ['readers', 'writers'],
  contract: { expand: null, why: 'a fixture: a column older runtimes write goes away' },
  sql: 'ALTER TABLE out_of_scope_bugs DROP COLUMN scope;',
};

/** The legacy entries, the base every synthetic tail here is appended to. */
const LEGACY = SQLITE_MIGRATIONS.slice(0, RELEASED_LATEST);

describe('the named history', () => {
  it('opens with the thirteen legacy ids in order, each additive with no contract', () => {
    expect(LEGACY.map(({ id }) => id)).toEqual(LEGACY_IDS);
    for (const migration of LEGACY) {
      expect(migration.breaks).toEqual([]);
      expect(migration.contract).toBeUndefined();
    }
  });

  it('pins the gate constants: open at the legacy length, closed at 1000', () => {
    expect(LEGACY_GATE_OPEN).toBe(13);
    expect(LEGACY_GATE_OPEN).toBe(LEGACY_IDS.length);
    expect(LEGACY_GATE_CLOSED).toBe(1000);
  });

  it('gives the thirteen alone the open gate', () => {
    expect(legacyGate(LEGACY)).toBe(LEGACY_GATE_OPEN);
  });
});

describe('legacyGate', () => {
  it('stays open for no migration at all', () => {
    expect(legacyGate([])).toBe(LEGACY_GATE_OPEN);
  });

  it('closes on a break on either side alone', () => {
    expect(legacyGate([{ breaks: [] }, { breaks: ['writers'] }])).toBe(LEGACY_GATE_CLOSED);
    expect(legacyGate([{ breaks: ['readers'] }, { breaks: [] }])).toBe(LEGACY_GATE_CLOSED);
  });

  it('closes on a word this rafa does not know', () => {
    expect(legacyGate([{ breaks: ['everything'] }])).toBe(LEGACY_GATE_CLOSED);
  });
});

describe('the legacy gate under 0.24.1\'s rule', () => {
  it('leaves the gate at 13 after a synthetic additive tail, and 0.24.1 accepts the store', () => {
    const history = [...LEGACY, ...ADDITIVE_TAIL];
    const path = plantStore(history);

    expect(legacyGate(history)).toBe(LEGACY_GATE_OPEN);
    expect(tablesAt(path)).toContain('synthetic_readings');
    expect(releasedOpen(path)).toBe(RELEASED_LATEST);
  });

  it('closes the gate at 1000 after a synthetic breaking entry, and 0.24.1 refuses the store', () => {
    const history = [...LEGACY, ...ADDITIVE_TAIL, BREAKING_ENTRY];
    const path = plantStore(history);

    expect(legacyGate(history)).toBe(LEGACY_GATE_CLOSED);
    expect(() => releasedOpen(path)).toThrow(
      `effort store: ${path} is at schema version 1000, past the 13 this rafa knows;`
        + ' refusing to read or write it',
    );
  });

  it('refuses the same additive store once its version is counted by length (control)', () => {
    const history = [...LEGACY, ...ADDITIVE_TAIL];
    const path = plantStore(history, history.length);

    expect(() => releasedOpen(path))
      .toThrow(`is at schema version ${String(history.length)}, past the 13 this rafa knows`);
  });
});

/** The installed 0.24.1 runtime, read when present and never run. */
const INSTALLED_CLI = join(homedir(), '.rafa', 'runtime', '0.24.1', 'cli.js');

/** The two functions of 0.24.1's `sqlite.ts` the rule is, as its bundle prints them. */
const INSTALLED_RULE = [
  'function checkedVersion(db, path, latest) {',
  '  const version = userVersion(db);',
  '  if (version > latest) {',
  '    throw new Error(`effort store: ${path} is at schema version ${version}, past the`'
    + ' + ` ${latest} this rafa knows; refusing to read or write it`);',
  '  }',
  '  return version;',
  '}',
  'function migrateSchema(db, path, migrations = SQLITE_MIGRATIONS) {',
  '  const latest = migrations.length;',
  '  if (checkedVersion(db, path, latest) === latest)',
  '    return;',
].join('\n');

describe('the installed 0.24.1 runtime', () => {
  it.skipIf(!existsSync(INSTALLED_CLI))('holds the rule the transcription copies', () => {
    expect(readFileSync(INSTALLED_CLI, 'utf8')).toContain(INSTALLED_RULE);
  });

  it.skipIf(!existsSync(INSTALLED_CLI))('holds exactly these thirteen SQL bodies as its history', () => {
    const bodies = LEGACY.map(({ sql }) => `    \`${sql}\``).join(',\n');
    const history = `  SQLITE_MIGRATIONS = [\n${bodies}\n  ];\n  SQLITE_SCHEMA_VERSION = SQLITE_MIGRATIONS.length;`;

    expect(readFileSync(INSTALLED_CLI, 'utf8')).toContain(history);
  });
});

describe('the lock', () => {
  it('holds every entry\'s checksum by id, and nothing else', () => {
    expect(lockMismatches(SQLITE_MIGRATIONS, LOCK)).toEqual([]);
    expect(Object.keys(LOCK)).toEqual(SQLITE_MIGRATIONS.map(({ id }) => id));
  });

  it('fails an entry whose SQL was edited, by a trailing space alone', () => {
    const at = SQLITE_MIGRATIONS.findIndex(({ id }) => id === 'plan-ci');
    const planCi = SQLITE_MIGRATIONS[at];
    if (planCi === undefined) throw new Error('the history lost plan-ci');
    const edited = { ...planCi, sql: `${planCi.sql} ` };
    const history = SQLITE_MIGRATIONS.map((migration, index) => (
      index === at
        ? edited
        : migration
    ));

    expect(lockMismatches(history, LOCK)).toEqual([{
      kind: 'edited',
      id: 'plan-ci',
      locked: LOCK['plan-ci'] ?? '',
      computed: migrationChecksum(edited),
    }]);
  });

  it('names an entry with no lock line, then a lock line with no entry', () => {
    const history = [...SQLITE_MIGRATIONS.slice(1), ...ADDITIVE_TAIL.slice(0, 1)];
    const [note] = ADDITIVE_TAIL;
    if (note === undefined) throw new Error('the tail is empty');

    expect(lockMismatches(history, LOCK)).toEqual([
      { kind: 'unlocked', id: 'synthetic-session-note', computed: migrationChecksum(note) },
      { kind: 'missing', id: 'kind-tables', locked: LOCK['kind-tables'] ?? '' },
    ]);
  });

  it('does not read a lock line off the object prototype', () => {
    const history: SqliteMigration[] = [{ id: 'constructor', breaks: [], sql: 'SELECT 1' }];

    expect(lockMismatches(history, {})).toEqual([
      { kind: 'unlocked', id: 'constructor', computed: migrationChecksum(history[0] ?? { sql: '' }) },
    ]);
  });
});

describe('migrationChecksum', () => {
  it('is the lowercase sha256 hex of the SQL\'s UTF-8 bytes', () => {
    expect(migrationChecksum({ sql: '' }))
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(migrationChecksum({ sql: 'abc' }))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(migrationChecksum({ sql: 'é' }))
      .toBe(new Bun.CryptoHasher('sha256').update(new Uint8Array([0xc3, 0xa9]))
        .digest('hex'));
  });
});
