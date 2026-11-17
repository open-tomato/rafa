/**
 * The hub key store (`key-store.ts`): minting and digesting a key, the
 * keys file's name beside a project's files, and the SQLite adapter's
 * calls, create answering the plain key once, the name rules, pause,
 * delete keeping the row, last use, a reopen, and a read of every
 * column of every row and every byte of the file finding no plain key,
 * with a control showing that read finds a key a table does hold.
 *
 * Every case opens its own store, in `:memory:` or a file under a
 * scratch directory of its own, so no case reads another's rows.
 */
import type { HubKey, HubKeyStore } from './key-store.js';

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { devicesFileName, indexFileName } from '../store/sqlite.js';

import {
  HubKeyRefused,
  KEY_BYTES,
  KEY_NAME,
  KEYS_FILE,
  keyDigest,
  keysFileName,
  mintKey,
  openSqliteKeyStore,
} from './key-store.js';

/** A minted key: the prefix, then 32 bytes as 43 base64url characters. */
const MINTED = /^rafa_[A-Za-z0-9_-]{43}$/;

/** A clock that answers `start`, a minute later each time it is read. */
function ticking(start = '2026-11-17T10:00:00.000Z'): () => Date {
  let at = Date.parse(start);
  return () => {
    const answer = new Date(at);
    at += 60_000;
    return answer;
  };
}

/** The reason `call` was refused for, failing the case when it was answered. */
async function refusalOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    expect(error).toBeInstanceOf(HubKeyRefused);
    return (error as HubKeyRefused).reason;
  }
  throw new Error('expected the call to be refused');
}

/** Every cell of every row of every table in the file at `path`, as text. */
function everyCell(path: string): readonly string[] {
  const db = new Database(path, { readonly: true });
  try {
    const tables = db
      .query<{ name: string }, []>('SELECT name FROM sqlite_master WHERE type = \'table\'')
      .all()
      .map(({ name }) => name);
    return tables.flatMap((table) => db
      .query<Record<string, unknown>, []>(`SELECT * FROM "${table}"`)
      .all()
      .flatMap((row) => Object.values(row).map((cell) => String(cell))));
  } finally {
    db.close();
  }
}

/** The bytes of the file at `path` and of its WAL and shared-memory files, as latin1 text. */
function fileBytes(path: string): string {
  return [path, `${path}-wal`, `${path}-shm`]
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file).toString('latin1'))
    .join('');
}

describe('mintKey', () => {
  it('answers rafa_ and 32 random bytes in base64url, a new key each time', () => {
    const first = mintKey();
    const second = mintKey();
    expect(first).toMatch(MINTED);
    expect(second).toMatch(MINTED);
    expect(first).not.toBe(second);
    expect(Buffer.from(first.slice('rafa_'.length), 'base64url')).toHaveLength(KEY_BYTES);
  });

  it('spells the bytes it is handed', () => {
    const bytes = new Uint8Array(KEY_BYTES).fill(0xff);
    expect(mintKey(bytes)).toBe(`rafa_${'_'.repeat(42)}8`);
  });

  it('refuses bytes other than 32', () => {
    expect(() => mintKey(new Uint8Array(KEY_BYTES - 1))).toThrow(RangeError);
  });
});

describe('keyDigest', () => {
  it('answers the SHA-256 of the key in lower-case hex', () => {
    const plain = mintKey();
    const expected = createHash('sha256')
      .update(plain)
      .digest('hex');
    expect(keyDigest(plain)).toBe(expected);
    expect(keyDigest(plain)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('keysFileName', () => {
  it('names rafa-hub.keys.sqlite in the store path\'s directory', () => {
    expect(keysFileName('/srv/hub/rafa-hub.sqlite')).toBe(`/srv/hub/${KEYS_FILE}`);
    expect(keysFileName('/srv/hub/projects/alpha.sqlite')).toBe(`/srv/hub/projects/${KEYS_FILE}`);
    expect(keysFileName('rafa-hub.sqlite')).toBe(KEYS_FILE);
  });

  it('is none of the project\'s store, devices or index files', () => {
    const store = '/srv/hub/rafa-hub.sqlite';
    const files = [store, devicesFileName(store), indexFileName(store)];
    expect(files).not.toContain(keysFileName(store));
  });
});

describe('KEY_NAME', () => {
  it('takes a lower-case letter or digit, then up to 63 of those, dots, underscores or dashes', () => {
    for (const name of ['ci', '0', 'laptop.markos', 'build_bot-2', `a${'b'.repeat(63)}`]) expect(KEY_NAME.test(name)).toBe(true);
    for (const name of ['', 'CI', '.ci', '-ci', '_ci', 'ci key', 'ci/key', `a${'b'.repeat(64)}`]) expect(KEY_NAME.test(name)).toBe(false);
  });
});

describe('openSqliteKeyStore', () => {
  let store: HubKeyStore;

  beforeEach(() => {
    store = openSqliteKeyStore({ path: ':memory:', now: ticking(), reservedNames: ['RAFA_HUB_KEY', 'ci_env'] });
  });

  afterEach(() => {
    store.close();
  });

  it('creates a key, answering the plain key once and a row holding none of it', async () => {
    const created = await store.create('laptop', 'markos');
    expect(created.plain).toMatch(MINTED);
    expect(created.key).toEqual({
      name: 'laptop',
      createdBy: 'markos',
      createdAt: '2026-11-17T10:00:00.000Z',
      lastUsedAt: null,
      paused: false,
      deleted: false,
    });
    expect(JSON.stringify(created.key)).not.toContain(created.plain);
    expect(JSON.stringify(await store.list())).not.toContain(created.plain);
  });

  it('finds a key by its digest, and nothing by the plain key or an unknown digest', async () => {
    const { plain } = await store.create('laptop', 'markos');
    expect((await store.findByDigest(keyDigest(plain)))?.name).toBe('laptop');
    expect(await store.findByDigest(plain)).toBeUndefined();
    expect(await store.findByDigest(keyDigest(mintKey()))).toBeUndefined();
  });

  it('refuses a name off the pattern, and a reserved one, as invalid-name', async () => {
    expect(await refusalOf(store.create('Laptop', 'markos'))).toBe('invalid-name');
    expect(await refusalOf(store.create('', 'markos'))).toBe('invalid-name');
    expect(await refusalOf(store.create(`a${'b'.repeat(64)}`, 'markos'))).toBe('invalid-name');
    expect(await refusalOf(store.create('ci_env', 'markos'))).toBe('invalid-name');
    expect(await store.list()).toEqual([]);
  });

  it('refuses a name a key holds, or a deleted key held, as name-taken', async () => {
    await store.create('laptop', 'markos');
    await store.create('ci', 'markos');
    await store.delete('ci');
    expect(await refusalOf(store.create('laptop', 'someone'))).toBe('name-taken');
    expect(await refusalOf(store.create('ci', 'someone'))).toBe('name-taken');
    expect((await store.list()).map(({ name }) => name)).toEqual(['laptop', 'ci']);
  });

  it('names the key and never the key value in a refusal', async () => {
    const { plain } = await store.create('laptop', 'markos');
    try {
      await store.create('laptop', 'markos');
      throw new Error('expected the create to be refused');
    } catch (error) {
      expect((error as HubKeyRefused).keyName).toBe('laptop');
      expect((error as Error).message).toContain('laptop');
      expect((error as Error).message).not.toContain(plain);
      expect((error as Error).message).not.toContain(keyDigest(plain));
    }
  });

  it('lists every key oldest first, deleted ones included', async () => {
    await store.create('first', 'markos');
    await store.create('second', 'markos');
    await store.create('third', 'markos');
    await store.pause('second');
    await store.delete('third');
    const listed = await store.list();
    expect(listed.map(({ name, paused, deleted }) => ({ name, paused, deleted }))).toEqual([
      { name: 'first', paused: false, deleted: false },
      { name: 'second', paused: true, deleted: false },
      { name: 'third', paused: false, deleted: true },
    ]);
  });

  it('pauses a key, answering its row, and a pause again changes nothing', async () => {
    const { plain } = await store.create('laptop', 'markos');
    expect((await store.pause('laptop')).paused).toBe(true);
    expect((await store.pause('laptop')).paused).toBe(true);
    expect((await store.findByDigest(keyDigest(plain)))?.paused).toBe(true);
  });

  it('refuses to pause an unknown key as unknown, and a deleted one as deleted', async () => {
    await store.create('laptop', 'markos');
    await store.delete('laptop');
    expect(await refusalOf(store.pause('nobody'))).toBe('unknown');
    expect(await refusalOf(store.pause('laptop'))).toBe('deleted');
    expect((await store.list())[0]?.paused).toBe(false);
  });

  it('deletes a key by marking it, keeping its name, creator and last use', async () => {
    const { plain } = await store.create('laptop', 'markos');
    await store.stampUse('laptop');
    const before = (await store.list())[0] as HubKey;
    const deleted = await store.delete('laptop');
    expect(deleted).toEqual({ ...before, deleted: true });
    expect(deleted.lastUsedAt).toBe('2026-11-17T10:01:00.000Z');
    expect((await store.findByDigest(keyDigest(plain)))?.deleted).toBe(true);
    expect((await store.delete('laptop')).deleted).toBe(true);
  });

  it('refuses to delete an unknown key as unknown', async () => {
    expect(await refusalOf(store.delete('nobody'))).toBe('unknown');
  });

  it('stamps a key\'s last use at now(), and reads the time back', async () => {
    await store.create('laptop', 'markos');
    await store.stampUse('laptop');
    expect((await store.list())[0]?.lastUsedAt).toBe('2026-11-17T10:01:00.000Z');
    await store.stampUse('laptop');
    expect((await store.list())[0]?.lastUsedAt).toBe('2026-11-17T10:02:00.000Z');
  });

  it('stamps a paused key, and leaves a deleted or unknown name as it was', async () => {
    await store.create('paused', 'markos');
    await store.create('gone', 'markos');
    await store.pause('paused');
    await store.delete('gone');
    await store.stampUse('paused');
    await store.stampUse('gone');
    await store.stampUse('nobody');
    const listed = await store.list();
    expect(listed.map(({ name, lastUsedAt }) => ({ name, lastUsedAt }))).toEqual([
      { name: 'paused', lastUsedAt: '2026-11-17T10:02:00.000Z' },
      { name: 'gone', lastUsedAt: null },
    ]);
  });
});

describe('openSqliteKeyStore over a file', () => {
  let directory: string;
  let path: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'rafa-hub-key-store-'));
    path = keysFileName(join(directory, 'rafa-hub.sqlite'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('creates the file in WAL mode on open, and keeps its rows across a reopen', async () => {
    const first = openSqliteKeyStore({ path, now: ticking() });
    const { plain } = await first.create('laptop', 'markos');
    first.close();
    expect(existsSync(path)).toBe(true);

    const reopened = openSqliteKeyStore({ path, now: ticking() });
    try {
      expect((await reopened.findByDigest(keyDigest(plain)))?.name).toBe('laptop');
      expect(await reopened.list()).toHaveLength(1);
    } finally {
      reopened.close();
    }

    const db = new Database(path, { readonly: true });
    try {
      expect(db.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
    } finally {
      db.close();
    }
  });

  it('holds no plain key in any column of any row, nor in any byte of the file', async () => {
    const store = openSqliteKeyStore({ path, now: ticking() });
    const plains: string[] = [];
    try {
      for (const name of ['laptop', 'ci', 'desktop', 'old']) plains.push((await store.create(name, 'markos')).plain);
      await store.stampUse('laptop');
      await store.pause('ci');
      await store.stampUse('old');
      await store.delete('old');
      const open = fileBytes(path);
      for (const plain of plains) expect(open).not.toContain(plain);
    } finally {
      store.close();
    }

    const cells = everyCell(path);
    const bytes = fileBytes(path);
    for (const plain of plains) {
      const body = plain.slice('rafa_'.length);
      expect(cells.some((cell) => cell.includes(body))).toBe(false);
      expect(bytes).not.toContain(body);
      expect(cells).toContain(keyDigest(plain));
    }
    expect(cells).toContain('laptop');
    expect(cells).toContain('old');
  });

  it('control: the same read finds a key a table does hold', () => {
    const plain = mintKey();
    const db = new Database(path, { create: true, readwrite: true, strict: true });
    db.run('CREATE TABLE leaked (note TEXT) STRICT');
    db.query('INSERT INTO leaked (note) VALUES ($note)').run({ note: `key=${plain}` });
    db.close();
    const body = plain.slice('rafa_'.length);
    expect(everyCell(path).some((cell) => cell.includes(body))).toBe(true);
    expect(fileBytes(path)).toContain(body);
  });
});
