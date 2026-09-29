/**
 * Tests for the development-build refusal (`development-build.ts`), read
 * through `bringForward`: a development build with something to write
 * refuses a store it does not own and leaves its bytes as they were,
 * naming a planted live loop; it migrates a store it owns; an installed
 * identity migrates any store; and a development build with nothing to
 * write reads and writes any store.
 *
 * Every store is a real file under a fresh temporary directory, as the
 * test guard requires. A store is made unowned by handing the refusal
 * another temporary directory (`tempDir`), the seam a spawned child's
 * `TMPDIR` moves, and an environment with no `RAFA_EFFORT_DIR`. A
 * synthetic tail is passed through the `migrations` option, never
 * appended to `SQLITE_MIGRATIONS`.
 */
import type { SqliteMigration } from './migrations.js';
import type { SessionRecord } from '../../loop/sessions.js';
import type { RuntimeIdentity } from '../../runtime/identity.js';

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { runsDir, sessionFilePath } from '../../loop/sessions.js';

import { bringForward, MIGRATION_LOG_TABLE } from './bring-forward.js';
import {
  ADOPTION_NAME,
  DEVELOPMENT_NEXT_STEP,
  DevelopmentBuildRefusedError,
  isOwnedStore,
  storeProjectRoot,
} from './development-build.js';
import { EFFORT_DIR_VARIABLE } from './location.js';
import { LEGACY_GATE_OPEN, SQLITE_MIGRATIONS } from './migrations.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-development-build-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The temporary directory a case hands the refusal, which holds none of the stores. */
const ELSEWHERE = join(tempBase, 'elsewhere-tmp');
mkdirSync(ELSEWHERE);

const CHECKOUT = '/work/rafa';
const DEVELOPMENT: RuntimeIdentity = { kind: 'development', entry: `${CHECKOUT}/src/rafa.ts`, checkout: CHECKOUT };
const INSTALLED: RuntimeIdentity = { kind: 'installed', entry: '/home/op/.rafa/runtime/0.25.0/cli.js' };

/** A synthetic additive tail of one table. */
const TAIL: SqliteMigration = {
  id: 'fixture-notes',
  breaks: [],
  sql: 'CREATE TABLE fixture_notes (seq INTEGER PRIMARY KEY, note TEXT);',
};
const WITH_TAIL = [...SQLITE_MIGRATIONS, TAIL];

/** How a development build reads a store it does not own: another temp directory and no variable. */
const UNOWNED = { identity: DEVELOPMENT, env: {}, tempDir: ELSEWHERE, appliedBy: '0.25.0' };

let caseCount = 0;

/** A fresh project root under the temporary base, and the path its own store would sit at. */
function freshProject(): { readonly root: string; readonly path: string } {
  caseCount += 1;
  const root = join(tempBase, `project-${String(caseCount)}`);
  mkdirSync(join(root, '.rafa', 'effort'), { recursive: true });
  return { root, path: join(root, '.rafa', 'effort', 'effort.sqlite') };
}

/** Runs `use` over a connection to `path`, closing it whatever `use` did. */
function withDb<T>(path: string, use: (db: Database) => T): T {
  const db = new Database(path, { readwrite: true, create: true });
  try {
    return use(db);
  } finally {
    db.close();
  }
}

/** Brings the store at `path` to this build's migrations, as a scratch store under the real temp directory. */
function makeCurrent(path: string): void {
  withDb(path, (db) => bringForward(db, path, 'write', 'open', { identity: DEVELOPMENT, env: {} }));
}

/** Plants a store a pre-log release wrote: the legacy entries run, `user_version` at the open gate, no log. */
function makePreLog(path: string): void {
  withDb(path, (db) => {
    for (const { sql } of SQLITE_MIGRATIONS.slice(0, LEGACY_GATE_OPEN)) db.run(sql);
    db.run(`PRAGMA user_version = ${String(LEGACY_GATE_OPEN)}`);
  });
}

/** The ids the store's migration log holds, in apply order. */
function loggedIds(path: string): readonly string[] {
  return withDb(path, (db) => db
    .query<{ id: string }, []>(`SELECT id FROM ${MIGRATION_LOG_TABLE} ORDER BY seq`)
    .all()
    .map(({ id }) => id));
}

/** A running loop record of `root`, with `overrides` laid over it. */
function loopRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: 'session-0900',
    planStub: 'rafa-234-effort-store-migrations-older',
    plan: '.rafa/plans/PLAN-rafa-234-effort-store-migrations-older.md',
    branch: 'feat/rafa-234',
    pid: process.pid,
    startedAt: '2026-09-28T09:00:00.000Z',
    state: 'running',
    task: null,
    ...overrides,
  };
}

/** Writes `record` under `root` as `loop start` writes one. */
function plantLoop(root: string, record: SessionRecord): void {
  mkdirSync(runsDir(root), { recursive: true });
  writeFileSync(sessionFilePath(root, record.sessionId), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

/** The ids past the thirteen legacy entries, which adopting a pre-log store also applies. */
const PAST_LEGACY_IDS = SQLITE_MIGRATIONS.slice(LEGACY_GATE_OPEN).map(({ id }) => id);

/** The spec's refusal text for `path`, naming `needs`, before any loop sentence. */
function refusalText(path: string, needs: string): string {
  return `effort store: ${path} needs migration ${needs} and this rafa is a development build (${CHECKOUT});`
    + ' a development build migrates only a store under the temp directory or RAFA_EFFORT_DIR.'
    + ' Copy it with \'rafa effort copy\' and run this command with RAFA_EFFORT_DIR=<the copy>.';
}

/** Runs `open`, answering the refusal it throws; fails the case when it throws none or another error. */
function refusalOf(open: () => unknown): DevelopmentBuildRefusedError {
  try {
    open();
  } catch (error) {
    if (error instanceof DevelopmentBuildRefusedError) return error;
    throw error;
  }
  throw new Error('the open was not refused');
}

/** The store directory's names and the store file's bytes, for a before-and-after comparison. */
function snapshot(path: string, root: string): { readonly names: readonly string[]; readonly bytes: Buffer } {
  return { names: readdirSync(join(root, '.rafa', 'effort')).sort(), bytes: readFileSync(path) };
}

describe('a development build with something pending, over a store it does not own', () => {
  it('refuses a write and a read with the spec\'s text, leaving the store byte-identical', () => {
    const { root, path } = freshProject();
    makeCurrent(path);
    const before = snapshot(path, root);

    for (const access of ['write', 'read'] as const) {
      const refusal = refusalOf(() => withDb(path, (db) => bringForward(db, path, access, 'open', {
        ...UNOWNED,
        migrations: WITH_TAIL,
      })));
      expect(refusal.message).toBe(refusalText(path, TAIL.id));
      expect(refusal.nextStep).toBe(DEVELOPMENT_NEXT_STEP);
      expect(refusal.path).toBe(path);
    }

    const after = snapshot(path, root);
    expect(after.names).toEqual(before.names);
    expect(after.bytes.equals(before.bytes)).toBe(true);
    expect(loggedIds(path)).not.toContain(TAIL.id);
  });

  it('refuses to adopt a pre-log store, naming the log, and leaves it byte-identical', () => {
    const { root, path } = freshProject();
    makePreLog(path);
    const before = snapshot(path, root);

    const refusal = refusalOf(() => withDb(path, (db) => bringForward(db, path, 'read', 'open', UNOWNED)));

    expect(refusal.message).toBe(refusalText(path, [ADOPTION_NAME, ...PAST_LEGACY_IDS].join(', ')));
    const after = snapshot(path, root);
    expect(after.names).toEqual(before.names);
    expect(after.bytes.equals(before.bytes)).toBe(true);
  });

  it('names a live loop recorded under the store\'s project root', () => {
    const { root, path } = freshProject();
    makeCurrent(path);
    plantLoop(root, loopRecord());
    const before = snapshot(path, root);

    const refusal = refusalOf(() => withDb(path, (db) => bringForward(db, path, 'write', 'open', {
      ...UNOWNED,
      migrations: WITH_TAIL,
    })));

    expect(refusal.message).toBe(`${refusalText(path, TAIL.id)} Loop session-0900 (pid ${String(process.pid)},`
      + ' plan rafa-234-effort-store-migrations-older) is running on this store.');
    expect(snapshot(path, root).bytes.equals(before.bytes)).toBe(true);
  });

  it('names a paused loop, and a stubless one by its plan\'s path, oldest first', () => {
    const { root, path } = freshProject();
    makeCurrent(path);
    plantLoop(root, loopRecord({ sessionId: 'session-b', state: 'paused', startedAt: '2026-09-28T10:00:00.000Z' }));
    plantLoop(root, loopRecord({ sessionId: 'session-a', planStub: null, plan: 'PLAN.md' }));

    const refusal = refusalOf(() => withDb(path, (db) => bringForward(db, path, 'write', 'open', {
      ...UNOWNED,
      migrations: WITH_TAIL,
    })));

    expect(refusal.message).toEndWith(`RAFA_EFFORT_DIR=<the copy>. Loop session-a (pid ${String(process.pid)}, plan PLAN.md)`
      + ` is running on this store. Loop session-b (pid ${String(process.pid)},`
      + ' plan rafa-234-effort-store-migrations-older) is running on this store.');
  });

  it('names no loop whose pid is gone, that stopped or finished, or that another root records', () => {
    const { root, path } = freshProject();
    makeCurrent(path);
    plantLoop(root, loopRecord({ sessionId: 'session-dead', pid: 424242 }));
    plantLoop(root, loopRecord({ sessionId: 'session-stopped', state: 'stopped' }));
    plantLoop(root, loopRecord({ sessionId: 'session-done', state: 'done' }));
    plantLoop(freshProject().root, loopRecord({ sessionId: 'session-elsewhere' }));

    const refusal = refusalOf(() => withDb(path, (db) => bringForward(db, path, 'write', 'open', {
      ...UNOWNED,
      migrations: WITH_TAIL,
      isAlive: (pid) => pid !== 424242,
    })));

    expect(refusal.message).toBe(refusalText(path, TAIL.id));
  });

  it('says so when the loop records cannot be read, and still refuses', () => {
    const { root, path } = freshProject();
    makeCurrent(path);
    mkdirSync(runsDir(root), { recursive: true });
    writeFileSync(join(runsDir(root), 'broken.json'), '{ not json', 'utf8');

    const refusal = refusalOf(() => withDb(path, (db) => bringForward(db, path, 'write', 'open', {
      ...UNOWNED,
      migrations: WITH_TAIL,
    })));

    expect(refusal.message).toStartWith(`${refusalText(path, TAIL.id)} The loop records under ${runsDir(root)}`
      + ' could not be read (session record ');
  });

  it('is refused through RAFA_EFFORT_DIR when the store is a project\'s own', () => {
    const { path } = freshProject();
    makeCurrent(path);

    const refusal = refusalOf(() => withDb(path, (db) => bringForward(db, path, 'write', 'open', {
      ...UNOWNED,
      env: { [EFFORT_DIR_VARIABLE]: tempBase },
      migrations: WITH_TAIL,
    })));

    expect(refusal.message).toBe(refusalText(path, TAIL.id));
  });
});

describe('a development build over a store it owns', () => {
  it('migrates a scratch store under tmpdir()', () => {
    const { path } = freshProject();
    makeCurrent(path);

    const result = withDb(path, (db) => bringForward(db, path, 'write', 'open', {
      identity: DEVELOPMENT,
      env: {},
      migrations: WITH_TAIL,
    }));

    expect(result.applied).toEqual([TAIL.id]);
    expect(loggedIds(path).at(-1)).toBe(TAIL.id);
  });

  it('adopts a pre-log scratch store under tmpdir()', () => {
    const { path } = freshProject();
    makePreLog(path);

    const result = withDb(path, (db) => bringForward(db, path, 'read', 'open', { identity: DEVELOPMENT, env: {} }));

    expect(result.adopted).toHaveLength(LEGACY_GATE_OPEN);
    expect(result.applied).toEqual(PAST_LEGACY_IDS);
    expect(loggedIds(path)).toHaveLength(SQLITE_MIGRATIONS.length);
  });

  it('migrates a copy under the directory RAFA_EFFORT_DIR names', () => {
    const copyDir = join(tempBase, 'scratch', 'rafa-234-effort');
    mkdirSync(copyDir, { recursive: true });
    const path = join(copyDir, 'effort.sqlite');
    makeCurrent(path);

    const result = withDb(path, (db) => bringForward(db, path, 'write', 'open', {
      ...UNOWNED,
      env: { [EFFORT_DIR_VARIABLE]: copyDir },
      migrations: WITH_TAIL,
    }));

    expect(result.applied).toEqual([TAIL.id]);
  });
});

describe('an installed identity', () => {
  it('migrates a store outside the temp directory, a live loop beside it', () => {
    const { root, path } = freshProject();
    makeCurrent(path);
    plantLoop(root, loopRecord());

    const result = withDb(path, (db) => bringForward(db, path, 'write', 'open', {
      ...UNOWNED,
      identity: INSTALLED,
      migrations: WITH_TAIL,
    }));

    expect(result.applied).toEqual([TAIL.id]);
    expect(loggedIds(path).at(-1)).toBe(TAIL.id);
  });

  it('adopts a pre-log store outside the temp directory', () => {
    const { path } = freshProject();
    makePreLog(path);

    const result = withDb(path, (db) => bringForward(db, path, 'read', 'open', { ...UNOWNED, identity: INSTALLED }));

    expect(result.adopted).toHaveLength(LEGACY_GATE_OPEN);
  });
});

describe('a development build with nothing pending, over a store it does not own', () => {
  it('reads and writes it, as any rafa does', () => {
    const { path } = freshProject();
    makeCurrent(path);

    const rows = withDb(path, (db) => {
      const read = bringForward(db, path, 'read', 'open', UNOWNED);
      const write = bringForward(db, path, 'write', 'open', UNOWNED);
      db.run('INSERT INTO sessions (session_id, row_json) VALUES (?, ?)', ['s-1', '{"sessionId":"s-1"}']);
      return { read, write, count: db.query<{ n: number }, []>('SELECT count(*) AS n FROM sessions').get()?.n };
    });

    expect(rows.read).toEqual({ adopted: [], applied: [], userVersion: LEGACY_GATE_OPEN });
    expect(rows.write).toEqual({ adopted: [], applied: [], userVersion: LEGACY_GATE_OPEN });
    expect(rows.count).toBe(1);
  });
});

describe('which stores a development build owns', () => {
  it('reads a project root only from a store in a .rafa/effort directory', () => {
    expect(storeProjectRoot('/p/proj/.rafa/effort/effort.sqlite')).toBe('/p/proj');
    expect(storeProjectRoot('/p/proj/.rafa/scratch/effort-1/effort.sqlite')).toBeNull();
    expect(storeProjectRoot('/p/proj/.ralph/effort/effort.sqlite')).toBeNull();
    expect(storeProjectRoot('/p/proj/effort/effort.sqlite')).toBeNull();
  });

  it('owns a store under the temp directory, and one under RAFA_EFFORT_DIR that is no project\'s own', () => {
    const copy = '/work/proj/.rafa/scratch/effort-1';

    expect(isOwnedStore('/tmp/x/.rafa/effort/effort.sqlite', {}, '/tmp')).toBe(true);
    expect(isOwnedStore(`${copy}/effort.sqlite`, { [EFFORT_DIR_VARIABLE]: copy }, '/tmp')).toBe(true);
    expect(isOwnedStore('/work/proj/.rafa/effort/effort.sqlite', {}, '/tmp')).toBe(false);
    expect(isOwnedStore('/work/proj/.rafa/effort/effort.sqlite', { [EFFORT_DIR_VARIABLE]: '/work' }, '/tmp')).toBe(false);
    expect(isOwnedStore(`${copy}/effort.sqlite`, { [EFFORT_DIR_VARIABLE]: '/work/other' }, '/tmp')).toBe(false);
    expect(isOwnedStore(`${copy}/effort.sqlite`, { [EFFORT_DIR_VARIABLE]: 'proj/.rafa/scratch/effort-1' }, '/tmp')).toBe(false);
    expect(isOwnedStore(`${copy}/effort.sqlite`, { [EFFORT_DIR_VARIABLE]: '' }, '/tmp')).toBe(false);
  });
});
