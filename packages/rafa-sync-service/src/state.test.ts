/**
 * Tests for the `service` strategy's state file (`state.ts`): both
 * cursors kept under a store's origin for one hub, every other origin's
 * entry dropped on a write, and a file this module did not write read
 * as holding no cursors. Every file lives under this file's temporary
 * directory.
 */
import { chmodSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  readSyncCursors,
  SYNC_STATE_FILE_NAME,
  SYNC_STATE_FORMAT,
  SYNC_STATE_VERSION,
  syncStatePath,
  writeSyncCursor,
} from './state.js';

const HUB = 'https://hub.example.invalid';
const OTHER_HUB = 'https://other-hub.example.invalid';
const ORIGIN = 'aaaaaaaa-0000-4000-8000-00000000000a';
const OTHER_ORIGIN = 'bbbbbbbb-0000-4000-8000-00000000000b';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-sync-service-state-')));

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** A state file path in a fresh directory of its own. */
function freshState(): string {
  return syncStatePath(join(realpathSync(mkdtempSync(join(scope, 'store-'))), 'effort.sqlite'));
}

/** Writes `value` as the file at `path`, as JSON. */
function plant(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value), 'utf8');
}

describe('syncStatePath', () => {
  it('names the state file beside the store file', () => {
    expect(syncStatePath('/project/.rafa/effort/effort.sqlite')).toBe(`/project/.rafa/effort/${SYNC_STATE_FILE_NAME}`);
  });
});

describe('readSyncCursors', () => {
  it('reads no cursors from a file that is not there', () => {
    expect(readSyncCursors(freshState(), ORIGIN, HUB)).toEqual({ push: {}, pull: {} });
  });

  it('reads the cursors written for the origin and the hub', () => {
    const path = freshState();
    writeSyncCursor(path, ORIGIN, HUB, 'push', { commits: 4 });
    writeSyncCursor(path, ORIGIN, HUB, 'pull', { commits: 9, sessions: 2 });
    expect(readSyncCursors(path, ORIGIN, HUB)).toEqual({ push: { commits: 4 }, pull: { commits: 9, sessions: 2 } });
  });

  it('reads none for another origin, or for the same origin at another hub', () => {
    const path = freshState();
    writeSyncCursor(path, ORIGIN, HUB, 'push', { commits: 4 });
    expect(readSyncCursors(path, OTHER_ORIGIN, HUB)).toEqual({ push: {}, pull: {} });
    expect(readSyncCursors(path, ORIGIN, OTHER_HUB)).toEqual({ push: {}, pull: {} });
    expect(readSyncCursors(path, 'constructor', HUB)).toEqual({ push: {}, pull: {} });
  });

  it('reads none from a file that is not JSON, not this format or version, or holds a bad cursor', () => {
    const path = freshState();
    const good = { hub: HUB, push: { commits: 1 }, pull: {} };
    const readings = [
      '{ not json',
      JSON.stringify({ format: 'other', version: SYNC_STATE_VERSION, stores: { [ORIGIN]: good } }),
      JSON.stringify({ format: SYNC_STATE_FORMAT, version: 2, stores: { [ORIGIN]: good } }),
      JSON.stringify({ format: SYNC_STATE_FORMAT, version: SYNC_STATE_VERSION, stores: { [ORIGIN]: { ...good, push: { commits: -1 } } } }),
      JSON.stringify({ format: SYNC_STATE_FORMAT, version: SYNC_STATE_VERSION, stores: { [ORIGIN]: { ...good, pull: { commits: 1.5 } } } }),
      JSON.stringify({ format: SYNC_STATE_FORMAT, version: SYNC_STATE_VERSION, stores: { [ORIGIN]: { ...good, hub: 7 } } }),
    ].map((text) => {
      writeFileSync(path, text, 'utf8');
      return readSyncCursors(path, ORIGIN, HUB);
    });
    expect(readings).toEqual(Array.from({ length: 6 }, () => ({ push: {}, pull: {} })));

    plant(path, { format: SYNC_STATE_FORMAT, version: SYNC_STATE_VERSION, stores: { [ORIGIN]: good } });
    expect(readSyncCursors(path, ORIGIN, HUB)).toEqual({ push: { commits: 1 }, pull: {} });
  });

  it.skipIf(process.getuid?.() === 0)('throws a read the file\'s permissions refuse, rather than read it as none', () => {
    const path = freshState();
    writeSyncCursor(path, ORIGIN, HUB, 'push', { commits: 1 });
    chmodSync(path, 0o000);
    try {
      expect(() => readSyncCursors(path, ORIGIN, HUB)).toThrow('EACCES');
    } finally {
      chmodSync(path, 0o600);
    }
    expect(readSyncCursors(path, ORIGIN, HUB)).toEqual({ push: { commits: 1 }, pull: {} });
  });
});

describe('writeSyncCursor', () => {
  it('writes this format and version, holding only the origin written, with no temporary file left', () => {
    const path = freshState();
    writeSyncCursor(path, OTHER_ORIGIN, HUB, 'push', { commits: 3 });
    writeSyncCursor(path, ORIGIN, HUB, 'pull', { commits: 5 });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      format: SYNC_STATE_FORMAT,
      version: SYNC_STATE_VERSION,
      stores: { [ORIGIN]: { hub: HUB, push: {}, pull: { commits: 5 } } },
    });
    expect(readdirSync(join(path, '..'))).toEqual([SYNC_STATE_FILE_NAME]);
  });

  it('keeps the other cursor for the same hub and drops it for another', () => {
    const path = freshState();
    writeSyncCursor(path, ORIGIN, HUB, 'push', { commits: 3 });
    writeSyncCursor(path, ORIGIN, HUB, 'pull', { commits: 5 });
    expect(readSyncCursors(path, ORIGIN, HUB).push).toEqual({ commits: 3 });
    writeSyncCursor(path, ORIGIN, OTHER_HUB, 'pull', { commits: 1 });
    expect(readSyncCursors(path, ORIGIN, OTHER_HUB)).toEqual({ push: {}, pull: { commits: 1 } });
    expect(readSyncCursors(path, ORIGIN, HUB)).toEqual({ push: {}, pull: {} });
  });

  it('keeps an origin spelled __proto__ as an own entry', () => {
    const path = freshState();
    writeSyncCursor(path, '__proto__', HUB, 'push', { commits: 2 });
    expect(readSyncCursors(path, '__proto__', HUB).push).toEqual({ commits: 2 });
    expect(Object.keys((JSON.parse(readFileSync(path, 'utf8')) as { stores: object }).stores)).toEqual(['__proto__']);
  });
});
