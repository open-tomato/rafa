/**
 * Tests for `readDeviceStoreId` (`device.ts`): the minted id of a SQLite
 * store with the ids it replaced and its mint time, and the three
 * causes with no id, each with the reason a command prints. Then
 * `holdsClaim` over what that read answers: the id, a replaced id, a
 * stranger's id, and a store without the `store_replaced` table.
 *
 * A replaced id is recorded by `recordReplacedStoreId` through a
 * writing open of the minted store, which keeps its id, the file not
 * having moved. A store without the table is the same store with the
 * table dropped, as an older runtime left it; the table is counted on
 * the file after the read, so "the read did not bring it back" is
 * measured, with the untouched store as the control that the count
 * reads 1 where the table exists.
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
import { recordReplacedStoreId } from '../effort/store/store-replaced.js';
import { createGitRunner } from '../pr/git.js';
import { freshDevice } from '../tests/merged-stores.js';

import { holdsClaim, readDeviceStoreId } from './device.js';

/** The command both the NDJSON and the unminted reasons name. */
const MOVE = 'rafa effort move --to=sqlite';

/** The id the minted cases mint. */
const ORIGIN = '0b7c6f1e-5a2d-4c3b-9e8f-1a2b3c4d5e6f';

/** The time `freshDevice` mints every store at. */
const MINTED_AT = '2026-09-29T08:00:00.000Z';

/** Two ids a store carried before, and the times it stopped. */
const REPLACED_FIRST = '11111111-aaaa-4bbb-8ccc-000000000001';
const REPLACED_SECOND = '22222222-aaaa-4bbb-8ccc-000000000002';
const REPLACED_FIRST_AT = '2026-09-30T08:00:00.000Z';
const REPLACED_SECOND_AT = '2026-10-01T08:00:00.000Z';

/** An id no store in this suite ever carried. */
const STRANGER = '99999999-aaaa-4bbb-8ccc-000000000009';

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

/** How many tables named `store_replaced` the store under `root` holds, read-only. */
function storeReplacedTables(root: string): number {
  const db = new Database(sqliteStorePath(root), { readonly: true });
  try {
    return db.query<{ n: number }, []>(
      'SELECT count(*) AS n FROM sqlite_master WHERE type = \'table\' AND name = \'store_replaced\'',
    ).get()?.n ?? -1;
  } finally {
    db.close();
  }
}

/** The id the store under `root` carries, read from the file, read-only. */
function storedId(root: string): string | undefined {
  const db = new Database(sqliteStorePath(root), { readonly: true });
  try {
    return db.query<{ store_id: string }, []>('SELECT store_id FROM store_meta WHERE id = 1').get()?.store_id;
  } finally {
    db.close();
  }
}

/**
 * A minted store that replaced {@link REPLACED_SECOND} and then
 * {@link REPLACED_FIRST} in that writing order, so the earlier
 * replacement is written last. Throws when the writing open re-minted.
 */
function deviceWithReplacedIds(origin: string): string {
  const { root } = freshDevice(scope, origin);
  withSqliteStore(sqliteStorePath(root), 'write', false, (db) => {
    recordReplacedStoreId(db, REPLACED_SECOND, new Date(REPLACED_SECOND_AT));
    recordReplacedStoreId(db, REPLACED_FIRST, new Date(REPLACED_FIRST_AT));
  });
  if (storedId(root) !== origin) throw new Error(`store under ${root} no longer carries ${origin}`);
  return root;
}

/** A minted store with the `store_replaced` table dropped, as an older runtime left it. */
function deviceWithoutTable(origin: string): string {
  const { root } = freshDevice(scope, origin);
  expect(storeReplacedTables(root)).toBe(1);
  withSqliteStore(sqliteStorePath(root), 'write', false, (db) => {
    db.run('DROP TABLE store_replaced');
  });
  if (storedId(root) !== origin) throw new Error(`store under ${root} no longer carries ${origin}`);
  expect(storeReplacedTables(root)).toBe(0);
  return root;
}

describe('readDeviceStoreId over a SQLite store', () => {
  it('answers the minted store_meta.store_id, no replaced id and its minted_at', () => {
    const device = freshDevice(scope, ORIGIN);

    expect(readDeviceStoreId(device.root, { store: 'sqlite' })).toEqual({
      ok: true,
      storeId: ORIGIN,
      replacedIds: [],
      mintedAt: MINTED_AT,
    });
    expect(storeMetaRows(device.root)).toBe(1);
  });

  it('answers the ids the store replaced, the earliest replaced first', () => {
    const root = deviceWithReplacedIds(`${ORIGIN}-replaced`);

    expect(readDeviceStoreId(root, { store: 'sqlite' })).toEqual({
      ok: true,
      storeId: `${ORIGIN}-replaced`,
      replacedIds: [REPLACED_FIRST, REPLACED_SECOND],
      mintedAt: MINTED_AT,
    });
  });

  it('answers no replaced id for a store without the table, and does not create it', () => {
    const root = deviceWithoutTable(`${ORIGIN}-no-table`);

    expect(readDeviceStoreId(root, { store: 'sqlite' })).toEqual({
      ok: true,
      storeId: `${ORIGIN}-no-table`,
      replacedIds: [],
      mintedAt: MINTED_AT,
    });
    expect(storeReplacedTables(root)).toBe(0);
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

describe('holdsClaim', () => {
  /** What `readDeviceStoreId` answers for `root`, or a throw when it has no id. */
  function idsOf(root: string) {
    const answer = readDeviceStoreId(root, { store: 'sqlite' });
    if (!answer.ok) throw new Error(`no store id under ${root}: ${answer.reason}`);
    return answer;
  }

  it('is true for the store\'s own id', () => {
    const root = deviceWithReplacedIds(`${ORIGIN}-holds-own`);

    expect(holdsClaim(idsOf(root), `${ORIGIN}-holds-own`)).toBe(true);
  });

  it('is true for each id the store replaced', () => {
    const ids = idsOf(deviceWithReplacedIds(`${ORIGIN}-holds-replaced`));

    expect(holdsClaim(ids, REPLACED_FIRST)).toBe(true);
    expect(holdsClaim(ids, REPLACED_SECOND)).toBe(true);
  });

  it('is false for a stranger\'s id and for a claim nobody holds', () => {
    const ids = idsOf(deviceWithReplacedIds(`${ORIGIN}-holds-stranger`));

    expect(holdsClaim(ids, STRANGER)).toBe(false);
    expect(holdsClaim(ids, null)).toBe(false);
  });

  it('over a store without the table, is true for its id and false for an id it would have replaced', () => {
    const ids = idsOf(deviceWithoutTable(`${ORIGIN}-holds-no-table`));

    expect(holdsClaim(ids, `${ORIGIN}-holds-no-table`)).toBe(true);
    expect(holdsClaim(ids, REPLACED_FIRST)).toBe(false);
  });
});
