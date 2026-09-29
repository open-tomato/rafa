/**
 * Tests for the `file` sync strategy (`src/effort/sync/file.ts`) and its
 * `sync/file` entry in `CORE_ADAPTER_REGISTRY`.
 *
 * Every device is a project root under this file's own temporary
 * directory, its store minted by `freshDevice` or `copyDevice`
 * (`src/tests/merged-stores.ts`), with `dispatches` rows planted through
 * `writeDispatch` so a merge has rows to add. The merge runs as an
 * installed runtime with no live loop, as `mergeBothWays` runs it.
 *
 * Each refusal sits beside the same request made to succeed: the NDJSON
 * push beside the same device pushed under `sqlite`, the NDJSON pull
 * beside the clean pull, a context naming no `store` beside one naming
 * `ndjson`. A store's bytes are read as a sha256 before and after, so a
 * case holding them unchanged could have seen them move: the clean pull
 * moves them.
 */
import type { FileSyncOptions } from './file.js';
import type { AdapterContext } from '../../adapters/registry.js';
import type { RuntimeIdentity } from '../../runtime/identity.js';
import type { Device } from '../../tests/merged-stores.js';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { CORE_ADAPTER_REGISTRY } from '../../adapters/registry.js';
import { copyDevice, freshDevice } from '../../tests/merged-stores.js';
import { EffortCopyRefusal } from '../store/copy.js';
import { writeDispatch } from '../store/dispatches.js';
import { MergeRefusal, MOVE_TO_SQLITE } from '../store/merge-store.js';
import { SQLITE_STORE_FILE_NAME, sqliteStorePath } from '../store/sqlite.js';

import { createFileSync, FileSyncRefusal } from './file.js';
import { selectSync } from './select.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-sync-file-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** An installed runtime, which may swap a merged store in anywhere. */
const INSTALLED: RuntimeIdentity = { kind: 'installed', entry: '/home/u/.rafa/runtime/0.26.0/cli.js' };

/** The clock every pull reads, and the stamp `fileStamp` spells it as. */
const NOW = new Date('2026-09-29T12:00:00.000Z');
const STAMP = '20260929T120000Z';

let scopes = 0;

/** A fresh directory of its own under this file's temporary directory. */
function freshScope(): string {
  scopes += 1;
  const scope = join(tempBase, `scope-${String(scopes)}`);
  mkdirSync(scope);
  return scope;
}

/** The `file` strategy over `root` under `backend`, merging as an installed runtime with no live loop. */
function fileSync(root: string, backend: FileSyncOptions['backend'] = 'sqlite'): ReturnType<typeof createFileSync> {
  return createFileSync({ repoRoot: root, backend, now: () => NOW, identity: INSTALLED, isAlive: () => false, env: {} });
}

/** Plants one `dispatches` row keyed `sessionId` in `device`'s store. */
function dispatch(device: Device, sessionId: string): void {
  writeDispatch(device.root, { sessionId, planStub: null, taskLine: `task of ${sessionId}`, declaration: null, flags: [] });
}

/** The session ids of the `dispatches` rows in the store file at `path`, sorted. */
function dispatched(path: string): string[] {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<{ session_id: string }, []>('SELECT session_id FROM dispatches ORDER BY session_id').all()
      .map((row) => row.session_id);
  } finally {
    db.close();
  }
}

/** The sha256 of the file at `path`. */
function hashOf(path: string): string {
  return new Bun.CryptoHasher('sha256').update(readFileSync(path))
    .digest('hex');
}

/** What `attempt` rejected with, or undefined when it resolved. */
async function rejectionOf(attempt: () => Promise<unknown>): Promise<unknown> {
  try {
    await attempt();
    return undefined;
  } catch (error) {
    return error;
  }
}

/** Device a with rows s-1 and s-2, and device b copied from it after s-1 only. */
function twoDevices(): { scope: string; a: Device; b: Device } {
  const scope = freshScope();
  const a = freshDevice(scope, 'store-a');
  dispatch(a, 's-1');
  const b = copyDevice(scope, a, 'store-b');
  dispatch(a, 's-2');
  return { scope, a, b };
}

describe('pushing with the file strategy', () => {
  it('copies the store into `to` and answers the copy\'s effort.sqlite, leaving the store\'s bytes as they were', async () => {
    const { scope, a } = twoDevices();
    const before = hashOf(sqliteStorePath(a.root));
    const carried = join(scope, 'carried');

    const pushed = await fileSync(a.root).push({ to: carried });

    expect(pushed).toEqual({ status: 'pushed', path: join(carried, SQLITE_STORE_FILE_NAME) });
    expect(Object.isFrozen(pushed)).toBe(true);
    expect(dispatched(join(carried, SQLITE_STORE_FILE_NAME))).toEqual(['s-1', 's-2']);
    expect(hashOf(sqliteStorePath(a.root))).toBe(before);
  });

  it('reads a relative `to` against the repository root', async () => {
    const { a } = twoDevices();

    const pushed = await fileSync(a.root).push({ to: 'outgoing' });

    expect(pushed).toEqual({ status: 'pushed', path: join(a.root, 'outgoing', SQLITE_STORE_FILE_NAME) });
    expect(existsSync(join(a.root, 'outgoing', SQLITE_STORE_FILE_NAME))).toBe(true);
  });

  it('passes the copy\'s refusal of a target holding anything through, writing nothing into it', async () => {
    const { scope, a } = twoDevices();
    const used = join(scope, 'used');
    mkdirSync(used);
    writeFileSync(join(used, 'note.txt'), 'kept');

    const error = await rejectionOf(() => fileSync(a.root).push({ to: used }));

    expect(error).toBeInstanceOf(EffortCopyRefusal);
    expect(readdirSync(used)).toEqual(['note.txt']);
  });

  it('refuses an NDJSON project, naming the move to SQLite, beside the same push under sqlite', async () => {
    const { scope, a } = twoDevices();
    const refusedTo = join(scope, 'refused');

    const error = await rejectionOf(() => fileSync(a.root, 'ndjson').push({ to: refusedTo }));

    expect(error).toBeInstanceOf(FileSyncRefusal);
    expect((error as Error).message).toContain('store: ndjson');
    expect((error as Error).message).toContain(`Next safe step: ${MOVE_TO_SQLITE}`);
    expect(existsSync(refusedTo)).toBe(false);
    // Control: the same device and target under sqlite push.
    expect(await fileSync(a.root).push({ to: refusedTo }))
      .toEqual({ status: 'pushed', path: join(refusedTo, SQLITE_STORE_FILE_NAME) });
  });

  it('refuses a store directory holding no effort.sqlite, making nothing', async () => {
    const scope = freshScope();
    const root = join(scope, 'ndjson-only');
    mkdirSync(join(root, '.rafa', 'effort'), { recursive: true });
    writeFileSync(join(root, '.rafa', 'effort', 'sessions.ndjson'), '');
    const target = join(scope, 'target');

    const error = await rejectionOf(() => fileSync(root).push({ to: target }));

    expect(error).toBeInstanceOf(FileSyncRefusal);
    expect((error as Error).message).toContain(`no ${SQLITE_STORE_FILE_NAME} in ${join(root, '.rafa', 'effort')}`);
    expect(existsSync(target)).toBe(false);
  });

  it('rejects a request naming no directory', async () => {
    const { a } = twoDevices();

    const error = await rejectionOf(() => fileSync(a.root).push({ to: null }));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe('effort sync (file): to is null, expected a path');
  });
});

describe('pulling with the file strategy', () => {
  it('merges the carried file through mergeStore and answers its result, stamped from the clock', async () => {
    const { scope, a, b } = twoDevices();
    const carried = await fileSync(a.root).push({ to: join(scope, 'carried') });
    const from = carried.status === 'pushed'
      ? carried.path
      : null;
    const before = hashOf(sqliteStorePath(b.root));

    const pulled = await fileSync(b.root).pull({ from, dryRun: false });

    expect(pulled.status).toBe('pulled');
    const merge = pulled.status === 'pulled'
      ? pulled.merge
      : null;
    expect(merge).toMatchObject({
      path: sqliteStorePath(b.root),
      otherPath: from,
      status: 'merged',
      otherStore: 'store-a',
      backupPath: `${sqliteStorePath(b.root)}.before-merge-${STAMP}.bak`,
    });
    expect(merge?.tables.find((entry) => entry.table === 'dispatches')).toMatchObject({ added: 1, skipped: 1 });
    expect(dispatched(sqliteStorePath(b.root))).toEqual(['s-1', 's-2']);
    expect(hashOf(`${sqliteStorePath(b.root)}.before-merge-${STAMP}.bak`)).toBe(before);
  });

  it('reads a relative `from` against the repository root', async () => {
    const { a, b } = twoDevices();
    await fileSync(a.root).push({ to: join(b.root, 'incoming') });

    const pulled = await fileSync(b.root).pull({ from: join('incoming', SQLITE_STORE_FILE_NAME), dryRun: false });

    expect(pulled).toMatchObject({ status: 'pulled', merge: { otherPath: join(b.root, 'incoming', SQLITE_STORE_FILE_NAME) } });
    expect(dispatched(sqliteStorePath(b.root))).toEqual(['s-1', 's-2']);
  });

  it('builds, checks and deletes the merge under dryRun, leaving the store\'s bytes as they were', async () => {
    const { scope, a, b } = twoDevices();
    await fileSync(a.root).push({ to: join(scope, 'carried') });
    const before = hashOf(sqliteStorePath(b.root));

    const pulled = await fileSync(b.root).pull({ from: join(scope, 'carried', SQLITE_STORE_FILE_NAME), dryRun: true });

    expect(pulled).toMatchObject({ status: 'pulled', merge: { status: 'would-merge', backupPath: null, rowsAdded: 1 } });
    expect(hashOf(sqliteStorePath(b.root))).toBe(before);
    expect(dispatched(sqliteStorePath(b.root))).toEqual(['s-1']);
  });

  it('rejects with the merge\'s own refusal of an NDJSON project, the store\'s bytes as they were', async () => {
    const { scope, a, b } = twoDevices();
    await fileSync(a.root).push({ to: join(scope, 'carried') });
    const before = hashOf(sqliteStorePath(b.root));

    const error = await rejectionOf(
      () => fileSync(b.root, 'ndjson').pull({ from: join(scope, 'carried', SQLITE_STORE_FILE_NAME), dryRun: false }),
    );

    expect(error).toBeInstanceOf(MergeRefusal);
    expect(error).toMatchObject({ reason: 'ndjson' });
    expect((error as Error).message).toContain(MOVE_TO_SQLITE);
    expect(hashOf(sqliteStorePath(b.root))).toBe(before);
  });

  it('rejects a request naming no file', async () => {
    const { b } = twoDevices();

    const error = await rejectionOf(() => fileSync(b.root).pull({ from: null, dryRun: false }));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe('effort sync (file): from is null, expected a path');
  });
});

describe('core\'s sync/file', () => {
  it('makes the file strategy with the context\'s store, which reaches its push', async () => {
    const { scope, a } = twoDevices();
    const adapter = CORE_ADAPTER_REGISTRY.resolve('sync', 'file');
    const target = join(scope, 'from-registry');

    const ndjson = adapter.create({ repoRoot: a.root, store: 'ndjson' });
    expect(ndjson.kind).toBe('file');
    expect(await rejectionOf(() => ndjson.push({ to: target }))).toBeInstanceOf(FileSyncRefusal);
    // Control: the same context under sqlite pushes.
    expect(await adapter.create({ repoRoot: a.root, store: 'sqlite' }).push({ to: target }))
      .toEqual({ status: 'pushed', path: join(target, SQLITE_STORE_FILE_NAME) });
  });

  it.each([
    ['no store', undefined, 'undefined'],
    ['a store no backend is named', 'postgres', '"postgres"'],
  ])('refuses a context naming %s, touching nothing', (_label, store, shown) => {
    const root = join(tempBase, 'never-made');
    const attempt = (): unknown => CORE_ADAPTER_REGISTRY.resolve('sync', 'file')
      .create({ repoRoot: root, store } as AdapterContext);

    expect(attempt).toThrow(TypeError);
    expect(attempt).toThrow(`adapter registry: sync/file has store ${shown} in its context, expected one of: sqlite, ndjson`);
    expect(existsSync(root)).toBe(false);
  });

  it('is what selectSync makes for effort.sync: file, handed the config\'s store', async () => {
    const { scope, a } = twoDevices();
    const target = join(scope, 'selected');

    const sync = selectSync(a.root, { effortSync: 'file', store: 'sqlite' });

    expect(sync.kind).toBe('file');
    expect(await sync.push({ to: target })).toEqual({ status: 'pushed', path: join(target, SQLITE_STORE_FILE_NAME) });
    // A config carrying no store is refused by the adapter, not defaulted to sqlite.
    expect(() => selectSync(a.root, { effortSync: 'file' })).toThrow('adapter registry: sync/file has store undefined');
  });
});
