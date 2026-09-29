/**
 * The end-to-end story `bring-forward.test.ts`, `development-build.test.ts`
 * and `forward-compat.test.ts` each cover a slice of: one store, in one
 * file under a fresh temporary directory, driven through the sequence the
 * spec describes in order —
 *
 *   1. a pre-log store adopts, its thirteen legacy entries logged with no
 *      run and `user_version` left at `LEGACY_GATE_OPEN`;
 *   2. an installed identity applies a synthetic additive tail, logging
 *      it and raising the gate to match;
 *   3. a development build with nothing pending reads (and writes) the
 *      same store, since a store with a log and nothing left to apply is
 *      current for any rafa;
 *   4. a development build asked to apply a second synthetic tail over
 *      that store is refused, its bytes and its log left exactly as step
 *      2 left them.
 *
 * Each step reads `schema_migrations` and `PRAGMA user_version` itself,
 * rather than trust the return value alone, and the refusal step checks
 * the spec's text verbatim. The store sits under `tmpdir()` throughout,
 * as the test guard (`location.ts`) requires; a synthetic tail is always
 * passed through the `migrations` option, never appended to
 * `SQLITE_MIGRATIONS`.
 */
import type { BringForwardOptions } from './bring-forward.js';
import type { SqliteMigration } from './migrations.js';
import type { RuntimeIdentity } from '../../runtime/identity.js';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { bringForward, MIGRATION_LOG_TABLE } from './bring-forward.js';
import { DEVELOPMENT_NEXT_STEP, DevelopmentBuildRefusedError } from './development-build.js';
import { LEGACY_GATE_OPEN, SQLITE_MIGRATIONS } from './migrations.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-store-lifecycle-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const STORE_PATH = join(tempBase, 'effort.sqlite');

const CHECKOUT = '/work/rafa';
const DEVELOPMENT: RuntimeIdentity = { kind: 'development', entry: `${CHECKOUT}/src/rafa.ts`, checkout: CHECKOUT };
const INSTALLED: RuntimeIdentity = { kind: 'installed', entry: '/home/op/.rafa/runtime/0.25.0/cli.js' };

/** The first synthetic additive tail, applied by the installed identity in step 2. */
const FIRST_TAIL: SqliteMigration = {
  id: 'lifecycle-first-tail',
  breaks: [],
  sql: 'CREATE TABLE lifecycle_first (seq INTEGER PRIMARY KEY, note TEXT);',
};
const WITH_FIRST_TAIL = [...SQLITE_MIGRATIONS, FIRST_TAIL];

/** A second synthetic additive tail, pending only at step 4, never applied. */
const SECOND_TAIL: SqliteMigration = {
  id: 'lifecycle-second-tail',
  breaks: [],
  sql: 'CREATE TABLE lifecycle_second (seq INTEGER PRIMARY KEY, note TEXT);',
};
const WITH_BOTH_TAILS = [...WITH_FIRST_TAIL, SECOND_TAIL];

/** A development build over a store `tempBase` does not sit under: `tempDir` moves ownership elsewhere. */
function unowned(migrations: readonly SqliteMigration[]): BringForwardOptions {
  return {
    identity: DEVELOPMENT,
    env: {},
    tempDir: mkdtempSync(join(tmpdir(), 'rafa-store-lifecycle-elsewhere-')),
    appliedBy: '0.25.0',
    migrations,
  };
}

/** Runs `use` over a connection to the shared store, closing it whatever `use` did. */
function withDb<T>(use: (db: Database) => T): T {
  const db = new Database(STORE_PATH, { readwrite: true, create: true });
  try {
    return use(db);
  } finally {
    db.close();
  }
}

interface LogRow {
  readonly id: string;
  readonly applied_at: string;
  readonly applied_by: string;
}

/** The store's migration log, in apply order. */
function readLog(): readonly LogRow[] {
  return withDb((db) => db
    .query<LogRow, []>(`SELECT id, applied_at, applied_by FROM ${MIGRATION_LOG_TABLE} ORDER BY seq`)
    .all());
}

/** `PRAGMA user_version`, read fresh. */
function readUserVersion(): number {
  return withDb((db) => db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version ?? 0);
}

/** The store file's bytes, for a before-and-after comparison across a refused open. */
function readBytes(): Buffer {
  return readFileSync(STORE_PATH);
}

/** Plants a pre-log store: the thirteen legacy entries run, `user_version` at the open gate, no log. */
function plantPreLogStore(): void {
  withDb((db) => {
    for (const { sql } of SQLITE_MIGRATIONS.slice(0, LEGACY_GATE_OPEN)) db.run(sql);
    db.run(`PRAGMA user_version = ${String(LEGACY_GATE_OPEN)}`);
  });
}

describe('one store driven through adoption, an applied tail, a clean read and a refusal', () => {
  it('runs the whole sequence, checking schema_migrations, user_version and the refusal text at each step', () => {
    plantPreLogStore();
    expect(readUserVersion()).toBe(LEGACY_GATE_OPEN);

    // 1. Adoption: a pre-log store gets its log, the thirteen legacy ids logged unrun.
    const adoption = withDb((db) => bringForward(db, STORE_PATH, 'write', 'open', {
      identity: INSTALLED,
      env: {},
      appliedBy: '0.24.1',
    }));

    expect(adoption.adopted).toHaveLength(LEGACY_GATE_OPEN);
    expect(adoption.applied).toEqual([]);
    expect(adoption.userVersion).toBe(LEGACY_GATE_OPEN);
    const afterAdoption = readLog();
    expect(afterAdoption.map((row) => row.id)).toEqual(SQLITE_MIGRATIONS.slice(0, LEGACY_GATE_OPEN).map(({ id }) => id));
    expect(afterAdoption.every((row) => row.applied_by === '0.24.1')).toBe(true);
    expect(readUserVersion()).toBe(LEGACY_GATE_OPEN);

    // 2. An installed identity applies a synthetic additive tail over the now-logged store.
    const applied = withDb((db) => bringForward(db, STORE_PATH, 'write', 'open', {
      identity: INSTALLED,
      env: {},
      appliedBy: '0.25.0',
      migrations: WITH_FIRST_TAIL,
    }));

    expect(applied.adopted).toEqual([]);
    expect(applied.applied).toEqual([FIRST_TAIL.id]);
    expect(applied.userVersion).toBe(LEGACY_GATE_OPEN);
    const afterApplied = readLog();
    expect(afterApplied.map((row) => row.id)).toEqual([
      ...SQLITE_MIGRATIONS.slice(0, LEGACY_GATE_OPEN).map(({ id }) => id),
      FIRST_TAIL.id,
    ]);
    expect(afterApplied.at(-1)?.applied_by).toBe('0.25.0');
    expect(readUserVersion()).toBe(LEGACY_GATE_OPEN);
    const bytesAfterStep2 = readBytes();
    const logAfterStep2 = afterApplied;

    // 3. A development build with nothing pending reads the same store, since it is now current.
    const read = withDb((db) => bringForward(db, STORE_PATH, 'read', 'open', unowned(WITH_FIRST_TAIL)));

    expect(read).toEqual({ adopted: [], applied: [], userVersion: LEGACY_GATE_OPEN });
    expect(readLog()).toEqual(logAfterStep2);
    expect(readUserVersion()).toBe(LEGACY_GATE_OPEN);
    expect(readBytes().equals(bytesAfterStep2)).toBe(true);

    // A development build with nothing pending writes it too, as any rafa does.
    withDb((db) => {
      bringForward(db, STORE_PATH, 'write', 'open', unowned(WITH_FIRST_TAIL));
      db.run('INSERT INTO sessions (session_id, row_json) VALUES (?, ?)', ['s-lifecycle', '{"sessionId":"s-lifecycle"}']);
    });
    const bytesAfterStep3 = readBytes();

    // 4. A development build with a second synthetic tail pending is refused, byte-identical after.
    let refusal: DevelopmentBuildRefusedError | null = null;
    try {
      withDb((db) => bringForward(db, STORE_PATH, 'write', 'open', unowned(WITH_BOTH_TAILS)));
    } catch (error) {
      if (!(error instanceof DevelopmentBuildRefusedError)) throw error;
      refusal = error;
    }

    expect(refusal).not.toBeNull();
    expect(refusal?.message).toBe(
      `effort store: ${STORE_PATH} needs migration ${SECOND_TAIL.id} and this rafa is a development build`
        + ` (${CHECKOUT}); a development build migrates only a store under the temp directory or`
        + ' RAFA_EFFORT_DIR. Copy it with \'rafa effort copy\' and run this command with RAFA_EFFORT_DIR=<the copy>.',
    );
    expect(refusal?.nextStep).toBe(DEVELOPMENT_NEXT_STEP);
    expect(readLog().map((row) => row.id)).not.toContain(SECOND_TAIL.id);
    expect(readUserVersion()).toBe(LEGACY_GATE_OPEN);
    expect(readBytes().equals(bytesAfterStep3)).toBe(true);
  });
});
