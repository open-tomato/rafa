/**
 * `./cleanup.ts` dispatched in-process over a planted project: the
 * grouped checklist driven by scripted keys, the second question a
 * ticked Not-pushed row gets, the final question, the steps run through
 * a recording git, the run records removed from a directory of the
 * case's own, `--dry-run`, and the listing that asks nothing without a
 * terminal or under `--output=json`.
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
 * - A held Not-pushed row asks no second question and is withheld; the
 *   same row without its holder, over the same keys, IS asked and
 *   deleted, so the missing question is read against a run that asks.
 * - A ticked run record's files are gone after the final yes, and the
 *   same files planted again are still there after a no, so the removal
 *   is proved to follow the answer and the files to have been there.
 * - A Not-pushed row a ticked, removable worktree holds asks no second
 *   question and is withheld (#978); over the same reading with that
 *   worktree left unticked the question IS asked, and an unheld row
 *   ticked beside the held one is asked too, so the silence is the
 *   holder's and not a question that stopped being asked.
 * - An Only on origin row left as it opens, unticked, runs no push and
 *   is counted `0 branches on origin`; the same reading with the row
 *   ticked runs `push origin --delete` once and counts 1, and answered
 *   `n` runs nothing. So the push is proved to follow the tick AND the
 *   answer, and the unticked case is read against runs that do push.
 *   Both cases move the highlight onto the row first: the checklist
 *   draws ten lines at a time and the default reading fills them, so
 *   the last group is in no frame until the highlight reaches it.
 * - The listing cases hold the git runner uncalled, the keys never
 *   opened and the prompter never opened, beside the asking cases
 *   where all three are, so "nothing removed" is read against runs that
 *   do remove.
 */
import type { CleanupCommandSeams } from './cleanup.js';
import type { Key, Terminal } from '../cli/prompt/terminal.js';
import type { CapturedRun, PlantedProject } from '../tests/cli-capture.js';
import type { Prompter } from '@open-tomato/rafa/core/command';
import type { GitResult } from '@open-tomato/rafa/core/git';
import type { PullRequests } from '@open-tomato/rafa/pr/types';
import type {
  CleanupRead,
  CleanupSeams,
  CleanupSettings,
  LocalBranch,
  MergedRow,
  NotPushedRow,
  RemoteOnlyRow,
  RunRow,
  StaleRow,
  WorktreeRow,
} from '@open-tomato/rafa-run/cleanup/index';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createPullRequestsDouble } from '@open-tomato/rafa/pr/pull-requests-double';
import { forcedFlagRefusal, remoteOnlyReason } from '@open-tomato/rafa-run/cleanup/index';

import { dispatchInProject, eventsOf, plantProject } from '../tests/cli-capture.js';

import { cleanupData, remoteOnlyRowLine, renderCleanup, runRowLine } from './cleanup-render.js';
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

/** A clean worktree with {@link NOT_PUSHED}'s branch checked out: it can be ticked, and starts unticked. */
const WT_WIP: WorktreeRow = {
  path: `${WORKTREES}/wt-wip`,
  branch: 'wip',
  lastModified: WHEN,
  branchMerged: false,
  blockers: [],
  tickable: true,
  ticked: false,
  reason: 'clean',
};

/** A Not-pushed branch no worktree holds, beside {@link NOT_PUSHED}. */
const SPARE_NOT_PUSHED: NotPushedRow = {
  group: 'not-pushed',
  branch: branch('spare', { upstream: null, ahead: null }),
  ticked: false,
  commits: 1,
  reason: 'no upstream; 1 commit not on any remote',
};

/** What a ticked, removable worktree holding `wip` is withheld with. */
const WIP_WITHHELD = `not removed: wip: held by the worktree at ${WT_WIP.path}; only a Merged branch is deleted with its worktree`;

/** The Not-pushed branch {@link WT_DIRTY} has checked out, read as if no worktree held it. */
const UNHELD_NOT_PUSHED: NotPushedRow = {
  group: 'not-pushed',
  branch: branch('dirty', { upstream: null, ahead: null }),
  ticked: false,
  commits: 3,
  reason: 'no upstream; 3 commits not on any remote',
};

/** The same row as `packages/rafa-pr/src/cleanup/groups.ts` reads it held by {@link WT_DIRTY}. */
const HELD_NOT_PUSHED: NotPushedRow = {
  ...UNHELD_NOT_PUSHED,
  heldBy: { path: WT_DIRTY.path, name: 'wt-dirty', blockers: ['dirty'] },
  reason: `${UNHELD_NOT_PUSHED.reason}; checked out in wt-dirty (dirty)`,
};

const RUN: RunRow = {
  sessionId: 'a1b2c3d4',
  path: '/repo/.rafa/runs/a1b2c3d4.json',
  eventsPath: null,
  plan: 'rafa-12-a-plan',
  startedAt: '2026-08-01T10:00:00.000Z',
  ticked: true,
};

/** A run record and its events file planted under a fresh directory of this file's, as a row naming both. */
function plantedRun(): RunRow {
  planted += 1;
  const dir = join(tempBase, `runs-${String(planted)}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${RUN.sessionId}.json`);
  const eventsPath = join(dir, `${RUN.sessionId}.events.ndjson`);
  writeFileSync(path, '{}');
  writeFileSync(eventsPath, '');
  return { ...RUN, path, eventsPath };
}

/** A branch only on `origin` holding three commits, two of them with no patch-equal copy on the base. */
const REMOTE_ONLY: RemoteOnlyRow = {
  group: 'remote-only',
  name: 'fix/replaced',
  lastCommit: WHEN,
  commits: 3,
  uncopied: 2,
  ticked: false,
  reason: remoteOnlyReason(2, 3, 'main'),
};

/** A branch only on `origin` whose every commit has a patch-equal copy on the base. */
const REMOTE_COPIED: RemoteOnlyRow = {
  group: 'remote-only',
  name: 'fix/old',
  lastCommit: WHEN,
  commits: 2,
  uncopied: 0,
  ticked: false,
  reason: remoteOnlyReason(0, 2, 'main'),
};

/** The push a ticked {@link REMOTE_ONLY} runs, as the recording git is handed it. */
const REMOTE_PUSH = 'push origin --delete fix/replaced';

function reading(overrides: Partial<CleanupRead> = {}): CleanupRead {
  return {
    ok: true,
    base: 'main',
    fetched: true,
    merged: [MERGED, SQUASHED],
    stale: [STALE],
    notPushed: [NOT_PUSHED],
    worktrees: [WT_CLEAN, WT_DIRTY],
    remoteOnly: [],
    runs: [],
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
    expect(cleanupQuestion(2, 1, 0)).toBe('Delete 2 local branches and 0 branches on origin, remove 1 worktree and remove 0 run records? [y/N] ');
    expect(cleanupQuestion(1, 0, 1)).toBe('Delete 1 local branch and 0 branches on origin, remove 0 worktrees and remove 1 run record? [y/N] ');
    expect(cleanupQuestion(0, 0, 3)).toContain('remove 3 run records?');
  });

  it('counts the deletes on origin apart from the local ones', () => {
    expect(cleanupQuestion(2, 1, 0, 1)).toBe('Delete 2 local branches and 1 branch on origin, remove 1 worktree and remove 0 run records? [y/N] ');
    expect(cleanupQuestion(0, 0, 0, 3)).toBe('Delete 0 local branches and 3 branches on origin, remove 0 worktrees and remove 0 run records? [y/N] ');
    expect(cleanupQuestion(2, 1, 0, 1)).not.toBe(cleanupQuestion(3, 1, 0, 0));
  });

  it('names the branch and the commits deleting it loses', () => {
    expect(notPushedQuestion(NOT_PUSHED)).toBe('wip holds 2 commits no remote has, which deleting it loses. Delete wip? [y/N] ');
    expect(notPushedQuestion({ ...NOT_PUSHED, commits: 1 })).toContain('holds 1 commit no remote has');
  });
});

describe('cleanupGroups and selectionOf', () => {
  it('gives the six groups in order, each row ticked as read, and an untickable worktree disabled with its reason', () => {
    const groups = cleanupGroups(reading({ runs: [RUN] }));
    expect(groups.map((group) => group.title)).toEqual(['Merged', 'Stale', 'Not pushed', 'Worktrees', 'Run records', 'Only on origin']);
    expect(groups.map((group) => group.choices.map((choice) => choice.checked))).toEqual([[true, true], [false], [false], [true, false], [true], []]);
    const [clean, dirty] = groups[3]?.choices ?? [];
    expect(clean?.disabled).toBeUndefined();
    expect(clean?.label).toContain('clean; branch merged');
    expect(dirty?.disabled).toBe('1 untracked');
    expect(dirty?.label).toBe(`${WT_DIRTY.path}  2026-09-20`);
  });

  it('labels a run record\'s row with its plan and start day, padded to the widest plan', () => {
    const read = reading({ runs: [RUN] });
    const [run] = cleanupGroups(read)[4]?.choices ?? [];
    expect(run?.label).toBe(runRowLine(RUN, RUN.plan.length));
    expect(run?.label).toStartWith('rafa-12-a-plan ');
    expect(run?.label).toContain('  2026-08-01  run a1b2c3d4');
    expect(run?.disabled).toBeUndefined();
    expect(run?.value).toBe(RUN);
  });

  it('gives the branches only on origin as the last group, every row unticked and none disabled', () => {
    const read = reading({ runs: [RUN], remoteOnly: [REMOTE_COPIED, REMOTE_ONLY] });
    const group = cleanupGroups(read)[5];
    expect(group?.title).toBe('Only on origin');
    expect(group?.choices.map((choice) => choice.checked)).toEqual([false, false]);
    expect(group?.choices.map((choice) => choice.disabled)).toEqual([undefined, undefined]);
    expect(group?.choices.map((choice) => choice.value)).toEqual([REMOTE_COPIED, REMOTE_ONLY]);
    expect(group?.choices.map((choice) => choice.label)).toEqual([
      remoteOnlyRowLine(REMOTE_COPIED, REMOTE_ONLY.name.length),
      remoteOnlyRowLine(REMOTE_ONLY, REMOTE_ONLY.name.length),
    ]);
    expect(group?.choices[1]?.label).toBe('fix/replaced  2026-09-20  2 of 3 commits with no patch-equal copy on origin/main');
  });

  it('splits ticked rows back into their groups', () => {
    const selection = selectionOf([WT_CLEAN, MERGED, STALE, NOT_PUSHED, RUN]);
    expect(selection).toEqual({
      worktrees: [WT_CLEAN],
      merged: [MERGED],
      stale: [STALE],
      notPushed: [NOT_PUSHED],
      remoteOnly: [],
      runs: [RUN],
    });
  });

  it('hands a ticked branch only on origin over as remoteOnly, and as no local branch, worktree or run record', () => {
    const selection = selectionOf([MERGED, REMOTE_ONLY, WT_CLEAN, REMOTE_COPIED]);
    expect(selection).toEqual({
      worktrees: [WT_CLEAN],
      merged: [MERGED],
      stale: [],
      notPushed: [],
      remoteOnly: [REMOTE_ONLY, REMOTE_COPIED],
      runs: [],
    });
  });
});

describe('rafa cleanup with a terminal', () => {
  it('runs the default ticks on Enter then y: the worktree first, then -d for merged and -D for squash-merged', async () => {
    const outcome = await run([], { keys: [ENTER], answers: ['y'] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.recorded.asked).toEqual([cleanupQuestion(2, 1, 0)]);
    expect(gitLines(outcome.recorded)).toEqual(DEFAULT_STEPS);
    expect(gitLines(outcome.recorded).some((line) => line.includes('--force'))).toBe(false);
    for (const line of DEFAULT_STEPS) expect(outcome.stdout).toContain(`✓ git ${line}`);
  });

  it('runs nothing when the final question is answered n (control)', async () => {
    const outcome = await run([], { keys: [ENTER], answers: ['n'] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.recorded.asked).toEqual([cleanupQuestion(2, 1, 0)]);
    expect(outcome.recorded.git).toEqual([]);
    expect(outcome.stdout).toContain(NOTHING_REMOVED_TEXT);
  });

  it('asks the second question for a ticked Not-pushed row, and n keeps it', async () => {
    const keys = [DOWN, DOWN, DOWN, SPACE, ENTER];
    const outcome = await run([], { keys, answers: ['n', 'y'] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.recorded.asked).toEqual([notPushedQuestion(NOT_PUSHED), cleanupQuestion(2, 1, 0)]);
    expect(gitLines(outcome.recorded)).toEqual(DEFAULT_STEPS);
  });

  it('deletes the Not-pushed row with -D once the second question is answered y (control)', async () => {
    const keys = [DOWN, DOWN, DOWN, SPACE, ENTER];
    const outcome = await run([], { keys, answers: ['y', 'y'] });
    expect(outcome.recorded.asked).toEqual([notPushedQuestion(NOT_PUSHED), cleanupQuestion(3, 1, 0)]);
    expect(gitLines(outcome.recorded)).toEqual([...DEFAULT_STEPS, 'branch -D wip']);
  });

  it('asks no second question for a ticked Not-pushed row an untickable worktree holds, and withholds it', async () => {
    const keys = [DOWN, DOWN, DOWN, SPACE, ENTER];
    const outcome = await run([], { read: reading({ notPushed: [HELD_NOT_PUSHED] }), keys, answers: ['y'] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.recorded.asked).toEqual([cleanupQuestion(2, 1, 0)]);
    expect(gitLines(outcome.recorded)).toEqual(DEFAULT_STEPS);
    expect(outcome.stdout).toContain('not removed: dirty: checked out in wt-dirty (dirty), which is not removed');
  });

  it('still asks the second question for the same row once no worktree holds it (control)', async () => {
    const keys = [DOWN, DOWN, DOWN, SPACE, ENTER];
    const outcome = await run([], { read: reading({ notPushed: [UNHELD_NOT_PUSHED] }), keys, answers: ['y', 'y'] });
    expect(outcome.recorded.asked).toEqual([notPushedQuestion(UNHELD_NOT_PUSHED), cleanupQuestion(3, 1, 0)]);
    expect(gitLines(outcome.recorded)).toEqual([...DEFAULT_STEPS, 'branch -D dirty']);
    expect(outcome.stdout).not.toContain('not removed:');
  });

  it('asks about an unheld Not-pushed row and not a held one ticked beside it, under --dry-run too', async () => {
    const keys = [DOWN, DOWN, DOWN, GROUP, ENTER];
    const outcome = await run(['--dry-run'], { read: reading({ notPushed: [HELD_NOT_PUSHED, NOT_PUSHED] }), keys, answers: ['y'] });
    expect(outcome.recorded.asked).toEqual([notPushedQuestion(NOT_PUSHED)]);
    expect(outcome.stdout).toContain('not removed: dirty: checked out in wt-dirty (dirty), which is not removed');
    expect(outcome.stdout).toContain('git branch -D wip');
    expect(outcome.stdout).not.toContain('git branch -D dirty');
  });

  it('asks nothing about a ticked Not-pushed row a ticked, removable worktree holds, and reports it not removed (#978)', async () => {
    const read = reading({ worktrees: [WT_CLEAN, WT_WIP] });
    const keys = [DOWN, DOWN, DOWN, SPACE, DOWN, DOWN, SPACE, ENTER];
    const outcome = await run([], { read, keys, answers: ['y'] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.recorded.asked).toEqual([cleanupQuestion(2, 2, 0)]);
    expect(gitLines(outcome.recorded)).toEqual([
      `worktree remove ${WT_CLEAN.path}`,
      `worktree remove ${WT_WIP.path}`,
      'branch -d done',
      'branch -D squashed',
    ]);
    expect(outcome.stdout).toContain(WIP_WITHHELD);
  });

  it('asks about the same row once its worktree is left unticked (control)', async () => {
    const read = reading({ worktrees: [WT_CLEAN, WT_WIP] });
    const outcome = await run([], { read, keys: [DOWN, DOWN, DOWN, SPACE, ENTER], answers: ['n', 'y'] });
    expect(outcome.recorded.asked).toEqual([notPushedQuestion(NOT_PUSHED), cleanupQuestion(2, 1, 0)]);
    expect(outcome.stdout).not.toContain('not removed:');
  });

  it('asks nothing about that row under --dry-run either, and prints no -D line for it', async () => {
    const read = reading({ worktrees: [WT_CLEAN, WT_WIP] });
    const keys = [DOWN, DOWN, DOWN, SPACE, DOWN, DOWN, SPACE, ENTER];
    const outcome = await run(['--dry-run'], { read, keys, answers: ['y'] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.recorded.asked).toEqual([]);
    expect(outcome.recorded.git).toEqual([]);
    expect(outcome.stdout).toContain(WIP_WITHHELD);
    expect(outcome.stdout).toContain(`git worktree remove ${WT_WIP.path}`);
    expect(outcome.stdout).not.toContain('git branch -D wip');
  });

  it('still asks about an unheld Not-pushed row ticked beside it, in a run and under --dry-run', async () => {
    const read = reading({ notPushed: [NOT_PUSHED, SPARE_NOT_PUSHED], worktrees: [WT_CLEAN, WT_WIP] });
    const keys = [DOWN, DOWN, DOWN, GROUP, DOWN, DOWN, DOWN, SPACE, ENTER];
    const real = await run([], { read, keys, answers: ['y', 'y'] });
    const dry = await run(['--dry-run'], { read, keys, answers: ['y'] });
    expect(real.recorded.asked).toEqual([notPushedQuestion(SPARE_NOT_PUSHED), cleanupQuestion(3, 2, 0)]);
    expect(gitLines(real.recorded)).toContain('branch -D spare');
    expect(gitLines(real.recorded)).not.toContain('branch -D wip');
    expect(real.stdout).toContain(WIP_WITHHELD);
    expect(dry.recorded.asked).toEqual([notPushedQuestion(SPARE_NOT_PUSHED)]);
    expect(dry.stdout).toContain('git branch -D spare');
    expect(dry.stdout).toContain(WIP_WITHHELD);
  });

  it('deletes a ticked Stale row with -D on the final yes alone', async () => {
    const outcome = await run([], { keys: [DOWN, DOWN, SPACE, ENTER], answers: ['y'] });
    expect(outcome.recorded.asked).toEqual([cleanupQuestion(3, 1, 0)]);
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

  it('removes a ticked run record and its events file on the final yes, counting it in the question', async () => {
    const row = plantedRun();
    const outcome = await run([], { read: reading({ runs: [row] }), keys: [ENTER], answers: ['y'] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.recorded.asked).toEqual([cleanupQuestion(2, 1, 1)]);
    expect(gitLines(outcome.recorded)).toEqual(DEFAULT_STEPS);
    expect(outcome.stdout).toContain(`✓ rm ${row.path} ${String(row.eventsPath)}`);
    expect(existsSync(row.path)).toBe(false);
    expect(existsSync(String(row.eventsPath))).toBe(false);
  });

  it('keeps the run record when the final question is answered n (control)', async () => {
    const row = plantedRun();
    const outcome = await run([], { read: reading({ runs: [row] }), keys: [ENTER], answers: ['n'] });
    expect(outcome.recorded.asked).toEqual([cleanupQuestion(2, 1, 1)]);
    expect(existsSync(row.path)).toBe(true);
    expect(existsSync(String(row.eventsPath))).toBe(true);
  });

  it('keeps a run record unticked in the checklist, and leaves it out of the question', async () => {
    const row = plantedRun();
    const outcome = await run([], { read: reading({ runs: [row] }), keys: [UP, SPACE, ENTER], answers: ['y'] });
    expect(outcome.recorded.asked).toEqual([cleanupQuestion(2, 1, 0)]);
    expect(existsSync(row.path)).toBe(true);
  });

  it('prints the run record\'s rm line under --dry-run and removes nothing', async () => {
    const row = plantedRun();
    const outcome = await run(['--dry-run'], { read: reading({ runs: [row] }), keys: [ENTER] });
    expect(outcome.recorded.asked).toEqual([]);
    expect(outcome.stdout).toContain(`rm ${row.path} ${String(row.eventsPath)}`);
    expect(existsSync(row.path)).toBe(true);
    expect(existsSync(String(row.eventsPath))).toBe(true);
  });

  it('asks over a reading whose only rows are run records', async () => {
    const outcome = await run([], { read: reading({ merged: [], stale: [], notPushed: [], worktrees: [], runs: [RUN] }), keys: [ESCAPE] });
    expect(outcome.recorded.keysOpened).toBe(1);
    expect(outcome.stdout).not.toContain(NOTHING_LISTED_TEXT);
    expect(outcome.stdout).toContain(NOTHING_REMOVED_TEXT);
  });

  it('leaves an Only on origin row unticked on Enter: no push runs, and the question counts none on origin', async () => {
    const outcome = await run([], { read: reading({ remoteOnly: [REMOTE_ONLY] }), keys: [UP, ENTER], answers: ['y'] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.recorded.asked).toEqual([cleanupQuestion(2, 1, 0, 0)]);
    expect(outcome.recorded.asked[0]).toContain('and 0 branches on origin');
    expect(gitLines(outcome.recorded)).toEqual(DEFAULT_STEPS);
    expect(outcome.written()).toContain(`  Only on origin\n❯ ◯ ${remoteOnlyRowLine(REMOTE_ONLY)}`);
    expect(outcome.written()).not.toContain(`◉ ${remoteOnlyRowLine(REMOTE_ONLY)}`);
  });

  it('deletes a ticked Only on origin row on origin after the local branches, on the final yes alone (control)', async () => {
    const outcome = await run([], { read: reading({ remoteOnly: [REMOTE_ONLY] }), keys: [UP, SPACE, ENTER], answers: ['y'] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.recorded.asked).toEqual([cleanupQuestion(2, 1, 0, 1)]);
    expect(outcome.recorded.asked[0]).toContain('Delete 2 local branches and 1 branch on origin,');
    expect(gitLines(outcome.recorded)).toEqual([...DEFAULT_STEPS, REMOTE_PUSH]);
    expect(outcome.stdout).toContain(`✓ git ${REMOTE_PUSH}`);
    expect(outcome.written()).toContain(`❯ ◉ ${remoteOnlyRowLine(REMOTE_ONLY)}`);
    expect(outcome.recorded.git.map((args) => forcedFlagRefusal(args))).toEqual([null, null, null, null]);
  });

  it('pushes nothing for the ticked row when the final question is answered n (control)', async () => {
    const outcome = await run([], { read: reading({ remoteOnly: [REMOTE_ONLY] }), keys: [UP, SPACE, ENTER], answers: ['n'] });
    expect(outcome.recorded.asked).toEqual([cleanupQuestion(2, 1, 0, 1)]);
    expect(outcome.recorded.git).toEqual([]);
    expect(outcome.stdout).toContain(NOTHING_REMOVED_TEXT);
  });

  it('ticks the whole Only on origin group with a, and counts each row on origin', async () => {
    const read = reading({ remoteOnly: [REMOTE_COPIED, REMOTE_ONLY] });
    const outcome = await run([], { read, keys: [UP, GROUP, ENTER], answers: ['y'] });
    expect(outcome.recorded.asked).toEqual([cleanupQuestion(2, 1, 0, 2)]);
    expect(gitLines(outcome.recorded)).toEqual([...DEFAULT_STEPS, 'push origin --delete fix/old', REMOTE_PUSH]);
  });

  it('asks over a reading whose only rows are branches only on origin, and counts nothing local', async () => {
    const read = reading({ merged: [], stale: [], notPushed: [], worktrees: [], remoteOnly: [REMOTE_ONLY] });
    const unticked = await run([], { read, keys: [ENTER] });
    const ticked = await run([], { read, keys: [SPACE, ENTER], answers: ['y'] });
    expect(unticked.recorded.keysOpened).toBe(1);
    expect(unticked.recorded.promptersOpened).toBe(0);
    expect(unticked.recorded.git).toEqual([]);
    expect(unticked.stdout).not.toContain(NOTHING_LISTED_TEXT);
    expect(unticked.stdout).toContain(NOTHING_REMOVED_TEXT);
    expect(ticked.recorded.asked).toEqual([cleanupQuestion(0, 0, 0, 1)]);
    expect(gitLines(ticked.recorded)).toEqual([REMOTE_PUSH]);
  });

  it('prints the push of a ticked Only on origin row under --dry-run, and no push for an unticked one', async () => {
    const read = reading({ remoteOnly: [REMOTE_ONLY] });
    const ticked = await run(['--dry-run'], { read, keys: [UP, SPACE, ENTER], answers: ['y'] });
    const unticked = await run(['--dry-run'], { read, keys: [ENTER], answers: ['y'] });
    expect(ticked.exitCode).toBe(0);
    expect(ticked.recorded.asked).toEqual([]);
    expect(ticked.stdout).toContain([...DEFAULT_STEPS, REMOTE_PUSH].map((line) => `git ${line}`).join('\n'));
    expect(unticked.stdout).toContain(DEFAULT_STEPS.map((line) => `git ${line}`).join('\n'));
    expect(unticked.stdout).not.toContain('git push');
    expect([...ticked.recorded.git, ...unticked.recorded.git]).toEqual([]);
  });

  it('withholds a ticked Only on origin row whose name opens with a dash, naming the line to run by hand', async () => {
    const dash: RemoteOnlyRow = { ...REMOTE_ONLY, name: '-f' };
    const outcome = await run([], { read: reading({ remoteOnly: [dash] }), keys: [UP, SPACE, ENTER], answers: ['y'] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.recorded.asked).toEqual([cleanupQuestion(2, 1, 0, 0)]);
    expect(gitLines(outcome.recorded)).toEqual(DEFAULT_STEPS);
    expect(outcome.stdout).toContain('not removed: -f: ');
    expect(outcome.stdout).toContain('git push origin --delete -- -f');
  });

  it('exits 1 naming the push when origin refuses the delete, the local steps still run', async () => {
    const outcome = await run([], {
      read: reading({ remoteOnly: [REMOTE_ONLY] }),
      keys: [UP, SPACE, ENTER],
      answers: ['y'],
      gitAnswer: (args) => (args[0] === 'push'
        ? { ok: false, stdout: '', stderr: 'error: unable to delete \'fix/replaced\': remote ref does not exist' }
        : undefined),
    });
    expect(outcome.exitCode).toBe(1);
    expect(gitLines(outcome.recorded)).toEqual([...DEFAULT_STEPS, REMOTE_PUSH]);
    expect(outcome.stdout).toContain(`✗ git ${REMOTE_PUSH}: error: unable to delete 'fix/replaced': remote ref does not exist`);
    expect(outcome.stderr).toContain('1 step of 4 did not run clean');
  });

  it('asks nothing over a reading with no row', async () => {
    const outcome = await run([], { read: reading({ merged: [], stale: [], notPushed: [], worktrees: [] }), keys: [ENTER] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.recorded.keysOpened).toBe(0);
    expect(outcome.stdout).toContain(NOTHING_LISTED_TEXT);
  });
});

describe('rafa cleanup listing only', () => {
  it('prints the six groups with no terminal, exiting 0 and removing nothing', async () => {
    const row = plantedRun();
    const read = reading({ runs: [row], remoteOnly: [REMOTE_ONLY, REMOTE_COPIED] });
    const outcome = await run([], { read, isTTY: false, keys: [ENTER], answers: ['y'] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe(`${renderCleanup(read).join('\n')}\n`);
    expect(outcome.stdout).toContain('Run records (1)');
    expect(outcome.stdout).toContain('Only on origin (2)');
    expect(outcome.stdout).toContain('  fix/replaced  2026-09-20  2 of 3 commits with no patch-equal copy on origin/main');
    expect(outcome.stdout).toContain('  fix/old       2026-09-20  every commit has a patch-equal copy on origin/main (2 commits)');
    expect(existsSync(row.path)).toBe(true);
    expect(outcome.recorded.keysOpened).toBe(0);
    expect(outcome.recorded.promptersOpened).toBe(0);
    expect(outcome.recorded.git).toEqual([]);
  });

  it('prints the same listing under --dry-run with no terminal', async () => {
    const read = reading({ remoteOnly: [REMOTE_ONLY] });
    const plain = await run([], { read, isTTY: false });
    const dry = await run(['--dry-run'], { read, isTTY: false });
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout).toBe(plain.stdout);
    expect(dry.stdout).toContain('Only on origin (1)');
    expect(dry.stdout).not.toContain('git push origin --delete fix/replaced');
    expect(dry.recorded.git).toEqual([]);
  });

  it('gives the groups as the result data under --output=json, asking nothing even with a terminal', async () => {
    const read = reading({ runs: [RUN], remoteOnly: [REMOTE_ONLY] });
    const outcome = await run(['--output=json'], { read, keys: [ENTER], answers: ['y'] });
    expect(outcome.exitCode).toBe(0);
    const events = eventsOf(outcome.stdout);
    const result = events.at(-1);
    expect(result?.type).toBe('result');
    expect(JSON.stringify(result)).toContain(JSON.stringify(cleanupData(read)));
    expect(JSON.stringify(result)).toContain('"runs":[{"sessionId":"a1b2c3d4"');
    expect(JSON.stringify(result)).toContain('"remoteOnly":[{"name":"fix/replaced","lastCommit":"2026-09-20T08:30:00.000Z","commits":3,"uncopied":2,');
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
      worktreeDir: join('.rafa', 'worktrees'),
      release: { fragments: '.changes', changelog: 'CHANGELOG.md' },
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

  it('names the Only on origin group in its summary, its description and the --dry-run example', () => {
    const command = createCleanupCommand();
    expect(command.summary).toContain('unmerged branches only on origin');
    expect(command.description).toContain('in six groups');
    expect(command.description).toContain('Only on origin (a branch `origin` holds and this clone does not');
    expect(command.description).toContain('an Only on origin row never');
    expect(command.description).toContain('`Delete <n> local branches and <o> branches on origin, remove <m> worktrees and remove <r> run records? [y/N]`');
    expect(command.description).toContain('`git push origin --delete <name>` for each ticked Only on origin branch');
    expect(command.description).not.toContain('nothing remote is deleted');
    expect(command.description).not.toContain('five groups');
    const dryRun = command.examples.find((example) => example.cmd === 'rafa cleanup --dry-run');
    expect(dryRun?.note).toContain('a ticked Only on origin branch as its `git push origin --delete <name>`');
    expect(command.examples.map((example) => example.note).join(' ')).not.toContain('five groups');
  });
});
