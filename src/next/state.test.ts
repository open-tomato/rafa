/**
 * Tests for the state table (`./state.ts`): the one state each reading
 * answers, the action and the two lines it carries, the order that
 * settles a reading two rows would both take, the two pre-conditions
 * that stop the table, and what the answer costs when an early row
 * settles it.
 *
 * `./readings.test.ts` drives the readings themselves — what a failed
 * fetch answers, what a detached HEAD answers, which sources are asked
 * at all — and this file drives none of that again. What only this file
 * can see is the RESOLUTION: which row wins, and what it says.
 *
 * Every case plants a situation and asks for the one state it answers.
 * The fakes are a `GitRunner` answering by argv, the pull request
 * double (`src/pr/pull-requests-double.ts`), a board of plain
 * functions, and a plans directory of its own under a temporary root,
 * so nothing here spawns `git`, spawns `gh` or reaches GitHub.
 *
 * ## The controls
 *
 * Every ordered pair is driven TWICE: once with both rows true, which
 * the earlier row must win, and once with the earlier row's reading
 * taken away, which the later row must then answer. A table that
 * answered the earlier row unconditionally would pass the first half of
 * each pair and fail the second. The pairs are 1 over 2, 1 over 4, 3
 * over 4, 4 over 5, 5 over 6, 6 over 7, 7 over 8, 8 over 9, 10 over 9,
 * 10 over 11 and 11 over 12, and the finished plan whose pull request
 * was merged in the browser, which is row 12 read off a plan branch.
 *
 * Each pre-condition is driven the same way: the modified tree beside
 * the same situation with a clean one, which answers row 9; the tree
 * holding untracked files alone beside the same two paths written as
 * tracked ones; and the unusable provider beside a provider that
 * answers no pull request, which is row 12. Both are held to asking
 * NOTHING they did not need, by the call log of the double.
 *
 * ## What passes while wrong
 *
 * Three mutations of `state.ts` were driven on 2026-09-21, one at a
 * time, over `env -u CLAUDECODE bun test src/next/`, the module
 * restored from a scratch copy and verified with `shasum -c` each time,
 * against 91 pass and 0 fail either side:
 *
 *  - row 9's "waits on nothing" conjunct dropped, so a line that is
 *    ready AND blocked answers `plan`: 88 pass and 3 fail, the 10-over-9
 *    pair and the two cases that read row 10 at all. Every other case
 *    plants a line that is one or the other, and none of them notices.
 *  - row 5 narrowed to a pending verdict alone, so a merge GitHub has
 *    not settled falls through rows 5, 6 and 7 to the last row: 90 pass
 *    and 1 fail, the unsettled-merge case alone. The three pull request
 *    rows stop partitioning an open pull request, and only the case
 *    that plants `unknown` sees it.
 *  - the order of rows 3 and 4 swapped, so a checklist holding a
 *    blocked task and an open one answers `tracker-open`: 87 pass and 4
 *    fail, the 3-over-4 pair, the two per-row cases for row 3 and the
 *    order of `NEXT_STATES`. Both rows propose `resume`, so what the
 *    mutant changes is the sentence the person reads and not the
 *    action — which is exactly what the two readings differ in.
 *
 * Two more were driven the same way on 2026-09-21, over the 110 pass
 * and 0 fail this file and `./readings.test.ts` answer together:
 *
 *  - the tree pre-condition moved BEHIND the table, read only once a
 *    row had matched and still winning over it: 108 pass and 2 fail,
 *    the tree read ahead of the unusable provider, and the problems
 *    case, which sees the roadmap walk the mutant paid for. Every
 *    ordering case still passes, because the tree still wins wherever a
 *    row answers — what the mutant really changes is the cost and the
 *    two pre-conditions' own order, so those are the cases that hold it.
 *  - the provider pre-condition read ahead of the whole table rather
 *    than ahead of rows 5, 6 and 7: 108 pass and 2 fail, both the cases
 *    that count what a running loop asks the double. Every answer is
 *    unchanged; the `gh` call is what the mutant spends.
 */
import type { NextBoard, NextRoadmapReading, NextSources } from './readings.js';
import type { BlockedLine } from '../board/blocked-line.js';
import type { SessionRecord } from '../loop/sessions.js';
import type { ChecksVerdict, GitResult, Mergeability, PullRequestDetail, PullRequests, PullRequestSummary } from '../pr/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { plansDirAt } from '../commands/plan/plan-files.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';

import { isPrecondition, NEXT_PRECONDITIONS, NEXT_STATES, readNextState } from './state.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-state-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The base branch every case runs against. */
const BASE = 'main';

/** The stub every planted plan carries. */
const STUB = 'rafa-63-one-command-next-step';

/** The branch that plan runs on. */
const PLAN_BRANCH = `feat/${STUB}`;

/** The pull request every case that plants one carries. */
const PR = 41;

/** The issue the roadmap points at. */
const ISSUE = 64;

/** A checklist with one task open. */
const OPEN_PLAN = ['# Plan: one', '', '# Stage: one', '', '- [ ] first', '- [ ] second', ''].join('\n');

/** A checklist with a blocked task beside an open one. */
const BLOCKED_TRACKER = ['# Plan: one', '', '# Stage: one', '', '- [BLOCKED] first', '- [ ] second', ''].join('\n');

/** A checklist with every task done. */
const DONE_TRACKER = ['# Plan: one', '', '# Stage: one', '', '- [x] first', '- [x] second', ''].join('\n');

/** What git answered when it worked. */
function said(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** A plan as a case plants one: its checklist, and the tracker beside it. */
interface PlantedPlan {
  readonly plan: string;
  readonly tracker?: string;
}

/** The open pull request a case plants. */
interface PlantedPull {
  readonly verdict: ChecksVerdict;
  readonly mergeable: Mergeability;
  readonly branch?: string;
}

/** What a case plants; every part left out is the default beside it. */
interface Situation {
  /** The branch at the project root. */
  readonly branch: string;
  /** What `git status --porcelain` wrote, one line per entry. */
  readonly tree: readonly string[];
  /** What `git rev-list --left-right --count` wrote. */
  readonly standing: string;
  /** The refs this clone holds. */
  readonly refs: readonly string[];
  /** The session records. */
  readonly runs: readonly SessionRecord[];
  /** The plans, by stub. */
  readonly plans: Readonly<Record<string, PlantedPlan>>;
  /** The open pull request of the branch, or null when it has none. */
  readonly pull: PlantedPull | null;
  /** What the roadmap walk answered. */
  readonly roadmap: NextRoadmapReading;
  /** Whether the picked line carries `spec:ready`. */
  readonly ready: boolean;
  /** Why the picked line waits, or null when it does not. */
  readonly blocked: BlockedLine | null;
}

/** A situation on the base branch with an exhausted roadmap: the last row. */
const NOTHING: Situation = {
  branch: BASE,
  tree: [],
  standing: '0\t0\n',
  refs: [],
  runs: [],
  plans: {},
  pull: null,
  roadmap: { roadmap: 31, line: null, passed: 12, problems: [] },
  ready: false,
  blocked: null,
};

/** How many scratch roots a case has been handed. */
let scratches = 0;

/** A plans directory holding `plans`, under a root no other case shares. */
function plantPlans(plans: Readonly<Record<string, PlantedPlan>>): string {
  scratches += 1;
  const root = join(tempBase, `case-${scratches}`);
  const dir = join(root, '.rafa', 'plans');
  mkdirSync(dir, { recursive: true });
  Object.entries(plans).forEach(([stub, planted]) => {
    writeFileSync(join(dir, `PLAN-${stub}.md`), planted.plan, 'utf8');
    if (planted.tracker !== undefined) {
      writeFileSync(join(dir, `PLAN_TRACKER-${stub}.md`), planted.tracker, 'utf8');
    }
  });
  return root;
}

/** A summary as `findOpen` answers one for `pull`. */
function summary(pull: PlantedPull): PullRequestSummary {
  return {
    number: PR,
    title: 'rafa-63: one command, the next step',
    url: `https://github.com/open-tomato/rafa/pull/${PR}`,
    state: 'open',
    headRefName: pull.branch ?? PLAN_BRANCH,
    baseRefName: BASE,
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-21T11:00:00Z',
  };
}

/** A detail as `get` answers one for `pull`. */
function detail(pull: PlantedPull): PullRequestDetail {
  return {
    ...summary(pull),
    body: 'Closes #63',
    headRefOid: 'abc1234',
    mergeable: pull.mergeable,
    mergeStateStatus: 'CLEAN',
    labels: [],
  };
}

/** A provider answering the pull request a case planted, or none. */
function providerFor(pull: PlantedPull | null): PullRequests {
  if (pull === null) return createPullRequestsDouble({ findOpen: () => Promise.resolve(null) }).pulls;

  return createPullRequestsDouble({
    findOpen: () => Promise.resolve(summary(pull)),
    get: () => Promise.resolve(detail(pull)),
    checks: () => Promise.resolve({ rows: [], verdict: pull.verdict }),
  }).pulls;
}

/** A board answering what the case planted. */
function boardFor(situation: Situation): NextBoard {
  return {
    next: () => Promise.resolve(situation.roadmap),
    blocking: () => Promise.resolve(situation.blocked),
    isReady: () => Promise.resolve(situation.ready),
  };
}

/** The sources a case is read over. */
function sourcesFor(over: Partial<Situation> = {}): NextSources {
  const situation: Situation = { ...NOTHING, ...over };
  const answers: Readonly<Record<string, GitResult>> = {
    'rev-parse --abbrev-ref HEAD': said(`${situation.branch}\n`),
    'status --porcelain': said(situation.tree.map((entry) => `${entry}\n`).join('')),
    [`rev-list --left-right --count ${BASE}...origin/${BASE}`]: said(situation.standing),
    'for-each-ref --format=%(refname) refs/heads refs/remotes': said(situation.refs.join('\n')),
  };
  return {
    base: BASE,
    plans: plansDirAt(plantPlans(situation.plans), '.rafa/plans'),
    runs: () => situation.runs,
    git: (args) => answers[args.join(' ')] ?? said(''),
    pulls: providerFor(situation.pull),
    board: boardFor(situation),
  };
}

/** One session record, filled from `over`. */
function record(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: '20260921-110000-abcd',
    planStub: STUB,
    plan: `.rafa/plans/PLAN-${STUB}.md`,
    branch: PLAN_BRANCH,
    pid: 4242,
    startedAt: '2026-09-21T11:00:00Z',
    state: 'running',
    task: null,
    ...over,
  };
}

/** A roadmap walk answering one line. */
function walked(): NextRoadmapReading {
  return {
    roadmap: 31,
    line: { issue: ISSUE, ticked: false, why: 'the next one', lineNumber: 4 },
    passed: 3,
    problems: [],
  };
}

/** A line that waits on one open issue. */
function waiting(): BlockedLine {
  return { issue: ISSUE, blockers: [24], open: [24], unread: [], fault: null };
}

/** The situation each row answers, planted once and shared by the cases that read it. */
const ROW: Readonly<Record<string, Partial<Situation>>> = {
  'loop-running': { runs: [record()] },
  'base-behind': { standing: '0\t2\n' },
  'tracker-blocked': { branch: PLAN_BRANCH, plans: { [STUB]: { plan: OPEN_PLAN, tracker: BLOCKED_TRACKER } } },
  'tracker-open': { branch: PLAN_BRANCH, plans: { [STUB]: { plan: OPEN_PLAN } } },
  'pr-pending': { branch: PLAN_BRANCH, pull: { verdict: 'pending', mergeable: 'mergeable' } },
  'pr-red': { branch: PLAN_BRANCH, pull: { verdict: 'red', mergeable: 'mergeable' } },
  'pr-green': { branch: PLAN_BRANCH, pull: { verdict: 'green', mergeable: 'mergeable' } },
  'plan-unstarted': { plans: { [STUB]: { plan: OPEN_PLAN } } },
  'issue-ready': { roadmap: walked(), ready: true },
  'issue-blocked': { roadmap: walked(), ready: true, blocked: waiting() },
  'issue-not-ready': { roadmap: walked(), ready: false },
  'nothing-left': {},
};

/** The state a situation answers. */
function stateOf(over: Partial<Situation> = {}): ReturnType<typeof readNextState> {
  return readNextState(sourcesFor(over));
}

describe('the table itself', () => {
  it('holds the twelve states in the order the spec writes them', () => {
    expect(NEXT_STATES).toEqual([
      'loop-running',
      'base-behind',
      'tracker-blocked',
      'tracker-open',
      'pr-pending',
      'pr-red',
      'pr-green',
      'plan-unstarted',
      'issue-ready',
      'issue-blocked',
      'issue-not-ready',
      'nothing-left',
    ]);
  });

  it.each(NEXT_STATES.map((id) => [id]))('answers %s for the situation that row names', async (id) => {
    const state = await stateOf(ROW[id]);

    expect(state.id).toBe(id);
  });

  it.each(NEXT_STATES.map((id) => [id]))('writes one line of reading and one of proposal for %s', async (id) => {
    const state = await stateOf(ROW[id]);

    expect(state.reading).not.toContain('\n');
    expect(state.proposal).not.toContain('\n');
    expect(state.reading.length).toBeGreaterThan(0);
    expect(state.proposal.length).toBeGreaterThan(0);
  });
});

describe('each row, with what it says and what it carries', () => {
  it('row 1 answers the running loop, with nothing to start beside it', async () => {
    const state = await stateOf(ROW['loop-running']);

    expect(state.action).toBe('none');
    expect(state.reading).toBe(`a loop for \`${STUB}\` is running on \`${PLAN_BRANCH}\`, session 20260921-110000-abcd`);
    expect(state.proposal).toContain('rafa loop status');
    expect(state.planStub).toBe(STUB);
  });

  it('row 1 answers a paused run too, since its run has not ended', async () => {
    const state = await stateOf({ runs: [record({ state: 'paused' })] });

    expect(state.id).toBe('loop-running');
    expect(state.reading).toContain('is paused on');
  });

  it('row 2 counts how far the base is behind, and proposes the fast-forward', async () => {
    const state = await stateOf(ROW['base-behind']);

    expect(state.action).toBe('sync');
    expect(state.reading).toBe('`main` is 2 commits behind `origin/main`');
    expect(state.proposal).toBe('fast-forward `main` to `origin/main`');
  });

  it('row 2 says the base has diverged, and still proposes the fast-forward that refuses it', async () => {
    const state = await stateOf({ standing: '1\t2\n' });

    expect(state.id).toBe('base-behind');
    expect(state.reading).toBe('`main` is 2 commits behind `origin/main` and 1 commit ahead of it');
    expect(state.proposal).toBe('fast-forward `main` to `origin/main`');
  });

  it('row 3 counts the blocked task beside the open one, and names the tracker it read', async () => {
    const state = await stateOf(ROW['tracker-blocked']);

    expect(state.action).toBe('resume');
    expect(state.reading).toBe(`\`${STUB}\` has 1 blocked task and 1 open one on \`${PLAN_BRANCH}\``);
    expect(state.proposal).toContain('retries a blocked task first');
    expect(state.planPath).toContain(join('.rafa', 'plans', `PLAN-${STUB}.md`));
  });

  it('row 4 counts the tasks left, and proposes the same resume', async () => {
    const state = await stateOf(ROW['tracker-open']);

    expect(state.action).toBe('resume');
    expect(state.reading).toBe(`\`${STUB}\` has 2 open tasks left on \`${PLAN_BRANCH}\``);
    expect(state.proposal).toBe(`resume the loop on \`${STUB}\``);
  });

  it('row 5 names the checks that are still running, and carries the pull request', async () => {
    const state = await stateOf(ROW['pr-pending']);

    expect(state.action).toBe('wait');
    expect(state.reading).toBe(`#${PR} is open on \`${PLAN_BRANCH}\` and its checks are still running`);
    expect(state.proposal).toBe(`wait for the checks on #${PR}`);
    expect(state.pullRequest).toBe(PR);
  });

  it('row 5 also takes a merge GitHub has not settled, which is neither row 6 nor row 7', async () => {
    const state = await stateOf({ branch: PLAN_BRANCH, pull: { verdict: 'green', mergeable: 'unknown' } });

    expect(state.id).toBe('pr-pending');
    expect(state.reading).toContain('GitHub has not settled whether it merges into `main`');
  });

  it('row 6 names red checks', async () => {
    const state = await stateOf(ROW['pr-red']);

    expect(state.action).toBe('triage');
    expect(state.reading).toBe(`#${PR} is open on \`${PLAN_BRANCH}\` and its checks are red`);
    expect(state.proposal).toBe(`triage #${PR}`);
  });

  it('row 6 names a conflict ahead of the checks that conflict left unscheduled', async () => {
    const state = await stateOf({ branch: PLAN_BRANCH, pull: { verdict: 'none', mergeable: 'conflicting' } });

    expect(state.id).toBe('pr-red');
    expect(state.reading).toContain('conflicts with `main`');
  });

  it('row 6 takes a pull request reporting no check at all', async () => {
    const state = await stateOf({ branch: PLAN_BRANCH, pull: { verdict: 'none', mergeable: 'mergeable' } });

    expect(state.id).toBe('pr-red');
    expect(state.reading).toContain('reports no check at all');
  });

  it('row 7 proposes the merge, naming the base it merges into', async () => {
    const state = await stateOf(ROW['pr-green']);

    expect(state.action).toBe('merge');
    expect(state.reading).toBe(`#${PR} is open on \`${PLAN_BRANCH}\`, green and merges into \`main\``);
    expect(state.proposal).toBe(`merge #${PR} into \`main\``);
  });

  it('row 8 names the plan nobody has started, and carries its file', async () => {
    const state = await stateOf(ROW['plan-unstarted']);

    expect(state.action).toBe('start');
    expect(state.reading).toBe(`\`${STUB}\` is planned, with no run and no branch`);
    expect(state.proposal).toBe(`start the loop on \`${STUB}\`, creating its branch`);
    expect(state.planPath).toContain(`PLAN-${STUB}.md`);
  });

  it('row 8 passes over a plan that has a run, and over one that has a branch', async () => {
    const hasRun = await stateOf({ plans: { [STUB]: { plan: OPEN_PLAN } }, runs: [record({ state: 'stopped' })] });
    const hasBranch = await stateOf({ plans: { [STUB]: { plan: OPEN_PLAN } }, refs: [`refs/heads/${PLAN_BRANCH}`] });

    expect([hasRun.id, hasBranch.id]).toEqual(['nothing-left', 'nothing-left']);
  });

  it('row 9 names the ready line and proposes its plan', async () => {
    const state = await stateOf(ROW['issue-ready']);

    expect(state.action).toBe('plan');
    expect(state.reading).toBe(`#${ISSUE} is next on the roadmap and carries \`spec:ready\``);
    expect(state.proposal).toBe(`create the plan for #${ISSUE}`);
    expect(state.issue).toBe(ISSUE);
  });

  it('row 10 names what the line waits on, in the board reading own words', async () => {
    const state = await stateOf(ROW['issue-blocked']);

    expect(state.action).toBe('unblock');
    expect(state.reading).toBe(`#${ISSUE} is blocked by #24 (open)`);
    expect(state.proposal).toContain('spec:blocked');
    expect(state.issue).toBe(ISSUE);
  });

  it('row 11 names the missing label and proposes marking it ready', async () => {
    const state = await stateOf(ROW['issue-not-ready']);

    expect(state.action).toBe('ready');
    expect(state.reading).toBe(`#${ISSUE} not ready: it carries no spec:ready label`);
    expect(state.proposal).toBe(`check the spec of #${ISSUE} and mark it ready`);
  });

  it('row 12 names the roadmap it walked and how many lines it passed', async () => {
    const state = await stateOf(ROW['nothing-left']);

    expect(state.action).toBe('none');
    expect(state.reading).toBe('the roadmap, issue #31, has no line left that is not done or taken (12 lines passed)');
    expect(state.proposal).toBe('open the next spec issue and add it to the roadmap');
  });
});

describe('two rows both true: the earlier one wins, and the later one answers without it', () => {
  it('reads a running loop on a base behind its remote as row 1, and row 2 without the run', async () => {
    const both = await stateOf({ runs: [record()], standing: '0\t2\n' });
    const alone = await stateOf({ standing: '0\t2\n' });

    expect([both.id, alone.id]).toEqual(['loop-running', 'base-behind']);
  });

  it('reads a running loop on a plan branch with tasks left as row 1, and row 4 without the run', async () => {
    const planted = { branch: PLAN_BRANCH, plans: { [STUB]: { plan: OPEN_PLAN } } };
    const both = await stateOf({ ...planted, runs: [record()] });
    const alone = await stateOf(planted);

    expect([both.id, alone.id]).toEqual(['loop-running', 'tracker-open']);
  });

  it('reads a checklist holding a blocked task and an open one as row 3, and row 4 without the blocked one', async () => {
    const both = await stateOf(ROW['tracker-blocked']);
    const alone = await stateOf({ branch: PLAN_BRANCH, plans: { [STUB]: { plan: OPEN_PLAN, tracker: OPEN_PLAN } } });

    expect([both.id, alone.id]).toEqual(['tracker-blocked', 'tracker-open']);
  });

  it('reads tasks left beside an open pull request as row 4, and row 5 with the checklist finished', async () => {
    const pull: PlantedPull = { verdict: 'pending', mergeable: 'mergeable' };
    const both = await stateOf({ branch: PLAN_BRANCH, plans: { [STUB]: { plan: OPEN_PLAN } }, pull });
    const alone = await stateOf({
      branch: PLAN_BRANCH,
      plans: { [STUB]: { plan: OPEN_PLAN, tracker: DONE_TRACKER } },
      pull,
    });

    expect([both.id, alone.id]).toEqual(['tracker-open', 'pr-pending']);
  });

  it('reads a conflicting pull request whose checks are still running as row 5, and row 6 once they settle', async () => {
    const both = await stateOf({ branch: PLAN_BRANCH, pull: { verdict: 'pending', mergeable: 'conflicting' } });
    const alone = await stateOf({ branch: PLAN_BRANCH, pull: { verdict: 'none', mergeable: 'conflicting' } });

    expect([both.id, alone.id]).toEqual(['pr-pending', 'pr-red']);
  });

  it('reads a red pull request that merges as row 6, and row 7 once it is green', async () => {
    const both = await stateOf(ROW['pr-red']);
    const alone = await stateOf(ROW['pr-green']);

    expect([both.id, alone.id]).toEqual(['pr-red', 'pr-green']);
  });

  it('reads a green pull request beside an unstarted plan as row 7, and row 8 without the pull request', async () => {
    const plans = { [STUB]: { plan: OPEN_PLAN } };
    const both = await stateOf({ plans, pull: { verdict: 'green', mergeable: 'mergeable', branch: BASE } });
    const alone = await stateOf({ plans });

    expect([both.id, alone.id]).toEqual(['pr-green', 'plan-unstarted']);
  });

  it('reads an unstarted plan beside a ready roadmap line as row 8, and row 9 without the plan', async () => {
    const board = { roadmap: walked(), ready: true };
    const both = await stateOf({ ...board, plans: { [STUB]: { plan: OPEN_PLAN } } });
    const alone = await stateOf(board);

    expect([both.id, alone.id]).toEqual(['plan-unstarted', 'issue-ready']);
  });

  it('reads a line that is ready and blocked as row 10, and row 9 once it waits on nothing', async () => {
    const both = await stateOf(ROW['issue-blocked']);
    const alone = await stateOf(ROW['issue-ready']);

    expect([both.id, alone.id]).toEqual(['issue-blocked', 'issue-ready']);
  });

  it('reads a line that is blocked and unready as row 10, and row 11 once it waits on nothing', async () => {
    const both = await stateOf({ roadmap: walked(), ready: false, blocked: waiting() });
    const alone = await stateOf(ROW['issue-not-ready']);

    expect([both.id, alone.id]).toEqual(['issue-blocked', 'issue-not-ready']);
  });

  it('reads an unready line as row 11, and row 12 once the roadmap has no line left', async () => {
    const both = await stateOf(ROW['issue-not-ready']);
    const alone = await stateOf(ROW['nothing-left']);

    expect([both.id, alone.id]).toEqual(['issue-not-ready', 'nothing-left']);
  });

  it('reads a finished plan whose pull request was merged in the browser as row 12, naming the base', async () => {
    const state = await stateOf({
      branch: PLAN_BRANCH,
      plans: { [STUB]: { plan: OPEN_PLAN, tracker: DONE_TRACKER } },
      refs: [`refs/heads/${PLAN_BRANCH}`],
    });

    expect(state.id).toBe('nothing-left');
    expect(state.action).toBe('none');
    expect(state.reading).toBe(`\`${STUB}\` has no task left on \`${PLAN_BRANCH}\`, and it has no open pull request`);
    expect(state.proposal).toBe(`nothing to run from \`${PLAN_BRANCH}\`; the cycle goes on from \`${BASE}\``);
  });

  it('reads a branch that is no plan branch at all as row 12 too', async () => {
    const state = await stateOf({ branch: 'scratch' });

    expect(state.id).toBe('nothing-left');
    expect(state.reading).toBe('`scratch` is no plan branch, and it has no open pull request');
  });
});

/** The state a situation answers, read over a provider of the case's own. */
function stateOver(over: Partial<Situation>, pulls: PullRequests): ReturnType<typeof readNextState> {
  return readNextState({ ...sourcesFor(over), pulls });
}

/** What a provider that could not be reached says. */
const UNREACHABLE = 'gh: could not connect to api.github.com';

describe('the two pre-conditions, ahead of the table', () => {
  it('holds the two in the spec order, and tells one from a row of the table', () => {
    expect(NEXT_PRECONDITIONS).toEqual(['tree-modified', 'pulls-unusable']);
    expect(NEXT_PRECONDITIONS.every((id) => isPrecondition(id))).toBe(true);
    expect(NEXT_STATES.some((id) => isPrecondition(id))).toBe(false);
  });

  it('reads a modified tree ahead of the row that answers without it', async () => {
    const both = await stateOf({ ...ROW['issue-ready'], tree: [' M src/next/state.ts'] });
    const alone = await stateOf(ROW['issue-ready']);

    expect([both.id, alone.id]).toEqual(['tree-modified', 'issue-ready']);
  });

  it('names the changed files, proposes prose and carries nothing to run', async () => {
    const state = await stateOf({ tree: ['M  src/next/state.ts', ' M src/next/readings.ts'] });

    expect(state.action).toBe('none');
    expect(state.reading).toBe(
      'the working tree has changes to 2 tracked files: `src/next/state.ts`, `src/next/readings.ts`',
    );
    expect(state.proposal).toBe('commit or set aside your changes; rafa will not touch them');
  });

  it('names no tool in either line, so the choice is left to the person', async () => {
    const state = await stateOf({ tree: [' M src/next/state.ts'] });
    const both = `${state.reading}\n${state.proposal}`;

    expect(both).not.toContain('git');
    expect(both).not.toContain('stash');
    expect(both).not.toMatch(/`rafa \w/);
  });

  it('names one file as one, and counts the files past the fifth', async () => {
    const one = await stateOf({ tree: [' M a.ts'] });
    const many = await stateOf({ tree: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => ` M ${name}.ts`) });

    expect(one.reading).toBe('the working tree has changes to 1 tracked file: `a.ts`');
    expect(many.reading).toBe(
      'the working tree has changes to 7 tracked files: `a.ts`, `b.ts`, `c.ts`, `d.ts`, `e.ts` and 2 more',
    );
  });

  it('is no pre-condition at all when the tree holds untracked files alone', async () => {
    const untracked = await stateOf({ ...ROW['issue-ready'], tree: ['?? notes.md'] });
    const tracked = await stateOf({ ...ROW['issue-ready'], tree: [' M notes.md'] });

    expect([untracked.id, tracked.id]).toEqual(['issue-ready', 'tree-modified']);
  });

  it('reads an unusable provider ahead of the pull request rows, and the table without it', async () => {
    const throwing = createPullRequestsDouble({ findOpen: () => Promise.reject(new Error(UNREACHABLE)) });
    const both = await stateOver({ branch: PLAN_BRANCH }, throwing.pulls);
    const alone = await stateOf({ branch: PLAN_BRANCH });

    expect([both.id, alone.id]).toEqual(['pulls-unusable', 'nothing-left']);
    expect(throwing.sent()).toEqual([`findOpen ${PLAN_BRANCH}`]);
  });

  it('names the provider, what it said and `rafa doctor`, with nothing to run', async () => {
    const throwing = createPullRequestsDouble({ findOpen: () => Promise.reject(new Error(UNREACHABLE)) });
    const state = await stateOver({ branch: PLAN_BRANCH }, throwing.pulls);

    expect(state.action).toBe('none');
    expect(state.reading).toBe(`the \`gh\` pull request provider could not be asked: ${UNREACHABLE}`);
    expect(state.proposal).toBe('run `rafa doctor` to see what the provider needs, then read the state again');
  });

  it('writes one line of reading when the provider threw several', async () => {
    const throwing = createPullRequestsDouble({
      findOpen: () => Promise.reject(new Error('gh: HTTP 401\n  run gh auth login\n')),
    });
    const state = await stateOver({ branch: PLAN_BRANCH }, throwing.pulls);

    expect(state.reading).not.toContain('\n');
    expect(state.reading).toContain('gh: HTTP 401 run gh auth login');
  });

  it('takes a throw from the checks read too, not the search alone', async () => {
    const pull: PlantedPull = { verdict: 'green', mergeable: 'mergeable' };
    const throwing = createPullRequestsDouble({
      findOpen: () => Promise.resolve(summary(pull)),
      get: () => Promise.resolve(detail(pull)),
      checks: () => Promise.reject(new Error(UNREACHABLE)),
    });
    const state = await stateOver({ branch: PLAN_BRANCH }, throwing.pulls);

    expect(state.id).toBe('pulls-unusable');
    expect(state.reading).toContain(UNREACHABLE);
  });

  it('settles a running loop without ever asking the provider it could not use', async () => {
    const throwing = createPullRequestsDouble({ findOpen: () => Promise.reject(new Error(UNREACHABLE)) });
    const state = await stateOver({ runs: [record()] }, throwing.pulls);

    expect(state.id).toBe('loop-running');
    expect(throwing.sent()).toEqual([]);
  });

  it('reports the modified tree ahead of the unusable provider', async () => {
    const throwing = createPullRequestsDouble({ findOpen: () => Promise.reject(new Error(UNREACHABLE)) });
    const state = await stateOver({ branch: PLAN_BRANCH, tree: [' M src/next/state.ts'] }, throwing.pulls);

    expect(state.id).toBe('tree-modified');
    expect(throwing.sent()).toEqual([]);
  });

  it('carries the problems of the readings it made beside a pre-condition', async () => {
    const state = await stateOf({
      tree: [' M src/next/state.ts'],
      roadmap: { roadmap: 31, line: null, passed: 0, problems: ['the branches on origin could not be read'] },
    });

    expect([state.id, state.problems.length]).toEqual(['tree-modified', 0]);
  });
});

describe('what an answer costs, and what it carries beside itself', () => {
  it('answers a running loop without asking the provider or the board', async () => {
    const double = createPullRequestsDouble({});
    let asked: readonly string[] = [];
    const board: NextBoard = {
      next: () => {
        asked = [...asked, 'next'];
        return Promise.reject(new Error('the board was asked for a running loop'));
      },
      blocking: () => Promise.reject(new Error('the board was asked for a running loop')),
      isReady: () => Promise.reject(new Error('the board was asked for a running loop')),
    };
    const sources = { ...sourcesFor({ runs: [record()] }), pulls: double.pulls, board };

    const state = await readNextState(sources);

    expect(state.id).toBe('loop-running');
    expect(double.sent()).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('carries the problems of the readings it made beside the state', async () => {
    const state = await stateOf({
      roadmap: { roadmap: 31, line: null, passed: 0, problems: ['the branches on origin could not be read'] },
    });

    expect(state.id).toBe('nothing-left');
    expect(state.problems).toEqual(['the branches on origin could not be read']);
  });

  it('carries no problem when every reading answered', async () => {
    const state = await stateOf(ROW['issue-ready']);

    expect(state.problems).toEqual([]);
  });

  it('carries no subject for a state that is about none', async () => {
    const state = await stateOf(ROW['base-behind']);

    expect([state.pullRequest, state.issue, state.planStub, state.planPath]).toEqual([null, null, null, null]);
  });
});
