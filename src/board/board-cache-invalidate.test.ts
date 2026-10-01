/**
 * Tests for the rows a relationship write touched (`./board-cache.ts`,
 * `./board-cache-native.ts`): `invalidateRows` drops them from a
 * `native` file and records them as stale, and the next read reads them
 * again by number in one more `gh api graphql` call.
 *
 * A relationship write moves neither end's `updated_at` (measured
 * 2026-09-30, `context/pull-requests.md`), so the `since` read in these
 * cases answers nothing for the touched issues, as it would on GitHub.
 * Each case that expects the extra read has its control: the same file
 * read with nothing stale sends the `since` read alone. Every `gh` answer
 * is planted, in a temporary project root; nothing spawns.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { nativeChangedArgs, nativeIssuesArgs, nativeIssuesQuery } from './board-cache-native.js';
import { BOARD_CACHE_FILE, BOARD_CACHE_VERSION, createCachedBoardListing, invalidateRows } from './board-cache.js';

/** The watermark every kept file here starts from. */
const MARK = '2026-09-30T10:00:00Z';

/** The watermark read, as the labels mode has always sent it. */
const WATERMARK = 'api repos/{owner}/{repo}/issues?state=all&sort=updated&direction=desc&per_page=1 --jq .[0].updated_at // ""';

/** The native-mode full listing. */
const NATIVE_LIST = 'issue list --state all --limit 1000 --json'
  + ' number,title,body,state,stateReason,labels,parent,blockedBy,blocking,subIssuesSummary,subIssues';

/** The native incremental read from {@link MARK}. */
const SINCE = nativeChangedArgs(MARK).join(' ');

/** A linked issue node, as `gh` answers it. */
function node(number: number): Record<string, unknown> {
  return { number, title: `issue ${String(number)}`, state: 'OPEN', url: `https://github.com/acme/board/issues/${String(number)}` };
}

/** A native-mode row with no links, with `overrides` laid over it. */
function nativeRow(number: number, overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const none = { nodes: [], totalCount: 0 };
  return {
    number,
    title: `issue ${String(number)}`,
    body: 'body',
    state: 'OPEN',
    stateReason: null,
    labels: [],
    parent: null,
    blockedBy: none,
    blocking: none,
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: none,
    ...overrides,
  };
}

/** Three unlinked issues, newest number first. */
function board(): readonly Record<string, unknown>[] {
  return [nativeRow(3), nativeRow(2), nativeRow(1)];
}

/** A runner answering per command, by its arguments joined; anything else fails as unplanted. */
function planted(answers: Readonly<Record<string, GhResult>>): { run: GhRunner; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    run: (args) => {
      const key = args.join(' ');
      calls.push(key);
      return Promise.resolve(answers[key] ?? { ok: false, stdout: '', stderr: `unplanted: gh ${key}` });
    },
  };
}

/** A successful answer writing `stdout`. */
function ok(stdout: string): GhResult {
  return { ok: true, stdout, stderr: '' };
}

/** `rows` as `gh --jq` writes them: one JSON object per line. */
function lines(rows: readonly unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n');
}

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rafa-board-cache-invalidate-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The cache file under the temporary root. */
function cachePath(): string {
  return join(root, BOARD_CACHE_FILE);
}

/** The kept file, as text. */
function keptText(): string {
  return readFileSync(cachePath(), 'utf8');
}

/** The kept file, parsed. */
function kept(): Record<string, unknown> & { rows: Record<string, unknown>[] } {
  return JSON.parse(keptText()) as Record<string, unknown> & { rows: Record<string, unknown>[] };
}

/** Writes a kept file holding `rows`, with `extra` keys laid over it. */
function keep(rows: readonly unknown[], extra: Readonly<Record<string, unknown>> = { mode: 'native' }): void {
  mkdirSync(dirname(cachePath()), { recursive: true });
  writeFileSync(cachePath(), JSON.stringify({ version: BOARD_CACHE_VERSION, watermark: MARK, rows, ...extra }));
}

describe('nativeIssuesArgs', () => {
  it('is one unpaginated gh api graphql call with the repository filled by gh and each number aliased', () => {
    const args = nativeIssuesArgs([2, 3]);

    expect(args.slice(0, 6)).toEqual(['api', 'graphql', '-F', 'owner={owner}', '-F', 'repo={repo}']);
    expect(args[6]).toBe('-f');
    expect(args[7]).toBe(`query=${nativeIssuesQuery([2, 3])}`);
    expect(args[8]).toBe('--jq');
    expect(args).toHaveLength(10);
    expect(args).not.toContain('--paginate');
    expect(nativeIssuesQuery([2, 3])).toContain('i2: issue(number: 2) { ...row } i3: issue(number: 3) { ...row }');
  });

  it('asks each issue for the fields the since read asks', () => {
    for (const part of [
      'fragment row on Issue { number title body state stateReason updatedAt',
      'parent { number title state url }',
      'blockedBy(first: 50) { nodes { number title state url } totalCount }',
      'subIssues(first: 100) { nodes { number title state url } totalCount }',
    ]) {
      expect(nativeIssuesQuery([1])).toContain(part);
    }
  });

  it('refuses a number that is not a positive integer, since it is written into the query', () => {
    expect(() => nativeIssuesQuery([0])).toThrow(RangeError);
    expect(() => nativeIssuesQuery([1.5])).toThrow('not an issue number: 1.5');
  });
});

describe('invalidateRows', () => {
  it('drops the touched rows from a native file and records their numbers, sorted', () => {
    keep(board());

    expect(invalidateRows(root, [3, 2])).toBe(true);
    expect(kept().rows.map((row) => row['number'])).toEqual([1]);
    expect(kept()['stale']).toEqual([2, 3]);
    expect(Object.keys(kept())).toEqual(['version', 'mode', 'watermark', 'rows', 'stale']);
  });

  it('adds to the numbers an earlier invalidation recorded, once each', () => {
    keep(board());
    invalidateRows(root, [3]);

    expect(invalidateRows(root, [1, 3])).toBe(true);
    expect(kept()['stale']).toEqual([1, 3]);
    expect(kept().rows.map((row) => row['number'])).toEqual([2]);
  });

  it('leaves the file as it is when no number is given', () => {
    keep(board());
    const before = keptText();

    expect(invalidateRows(root, [])).toBe(true);
    expect(keptText()).toBe(before);
  });

  it('leaves a labels file byte for byte as it is: a labels relationship write moves updated_at', () => {
    keep([{ ...nativeRow(1) }], {});
    const before = keptText();

    expect(invalidateRows(root, [1])).toBe(false);
    expect(keptText()).toBe(before);
  });

  it('writes no file when there is none', () => {
    expect(invalidateRows(root, [1])).toBe(false);
    expect(() => keptText()).toThrow();
  });

  it('refuses a number that is not a positive integer and leaves the file alone', () => {
    keep(board());
    const before = keptText();

    expect(() => invalidateRows(root, [2, -1])).toThrow('not an issue number: -1');
    expect(keptText()).toBe(before);
  });
});

describe('the read after an invalidation', () => {
  it('control: with nothing stale the native read sends the since read alone', async () => {
    keep(board());
    const gh = planted({ [SINCE]: ok('') });
    await createCachedBoardListing({ gh: gh.run, root, mode: 'native' })();

    expect(gh.calls).toEqual([SINCE]);
  });

  it('reads the touched issues by number after the since read, and answers their new links', async () => {
    keep(board());
    invalidateRows(root, [3, 1]);
    const linked = [
      { ...nativeRow(3, { parent: node(1) }), updatedAt: '2026-09-30T09:00:00Z' },
      { ...nativeRow(1, { subIssuesSummary: { total: 1, completed: 0, percentCompleted: 0 },
        subIssues: { nodes: [node(3)], totalCount: 1 } }), updatedAt: '2026-09-30T09:00:00Z' },
    ];
    const stale = nativeIssuesArgs([1, 3]).join(' ');
    const gh = planted({ [SINCE]: ok(''), [stale]: ok(lines(linked)) });
    const issues = await createCachedBoardListing({ gh: gh.run, root, mode: 'native' })();

    expect(gh.calls).toEqual([SINCE, stale]);
    expect(issues.map((issue) => [issue.number, issue.parent?.number, issue.subIssues?.nodes.map((link) => link.number)]))
      .toEqual([[3, 1, []], [2, undefined, []], [1, undefined, [3]]]);
  });

  it('clears the record and keeps the watermark, which the touched issues are older than', async () => {
    keep(board());
    invalidateRows(root, [2]);
    const stale = nativeIssuesArgs([2]).join(' ');
    const gh = planted({ [SINCE]: ok(''), [stale]: ok(lines([{ ...nativeRow(2), updatedAt: '2026-09-29T00:00:00Z' }])) });
    await createCachedBoardListing({ gh: gh.run, root, mode: 'native' })();

    expect(Object.keys(kept())).toEqual(['version', 'mode', 'watermark', 'rows']);
    expect(kept()['watermark']).toBe(MARK);
    expect(kept().rows.map((row) => row['number'])).toEqual([3, 2, 1]);

    const again = planted({ [SINCE]: ok('') });
    await createCachedBoardListing({ gh: again.run, root, mode: 'native' })();

    expect(again.calls).toEqual([SINCE]);
  });

  it('falls back to a full read, and keeps no record, when the read by number fails', async () => {
    keep(board());
    invalidateRows(root, [2]);
    const stale = nativeIssuesArgs([2]).join(' ');
    const gh = planted({ [SINCE]: ok(''), [WATERMARK]: ok(`${MARK}\n`), [NATIVE_LIST]: ok(JSON.stringify(board().slice(1))) });
    const issues = await createCachedBoardListing({ gh: gh.run, root, mode: 'native' })();

    expect(gh.calls).toEqual([SINCE, stale, WATERMARK, NATIVE_LIST]);
    expect(issues.map((issue) => issue.number)).toEqual([2, 1]);
    expect(Object.keys(kept())).toEqual(['version', 'mode', 'watermark', 'rows']);
  });

  it('never sends the read by number when the since read fails', async () => {
    keep(board());
    invalidateRows(root, [2]);
    const gh = planted({ [WATERMARK]: ok(`${MARK}\n`), [NATIVE_LIST]: ok(JSON.stringify(board())) });
    await createCachedBoardListing({ gh: gh.run, root, mode: 'native' })();

    expect(gh.calls).toEqual([SINCE, WATERMARK, NATIVE_LIST]);
  });

  it('reads a file whose stale key is not a list of issue numbers as no cache', async () => {
    for (const stale of ['2', [0], [2, 'x']]) {
      keep(board(), { mode: 'native', stale });
      const gh = planted({ [WATERMARK]: ok(`${MARK}\n`), [NATIVE_LIST]: ok(JSON.stringify(board())) });
      await createCachedBoardListing({ gh: gh.run, root, mode: 'native' })();

      expect(gh.calls).toEqual([WATERMARK, NATIVE_LIST]);
    }
  });
});
