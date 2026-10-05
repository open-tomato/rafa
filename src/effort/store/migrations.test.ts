/**
 * Tests for the named migration catalogue (`migrations.ts`): the thirteen
 * legacy ids, the legacy gate as a pre-log release reads it, the lock
 * that freezes each entry's SQL, and the guards every entry has to pass
 * (ids, contracts, the shapes `migration-shapes.ts` reads, the objects
 * each entry creates, and the lock at the last release pinned here).
 *
 * The pre-log rule is 0.24.1's own `checkedVersion`, transcribed below.
 * It refuses any `user_version` above 13, the length of that release's
 * history. A control reads an excerpt of the 0.24.1 bundle committed
 * under `src/effort/testdata/migrations/`, and holds the transcription
 * and the thirteen SQL bodies to it byte for byte. Every store is
 * planted under this file's own temporary directory. A synthetic tail is
 * passed as an argument and never appended to `SQLITE_MIGRATIONS`.
 *
 * Each guard is a function here run once over the catalogue and once
 * over a near miss that has to fail it, so a green reading cannot come
 * from a guard that never looks. The released lock is a copy of
 * `migrations.lock.json` at `v0.33.0`, committed beside the excerpt, so
 * neither case reads the machine it runs on. A provenance case holds the
 * copy to `git show` at that tag when this checkout has it, and is
 * skipped, its title saying why, when git, the tag or the lock at the
 * tag is absent. A repository planted under the temporary directory
 * drives the same reader through each of those answers.
 *
 * `store-meta-generation` is held to a store `bringForward` left at the
 * `store-meta` entry with its row written: the next open adds the
 * column, leaves the row's generation NULL and every other column as it
 * was, and a control shows the column's CHECK refuses an empty value.
 * `session-worktree` is held to a store an older runtime left in
 * `session-worktree.test.ts`, beside the backend that fills its column.
 */
import type { CreatedObject, ShapeProblem } from './migration-shapes.js';
import type { MigrationBreak, MigrationLock, MigrationSpec, SqliteMigration } from './migrations.js';

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { gitIdentityEnv } from '../../tests/git-identity.js';

import { bringForward } from './bring-forward.js';
import { classifyMigration } from './migration-shapes.js';
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

/** Where this file's committed inputs sit. */
const TESTDATA = join(import.meta.dir, '..', 'testdata', 'migrations');

/**
 * The 0.24.1 bundle's `cli.js` from its `migrations.ts` module through
 * `sqlite.ts`'s `migrateSchema`, cut byte for byte from an installed
 * runtime (lines 5811 to 6061), so no case reads `~/.rafa`.
 */
const RUNTIME_EXCERPT = readFileSync(join(TESTDATA, 'runtime-0.24.1-cli-excerpt.txt'), 'utf8');

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

/** 0.24.1's history as its bundle prints it, from the bodies given. */
function printedHistory(bodies: readonly string[]): string {
  const printed = bodies.map((sql) => `    \`${sql}\``).join(',\n');
  return `  SQLITE_MIGRATIONS = [\n${printed}\n  ];\n  SQLITE_SCHEMA_VERSION = SQLITE_MIGRATIONS.length;`;
}

describe('the 0.24.1 runtime, as its committed bundle excerpt', () => {
  it('holds the rule the transcription copies, and not a near miss of it', () => {
    expect(RUNTIME_EXCERPT).toContain(INSTALLED_RULE);
    expect(RUNTIME_EXCERPT).not.toContain(INSTALLED_RULE.replace('version > latest', 'version >= latest'));
  });

  it('holds exactly these thirteen SQL bodies as its history, and not twelve of them', () => {
    const bodies = LEGACY.map(({ sql }) => sql);

    expect(RUNTIME_EXCERPT).toContain(printedHistory(bodies));
    expect(RUNTIME_EXCERPT).not.toContain(printedHistory(bodies.slice(0, -1)));
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

/** An id of lowercase words and digits joined by single hyphens. */
const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Every id that is not kebab-case, then every id a second entry reuses. */
function idProblems(migrations: readonly Pick<MigrationSpec, 'id'>[]): string[] {
  const ids = migrations.map(({ id }) => id);
  const malformed = ids.filter((id) => !KEBAB_CASE.test(id)).map((id) => `not kebab-case: ${id}`);
  const reused = ids.filter((id, index) => ids.indexOf(id) !== index).map((id) => `reused: ${id}`);
  return [...malformed, ...reused];
}

/** Every entry whose `contract` is present when `breaks` is empty, or absent when it is not. */
function contractProblems(migrations: readonly MigrationSpec[]): string[] {
  return migrations.flatMap(({ id, breaks, contract }) => {
    if (breaks.length > 0 && contract === undefined) return [`breaks with no contract: ${id}`];
    return breaks.length === 0 && contract !== undefined
      ? [`contract with no breaks: ${id}`]
      : [];
  });
}

/** A synthetic entry with a contract exactly when it declares a break. */
function synthetic(sql: string, breaks: readonly MigrationBreak[] = []): SqliteMigration {
  const contract = { expand: null, why: 'a fixture' };
  return breaks.length > 0
    ? { id: 'synthetic', breaks, contract, sql }
    : { id: 'synthetic', breaks, sql };
}

describe('the ids', () => {
  it('are kebab-case and each used once', () => {
    expect(idProblems(SQLITE_MIGRATIONS)).toEqual([]);
  });

  it('refuses a near-miss spelling and an id used twice (control)', () => {
    const near = ['Kind-tables', 'kind_tables', 'kind--tables', '-kind', 'kind-', '9-kinds', 'kind tables'];

    expect(idProblems(near.map((id) => ({ id })))).toEqual(near.map((id) => `not kebab-case: ${id}`));
    expect(idProblems([...SQLITE_MIGRATIONS, { id: 'findings' }])).toEqual(['reused: findings']);
    expect(idProblems([{ id: 'plan-ci-2' }, { id: 'v2' }])).toEqual([]);
  });
});

describe('the contract', () => {
  it('is present exactly when an entry declares a break', () => {
    expect(contractProblems(SQLITE_MIGRATIONS)).toEqual([]);
  });

  it('refuses a break with no contract and a contract with no break (control)', () => {
    const contract = { expand: null, why: 'a fixture' };

    expect(contractProblems([
      { id: 'bare-break', breaks: ['writers'] },
      { id: 'idle-contract', breaks: [], contract },
      { id: 'kept', breaks: ['readers'], contract },
    ])).toEqual(['breaks with no contract: bare-break', 'contract with no breaks: idle-contract']);
  });
});

/**
 * The tables `row-origins` gives an origin pair and its partial unique
 * index: every table the thirteen legacy entries create.
 */
const ORIGIN_TABLE_COUNT = 12;

/** The shape of each statement of each shipped entry, in order. */
const SHIPPED_SHAPES: Readonly<Record<string, readonly string[]>> = {
  'kind-tables': ['create-table', 'create-table'],
  findings: ['create-table', 'create-unique-index-on-new-table', 'create-unique-index-on-new-table'],
  'blockers-and-bugs': [
    'create-table',
    'create-unique-index-on-new-table',
    'create-table',
    'create-unique-index-on-new-table',
  ],
  'report-absences': ['create-table'],
  'task-reports': ['create-table'],
  preflight: ['create-table'],
  dispatches: ['create-table'],
  changes: ['create-table', 'create-unique-index-on-new-table'],
  'out-of-scope-bug-scope': ['add-column'],
  'dispatch-skills': ['add-column', 'add-column', 'add-column'],
  'skill-invocations': ['create-table', 'create-unique-index-on-new-table'],
  'task-report-skills': ['add-column'],
  'plan-ci': ['create-table'],
  'row-origins': Array.from(
    { length: ORIGIN_TABLE_COUNT },
    () => ['add-column', 'add-column', 'create-unique-index-on-new-column'],
  ).flat(),
  'store-meta': ['create-table', 'create-table', 'create-table'],
  'store-meta-generation': ['add-column'],
  'session-worktree': ['add-column'],
};

describe('classifyMigration over the catalogue', () => {
  it('finds every entry to be what it declares, never breaking more than its `breaks`', () => {
    expect(SQLITE_MIGRATIONS.map(({ id, ...migration }) => ({ id, problems: classifyMigration(migration).problems })))
      .toEqual(SQLITE_MIGRATIONS.map(({ id }) => ({ id, problems: [] })));
  });

  it('reads each shipped statement as its row of the additive table', () => {
    const shapes = Object.fromEntries(SQLITE_MIGRATIONS.map((migration) => [
      migration.id,
      classifyMigration(migration).statements.map(({ shape }) => shape),
    ]));

    expect(shapes).toEqual(SHIPPED_SHAPES);
  });
});

/** A breaking rebuild of `plan_ci`: a new table, its rows copied, the old one swapped out. */
const REBUILD_SQL = `
  CREATE TABLE plan_ci_rebuilt (seq INTEGER PRIMARY KEY, plan_stub TEXT NOT NULL CHECK (plan_stub <> ''));
  INSERT INTO plan_ci_rebuilt (seq, plan_stub) SELECT seq, plan_stub FROM plan_ci;
  DROP TABLE plan_ci;
  ALTER TABLE plan_ci_rebuilt RENAME TO plan_ci;
`;

/** A near miss: SQL, what it declares, and every problem the classifier must report. */
interface NearMiss {
  readonly title: string;
  readonly sql: string;
  readonly breaks?: readonly MigrationBreak[];
  readonly problems: readonly ShapeProblem[];
}

const UNDER_BOTH: ShapeProblem = { kind: 'under-declared', missing: ['readers', 'writers'] };
const UNDER_WRITERS: ShapeProblem = { kind: 'under-declared', missing: ['writers'] };

const NEAR_MISSES: readonly NearMiss[] = [
  {
    title: 'a planted DROP COLUMN declared [] fails',
    sql: 'ALTER TABLE out_of_scope_bugs DROP COLUMN scope;',
    problems: [UNDER_BOTH],
  },
  {
    title: 'the same DROP COLUMN declared readers alone still misses writers',
    sql: 'ALTER TABLE out_of_scope_bugs DROP COLUMN scope;',
    breaks: ['readers'],
    problems: [UNDER_WRITERS],
  },
  {
    title: 'the same DROP COLUMN declared on both sides passes',
    sql: 'ALTER TABLE out_of_scope_bugs DROP COLUMN scope;',
    breaks: ['readers', 'writers'],
    problems: [],
  },
  {
    title: 'a DROP COLUMN behind a comment and a string holding a semicolon still counts',
    sql: '-- only a note\nALTER TABLE sessions ADD COLUMN note TEXT CHECK (note <> \';--\'); /* x */ ALTER TABLE sessions DROP note;',
    problems: [UNDER_BOTH],
  },
  {
    title: 'a DROP TABLE inside a line comment and a block comment is no statement',
    sql: '-- DROP TABLE sessions;\n/* DROP TABLE commits; */ ALTER TABLE sessions ADD COLUMN note TEXT;',
    problems: [],
  },
  {
    title: 'a renamed table breaks both sides',
    sql: 'ALTER TABLE plan_ci RENAME TO pr_checks;',
    problems: [UNDER_BOTH],
  },
  {
    title: 'a renamed column breaks both sides',
    sql: 'ALTER TABLE sessions RENAME COLUMN row_json TO body;',
    problems: [UNDER_BOTH],
  },
  {
    title: 'a dropped table breaks both sides',
    sql: 'DROP TABLE IF EXISTS plan_ci;',
    problems: [UNDER_BOTH],
  },
  {
    title: 'a NOT NULL column is refused in an additive entry',
    sql: 'ALTER TABLE sessions ADD COLUMN note TEXT NOT NULL DEFAULT \'\';',
    problems: [{ kind: 'not-null-column', statement: 'ALTER TABLE sessions ADD COLUMN note TEXT NOT NULL DEFAULT \'\'' }],
  },
  {
    title: 'a nullable column whose CHECK says NOT NULL inside it is additive',
    sql: 'ALTER TABLE sessions ADD COLUMN note TEXT CHECK (note IS NULL OR note IS NOT NULL);',
    problems: [],
  },
  {
    title: 'a nullable column with a non-NULL DEFAULT is refused, and DEFAULT NULL is not',
    sql: 'ALTER TABLE sessions ADD COLUMN note TEXT DEFAULT \'none\'; ALTER TABLE commits ADD COLUMN note TEXT DEFAULT NULL;',
    problems: [{ kind: 'default-column', statement: 'ALTER TABLE sessions ADD COLUMN note TEXT DEFAULT \'none\'' }],
  },
  {
    title: 'a PRAGMA is refused in an additive entry',
    sql: 'PRAGMA user_version = 14;',
    problems: [{ kind: 'pragma', statement: 'PRAGMA user_version = 14' }],
  },
  {
    title: 'a backfill is refused in an additive entry',
    sql: 'ALTER TABLE sessions ADD COLUMN note TEXT; UPDATE sessions SET note = \'x\';',
    problems: [{ kind: 'data', statement: 'UPDATE sessions SET note = \'x\'' }],
  },
  {
    title: 'a table rebuild with its INSERT … SELECT passes when it declares both sides',
    sql: REBUILD_SQL,
    breaks: ['readers', 'writers'],
    problems: [],
  },
  {
    title: 'the same rebuild declared [] fails on its break and on its data statement',
    sql: REBUILD_SQL,
    problems: [
      UNDER_BOTH,
      {
        kind: 'data',
        statement: 'INSERT INTO plan_ci_rebuilt ( seq , plan_stub ) SELECT seq , plan_stub FROM plan_ci',
      },
    ],
  },
  {
    title: 'a shape matching no row is refused, and counted as breaking both sides',
    sql: 'CREATE VIRTUAL TABLE session_text USING fts5(body);',
    problems: [UNDER_BOTH, { kind: 'unknown-shape', statement: 'CREATE VIRTUAL TABLE session_text USING fts5 ( body )' }],
  },
  {
    title: 'a unique index on a table an earlier entry created breaks writers',
    sql: 'CREATE UNIQUE INDEX plan_ci_by_head ON plan_ci (pr, head_sha);',
    problems: [UNDER_WRITERS],
  },
  {
    title: 'a plain index on the same table is additive',
    sql: 'CREATE INDEX IF NOT EXISTS plan_ci_by_head ON plan_ci (pr, head_sha);',
    problems: [],
  },
  {
    title: 'a unique index on a table the same entry creates is additive',
    sql: 'CREATE TABLE readings (seq INTEGER PRIMARY KEY, name TEXT); CREATE UNIQUE INDEX readings_by_name ON readings (name);',
    problems: [],
  },
  {
    title: 'a partial unique index over a column the same entry adds is additive',
    sql: 'ALTER TABLE sessions ADD COLUMN origin TEXT; CREATE UNIQUE INDEX sessions_by_origin ON sessions (session_id, origin) WHERE origin IS NOT NULL;',
    problems: [],
  },
  {
    title: 'the same index guarded by IS NULL breaks writers',
    sql: 'ALTER TABLE sessions ADD COLUMN origin TEXT; CREATE UNIQUE INDEX sessions_by_origin ON sessions (session_id, origin) WHERE origin IS NULL;',
    problems: [UNDER_WRITERS],
  },
  {
    title: 'the same index whose guard is the right side of an OR breaks writers',
    sql: 'ALTER TABLE sessions ADD COLUMN origin TEXT; CREATE UNIQUE INDEX sessions_by_origin ON sessions (session_id, origin) WHERE seq < 0 OR seq > 0 AND origin IS NOT NULL;',
    problems: [UNDER_WRITERS],
  },
  {
    title: 'the same index whose guard closes a BETWEEN breaks writers',
    sql: 'ALTER TABLE sessions ADD COLUMN origin TEXT; CREATE UNIQUE INDEX sessions_by_origin ON sessions (session_id, origin) WHERE seq BETWEEN 0 AND origin IS NOT NULL;',
    problems: [UNDER_WRITERS],
  },
  {
    title: 'the same index over a column an earlier entry added breaks writers',
    sql: 'CREATE UNIQUE INDEX bugs_by_scope ON out_of_scope_bugs (session_id, scope) WHERE scope IS NOT NULL;',
    problems: [UNDER_WRITERS],
  },
  {
    title: 'a dropped index breaks writers',
    sql: 'DROP INDEX changes_by_entry;',
    problems: [UNDER_WRITERS],
  },
  {
    title: 'a trigger breaks writers, its body read as one statement',
    sql: 'CREATE TRIGGER sessions_stamp AFTER INSERT ON sessions BEGIN UPDATE sessions SET row_json = CASE WHEN 1 THEN row_json END; END;',
    problems: [UNDER_WRITERS],
  },
];

describe('classifyMigration near misses', () => {
  for (const { title, sql, breaks = [], problems } of NEAR_MISSES) {
    it(title, () => {
      expect(classifyMigration(synthetic(sql, breaks)).problems).toEqual(problems);
    });
  }

  it('reads the trigger and the table after it as two statements', () => {
    const sql = 'CREATE TRIGGER t AFTER INSERT ON sessions BEGIN SELECT \'a;b\'; SELECT 1; END; CREATE TABLE after_trigger (a TEXT);';

    expect(classifyMigration(synthetic(sql, ['writers'])).statements.map(({ shape }) => shape))
      .toEqual(['create-trigger', 'create-table']);
  });
});

/** Each object `creates` names that `sqlite_master` does not hold. */
function absentCreates(db: Database, creates: readonly CreatedObject[]): CreatedObject[] {
  const holds = db.query<{ found: number }, [string, string]>(
    'SELECT 1 AS found FROM sqlite_master WHERE type = ? AND name = ?',
  );
  return creates.filter(({ type, name }) => holds.get(type, name) === null);
}

/**
 * The objects `tail` creates that are absent from `sqlite_master` once
 * each runs, in order, on a `:memory:` store holding the thirteen.
 */
function absentAfterTail(tail: readonly SqliteMigration[]): CreatedObject[] {
  const db = new Database(':memory:');
  try {
    for (const { sql } of LEGACY) db.run(sql);
    return tail.flatMap((migration) => {
      db.run(migration.sql);
      return absentCreates(db, classifyMigration(migration).creates);
    });
  } finally {
    db.close();
  }
}

describe('every CREATEd object after applying to :memory:', () => {
  it('is in sqlite_master once its entry has run', () => {
    const db = new Database(':memory:');
    try {
      const absent = SQLITE_MIGRATIONS.map((migration) => {
        db.run(migration.sql);
        return { id: migration.id, absent: absentCreates(db, classifyMigration(migration).creates) };
      });

      expect(absent).toEqual(SQLITE_MIGRATIONS.map(({ id }) => ({ id, absent: [] })));
    } finally {
      db.close();
    }
  });

  it('names every table and index sqlite_master ends up with (control: the scan reads)', () => {
    const db = new Database(':memory:');
    try {
      for (const { sql } of SQLITE_MIGRATIONS) db.run(sql);
      const held = db
        .query<{ type: string; name: string }, []>(
          'SELECT type, name FROM sqlite_master WHERE name NOT LIKE \'sqlite_autoindex_%\' ORDER BY type, name',
        )
        .all()
        .map(({ type, name }) => `${type}:${name}`);
      const named = SQLITE_MIGRATIONS
        .flatMap((migration) => classifyMigration(migration).creates)
        .map(({ type, name }) => `${type}:${name}`);

      expect([...named].sort()).toEqual(held);
    } finally {
      db.close();
    }
  });

  it('fails a CREATE a line comment swallowed, which the classifier alone passes', () => {
    const swallowed = synthetic(
      'ALTER TABLE sessions ADD COLUMN note TEXT; -- a note CREATE TABLE synthetic_notes (seq INTEGER PRIMARY KEY);',
    );

    expect(classifyMigration(swallowed).problems).toEqual([]);
    expect(absentAfterTail([swallowed])).toEqual([{ type: 'table', name: 'synthetic_notes' }]);
  });

  it('fails a TEMP table, which sqlite_master never holds', () => {
    expect(absentAfterTail([synthetic('CREATE TEMP TABLE synthetic_scratch (a TEXT);')]))
      .toEqual([{ type: 'table', name: 'synthetic_scratch' }]);
  });

  it('leaves out an object the same entry creates and drops', () => {
    const scratch = synthetic('CREATE TABLE synthetic_scratch (a TEXT); CREATE INDEX synthetic_by_a ON synthetic_scratch (a); DROP INDEX synthetic_by_a; DROP TABLE synthetic_scratch;');

    expect(classifyMigration(scratch).creates).toEqual([]);
    expect(absentAfterTail([scratch])).toEqual([]);
  });

  it('passes a rebuild, reading its renamed table under the new name', () => {
    const rebuild = synthetic(REBUILD_SQL, ['readers', 'writers']);

    expect(classifyMigration(rebuild).creates).toEqual([{ type: 'table', name: 'plan_ci' }]);
    expect(absentAfterTail([rebuild])).toEqual([]);
  });
});

/** Where the lock sits in a checkout, as `git show` spells it. */
const LOCK_PATH = 'src/effort/store/migrations.lock.json';

/** This checkout's root. */
const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

/** The release whose lock is committed under `TESTDATA`. */
const RELEASED_TAG = 'v0.33.0';

/** `migrations.lock.json` at `RELEASED_TAG`, as committed under `TESTDATA`. */
const RELEASED_LOCK_TEXT = readFileSync(join(TESTDATA, `lock-${RELEASED_TAG}.json`), 'utf8');

/** What `readLockAtTag` found: the lock's text at the tag, or why there is none. */
type TaggedLock =
  | { readonly found: true; readonly text: string }
  | { readonly found: false; readonly why: string };

/** This process's environment without a `GIT_*` variable that could point git elsewhere. */
const GIT_ENV: Record<string, string> = {
  ...Object.fromEntries(Object.entries(process.env).filter(
    (entry): entry is [string, string] => !entry[0].startsWith('GIT_') && entry[1] !== undefined,
  )),
  GIT_CONFIG_GLOBAL: '/dev/null',
  ...gitIdentityEnv(),
  GIT_CONFIG_NOSYSTEM: '1',
};

/** `git` run in `cwd`, or null when the binary is absent. */
function runGit(git: string, cwd: string, args: readonly string[]): { ok: boolean; stdout: string } | null {
  try {
    const result = Bun.spawnSync([git, ...args], { cwd, env: GIT_ENV, stdout: 'pipe', stderr: 'pipe' });
    return { ok: result.exitCode === 0, stdout: result.stdout.toString() };
  } catch {
    return null;
  }
}

/** The lock's text at `tag` in the repository at `repo`, through `git show`. */
function readLockAtTag(repo: string, tag: string, git = 'git'): TaggedLock {
  const tags = runGit(git, repo, ['tag', '--list', tag]);
  if (tags === null) return { found: false, why: 'git is absent' };
  if (!tags.ok) return { found: false, why: 'not a git checkout' };
  if (tags.stdout.trim() !== tag) return { found: false, why: `no tag ${tag}` };
  const shown = runGit(git, repo, ['show', `${tag}:${LOCK_PATH}`]);
  if (shown?.ok !== true) return { found: false, why: `${tag} holds no ${LOCK_PATH}` };
  return { found: true, text: shown.stdout };
}

/** Each line of the released lock the current lock changed or dropped. */
function lockDrift(released: MigrationLock, current: MigrationLock): string[] {
  return Object.entries(released).flatMap(([id, locked]) => {
    if (!Object.hasOwn(current, id)) return [`missing since the release: ${id}`];
    return current[id] === locked
      ? []
      : [`changed since the release: ${id}`];
  });
}

const TAGGED = readLockAtTag(REPO_ROOT, RELEASED_TAG);

/** A git repository under the temporary directory, its lock committed and tagged at each version. */
function plantRepository(name: string, releases: readonly (readonly [string, MigrationLock | null])[]): string {
  const repo = join(tempBase, name);
  mkdirSync(repo, { recursive: true });
  const git = (...args: string[]): void => {
    const result = runGit('git', repo, ['-c', 'user.name=rafa', '-c', 'user.email=rafa@example.invalid', '-c', 'commit.gpgsign=false', ...args]);
    if (result?.ok !== true) throw new Error(`git ${args.join(' ')} failed in ${repo}`);
  };
  git('init', '-q');
  for (const [tag, lock] of releases) {
    const file = lock === null
      ? 'README'
      : LOCK_PATH;
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), JSON.stringify(lock ?? tag));
    git('add', '-A');
    git('commit', '-q', '-m', tag);
    git('tag', tag);
  }
  return repo;
}

const GIT_PRESENT = runGit('git', tempBase, ['--version'])?.ok === true;

describe('the lock at the last release pinned here', () => {
  it(`keeps every line of the lock at ${RELEASED_TAG}`, () => {
    expect(lockDrift(JSON.parse(RELEASED_LOCK_TEXT) as MigrationLock, LOCK)).toEqual([]);
  });

  it.skipIf(!TAGGED.found)(
    TAGGED.found
      ? `holds the committed copy to the lock at ${RELEASED_TAG}, byte for byte`
      : `is skipped: ${TAGGED.why}`,
    () => {
      if (!TAGGED.found) throw new Error(`ran with no lock at ${RELEASED_TAG}`);

      expect(RELEASED_LOCK_TEXT).toBe(TAGGED.text);
    },
  );

  it('names a line changed and a line dropped since the release, and not one added (control)', () => {
    const released = { 'kind-tables': LOCK['kind-tables'] ?? '', findings: LOCK.findings ?? '' };
    const current = { 'kind-tables': migrationChecksum({ sql: 'edited' }), 'plan-ci': LOCK['plan-ci'] ?? '' };

    expect(lockDrift(released, current)).toEqual([
      'changed since the release: kind-tables',
      'missing since the release: findings',
    ]);
    expect(lockDrift(released, { ...released, 'plan-ci': 'added' })).toEqual([]);
  });

  it.skipIf(!GIT_PRESENT)('reads the lock at the named tag, not the newest one, through git show', () => {
    const older = { 'kind-tables': 'a' };
    const newer = { 'kind-tables': 'b', findings: 'c' };
    const repo = plantRepository('released', [['v0.9.0', older], ['v0.10.0', newer]]);

    expect(readLockAtTag(repo, 'v0.9.0')).toEqual({ found: true, text: JSON.stringify(older) });
    expect(readLockAtTag(repo, 'v0.10.0')).toEqual({ found: true, text: JSON.stringify(newer) });
    expect(lockDrift(newer, older)).toEqual(['changed since the release: kind-tables', 'missing since the release: findings']);
  });

  it.skipIf(!GIT_PRESENT)('says why it skips: no git, no checkout, no tag, no lock at the tag', () => {
    const untagged = plantRepository('untagged', []);
    const lockless = plantRepository('lockless', [['v0.1.0', null]]);
    const bare = join(tempBase, 'not-a-checkout');
    mkdirSync(bare);

    expect(readLockAtTag(untagged, 'v0.1.0', 'rafa-no-such-git')).toEqual({ found: false, why: 'git is absent' });
    expect(readLockAtTag(bare, 'v0.1.0')).toEqual({ found: false, why: 'not a git checkout' });
    expect(readLockAtTag(untagged, 'v0.1.0')).toEqual({ found: false, why: 'no tag v0.1.0' });
    expect(readLockAtTag(lockless, 'v0.1.0')).toEqual({ found: false, why: `v0.1.0 holds no ${LOCK_PATH}` });
  });
});

/** The index of `store-meta` in the catalogue, the entry the generation column follows. */
const STORE_META_INDEX = SQLITE_MIGRATIONS.findIndex(({ id }) => id === 'store-meta');

/**
 * A `store_meta` row as a runtime before `store-meta-generation` writes
 * it. The inode is negative, the two's complement of one past 2^63, so
 * a column rewritten through a JavaScript number would show here.
 */
const STORE_META_ROW = {
  id: 1,
  store_id: '0c0ffee0-0000-4000-8000-000000000001',
  project_root_commit: 'a'.repeat(40),
  project_remote: 'git@github.com:open-tomato/rafa.git',
  host_id: 'b'.repeat(64),
  store_path: '/home/someone/project/.rafa/effort/effort.sqlite',
  file_dev: 66311,
  file_ino: -9223372036854775807n,
  minted_at: '2026-09-30T08:00:00.000Z',
};

/** The columns `store-meta` creates, the ones a later column must leave alone. */
const STORE_META_COLUMNS = Object.keys(STORE_META_ROW);

/** The `store_meta` row at `path`, read column by column with the inode as text. */
function storeMetaRowAt(path: string, columns: readonly string[]): Record<string, unknown> | null {
  const db = new Database(path, { readonly: true, safeIntegers: true });
  try {
    return db
      .query<Record<string, unknown>, []>(`SELECT ${columns.join(', ')} FROM store_meta WHERE id = 1`)
      .get();
  } finally {
    db.close();
  }
}

/** A store file `bringForward` brought to `store-meta`, holding {@link STORE_META_ROW}. */
function plantStoreMetaStore(): string {
  planted += 1;
  const path = join(tempBase, `store-${String(planted)}.sqlite`);
  const db = new Database(path, { readwrite: true, create: true });
  try {
    bringForward(db, path, 'write', 'open', { migrations: SQLITE_MIGRATIONS.slice(0, STORE_META_INDEX + 1) });
    db.query(`INSERT INTO store_meta (${STORE_META_COLUMNS.join(', ')})`
      + ` VALUES (${STORE_META_COLUMNS.map(() => '?').join(', ')})`)
      .run(...Object.values(STORE_META_ROW));
  } finally {
    db.close();
  }
  return path;
}

describe('store-meta-generation over a store at store-meta', () => {
  it('is the entry right after store-meta, additive, adding one column', () => {
    expect(SQLITE_MIGRATIONS[STORE_META_INDEX + 1]?.id).toBe('store-meta-generation');
    expect(SQLITE_MIGRATIONS[STORE_META_INDEX + 1]?.breaks).toEqual([]);
  });

  it('brings the store forward with the row\'s generation NULL and every other column unchanged', () => {
    const path = plantStoreMetaStore();
    const before = storeMetaRowAt(path, STORE_META_COLUMNS);

    const db = new Database(path, { readwrite: true });
    const result = (() => {
      try {
        return bringForward(db, path, 'write', 'open');
      } finally {
        db.close();
      }
    })();

    expect(result.applied).toEqual(SQLITE_MIGRATIONS.slice(STORE_META_INDEX + 1).map(({ id }) => id));
    expect(storeMetaRowAt(path, STORE_META_COLUMNS)).toEqual(before);
    expect(before).toEqual({ ...STORE_META_ROW, id: 1n, file_dev: 66311n });
    expect(storeMetaRowAt(path, ['generation'])).toEqual({ generation: null });
  });

  it('control: the row at store-meta has no generation column to read', () => {
    const path = plantStoreMetaStore();

    expect(() => storeMetaRowAt(path, ['generation'])).toThrow('no such column: generation');
  });

  it('control: the column refuses an empty generation and takes a filled one', () => {
    const path = plantStoreMetaStore();
    const db = new Database(path, { readwrite: true });
    try {
      bringForward(db, path, 'write', 'open');

      expect(() => db.run('UPDATE store_meta SET generation = \'\' WHERE id = 1'))
        .toThrow('CHECK constraint failed');
      db.run('UPDATE store_meta SET generation = \'7f3a\' WHERE id = 1');
      expect(db.query<{ generation: string }, []>('SELECT generation FROM store_meta').get())
        .toEqual({ generation: '7f3a' });
    } finally {
      db.close();
    }
  });
});
