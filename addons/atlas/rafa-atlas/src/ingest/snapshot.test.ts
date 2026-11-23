/**
 * Tests for `snapshot.ts` over fixture stores written in a tmpdir by core's
 * store writers: the copy lands at `<root>/.rafa/atlas/snapshot/effort.sqlite`
 * holding the store's rows, `RAFA_EFFORT_DIR` names the store copied from,
 * a second snapshot replaces the first and leaves no part file, and a root
 * with no store is refused with nothing made.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { copyEffortStore } from '@open-tomato/rafa-core/store/copy';
import { guardTestProcess } from '@open-tomato/rafa-core/store/location';
import { openSqliteStore } from '@open-tomato/rafa-core/store/sqlite';
import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { effortStorePathOf, snapshotPathOf, takeEffortSnapshot } from './snapshot.js';
import { fixtureStoreDir, sessionRow, writeFixtureStore } from './testdata/effort-store.fixture.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-ingest-snapshot-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

let planted = 0;

/** A fresh directory under the suite's scope, not yet on disk. */
function freshDir(name: string): string {
  planted += 1;
  return join(scope, `${String(planted)}-${name}`);
}

/** The session ids the SQLite file at `path` holds, in `seq` order. */
function sessionIdsAt(path: string): string[] {
  guardTestProcess(path);
  const database = new Database(path, { readonly: true });
  try {
    return database
      .query<{ readonly session_id: string }, []>('SELECT session_id FROM sessions ORDER BY seq')
      .all()
      .map((row) => row.session_id);
  } finally {
    database.close();
  }
}

describe('takeEffortSnapshot', () => {
  it('copies the store to <root>/.rafa/atlas/snapshot/effort.sqlite, every row with it', () => {
    const root = freshDir('copy');
    writeFixtureStore(root);

    const snapshot = takeEffortSnapshot({ root, env: {}, now: () => new Date('2026-11-20T10:00:00.000Z') });

    expect(snapshot.snapshotPath).toBe(join(root, '.rafa', 'atlas', 'snapshot', 'effort.sqlite'));
    expect(snapshot.sourcePath).toBe(join(fixtureStoreDir(root), 'effort.sqlite'));
    expect(snapshot.takenAt).toBe('2026-11-20T10:00:00.000Z');
    expect(sessionIdsAt(snapshot.snapshotPath)).toEqual(sessionIdsAt(snapshot.sourcePath));
    expect(sessionIdsAt(snapshot.snapshotPath)).toHaveLength(4);
  });

  it('reads the store RAFA_EFFORT_DIR names, and still writes under the root', () => {
    const root = freshDir('override-root');
    writeFixtureStore(root);
    const copy = freshDir('override-copy');
    copyEffortStore({ source: fixtureStoreDir(root), target: copy });
    openSqliteStore(root).append('sessions', [sessionRow({
      sessionId: 'session-only-in-root',
      kind: 'other',
      first: '2026-11-05T09:00:00.000Z',
      last: '2026-11-05T09:01:00.000Z',
    })]);

    const snapshot = takeEffortSnapshot({ root, env: { RAFA_EFFORT_DIR: copy } });

    expect(snapshot.sourcePath).toBe(join(copy, 'effort.sqlite'));
    expect(snapshot.snapshotPath).toBe(snapshotPathOf(root));
    expect(sessionIdsAt(snapshot.snapshotPath)).not.toContain('session-only-in-root');
    expect(sessionIdsAt(effortStorePathOf(root, {}))).toContain('session-only-in-root');
  });

  it('replaces an earlier snapshot whole and leaves no part file beside it', () => {
    const root = freshDir('replace');
    writeFixtureStore(root);
    takeEffortSnapshot({ root, env: {} });
    openSqliteStore(root).append('sessions', [sessionRow({
      sessionId: 'session-after-first',
      kind: 'other',
      first: '2026-11-06T09:00:00.000Z',
      last: '2026-11-06T09:01:00.000Z',
    })]);

    const second = takeEffortSnapshot({ root, env: {} });

    expect(sessionIdsAt(second.snapshotPath)).toContain('session-after-first');
    expect(readdirSync(dirname(second.snapshotPath))).toEqual(['effort.sqlite']);
  });

  it('refuses a root with no store, making no snapshot folder', () => {
    const root = freshDir('empty');
    mkdirSync(root, { recursive: true });

    expect(() => takeEffortSnapshot({ root, env: {} })).toThrow('no effort store at');
    expect(existsSync(join(root, '.rafa'))).toBe(false);
  });
});
