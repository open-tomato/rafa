/**
 * Tests for the NDJSON backend of the effort store port.
 *
 * Every store sits under a fresh temporary repo root, so the suite
 * touches no `.ralph/` anywhere and runs on a machine that has never
 * run the loop. The disk is real rather than mocked, for the reason the
 * sibling's suite gives: the rules under test are properties of a file.
 *
 * The backend owns routing, and the rules it routes to are the
 * sibling's, so the cases split along that line. The layout and key
 * cases pin the routing against expectations spelled HERE, the paths,
 * the file names and the key fields, rather than read off the module,
 * so a backend routed wrongly fails instead of agreeing with itself.
 * The rule cases hold the sibling's rules at the port's surface, while
 * `effort/store.test.ts` covers the functions underneath. The parity
 * case replays one sequence of batches, a planted partial line and a
 * refusal included, through this backend and through the sibling's
 * store opened with the projections the sibling's collector binds, and
 * requires the same bytes and the same answers at every step. It
 * imports that store directly, so retiring `effort/store.ts` has to
 * carry this case over rather than drop it.
 *
 * Rows are planted by casting partial objects, as the port's own suite
 * plants them: the store reads one field of a row, and a row read back
 * from a file is only as typed as the file.
 *
 * Seventeen module mutations were driven against this file and every
 * one reddened at least one case, with the original green before them
 * and restored byte-identical after: routing each of `path`, `append`,
 * `keys` and `read` to a fixed or swapped kind's file, deduplicating
 * both kinds' appends by the session id, projecting both kinds' keys by
 * the sha, projecting keys with a fallback to the other kind's key,
 * appending a batch one row at a time, creating the directory on open,
 * creating it ahead of the key check, dropping the unparsed count,
 * dropping the separator reading, caching the key set, caching the row
 * array, moving the directory to `.rafa/effort`, renaming the files to
 * `.jsonl`, and writing a key sidecar beside the file.
 *
 * Two compile-time claims were driven red against `check-types`, each
 * with a mutated copy planted beside the module and moved out after. A
 * backend `keys` narrower than the port's was refused (TS2430). A third
 * kind added to the port's row map and key record failed at each of
 * the module's four file resolutions (TS2345), while the mutated port
 * itself compiled, which is the module note's claim about a new kind.
 */
import type { NdjsonAppendResult } from './ndjson.js';
import type {
  CommitEffortRow,
  EffortRowKind,
  SessionEffortRow,
} from './types.js';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { openEffortStore } from '../store.js';

import { openNdjsonStore } from './ndjson.js';

/** A session row carrying its key and one counter. The cast is the plant. */
function sessionRow(
  sessionId: string,
  assistantRecordCount = 1,
): SessionEffortRow {
  return { sessionId, assistantRecordCount } as unknown as SessionEffortRow;
}

/** A commit row carrying its key and one counter. The cast is the plant. */
function commitRow(sha: string, insertions = 1): CommitEffortRow {
  return { sha, insertions } as unknown as CommitEffortRow;
}

const S_A = sessionRow('aaaa-1111', 3);
const S_B = sessionRow('bbbb-2222', 7);
const S_C = sessionRow('cccc-3333', 1);
const C_A = commitRow('deadbeef', 4);
const C_B = commitRow('feedface', 9);

/** A fragment of S_B, as a run killed mid-write leaves it. */
const HALF_B = JSON.stringify(S_B).slice(0, 20);

/** Each kind's file name, spelled here rather than read off the module. */
const FILE_NAMES: Readonly<Record<EffortRowKind, string>> = {
  sessions: 'sessions.ndjson',
  commits: 'commits.ndjson',
};

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-ndjson-store-'));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A repo root of its own, not yet on disk, so no case sees another's. */
function freshRoot(name: string): string {
  planted += 1;
  return join(tempBase, `${planted}-${name}`);
}

/** Where both kinds live under a root. */
function storeDir(root: string): string {
  return join(root, '.ralph', 'effort');
}

/** One kind's file under a root. */
function kindFile(root: string, kind: EffortRowKind): string {
  return join(storeDir(root), FILE_NAMES[kind]);
}

/**
 * Writes a kind's file verbatim, a partial last line included. Built
 * with `node:fs` rather than the module under test, so a planted store
 * cannot share a fault with the writer that reads it back.
 */
function plant(root: string, kind: EffortRowKind, text: string): void {
  mkdirSync(storeDir(root), { recursive: true });
  writeFileSync(kindFile(root, kind), text, 'utf8');
}

/** A kind's bytes, or null when nothing was ever written. */
function readRaw(root: string, kind: EffortRowKind): string | null {
  const path = kindFile(root, kind);
  return existsSync(path)
    ? readFileSync(path, 'utf8')
    : null;
}

/** The bytes a batch of rows is stored as: one JSON line each. */
function linesOf(...rows: readonly object[]): string {
  return rows.map((row) => `${JSON.stringify(row)}\n`).join('');
}

/** An append's answer with its path left out, which differs by root. */
function answers(
  result: Pick<NdjsonAppendResult, 'appended' | 'skipped'
    | 'separatedPartialLine'>,
): readonly [number, number, boolean] {
  return [result.appended, result.skipped, result.separatedPartialLine];
}

/** The message a call throws. Fails the case when it throws nothing. */
function refusalOf(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    return error instanceof Error
      ? error.message
      : String(error);
  }
  throw new Error('expected the call to throw');
}

describe('openNdjsonStore layout', () => {
  it('keeps each kind in its own file under .ralph/effort', () => {
    const root = freshRoot('layout');
    const store = openNdjsonStore(root);
    store.append('sessions', [S_A, S_B]);
    store.append('commits', [C_A]);

    expect(readdirSync(storeDir(root)).sort())
      .toEqual(['commits.ndjson', 'sessions.ndjson']);
    expect(readRaw(root, 'sessions')).toBe(linesOf(S_A, S_B));
    expect(readRaw(root, 'commits')).toBe(linesOf(C_A));
  });

  it('answers each kind its own file as the path, written or not', () => {
    const root = freshRoot('paths');
    const store = openNdjsonStore(root);

    expect(store.path('sessions')).toBe(kindFile(root, 'sessions'));
    expect(store.path('commits')).toBe(kindFile(root, 'commits'));
    expect(store.append('sessions', [S_A]).path)
      .toBe(kindFile(root, 'sessions'));
    expect(store.append('commits', []).path).toBe(kindFile(root, 'commits'));
  });

  it('reads the files the sibling collector wrote, in place', () => {
    const root = freshRoot('sibling-files');
    plant(root, 'sessions', linesOf(S_A, S_B));
    plant(root, 'commits', linesOf(C_A));
    const store = openNdjsonStore(root);

    expect(store.read('sessions')).toEqual([S_A, S_B]);
    expect(store.read('commits')).toEqual([C_A]);
    expect(store.append('sessions', [S_A, S_C]).appended).toBe(1);
    expect(readRaw(root, 'sessions')).toBe(linesOf(S_A, S_B, S_C));
  });

  it('touches nothing on disk when it is opened', () => {
    const root = freshRoot('open-only');
    openNdjsonStore(root);

    expect(existsSync(root)).toBe(false);
  });
});

describe('keys and read', () => {
  it('keys each kind by its own key field', () => {
    const root = freshRoot('key-fields');
    const store = openNdjsonStore(root);
    store.append('sessions', [S_A, S_B]);
    store.append('commits', [C_A, C_B]);

    expect([...store.keys('sessions')]).toEqual(['aaaa-1111', 'bbbb-2222']);
    expect([...store.keys('commits')]).toEqual(['deadbeef', 'feedface']);
  });

  it('never dedupes one kind against the other', () => {
    const root = freshRoot('kinds-apart');
    const store = openNdjsonStore(root);
    store.append('sessions', [sessionRow('deadbeef')]);
    const result = store.append('commits', [commitRow('deadbeef')]);

    expect(result.appended).toBe(1);
    expect(store.read('commits')).toEqual([commitRow('deadbeef')]);
  });

  it('derives the key set from the rows, skipping keyless ones', () => {
    const root = freshRoot('keys-from-rows');
    const keyless = ['{"sessionId":""}', '{"sessionId":7}', '{"sha":"x"}'];
    plant(root, 'sessions', `${linesOf(S_A)}${keyless.join('\n')}\n`);
    const store = openNdjsonStore(root);

    expect([...store.keys('sessions')]).toEqual(['aaaa-1111']);
    expect(store.read('sessions')).toHaveLength(4);
    expect(readdirSync(storeDir(root))).toEqual(['sessions.ndjson']);
  });

  it('answers rows in the order they were appended', () => {
    const root = freshRoot('order');
    const store = openNdjsonStore(root);
    store.append('sessions', [S_C]);
    store.append('sessions', [S_A, S_B]);

    expect(store.read('sessions')).toEqual([S_C, S_A, S_B]);
  });

  it('hands the caller a fresh set and a fresh array on every call', () => {
    const root = freshRoot('fresh');
    const store = openNdjsonStore(root);
    store.append('sessions', [S_A]);
    const keys = store.keys('sessions');
    const rows = store.read('sessions');
    keys.delete('aaaa-1111');
    keys.add('zzzz-9999');
    rows.push(S_B);

    expect([...store.keys('sessions')]).toEqual(['aaaa-1111']);
    expect(store.read('sessions')).toEqual([S_A]);
  });
});

describe('append', () => {
  it('adds nothing and writes nothing on a second identical append', () => {
    const root = freshRoot('rerun');
    const store = openNdjsonStore(root);
    store.append('commits', [C_A, C_B]);
    const before = readRaw(root, 'commits');
    const again = store.append('commits', [C_A, C_B]);

    expect(again.appended).toBe(0);
    expect(again.skipped).toBe(2);
    expect(readRaw(root, 'commits')).toBe(before);
  });

  it('dedupes within the batch as well as against the disk', () => {
    const root = freshRoot('batch-and-disk');
    const store = openNdjsonStore(root);
    store.append('sessions', [S_A]);
    const result = store.append('sessions', [S_B, S_A, S_B, S_C]);

    expect(result.appended).toBe(2);
    expect(result.skipped).toBe(2);
    expect(readRaw(root, 'sessions')).toBe(linesOf(S_A, S_B, S_C));
  });

  it('dedupes by the key, not by the row body', () => {
    const root = freshRoot('key-not-body');
    const store = openNdjsonStore(root);
    store.append('sessions', [S_A]);
    store.append('commits', [C_A]);

    expect(store.append('sessions', [sessionRow('aaaa-1111', 99)]).appended)
      .toBe(0);
    expect(store.append('commits', [commitRow('deadbeef', 0)]).appended)
      .toBe(0);
    expect(store.read('sessions')).toEqual([S_A]);
    expect(store.read('commits')).toEqual([C_A]);
  });
});

describe('append refusals', () => {
  it('refuses the whole batch for a keyless row, bytes untouched', () => {
    const root = freshRoot('keyless');
    const store = openNdjsonStore(root);
    store.append('sessions', [S_A]);
    const before = readRaw(root, 'sessions');
    const batch = [S_B, sessionRow(''), S_C];

    expect(() => store.append('sessions', batch))
      .toThrow(/row 1 of 3 carries no key; batch refused/);
    expect(readRaw(root, 'sessions')).toBe(before);
  });

  it('leaves no file and no directory when it refuses on no store', () => {
    const root = freshRoot('keyless-fresh');
    const store = openNdjsonStore(root);

    expect(() => store.append('commits', [C_A, commitRow('')]))
      .toThrow(/row 1 of 2 carries no key/);
    expect(existsSync(root)).toBe(false);
  });

  it('refuses a row appended under the other kind', () => {
    const root = freshRoot('wrong-kind');
    const store = openNdjsonStore(root);
    const asSession = C_A as unknown as SessionEffortRow;
    const asCommit = S_A as unknown as CommitEffortRow;

    expect(() => store.append('sessions', [S_B, asSession]))
      .toThrow(/row 1 of 2 carries no key/);
    expect(() => store.append('commits', [asCommit]))
      .toThrow(/row 0 of 1 carries no key/);
    expect(existsSync(root)).toBe(false);
  });
});

describe('a partial last line', () => {
  it('is counted as unparsed and read past', () => {
    const root = freshRoot('partial-read');
    plant(root, 'sessions', `${linesOf(S_A)}${HALF_B}`);
    const store = openNdjsonStore(root);

    expect(store.readRows('sessions')).toEqual({
      rows: [S_A],
      lineCount: 2,
      unparsedLineCount: 1,
    });
    expect(store.read('sessions')).toEqual([S_A]);
    expect([...store.keys('sessions')]).toEqual(['aaaa-1111']);
  });

  it('is separated by the next append, which collects its row again', () => {
    const root = freshRoot('partial-append');
    const text = `${linesOf(S_A)}${HALF_B}`;
    plant(root, 'sessions', text);
    const store = openNdjsonStore(root);
    const result = store.append('sessions', [S_A, S_B]);

    expect(answers(result)).toEqual([1, 1, true]);
    expect(readRaw(root, 'sessions')).toBe(`${text}\n${linesOf(S_B)}`);
    expect(store.readRows('sessions')).toEqual({
      rows: [S_A, S_B],
      lineCount: 3,
      unparsedLineCount: 1,
    });
  });

  it('is left alone by an append that adds nothing', () => {
    const root = freshRoot('partial-noop');
    const text = `${linesOf(S_A)}${HALF_B}`;
    plant(root, 'sessions', text);
    const result = openNdjsonStore(root).append('sessions', [S_A]);

    expect(answers(result)).toEqual([0, 1, false]);
    expect(readRaw(root, 'sessions')).toBe(text);
  });

  it('is never invented on a file that ends whole', () => {
    const root = freshRoot('whole');
    const store = openNdjsonStore(root);
    store.append('commits', [C_A]);
    const result = store.append('commits', [C_B]);

    expect(answers(result)).toEqual([1, 0, false]);
    expect(readRaw(root, 'commits')).toBe(linesOf(C_A, C_B));
  });
});

describe('absence and unreadability', () => {
  it('answers a store that does not exist as empty, creating nothing', () => {
    const root = freshRoot('absent');
    const store = openNdjsonStore(root);

    for (const kind of ['sessions', 'commits'] as const) {
      expect(store.read(kind)).toEqual([]);
      expect(store.keys(kind).size).toBe(0);
      expect(store.readRows(kind)).toEqual({
        rows: [],
        lineCount: 0,
        unparsedLineCount: 0,
      });
      expect(store.append(kind, [])).toEqual({
        path: kindFile(root, kind),
        appended: 0,
        skipped: 0,
        separatedPartialLine: false,
      });
    }
    expect(existsSync(root)).toBe(false);
  });

  it('throws for a kind whose file exists and cannot be read', () => {
    const root = freshRoot('unreadable');
    mkdirSync(kindFile(root, 'sessions'), { recursive: true });
    const store = openNdjsonStore(root);

    expect(() => store.read('sessions')).toThrow(/EISDIR/);
    expect(() => store.keys('sessions')).toThrow(/EISDIR/);
    expect(() => store.append('sessions', [S_A])).toThrow(/EISDIR/);
    expect(readdirSync(kindFile(root, 'sessions'))).toEqual([]);
    expect(store.append('commits', [C_A]).appended).toBe(1);
  });
});

describe('parity with the sibling store', () => {
  it('writes the same bytes and answers the same, batch for batch', () => {
    const ours = freshRoot('parity-ours');
    const theirs = freshRoot('parity-theirs');
    const partial = `${linesOf(S_A)}${HALF_B}`;
    plant(ours, 'sessions', partial);
    plant(theirs, 'sessions', partial);
    const store = openNdjsonStore(ours);
    // Bound as the sibling's collector binds them: by id, and by sha.
    const sessions = openEffortStore<SessionEffortRow>(
      kindFile(theirs, 'sessions'),
      (row) => row.sessionId,
    );
    const commits = openEffortStore<CommitEffortRow>(
      kindFile(theirs, 'commits'),
      (row) => row.sha,
    );
    const keyless = [S_C, sessionRow('')];

    for (const batch of [[S_B, S_A], [S_C, S_C, S_B], [], [S_A]]) {
      expect(answers(store.append('sessions', batch)))
        .toEqual(answers(sessions.append(batch)));
    }
    for (const batch of [[C_A, C_B, C_A], [C_B], []]) {
      expect(answers(store.append('commits', batch)))
        .toEqual(answers(commits.append(batch)));
    }
    expect(() => store.append('sessions', keyless))
      .toThrow(refusalOf(() => sessions.append(keyless)));

    expect(readRaw(ours, 'sessions')).toBe(readRaw(theirs, 'sessions'));
    expect(readRaw(ours, 'commits')).toBe(readRaw(theirs, 'commits'));
    expect(store.readRows('sessions')).toEqual(sessions.readRows());
    expect([...store.keys('commits')]).toEqual([...commits.collectedKeys()]);
  });
});
