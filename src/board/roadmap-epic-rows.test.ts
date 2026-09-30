/**
 * Tests for the epic rows (`src/board/roadmap-epic-rows.ts`): the
 * Roadmap's epic lines joined to `readEpics`, grouped by horizon, the
 * spec lines kept as today's rows, the label problems carried as
 * warnings, and each seam asked once however many readers need it.
 *
 * Every read is planted, as `./roadmap-rows.test.ts` plants them: the
 * board a fixed listing, the Roadmap a reader answering one body, git a
 * runner answering fixed refs, the pull requests a fixed list, the plan
 * dir a fixed list of names and the saved copies an empty map.
 *
 * The planted board holds four epics: #100 `now` with one member closed
 * and one open, #200 `now` whose one member is claimed only by a branch,
 * #300 `next`, and #400 with no `horizon:` label. #50 and #51 are specs.
 *
 * The claims on #201's branch are read through {@link claimGit}, a git
 * whose remote holds `feat/rafa-201-beta-one` with the ownership commits
 * `formatClaimMessage` writes, so `claimsOf` weighs the branch through
 * the walk's own taken reading. A released claim, which must leave #200
 * in the backlog, is read beside a held one, a stale one under each
 * stage label and one that could not be fetched, which must all claim.
 */
import type { BoardLister } from './boards.js';
import type { SpecIssue, SpecIssueReader } from './issue.js';
import type { BoardIssue, BoardListing } from './roadmap-board.js';
import type { RefsCell, RoadmapRowsOptions } from './roadmap-rows.js';
import type { RoadmapPullRequest, RoadmapSearch } from './roadmap.js';
import type { GitRunner } from '../pr/git.js';

import { describe, expect, it } from 'bun:test';

import { formatClaimMessage } from '../claims/record.js';
import { CLAIMED_LABEL, IN_DEVELOPMENT_LABEL } from '../claims/stale.js';
import { completeSpecBody } from '../tests/spec-bodies.js';

import { renderCancelledEpicNotice } from './epic-cancel-notice.js';
import { SPEC_READY_LABEL } from './readiness.js';
import {
  FALLBACK_HORIZON,
  groupByHorizon,
  hasEpicLines,
  horizonOf,
  readRoadmapEpicRows,
} from './roadmap-epic-rows.js';
import { readRoadmapRows } from './roadmap-rows.js';

const ROADMAP = 1;

/** A fixed day, so lateness does not move with the clock. */
const TODAY = new Date(2026, 8, 27);

/** One issue on the planted board. */
function issue(number: number, fields: Partial<BoardIssue> = {}): BoardIssue {
  return {
    number,
    title: `Issue ${String(number)}`,
    body: completeSpecBody(`Issue ${String(number)}`),
    state: 'OPEN',
    stateReason: null,
    labels: [SPEC_READY_LABEL],
    type: 'code',
    module: 'unassigned',
    ...fields,
  };
}

/** An epic issue labelled `epic:<slug>` and `horizons`, its checklist naming `lines`. */
function epic(number: number, slug: string, horizons: readonly string[], lines: readonly number[]): BoardIssue {
  const checklist = lines.map((line) => `- [ ] #${String(line)}`).join('\n');
  return issue(number, {
    title: `Epic ${slug}`,
    body: `## Acceptance criteria\n\n- it works\n\n${checklist}\n`,
    labels: ['type:epic', `epic:${slug}`, ...horizons],
    type: 'epic',
  });
}

/** A member of `slug`. */
function member(number: number, slug: string, fields: Partial<BoardIssue> = {}): BoardIssue {
  return issue(number, { labels: [SPEC_READY_LABEL, `epic:${slug}`], ...fields });
}

/** A roadmap body with one unticked line per number, and `ticked` ticked. */
function roadmapBody(lines: readonly number[], ticked: readonly number[] = []): string {
  const unticked = lines.map((line) => `- [ ] #${String(line)} — line ${String(line)}`);
  const done = ticked.map((line) => `- [x] #${String(line)} — ticked ${String(line)}`);
  return ['## Next, in order', '', ...done, ...unticked, ''].join('\n');
}

/** The mixed Roadmap: a spec, three epics, a spec, the fourth epic, the first again. */
const MIXED = roadmapBody([50, 100, 300, 200, 51, 400, 100]);

/** The planted board. */
const BOARD: readonly BoardIssue[] = [
  epic(100, 'alpha', ['horizon:now'], [101, 102]),
  member(101, 'alpha', { state: 'CLOSED', stateReason: 'COMPLETED' }),
  member(102, 'alpha'),
  epic(200, 'beta', ['horizon:now'], [201]),
  member(201, 'beta'),
  epic(300, 'gamma', ['horizon:next'], [301]),
  member(301, 'gamma'),
  epic(400, 'delta', [], [401]),
  member(401, 'delta'),
  issue(50),
  issue(51),
];

/** Everything a case counts: how often each seam was asked. */
interface Counts {
  board: number;
  pulls: number;
  planNames: number;
  git: readonly string[];
}

/** A git counting each command, answering `for-each-ref` with a branch claiming #201. */
function countingGit(counts: Counts): GitRunner {
  return (args) => {
    counts.git = [...counts.git, args[0] ?? ''];
    return args[0] === 'ls-remote'
      ? { ok: true, stdout: '', stderr: '' }
      : { ok: true, stdout: 'refs/heads/main\nrefs/heads/feat/rafa-201-beta-one', stderr: '' };
  };
}

/** The options over `board` and a Roadmap reading `body`, `overrides` laid over them, and the counts. */
function planted(
  body: string,
  overrides: Partial<RoadmapRowsOptions> = {},
  board: readonly BoardIssue[] = BOARD,
): { options: RoadmapRowsOptions; counts: Counts } {
  const counts: Counts = { board: 0, pulls: 0, planNames: 0, git: [] };
  const listing: BoardListing = () => {
    counts.board += 1;
    return Promise.resolve(board);
  };
  const issues: SpecIssueReader = (number) => {
    const read: SpecIssue = { number, title: 'Roadmap', body, state: 'OPEN', labels: [], author: 'owner' };
    return Promise.resolve(read);
  };
  const search: RoadmapSearch = () => Promise.resolve([{ number: ROADMAP, title: 'Roadmap' }]);
  // No issue carries type:roadmap, so roadmap.issue decides as before.
  const listBoards: BoardLister = () => Promise.resolve([]);
  const pullRequests = (): Promise<readonly RoadmapPullRequest[]> => {
    counts.pulls += 1;
    return Promise.resolve([]);
  };
  const options: RoadmapRowsOptions = {
    configured: ROADMAP,
    listBoards,
    search,
    issues,
    board: listing,
    git: countingGit(counts),
    pullRequests,
    planNames: () => {
      counts.planNames += 1;
      return [];
    },
    refs: () => Promise.resolve(new Map<number, RefsCell>()),
    ...overrides,
  };
  return { options, counts };
}

describe('horizonOf', () => {
  it('reads the one horizon label', () => {
    expect(horizonOf(['type:epic', 'horizon:now'])).toBe('now');
    expect(horizonOf(['horizon:next'])).toBe('next');
    expect(horizonOf(['horizon:later'])).toBe('later');
  });

  it('groups an epic with no horizon, two, or an unknown value under later', () => {
    expect(FALLBACK_HORIZON).toBe('later');
    expect(horizonOf(['type:epic'])).toBe('later');
    expect(horizonOf(['horizon:now', 'horizon:next'])).toBe('later');
    expect(horizonOf(['horizon:someday'])).toBe('later');
  });
});

describe('groupByHorizon', () => {
  it('orders the groups now, next, later and leaves an empty one out', async () => {
    const { options } = planted(MIXED, { all: true });
    const read = await readRoadmapEpicRows({ ...options, today: TODAY });
    const rows = read.groups.flatMap((group) => group.rows);
    const regrouped = groupByHorizon([...rows].reverse());
    expect(regrouped.map((group) => group.horizon)).toEqual(['now', 'next', 'later']);
    expect(groupByHorizon(rows.filter((row) => row.horizon !== 'next')).map((group) => group.horizon))
      .toEqual(['now', 'later']);
  });
});

describe('readRoadmapEpicRows on a roadmap with no epic line', () => {
  it('answers exactly the rows and warnings readRoadmapRows answers', async () => {
    const body = roadmapBody([50, 51]);
    // The board still holds epics and a label problem (#400 has no horizon).
    const read = await readRoadmapEpicRows({ ...planted(body).options, today: TODAY });
    const today = await readRoadmapRows(planted(body).options);

    expect(read.specs).toEqual(today.rows);
    expect(read.warnings).toEqual(today.warnings);
    expect(read.groups).toEqual([]);
    expect(read.hidden).toBe(0);
    expect(read.problems).toEqual([]);
    expect(hasEpicLines(read)).toBe(false);
  });
});

describe('readRoadmapEpicRows on a mixed roadmap', () => {
  it('shows the now group only, in roadmap order, and counts the rest hidden', async () => {
    const read = await readRoadmapEpicRows({ ...planted(MIXED).options, today: TODAY });

    expect(read.groups.map((group) => group.horizon)).toEqual(['now']);
    expect(read.groups[0]?.rows.map((row) => row.line.issue)).toEqual([100, 200, 100]);
    expect(read.hidden).toBe(2);
    expect(hasEpicLines(read)).toBe(true);
    expect(read.specs.map((row) => row.line.issue)).toEqual([50, 51]);
  });

  it('joins each epic line to its computed state and done/total, claims read off the branch scan', async () => {
    const read = await readRoadmapEpicRows({ ...planted(MIXED).options, today: TODAY });
    const [alpha, beta] = read.groups[0]?.rows ?? [];

    expect(alpha?.epic.state).toBe('in-progress');
    expect(alpha?.epic.progress).toEqual({ done: 1, total: 2, notPlanned: 0 });
    // #201 is open and only a branch claims it: without the claim this reads backlog.
    expect(beta?.epic.state).toBe('in-progress');
    expect(beta?.epic.progress).toEqual({ done: 0, total: 1, notPlanned: 0 });
  });

  it('reads an unclaimed epic with no member closed as backlog, the control for the claim', async () => {
    const { options } = planted(MIXED, { git: () => ({ ok: true, stdout: '', stderr: '' }) });
    const read = await readRoadmapEpicRows({ ...options, today: TODAY });
    expect(read.groups[0]?.rows[1]?.epic.state).toBe('backlog');
  });

  it('counts a member claimed by a plan file or an open pull request', async () => {
    const byPlan = planted(MIXED, { git: () => ({ ok: true, stdout: '', stderr: '' }), planNames: () => ['PLAN-rafa-201-beta.md'] });
    const byPull = planted(MIXED, {
      git: () => ({ ok: true, stdout: '', stderr: '' }),
      pullRequests: () => Promise.resolve([{ number: 9, headRefName: 'x', body: 'Closes #201' }]),
    });
    const plan = await readRoadmapEpicRows({ ...byPlan.options, today: TODAY });
    const pull = await readRoadmapEpicRows({ ...byPull.options, today: TODAY });
    expect(plan.groups[0]?.rows[1]?.epic.state).toBe('in-progress');
    expect(pull.groups[0]?.rows[1]?.epic.state).toBe('in-progress');
  });

  it('widens to every horizon with all, the unlabelled epic under later, and keeps ticked lines', async () => {
    const body = roadmapBody([100, 300, 400], [200]);
    const read = await readRoadmapEpicRows({ ...planted(body, { all: true }).options, today: TODAY });

    expect(read.groups.map((group) => [group.horizon, group.rows.map((row) => row.line.issue)]))
      .toEqual([['now', [200, 100]], ['next', [300]], ['later', [400]]]);
    expect(read.hidden).toBe(0);
    expect(read.groups[0]?.rows[0]?.line.ticked).toBe(true);
  });

  it('leaves a ticked epic line out without all', async () => {
    const body = roadmapBody([100], [200]);
    const read = await readRoadmapEpicRows({ ...planted(body).options, today: TODAY });
    expect(read.groups[0]?.rows.map((row) => row.line.issue)).toEqual([100]);
  });

  it('carries every type:epic issue on the listing, not only the ones the roadmap names', async () => {
    const read = await readRoadmapEpicRows({ ...planted(roadmapBody([100])).options, today: TODAY });
    expect(read.epics.epics.map((one) => one.number)).toEqual([100, 200, 300, 400]);
    expect(read.unknown).toBeNull();
  });

  it('carries the label problems after the rows warnings, as sentences and as data', async () => {
    const failingPulls = planted(MIXED, { pullRequests: () => Promise.reject(new Error('gh pr list broke')) });
    const read = await readRoadmapEpicRows({ ...failingPulls.options, today: TODAY });

    expect(read.problems.map((problem) => [problem.kind, problem.issue])).toEqual([['horizon', 400]]);
    expect(read.warnings).toEqual([
      'the open pull requests could not be listed, so no pr is shown: gh pr list broke',
      'epic #400 carries no horizon: label; add one of horizon:now, horizon:next or horizon:later',
    ]);
  });

  it('carries the problems when every epic line is hidden by its horizon', async () => {
    const read = await readRoadmapEpicRows({ ...planted(roadmapBody([300])).options, today: TODAY });
    expect(read.groups).toEqual([]);
    expect(read.hidden).toBe(1);
    expect(hasEpicLines(read)).toBe(true);
    expect(read.problems).toHaveLength(1);
  });

  it('keeps an epic line whose issue the listing does not hold as a spec row', async () => {
    const board = BOARD.filter((one) => one.number !== 300);
    const read = await readRoadmapEpicRows({ ...planted(MIXED, { all: true }, board).options, today: TODAY });
    expect(read.specs.map((row) => row.line.issue)).toEqual([50, 300, 51]);
    expect(read.groups.flatMap((group) => group.rows).map((row) => row.line.issue)).toEqual([100, 200, 100, 400]);
  });
});

describe('readRoadmapEpicRows with an epic closed as not planned', () => {
  /** Epic #500 closed as not planned, its open member #501, and spec #51 waiting on #501. */
  const CANCELLED: readonly BoardIssue[] = [
    ...BOARD.filter((one) => one.number !== 51),
    { ...epic(500, 'omega', ['horizon:now'], [501]), state: 'CLOSED', stateReason: 'NOT_PLANNED' },
    member(501, 'omega'),
    issue(51, { body: `${completeSpecBody('Issue 51')}\nBlocked by: #501\n` }),
  ];
  const NOTICE = renderCancelledEpicNotice({ epic: 500, dependents: [51] });

  it('warns the notice last, from the one listing, on a mixed roadmap', async () => {
    const { options, counts } = planted(MIXED, {}, CANCELLED);
    const read = await readRoadmapEpicRows({ ...options, today: TODAY });

    expect(read.warnings.at(-1)).toBe(NOTICE);
    expect(read.warnings.filter((warning) => warning === NOTICE)).toHaveLength(1);
    expect(counts.board).toBe(1);
  });

  it('warns it on a roadmap naming no epic, too', async () => {
    const read = await readRoadmapEpicRows({ ...planted(roadmapBody([50, 51]), {}, CANCELLED).options, today: TODAY });

    expect(read.warnings).toEqual([NOTICE]);
  });

  it('warns no notice when no epic is cancelled (control)', async () => {
    const read = await readRoadmapEpicRows({ ...planted(MIXED).options, today: TODAY });

    expect(read.warnings.some((warning) => warning.includes('closed as not planned'))).toBe(false);
  });

  it('warns no notice when the listing failed', async () => {
    const failing = planted(MIXED, { board: () => Promise.reject(new Error('gh: HTTP 502')) }, CANCELLED);
    const read = await readRoadmapEpicRows({ ...failing.options, today: TODAY });

    expect(read.warnings.some((warning) => warning.includes('closed as not planned'))).toBe(false);
  });
});

/** What {@link claimGit} answers for #201's branch. */
interface ClaimGitOptions {
  /** The ownership actions on the branch, oldest first. */
  readonly actions: readonly ('claim' | 'release')[];
  /** How long before now the branch tip was committed. */
  readonly idleMs?: number;
  /** A fetch that fails with this stderr. */
  readonly fetchFails?: string;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * A git whose remote holds `feat/rafa-201-beta-one` carrying `actions`,
 * answering the scan and the claim reads, and recording each command.
 */
function claimGit(options: ClaimGitOptions): { run: GitRunner; calls: () => readonly string[] } {
  let calls: readonly string[] = [];
  const seconds = String(Math.floor((Date.now() - (options.idleMs ?? HOUR_MS)) / 1000));
  const walked = options.actions
    .map((action, index) => `${String(index + 1).repeat(40)}\n${formatClaimMessage({ action, issue: 201, store: 'store-a' })}\0`)
    .join('');
  const ok = (stdout: string): { ok: true; stdout: string; stderr: string } => ({ ok: true, stdout, stderr: '' });
  const answers: Readonly<Record<string, () => ReturnType<GitRunner>>> = {
    'for-each-ref': () => ok('refs/heads/main\n'),
    'ls-remote': () => ok(`${'f'.repeat(40)}\trefs/heads/feat/rafa-201-beta-one\n`),
    'fetch': () => options.fetchFails === undefined
      ? ok('')
      : { ok: false, stdout: '', stderr: options.fetchFails },
    'rev-parse': () => ok(`${'a'.repeat(40)}\n`),
  };
  return {
    run: (args) => {
      const command = args[0] ?? '';
      calls = [...calls, command];
      if (command === 'log') return ok(args[1] === '-1'
        ? `${seconds}\n`
        : walked);
      return answers[command]?.() ?? { ok: false, stdout: '', stderr: 'claimGit: no answer recorded' };
    },
    calls: () => calls,
  };
}

/** The board with #201 labelled `stage` besides its own labels. */
function boardWithStage(stage: string): readonly BoardIssue[] {
  return BOARD.map((one) => one.number === 201
    ? member(201, 'beta', { labels: [SPEC_READY_LABEL, 'epic:beta', stage] })
    : one);
}

/** Epic #200's computed state, #201's branch read through `git` over `board`. */
async function betaState(git: GitRunner, board: readonly BoardIssue[] = BOARD): Promise<string | undefined> {
  const read = await readRoadmapEpicRows({ ...planted(MIXED, { git }, board).options, today: TODAY });
  return read.groups[0]?.rows[1]?.epic.state;
}

describe('readRoadmapEpicRows weighs a branch through the roadmap taken reading', () => {
  it('reads an epic whose only branch claim was released as backlog', async () => {
    expect(await betaState(claimGit({ actions: ['claim', 'release'] }).run)).toBe('backlog');
  });

  it('reads the same branch held as in-progress, the control for the release', async () => {
    expect(await betaState(claimGit({ actions: ['claim'] }).run)).toBe('in-progress');
  });

  it('keeps a stale claim claiming the member under either stage label', async () => {
    const stale = { actions: ['claim'] as const, idleMs: 30 * DAY_MS };
    const claimed = await betaState(claimGit(stale).run, boardWithStage(CLAIMED_LABEL));
    const developing = await betaState(claimGit(stale).run, boardWithStage(IN_DEVELOPMENT_LABEL));

    expect([claimed, developing]).toEqual(['in-progress', 'in-progress']);
  });

  it('keeps a claim that could not be fetched claiming the member', async () => {
    const git = claimGit({ actions: ['claim', 'release'], fetchFails: 'fatal: unable to access origin' });

    expect(await betaState(git.run)).toBe('in-progress');
    expect(git.calls().filter((command) => command === 'fetch')).toHaveLength(1);
  });

  it('spends one fetch and one read of the branch, over the kept scan', async () => {
    const git = claimGit({ actions: ['claim', 'release'] });
    await betaState(git.run);

    expect(git.calls()).toEqual(['for-each-ref', 'ls-remote', 'fetch', 'rev-parse', 'log', 'log']);
  });
});

describe('readRoadmapEpicRows reads each seam once', () => {
  it('lists the board, the pull requests, the plan dir and each git command once', async () => {
    const { options, counts } = planted(MIXED);
    await readRoadmapEpicRows({ ...options, today: TODAY });
    expect(counts).toEqual({ board: 1, pulls: 1, planNames: 1, git: ['for-each-ref', 'ls-remote'] });
  });

  it('is measured by counts that do move: the rows and the epics read apart ask twice', async () => {
    const { options, counts } = planted(MIXED);
    await readRoadmapRows(options);
    await options.board();
    expect(counts.board).toBe(2);
  });

  it('asks a failing plan dir once and warns once', async () => {
    let asked = 0;
    const { options } = planted(MIXED, {
      planNames: () => {
        asked += 1;
        throw new Error('EACCES');
      },
    });
    const read = await readRoadmapEpicRows({ ...options, today: TODAY });
    expect(asked).toBe(1);
    expect(read.warnings.filter((warning) => warning.startsWith('the plan dir'))).toEqual([
      'the plan dir could not be read, so no plan is shown: EACCES',
    ]);
  });
});

describe('readRoadmapEpicRows on a failed listing', () => {
  it('keeps every line as a spec row, carries the reason, and warns only the rows warning', async () => {
    const { options, counts } = planted(MIXED, { board: () => Promise.reject(new Error('gh: HTTP 502')) });
    const read = await readRoadmapEpicRows({ ...options, today: TODAY });

    expect(read.specs.map((row) => row.line.issue)).toEqual([50, 100, 300, 200, 51, 400, 100]);
    expect(read.groups).toEqual([]);
    expect(read.unknown).toBe('gh: HTTP 502');
    expect(read.epics).toEqual({ epics: [], unknown: 'gh: HTTP 502' });
    expect(read.problems).toEqual([]);
    expect(read.warnings).toEqual([
      'the board could not be listed, so the spec and blocked by columns are empty: gh: HTTP 502',
    ]);
    expect(counts.pulls).toBe(0);
  });
});

describe('readRoadmapEpicRows on a Roadmap that cannot be read', () => {
  it('rejects as readRoadmapRows rejects', async () => {
    const { options } = planted(MIXED, { issues: () => Promise.reject(new Error('gh issue view failed')) });
    let caught: unknown = null;
    try {
      await readRoadmapEpicRows({ ...options, today: TODAY });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('gh issue view failed');
  });
});
