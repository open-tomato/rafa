/**
 * Tests for the order of row 1 of the state table (`./state.ts`),
 * `loop-running`, and the working-tree pre-condition
 * (`./preconditions.ts`), `tree-modified`: a live run's edits are
 * answered by row 1 and never offered back to the person, and the tree
 * line names the checkout it read (#444).
 *
 * `./state.test.ts` holds the rest of the table and is over 800 lines,
 * so these cases live here, over fakes of their own: a `GitRunner`
 * answering by argv and recording every call, the pull request double
 * (`src/pr/pull-requests-double.ts`), a board that answers nothing, and
 * an empty plans directory under a temporary root. Nothing here spawns
 * `git`, spawns `gh` or reaches GitHub.
 *
 * ## The controls
 *
 * Every case that plants a live run beside tracked edits is paired with
 * the same edits beside no live run, which must answer `tree-modified`,
 * so a table that never read the tree at all would fail the pair. A run
 * that ENDED (`stopped`, `done`) is driven beside the same edits too: its
 * edits are the person's again, and the tree line has to come back.
 *
 * The checkout the tree line names is driven both ways: git naming a
 * top level, which the line quotes, and git refusing, where the line
 * reads "the working tree" alone and the refusal is carried as a
 * problem. A line that always printed the checkout would fail the
 * second half, and one that never did would fail the first.
 *
 * ## What passes while wrong
 *
 * Two mutations were driven on 2026-10-01, one at a time, over
 * `env -u CLAUDECODE bun test src/next/`, each module restored from a
 * scratch copy and verified with `shasum -c`. That run answers 21 fail
 * before either mutant, all in `./relation-readings-native.test.ts` and
 * `./relation-readings.test.ts` (`readings.branchClaimFor is not a
 * function`), and the counts below are on top of those:
 *
 *  - the tree pre-condition put back ahead of row 1 in `./state.ts`:
 *    6 more fail, the six cases of the first `describe` here. Every case
 *    of `./state.test.ts` still passes, since none of them plants a run
 *    beside a modified tree.
 *  - the tree line never naming its checkout in `./preconditions.ts`:
 *    4 more fail, two here and the two of `./state.test.ts` that spell
 *    the whole line.
 */
import type { NextBoard, NextSources } from './readings.js';
import type { SessionRecord, SessionState } from '../loop/sessions.js';
import type { GitResult } from '../pr/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { plansDirAt } from '../commands/plan/plan-files.js';
import { createPullRequestsDouble } from '../pr/pull-requests-double.js';

import { readNextState } from './state.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-next-live-run-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The base branch every case runs against. */
const BASE = 'main';

/** The stub the planted run names. */
const STUB = 'rafa-367-releases-settle-base-branch';

/** The branch that run is on. */
const PLAN_BRANCH = `feat/${STUB}`;

/** The session id the planted run carries. */
const SESSION = '20260929-101500-beef';

/** The checkout `git rev-parse --show-toplevel` names. */
const CHECKOUT = '/work/rafa';

/** What the loop's task has changed, as `git status --porcelain` writes it. */
const TASK_EDITS = [' M src/pr/gh.ts', ' M src/pr/index.ts', '?? src/pr/gh-fake.ts'];

/** The argv the tree reading spends, and the one that names its checkout. */
const STATUS = 'status --porcelain';
const TOPLEVEL = 'rev-parse --show-toplevel';

/** What git answered when it worked. */
function said(stdout: string): GitResult {
  return { ok: true, stdout, stderr: '' };
}

/** What git answered when it refused. */
function refused(stderr: string): GitResult {
  return { ok: false, stdout: '', stderr };
}

/** What a case plants; every part left out is the default. */
interface Situation {
  /** The session records. */
  readonly runs: readonly SessionRecord[];
  /** What `git status --porcelain` wrote, one line per entry. */
  readonly tree: readonly string[];
  /** What `git rev-parse --show-toplevel` answered. */
  readonly toplevel: GitResult;
}

/** Sources over a case, with every git call it made. */
interface CaseSources {
  readonly sources: NextSources;
  /** Each git call, its argv joined by spaces. */
  readonly ran: () => readonly string[];
}

/** A board answering an exhausted roadmap and nothing else. */
const BOARD: NextBoard = {
  next: () => Promise.resolve({ roadmap: 31, line: null, passed: 0, problems: [] }),
  blocking: () => Promise.resolve(null),
  isReady: () => Promise.resolve(false),
};

/** How many scratch roots a case has been handed. */
let scratches = 0;

/** An empty plans directory under a root no other case shares. */
function plantRoot(): string {
  scratches += 1;
  const root = join(tempBase, `case-${scratches}`);
  mkdirSync(join(root, '.rafa', 'plans'), { recursive: true });
  return root;
}

/** The sources a case is read over, on the base branch level with its remote. */
function sourcesFor(over: Partial<Situation> = {}): CaseSources {
  const situation: Situation = { runs: [], tree: [], toplevel: said(`${CHECKOUT}\n`), ...over };
  const answers: Readonly<Record<string, GitResult>> = {
    'rev-parse --abbrev-ref HEAD': said(`${BASE}\n`),
    [STATUS]: said(situation.tree.map((entry) => `${entry}\n`).join('')),
    [TOPLEVEL]: situation.toplevel,
    [`rev-list --left-right --count ${BASE}...origin/${BASE}`]: said('0\t0\n'),
  };
  let ran: readonly string[] = [];
  return {
    sources: {
      base: BASE,
      plans: plansDirAt(plantRoot(), '.rafa/plans'),
      runs: () => situation.runs,
      git: (args) => {
        const line = args.join(' ');
        ran = [...ran, line];
        return answers[line] ?? said('');
      },
      pulls: createPullRequestsDouble({ findOpen: () => Promise.resolve(null) }).pulls,
      board: BOARD,
    },
    ran: () => ran,
  };
}

/** The loop's session record, in `state`, filled from `over`. */
function run(state: SessionState, over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: SESSION,
    planStub: STUB,
    plan: `.rafa/plans/PLAN-${STUB}.md`,
    branch: PLAN_BRANCH,
    pid: 4242,
    startedAt: '2026-09-29T10:15:00Z',
    state,
    task: { line: 18, text: 'the eighteenth task' },
    ...over,
  };
}

describe('a live run beside the edits its task has made', () => {
  it('answers the running loop, and the same edits with no run answer the tree', async () => {
    const live = await readNextState(sourcesFor({ runs: [run('running')], tree: TASK_EDITS }).sources);
    const none = await readNextState(sourcesFor({ tree: TASK_EDITS }).sources);

    expect([live.id, none.id]).toEqual(['loop-running', 'tree-modified']);
  });

  it('says nothing about committing or setting the edits aside', async () => {
    const state = await readNextState(sourcesFor({ runs: [run('running')], tree: TASK_EDITS }).sources);
    const both = `${state.reading}\n${state.proposal}`;

    expect(state.reading).toBe(`a loop for \`${STUB}\` is running on \`${PLAN_BRANCH}\`, session ${SESSION}`);
    expect(state.proposal).toBe('nothing to start while it runs; `rafa loop status` says where it is');
    expect(both).not.toContain('commit');
    expect(both).not.toContain('set aside');
    expect(both).not.toContain('src/pr/gh.ts');
  });

  it('answers a paused run the same way, since its run has not ended', async () => {
    const state = await readNextState(sourcesFor({ runs: [run('paused')], tree: TASK_EDITS }).sources);

    expect(state.id).toBe('loop-running');
    expect(state.reading).toContain('is paused on');
  });

  it('answers a live run in a worktree of its own too, ahead of the tree it does not hold', async () => {
    const worktree = run('running', { worktree: '/work/rafa-worktrees/rafa-367' });
    const state = await readNextState(sourcesFor({ runs: [worktree], tree: TASK_EDITS }).sources);

    expect(state.id).toBe('loop-running');
  });

  it('reads no git at all while a run is live, the tree and its checkout included', async () => {
    const live = sourcesFor({ runs: [run('running')], tree: TASK_EDITS });
    const none = sourcesFor({ tree: TASK_EDITS });

    await readNextState(live.sources);
    await readNextState(none.sources);

    expect(live.ran()).toEqual([]);
    expect(none.ran()).toEqual([STATUS, TOPLEVEL]);
  });

  it('answers the running loop under `--roadmap` as well, whose table puts no hop row ahead of it', async () => {
    const { sources } = sourcesFor({ runs: [run('running')], tree: TASK_EDITS });
    const roadmap = { ownerApproval: (): never => {
      throw new Error('the owner gate was asked beside a running loop');
    } };

    const state = await readNextState({ ...sources, roadmap });

    expect(state.id).toBe('loop-running');
  });
});

describe('a run that has ended, whose edits are the person\'s again', () => {
  it.each([['stopped'], ['done']] as const)('offers the edits back beside a %s run', async (state) => {
    const answer = await readNextState(sourcesFor({ runs: [run(state)], tree: TASK_EDITS }).sources);

    expect(answer.id).toBe('tree-modified');
    expect(answer.proposal).toBe('commit or set aside your changes; rafa will not touch them');
  });

  it('names the tracked files alone, the untracked one left out', async () => {
    const state = await readNextState(sourcesFor({ runs: [run('stopped')], tree: TASK_EDITS }).sources);

    expect(state.reading).toBe(
      `the working tree at \`${CHECKOUT}\` has changes to 2 tracked files: \`src/pr/gh.ts\`, \`src/pr/index.ts\``,
    );
  });
});

describe('the checkout the tree line names', () => {
  it('quotes the top level git named, and carries no problem', async () => {
    const state = await readNextState(sourcesFor({ tree: [' M src/next/state.ts'] }).sources);

    expect(state.reading).toBe(`the working tree at \`${CHECKOUT}\` has changes to 1 tracked file: \`src/next/state.ts\``);
    expect(state.problems).toEqual([]);
  });

  it('reads "the working tree" alone and carries the problem when git could not name it', async () => {
    const toplevel = refused('fatal: not a git repository');
    const state = await readNextState(sourcesFor({ tree: [' M src/next/state.ts'], toplevel }).sources);

    expect(state.id).toBe('tree-modified');
    expect(state.reading).toBe('the working tree has changes to 1 tracked file: `src/next/state.ts`');
    expect(state.problems).toHaveLength(1);
    expect(state.problems[0]).toContain('fatal: not a git repository');
  });

  it('asks for the checkout only once the tree has shown a change', async () => {
    const clean = sourcesFor({ tree: ['?? notes.md'] });

    const state = await readNextState(clean.sources);

    expect(state.id).toBe('nothing-left');
    expect(clean.ran()).toContain(STATUS);
    expect(clean.ran()).not.toContain(TOPLEVEL);
  });
});
