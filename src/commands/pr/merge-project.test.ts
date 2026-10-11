/**
 * Tests for the project refresh `rafa pr merge` runs after its board
 * reading (`./merge-project.ts`): which issues it asks the refresh for,
 * the `gh` calls it sends to find them, and that nothing on the way out
 * rejects.
 *
 * The refresh itself is `src/board/project/refresh.test.ts`'s; here it
 * is a stand-in recording the issues each call asked for, and the runner
 * is an in-process `gh` answering the repository and one board listing in
 * either mode, recording each argv, so no case spawns a process or
 * reaches GitHub.
 *
 * ## The controls
 *
 *  - The two silent cases, `board.project.number` unset and a body
 *    closing no issue, each sit beside a case that changes only that one
 *    input and does open the runner and ask the refresh, so "it sent
 *    nothing" is a reading of the recorder rather than of a dead seam.
 *  - The selection runs one board against a body closing #20 and against
 *    one closing #20 and #21, and holds the two answers against each
 *    other: a reading that named every blocked issue, or none, would look
 *    right on one half alone. Each board holds a decoy the rule must
 *    leave out: a blocker of the same number on another repository, and
 *    in `labels` mode a `Blocked by:` line with no `spec:blocked` label.
 *  - The listing timed out once is read again only with retries on: the
 *    same runner under `board.project.retries: false` warns of the
 *    failure and refreshes the closed issue alone.
 */
import type { MergeProjectOptions, MergeProjectRefresh } from './merge-project.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { ProjectRefresh, RefreshConfig } from '../../board/project/refresh.js';
import type { UnblockOutcome, UnblockReport } from '../../board/unblock.js';

import { describe, expect, it } from 'bun:test';

import { SPEC_BLOCKED_LABEL } from '../../board/blocked.js';
import { retryLine } from '../../board/project/project-runner.js';
import { flakyGh, recordRetries, TIMED_OUT_STDERR } from '../../board/project/retry-fake.js';
import { BOARD_LISTING_LIMIT, boardListingCommand } from '../../board/roadmap-board.js';

import { blockingProblemLine, refreshProblemLine, refreshProjectAfterMerge } from './merge-project.js';

/** The board's own repository. */
const REPOSITORY = 'acme/board';

/** Another repository. */
const FOREIGN = 'acme/other';

/** The project number a case that opted in sets. */
const PROJECT_NUMBER = 6;

/** The repository read, as the recorder spells it. */
const REPO_VIEW = 'repo view --json nameWithOwner';

/** The listing in each mode, as the recorder spells it. */
const LABELS_LISTING = boardListingCommand(BOARD_LISTING_LIMIT, 'labels').slice('gh '.length);
const NATIVE_LISTING = boardListingCommand(BOARD_LISTING_LIMIT, 'native').slice('gh '.length);

/** One `labels`-mode row, as `gh issue list --json number,title,body,state,stateReason,labels` writes it. */
function labelsRow(number: number, body = '', labels: readonly string[] = [], state: 'OPEN' | 'CLOSED' = 'OPEN'): object {
  return {
    number,
    title: `Issue ${String(number)}`,
    body,
    state,
    stateReason: state === 'CLOSED'
      ? 'COMPLETED'
      : null,
    labels: labels.map((name) => ({ name })),
  };
}

/**
 * The `labels` board after the merge closed #20:
 *
 *  - #12 waits on #20 alone, #13 on #20 and #26, #14 on #21;
 *  - #15 names #20 on its line but carries no `spec:blocked`, so waits on nothing;
 *  - #16 waits on `acme/other#20`, which is not this board's #20.
 */
const LABELS_BOARD: readonly object[] = [
  labelsRow(20, '', [], 'CLOSED'),
  labelsRow(21),
  labelsRow(26),
  labelsRow(12, 'Blocked by: #20\n', [SPEC_BLOCKED_LABEL]),
  labelsRow(13, 'Blocked by: #20, #26\n', [SPEC_BLOCKED_LABEL]),
  labelsRow(14, 'Blocked by: #21\n', [SPEC_BLOCKED_LABEL]),
  labelsRow(15, 'Blocked by: #20\n'),
  labelsRow(16, `Blocked by: ${FOREIGN}#20\n`, [SPEC_BLOCKED_LABEL]),
];

/** A link node naming issue `number` on `repository`, as `gh` writes it. */
function node(number: number, state: 'OPEN' | 'CLOSED' = 'OPEN', repository: string = REPOSITORY): object {
  return { number, title: `Issue ${String(number)}`, state, url: `https://github.com/${repository}/issues/${String(number)}` };
}

/** A list of link nodes, as `gh` writes one. */
function links(nodes: readonly object[]): object {
  return { nodes, totalCount: nodes.length };
}

/** One `native`-mode row. */
function nativeRow(number: number, blockedBy: readonly object[] = [], state: 'OPEN' | 'CLOSED' = 'OPEN'): object {
  return {
    ...labelsRow(number, '', [], state),
    parent: null,
    blockedBy: links(blockedBy),
    blocking: links([]),
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: links([]),
  };
}

/** The same board in `native` mode: #17 waits on `acme/other#20`. */
const NATIVE_BOARD: readonly object[] = [
  nativeRow(20, [], 'CLOSED'),
  nativeRow(21),
  nativeRow(26),
  nativeRow(12, [node(20, 'CLOSED')]),
  nativeRow(13, [node(20, 'CLOSED'), node(26)]),
  nativeRow(14, [node(21)]),
  nativeRow(17, [node(20, 'OPEN', FOREIGN)]),
];

/** A runner over one board, the argv of every call, and how many times it was opened. */
interface FakeGh {
  readonly open: () => GhRunner;
  readonly ran: () => readonly string[];
  readonly opened: () => number;
}

/** A runner answering the repository and the listing in either mode; `listing` overrides the listing's answer. */
function fakeGh(board: readonly object[], listing?: GhResult): FakeGh {
  const ran: string[] = [];
  let opened = 0;
  const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '' });
  const run: GhRunner = (args) => {
    const line = args.join(' ');
    ran.push(line);
    if (line === REPO_VIEW) return Promise.resolve(ok(JSON.stringify({ nameWithOwner: REPOSITORY })));
    if (line === LABELS_LISTING || line === NATIVE_LISTING) return Promise.resolve(listing ?? ok(JSON.stringify(board)));
    return Promise.resolve({ ok: false, stdout: '', stderr: `no route for ${line}` });
  };
  return {
    open: () => {
      opened += 1;
      return run;
    },
    ran: () => [...ran],
    opened: () => opened,
  };
}

/** The config of a case, in `mode`, with `board.project.number` set to `number`. */
function config(mode: 'labels' | 'native', number: number | null = PROJECT_NUMBER): RefreshConfig {
  return { boardProjectNumber: number, boardProjectRetries: false, boardProjectRetryWaitSeconds: 1, boardProjectWriteBatchSize: 5, boardProjectWritePauseMs: 0, boardRelationships: mode, roadmapIssue: null, releaseFragments: '.changes' };
}

/** How one case runs. */
interface CaseOptions {
  readonly config: RefreshConfig;
  readonly gh: FakeGh;
  readonly body?: string;
  readonly unblocked?: UnblockReport | null;
  /** What the stand-in refresh answers; no warning when left out. */
  readonly answer?: () => Promise<ProjectRefresh>;
}

/** What one case came to: its answer, the issues each refresh asked for, and the lines warned. */
interface Ran {
  readonly result: MergeProjectRefresh | null;
  readonly asked: readonly (readonly number[])[];
  readonly warned: readonly string[];
}

/** A stand-in refresh answering `warnings`. */
function answering(warnings: readonly string[]): () => Promise<ProjectRefresh> {
  return () => Promise.resolve({ kind: 'skipped', reason: 'no-issues', warnings });
}

/** Runs {@link refreshProjectAfterMerge} over a stand-in refresh, recording what it asked and warned. */
async function ran(options: CaseOptions): Promise<Ran> {
  const asked: (readonly number[])[] = [];
  const warned: string[] = [];
  const answer = options.answer ?? answering([]);
  const merge: MergeProjectOptions = {
    body: options.body ?? 'Closes #20',
    config: options.config,
    openGh: options.gh.open,
    unblocked: options.unblocked ?? null,
    warn: (line) => {
      warned.push(line);
    },
    refresh: (refreshOptions, issues) => {
      expect(refreshOptions.config).toBe(options.config);
      asked.push(issues);
      return answer();
    },
  };
  const result = await refreshProjectAfterMerge(merge);
  return { result, asked, warned };
}

/** One outcome of the unblock reading, for `issue` naming `blockers`. */
function outcome(issue: number, blockers: readonly number[]): UnblockOutcome {
  return { issue, status: 'removed', blockers, open: [], unread: [], message: `#${String(issue)} unblocked` };
}

describe('what it sends', () => {
  it('opens no runner and asks no refresh with board.project.number unset', async () => {
    const gh = fakeGh(LABELS_BOARD);

    const run = await ran({ config: config('labels', null), gh });

    expect([run.result, run.asked, gh.opened(), gh.ran()]).toEqual([null, [], 0, []]);
  });

  it('control: opens the runner once and asks one refresh with the number set, over the same body', async () => {
    const gh = fakeGh(LABELS_BOARD);

    const run = await ran({ config: config('labels'), gh });

    expect([run.asked.length, gh.opened()]).toEqual([1, 1]);
  });

  it('opens no runner and asks no refresh for a body closing no issue', async () => {
    const gh = fakeGh(LABELS_BOARD);

    const run = await ran({ config: config('labels'), gh, body: 'Refactors the sign-in form.' });

    expect([run.result, run.asked, gh.opened(), gh.ran()]).toEqual([null, [], 0, []]);
  });

  it('sends the labels listing alone in labels mode, with no repository read', async () => {
    const gh = fakeGh(LABELS_BOARD);

    await ran({ config: config('labels'), gh });

    expect(gh.ran()).toEqual([LABELS_LISTING]);
  });

  it('reads the repository, then the native listing, in native mode', async () => {
    const gh = fakeGh(NATIVE_BOARD);

    await ran({ config: config('native'), gh });

    expect(gh.ran()).toEqual([REPO_VIEW, NATIVE_LISTING]);
  });
});

describe('which issues it refreshes', () => {
  it('in labels mode: the closed issue, then the issues it was blocking, in one refresh', async () => {
    const run = await ran({ config: config('labels'), gh: fakeGh(LABELS_BOARD) });

    expect(run.asked).toEqual([[20, 12, 13]]);
    expect(run.result).toEqual({ closed: [20], blocking: [12, 13], warnings: [] });
  });

  it('control in labels mode: closing #21 as well adds the issue #21 was blocking', async () => {
    const run = await ran({ config: config('labels'), gh: fakeGh(LABELS_BOARD), body: 'Closes #20\nCloses #21' });

    expect(run.asked).toEqual([[20, 21, 12, 13, 14]]);
  });

  it('in native mode: the closed issue and the issues it was blocking, never a foreign blocker of the same number', async () => {
    const run = await ran({ config: config('native'), gh: fakeGh(NATIVE_BOARD) });

    expect(run.asked).toEqual([[20, 12, 13]]);
  });

  it('control in native mode: closing #21 as well adds the issue #21 was blocking', async () => {
    const run = await ran({ config: config('native'), gh: fakeGh(NATIVE_BOARD), body: 'Closes #20\nCloses #21' });

    expect(run.asked).toEqual([[20, 21, 12, 13, 14]]);
  });

  it('adds an issue the unblock reading took spec:blocked off, which the listing no longer reads as blocked', async () => {
    const unlabelled = LABELS_BOARD.map((row) => ((row as { number: number }).number === 12
      ? labelsRow(12, 'Blocked by: #20\n')
      : row));
    const unblocked: UnblockReport = { issues: [outcome(12, [20]), outcome(14, [21])], problem: null, unchecked: null };

    const run = await ran({ config: config('labels'), gh: fakeGh(unlabelled), unblocked });

    expect(run.asked).toEqual([[20, 12, 13]]);
  });

  it('names a closed issue once, however many times the body closes it', async () => {
    const run = await ran({ config: config('labels'), gh: fakeGh(LABELS_BOARD), body: 'Closes #20\nFixes #20' });

    expect(run.asked).toEqual([[20, 12, 13]]);
  });
});

describe('every failure is a warning', () => {
  it('still refreshes the closed issue when the listing cannot be read, warning that its dependents were not', async () => {
    const gh = fakeGh(LABELS_BOARD, { ok: false, stdout: '', stderr: 'gh: HTTP 502' });

    const run = await ran({ config: config('labels'), gh });

    expect(run.asked).toEqual([[20]]);
    expect(run.warned).toHaveLength(1);
    expect(run.warned[0]).toStartWith('The project was not updated for the issues #20 were blocking: ');
    expect(run.warned[0]).toContain('HTTP 502');
    expect(run.warned[0]).toEndWith(blockingProblemLine([20], 'x').slice(blockingProblemLine([20], 'x').indexOf('x') + 1));
    expect(run.result?.blocking).toEqual([]);
  });

  it('hands every line the refresh answers to warn, in order, and answers them', async () => {
    const lines = ['The project was not updated: no scope.', 'The project\'s field "Rank" was skipped.'];

    const run = await ran({ config: config('labels'), gh: fakeGh(LABELS_BOARD), answer: answering(lines) });

    expect(run.warned).toEqual(lines);
    expect(run.result?.warnings).toEqual(lines);
  });

  it('answers a refresh that rejects with one line naming every issue asked for, never rejecting', async () => {
    const run = await ran({
      config: config('labels'),
      gh: fakeGh(LABELS_BOARD),
      answer: () => Promise.reject(new Error('repo view refused')),
    });

    expect(run.warned).toEqual([refreshProblemLine([20, 12, 13], 'repo view refused')]);
    expect(run.warned[0]).toContain('The project was not updated for #20, #12, #13: repo view refused.');
  });
});

describe('a call failing on a network error', () => {
  /** Runs the refresh over the labels board, its listing timing out once, with `retries` off the config. */
  async function runFlaky(retries: number | false) {
    const flaky = flakyGh(fakeGh(LABELS_BOARD).open(), [TIMED_OUT_STDERR], (args) => args.join(' ') === LABELS_LISTING);
    const recorder = recordRetries();
    const asked: (readonly number[])[] = [];
    const warned: string[] = [];
    await refreshProjectAfterMerge({
      body: 'Closes #20',
      config: { ...config('labels'), boardProjectRetries: retries, boardProjectRetryWaitSeconds: 2 },
      openGh: () => flaky.gh,
      unblocked: null,
      warn: (line) => {
        warned.push(line);
      },
      refresh: (_options, issues) => {
        asked.push(issues);
        return answering([])();
      },
      retry: recorder.seams,
    });
    return { flaky, recorder, asked, warned };
  }

  it('sends the listing again after the wait, reporting the retry, and refreshes the issues #20 was blocking', async () => {
    const run = await runFlaky(3);

    expect(run.recorder.notices().map(retryLine)).toEqual(['retrying issue list (1 of 3): operation timed out']);
    expect(run.recorder.waits()).toEqual([2000]);
    expect(run.asked).toEqual([[20, 12, 13]]);
    expect(run.warned).toEqual([]);
  });

  it('control: with board.project.retries false the listing is read once and its failure is the warned line', async () => {
    const run = await runFlaky(false);

    expect(run.recorder.notices()).toEqual([]);
    expect(run.flaky.sent()).toHaveLength(1);
    expect(run.asked).toEqual([[20]]);
    expect(run.warned[0]).toContain('operation timed out');
  });
});
