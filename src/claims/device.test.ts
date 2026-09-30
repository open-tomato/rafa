/**
 * Tests for `readDeviceStoreId` (`device.ts`): the minted id of a SQLite
 * store, and the three causes with no id, each with the reason a
 * command prints.
 *
 * Every store sits under a fresh project root in this suite's own
 * temporary directory, and the disk is real. A minted store is made by
 * `freshDevice` (`src/tests/merged-stores.ts`), whose writing open
 * mints the id the case names; an unminted one by a writing open told
 * it knows no project, which makes the file and brings it forward but
 * writes no `store_meta` row, as an open outside any repository does.
 * That root is itself a git repository with one commit, so a WRITING
 * open there would mint an id from the real root commit: "the read
 * minted nothing" could fail, and does when the module's `read` open is
 * turned into a `write`. The row count is read back through `bun:sqlite` directly, read-only,
 * never through the module, so "the read minted nothing" is measured
 * on the file, with the minted store as the control that the same
 * count does read a row where one exists.
 */
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { sqliteStorePath, withSqliteStore } from '../effort/store/sqlite.js';
import { createGitRunner } from '../pr/git.js';
import { freshDevice } from '../tests/merged-stores.js';

import { readDeviceStoreId } from './device.js';

/** The command both the NDJSON and the unminted reasons name. */
const MOVE = 'rafa effort move --to=sqlite';

/** The id the minted cases mint. */
const ORIGIN = '0b7c6f1e-5a2d-4c3b-9e8f-1a2b3c4d5e6f';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-claims-device-')));

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** A fresh project root under this suite's directory, holding no store. */
function freshRoot(name: string): string {
  return realpathSync(mkdtempSync(join(scope, `${name}-`)));
}

/** Makes `root` a git repository holding one empty commit, or throws git's own error. */
function commitOnce(root: string): void {
  const git = createGitRunner(root);
  const steps: readonly (readonly string[])[] = [
    ['init', '--quiet'],
    ['-c', 'user.name=rafa', '-c', 'user.email=rafa@example.invalid', '-c', 'commit.gpgsign=false',
      'commit', '--quiet', '--allow-empty', '-m', 'root'],
  ];
  for (const step of steps) {
    const result = git(step);
    if (!result.ok) throw new Error(`git ${step.join(' ')} in ${root}: ${result.stderr}`);
  }
}

/**
 * A project root, a repository with a commit, whose SQLite store exists,
 * brought forward, with no id minted.
 */
function unmintedRoot(): string {
  const root = freshRoot('unminted');
  commitOnce(root);
  withSqliteStore(sqliteStorePath(root), 'write', true, () => undefined, {
    readProject: () => ({ rootCommit: null, remote: null }),
  });
  return root;
}

/** How many `store_meta` rows the store under `root` holds, read-only. */
function storeMetaRows(root: string): number {
  const db = new Database(sqliteStorePath(root), { readonly: true });
  try {
    return db.query<{ n: number }, []>('SELECT count(*) AS n FROM store_meta').get()?.n ?? -1;
  } finally {
    db.close();
  }
}

describe('readDeviceStoreId over a SQLite store', () => {
  it('answers the minted store_meta.store_id', () => {
    const device = freshDevice(scope, ORIGIN);

    expect(readDeviceStoreId(device.root, { store: 'sqlite' })).toEqual({ ok: true, storeId: ORIGIN });
    expect(storeMetaRows(device.root)).toBe(1);
  });

  it('answers unminted, naming the move and the path, and mints nothing', () => {
    const root = unmintedRoot();
    expect(storeMetaRows(root)).toBe(0);

    const answer = readDeviceStoreId(root, { store: 'sqlite' });

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.cause).toBe('unminted');
    expect(answer.reason).toContain(MOVE);
    expect(answer.reason).toContain(sqliteStorePath(root));
    expect(storeMetaRows(root)).toBe(0);
  });

  it('answers absent without creating the store or its directory, and does not name the move', () => {
    const root = freshRoot('absent');

    const answer = readDeviceStoreId(root, { store: 'sqlite' });

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.cause).toBe('absent');
    expect(answer.reason).toContain(sqliteStorePath(root));
    expect(answer.reason).not.toContain(MOVE);
    expect(existsSync(dirname(sqliteStorePath(root)))).toBe(false);
  });
});

describe('readDeviceStoreId over an NDJSON store', () => {
  it('answers ndjson, naming the move, without creating anything', () => {
    const root = freshRoot('ndjson');

    const answer = readDeviceStoreId(root, { store: 'ndjson' });

    expect(answer).toEqual({
      ok: false,
      cause: 'ndjson',
      reason: expect.stringContaining(MOVE) as unknown as string,
    });
    expect(existsSync(dirname(sqliteStorePath(root)))).toBe(false);
  });

  it('answers ndjson even beside a minted SQLite file, since the config decides', () => {
    const device = freshDevice(scope, `${ORIGIN}-beside`);
    expect(readDeviceStoreId(device.root, { store: 'sqlite' }).ok).toBe(true);

    const answer = readDeviceStoreId(device.root, { store: 'ndjson' });

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.cause).toBe('ndjson');
  });
});
