/**
 * Tests for the state table (`./state.ts`) over a board that reads its
 * relationships natively (`NextBoard.mode`, `./readings.ts`): row 11,
 * `issue-blocked`, the `unblock` proposal, is read in `labels` mode only,
 * and row 12 never names a blocked line "not ready". `./state.test.ts`
 * holds every row in `labels` mode and is past the 800-line cap, so these
 * cases live here over fakes of their own: a `GitRunner` answering by
 * argv on the base branch, a provider with no pull request, an empty
 * plans directory, and a board answering what the case planted. Nothing
 * here spawns `git` or `gh`. `./sources-native.test.ts` drives the same
 * rows over a real `native` board.
 *
 * ## The controls
 *
 * Every `native` case is read beside the same board with the `mode` key
 * left out, the `labels` mode: a blocked line is row 11 there, proposing
 * `unblock`, so a table that ignored the mode answers it in both.
 */
import type { NextBoard, NextSources } from './readings.js';
import type { BlockedLine } from '../board/blocked-line.js';
import type { GitResult } from '../pr/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { plansDirAt } from '../plan/plan-files.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';

import { readNextState } from './state.js';

/** A temporary directory of this file's own, holding an empty plans directory. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-native-')));
mkdirSync(join(tempBase, '.rafa', 'plans'), { recursive: true });

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The base branch every case stands on. */
const BASE = 'main';

/** The issue the roadmap walk answers. */
const ISSUE = 10;

/** What git answered when it worked. */
function said(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** What a case plants on the board. */
interface Planted {
  readonly native: boolean;
  readonly ready: boolean;
  readonly blocked: BlockedLine | null;
}

/** #10 waiting on open #20. */
const WAITING: BlockedLine = { issue: ISSUE, blockers: [20], open: [20], unread: [], fault: null };

/** A board whose walk answers #10, reading as `planted` says, and counting what it was asked. */
function boardFor(planted: Planted): { readonly board: NextBoard; readonly asked: string[] } {
  const asked: string[] = [];
  const board: NextBoard = {
    next: () => {
      asked.push('next');
      return Promise.resolve({
        roadmap: 1,
        line: { issue: ISSUE, ticked: false, why: '', lineNumber: 1 },
        passed: 0,
        problems: [],
      });
    },
    blocking: () => {
      asked.push('blocking');
      return Promise.resolve(planted.blocked);
    },
    isReady: () => {
      asked.push('isReady');
      return Promise.resolve(planted.ready);
    },
    ...planted.native
      ? { mode: 'native' as const }
      : {},
  };
  return { board, asked };
}

/** The sources of a clean checkout of the base, level with its remote, over `board`. */
function sourcesFor(board: NextBoard): NextSources {
  const answers: Readonly<Record<string, GitResult>> = {
    'rev-parse --abbrev-ref HEAD': said(`${BASE}\n`),
    'status --porcelain': said(''),
    [`rev-list --left-right --count ${BASE}...origin/${BASE}`]: said('0\t0\n'),
  };
  return {
    base: BASE,
    plans: plansDirAt(tempBase, '.rafa/plans'),
    runs: () => [],
    git: (args) => answers[args.join(' ')] ?? said(''),
    pulls: createPullRequestsDouble({ findOpen: () => Promise.resolve(null) }).pulls,
    board,
  };
}

/** The state `planted` answers. */
function stateOf(planted: Planted): ReturnType<typeof readNextState> {
  return readNextState(sourcesFor(boardFor(planted).board));
}

describe('row 11, issue-blocked, in native mode', () => {
  it('is not answered for a blocked ready line, which proposes no unblock', async () => {
    const state = await stateOf({ native: true, ready: true, blocked: WAITING });

    expect(state.id).not.toBe('issue-blocked');
    expect(state.action).not.toBe('unblock');
  });

  it('answers the same line with unblock in labels mode, the control', async () => {
    const state = await stateOf({ native: false, ready: true, blocked: WAITING });

    expect(state.id).toBe('issue-blocked');
    expect(state.action).toBe('unblock');
    expect(state.reading).toBe('#10 is blocked by #20 (open)');
  });

  it('never names a blocked line not ready either, falling through to nothing-left', async () => {
    const native = await stateOf({ native: true, ready: false, blocked: WAITING });
    const labels = await stateOf({ native: false, ready: false, blocked: WAITING });

    expect(native.id).toBe('nothing-left');
    expect(labels.id).toBe('issue-blocked');
  });
});

describe('rows 10 and 12 in native mode', () => {
  it('answers issue-ready for a ready line waiting on nothing, as labels mode does', async () => {
    const native = await stateOf({ native: true, ready: true, blocked: null });
    const labels = await stateOf({ native: false, ready: true, blocked: null });

    expect([native.id, native.action, native.issue]).toEqual(['issue-ready', 'plan', ISSUE]);
    expect(native.reading).toBe(labels.reading);
  });

  it('answers issue-not-ready for a line waiting on nothing without spec:ready, as labels mode does', async () => {
    const native = await stateOf({ native: true, ready: false, blocked: null });
    const labels = await stateOf({ native: false, ready: false, blocked: null });

    expect([native.id, native.action]).toEqual(['issue-not-ready', 'ready']);
    expect(native.reading).toBe(labels.reading);
  });

  it('asks the board what it asked before the mode, in either mode', async () => {
    const native = boardFor({ native: true, ready: true, blocked: WAITING });
    const labels = boardFor({ native: false, ready: true, blocked: WAITING });

    await readNextState(sourcesFor(native.board));
    await readNextState(sourcesFor(labels.board));

    expect(native.asked).toEqual(labels.asked);
  });
});
