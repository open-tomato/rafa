/**
 * Tests for the `service` strategy's state file (`state.ts`): both
 * cursors kept under a store's origin for one hub, every other origin's
 * entry dropped on a write, a file this module did not write read as
 * holding no cursors, a version 1 file read down, and `heldBack` kept
 * at the first projected contact. Every file lives under this file's
 * temporary directory.
 */
import { chmodSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  clearHeldBack,
  keepHeldBack,
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

const SINCE = '2026-11-20T10:00:00.000Z';
const LATER = '2026-11-21T10:00:00.000Z';

/**
 * The version predicate `readStores` shipped with at version 1 (base
 * 8ee910c9, `state.ts:125`): whether a parsed file is read at all. A
 * build still on version 1 reads every other file as holding nothing.
 */
function shippedVersion1Reads(parsed: unknown): boolean {
  const record = parsed as { format?: unknown; version?: unknown };
  return typeof parsed === 'object' && parsed !== null && record.format === SYNC_STATE_FORMAT && record.version === 1;
}

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
      JSON.stringify({ format: SYNC_STATE_FORMAT, version: SYNC_STATE_VERSION + 1, stores: { [ORIGIN]: good } }),
      JSON.stringify({ format: SYNC_STATE_FORMAT, version: SYNC_STATE_VERSION, stores: { [ORIGIN]: { ...good, push: { commits: -1 } } } }),
      JSON.stringify({ format: SYNC_STATE_FORMAT, version: SYNC_STATE_VERSION, stores: { [ORIGIN]: { ...good, pull: { commits: 1.5 } } } }),
      JSON.stringify({ format: SYNC_STATE_FORMAT, version: SYNC_STATE_VERSION, stores: { [ORIGIN]: { ...good, hub: 7 } } }),
      JSON.stringify({ format: SYNC_STATE_FORMAT, version: SYNC_STATE_VERSION, stores: { [ORIGIN]: { ...good, heldBack: { cursor: { commits: -1 }, since: SINCE } } } }),
      JSON.stringify({ format: SYNC_STATE_FORMAT, version: SYNC_STATE_VERSION, stores: { [ORIGIN]: { ...good, heldBack: { cursor: {}, since: 'not a time' } } } }),
    ].map((text) => {
      writeFileSync(path, text, 'utf8');
      return readSyncCursors(path, ORIGIN, HUB);
    });
    expect(readings).toEqual(Array.from({ length: 8 }, () => ({ push: {}, pull: {} })));

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

describe('the version 1 read-down', () => {
  it('reads a version 1 file with its push and pull cursors kept and no heldBack', () => {
    const path = freshState();
    plant(path, {
      format: SYNC_STATE_FORMAT,
      version: 1,
      stores: { [ORIGIN]: { hub: HUB, push: { commits: 4 }, pull: { commits: 9, sessions: 2 } } },
    });
    const read = readSyncCursors(path, ORIGIN, HUB);
    expect(read).toEqual({ push: { commits: 4 }, pull: { commits: 9, sessions: 2 } });
    expect('heldBack' in read).toBe(false);
  });

  it('rewrites a version 1 file as this version on the next write, keeping the other cursor', () => {
    const path = freshState();
    plant(path, { format: SYNC_STATE_FORMAT, version: 1, stores: { [ORIGIN]: { hub: HUB, push: { commits: 4 }, pull: {} } } });
    writeSyncCursor(path, ORIGIN, HUB, 'pull', { commits: 7 });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      format: SYNC_STATE_FORMAT,
      version: SYNC_STATE_VERSION,
      stores: { [ORIGIN]: { hub: HUB, push: { commits: 4 }, pull: { commits: 7 } } },
    });
  });

  it('is read as empty by the shipped version 1 predicate once written at this version', () => {
    const path = freshState();
    writeSyncCursor(path, ORIGIN, HUB, 'pull', { commits: 7 });
    keepHeldBack(path, ORIGIN, HUB, { cursor: { commits: 7 }, since: SINCE });
    expect(SYNC_STATE_VERSION).toBe(2);
    expect(shippedVersion1Reads(JSON.parse(readFileSync(path, 'utf8')))).toBe(false);

    // Control: the same predicate reads a version 1 file, so the false above is the version's doing.
    plant(path, { format: SYNC_STATE_FORMAT, version: 1, stores: { [ORIGIN]: { hub: HUB, push: {}, pull: { commits: 7 } } } });
    expect(shippedVersion1Reads(JSON.parse(readFileSync(path, 'utf8')))).toBe(true);
  });
});

describe('keepHeldBack', () => {
  it('keeps the first heldBack over two projected writes', () => {
    const path = freshState();
    writeSyncCursor(path, ORIGIN, HUB, 'pull', { commits: 3 });
    const first = { cursor: { commits: 3 }, since: SINCE };
    expect(keepHeldBack(path, ORIGIN, HUB, first)).toEqual(first);
    writeSyncCursor(path, ORIGIN, HUB, 'pull', { commits: 8 });
    expect(keepHeldBack(path, ORIGIN, HUB, { cursor: { commits: 8 }, since: LATER })).toEqual(first);
    writeSyncCursor(path, ORIGIN, HUB, 'pull', { commits: 12 });
    expect(readSyncCursors(path, ORIGIN, HUB)).toEqual({ push: {}, pull: { commits: 12 }, heldBack: first });
  });

  it('keeps both cursors when it sets heldBack, and a cursor write keeps heldBack', () => {
    const path = freshState();
    writeSyncCursor(path, ORIGIN, HUB, 'push', { commits: 2 });
    writeSyncCursor(path, ORIGIN, HUB, 'pull', { commits: 5 });
    keepHeldBack(path, ORIGIN, HUB, { cursor: { commits: 5 }, since: SINCE });
    writeSyncCursor(path, ORIGIN, HUB, 'push', { commits: 6 });
    expect(readSyncCursors(path, ORIGIN, HUB)).toEqual({
      push: { commits: 6 },
      pull: { commits: 5 },
      heldBack: { cursor: { commits: 5 }, since: SINCE },
    });
  });

  it('holds heldBack per store and per hub', () => {
    const path = freshState();
    keepHeldBack(path, ORIGIN, HUB, { cursor: {}, since: SINCE });
    expect(readSyncCursors(path, OTHER_ORIGIN, HUB)).toEqual({ push: {}, pull: {} });
    expect(readSyncCursors(path, ORIGIN, OTHER_HUB)).toEqual({ push: {}, pull: {} });
    const other = { cursor: { commits: 1 }, since: LATER };
    expect(keepHeldBack(path, ORIGIN, OTHER_HUB, other)).toEqual(other);
  });
});

describe('clearHeldBack', () => {
  it('clears heldBack and keeps both cursors, so the next projected contact sets it again', () => {
    const path = freshState();
    writeSyncCursor(path, ORIGIN, HUB, 'push', { commits: 2 });
    writeSyncCursor(path, ORIGIN, HUB, 'pull', { commits: 5 });
    keepHeldBack(path, ORIGIN, HUB, { cursor: { commits: 1 }, since: SINCE });
    clearHeldBack(path, ORIGIN, HUB);
    expect(readSyncCursors(path, ORIGIN, HUB)).toEqual({ push: { commits: 2 }, pull: { commits: 5 } });
    const next = { cursor: { commits: 5 }, since: LATER };
    expect(keepHeldBack(path, ORIGIN, HUB, next)).toEqual(next);
  });

  it('writes nothing when no heldBack is set', () => {
    const path = freshState();
    clearHeldBack(path, ORIGIN, HUB);
    expect(readdirSync(join(path, '..'))).toEqual([]);
  });
});
