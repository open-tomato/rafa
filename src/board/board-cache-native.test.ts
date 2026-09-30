/**
 * Tests for the kept board listing in the `native` mode
 * (`./board-cache.ts`, `./board-cache-native.ts`): the one
 * `gh api graphql` incremental read, the relationship fields a kept row
 * carries, and the `mode` the file records so a file written in one mode
 * is read as no cache in the other.
 *
 * The argv each case expects is written out here as literal words where
 * it is the labels mode's, never rebuilt from the module's builders, so a
 * change to what the default mode sends fails here even if every
 * constant moved with it. Every mode-switch case has its control: the
 * same file read in its own mode is read incrementally, which proves the
 * full read the switch causes is the mode's doing and not a file this
 * module could not read anyway. Every `gh` answer is planted, in a
 * temporary project root; nothing spawns.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { BoardRelationshipMode } from '../config-sections.js';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { NATIVE_CHANGED_QUERY, nativeChangedArgs } from './board-cache-native.js';
import { BOARD_CACHE_FILE, BOARD_CACHE_VERSION, changedArgs, createCachedBoardListing } from './board-cache.js';

/** The watermark every kept file and full read here starts from. */
const MARK = '2026-09-30T10:00:00Z';

/** The watermark read, as the labels mode has always sent it. */
const WATERMARK = 'api repos/{owner}/{repo}/issues?state=all&sort=updated&direction=desc&per_page=1 --jq .[0].updated_at // ""';

/** The labels-mode full listing, as the default has always sent it. */
const LABELS_LIST = 'issue list --state all --limit 1000 --json number,title,body,state,stateReason,labels';

/** The native-mode full listing. */
const NATIVE_LIST = `${LABELS_LIST},parent,blockedBy,blocking,subIssuesSummary,subIssues`;

/** The keys a labels-mode row and issue have. */
const LABELS_ROW_KEYS = ['number', 'title', 'body', 'state', 'stateReason', 'labels'];

/** The five relationship keys, in the order a kept row and an issue carry them. */
const NATIVE_KEYS = ['parent', 'blockedBy', 'blocking', 'subIssuesSummary', 'subIssues'];

/** A linked issue node, as `gh` answers it. */
function node(number: number, state = 'OPEN', repository = 'acme/board'): Record<string, unknown> {
  return { number, title: `issue ${String(number)}`, state, url: `https://github.com/${repository}/issues/${String(number)}` };
}

/** A labels-mode row. */
function labelsRow(number: number): Record<string, unknown> {
  return {
    number,
    title: `issue ${String(number)}`,
    body: 'body',
    state: 'OPEN',
    stateReason: null,
    labels: [{ name: 'type:spec' }],
  };
}

/** A native-mode row with no links, with `overrides` laid over it. */
function nativeRow(number: number, overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const none = { nodes: [], totalCount: 0 };
  return {
    ...labelsRow(number),
    parent: null,
    blockedBy: none,
    blocking: none,
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: none,
    ...overrides,
  };
}

/** A board with every kind of link: an epic with two members, a truncated list and a foreign blocker. */
function linkedBoard(): readonly Record<string, unknown>[] {
  return [
    nativeRow(3, {
      parent: node(1),
      blockedBy: { nodes: [node(2, 'CLOSED'), node(9, 'OPEN', 'acme/other')], totalCount: 51 },
    }),
    nativeRow(2, { parent: node(1), blocking: { nodes: [node(3)], totalCount: 1 } }),
    nativeRow(1, {
      subIssuesSummary: { total: 2, completed: 0, percentCompleted: 0 },
      subIssues: { nodes: [node(3), node(2)], totalCount: 2 },
    }),
  ];
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

/** The answers a full read in `mode` needs: the watermark, then the listing of `rows`. */
function fullRead(mode: BoardRelationshipMode, rows: readonly unknown[]): Record<string, GhResult> {
  return {
    [WATERMARK]: ok(`${MARK}\n`),
    [mode === 'native'
      ? NATIVE_LIST
      : LABELS_LIST]: ok(JSON.stringify(rows)),
  };
}

/** `rows` as `gh --jq` writes them: one JSON object per line. */
function lines(rows: readonly unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n');
}

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rafa-board-cache-native-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The cache file under the temporary root. */
function cachePath(): string {
  return join(root, BOARD_CACHE_FILE);
}

/** The kept file, parsed. */
function kept(): Record<string, unknown> & { rows: Record<string, unknown>[] } {
  return JSON.parse(readFileSync(cachePath(), 'utf8')) as Record<string, unknown> & { rows: Record<string, unknown>[] };
}

/** Writes a kept file holding `rows`, with `mode` as its `mode` key when given. */
function keep(rows: readonly unknown[], mode?: unknown): void {
  mkdirSync(dirname(cachePath()), { recursive: true });
  const file = mode === undefined
    ? { version: BOARD_CACHE_VERSION, watermark: MARK, rows }
    : { version: BOARD_CACHE_VERSION, mode, watermark: MARK, rows };
  writeFileSync(cachePath(), JSON.stringify(file));
}

describe('nativeChangedArgs', () => {
  it('is one paginated gh api graphql call with the repository filled by gh and the watermark as since', () => {
    const args = nativeChangedArgs(MARK);

    expect(args.slice(0, 10)).toEqual([
      'api', 'graphql', '--paginate', '-F', 'owner={owner}', '-F', 'repo={repo}', '-f', `since=${MARK}`, '-f',
    ]);
    expect(args[10]).toBe(`query=${NATIVE_CHANGED_QUERY}`);
    expect(args[11]).toBe('--jq');
    expect(args).toHaveLength(13);
  });

  it('asks for the listing fields, updatedAt and the relationship fields over issues changed since', () => {
    for (const part of [
      'filterBy: {since: $since}',
      '$endCursor: String',
      'pageInfo { hasNextPage endCursor }',
      'number title body state stateReason updatedAt',
      'labels(first: 100) { nodes { name } }',
      'parent { number title state url }',
      'blockedBy(first: 50) { nodes { number title state url } totalCount }',
      'blocking(first: 50) { nodes { number title state url } totalCount }',
      'subIssuesSummary { total completed percentCompleted }',
      'subIssues(first: 100) { nodes { number title state url } totalCount }',
    ]) {
      expect(NATIVE_CHANGED_QUERY).toContain(part);
    }
  });
});

describe('a full read in each mode', () => {
  it('keeps the labels-mode file as it always was: no mode key and six keys a row', async () => {
    const gh = planted(fullRead('labels', [labelsRow(1)]));
    await createCachedBoardListing({ gh: gh.run, root })();

    expect(gh.calls).toEqual([WATERMARK, LABELS_LIST]);
    expect(Object.keys(kept())).toEqual(['version', 'watermark', 'rows']);
    expect(Object.keys(kept().rows[0] ?? {})).toEqual(LABELS_ROW_KEYS);
  });

  it('asks for the native fields and keeps them, recording the mode', async () => {
    const gh = planted(fullRead('native', linkedBoard()));
    const issues = await createCachedBoardListing({ gh: gh.run, root, mode: 'native' })();

    expect(gh.calls).toEqual([WATERMARK, NATIVE_LIST]);
    expect(Object.keys(kept())).toEqual(['version', 'mode', 'watermark', 'rows']);
    expect(kept()['mode']).toBe('native');
    expect(Object.keys(kept().rows[0] ?? {})).toEqual([...LABELS_ROW_KEYS, ...NATIVE_KEYS]);
    expect(issues[0]?.blockedBy?.truncated).toEqual({ total: 51 });
  });

  it('reads back from the kept rows exactly the issues the full read answered', async () => {
    const first = await createCachedBoardListing({ gh: planted(fullRead('native', linkedBoard())).run, root, mode: 'native' })();
    const gh = planted({ [nativeChangedArgs(MARK).join(' ')]: ok('') });
    const again = await createCachedBoardListing({ gh: gh.run, root, mode: 'native' })();

    expect(gh.calls).toEqual([nativeChangedArgs(MARK).join(' ')]);
    expect(again).toEqual(first);
    expect(again[0]?.blockedBy?.nodes[1]?.repository).toBe('acme/other');
    expect(again[2]?.subIssues?.nodes.map((link) => link.number)).toEqual([3, 2]);
  });
});

describe('the native incremental read', () => {
  it('sends one gh api graphql call and lays each changed row over the kept rows', async () => {
    keep(linkedBoard(), 'native');
    const changed = [
      { ...nativeRow(3, { parent: node(1), blockedBy: { nodes: [], totalCount: 0 } }), updatedAt: '2026-09-30T11:00:00Z' },
      { ...nativeRow(4, { parent: node(1) }), updatedAt: '2026-09-30T11:05:00Z' },
    ];
    const gh = planted({ [nativeChangedArgs(MARK).join(' ')]: ok(lines(changed)) });
    const issues = await createCachedBoardListing({ gh: gh.run, root, mode: 'native' })();

    expect(gh.calls).toEqual([nativeChangedArgs(MARK).join(' ')]);
    expect(issues.map((issue) => [issue.number, issue.parent?.number, issue.blockedBy?.nodes.length])).toEqual([
      [4, 1, 0],
      [3, 1, 0],
      [2, 1, 0],
      [1, undefined, 0],
    ]);
    expect(Object.keys(issues[0] ?? {})).toEqual([...LABELS_ROW_KEYS, 'type', 'module', ...NATIVE_KEYS]);
    expect(kept()['mode']).toBe('native');
    expect(kept()['watermark']).toBe('2026-09-30T11:05:00Z');
  });

  it('never sends the labels-mode REST read', async () => {
    keep(linkedBoard(), 'native');
    const gh = planted({ [changedArgs(MARK).join(' ')]: ok(''), ...fullRead('native', linkedBoard()) });
    await createCachedBoardListing({ gh: gh.run, root, mode: 'native' })();

    expect(gh.calls).not.toContain(changedArgs(MARK).join(' '));
    expect(gh.calls[0]).toBe(nativeChangedArgs(MARK).join(' '));
  });

  it('falls back to a full native read when a changed row lacks a relationship field', async () => {
    keep(linkedBoard(), 'native');
    const gh = planted({
      [nativeChangedArgs(MARK).join(' ')]: ok(lines([{ ...labelsRow(3), updatedAt: '2026-09-30T11:00:00Z' }])),
      ...fullRead('native', linkedBoard()),
    });
    await createCachedBoardListing({ gh: gh.run, root, mode: 'native' })();

    expect(gh.calls).toEqual([nativeChangedArgs(MARK).join(' '), WATERMARK, NATIVE_LIST]);
  });

  it('falls back to a full native read when the incremental read fails', async () => {
    keep(linkedBoard(), 'native');
    const gh = planted(fullRead('native', linkedBoard()));
    await createCachedBoardListing({ gh: gh.run, root, mode: 'native' })();

    expect(gh.calls).toEqual([nativeChangedArgs(MARK).join(' '), WATERMARK, NATIVE_LIST]);
  });
});

describe('a file written in the other mode', () => {
  it('control: a labels file is read incrementally in the labels mode, with the labels-mode REST read', async () => {
    keep([labelsRow(1)]);
    const gh = planted({ [changedArgs(MARK).join(' ')]: ok('') });
    await createCachedBoardListing({ gh: gh.run, root, mode: 'labels' })();

    expect(gh.calls).toEqual([changedArgs(MARK).join(' ')]);
  });

  it('reads a labels file as no cache in the native mode, and rewrites it as native', async () => {
    keep([labelsRow(1)]);
    const gh = planted(fullRead('native', linkedBoard()));
    await createCachedBoardListing({ gh: gh.run, root, mode: 'native' })();

    expect(gh.calls).toEqual([WATERMARK, NATIVE_LIST]);
    expect(kept()['mode']).toBe('native');
  });

  it('control: a native file is read incrementally in the native mode', async () => {
    keep(linkedBoard(), 'native');
    const gh = planted({ [nativeChangedArgs(MARK).join(' ')]: ok('') });
    await createCachedBoardListing({ gh: gh.run, root, mode: 'native' })();

    expect(gh.calls).toEqual([nativeChangedArgs(MARK).join(' ')]);
  });

  it('reads a native file as no cache in the labels mode, and rewrites it with no mode and no native key', async () => {
    keep(linkedBoard(), 'native');
    const gh = planted(fullRead('labels', [labelsRow(1)]));
    const issues = await createCachedBoardListing({ gh: gh.run, root })();

    expect(gh.calls).toEqual([WATERMARK, LABELS_LIST]);
    expect(Object.keys(kept())).toEqual(['version', 'watermark', 'rows']);
    expect(Object.keys(kept().rows[0] ?? {})).toEqual(LABELS_ROW_KEYS);
    expect(Object.keys(issues[0] ?? {})).toEqual([...LABELS_ROW_KEYS, 'type', 'module']);
  });

  it('reads a file naming neither mode as no cache in either', async () => {
    for (const mode of ['labels', 'native'] as const) {
      keep(mode === 'native'
        ? linkedBoard()
        : [labelsRow(1)], 'other');
      const gh = planted(fullRead(mode, mode === 'native'
        ? linkedBoard()
        : [labelsRow(1)]));
      await createCachedBoardListing({ gh: gh.run, root, mode })();

      expect(gh.calls[0]).toBe(WATERMARK);
    }
  });
});
