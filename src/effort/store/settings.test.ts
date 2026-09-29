/**
 * Tests for the effort store's active settings, and for the one place
 * they act: the busy timeout `withSqliteStore` sets on every open.
 *
 * The setter's cases are pure. The lock cases open a real store under
 * a fresh temporary root, since a busy timeout is a property of a
 * connection meeting another's lock on a file:
 *
 *   - Within the timeout, a CHILD process holds `BEGIN EXCLUSIVE` and
 *     lets go after {@link RELEASE_MS}. The holder has to be another
 *     process, because an open in this one blocks its thread, and a
 *     holder here could not let go while it waits. The case reads how
 *     long the open took, so an open that never met the lock (a holder
 *     that had not taken it yet) fails rather than passing as a wait.
 *   - Past the timeout, a connection in this process holds the lock and
 *     never lets go, and the open throws `SQLITE_BUSY`. The case reads
 *     how long the throw took against a timeout far below the default,
 *     so an open that ignored the setting and waited the default five
 *     seconds fails.
 *
 * Every case that sets a value puts the default back after it, since
 * the settings are module state and bun runs every test file in one
 * process.
 */
import type { SessionEffortRow } from './types.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { CONFIG_DEFAULTS } from '../../config-schema.js';

import { activeStoreSettings, setActiveStoreSettings } from './settings.js';
import { openSqliteStore, sqliteStorePath, withSqliteStore } from './sqlite.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-store-settings-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

afterEach(() => {
  setActiveStoreSettings(null);
});

/** A repo root holding a current store with one session row, and its store file. */
function currentStore(name: string): string {
  planted += 1;
  const root = join(tempRoot, `${String(planted)}-${name}`);
  const row = { sessionId: 'aaaa-1111', assistantRecordCount: 1 } as unknown as SessionEffortRow;
  openSqliteStore(root).append('sessions', [row]);
  return sqliteStorePath(root);
}

/** The session rows an open of `path` counts once it gets in. */
function countSessions(path: string): number {
  return withSqliteStore(path, 'read', false, (db) => db
    .query<{ n: number }, []>('SELECT count(*) AS n FROM sessions')
    .get()?.n ?? -1);
}

/** What `run` threw, or null when it threw nothing. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

describe('setActiveStoreSettings', () => {
  it('starts at the config default, five seconds', () => {
    expect(activeStoreSettings()).toEqual({ busyTimeoutMs: CONFIG_DEFAULTS.effortBusyTimeoutMs });
    expect(activeStoreSettings().busyTimeoutMs).toBe(5000);
  });

  it.each([1, 60_000])('accepts %d, a bound, and null puts the default back', (busyTimeoutMs) => {
    setActiveStoreSettings({ busyTimeoutMs });
    const set = activeStoreSettings().busyTimeoutMs;
    setActiveStoreSettings(null);

    expect([set, activeStoreSettings().busyTimeoutMs]).toEqual([busyTimeoutMs, 5000]);
  });

  it.each([0, -1, 60_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %d with a RangeError, keeping the value it had',
    (busyTimeoutMs) => {
      setActiveStoreSettings({ busyTimeoutMs: 250 });

      expect(() => setActiveStoreSettings({ busyTimeoutMs })).toThrow(RangeError);
      expect(activeStoreSettings().busyTimeoutMs).toBe(250);
    },
  );

  it('keeps a copy, so the object it was handed can change without moving it', () => {
    const handed = { busyTimeoutMs: 250 };
    setActiveStoreSettings(handed);
    handed.busyTimeoutMs = 0;

    expect(activeStoreSettings().busyTimeoutMs).toBe(250);
  });
});

describe('the busy timeout on a store open', () => {
  /** How long the child holds the lock once it says it has it. */
  const RELEASE_MS = 600;

  /**
   * A child process that takes the exclusive lock on `path`, prints
   * `held`, and lets go {@link RELEASE_MS} later.
   */
  function spawnHolder(path: string): Bun.Subprocess<'ignore', 'pipe', 'pipe'> {
    const script = `
      import { Database } from 'bun:sqlite';
      const db = new Database(${JSON.stringify(path)}, { readwrite: true, create: false });
      db.run('BEGIN EXCLUSIVE');
      setTimeout(() => { db.run('ROLLBACK'); db.close(); }, ${String(RELEASE_MS)});
      process.stdout.write('held');
    `;
    return Bun.spawn(['bun', '-e', script], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  }

  /** Resolves once the child has printed that it holds the lock. */
  async function heldBy(child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>): Promise<void> {
    const reader = child.stdout.getReader();
    const { value } = await reader.read();
    reader.releaseLock();
    expect(new TextDecoder().decode(value)).toBe('held');
  }

  it('waits on a lock another process holds and gets in once it is let go, within the timeout', async () => {
    const path = currentStore('within');
    setActiveStoreSettings({ busyTimeoutMs: 5000 });
    const holder = spawnHolder(path);
    await heldBy(holder);

    const started = Date.now();
    const count = countSessions(path);
    const waited = Date.now() - started;

    expect(count).toBe(1);
    expect(waited).toBeGreaterThanOrEqual(RELEASE_MS / 2);
    expect(waited).toBeLessThan(5000);
    expect(await holder.exited).toBe(0);
  }, 15_000);

  it('throws SQLITE_BUSY once the timeout passes with the lock still held', () => {
    const path = currentStore('past');
    const busyTimeoutMs = 100;
    setActiveStoreSettings({ busyTimeoutMs });
    const holder = new Database(path, { readwrite: true, create: false });
    try {
      holder.run('BEGIN EXCLUSIVE');
      const started = Date.now();
      const error = thrownBy(() => countSessions(path));
      const waited = Date.now() - started;

      expect(error).toMatchObject({ code: 'SQLITE_BUSY', message: 'database is locked' });
      expect(waited).toBeGreaterThanOrEqual(busyTimeoutMs);
      expect(waited).toBeLessThan(CONFIG_DEFAULTS.effortBusyTimeoutMs);
      holder.run('ROLLBACK');
    } finally {
      holder.close();
    }

    expect(countSessions(path)).toBe(1);
  }, 15_000);
});
