/**
 * Refusal tests held to BOTH backends: the keyless-batch rule from the
 * store port's contract (`types.ts`'s module note), proved once against
 * each opener through a `describe.each`, rather than left to agree with
 * itself inside each backend's own suite.
 *
 * `ndjson.test.ts` and `sqlite.test.ts` each already carry their own
 * keyless-batch cases, spelled in that backend's own idiom — NDJSON
 * bytes read with `node:fs`, SQLite bytes read with `bun:sqlite`
 * directly. This file adds nothing backend-specific. It reads a kind's
 * file generically, through {@link StoreWithPath.path} rather than a
 * backend's own path helper, so the same two calls run unchanged over
 * whichever opener the test table hands them, and pins two properties
 * that hold across both:
 *
 *   - A refused batch leaves the file it targeted byte-identical to
 *     what it held immediately before the call, when that file already
 *     existed.
 *   - A store that has never held a row still creates nothing after a
 *     SECOND refusal, not only a first. Each backend's own suite proves
 *     the first-refusal case; proving the second guards against a
 *     refusal path with a side effect the first call could leave behind
 *     for a second to trip over, such as a directory made ahead of the
 *     key check rather than after it.
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

/** The port, plus the one reading both backends answer beside it. */
interface StoreWithPath extends EffortStore {
  path: (kind: EffortRowKind) => string;
}

/** A session row carrying its key and one counter. The cast is the plant. */
function sessionRow(sessionId: string): EffortRow<'sessions'> {
  return {
    sessionId,
    assistantRecordCount: 1,
  } as unknown as EffortRow<'sessions'>;
}

/** A commit row carrying its key and one counter. The cast is the plant. */
function commitRow(sha: string): EffortRow<'commits'> {
  return { sha, insertions: 1 } as unknown as EffortRow<'commits'>;
}

const S_A = sessionRow('aaaa-1111');
const S_B = sessionRow('bbbb-2222');
const S_C = sessionRow('cccc-3333');

/** Both openers, named as `.rafa/config.yaml`'s `store` key names them. */
const BACKENDS: readonly (readonly [string, (root: string) => StoreWithPath])[] = [
  ['sqlite', openSqliteStore],
  ['ndjson', openNdjsonStore],
];

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-store-refusal-'));
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

describe.each(BACKENDS)('%s: the keyless-batch refusal', (name, open) => {
  it('refuses a batch carrying a keyless row, naming it', () => {
    const root = freshRoot(`${name}-refuses`);
    const store = open(root);

    expect(() => store.append('sessions', [S_A, sessionRow(''), S_B]))
      .toThrow('effort store: row 1 of 3 carries no key; batch refused');
  });

  it('leaves the store file byte-identical after a refused batch', () => {
    const root = freshRoot(`${name}-byte-identical`);
    const store = open(root);
    store.append('sessions', [S_A]);
    const before = rawBytes(store, 'sessions');

    expect(before).not.toBeNull();
    expect(() => store.append('sessions', [S_B, sessionRow(''), S_C]))
      .toThrow(/carries no key; batch refused/);
    expect(rawBytes(store, 'sessions')).toEqual(before);
  });

  it('creates no file at all across two refusals on an empty store', () => {
    const root = freshRoot(`${name}-empty-twice`);
    const store = open(root);

    expect(() => store.append('commits', [commitRow('')]))
      .toThrow(/carries no key; batch refused/);
    expect(existsSync(root)).toBe(false);

    expect(() => store.append('commits', [commitRow('')]))
      .toThrow(/carries no key; batch refused/);
    expect(existsSync(root)).toBe(false);
  });
});
