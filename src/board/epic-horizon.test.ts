/**
 * Tests for the horizon change core (`src/board/epic-horizon.ts`): the
 * refusals, the label swap and change it answers, the open work of an
 * in-progress epic, the failed readings carried as problems, and the two
 * writes.
 *
 * Every case reads a literal listing built by {@link issue}, whose type is
 * read with the tracker's own `typeOfLabels` as `parseBoardListing` does,
 * over a git runner, a pull request lister and a plan-name reader of its
 * own that count their calls; nothing spawns `git` or `gh`.
 *
 * ## The controls
 *
 *  - Each refusal is paired with the count of claim readings made, which
 *    must be zero, so a refusal raised after reading or writing fails.
 *  - The in-progress epic is read beside the same listing with no branch,
 *    pull request or plan, which must read `backlog` with no work, so a
 *    reader answering work for every epic fails.
 *  - The named branches sit beside a branch of issue 120 and one of a
 *    closed member, and the named pull requests beside one closing an
 *    issue of another epic; none of the three may be named.
 *  - An epic with no open member is read with runners that count calls,
 *    which must stay at zero, beside the open-member case that must read.
 */
import type { HorizonChangeInput } from './epic-horizon.js';
import type { EpicState } from './epics.js';
import type { BoardComment, IssueBoard } from './issue-board.js';
import type { BoardIssue } from './roadmap-board.js';
import type { RoadmapPullRequest } from './roadmap.js';
import type { GitResult, GitRunner } from '../pr/git.js';

import { describe, expect, test } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';
import { CommandExit } from '../cli/command.js';

import {
  applyHorizonChange,
  branchNameOf,
  EPIC_HORIZON_REFUSAL_EXIT,
  horizonLabel,
  readHorizonChange,
} from './epic-horizon.js';
import { renderHorizonComment } from './epic-trail.js';

/** The fields a case may set on an issue. */
interface IssueFields {
  readonly labels?: readonly string[];
  readonly state?: 'OPEN' | 'CLOSED';
  readonly stateReason?: string | null;
}

/** One listing row, its type read from its labels. */
function issue(number: number, fields: IssueFields = {}): BoardIssue {
  const labels = fields.labels ?? [];
  return {
    number,
    title: `issue ${String(number)}`,
    body: '',
    state: fields.state ?? 'OPEN',
    stateReason: fields.stateReason ?? null,
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
  };
}

/** Epic 40, `epic:auth`, standing on `horizons` (one label each). */
function epic40(horizons: readonly string[] = ['horizon:now'], fields: IssueFields = {}): BoardIssue {
  return issue(40, { ...fields, labels: ['type:epic', 'epic:auth', ...horizons] });
}

/** A member of `epic:auth`. */
function member(number: number, fields: IssueFields = {}): BoardIssue {
  return issue(number, { ...fields, labels: ['epic:auth'] });
}

/** A member closed as completed. */
const COMPLETED: IssueFields = { state: 'CLOSED', stateReason: 'COMPLETED' };

/** Epic 40 with open members 12 and 14, closed member 13, and issue 120 of another epic. */
const LISTING: readonly BoardIssue[] = [
  epic40(),
  member(12),
  member(13, COMPLETED),
  member(14),
  issue(50, { labels: ['type:epic', 'epic:billing', 'horizon:next'] }),
  issue(120, { labels: ['epic:billing'] }),
];

/** What the stand-in git holds. */
interface GitFixture {
  /** Refs `git for-each-ref` answers, or null for a failed read. */
  readonly local?: readonly string[] | null;
  /** Heads `git ls-remote --heads` answers, or null for a failed read. */
  readonly pushed?: readonly string[] | null;
}

/** A git runner answering `fixture`, told apart by its subcommand, recording every call. */
function fakeGit(fixture: GitFixture = {}): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const answer = (lines: readonly string[] | null | undefined, failure: string): GitResult => lines === null
    ? { ok: false, stdout: '', stderr: failure }
    : { ok: true, stdout: (lines ?? []).join('\n'), stderr: '' };
  const git: GitRunner = (args) => {
    calls.push([...args]);
    if (args[0] === 'for-each-ref') return answer(fixture.local, 'fatal: not a git repository');
    if (args[0] === 'ls-remote') {
      const heads = fixture.pushed === null
        ? null
        : (fixture.pushed ?? []).map((head) => `abc123\t${head}`);
      return answer(heads, 'fatal: could not read from remote');
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  return { git, calls };
}

/** The seams a case reads through, each counting its calls. */
interface Seams {
  readonly input: HorizonChangeInput;
  readonly gitCalls: string[][];
  readonly counts: { pulls: number; plans: number };
}

/** An input moving epic 40 to `to` over `issues` and the given readings. */
function seams(options: {
  readonly issues?: readonly BoardIssue[];
  readonly to?: HorizonChangeInput['to'];
  readonly git?: GitFixture;
  readonly pulls?: readonly RoadmapPullRequest[] | Error;
  readonly plans?: readonly string[];
} = {}): Seams {
  const { git, calls } = fakeGit(options.git);
  const counts = { pulls: 0, plans: 0 };
  const input: HorizonChangeInput = {
    issues: options.issues ?? LISTING,
    epic: 40,
    to: options.to ?? 'later',
    git,
    pullRequests: async () => {
      counts.pulls += 1;
      const pulls = options.pulls ?? [];
      if (pulls instanceof Error) throw pulls;
      return Promise.resolve(pulls);
    },
    planNames: () => {
      counts.plans += 1;
      return options.plans ?? [];
    },
    today: new Date(2026, 8, 28),
  };
  return { input, gitCalls: calls, counts };
}

/** An open pull request. */
function pull(number: number, headRefName: string, body = ''): RoadmapPullRequest {
  return { number, headRefName, body };
}

/** The refusal `read` rejects with. */
async function refusalOf(read: Promise<unknown>): Promise<CommandExit> {
  try {
    await read;
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('expected a refusal, and the change was read');
}

describe('readHorizonChange refusals', () => {
  const cases: readonly (readonly [string, readonly BoardIssue[], HorizonChangeInput['to'], string])[] = [
    ['an issue not on the listing', [member(12)], 'later', '#40 is not on the board listing, so it is not an open epic'],
    ['an issue that is not an epic', [issue(40, { labels: ['horizon:now'] })], 'later', '#40 is not an epic: it carries no type:epic label'],
    ['a closed epic', [epic40(['horizon:now'], COMPLETED)], 'later', 'Epic #40 is closed, and only an open epic changes horizon'],
    ['a target equal to the standing horizon', [epic40(['horizon:later'])], 'later', 'Epic #40 is already horizon:later'],
    [
      'an epic with no horizon label',
      [epic40([])],
      'next',
      'Epic #40 carries no horizon: label, so its standing horizon cannot be read;'
        + ' leave exactly one of horizon:now, horizon:next or horizon:later on it and run again',
    ],
    [
      'an epic with two horizon labels',
      [epic40(['horizon:now', 'horizon:next'])],
      'later',
      'Epic #40 carries horizon:now, horizon:next, so its standing horizon cannot be read;'
        + ' leave exactly one of horizon:now, horizon:next or horizon:later on it and run again',
    ],
    [
      'an epic with an unknown horizon value',
      [epic40(['horizon:someday'])],
      'later',
      'Epic #40 carries horizon:someday, so its standing horizon cannot be read;'
        + ' leave exactly one of horizon:now, horizon:next or horizon:later on it and run again',
    ],
  ];

  for (const [name, issues, to, message] of cases) {
    test(`refuses ${name} with exit 2 before any claim is read`, async () => {
      const { input, gitCalls, counts } = seams({ issues: [...issues, member(12)], to });
      const refused = await refusalOf(readHorizonChange(input));
      expect(refused.exitCode).toBe(EPIC_HORIZON_REFUSAL_EXIT);
      expect(refused.message).toBe(`❌ ${message}; nothing was changed`);
      expect(gitCalls).toEqual([]);
      expect(counts).toEqual({ pulls: 0, plans: 0 });
    });
  }

  test('reads a change to a different horizon from the same epic (control)', async () => {
    const { input } = seams({ issues: [epic40(['horizon:later'])], to: 'next' });
    const reading = await readHorizonChange(input);
    expect(reading.change).toEqual({ kind: 'horizon', epic: 40, from: 'later', to: 'next' });
  });
});

describe('readHorizonChange answers the swap and the state', () => {
  test('answers the swap, the change, and empty work for an epic in progress by a closed member', async () => {
    const { input, gitCalls, counts } = seams();
    const reading = await readHorizonChange(input);
    expect(reading).toEqual({
      change: { kind: 'horizon', epic: 40, from: 'now', to: 'later' },
      removed: 'horizon:now',
      added: 'horizon:later',
      state: 'in-progress',
      work: { branches: [], pullRequests: [] },
      problems: [],
    });
    expect(gitCalls).toHaveLength(2);
    expect(counts).toEqual({ pulls: 1, plans: 1 });
  });

  test('reads backlog with no work when no member is closed or claimed', async () => {
    const issues = [epic40(), member(12), member(14)];
    const { input } = seams({ issues });
    const reading = await readHorizonChange(input);
    expect(reading.state).toBe('backlog');
    expect(reading.work).toBeNull();
  });
});

describe('readHorizonChange on an in-progress epic', () => {
  const BRANCHES: GitFixture = {
    local: [
      'refs/heads/main',
      'refs/heads/feat/rafa-12-login',
      'refs/remotes/origin/feat/rafa-12-login',
      'refs/heads/feat/rafa-13-done',
      'refs/heads/feat/rafa-120-billing',
    ],
    pushed: ['refs/heads/feat/rafa-12-login', 'refs/heads/feat/rafa-14-tokens'],
  };
  const PULLS: readonly RoadmapPullRequest[] = [
    pull(9, 'feat/rafa-120-billing', 'Closes #120'),
    pull(8, 'someone/tokens', 'Fixes #14'),
    pull(7, 'feat/rafa-12-login', 'no closing keyword here'),
  ];

  test('names the open members\' branches once each and their pull requests ascending', async () => {
    const issues = [epic40(), member(12), member(13), member(14)].map((row) => row.number === 13
      ? member(13, COMPLETED)
      : row);
    const { input } = seams({ issues, git: BRANCHES, pulls: PULLS });
    const reading = await readHorizonChange(input);
    expect(reading.state).toBe('in-progress');
    expect(reading.work).toEqual({
      branches: ['feat/rafa-12-login', 'feat/rafa-14-tokens'],
      pullRequests: [7, 8],
    });
    expect(reading.problems).toEqual([]);
  });

  test('reads in-progress from a plan file alone, with no branch or pull request to name', async () => {
    const issues = [epic40(), member(12), member(14)];
    const { input } = seams({ issues, plans: ['PLAN-rafa-12-login.md'] });
    const reading = await readHorizonChange(input);
    expect(reading.state).toBe('in-progress');
    expect(reading.work).toEqual({ branches: [], pullRequests: [] });
  });

  test('carries a failed branch half and a failed pull request listing as problems', async () => {
    const issues = [epic40(), member(12), member(14)];
    const { input } = seams({
      issues,
      git: { local: ['refs/heads/feat/rafa-12-login'], pushed: null },
      pulls: new Error('gh: HTTP 502'),
    });
    const reading = await readHorizonChange(input);
    expect(reading.work).toEqual({ branches: ['feat/rafa-12-login'], pullRequests: [] });
    expect(reading.problems).toHaveLength(2);
    expect(reading.problems[0]).toStartWith('the branches on origin could not be read');
    expect(reading.problems[1]).toBe('the open pull requests could not be read, so none is named: gh: HTTP 502');
  });
});

describe('readHorizonChange on an epic with no open member', () => {
  const cases: readonly (readonly [string, readonly BoardIssue[], EpicState])[] = [
    ['an empty epic', [epic40()], 'empty'],
    ['a done epic', [epic40(), member(12, COMPLETED)], 'done'],
  ];
  for (const [name, issues, state] of cases) {
    test(`reads ${name} with no git, pull request or plan read, and no work`, async () => {
      const { input, gitCalls, counts } = seams({ issues, git: { local: ['refs/heads/feat/rafa-12-x'] } });
      const reading = await readHorizonChange(input);
      expect(reading.state).toBe(state);
      expect(reading.work).toBeNull();
      expect(gitCalls).toEqual([]);
      expect(counts).toEqual({ pulls: 0, plans: 0 });
    });
  }
});

describe('branchNameOf and horizonLabel', () => {
  test('takes the local and remote-tracking prefixes off, and nothing else', () => {
    expect(branchNameOf('refs/heads/feat/rafa-12-x')).toBe('feat/rafa-12-x');
    expect(branchNameOf('refs/remotes/upstream/feat/rafa-12-x')).toBe('feat/rafa-12-x');
    expect(branchNameOf('feat/rafa-12-x')).toBe('feat/rafa-12-x');
  });

  test('spells the horizon label', () => {
    expect(horizonLabel('next')).toBe('horizon:next');
  });
});

describe('applyHorizonChange', () => {
  const READING = {
    change: { kind: 'horizon', epic: 40, from: 'now', to: 'later' },
    removed: 'horizon:now',
    added: 'horizon:later',
  } as const;

  /** A board recording its writes, failing the swap when told to. */
  function recordingBoard(failSwap = false): { board: IssueBoard; writes: string[] } {
    const writes: string[] = [];
    const unused = async (): Promise<never> => Promise.reject(new Error('not used'));
    const board: IssueBoard = {
      comments: unused,
      editComment: unused,
      removeLabel: unused,
      closeIssue: unused,
      createLabel: unused,
      createIssue: unused,
      closePullRequest: unused,
      swapLabels: async (issue, removed, added) => {
        if (failSwap) throw new Error('board issue: gh issue edit 40 failed: HTTP 403');
        writes.push(`swap ${String(issue)} ${removed} ${added}`);
        return Promise.resolve();
      },
      comment: async (issue, body): Promise<BoardComment> => {
        writes.push(`comment ${String(issue)} ${body}`);
        return Promise.resolve({ id: '1', body, author: '' });
      },
    };
    return { board, writes };
  }

  test('swaps the labels, then posts the trail comment with the reason', async () => {
    const { board, writes } = recordingBoard();
    await applyHorizonChange(board, READING, 'waiting on #118');
    expect(writes).toEqual([
      'swap 40 horizon:now horizon:later',
      `comment 40 ${renderHorizonComment(READING.change, 'waiting on #118')}`,
    ]);
  });

  test('posts no comment when the swap fails, and rejects with its message', async () => {
    const { board, writes } = recordingBoard(true);
    let rejected: unknown = null;
    try {
      await applyHorizonChange(board, READING, 'waiting on #118');
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).toBe('board issue: gh issue edit 40 failed: HTTP 403');
    expect(writes).toEqual([]);
  });
});
