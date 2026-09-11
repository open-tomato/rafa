/**
 * The shared store contract: the properties the port's module note
 * promises of EVERY backend, proved once against each opener through a
 * `describe.each`, the same shape `refusal.test.ts` already uses for
 * the keyless-batch rule.
 *
 * Each backend's own suite (`ndjson.test.ts`, `sqlite.test.ts`) already
 * covers these properties in that backend's own idiom, planting bytes
 * or rows the way only that storage format allows. This file adds
 * nothing backend-specific. It drives every case through the port's
 * three methods alone — `append`, `keys`, `read` — plus `path`, the one
 * reading both backends answer beside it, so the same assertions run
 * unchanged over whichever opener the test table hands them. What it
 * proves:
 *
 *   - **Append and read-back.** What `read` answers after an `append`
 *     is exactly the rows that were appended, in the order they were
 *     appended, across separate calls and across a freshly opened store
 *     handle over the same root.
 *   - **The key set is derived from the rows, not a sidecar.** `keys`
 *     is not an independent structure a backend could let drift from
 *     what it stores: it equals {@link EFFORT_KEY_PROJECTIONS}'s own
 *     projection applied to what `read` answers, for the very
 *     projection record both backends read `append` and `keys` from.
 *     A second, independent store handle over the same root answers
 *     the same keys as the first, which a handle-held cache could not
 *     do.
 *   - **Duplicate suppression within one batch.** A key repeated inside
 *     a single `append` call is written once, keeping that key's first
 *     occurrence in the batch, with every later occurrence counted as
 *     skipped — whether or not the store already held that key before
 *     the call.
 *   - **An empty append writes nothing.** `append(kind, [])` adds
 *     nothing and skips nothing. On a store that has never held a row
 *     it creates no file. On a store that already holds rows it leaves
 *     every byte of the file it targeted exactly as it was.
 *
 * Every store sits under a fresh temporary repo root, so the suite
 * touches no `.ralph/` anywhere, and the disk is real rather than
 * mocked, as the rest of the store suite's files reason.
 */
import type { EffortRow, EffortRowKind, EffortStore } from './types.js';

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { openNdjsonStore } from './ndjson.js';
import { openSqliteStore } from './sqlite.js';
import { EFFORT_KEY_PROJECTIONS } from './types.js';

/** The port, plus the one reading both backends answer beside it. */
interface StoreWithPath extends EffortStore {
  path: (kind: EffortRowKind) => string;
}

/** A session row carrying its key and one counter. The cast is the plant. */
function sessionRow(
  sessionId: string,
  assistantRecordCount = 1,
): EffortRow<'sessions'> {
  return { sessionId, assistantRecordCount } as unknown as EffortRow<'sessions'>;
}

/** A commit row carrying its key and one counter. The cast is the plant. */
function commitRow(sha: string, insertions = 1): EffortRow<'commits'> {
  return { sha, insertions } as unknown as EffortRow<'commits'>;
}

const S_A = sessionRow('aaaa-1111', 3);
const S_B = sessionRow('bbbb-2222', 7);
const S_C = sessionRow('cccc-3333', 1);
const C_A = commitRow('deadbeef', 4);
const C_B = commitRow('feedface', 9);

/** Both openers, named as `.rafa/config.yaml`'s `store` key names them. */
const BACKENDS: readonly (readonly [string, (root: string) => StoreWithPath])[] = [
  ['sqlite', openSqliteStore],
  ['ndjson', openNdjsonStore],
];

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-store-contract-'));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A repo root of its own, not yet on disk, so no case sees another's. */
function freshRoot(name: string): string {
  planted += 1;
  return join(tempBase, `${planted}-${name}`);
}

/** A kind's file bytes through one store, or null when never written. */
function rawBytes(store: StoreWithPath, kind: EffortRowKind): Buffer | null {
  const path = store.path(kind);
  return existsSync(path)
    ? readFileSync(path)
    : null;
}

/**
 * The key set {@link EFFORT_KEY_PROJECTIONS} derives from what `read`
 * currently answers for one kind — computed from the very record both
 * backends read `keys` and `append` from, so this is not a
 * reimplementation of the rule under test, but the rule applied to the
 * rows a caller could also have read.
 */
function keysFromRows<K extends EffortRowKind>(
  store: StoreWithPath,
  kind: K,
): Set<string> {
  const projection = EFFORT_KEY_PROJECTIONS[kind];
  const keys = store
    .read(kind)
    .map(projection)
    .filter((key): key is string => key !== null);
  return new Set(keys);
}

describe.each(BACKENDS)('%s: the shared store contract', (name, open) => {
  describe('append and read-back', () => {
    it('reads back exactly what was appended, in order', () => {
      const root = freshRoot(`${name}-round-trip`);
      const store = open(root);
      store.append('sessions', [S_A, S_B]);
      store.append('commits', [C_A, C_B]);

      expect(store.read('sessions')).toEqual([S_A, S_B]);
      expect(store.read('commits')).toEqual([C_A, C_B]);
    });

    it('preserves append order across separate calls', () => {
      const root = freshRoot(`${name}-append-order`);
      const store = open(root);
      store.append('sessions', [S_C]);
      store.append('sessions', [S_A]);
      store.append('sessions', [S_B]);

      expect(store.read('sessions')).toEqual([S_C, S_A, S_B]);
    });

    it('is read the same way by a freshly opened handle over the same root', () => {
      const root = freshRoot(`${name}-reopen`);
      open(root).append('commits', [C_A, C_B]);
      const reopened = open(root);

      expect(reopened.read('commits')).toEqual([C_A, C_B]);
    });
  });

  describe('the key set, derived from the rows rather than a sidecar', () => {
    it('equals the kind\'s projection applied to what read answers', () => {
      const root = freshRoot(`${name}-keys-from-rows`);
      const store = open(root);
      store.append('sessions', [S_A, S_B, S_C]);
      store.append('commits', [C_A, C_B]);

      expect(store.keys('sessions')).toEqual(keysFromRows(store, 'sessions'));
      expect(store.keys('commits')).toEqual(keysFromRows(store, 'commits'));
    });

    it('is answered identically by a second, independent store handle', () => {
      const root = freshRoot(`${name}-keys-independent-handle`);
      open(root).append('sessions', [S_A, S_B]);
      const second = open(root);

      expect([...second.keys('sessions')]).toEqual(['aaaa-1111', 'bbbb-2222']);
    });
  });

  describe('duplicate suppression within one batch', () => {
    it('keeps one row per repeated key, counting the rest as skipped', () => {
      const root = freshRoot(`${name}-batch-dupes`);
      const store = open(root);
      const result = store.append('sessions', [S_A, S_B, S_A, S_C, S_B, S_B]);

      expect(result.appended).toBe(3);
      expect(result.skipped).toBe(3);
      expect(store.read('sessions')).toEqual([S_A, S_B, S_C]);
    });

    it('keeps the batch\'s first occurrence of a repeated key', () => {
      const root = freshRoot(`${name}-batch-dupes-first`);
      const store = open(root);
      store.append('sessions', [
        sessionRow('aaaa-1111', 1),
        sessionRow('aaaa-1111', 2),
      ]);

      expect(store.read('sessions')).toEqual([sessionRow('aaaa-1111', 1)]);
    });

    it('combines batch dedupe with dedupe against rows already held', () => {
      const root = freshRoot(`${name}-batch-and-disk-dupes`);
      const store = open(root);
      store.append('sessions', [S_A]);
      const result = store.append('sessions', [S_B, S_A, S_B, S_C]);

      expect(result.appended).toBe(2);
      expect(result.skipped).toBe(2);
      expect(store.read('sessions')).toEqual([S_A, S_B, S_C]);
    });
  });

  describe('an empty append', () => {
    it('writes nothing and creates no store on one that never held a row', () => {
      const root = freshRoot(`${name}-empty-on-absent`);
      const store = open(root);
      const result = store.append('sessions', []);

      expect(result.appended).toBe(0);
      expect(result.skipped).toBe(0);
      expect(existsSync(root)).toBe(false);
    });

    it('changes no byte of a store that already holds rows', () => {
      const root = freshRoot(`${name}-empty-on-existing`);
      const store = open(root);
      store.append('commits', [C_A, C_B]);
      const before = rawBytes(store, 'commits');
      const result = store.append('commits', []);

      expect(result.appended).toBe(0);
      expect(result.skipped).toBe(0);
      expect(rawBytes(store, 'commits')).toEqual(before);
    });
  });
});
