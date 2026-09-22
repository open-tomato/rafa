/**
 * Tests for row 7 of the state table (`./state.ts`), `pr-no-checks`: an
 * open pull request reporting no check at all (verdict `none`) that
 * merges, answered with `merge-unchecked` rather than sent to triage.
 *
 * `./state.test.ts` holds the other twelve rows and is over 800 lines,
 * so this row's cases live here, over fakes of their own: a
 * `GitRunner` answering by argv, the pull request double
 * (`src/pr/pull-requests-double.ts`), a board that answers nothing, and
 * an empty plans directory under a temporary root. Nothing here spawns
 * `git`, spawns `gh` or reaches GitHub.
 *
 * ## The controls
 *
 * Row 7 sits between rows 6 and 8 and after row 5, so each neighbour is
 * driven TWICE, the way `./state.test.ts` drives its pairs: once with
 * the neighbour's reading planted beside a `none` verdict, which the
 * neighbour must win, and once with that reading taken away, which row
 * 7 must then answer. A conflicting pull request with no checks is row
 * 6 (5 over 7 is the unsettled merge, 6 over 7 the conflict), and a
 * green one is row 8 while a `none` one is row 7 (7 over 8, which the
 * verdict partitions rather than orders).
 *
 * ## What passes while wrong
 *
 * Two mutations of `state.ts` were driven on 2026-09-22, one at a time,
 * over `env -u CLAUDECODE bun test src/next/`, the module restored from
 * a scratch copy and verified with `shasum -c` each time, against 204
 * pass and 0 fail either side:
 *
 *  - `none` put back into row 6's clause, so a pull request with no
 *    checks is triaged as before: 199 pass and 5 fail, four here and the
 *    per-row case of `./state.test.ts`.
 *  - row 7 moved ahead of row 6 with its `mergeable` conjunct dropped,
 *    so a conflicting pull request with no checks is merged unchecked:
 *    199 pass and 5 fail, the order and conflict cases here and the
 *    three of `./state.test.ts` that plant a conflict or the order.
 */
import type { NextBoard, NextSources } from './readings.js';
import type { ChecksVerdict, GitResult, Mergeability, PullRequestDetail, PullRequestSummary } from '../pr/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { plansDirAt } from '../commands/plan/plan-files.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';

import { NEXT_STATES, readNextState } from './state.js';

/** A temporary directory of this file's own, holding an empty plans directory. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-no-checks-')));
mkdirSync(join(tempBase, '.rafa', 'plans'), { recursive: true });

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The base branch every case runs against. */
const BASE = 'main';

/** The branch the pull request is open on. */
const HEAD = 'feat/rafa-86-merge-pull-request-reports';

/** The pull request every case plants. */
const PR = 86;

/** What git answered when it worked. */
function said(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** A summary as `findOpen` answers one. */
function summary(): PullRequestSummary {
  return {
    number: PR,
    title: 'rafa-86: merge pull requests that report no checks',
    url: `https://github.com/open-tomato/rafa/pull/${PR}`,
    state: 'open',
    headRefName: HEAD,
    baseRefName: BASE,
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-22T11:00:00Z',
  };
}

/** A detail as `get` answers one, merging as `mergeable` says. */
function detail(mergeable: Mergeability): PullRequestDetail {
  return {
    ...summary(),
    body: 'Closes #86',
    headRefOid: 'abc1234',
    mergeable,
    mergeStateStatus: 'CLEAN',
    labels: [],
  };
}

/** A board that is never asked: every row here answers before row 10. */
const BOARD: NextBoard = {
  next: () => Promise.reject(new Error('the board was asked')),
  blocking: () => Promise.reject(new Error('the board was asked')),
  isReady: () => Promise.reject(new Error('the board was asked')),
};

/** The sources for a clean checkout of {@link HEAD}, whose pull request reads as given. */
function sourcesFor(verdict: ChecksVerdict, mergeable: Mergeability): NextSources {
  const answers: Readonly<Record<string, GitResult>> = {
    'rev-parse --abbrev-ref HEAD': said(`${HEAD}\n`),
    'status --porcelain': said(''),
  };
  return {
    base: BASE,
    plans: plansDirAt(tempBase, '.rafa/plans'),
    runs: () => [],
    git: (args) => answers[args.join(' ')] ?? said(''),
    pulls: createPullRequestsDouble({
      findOpen: () => Promise.resolve(summary()),
      get: () => Promise.resolve(detail(mergeable)),
      checks: () => Promise.resolve({ rows: [], verdict }),
    }).pulls,
    board: BOARD,
  };
}

/** The state a pull request reading as given answers. */
function stateOf(verdict: ChecksVerdict, mergeable: Mergeability): ReturnType<typeof readNextState> {
  return readNextState(sourcesFor(verdict, mergeable));
}

describe('row 7, a pull request reporting no check at all', () => {
  it('sits between pr-red and pr-green in the table', () => {
    const at = NEXT_STATES.indexOf('pr-no-checks');

    expect(NEXT_STATES.slice(at - 1, at + 2)).toEqual(['pr-red', 'pr-no-checks', 'pr-green']);
  });

  it('proposes merge-unchecked, naming the pull request, its branch and its base', async () => {
    const state = await stateOf('none', 'mergeable');

    expect(state.id).toBe('pr-no-checks');
    expect(state.action).toBe('merge-unchecked');
    expect(state.reading).toBe(`#${PR} is open on \`${HEAD}\`, reports no check at all and merges into \`${BASE}\``);
    expect(state.proposal).toBe(`merge #${PR} into \`${BASE}\` with no checks`);
    expect(state.pullRequest).toBe(PR);
    expect([state.issue, state.planStub, state.planPath]).toEqual([null, null, null]);
    expect(state.problems).toEqual([]);
  });
});

describe('row 7 beside its neighbours', () => {
  it('reads a merge GitHub has not settled as row 5, and row 7 once it merges', async () => {
    const both = await stateOf('none', 'unknown');
    const alone = await stateOf('none', 'mergeable');

    expect([both.id, alone.id]).toEqual(['pr-pending', 'pr-no-checks']);
  });

  it('reads a conflicting pull request with no checks as row 6, and row 7 once it merges', async () => {
    const both = await stateOf('none', 'conflicting');
    const alone = await stateOf('none', 'mergeable');

    expect([both.id, alone.id]).toEqual(['pr-red', 'pr-no-checks']);
    expect(both.action).toBe('triage');
    expect(both.reading).toBe(`#${PR} is open on \`${HEAD}\` and conflicts with \`${BASE}\``);
  });

  it('reads a green pull request as row 8 and a none one as row 7, the verdict telling them apart', async () => {
    const green = await stateOf('green', 'mergeable');
    const none = await stateOf('none', 'mergeable');

    expect([green.id, none.id]).toEqual(['pr-green', 'pr-no-checks']);
    expect([green.action, none.action]).toEqual(['merge', 'merge-unchecked']);
  });

  it('leaves row 6 red checks alone, which are still triaged', async () => {
    const state = await stateOf('red', 'mergeable');

    expect(state.id).toBe('pr-red');
    expect(state.action).toBe('triage');
    expect(state.reading).toBe(`#${PR} is open on \`${HEAD}\` and its checks are red`);
  });
});
