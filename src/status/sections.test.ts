/**
 * Tests for the five `rafa status` readings (`sections.ts`).
 *
 * Every case but the housekeeping ones runs over scripted seams: a git
 * that answers `rev-parse --abbrev-ref HEAD` and refuses the rest, a
 * `gh` opener that records each command and the time it was given, the
 * pull request double (`../pr/pull-requests-double.ts`), a scripted
 * board and blocked-issue listing, a scripted `origin` and pid probe,
 * and a cleanup whose git refuses. The session records and trackers are
 * the loop's own fixtures (`../tests/loop-session-fixtures.ts`), planted
 * in a project of each case's own, so no case spawns git or `gh` or
 * reaches the network.
 *
 * The housekeeping cases run over the real repository
 * `../cleanup/scratch-repository.ts` builds, with only the disk's
 * modification times scripted, and compare their counts with
 * `readDoctorCleanup`'s over the same repository: the reader
 * `rafa doctor` prints its row from.
 *
 * Every reading that a section was NOT read sits beside one where it
 * was, so a section that always answered `read: false` would fail.
 */
import type { StatusConfig, StatusSeams, StatusSections } from './sections.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { BlockedLine } from '../board/blocked-line.js';
import type { CleanupSeams } from '../cleanup/index.js';
import type { ScratchRepository } from '../cleanup/scratch-repository.js';
import type { BlockedIssuesReport } from '../commands/doctor-blocked.js';
import type { SessionRecord } from '../loop/sessions.js';
import type { NextBoard, NextRoadmapReading } from '../next/readings.js';
import type { GitResult, GitRunner } from '../pr/git.js';
import type { PullRequestDetail, PullRequests, PullRequestSummary } from '../pr/types.js';
import type { PlantedProject } from '../tests/cli-capture.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { readBlockedBy } from '../board/blocked.js';
import { defaultCleanupSeams } from '../cleanup/index.js';
import { createScratchRepository, SCRATCH_NOW } from '../cleanup/scratch-repository.js';
import { readDoctorCleanup } from '../commands/doctor-cleanup.js';
import { runsDir } from '../loop/sessions.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import {
  BRANCH,
  DEMO_TRACKER_PATH,
  plantDemoProject,
  plantSession,
  sessionRecord,
} from '../tests/loop-session-fixtures.js';

import { readStatusSections, STATUS_NETWORK_TIMEOUT_MS } from './sections.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-status-sections-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The settings every case reads with; the demo plan sits under `.plans/`. */
const CONFIG: StatusConfig = {
  planDir: '.plans',
  prBase: 'main',
  prProvider: null,
  roadmapIssue: 31,
  cleanupKeep: [],
  cleanupStaleDays: 30,
  cleanupWorktreeIdleDays: 7,
};

/** A GitHub `origin`, which resolves `pr.provider` to `gh` when the config names none. */
const GITHUB_ORIGIN = 'https://github.com/open-tomato/rafa.git';

/** The deadline the cases run under, short so a case that waits on it stays quick. */
const CASE_TIMEOUT_MS = 100;

/** How far past the deadline a case allows the sections to answer. */
const MARGIN_MS = 400;

/** What git refuses with in a directory that is no repository. */
const REFUSED: GitResult = { ok: false, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git' };

/** One entry of a case's log, in the order the seams were reached. */
type Reached = string;

/** A git answering `rev-parse --abbrev-ref HEAD` with `branch` and refusing everything else, logging each argv. */
function scriptedGit(branch: GitResult, log: Reached[]): GitRunner {
  return (args) => {
    log.push(`git ${args.join(' ')}`);
    return args.join(' ') === 'rev-parse --abbrev-ref HEAD'
      ? branch
      : REFUSED;
  };
}

/** Cleanup seams whose git refuses, so the housekeeping section reads nothing; the provider handed in is kept. */
function refusingCleanup(made: { pulls: PullRequests | null }[]): (cwd: string, pulls: PullRequests | null) => CleanupSeams {
  return (_cwd, pulls) => {
    made.push({ pulls });
    const git: GitRunner = () => REFUSED;
    return { git, gitAt: () => git, sessions: () => [], modifiedAt: () => null, realPath: (path) => path, pulls };
  };
}

/** A board answering the walk `next` gives, with the line's issue ready or not and blocked or not. */
function scriptedBoard(next: () => Promise<NextRoadmapReading>, ready: boolean, blocked: BlockedLine | null, log: Reached[]): NextBoard {
  return {
    next: () => {
      log.push('board next');
      return next();
    },
    isReady: (issue) => {
      log.push(`board isReady ${String(issue)}`);
      return Promise.resolve(ready);
    },
    blocking: (issue) => {
      log.push(`board blocking ${String(issue)}`);
      return Promise.resolve(blocked);
    },
  };
}

/** A roadmap walk that found no line left. */
const NO_LINE: NextRoadmapReading = { roadmap: 31, line: null, passed: 4, problems: [] };

/** A blocked-issue report with no issue. */
const NO_BLOCKED: BlockedIssuesReport = { readings: [], faults: [], problem: null, unchecked: null };

/** What a case changes about the world every other case shares. */
interface WorldOptions {
  readonly branch?: GitResult;
  readonly remote?: string | null;
  readonly pulls?: PullRequests;
  readonly board?: NextBoard;
  readonly blockedIssues?: (gh: GhRunner) => Promise<BlockedIssuesReport>;
  readonly gh?: (args: readonly string[]) => Promise<GhResult>;
  readonly isAlive?: (pid: number) => boolean;
}

/** The seams of one case, and what each was handed. */
interface World {
  readonly seams: StatusSeams;
  /** Every seam reached, in order. */
  readonly log: readonly Reached[];
  /** Every `gh` command opened, with the time left it was given. */
  readonly opened: readonly { readonly args: string; readonly timeoutMs: number }[];
  /** The provider each cleanup seam was made with. */
  readonly cleanups: readonly { readonly pulls: PullRequests | null }[];
}

/** The seams of a case: the shared world with `options` laid over it. */
function world(options: WorldOptions = {}): World {
  const log: Reached[] = [];
  const opened: { args: string; timeoutMs: number }[] = [];
  const cleanups: { pulls: PullRequests | null }[] = [];
  const answer = options.gh ?? ((): Promise<GhResult> => Promise.resolve({ ok: true, stdout: '[]', stderr: '' }));
  const seams: StatusSeams = {
    openGit: () => scriptedGit(options.branch ?? { ok: true, stdout: `${BRANCH}\n`, stderr: '' }, log),
    openGh: (_root, timeoutMs) => (args) => {
      log.push(`gh ${args.join(' ')}`);
      opened.push({ args: args.join(' '), timeoutMs });
      return answer(args);
    },
    pullRequests: () => options.pulls ?? createPullRequestsDouble({ findOpen: () => Promise.resolve(null) }).pulls,
    board: () => options.board ?? scriptedBoard(() => Promise.resolve(NO_LINE), true, null, log),
    blockedIssues: options.blockedIssues ?? ((): Promise<BlockedIssuesReport> => Promise.resolve(NO_BLOCKED)),
    readRemote: () => {
      log.push('origin');
      return options.remote === undefined
        ? GITHUB_ORIGIN
        : options.remote;
    },
    isAlive: (pid) => {
      log.push(`isAlive ${String(pid)}`);
      return (options.isAlive ?? ((): boolean => false))(pid);
    },
    cleanupSeams: refusingCleanup(cleanups),
    now: () => SCRATCH_NOW,
    timeoutMs: CASE_TIMEOUT_MS,
  };
  return { seams, log, opened, cleanups };
}

/** A project holding the demo plan, its tracker and each record handed in. */
function projectWith(...records: readonly SessionRecord[]): PlantedProject {
  const project = plantDemoProject(tempBase);
  for (const record of records) plantSession(project.root, record);
  return project;
}

/** The sections of `project` over `seams`. */
function sections(project: PlantedProject, seams: StatusSeams, config: StatusConfig = CONFIG): Promise<StatusSections> {
  return readStatusSections({ root: project.root, home: project.home, config }, seams);
}

/** A pull request summary on the demo branch. */
function summary(number: number): PullRequestSummary {
  return {
    number,
    title: 'feat: demo',
    url: `https://github.com/open-tomato/rafa/pull/${String(number)}`,
    state: 'open',
    headRefName: BRANCH,
    baseRefName: 'main',
    author: { login: 'someone', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-24T10:00:00Z',
  };
}

/** Its detail, reading `mergeable`. */
function detail(number: number, mergeable: PullRequestDetail['mergeable']): PullRequestDetail {
  return { ...summary(number), body: '', headRefOid: 'abc123', mergeable, mergeStateStatus: 'DIRTY', labels: [] };
}

/** A promise that never settles, as a provider waiting on a network that never answers gives. */
function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

describe('STATUS_NETWORK_TIMEOUT_MS', () => {
  it('is the five seconds the plan names', () => {
    expect(STATUS_NETWORK_TIMEOUT_MS).toBe(5_000);
  });
});

describe('the branch and plan section', () => {
  it('reads the branch and the plan it is named after, counted from the tracker', async () => {
    const { seams } = world();

    const read = await sections(projectWith(), seams);

    expect(read.branch.read).toBe(true);
    if (!read.branch.read) return;
    expect(read.branch.branch).toBe(BRANCH);
    expect(read.branch.plan?.stub).toBe('demo');
    expect(read.branch.plan?.tasks).toEqual({ total: 4, done: 1, blocked: 1, open: 2 });
    expect(read.branch.notes).toEqual([]);
  });

  it('answers no plan on a branch that names none, where the demo branch names one', async () => {
    const { seams } = world({ branch: { ok: true, stdout: 'main\n', stderr: '' } });

    const read = await sections(projectWith(), seams);

    expect(read.branch).toEqual({ read: true, branch: 'main', plan: null, notes: [] });
  });

  it('is not read when git refuses the branch, naming git\'s words, and the pull request is not looked for', async () => {
    const { seams, opened } = world({ branch: REFUSED });

    const read = await sections(projectWith(), seams);

    expect(read.branch.read).toBe(false);
    if (read.branch.read) return;
    expect(read.branch.problem).toContain('not a git repository');
    expect(read.pull.read).toBe(false);
    if (read.pull.read) return;
    expect(read.pull.problem).toContain('no pull request was looked for, as the branch was not read');
    expect(opened.map((open) => open.args).filter((args) => args.startsWith('pr '))).toEqual([]);
  });

  it('is not read on a detached HEAD, saying so', async () => {
    const { seams } = world({ branch: { ok: true, stdout: 'HEAD\n', stderr: '' } });

    const read = await sections(projectWith(), seams);

    expect(read.branch.read).toBe(false);
    if (read.branch.read) return;
    expect(read.branch.problem).toContain('detached HEAD');
  });
});

describe('the loops section', () => {
  it('names the running sessions, a record whose pid is gone reading stopped', async () => {
    const alive = sessionRecord({ sessionId: 'session-0500', pid: 7171 });
    const gone = sessionRecord({ sessionId: 'session-0600', planStub: 'other', plan: '.plans/PLAN-other.md', pid: 8181, startedAt: '2026-09-15T13:00:00.000Z' });
    const { seams } = world({ isAlive: (pid) => pid === 7171 });

    const read = await sections(projectWith(alive, gone), seams);

    expect(read.loops.read).toBe(true);
    if (!read.loops.read) return;
    expect(read.loops.live.map((record) => [record.sessionId, record.state])).toEqual([['session-0500', 'running']]);
  });

  it('names a blocked checklist once, with the newest session of its plan and each blocked task', async () => {
    const older = sessionRecord({ sessionId: 'session-0400', startedAt: '2026-09-15T11:00:00.000Z', state: 'stopped', task: null });
    const newer = sessionRecord({ sessionId: 'session-0450', startedAt: '2026-09-15T11:30:00.000Z', state: 'stopped', task: null });
    const project = projectWith(older, newer);
    const { seams } = world();

    const read = await sections(project, seams);

    expect(read.loops.read).toBe(true);
    if (!read.loops.read) return;
    expect(read.loops.live).toEqual([]);
    expect(read.loops.blocked).toHaveLength(1);
    const [blocked] = read.loops.blocked;
    expect(blocked?.session.sessionId).toBe('session-0450');
    expect(blocked?.checklist).toBe(join(project.root, DEMO_TRACKER_PATH));
    expect(blocked?.tasks.map((task) => [task.line, task.text])).toEqual([[6, 'Second task']]);
  });

  it('names no blocked checklist when the tracker holds none, where the demo tracker holds one', async () => {
    const project = projectWith(sessionRecord({ state: 'stopped', task: null }));
    writeFileSync(join(project.root, DEMO_TRACKER_PATH), '- [x] First task\n- [ ] Second task\n');
    const { seams } = world();

    const read = await sections(project, seams);

    expect(read.loops).toEqual({ read: true, live: [], blocked: [] });
  });

  it('is not read when a record cannot be, and the branch section is read all the same', async () => {
    const project = projectWith();
    mkdirSync(runsDir(project.root), { recursive: true });
    writeFileSync(join(runsDir(project.root), 'broken.json'), '{ not json');
    const { seams } = world();

    const read = await sections(project, seams);

    expect(read.loops.read).toBe(false);
    if (read.loops.read) return;
    expect(read.loops.problem).toContain('broken.json');
    expect(read.branch.read).toBe(true);
  });
});

describe('the pull request section', () => {
  it('reads the branch\'s open pull request, its mergeability and its checks verdict', async () => {
    const double = createPullRequestsDouble({
      findOpen: () => Promise.resolve(summary(12)),
      get: () => Promise.resolve(detail(12, 'conflicting')),
      checks: () => Promise.resolve({ rows: [], verdict: 'red' }),
    });
    const { seams } = world({ pulls: double.pulls });

    const read = await sections(projectWith(), seams);

    expect(read.pull).toEqual({
      read: true,
      pull: { summary: summary(12), mergeable: 'conflicting', verdict: 'red' },
      notes: [],
    });
    expect(double.sent()).toEqual([`findOpen ${BRANCH}`, 'get 12', 'checks 12']);
  });

  it('answers no pull request for a branch that has none', async () => {
    const { seams } = world();

    const read = await sections(projectWith(), seams);

    expect(read.pull).toEqual({ read: true, pull: null, notes: [] });
  });

  it('is not read when the provider throws, and the board is read all the same', async () => {
    const double = createPullRequestsDouble({ findOpen: () => Promise.reject(new Error('gh pr list failed: HTTP 502')) });
    const { seams } = world({ pulls: double.pulls });

    const read = await sections(projectWith(), seams);

    expect(read.pull).toEqual({ read: false, problem: 'gh pr list failed: HTTP 502' });
    expect(read.board.read).toBe(true);
  });

  it('is not read when the provider never answers, on time, and the board is read all the same', async () => {
    const double = createPullRequestsDouble({ findOpen: () => never() });
    const { seams } = world({ pulls: double.pulls });

    const started = Date.now();
    const read = await sections(projectWith(), seams);
    const elapsed = Date.now() - started;

    expect(read.pull).toEqual({
      read: false,
      problem: `the pull request was not read within the ${String(CASE_TIMEOUT_MS)}ms network deadline`,
    });
    expect(read.board.read).toBe(true);
    expect(elapsed).toBeLessThan(CASE_TIMEOUT_MS + MARGIN_MS);
  });
});

describe('the board section', () => {
  const LINE = { issue: 101, ticked: false, why: 'rafa status', lineNumber: 7 };
  const BLOCKED: BlockedLine = { issue: 101, blockers: [94], open: [94], unread: [], fault: null };

  it('reads the next line with whether it is ready and what blocks it, and counts the blocked issues', async () => {
    const log: Reached[] = [];
    const board = scriptedBoard(() => Promise.resolve({ roadmap: 31, line: LINE, passed: 2, problems: ['a scan note'] }), false, BLOCKED, log);
    const report: BlockedIssuesReport = {
      readings: [readBlockedBy(12, 'Blocked by: #3'), readBlockedBy(13, 'no line')],
      faults: [],
      problem: null,
      unchecked: null,
    };
    const { seams } = world({ board, blockedIssues: () => Promise.resolve(report) });

    const read = await sections(projectWith(), seams);

    expect(read.board).toEqual({
      read: true,
      roadmap: 31,
      next: { line: LINE, ready: false, blocked: BLOCKED },
      passed: 2,
      blockedIssues: 2,
      notes: ['a scan note'],
    });
    expect(log).toEqual(['board next', 'board isReady 101', 'board blocking 101']);
  });

  it('answers no next line for a roadmap with none left, asking nothing about an issue', async () => {
    const log: Reached[] = [];
    const board = scriptedBoard(() => Promise.resolve(NO_LINE), true, null, log);
    const { seams } = world({ board });

    const read = await sections(projectWith(), seams);

    expect(read.board).toEqual({ read: true, roadmap: 31, next: null, passed: 4, blockedIssues: 0, notes: [] });
    expect(log).toEqual(['board next']);
  });

  it('carries a blocked listing that failed as a note, with no count', async () => {
    const report: BlockedIssuesReport = { readings: [], faults: [], problem: 'board blocked: gh issue list failed', unchecked: null };
    const { seams } = world({ blockedIssues: () => Promise.resolve(report) });

    const read = await sections(projectWith(), seams);

    expect(read.board.read).toBe(true);
    if (!read.board.read) return;
    expect(read.board.blockedIssues).toBeNull();
    expect(read.board.notes).toEqual(['the issues labelled spec:blocked could not be read: board blocked: gh issue list failed']);
  });

  it('is not read when the walk throws, naming why', async () => {
    const board = scriptedBoard(() => Promise.reject(new Error('no open issue is titled Roadmap')), true, null, []);
    const { seams } = world({ board });

    const read = await sections(projectWith(), seams);

    expect(read.board).toEqual({ read: false, problem: 'no open issue is titled Roadmap' });
  });

  it('is not read when the walk never answers, on time', async () => {
    const board = scriptedBoard(() => never(), true, null, []);
    const { seams } = world({ board });

    const started = Date.now();
    const read = await sections(projectWith(), seams);
    const elapsed = Date.now() - started;

    expect(read.board).toEqual({
      read: false,
      problem: `the board was not read within the ${String(CASE_TIMEOUT_MS)}ms network deadline`,
    });
    expect(elapsed).toBeLessThan(CASE_TIMEOUT_MS + MARGIN_MS);
  });
});

describe('the network deadline', () => {
  it('opens each gh command with the time left, never more than the deadline', async () => {
    const { seams, opened } = world({ blockedIssues: async (gh) => {
      await gh(['issue', 'list']);
      return NO_BLOCKED;
    } });

    await sections(projectWith(), seams);

    expect(opened.map((open) => open.args)).toEqual(['issue list']);
    const [first] = opened;
    expect(first?.timeoutMs).toBeGreaterThan(0);
    expect(first?.timeoutMs).toBeLessThanOrEqual(CASE_TIMEOUT_MS);
  });

  it('spawns no gh command once the deadline has passed, answering it as not run', async () => {
    const late: GhResult[] = [];
    const board: NextBoard = {
      next: () => never(),
      isReady: () => Promise.resolve(true),
      blocking: () => Promise.resolve(null),
    };
    const { seams, opened } = world({
      board,
      blockedIssues: async (gh) => {
        await Bun.sleep(CASE_TIMEOUT_MS + 50);
        late.push(await gh(['issue', 'list']));
        return NO_BLOCKED;
      },
    });

    await sections(projectWith(), seams);
    await Bun.sleep(CASE_TIMEOUT_MS + 100);

    expect(opened).toEqual([]);
    expect(late).toEqual([{
      ok: false,
      stdout: '',
      stderr: `gh issue list was not run: the ${String(CASE_TIMEOUT_MS)}ms network deadline had passed`,
    }]);
  });

  it('does not run while the local sections are read', async () => {
    const project = projectWith(sessionRecord({ state: 'running' }));
    const { seams, opened } = world({
      isAlive: () => {
        Bun.sleepSync(CASE_TIMEOUT_MS + 50);
        return true;
      },
      blockedIssues: async (gh) => {
        await gh(['issue', 'list']);
        return NO_BLOCKED;
      },
    });

    const read = await sections(project, seams);

    expect(read.board.read).toBe(true);
    expect(opened.map((open) => open.args)).toEqual(['issue list']);
  });
});

describe('the order the sections are read in', () => {
  it('reads the branch, then the loops, then resolves the provider, and only then reaches the network', async () => {
    const double = createPullRequestsDouble({ findOpen: () => Promise.resolve(null) });
    const project = projectWith(sessionRecord({ state: 'running' }));
    const { seams, log } = world({
      pulls: double.pulls,
      blockedIssues: async (gh) => {
        await gh(['issue', 'list']);
        return NO_BLOCKED;
      },
    });

    await sections(project, seams);

    const at = (entry: string): number => log.indexOf(entry);
    expect(at('git rev-parse --abbrev-ref HEAD')).toBe(0);
    expect(at('isAlive 7171')).toBeGreaterThan(at('git rev-parse --abbrev-ref HEAD'));
    expect(at('origin')).toBeGreaterThan(at('isAlive 7171'));
    expect(at('board next')).toBeGreaterThan(at('origin'));
    expect(at('gh issue list')).toBeGreaterThan(at('origin'));
  });
});

describe('a provider that is not gh', () => {
  it('reads neither network section, opening no gh and asking no provider, and names the remote', async () => {
    const double = createPullRequestsDouble();
    const log: Reached[] = [];
    const board = scriptedBoard(() => Promise.resolve(NO_LINE), true, null, log);
    const { seams, opened, cleanups } = world({ remote: 'https://gitlab.com/o/r.git', pulls: double.pulls, board });

    const read = await sections(projectWith(), seams);

    expect(read.pull).toEqual({
      read: false,
      problem: 'pr.provider is none, as origin is no GitHub remote, and rafa status reads the pull request through gh alone',
    });
    expect(read.board).toEqual({
      read: false,
      problem: 'pr.provider is none, as origin is no GitHub remote, and rafa status reads the board through gh alone',
    });
    expect(opened).toEqual([]);
    expect(double.calls()).toEqual([]);
    expect(log).toEqual([]);
    expect(cleanups).toEqual([{ pulls: null }]);
    expect(read.branch.read).toBe(true);
    expect(read.loops.read).toBe(true);
  });

  it('names the config when the config names the provider', async () => {
    const { seams } = world();

    const read = await sections(projectWith(), seams, { ...CONFIG, prProvider: 'none' });

    expect(read.pull).toEqual({
      read: false,
      problem: 'pr.provider is none, as the config names it, and rafa status reads the pull request through gh alone',
    });
  });

  it('hands the housekeeping reading the provider when it is gh, where none gets null', async () => {
    const double = createPullRequestsDouble({ findOpen: () => Promise.resolve(null) });
    const { seams, cleanups } = world({ pulls: double.pulls });

    await sections(projectWith(), seams);

    expect(cleanups).toEqual([{ pulls: double.pulls }]);
  });
});

describe('the housekeeping section', () => {
  let repo: ScratchRepository;

  beforeAll(() => {
    repo = createScratchRepository();
  });

  afterAll(() => {
    repo.dispose();
  });

  /** Modification times `wt-clean` alone reads as old by, every other path as {@link SCRATCH_NOW}. */
  const OLD = new Date('2026-01-01T00:00:00Z');

  /** Seams over the real scratch repository, the disk's times scripted by `modifiedAt`. */
  function scratchSeams(modifiedAt: (path: string) => Date | null): StatusSeams {
    return {
      readRemote: () => null,
      now: () => SCRATCH_NOW,
      timeoutMs: CASE_TIMEOUT_MS,
      cleanupSeams: (cwd, pulls) => ({ ...defaultCleanupSeams(cwd, pulls), modifiedAt }),
    };
  }

  /** The sections of the scratch clone over `seams`. */
  function scratchSections(seams: StatusSeams): Promise<StatusSections> {
    return readStatusSections({ root: repo.clone, home: repo.home, config: CONFIG }, seams);
  }

  it('counts what rafa doctor counts over the same repository', async () => {
    const read = await scratchSections(scratchSeams(() => SCRATCH_NOW));
    const doctor = await readDoctorCleanup(
      { root: repo.clone, home: repo.home, config: CONFIG, gh: null },
      { cleanupNow: () => SCRATCH_NOW },
    );

    expect(doctor.ok).toBe(true);
    if (!doctor.ok) return;
    expect(read.housekeeping.read).toBe(true);
    if (!read.housekeeping.read) return;
    expect(read.housekeeping.counts).toEqual(doctor.counts);
    expect(read.housekeeping.counts.merged).toBeGreaterThan(0);
    expect(read.housekeeping.counts.worktrees).toBe(3);
  });

  it('counts a worktree idle when nothing touched it within cleanup.worktreeIdleDays', async () => {
    const oneOld = await scratchSections(scratchSeams((path) => (path.includes('wt-clean')
      ? OLD
      : SCRATCH_NOW)));
    const allOld = await scratchSections(scratchSeams(() => OLD));
    const noneOld = await scratchSections(scratchSeams(() => SCRATCH_NOW));

    const idle = (read: StatusSections): number | null => (read.housekeeping.read
      ? read.housekeeping.idleWorktrees
      : null);
    expect(idle(oneOld)).toBe(1);
    expect(idle(allOld)).toBe(3);
    expect(idle(noneOld)).toBe(0);
  });

  it('is not read when git refuses, naming git\'s words, and the other local sections are read all the same', async () => {
    const { seams } = world();

    const read = await sections(projectWith(), seams);

    expect(read.housekeeping.read).toBe(false);
    if (read.housekeeping.read) return;
    expect(read.housekeeping.problem).toContain('not a git repository');
    expect(read.branch.read).toBe(true);
    expect(read.loops.read).toBe(true);
  });
});
