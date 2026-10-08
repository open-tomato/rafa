/**
 * Tests for the project refresh `rafa release settle` runs after its
 * delivery (`./settle-project.ts`): when it runs, which issues it asks
 * the refresh for, the `gh` calls it sends to find them, and that
 * nothing on the way out rejects.
 *
 * The refresh itself is `src/board/project/refresh.test.ts`'s; here it
 * is a stand-in recording the issues each call asked for, and the runner
 * is an in-process `gh` answering the commit query from a map of commit
 * to pull requests, shaped as `gh` 2.100.0 answered it on 2026-10-07
 * (the module note holds the reading), so no case reaches GitHub.
 *
 * ## The controls
 *
 *  - Every silent case (the number unset, a dry run's absence, a `pr`
 *    delivery, a failed push) sits beside the `pushed` case that changes
 *    only that input and does open the runner, so "it sent nothing" is a
 *    reading of the recorder rather than of a dead seam.
 *  - Each selection rule holds a decoy the rule must leave out: a pull
 *    request that is not merged, one whose merge commit is another, one
 *    into another branch, and a closing reference on another repository.
 *  - The commit query timed out once is sent again only with retries on:
 *    the same runner under `board.project.retries: false` answers the
 *    problem line and asks no refresh.
 */
import type { SettleProjectOptions, SettleProjectRefresh } from './settle-project.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { ProjectRefresh, RefreshConfig } from '../../board/project/refresh.js';
import type { SettleDelivered } from '../../release/settle-tag.js';
import type { SettleBuilt, SettleFragment } from '../../release/settle.js';

import { describe, expect, it } from 'bun:test';

import { retryLine } from '../../board/project/project-runner.js';
import { flakyGh, recordRetries, TIMED_OUT_STDERR } from '../../board/project/retry-fake.js';

import { COMMIT_BATCH, commitPullsArgs, refreshProjectAfterSettle, releasedCommits, settleProblemLine } from './settle-project.js';

/** The repository the query answers for. */
const REPOSITORY = 'acme/demo';

/** The base branch every case settles on. */
const BRANCH = 'main';

/** A full hash made of `digit`. */
function hash(digit: string): string {
  return digit.repeat(40);
}

/** One folded fragment added by `commit`. */
function fragment(id: string, commit: string): SettleFragment {
  return {
    id,
    path: `.changes/${id}.md`,
    commit,
    addedOn: '2026-10-01',
    fragment: { plan: id, title: `title of ${id}`, level: 'minor', notes: ['- Loop: a line'] },
  };
}

/** A built settle folding `fragments`. */
function built(fragments: readonly SettleFragment[]): SettleBuilt {
  return {
    outcome: 'built',
    strategy: 'semver-by-level',
    commit: hash('a'),
    baseVersion: '0.4.0',
    fragments,
    version: '0.5.0',
    section: '## 0.5.0',
    release: hash('f'),
    deleted: fragments.map((each) => each.path),
    insertPoint: 'before-next-heading',
  };
}

/** The two fragments most cases fold: rafa-9 added by commit b, rafa-1 by commit c. */
const TWO = [fragment('rafa-9', hash('b')), fragment('rafa-1', hash('c'))];

/** A push that landed `fragments`. */
function pushed(fragments: readonly SettleFragment[] = TWO): SettleDelivered {
  return { delivery: 'push', outcome: { outcome: 'pushed', exitCode: 0, attempts: 1, build: built(fragments) } };
}

/** One pull request node, as `associatedPullRequests` writes it. */
interface PullNode {
  readonly number: number;
  readonly state?: 'OPEN' | 'MERGED' | 'CLOSED';
  readonly baseRefName?: string;
  readonly body?: string;
  readonly mergeCommit?: string | null;
  /** Closing references, `[number, repository]`; this repository when the second is left out. */
  readonly closes?: readonly (readonly [number, string?])[];
}

/** `node` as `gh` writes it, its merge commit `commit` unless it names another. */
function pullAnswer(node: PullNode, commit: string): object {
  const merge = node.mergeCommit === undefined
    ? commit
    : node.mergeCommit;
  return {
    number: node.number,
    state: node.state ?? 'MERGED',
    baseRefName: node.baseRefName ?? BRANCH,
    body: node.body ?? '',
    mergeCommit: merge === null
      ? null
      : { oid: merge },
    closingIssuesReferences: {
      pageInfo: { hasNextPage: false },
      nodes: (node.closes ?? []).map(([number, repository]) => ({ number, repository: { nameWithOwner: repository ?? REPOSITORY } })),
    },
  };
}

/** A runner over `pulls` (commit → its pull requests; a commit left out answers null), recording every argv. */
interface FakeGh {
  readonly open: () => GhRunner;
  readonly ran: () => readonly (readonly string[])[];
  readonly opened: () => number;
}

/** The commits one query's argv names, in alias order. */
function commitsOf(args: readonly string[]): readonly string[] {
  return args.filter((arg) => /^c\d+=/u.test(arg)).map((arg) => arg.slice(arg.indexOf('=') + 1));
}

function fakeGh(pulls: Readonly<Record<string, readonly PullNode[]>>, answer?: GhResult): FakeGh {
  const ran: (readonly string[])[] = [];
  let opened = 0;
  const run: GhRunner = (args) => {
    ran.push(args);
    if (answer !== undefined) return Promise.resolve(answer);
    const objects = Object.fromEntries(commitsOf(args).map((commit, index) => {
      const nodes = pulls[commit];
      return [`c${String(index)}`, nodes === undefined
        ? null
        : { associatedPullRequests: { pageInfo: { hasNextPage: false }, nodes: nodes.map((node) => pullAnswer(node, commit)) } }];
    }));
    const stdout = JSON.stringify({ data: { repository: { nameWithOwner: REPOSITORY, ...objects } } });
    return Promise.resolve({ ok: true, stdout, stderr: '' });
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

/** The config of a case, `board.project.number` set to `number`. */
function config(number: number | null = 6): RefreshConfig {
  return { boardProjectNumber: number, boardProjectRetries: false, boardProjectRetryWaitSeconds: 1, boardProjectWriteBatchSize: 5, boardProjectWritePauseMs: 0, boardRelationships: 'labels', roadmapIssue: null, releaseFragments: '.changes' };
}

/** How one case runs. */
interface CaseOptions {
  readonly gh: FakeGh;
  readonly delivered?: SettleDelivered;
  readonly config?: RefreshConfig;
  /** What the stand-in refresh answers; no warning when left out. */
  readonly answer?: () => Promise<ProjectRefresh>;
}

/** What one case came to: its answer and the issues each refresh asked for. */
interface Ran {
  readonly result: SettleProjectRefresh | null;
  readonly asked: readonly (readonly number[])[];
}

/** A stand-in refresh answering `warnings`. */
function answering(warnings: readonly string[]): () => Promise<ProjectRefresh> {
  return () => Promise.resolve({ kind: 'skipped', reason: 'no-issues', warnings });
}

async function ran(options: CaseOptions): Promise<Ran> {
  const asked: (readonly number[])[] = [];
  const answer = options.answer ?? answering([]);
  const settle: SettleProjectOptions = {
    delivered: options.delivered ?? pushed(),
    branch: BRANCH,
    config: options.config ?? config(),
    openGh: options.gh.open,
    refresh: (refreshOptions, issues) => {
      expect(refreshOptions.config).toBe(settle.config);
      asked.push(issues);
      return answer();
    },
  };
  return { result: await refreshProjectAfterSettle(settle), asked };
}

/** The usual answer: commit b brought #30 closing #21, commit c brought #31 closing #22. */
const USUAL: Readonly<Record<string, readonly PullNode[]>> = {
  [hash('b')]: [{ number: 30, closes: [[21]] }],
  [hash('c')]: [{ number: 31, body: 'Closes #22' }],
};

describe('when it runs', () => {
  it('reads the commits and refreshes after a push that landed', async () => {
    const gh = fakeGh(USUAL);

    const run = await ran({ gh });

    expect([gh.opened(), run.asked]).toEqual([1, [[21, 22]]]);
    expect(run.result).toEqual({ commits: [hash('b'), hash('c')], pullRequests: [30, 31], issues: [21, 22], warnings: [] });
  });

  it('refreshes after a push another settle beat to the same fragments', async () => {
    const gh = fakeGh(USUAL);
    const delivered: SettleDelivered = {
      delivery: 'push',
      outcome: { outcome: 'superseded', exitCode: 0, attempts: 1, build: built(TWO), base: hash('d'), winner: null, sentence: 'released first' },
    };

    const run = await ran({ gh, delivered });

    expect(run.asked).toEqual([[21, 22]]);
  });

  it('opens no runner and asks no refresh with board.project.number unset', async () => {
    const gh = fakeGh(USUAL);

    const run = await ran({ gh, config: config(null) });

    expect([run.result, run.asked, gh.opened()]).toEqual([null, [], 0]);
  });

  it('opens no runner for a pr delivery, whose fragments stay on the base until its pull request merges', async () => {
    const gh = fakeGh(USUAL);
    const delivered: SettleDelivered = {
      delivery: 'pr',
      outcome: {
        outcome: 'delivered',
        exitCode: 0,
        build: built(TWO),
        head: hash('f'),
        pushed: true,
        pull: {
          number: 12,
          title: 'chore: release 0.5.0',
          url: 'https://github.com/acme/demo/pull/12',
          state: 'open',
          headRefName: 'rafa/release',
          baseRefName: BRANCH,
          author: { login: 'rafa', isBot: false },
          isCrossRepository: false,
          updatedAt: '2026-10-07T00:00:00Z',
        },
        action: 'opened',
      },
    };

    const run = await ran({ gh, delivered });

    expect([run.result, gh.opened()]).toEqual([null, 0]);
  });

  it('opens no runner for a push that failed, which released nothing', async () => {
    const gh = fakeGh(USUAL);
    const delivered: SettleDelivered = {
      delivery: 'push',
      outcome: { outcome: 'protected', exitCode: 1, attempts: 1, build: built(TWO), sentence: 'main is protected' },
    };

    const run = await ran({ gh, delivered });

    expect([run.result, gh.opened()]).toEqual([null, 0]);
  });

  it('reads the commits but asks no refresh when no pull request closes an issue', async () => {
    const gh = fakeGh({ [hash('b')]: [{ number: 30, body: 'Refactors the form.' }] });

    const run = await ran({ gh });

    expect([gh.ran().length, run.asked]).toEqual([1, []]);
    expect(run.result).toEqual({ commits: [hash('b'), hash('c')], pullRequests: [30], issues: [], warnings: [] });
  });
});

describe('what it sends', () => {
  it('names each distinct commit once, as a variable, in fold order', async () => {
    const gh = fakeGh(USUAL);
    const three = [...TWO, fragment('rafa-4', hash('b'))];

    await ran({ gh, delivered: pushed(three) });

    expect(gh.ran()).toEqual([commitPullsArgs([hash('b'), hash('c')])]);
    expect(commitsOf(gh.ran()[0] ?? [])).toEqual([hash('b'), hash('c')]);
    expect(gh.ran()[0]?.join(' ')).not.toContain(`object(oid: "${hash('b')}")`);
  });

  it(`sends one query per ${String(COMMIT_BATCH)} commits`, async () => {
    const commits = Array.from({ length: COMMIT_BATCH + 1 }, (_, index) => index.toString(16).padStart(40, '0'));
    const gh = fakeGh({});

    await ran({ gh, delivered: pushed(commits.map((commit, index) => fragment(`rafa-${String(index + 1)}`, commit))) });

    expect(gh.ran().map((args) => commitsOf(args).length)).toEqual([COMMIT_BATCH, 1]);
  });

  it('answers releasedCommits null for anything but a push that left the base without the fragments', () => {
    expect(releasedCommits(pushed())).toEqual([hash('b'), hash('c')]);
    expect(releasedCommits({ delivery: 'push', outcome: { outcome: 'unsettled', exitCode: 0, attempts: 1, build: { outcome: 'nothing', strategy: 'semver-by-level', commit: hash('a'), baseVersion: '0.4.0', fragments: TWO } } })).toBeNull();
  });
});

describe('which issues it refreshes', () => {
  it('reads the merged pull request whose merge commit is the commit, leaving out one not merged and one merged elsewhere', async () => {
    const gh = fakeGh({
      [hash('b')]: [
        { number: 29, state: 'OPEN', closes: [[40]] },
        { number: 28, mergeCommit: hash('e'), closes: [[41]] },
        { number: 30, closes: [[21]] },
      ],
    });

    const run = await ran({ gh, delivered: pushed([TWO[0] ?? fragment('rafa-9', hash('b'))]) });

    expect(run.asked).toEqual([[21]]);
    expect(run.result?.pullRequests).toEqual([30]);
  });

  it('falls back to the merged pull requests into the base when none merged as the commit, as a rebase merge reads', async () => {
    const gh = fakeGh({
      [hash('b')]: [
        { number: 30, mergeCommit: hash('e'), closes: [[21]] },
        { number: 32, mergeCommit: hash('e'), baseRefName: 'stretch/4', closes: [[42]] },
      ],
    });

    const run = await ran({ gh, delivered: pushed([fragment('rafa-9', hash('b'))]) });

    expect(run.asked).toEqual([[21]]);
  });

  it('joins the closing references on this repository with the issues the body closes, never a foreign reference', async () => {
    const gh = fakeGh({ [hash('b')]: [{ number: 30, closes: [[21], [23, 'acme/other']], body: 'Fixes #24\nCloses #21' }] });

    const run = await ran({ gh, delivered: pushed([fragment('rafa-9', hash('b'))]) });

    expect(run.asked).toEqual([[21, 24]]);
  });

  it('reads a commit GitHub does not hold as no pull request', async () => {
    const gh = fakeGh({ [hash('c')]: [{ number: 31, closes: [[22]] }] });

    const run = await ran({ gh });

    expect(run.result?.pullRequests).toEqual([31]);
    expect(run.asked).toEqual([[22]]);
  });

  it('names an issue once, in fold order, when two pull requests close it', async () => {
    const gh = fakeGh({ [hash('b')]: [{ number: 30, closes: [[22], [21]] }], [hash('c')]: [{ number: 31, closes: [[21]] }] });

    const run = await ran({ gh });

    expect(run.asked).toEqual([[22, 21]]);
  });
});

describe('every failure is a warning', () => {
  it('answers a query gh refused as one line naming board sync, asking no refresh', async () => {
    const gh = fakeGh(USUAL, { ok: false, stdout: '', stderr: 'gh: HTTP 502' });

    const run = await ran({ gh });

    expect(run.asked).toEqual([]);
    expect(run.result?.warnings).toHaveLength(1);
    expect(run.result?.warnings[0]).toStartWith('The project was not updated for the issues this release closes: ');
    expect(run.result?.warnings[0]).toContain('HTTP 502');
    expect(run.result?.warnings[0]).toEndWith('Run `rafa board sync` to catch up.');
  });

  it('answers an answer of another shape as a line, never rejecting', async () => {
    const gh = fakeGh(USUAL, { ok: true, stdout: '{"data":{"repository":null}}', stderr: '' });

    const run = await ran({ gh });

    expect(run.result?.warnings[0]).toContain('data.repository is null, expected a mapping');
  });

  it('refuses a second page of pull requests rather than read the first as complete', async () => {
    const stdout = JSON.stringify({ data: { repository: { nameWithOwner: REPOSITORY, c0: { associatedPullRequests: { pageInfo: { hasNextPage: true }, nodes: [] } }, c1: null } } });
    const gh = fakeGh(USUAL, { ok: true, stdout, stderr: '' });

    const run = await ran({ gh });

    expect(run.asked).toEqual([]);
    expect(run.result?.warnings[0]).toContain('associatedPullRequests holds more entries than one page');
  });

  it('answers the refresh\'s own lines as it answers them', async () => {
    const lines = ['The project was not updated: no scope.', 'The project\'s field "Rank" was skipped.'];

    const run = await ran({ gh: fakeGh(USUAL), answer: answering(lines) });

    expect(run.result?.warnings).toEqual(lines);
  });

  it('answers a refresh that rejects with one line naming every issue asked for', async () => {
    const run = await ran({ gh: fakeGh(USUAL), answer: () => Promise.reject(new Error('repo view refused')) });

    expect(run.result?.warnings).toEqual([settleProblemLine([21, 22], 'repo view refused')]);
    expect(run.result?.warnings[0]).toContain('The project was not updated for #21, #22: repo view refused.');
  });
});

describe('a call failing on a network error', () => {
  /** Runs the refresh after a push over {@link USUAL}, its commit query timing out once, with `retries` off the config. */
  async function runFlaky(retries: number | false) {
    const flaky = flakyGh(fakeGh(USUAL).open(), [TIMED_OUT_STDERR]);
    const recorder = recordRetries();
    const asked: (readonly number[])[] = [];
    const result = await refreshProjectAfterSettle({
      delivered: pushed(),
      branch: BRANCH,
      config: { ...config(), boardProjectRetries: retries, boardProjectRetryWaitSeconds: 2 },
      openGh: () => flaky.gh,
      refresh: (_options, issues) => {
        asked.push(issues);
        return answering([])();
      },
      retry: recorder.seams,
    });
    return { flaky, recorder, asked, result };
  }

  it('sends the commit query again after the wait, reporting the retry, and refreshes the issues it names', async () => {
    const run = await runFlaky(3);

    expect(run.recorder.notices().map(retryLine)).toEqual(['retrying repository (1 of 3): operation timed out']);
    expect(run.recorder.waits()).toEqual([2000]);
    expect(run.asked).toEqual([[21, 22]]);
    expect(run.result?.warnings).toEqual([]);
  });

  it('control: with board.project.retries false the query is sent once and its failure is the problem line', async () => {
    const run = await runFlaky(false);

    expect([run.recorder.notices().length, run.flaky.sent().length, run.asked]).toEqual([0, 1, []]);
    expect(run.result?.warnings[0]).toContain('operation timed out');
  });
});
