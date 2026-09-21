/**
 * Tests for the readings the state table is answered over
 * (`./readings.ts`): what each one answers, which of them a failed read
 * is carried out of rather than thrown from, and that
 * {@link openWorld} makes each at most once and asks the board from the
 * base branch alone.
 *
 * `./state.test.ts` drives the TABLE over these readings and none of
 * them again. What only this file can see is what a row never gets to
 * look at: a fetch that failed still answering counts, a provider that
 * is not asked at all on a branch git could not read, and a board that
 * is not asked at all off the base.
 *
 * Every case drives fakes: a `GitRunner` answering by the argv it was
 * handed, the pull request double (`src/pr/pull-requests-double.ts`),
 * a board of plain functions, and a plans directory planted under a
 * temporary root. Nothing here spawns `git`, spawns `gh`, or reaches
 * GitHub.
 *
 * ## The controls
 *
 * - Each carried problem is paired with the same reading that SUCCEEDS,
 *   so "it noted a problem" is held against a reading that could have
 *   noted none: the failed fetch beside the clean one, the unreadable
 *   plans directory beside the planted one, the detached HEAD beside
 *   the named branch.
 * - The memoisation case asks for the same reading three times and
 *   counts the calls the sources took, so a reading made afresh each
 *   time fails it; the branch, the plans and the runs are all counted,
 *   not one of them.
 * - The "board is not asked off the base" case is paired with the same
 *   world on the base, which asks it three times. A world that never
 *   asked the board would pass the first half alone.
 *
 * ## What passes while wrong
 *
 * Two mutations of `readings.ts` were driven on 2026-09-21, one at a
 * time, over `env -u CLAUDECODE bun test src/next/`, the module
 * restored from a scratch copy and verified with `shasum -c` each time,
 * against 91 pass and 0 fail either side:
 *
 *  - the fetch dropped from {@link readStanding}, so the standing is
 *    read off whatever the clone already held: 89 pass and 2 fail, both
 *    standing cases that name the argv. The counts are the same either
 *    way in a fake, which is why one of the two asserts the ORDER of
 *    the commands and not just the answer.
 *  - {@link hasBranch} matching a ref by substring rather than by name,
 *    so `feat/<stub>-two` claims `<stub>`: 90 pass and 1 fail, the case
 *    that plants the longer name. Every other ref planted is the exact
 *    branch, and none of them notices.
 */
import type { NextBoard, NextRoadmapReading, NextSources } from './readings.js';
import type { RoadmapLine } from '../board/roadmap.js';
import type { SessionRecord } from '../loop/sessions.js';
import type { GitResult, GitRunner, PullRequestDetail, PullRequestSummary } from '../pr/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { plansDirAt } from '../commands/plan/plan-files.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';

import {
  branchLabel,
  hasBranch,
  hasRun,
  once,
  onBase,
  openWorld,
  readBranch,
  readBranchPlan,
  readOpenPull,
  readPlans,
  readRefs,
  readStanding,
} from './readings.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-readings-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The base branch every case runs against. */
const BASE = 'main';

/** The plan branch the plan cases stand on. */
const PLAN_BRANCH = 'feat/rafa-63-one-command-next-step';

/** The stub that branch carries. */
const STUB = 'rafa-63-one-command-next-step';

/** A plan with one task open. */
const PLAN = ['# Plan: one', '', '# Stage: one', '', '- [ ] first', ''].join('\n');

/** What git answered when it worked. */
function said(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** What git answered when it refused. */
function refused(stderr: string): GitResult {
  return { ok: false, stdout: '', stderr };
}

/** A git runner answering the argv a case names, and recording every call. */
interface GitFake {
  readonly git: GitRunner;
  /** Each call, one line each: `fetch origin main`. */
  readonly ran: () => readonly string[];
}

/** A runner over `answers`, every argv it does not name answering empty. */
function gitOf(answers: Readonly<Record<string, GitResult>> = {}): GitFake {
  let ran: readonly string[] = [];
  return {
    git: (args) => {
      const line = args.join(' ');
      ran = [...ran, line];
      return answers[line] ?? said('');
    },
    ran: () => ran,
  };
}

/** A note that keeps what it was handed, in order. */
function notes(): { readonly note: (problem: string) => void; readonly held: () => readonly string[] } {
  let held: readonly string[] = [];
  return {
    note: (problem: string) => {
      held = [...held, problem];
    },
    held: () => held,
  };
}

/** A plans directory planted under a name of this case's own, with the plans it names. */
function plantPlans(name: string, plans: Readonly<Record<string, string>> = {}): string {
  const dir = join(tempBase, name, '.rafa', 'plans');
  mkdirSync(dir, { recursive: true });
  Object.entries(plans).forEach(([stub, text]) => {
    writeFileSync(join(dir, `PLAN-${stub}.md`), text, 'utf8');
  });
  return join(tempBase, name);
}

/** A summary as `findOpen` answers one. */
function summary(over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: 41,
    title: 'rafa-63: one command, the next step',
    url: 'https://github.com/open-tomato/rafa/pull/41',
    state: 'open',
    headRefName: PLAN_BRANCH,
    baseRefName: BASE,
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-21T11:00:00Z',
    ...over,
  };
}

/** A detail as `get` answers one. */
function detail(over: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    ...summary(),
    body: 'Closes #63',
    headRefOid: 'abc1234',
    mergeable: 'mergeable',
    mergeStateStatus: 'CLEAN',
    labels: [],
    ...over,
  };
}

/** One roadmap line, as a walk answers one. */
function line(issue: number): RoadmapLine {
  return { issue, ticked: false, why: 'the next one', lineNumber: 4 };
}

/** A walk answering `line`, with nothing to report. */
function walked(over: Partial<NextRoadmapReading> = {}): NextRoadmapReading {
  return { roadmap: 31, line: line(64), passed: 3, problems: [], ...over };
}

/** A board answering one walk, and the calls it was handed. */
interface BoardFake {
  readonly board: NextBoard;
  /** Each call, one line each: `isReady 64`. */
  readonly asked: () => readonly string[];
}

/** A board over one walk, the line ready and unblocked unless a case says otherwise. */
function boardOf(reading: NextRoadmapReading = walked(), ready = true): BoardFake {
  let asked: readonly string[] = [];
  const record = (call: string): void => {
    asked = [...asked, call];
  };
  return {
    board: {
      next: () => {
        record('next');
        return Promise.resolve(reading);
      },
      blocking: (issue: number) => {
        record(`blocking ${issue}`);
        return Promise.resolve(null);
      },
      isReady: (issue: number) => {
        record(`isReady ${issue}`);
        return Promise.resolve(ready);
      },
    },
    asked: () => asked,
  };
}

/** How many scratch roots {@link scratchName} has handed out. */
let scratches = 0;

/** One session record, filled from `over`. */
function record(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: '20260921-110000-abcd',
    planStub: STUB,
    plan: `.rafa/plans/PLAN-${STUB}.md`,
    branch: PLAN_BRANCH,
    pid: 4242,
    startedAt: '2026-09-21T11:00:00Z',
    state: 'stopped',
    task: null,
    ...over,
  };
}

/** A plants directory name no other case shares. */
function scratchName(): string {
  scratches += 1;
  return `sources-${scratches}`;
}

/** The sources a world is opened over, each part a case may replace. */
function sourcesOf(over: Partial<NextSources> = {}): NextSources {
  return {
    base: BASE,
    plans: plansDirAt(plantPlans(scratchName()), '.rafa/plans'),
    runs: () => [],
    git: gitOf().git,
    pulls: createPullRequestsDouble({}).pulls,
    board: boardOf().board,
    ...over,
  };
}

describe('a reading made at most once', () => {
  it('calls the reader once, however often it is asked', () => {
    let calls = 0;
    const read = once(() => {
      calls += 1;
      return calls;
    });

    expect([read(), read(), read()]).toEqual([1, 1, 1]);
    expect(calls).toBe(1);
  });

  it('holds an answer of null rather than reading again', () => {
    let calls = 0;
    const read = once((): string | null => {
      calls += 1;
      return null;
    });

    expect([read(), read()]).toEqual([null, null]);
    expect(calls).toBe(1);
  });
});

describe('the branch at the project root', () => {
  it('answers what git wrote, trimmed, and notes nothing', () => {
    const kept = notes();
    const git = gitOf({ 'rev-parse --abbrev-ref HEAD': said(`${PLAN_BRANCH}\n`) });

    expect(readBranch(sourcesOf({ git: git.git }), kept.note)).toBe(PLAN_BRANCH);
    expect(kept.held()).toEqual([]);
  });

  it('answers no branch on a detached HEAD, and says so', () => {
    const kept = notes();
    const git = gitOf({ 'rev-parse --abbrev-ref HEAD': said('HEAD\n') });

    expect(readBranch(sourcesOf({ git: git.git }), kept.note)).toBe('');
    expect(kept.held()).toEqual([
      'the project root is on a detached HEAD, so no branch names a plan or a pull request',
    ]);
  });

  it('answers no branch when git refused, and quotes what git said', () => {
    const kept = notes();
    const git = gitOf({ 'rev-parse --abbrev-ref HEAD': refused('fatal: not a git repository') });

    expect(readBranch(sourcesOf({ git: git.git }), kept.note)).toBe('');
    expect(kept.held()).toHaveLength(1);
    expect(kept.held()[0]).toContain('fatal: not a git repository');
  });
});

describe('how the base stands against its remote', () => {
  it('fetches the base before it counts, and answers the counts', () => {
    const kept = notes();
    const git = gitOf({ 'rev-list --left-right --count main...origin/main': said('0\t2\n') });

    expect(readStanding(sourcesOf({ git: git.git }), 'origin', kept.note)).toEqual({ ahead: 0, behind: 2 });
    expect(git.ran()).toEqual([
      'fetch origin main',
      'rev-list --left-right --count main...origin/main',
    ]);
    expect(kept.held()).toEqual([]);
  });

  it('counts anyway when the fetch failed, and says the reading is off this clone', () => {
    const kept = notes();
    const git = gitOf({
      'fetch origin main': refused('fatal: could not read from remote repository'),
      'rev-list --left-right --count main...origin/main': said('1\t1\n'),
    });

    expect(readStanding(sourcesOf({ git: git.git }), 'origin', kept.note)).toEqual({ ahead: 1, behind: 1 });
    expect(kept.held()).toHaveLength(1);
    expect(kept.held()[0]).toContain('could not be fetched');
  });

  it('answers no standing when the count failed', () => {
    const kept = notes();
    const git = gitOf({
      'rev-list --left-right --count main...origin/main': refused('fatal: bad revision'),
    });

    expect(readStanding(sourcesOf({ git: git.git }), 'origin', kept.note)).toBeNull();
    expect(kept.held()).toHaveLength(1);
    expect(kept.held()[0]).toContain('fatal: bad revision');
  });

  it('answers no standing when git wrote no pair of counts', () => {
    const kept = notes();
    const git = gitOf({ 'rev-list --left-right --count main...origin/main': said('nothing here\n') });

    expect(readStanding(sourcesOf({ git: git.git }), 'origin', kept.note)).toBeNull();
    expect(kept.held()[0]).toContain('which is no pair of counts');
  });
});

describe('the branch refs of this clone and its remote', () => {
  it('answers both halves and notes nothing when both were read', () => {
    const kept = notes();
    const git = gitOf({
      'for-each-ref --format=%(refname) refs/heads refs/remotes': said('refs/heads/main\n'),
      'ls-remote --heads origin': said('abc\trefs/heads/feat/one\n'),
    });

    expect(readRefs(sourcesOf({ git: git.git }), 'origin', kept.note))
      .toEqual(['refs/heads/main', 'refs/heads/feat/one']);
    expect(kept.held()).toEqual([]);
  });

  it('carries out the half that failed and keeps the other', () => {
    const kept = notes();
    const git = gitOf({
      'for-each-ref --format=%(refname) refs/heads refs/remotes': said('refs/heads/main\n'),
      'ls-remote --heads origin': refused('fatal: could not read from remote repository'),
    });

    expect(readRefs(sourcesOf({ git: git.git }), 'origin', kept.note)).toEqual(['refs/heads/main']);
    expect(kept.held()).toHaveLength(1);
    expect(kept.held()[0]).toContain('could not be read');
  });
});

describe('the plans directory', () => {
  it('lists the plans planted there, and notes nothing', () => {
    const kept = notes();
    const root = plantPlans('listed', { [STUB]: PLAN });

    const listed = readPlans(sourcesOf({ plans: plansDirAt(root, '.rafa/plans') }), kept.note);

    expect(listed.map((plan) => plan.stub)).toEqual([STUB]);
    expect(kept.held()).toEqual([]);
  });

  it('answers no plan for a directory that is not there, and notes nothing', () => {
    const kept = notes();
    const root = plantPlans('absent');

    expect(readPlans(sourcesOf({ plans: plansDirAt(root, 'docs/plans') }), kept.note)).toEqual([]);
    expect(kept.held()).toEqual([]);
  });

  it('answers no plan and says so when the directory cannot be read', () => {
    const kept = notes();
    const root = plantPlans('unreadable');
    writeFileSync(join(root, 'plans-file'), 'not a directory', 'utf8');

    expect(readPlans(sourcesOf({ plans: plansDirAt(root, 'plans-file') }), kept.note)).toEqual([]);
    expect(kept.held()).toHaveLength(1);
    expect(kept.held()[0]).toContain('could not be read');
  });
});

describe('the open pull request of a branch', () => {
  it('asks the provider nothing when there is no branch to ask about', async () => {
    const kept = notes();
    const double = createPullRequestsDouble({});

    expect(await readOpenPull(sourcesOf({ pulls: double.pulls }), '', kept.note)).toBeNull();
    expect(double.sent()).toEqual([]);
  });

  it('answers no pull request when the branch has none, and asks for no checks', async () => {
    const kept = notes();
    const double = createPullRequestsDouble({ findOpen: () => Promise.resolve(null) });

    expect(await readOpenPull(sourcesOf({ pulls: double.pulls }), PLAN_BRANCH, kept.note)).toBeNull();
    expect(double.sent()).toEqual([`findOpen ${PLAN_BRANCH}`]);
    expect(kept.held()).toEqual([]);
  });

  it('answers the summary, the mergeability and the verdict', async () => {
    const kept = notes();
    const double = createPullRequestsDouble({
      findOpen: () => Promise.resolve(summary()),
      get: () => Promise.resolve(detail({ mergeable: 'conflicting' })),
      checks: () => Promise.resolve({ rows: [], verdict: 'none' }),
    });

    const open = await readOpenPull(sourcesOf({ pulls: double.pulls }), PLAN_BRANCH, kept.note);

    expect(open?.summary.number).toBe(41);
    expect(open?.mergeable).toBe('conflicting');
    expect(open?.verdict).toBe('none');
    expect(double.sent()).toEqual([`findOpen ${PLAN_BRANCH}`, 'get 41', 'checks 41']);
    expect(kept.held()).toEqual([]);
  });

  it('reads a detail nobody answered as an unsettled merge, and says so', async () => {
    const kept = notes();
    const double = createPullRequestsDouble({
      findOpen: () => Promise.resolve(summary()),
      get: () => Promise.resolve(null),
      checks: () => Promise.resolve({ rows: [], verdict: 'green' }),
    });

    const open = await readOpenPull(sourcesOf({ pulls: double.pulls }), PLAN_BRANCH, kept.note);

    expect(open?.mergeable).toBe('unknown');
    expect(kept.held()).toHaveLength(1);
    expect(kept.held()[0]).toContain('answered no pull request #41');
  });
});

describe('the plan a branch is named after', () => {
  const plans = [
    { stub: STUB, plan: '/p/PLAN-a.md', tracker: null, tasks: { total: 1, done: 0, blocked: 0, open: 1 }, issues: 0 },
  ];

  it('answers the plan whose stub the branch carries', () => {
    expect(readBranchPlan(PLAN_BRANCH, plans)?.stub).toBe(STUB);
  });

  it('answers none for a branch that is no plan branch', () => {
    expect(readBranchPlan(BASE, plans)).toBeNull();
  });

  it('answers none when no plan carries the stub', () => {
    expect(readBranchPlan('feat/nothing-planned', plans)).toBeNull();
  });
});

describe('a plan with a run, and a plan with a branch', () => {
  it('reads a record naming the stub as a run of that plan', () => {
    expect(hasRun([record()], STUB)).toBe(true);
  });

  it('reads a record naming only the plan file as a run of that plan', () => {
    expect(hasRun([record({ planStub: null })], STUB)).toBe(true);
  });

  it('does not read a path that merely ends with the file name as that plan', () => {
    expect(hasRun([record({ planStub: null, plan: `.rafa/plans/OLD_PLAN-${STUB}.md` })], STUB)).toBe(false);
  });

  it('reads the branch here and the branch on the remote', () => {
    expect(hasBranch([`refs/heads/${PLAN_BRANCH}`], STUB)).toBe(true);
    expect(hasBranch([`refs/remotes/origin/${PLAN_BRANCH}`], STUB)).toBe(true);
  });

  it('does not read a longer branch name as that plan', () => {
    expect(hasBranch([`refs/heads/${PLAN_BRANCH}-two`], STUB)).toBe(false);
  });
});

describe('the world one answer is read over', () => {
  it('reads each source at most once, however many rows ask', () => {
    let runs = 0;
    const git = gitOf({ 'rev-parse --abbrev-ref HEAD': said(`${BASE}\n`) });
    const root = plantPlans('memoised', { [STUB]: PLAN });
    const world = openWorld(sourcesOf({
      git: git.git,
      plans: plansDirAt(root, '.rafa/plans'),
      runs: () => {
        runs += 1;
        return [];
      },
    }));

    [world.branch(), world.branch(), world.branch()].forEach((branch) => expect(branch).toBe(BASE));
    expect([world.liveRun(), world.unstartedPlan()?.stub]).toEqual([null, STUB]);
    expect(world.unstartedPlan()?.stub).toBe(STUB);

    expect(runs).toBe(1);
    expect(git.ran().filter((call) => call.startsWith('rev-parse'))).toHaveLength(1);
    expect(git.ran().filter((call) => call.startsWith('for-each-ref'))).toHaveLength(1);
  });

  it('asks the board nothing off the base branch', async () => {
    const asked = boardOf();
    const git = gitOf({ 'rev-parse --abbrev-ref HEAD': said(`${PLAN_BRANCH}\n`) });
    const world = openWorld(sourcesOf({ git: git.git, board: asked.board }));

    expect(await world.picked()).toBeNull();
    expect(asked.asked()).toEqual([]);
  });

  it('asks the board for the line, its readiness and its blockers on the base', async () => {
    const asked = boardOf();
    const git = gitOf({ 'rev-parse --abbrev-ref HEAD': said(`${BASE}\n`) });
    const world = openWorld(sourcesOf({ git: git.git, board: asked.board }));

    const picked = await world.picked();
    await world.picked();

    expect(picked?.line.issue).toBe(64);
    expect(picked?.ready).toBe(true);
    expect(picked?.blocked).toBeNull();
    expect(asked.asked()).toEqual(['next', 'isReady 64', 'blocking 64']);
  });

  it('carries out the problems the roadmap walk reported', async () => {
    const asked = boardOf(walked({ problems: ['the branches on origin could not be read'] }));
    const git = gitOf({ 'rev-parse --abbrev-ref HEAD': said(`${BASE}\n`) });
    const world = openWorld(sourcesOf({ git: git.git, board: asked.board }));

    await world.picked();

    expect(world.problems()).toEqual(['the branches on origin could not be read']);
  });

  it('answers the base branch and the branch a sentence names', () => {
    const onBaseWorld = openWorld(sourcesOf({
      git: gitOf({ 'rev-parse --abbrev-ref HEAD': said(`${BASE}\n`) }).git,
    }));
    const elsewhere = openWorld(sourcesOf({
      git: gitOf({ 'rev-parse --abbrev-ref HEAD': said(`${PLAN_BRANCH}\n`) }).git,
    }));
    const nowhere = openWorld(sourcesOf({
      git: gitOf({ 'rev-parse --abbrev-ref HEAD': said('HEAD\n') }).git,
    }));

    expect([onBase(onBaseWorld), onBase(elsewhere), onBase(nowhere)]).toEqual([true, false, false]);
    expect(branchLabel(elsewhere)).toBe(`\`${PLAN_BRANCH}\``);
    expect(branchLabel(nowhere)).toBe('this checkout');
  });
});
