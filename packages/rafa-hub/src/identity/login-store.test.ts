/**
 * The hub login store (`login-store.ts`): setting, replacing and
 * checking the one login, the refusals of an empty or padded name or an
 * empty password, the bootstrap from the two variables only when no
 * login is set, and over a file, the table beside the key store's, a
 * reopen, and a read of every cell and byte finding the hash but never
 * the password, with a control showing that read finds a password a
 * table does hold.
 *
 * Every case opens its own store, in `:memory:` or a file under a
 * scratch directory of its own, so no case reads another's rows.
 */
import type { HubLoginStore } from './login-store.js';

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { keysFileName, openSqliteKeyStore } from './key-store.js';
import {
  bootstrapLoginFromEnv,
  LOGIN_PASSWORD_VARIABLE,
  LOGIN_USER_VARIABLE,
  openSqliteLoginStore,
} from './login-store.js';

const PASSWORD = 'correct horse battery staple';

/** A clock that answers `start`, a minute later each time it is read. */
function ticking(start = '2026-11-17T10:00:00.000Z'): () => Date {
  let at = Date.parse(start);
  return () => {
    const answer = new Date(at);
    at += 60_000;
    return answer;
  };
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

describe('openSqliteLoginStore', () => {
  let store: HubLoginStore;

  beforeEach(() => {
    store = openSqliteLoginStore({ path: ':memory:', now: ticking() });
  });

  afterEach(() => {
    store.close();
  });

  it('holds no login when opened on a new file', async () => {
    expect(await store.hasLogin()).toBe(false);
    expect(await store.verifyLogin('markos', PASSWORD)).toBe(false);
  });

  it('sets a login, answering its name and time and nothing of the password', async () => {
    const login = await store.setLogin('markos', PASSWORD);
    expect(login).toEqual({ user: 'markos', setAt: '2026-11-17T10:00:00.000Z' });
    expect(JSON.stringify(login)).not.toContain(PASSWORD);
    expect(await store.hasLogin()).toBe(true);
  });

  it('verifies the login\'s name and password, and refuses either one wrong', async () => {
    await store.setLogin('markos', PASSWORD);
    expect(await store.verifyLogin('markos', PASSWORD)).toBe(true);
    expect(await store.verifyLogin('markos', `${PASSWORD}!`)).toBe(false);
    expect(await store.verifyLogin('markos', '')).toBe(false);
    expect(await store.verifyLogin('someone', PASSWORD)).toBe(false);
    expect(await store.verifyLogin('Markos', PASSWORD)).toBe(false);
  });

  it('replaces the login on a second set, so the first no longer verifies', async () => {
    await store.setLogin('markos', PASSWORD);
    const second = await store.setLogin('admin', 'another password');
    expect(second).toEqual({ user: 'admin', setAt: '2026-11-17T10:01:00.000Z' });
    expect(await store.verifyLogin('markos', PASSWORD)).toBe(false);
    expect(await store.verifyLogin('admin', 'another password')).toBe(true);
  });

  it('refuses an empty name, a padded name and an empty password, keeping the login as it was', async () => {
    await store.setLogin('markos', PASSWORD);
    await expect(store.setLogin('', PASSWORD)).rejects.toThrow(RangeError);
    await expect(store.setLogin(' markos', PASSWORD)).rejects.toThrow(RangeError);
    await expect(store.setLogin('markos ', PASSWORD)).rejects.toThrow(RangeError);
    await expect(store.setLogin('markos', '')).rejects.toThrow(RangeError);
    expect(await store.verifyLogin('markos', PASSWORD)).toBe(true);
  });

  it('refuses a user name holding a colon, which Authorization: Basic could never carry', async () => {
    await expect(store.setLogin('mar:kos', PASSWORD)).rejects.toThrow('holds no ":"');
    await expect(store.setLogin(':', PASSWORD)).rejects.toThrow(RangeError);
    expect(await store.hasLogin()).toBe(false);
    await store.setLogin('markos', 'a pass:word');
    expect(await store.verifyLogin('markos', 'a pass:word')).toBe(true);
  });
});

describe('bootstrapLoginFromEnv', () => {
  let store: HubLoginStore;

  beforeEach(() => {
    store = openSqliteLoginStore({ path: ':memory:', now: ticking() });
  });

  afterEach(() => {
    store.close();
  });

  it('sets the login from the two variables when none is set', async () => {
    const env = { [LOGIN_USER_VARIABLE]: 'markos', [LOGIN_PASSWORD_VARIABLE]: PASSWORD };
    expect(await bootstrapLoginFromEnv(store, env)).toEqual({
      outcome: 'set',
      login: { user: 'markos', setAt: '2026-11-17T10:00:00.000Z' },
    });
    expect(await store.verifyLogin('markos', PASSWORD)).toBe(true);
  });

  it('keeps a set login whatever the variables hold', async () => {
    await store.setLogin('admin', 'changed since');
    const env = { [LOGIN_USER_VARIABLE]: 'markos', [LOGIN_PASSWORD_VARIABLE]: PASSWORD };
    expect(await bootstrapLoginFromEnv(store, env)).toEqual({ outcome: 'kept' });
    expect(await store.verifyLogin('admin', 'changed since')).toBe(true);
    expect(await store.verifyLogin('markos', PASSWORD)).toBe(false);
  });

  it('sets nothing when neither variable holds a value', async () => {
    expect(await bootstrapLoginFromEnv(store, {})).toEqual({ outcome: 'unset' });
    expect(await bootstrapLoginFromEnv(store, { [LOGIN_USER_VARIABLE]: '', [LOGIN_PASSWORD_VARIABLE]: '' })).toEqual({ outcome: 'unset' });
    expect(await store.hasLogin()).toBe(false);
  });

  it('sets nothing when one variable is set without the other, naming the empty one', async () => {
    expect(await bootstrapLoginFromEnv(store, { [LOGIN_USER_VARIABLE]: 'markos' }))
      .toEqual({ outcome: 'incomplete', missing: LOGIN_PASSWORD_VARIABLE });
    expect(await bootstrapLoginFromEnv(store, { [LOGIN_USER_VARIABLE]: '', [LOGIN_PASSWORD_VARIABLE]: PASSWORD }))
      .toEqual({ outcome: 'incomplete', missing: LOGIN_USER_VARIABLE });
    expect(await store.hasLogin()).toBe(false);
  });

  it('refuses a user name holding a colon from the variable, setting nothing', async () => {
    const env = { [LOGIN_USER_VARIABLE]: 'mar:kos', [LOGIN_PASSWORD_VARIABLE]: PASSWORD };
    await expect(bootstrapLoginFromEnv(store, env)).rejects.toThrow('holds no ":"');
    expect(await store.hasLogin()).toBe(false);
  });

  it('names the two variables the task gives', () => {
    expect(LOGIN_USER_VARIABLE).toBe('RAFA_HUB_LOGIN_USER');
    expect(LOGIN_PASSWORD_VARIABLE).toBe('RAFA_HUB_LOGIN_PASSWORD');
  });
});

describe('openSqliteLoginStore over a file', () => {
  let directory: string;
  let path: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'rafa-hub-login-store-'));
    path = keysFileName(directory);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('creates the file in WAL mode, keeps the login across a reopen, and shares the file with the key store', async () => {
    const keys = openSqliteKeyStore({ path, now: ticking() });
    await keys.create('laptop', 'markos');
    const first = openSqliteLoginStore({ path, now: ticking() });
    await first.setLogin('markos', PASSWORD);
    first.close();
    keys.close();

    const reopened = openSqliteLoginStore({ path });
    const keysAgain = openSqliteKeyStore({ path });
    try {
      expect(await reopened.verifyLogin('markos', PASSWORD)).toBe(true);
      expect((await keysAgain.list()).map(({ name }) => name)).toEqual(['laptop']);
    } finally {
      reopened.close();
      keysAgain.close();
    }

    const db = new Database(path, { readonly: true });
    try {
      expect(db.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
      const tables = db
        .query<{ name: string }, []>('SELECT name FROM sqlite_master WHERE type = \'table\' ORDER BY name')
        .all()
        .map(({ name }) => name);
      expect(tables).toEqual(['hub_keys', 'hub_login']);
    } finally {
      db.close();
    }
  });

  it('holds the hash and never the password in any cell or byte of the file', async () => {
    const store = openSqliteLoginStore({ path, now: ticking() });
    try {
      await store.setLogin('markos', 'first password here');
      await store.setLogin('markos', PASSWORD);
      const open = fileBytes(path);
      expect(open).not.toContain(PASSWORD);
      expect(open).not.toContain('first password here');
    } finally {
      store.close();
    }

    const cells = everyCell(path);
    expect(cells).toContain('markos');
    expect(cells.some((cell) => cell.startsWith('$argon2'))).toBe(true);
    expect(cells.some((cell) => cell.includes(PASSWORD))).toBe(false);
    expect(fileBytes(path)).not.toContain(PASSWORD);
  });

  it('control: the same read finds a password a table does hold', () => {
    const db = new Database(path, { create: true, readwrite: true, strict: true });
    db.run('CREATE TABLE leaked (note TEXT) STRICT');
    db.query('INSERT INTO leaked (note) VALUES ($note)').run({ note: `password=${PASSWORD}` });
    db.close();
    expect(everyCell(path).some((cell) => cell.includes(PASSWORD))).toBe(true);
    expect(fileBytes(path)).toContain(PASSWORD);
  });
});
