/**
 * Tests for the kept board listing (`src/board/board-cache.ts`): the
 * full read and the file it writes, the incremental read over that file,
 * and each way back to a full read.
 *
 * Every case plants what its runner answers per command and runs in a
 * temporary project root; none spawns `gh` or reaches GitHub. The first
 * case is the control for the rest: a first read with nothing kept
 * answers the listing and writes the file every later case reads.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  BOARD_CACHE_FILE,
  BOARD_CACHE_VERSION,
  changedArgs,
  createCachedBoardListing,
  mergeRows,
  WATERMARK_ARGS,
} from './board-cache.js';
import { BOARD_LISTING_LIMIT, BOARD_LIST_FIELDS } from './roadmap-board.js';

/** The full listing's arguments. */
const LIST_ARGS = ['issue', 'list', '--state', 'all', '--limit', String(BOARD_LISTING_LIMIT), '--json', BOARD_LIST_FIELDS];

/** A `gh issue list` row, with `overrides` laid over it. */
function row(number: number, overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    number,
    title: `issue ${String(number)}`,
    body: '## What you get\n\nbody',
    state: 'OPEN',
    stateReason: null,
    labels: [{ name: 'type:spec' }],
    ...overrides,
  };
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

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rafa-board-cache-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The cache file under the temporary root. */
function cachePath(): string {
  return join(root, BOARD_CACHE_FILE);
}

/** Writes a cache file holding `rows` under `watermark`. */
function keep(rows: readonly unknown[], watermark = '2026-09-28T10:00:00Z', version = BOARD_CACHE_VERSION): void {
  mkdirSync(dirname(cachePath()), { recursive: true });
  writeFileSync(cachePath(), JSON.stringify({ version, watermark, rows }));
}

/** The answers a full read needs: the watermark, then the listing of `rows`. */
function fullRead(rows: readonly unknown[], watermark = '2026-09-28T10:00:00Z'): Record<string, GhResult> {
  return {
    [WATERMARK_ARGS.join(' ')]: ok(`${watermark}\n`),
    [LIST_ARGS.join(' ')]: ok(JSON.stringify(rows)),
  };
}

describe('a first read, with nothing kept', () => {
  it('reads the watermark before the listing, answers the listing and keeps both', async () => {
    const gh = planted(fullRead([row(2), row(1)]));
    const issues = await createCachedBoardListing({ gh: gh.run, root })();

    expect(issues.map((issue) => issue.number)).toEqual([2, 1]);
    expect(gh.calls).toEqual([WATERMARK_ARGS.join(' '), LIST_ARGS.join(' ')]);
    const kept = JSON.parse(readFileSync(cachePath(), 'utf8')) as { version: number; watermark: string; rows: unknown[] };
    expect(kept.version).toBe(BOARD_CACHE_VERSION);
    expect(kept.watermark).toBe('2026-09-28T10:00:00Z');
    expect(kept.rows).toHaveLength(2);
  });

  it('answers the listing and keeps nothing when the watermark cannot be read', async () => {
    const answers = fullRead([row(1)]);
    delete answers[WATERMARK_ARGS.join(' ')];
    const issues = await createCachedBoardListing({ gh: planted(answers).run, root })();

    expect(issues.map((issue) => issue.number)).toEqual([1]);
    expect(existsSync(cachePath())).toBe(false);
  });

  it('rejects as the listing rejects when the full read fails', async () => {
    const gh = planted({ [WATERMARK_ARGS.join(' ')]: ok('2026-09-28T10:00:00Z') });
    const read = createCachedBoardListing({ gh: gh.run, root })();

    await expect(read).rejects.toThrow('board listing');
  });
});

describe('a later read, with the listing kept', () => {
  it('sends one incremental read and lays each changed issue over the kept rows', async () => {
    keep([row(2), row(1)]);
    const changed = [
      { ...row(1, { state: 'CLOSED', stateReason: 'COMPLETED' }), updatedAt: '2026-09-28T11:00:00Z' },
      { ...row(3, { title: 'a new issue' }), updatedAt: '2026-09-28T11:05:00Z' },
    ];
    const gh = planted({
      [changedArgs('2026-09-28T10:00:00Z').join(' ')]: ok(changed.map((each) => JSON.stringify(each)).join('\n')),
    });
    const issues = await createCachedBoardListing({ gh: gh.run, root })();

    expect(gh.calls).toEqual([changedArgs('2026-09-28T10:00:00Z').join(' ')]);
    expect(issues.map((issue) => [issue.number, issue.state, issue.stateReason])).toEqual([
      [3, 'OPEN', null],
      [2, 'OPEN', null],
      [1, 'CLOSED', 'COMPLETED'],
    ]);
    const kept = JSON.parse(readFileSync(cachePath(), 'utf8')) as { watermark: string };
    expect(kept.watermark).toBe('2026-09-28T11:05:00Z');
  });

  it('answers the kept rows unchanged when nothing changed', async () => {
    keep([row(2), row(1)]);
    const gh = planted({ [changedArgs('2026-09-28T10:00:00Z').join(' ')]: ok('') });
    const issues = await createCachedBoardListing({ gh: gh.run, root })();

    expect(issues.map((issue) => issue.number)).toEqual([2, 1]);
  });

  it('leaves the file as it was when the only issue answered is the one already kept', async () => {
    const same = { ...row(1), updatedAt: '2026-09-28T10:00:00Z' };
    keep([row(2), same]);
    const before = statSync(cachePath()).mtimeMs;
    const gh = planted({ [changedArgs('2026-09-28T10:00:00Z').join(' ')]: ok(JSON.stringify(same)) });
    await createCachedBoardListing({ gh: gh.run, root })();

    expect(statSync(cachePath()).mtimeMs).toBe(before);
  });

  it('falls back to a full read when the incremental read fails', async () => {
    keep([row(1)]);
    const gh = planted(fullRead([row(2), row(1)], '2026-09-28T12:00:00Z'));
    const issues = await createCachedBoardListing({ gh: gh.run, root })();

    expect(issues.map((issue) => issue.number)).toEqual([2, 1]);
    expect(gh.calls).toEqual([
      changedArgs('2026-09-28T10:00:00Z').join(' '),
      WATERMARK_ARGS.join(' '),
      LIST_ARGS.join(' '),
    ]);
  });

  it('falls back to a full read when a changed row is one the listing would refuse', async () => {
    keep([row(1)]);
    const answers = {
      ...fullRead([row(1)]),
      [changedArgs('2026-09-28T10:00:00Z').join(' ')]: ok(JSON.stringify({ ...row(1), state: 'MERGED' })),
    };
    const gh = planted(answers);
    await createCachedBoardListing({ gh: gh.run, root })();

    expect(gh.calls).toContain(LIST_ARGS.join(' '));
  });
});

describe('each way back to a full read', () => {
  it('reads the whole board with refresh, whatever is kept', async () => {
    keep([row(1)]);
    const gh = planted(fullRead([row(2), row(1)]));
    await createCachedBoardListing({ gh: gh.run, root, refresh: true })();

    expect(gh.calls).toEqual([WATERMARK_ARGS.join(' '), LIST_ARGS.join(' ')]);
  });

  it('reads the whole board when the kept file is not JSON', async () => {
    mkdirSync(dirname(cachePath()), { recursive: true });
    writeFileSync(cachePath(), 'not json');
    const gh = planted(fullRead([row(1)]));
    await createCachedBoardListing({ gh: gh.run, root })();

    expect(gh.calls[0]).toBe(WATERMARK_ARGS.join(' '));
  });

  it('reads the whole board when the kept file is another version', async () => {
    keep([row(1)], '2026-09-28T10:00:00Z', BOARD_CACHE_VERSION + 1);
    const gh = planted(fullRead([row(1)]));
    await createCachedBoardListing({ gh: gh.run, root })();

    expect(gh.calls[0]).toBe(WATERMARK_ARGS.join(' '));
  });
});

describe('mergeRows', () => {
  it('replaces rows by number and orders the newest number first', () => {
    const merged = mergeRows([row(1), row(3)], [row(2), row(3, { title: 'retitled' })]);

    expect(merged.map((each) => [each['number'], each['title']])).toEqual([
      [3, 'retitled'],
      [2, 'issue 2'],
      [1, 'issue 1'],
    ]);
  });
});
