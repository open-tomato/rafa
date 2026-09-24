/**
 * `./cleanup.ts` dispatched in-process over a planted project: the
 * grouped checklist driven by scripted keys, the second question a
 * ticked Not-pushed row gets, the final question, the steps run through
 * a recording git, `--dry-run`, and the listing that asks nothing
 * without a terminal or under `--output=json`.
 *
 * The reading is a literal one handed in through the `read` seam, so a
 * case names exactly which rows exist and which start ticked; the
 * reading over real git is `src/cleanup/`'s, and over the scratch
 * repository end to end is the integration test's. Every git call the
 * command makes goes through the recording runner, which answers
 * success unless a case says otherwise.
 *
 * ## The controls
 *
 * - "Enter then y" runs three steps; the same keys answered `n` run
 *   none. Without the pair, a command that ran the steps whatever was
 *   answered would pass the first half.
 * - The Not-pushed row answered `y` IS deleted with `-D`, and answered
 *   `n` is not, over the same keys: so the second question is proved
 *   to decide, not merely to be printed.
 * - The listing cases hold the git runner uncalled, the keys never
 *   opened and the prompter never opened, beside the asking cases
 *   where all three are, so "nothing removed" is read against runs that
 *   do remove.
 */
import type { CleanupCommandSeams } from './cleanup.js';
import type {
  CleanupRead,
  CleanupSeams,
  CleanupSettings,
  LocalBranch,
  MergedRow,
  NotPushedRow,
  StaleRow,
  WorktreeRow,
} from '../cleanup/index.js';
import type { Prompter } from '../cli/prompt/confirm.js';
import type { Key, Terminal } from '../cli/prompt/terminal.js';
import type { GitResult } from '../pr/git.js';
import type { PullRequests } from '../pr/types.js';
import type { CapturedRun, PlantedProject } from '../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createPullRequestsDouble } from '../pr/pull-requests-double.js';
import { dispatchInProject, eventsOf, plantProject } from '../tests/cli-capture.js';

import { cleanupData, renderCleanup } from './cleanup-render.js';
import {
  CLEANUP_USAGE,
  cleanupGroups,
  cleanupQuestion,
  createCleanupCommand,
  NOTHING_LISTED_TEXT,
  NOTHING_REMOVED_TEXT,
  notPushedQuestion,
  selectionOf,
} from './cleanup.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-cleanup-command-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

let planted = 0;

/** A fresh project under this file's directory. */
function plant(): PlantedProject {
  planted += 1;
  const scope = join(tempBase, `case-${String(planted)}`);
  return plantProject(realpathSync(mkdtempSync(`${scope}-`)));
}

const WHEN = new Date('2026-09-20T08:30:00Z');
const NOW = new Date('2026-09-24T12:00:00Z');
const WORKTREES = '/repo/.claude/worktrees';

function branch(name: string, overrides: Partial<LocalBranch> = {}): LocalBranch {
  return { name, upstream: `origin/${name}`, gone: false, ahead: 0, lastCommit: WHEN, ...overrides };
}

const MERGED: MergedRow = {
  group: 'merged',
  branch: branch('done'),
  ticked: true,
  mergedBy: ['base'],
  pullRequest: null,
  reason: 'merged into main',
};

const SQUASHED: MergedRow = {
  group: 'merged',
  branch: branch('squashed'),
  ticked: true,
  mergedBy: ['pull-request'],
  pullRequest: { number: 7, headRefName: 'squashed', headRefOid: 'abc', mergedAt: WHEN.toISOString() },
  reason: 'pull request #7 merged',
};

const STALE: StaleRow = {
  group: 'stale',
  branch: branch('old-idea'),
  ticked: false,
  idleDays: 90,
  reason: 'no commit in 90 days',
};

const NOT_PUSHED: NotPushedRow = {
  group: 'not-pushed',
  branch: branch('wip', { upstream: null, ahead: null }),
  ticked: false,
  commits: 2,
  reason: 'no upstream; 2 commits not on any remote',
};

const WT_CLEAN: WorktreeRow = {
  path: `${WORKTREES}/wt-clean`,
  branch: 'done',
  lastModified: WHEN,
  branchMerged: true,
  blockers: [],
  tickable: true,
  ticked: true,
  reason: 'clean; branch merged',
};

const WT_DIRTY: WorktreeRow = {
  path: `${WORKTREES}/wt-dirty`,
  branch: 'dirty',
  lastModified: WHEN,
  branchMerged: false,
  blockers: [{ kind: 'dirty', reason: '1 untracked' }],
  tickable: false,
  ticked: false,
  reason: '1 untracked',
};

function reading(overrides: Partial<CleanupRead> = {}): CleanupRead {
  return {
    ok: true,
    base: 'main',
    fetched: true,
    merged: [MERGED, SQUASHED],
    stale: [STALE],
    notPushed: [NOT_PUSHED],
    worktrees: [WT_CLEAN, WT_DIRTY],
    notes: [],
    ...overrides,
  };
}

const UP: Key = { name: 'up' };
const DOWN: Key = { name: 'down' };
const ENTER: Key = { name: 'enter' };
const ESCAPE: Key = { name: 'escape' };
const SPACE: Key = { name: 'char', char: ' ' };
const GROUP: Key = { name: 'char', char: 'a' };

/** A terminal recording what the checklist writes; a terminal only when `isTTY`. */
function recordingTerminal(isTTY = true): { readonly terminal: Terminal; readonly written: () => string } {
  const writes: string[] = [];
  const terminal: Terminal = {
    isTTY,
    setRawMode: () => undefined,
    write: (text) => {
      writes.push(text);
    },
    onInterrupt: () => () => undefined,
    exit: () => undefined,
  };
  return { terminal, written: () => writes.join('') };
}

/** Everything a case recorded: git's calls, the questions, and how often keys and a prompter were opened. */
interface Recorded {
  readonly git: (readonly string[])[];
  readonly asked: string[];
  keysOpened: number;
  promptersOpened: number;
  settings: CleanupSettings | null;
  pulls: PullRequests | null | undefined;
}

/** What a case runs with. */
interface CaseOptions {
  readonly read?: CleanupRead | { readonly ok: false; readonly detail: string };
  readonly keys?: readonly Key[];
  readonly answers?: readonly string[];
  readonly isTTY?: boolean;
  readonly remote?: string | null;
  /** Git's answer for an argv, success when absent. */
  readonly gitAnswer?: (args: readonly string[]) => GitResult | undefined;
}

/** The seams of one case, and what they recorded. */
function caseSeams(options: CaseOptions): { readonly seams: CleanupCommandSeams; readonly recorded: Recorded; readonly written: () => string } {
  const recorded: Recorded = { git: [], asked: [], keysOpened: 0, promptersOpened: 0, settings: null, pulls: undefined };
  const answers = [...(options.answers ?? [])];
  const { terminal, written } = recordingTerminal(options.isTTY ?? true);
  const git = (args: readonly string[]): GitResult => {
    recorded.git.push(args);
    return options.gitAnswer?.(args) ?? { ok: true, stdout: '', stderr: '' };
  };
  const seams: CleanupCommandSeams = {
    cwd: () => '/repo',
    now: () => NOW,
    readRemote: () => options.remote ?? null,
    pullRequests: () => createPullRequestsDouble().pulls,
    cleanupSeams: (_cwd, pulls): CleanupSeams => {
      recorded.pulls = pulls;
      return {
        git,
        gitAt: () => git,
        sessions: () => [],
        modifiedAt: () => null,
        realPath: (path) => path,
        pulls,
      };
    },
    read: (_seams, settings) => {
      recorded.settings = settings;
      return Promise.resolve(options.read ?? reading());
    },
    terminal: () => terminal,
    keys: () => {
      recorded.keysOpened += 1;
      const keys = options.keys ?? [];
      return (async function* script(): AsyncGenerator<Key, void, undefined> {
        yield* keys;
      })();
    },
    openPrompter: (): Prompter => {
      recorded.promptersOpened += 1;
      return {
        say: () => undefined,
        ask: (question) => {
          recorded.asked.push(question);
          return Promise.resolve(answers.shift() ?? null);
        },
        close: () => undefined,
      };
    },
  };
  return { seams, recorded, written };
}

/** Dispatches `words` over the command made with a case's seams. */
async function run(words: readonly string[], options: CaseOptions = {}): Promise<CapturedRun & { readonly recorded: Recorded; readonly written: () => string }> {
  const { seams, recorded, written } = caseSeams(options);
  const outcome = await dispatchInProject(['cleanup', ...words], [], [createCleanupCommand(seams)], plant());
  return { ...outcome, recorded, written };
}

/** The argv each git call was handed, joined, leaving out the reading's own calls (none reach this runner). */
function gitLines(recorded: Recorded): readonly string[] {
  return recorded.git.map((args) => args.join(' '));
}

/** Every git step "Enter then y" runs over the default reading, in order. */
const DEFAULT_STEPS = [
  `worktree remove ${WORKTREES}/wt-clean`,
  'branch -d done',
  'branch -D squashed',
];

describe('cleanupQuestion and notPushedQuestion', () => {
  it('spells the final question with each count and its noun', () => {
    expect(cleanupQuestion(2, 1)).toBe('Delete 2 branches and remove 1 worktree? [y/N] ');
    expect(cleanupQuestion(1, 0)).toBe('Delete 1 branch and remove 0 worktrees? [y/N] ');
  });

  it('names the branch and the commits deleting it loses', () => {
    expect(notPushedQuestion(NOT_PUSHED)).toBe('wip holds 2 commits no remote has, which deleting it loses. Delete wip? [y/N] ');
    expect(notPushedQuestion({ ...NOT_PUSHED, commits: 1 })).toContain('holds 1 commit no remote has');
  });
});

describe('cleanupGroups and selectionOf', () => {
  it('gives the four groups in order, each row ticked as read, and an untickable worktree disabled with its reason', () => {
    const groups = cleanupGroups(reading());
    expect(groups.map((group) => group.title)).toEqual(['Merged', 'Stale', 'Not pushed', 'Worktrees']);
    expect(groups.map((group) => group.choices.map((choice) => choice.checked))).toEqual([[true, true], [false], [false], [true, false]]);
    const [clean, dirty] = groups[3]?.choices ?? [];
    expect(clean?.disabled).toBeUndefined();
    expect(clean?.label).toContain('clean; branch merged');
    expect(dirty?.disabled).toBe('1 untracked');
    expect(dirty?.label).toBe(`${WT_DIRTY.path}  2026-09-20`);
  });

  it('splits ticked rows back into their groups', () => {
    const selection = selectionOf([WT_CLEAN, MERGED, STALE, NOT_PUSHED]);
    expect(selection).toEqual({ worktrees: [WT_CLEAN], merged: [MERGED], stale: [STALE], notPushed: [NOT_PUSHED] });
  });
});

describe('rafa cleanup with a terminal', () => {
  it('runs the default ticks on Enter then y: the worktree first, then -d for merged and -D for squash-merged', async () => {
    const outcome = await run([], { keys: [ENTER], answers: ['y'] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.recorded.asked).toEqual([cleanupQuestion(2, 1)]);
    expect(gitLines(outcome.recorded)).toEqual(DEFAULT_STEPS);
    expect(gitLines(outcome.recorded).some((line) => line.includes('--force'))).toBe(false);
    for (const line of DEFAULT_STEPS) expect(outcome.stdout).toContain(`✓ git ${line}`);
  });

  it('runs nothing when the final question is answered n (control)', async () => {
    const outcome = await run([], { keys: [ENTER], answers: ['n'] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.recorded.asked).toEqual([cleanupQuestion(2, 1)]);
    expect(outcome.recorded.git).toEqual([]);
    expect(outcome.stdout).toContain(NOTHING_REMOVED_TEXT);
  });

  it('asks the second question for a ticked Not-pushed row, and n keeps it', async () => {
    const keys = [DOWN, DOWN, DOWN, SPACE, ENTER];
    const outcome = await run([], { keys, answers: ['n', 'y'] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.recorded.asked).toEqual([notPushedQuestion(NOT_PUSHED), cleanupQuestion(2, 1)]);
    expect(gitLines(outcome.recorded)).toEqual(DEFAULT_STEPS);
  });

  it('deletes the Not-pushed row with -D once the second question is answered y (control)', async () => {
    const keys = [DOWN, DOWN, DOWN, SPACE, ENTER];
    const outcome = await run([], { keys, answers: ['y', 'y'] });
    expect(outcome.recorded.asked).toEqual([notPushedQuestion(NOT_PUSHED), cleanupQuestion(3, 1)]);
    expect(gitLines(outcome.recorded)).toEqual([...DEFAULT_STEPS, 'branch -D wip']);
  });

  it('deletes a ticked Stale row with -D on the final yes alone', async () => {
    const outcome = await run([], { keys: [DOWN, DOWN, SPACE, ENTER], answers: ['y'] });
    expect(outcome.recorded.asked).toEqual([cleanupQuestion(3, 1)]);
    expect(gitLines(outcome.recorded)).toEqual([...DEFAULT_STEPS, 'branch -D old-idea']);
  });

  it('never ticks a disabled worktree, and draws its reason beside it', async () => {
    const outcome = await run([], { keys: [UP, SPACE, ENTER], answers: ['y'] });
    expect(gitLines(outcome.recorded)).toEqual(DEFAULT_STEPS);
    expect(outcome.written()).toContain(`⊘ ${WT_DIRTY.path}  2026-09-20 (1 untracked)`);
  });

  it('removes nothing and asks nothing on escape', async () => {
    const outcome = await run([], { keys: [ESCAPE] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.recorded.keysOpened).toBe(1);
    expect(outcome.recorded.promptersOpened).toBe(0);
    expect(outcome.recorded.git).toEqual([]);
    expect(outcome.stdout).toContain(NOTHING_REMOVED_TEXT);
  });

  it('removes nothing and asks nothing when Enter answers with nothing ticked', async () => {
    const outcome = await run([], { keys: [GROUP, UP, UP, SPACE, ENTER] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.recorded.promptersOpened).toBe(0);
    expect(outcome.recorded.git).toEqual([]);
    expect(outcome.stdout).toContain(NOTHING_REMOVED_TEXT);
  });

  it('prints the git commands under --dry-run, asking no final question and running nothing', async () => {
    const outcome = await run(['--dry-run'], { keys: [ENTER], answers: ['y'] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.recorded.asked).toEqual([]);
    expect(outcome.recorded.git).toEqual([]);
    expect(outcome.stdout).toContain(DEFAULT_STEPS.map((line) => `git ${line}`).join('\n'));
  });

  it('still asks the second question under --dry-run, and prints -D only for a yes', async () => {
    const keys = [DOWN, DOWN, DOWN, SPACE, ENTER];
    const yes = await run(['--dry-run'], { keys, answers: ['y'] });
    const no = await run(['--dry-run'], { keys, answers: ['n'] });
    expect(yes.recorded.asked).toEqual([notPushedQuestion(NOT_PUSHED)]);
    expect(yes.stdout).toContain('git branch -D wip');
    expect(no.stdout).not.toContain('git branch -D wip');
    expect([...yes.recorded.git, ...no.recorded.git]).toEqual([]);
  });

  it('leaves a merged branch whose worktree was not removed, and exits 1 naming the failed steps', async () => {
    const outcome = await run([], {
      keys: [ENTER],
      answers: ['y'],
      gitAnswer: (args) => (args[0] === 'worktree'
        ? { ok: false, stdout: '', stderr: 'fatal: cannot remove' }
        : undefined),
    });
    expect(outcome.exitCode).toBe(1);
    expect(gitLines(outcome.recorded)).toEqual([`worktree remove ${WT_CLEAN.path}`, 'branch -D squashed']);
    expect(outcome.stdout).toContain(`✗ git worktree remove ${WT_CLEAN.path}: fatal: cannot remove`);
    expect(outcome.stdout).toContain(`✗ git branch -d done: not run: the worktree at ${WT_CLEAN.path} was not removed`);
    expect(outcome.stdout).toContain('✓ git branch -D squashed');
    expect(outcome.stderr).toContain('2 steps of 3 did not run clean');
  });

  it('warns each reading note before the checklist', async () => {
    const outcome = await run([], { read: reading({ notes: ['pull requests could not be read'] }), keys: [ESCAPE] });
    expect(outcome.stdout).toContain('warn: pull requests could not be read');
  });

  it('asks nothing over a reading with no row', async () => {
    const outcome = await run([], { read: reading({ merged: [], stale: [], notPushed: [], worktrees: [] }), keys: [ENTER] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.recorded.keysOpened).toBe(0);
    expect(outcome.stdout).toContain(NOTHING_LISTED_TEXT);
  });
});

describe('rafa cleanup listing only', () => {
  it('prints the four groups with no terminal, exiting 0 and removing nothing', async () => {
    const outcome = await run([], { isTTY: false, keys: [ENTER], answers: ['y'] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe(`${renderCleanup(reading()).join('\n')}\n`);
    expect(outcome.recorded.keysOpened).toBe(0);
    expect(outcome.recorded.promptersOpened).toBe(0);
    expect(outcome.recorded.git).toEqual([]);
  });

  it('prints the same listing under --dry-run with no terminal', async () => {
    const plain = await run([], { isTTY: false });
    const dry = await run(['--dry-run'], { isTTY: false });
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout).toBe(plain.stdout);
    expect(dry.recorded.git).toEqual([]);
  });

  it('gives the groups as the result data under --output=json, asking nothing even with a terminal', async () => {
    const outcome = await run(['--output=json'], { keys: [ENTER], answers: ['y'] });
    expect(outcome.exitCode).toBe(0);
    const events = eventsOf(outcome.stdout);
    const result = events.at(-1);
    expect(result?.type).toBe('result');
    expect(JSON.stringify(result)).toContain(JSON.stringify(cleanupData(reading())));
    expect(outcome.recorded.keysOpened).toBe(0);
    expect(outcome.recorded.promptersOpened).toBe(0);
    expect(outcome.recorded.git).toEqual([]);
  });
});

describe('rafa cleanup reading', () => {
  it('reads with the fetch, the config defaults, the cwd, the home and the clock', async () => {
    const project = plant();
    const { seams, recorded } = caseSeams({ isTTY: false });
    await dispatchInProject(['cleanup'], [], [createCleanupCommand(seams)], project);
    expect(recorded.settings).toEqual({
      fetch: true,
      base: null,
      keep: [],
      staleDays: 30,
      worktreeIdleDays: 7,
      now: NOW,
      home: project.home,
      cwd: '/repo',
      projectRoot: project.root,
    });
  });

  it('hands no provider over a remote that resolves to none, and the gh one over a GitHub remote', async () => {
    const none = await run([], { isTTY: false, remote: null });
    const gh = await run([], { isTTY: false, remote: 'git@github.com:open-tomato/rafa.git' });
    expect(none.recorded.pulls).toBeNull();
    expect(gh.recorded.pulls).not.toBeNull();
  });

  it('refuses with exit code 1 when git cannot be read', async () => {
    const outcome = await run([], { read: { ok: false, detail: 'not a git repository' } });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('rafa cleanup: the repository cannot be read: not a git repository');
  });

  it('refuses an argument and a value typed after --dry-run', async () => {
    const argument = await run(['now']);
    const value = await run(['--dry-run', 'now']);
    expect(argument.exitCode).toBe(1);
    expect(argument.stderr).toContain(CLEANUP_USAGE);
    expect(value.exitCode).toBe(1);
    expect(value.stderr).toContain('--dry-run takes no value, and read "now" as one');
    expect(value.recorded.settings).toBeNull();
  });

  it('declares no spends', () => {
    expect(createCleanupCommand().spends).toBeUndefined();
  });
});
