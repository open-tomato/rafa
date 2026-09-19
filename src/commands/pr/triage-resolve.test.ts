/**
 * Tests for `rafa pr triage --resolve` (`triage-resolve.ts`), driven
 * through the registered command: the worktree, the pinned plan and its
 * budget, the CI wait, the comment, the dependabot note and the exit
 * codes.
 *
 * Every case dispatches the command from a project and a home of its
 * own under this file's temporary directory (`tests/cli-capture.ts`),
 * over the recorded `gh` fake (`pr/gh-fake.ts`). Nothing here reaches
 * GitHub, spawns `gh`, spawns git or spawns a loop: the provider is the
 * adapter over the fake, git is a stub that answers `merge-tree` and
 * the three worktree commands, and the loop is a stand-in that records
 * what it was handed and plants on the fake whatever the attempt is to
 * have left behind. The CI wait's clock and sleep are seams, so no case
 * waits 20 seconds.
 *
 * ## What the cases are FOR
 *
 * Each of these fails silently rather than loudly if it is wrong, so
 * each has a case that measures it and a control that could have caught
 * the opposite reading:
 *
 *   - **The plan really carries the budget.** A session spawned without
 *     `--max-budget-usd` runs uncapped and reports nothing about it. The
 *     case reads the plan file the run wrote off disk and asserts the
 *     `budget=` of `pr.resolveBudget` on its task lines; the project's
 *     config names a budget that is NOT the default, so a run reading
 *     the default would fail the case.
 *   - **The worktree is added and removed.** The stub git records every
 *     argv, so the case reads the `worktree add` and the `worktree
 *     remove` off that log rather than off a message. `--force` is
 *     asserted absent, since a removal that forced would still read as
 *     removed.
 *   - **The attempt guard really stops.** Two endings are driven, and
 *     they are different endings on purpose: an attempt that pushes
 *     nothing stops on the REPEAT reading, and two attempts that each
 *     leave a different simple class stop on the CAP. Both assert exit
 *     3, the updated comment, the removed worktree and the follow-up
 *     prompt.
 *   - **A resolve run that fixed the pull request exits 0.** Its
 *     control is the stop cases: the same command, the same seams, a
 *     different stand-in loop.
 */
import type { TriageSeams } from './triage.js';
import type { RafaCommand } from '../../cli/command.js';
import type { FakePrGh, FakePullRequestSeed } from '../../pr/gh-fake.js';
import type { GitResult, GitRunner } from '../../pr/index.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGhPermissions } from '../../board/trust.js';
import { createFakePrGh, logFailedText } from '../../pr/gh-fake.js';
import { createGhPullRequests } from '../../pr/index.js';
import { resolveWorktreePath } from '../../pr/worktree.js';
import { dispatchInProject, plantProject } from '../../tests/cli-capture.js';

import { resolveRunDir } from './resolve-loop.js';
import { DEPENDABOT_REBASE_NOTE } from './triage-resolve.js';
import { createPrTriageCommand } from './triage.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-resolve-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** A config naming the GitHub CLI and a resolve budget that is not the default. */
const GH_CONFIG = 'pr:\n  provider: gh\n  resolveBudget: 0.75\n';

/** The budget that config names, as a plan spells it. */
const BUDGET_ENTRY = 'budget=0.75';

/** An `origin` on github.com, in the spelling git writes for an SSH remote. */
const GITHUB_ORIGIN = 'git@github.com:open-tomato/rafa.git';

/** The branch the seams answer. */
const BRANCH = 'feat/pr-41';

/** The instant every assessment is stamped with, so no case reads a clock. */
const NOW = '2026-09-19T09:00:00Z';

/** The Actions run a failing check points at. */
const RUN_ID = '9006';

/** The `--log-failed` capture of a lint failure, in the recorded TAB shape. */
const LINT_LOG = logFailedText('gates', [
  '##[group]Run bunx eslint .',
  '##[error]Process completed with exit code 1.',
]);

/** A failing `gates` check pointing at {@link RUN_ID}. */
const FAILING_GATES = {
  name: 'gates',
  state: 'FAILURE',
  link: `https://github.com/open-tomato/rafa/actions/runs/${RUN_ID}/job/1`,
};

/** A passing `gates` check. */
const PASSING_GATES = { ...FAILING_GATES, state: 'SUCCESS' };

/**
 * The record separator the `-z` merge-tree output uses, built from its
 * codepoint so this source carries no control byte of its own.
 */
const NUL = String.fromCharCode(0);

/** A merged tree OID, which is what a conflicted merge-tree stdout opens with. */
const OID = '0'.repeat(40);

/** The login a planted pull request carries when its seed names no author. */
const PULL_AUTHOR = 'octo';

/** The login the recorded fake writes a comment as. */
const FAKE_COMMENT_AUTHOR = 'rafa-fake';

/** A pull request with a lockfile conflict and no checks, which is `conflict-lockfile`. */
const CONFLICTED_41: FakePullRequestSeed = {
  number: 41,
  title: 'rafa-20: pull request commands',
  headRefName: BRANCH,
  checks: [],
  mergeable: 'CONFLICTING',
  mergeStateStatus: 'DIRTY',
};

/** Every git argv a run sent, and the runner that recorded them. */
interface StubGit {
  readonly runner: GitRunner;
  readonly sent: () => readonly (readonly string[])[];
}

/** A git stub answering `merge-tree` with `files`, and the worktree commands as `worktrees` says. */
function stubGit(files: () => readonly string[], worktrees = true): StubGit {
  const sent: string[][] = [];
  const runner: GitRunner = (args): GitResult => {
    sent.push([...args]);
    if (args[0] === 'rev-parse') return { ok: true, stdout: '', stderr: '' };
    if (args[0] === 'worktree' && args[1] === 'list') return { ok: true, stdout: '', stderr: '' };
    if (args[0] === 'worktree') {
      return worktrees
        ? { ok: true, stdout: '', stderr: '' }
        : { ok: false, stdout: '', stderr: `fatal: '${BRANCH}' is already used by worktree at '/elsewhere'` };
    }
    if (args[0] === 'merge-tree') {
      return { ok: false, stdout: [OID, ...files(), '', ''].join(NUL), stderr: '' };
    }
    return { ok: false, stdout: '', stderr: 'stub git: not answered' };
  };
  return { runner, sent: () => sent.map((args) => [...args]) };
}

/** What one attempt's stand-in loop was handed. */
interface LoopCall {
  readonly worktree: string;
  readonly planPath: string;
}

/** What a case varies about the run. */
interface CaseOptions {
  /** The pull requests planted on the fake. */
  readonly seeds: readonly FakePullRequestSeed[];
  /** What `git merge-tree` names as conflicting, read afresh on each call. */
  readonly files?: () => readonly string[];
  /** What each attempt's loop does to the pull request, by attempt number from 1. */
  readonly attempt?: (fake: FakePrGh, attempt: number) => void;
  /** False for a git that refuses to add the worktree. */
  readonly worktrees?: boolean;
  /** What each sleep of the CI wait does to the pull request, by poll number from 1. */
  readonly onSleep?: (fake: FakePrGh, slept: number) => void;
  /** The words after `pr triage`. */
  readonly words?: readonly string[];
  /**
   * The logins the repository gives write access to. The pull request's
   * own author and the account the fake comments as when left out,
   * which is what lets a run start at all (`./triage-trust.ts`).
   */
  readonly trusted?: readonly string[];
  /** A permission per login for the accounts that hold no write access. */
  readonly reading?: Readonly<Record<string, string>>;
}

/** What one dispatched run left behind. */
interface Ran {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly fake: FakePrGh;
  readonly git: StubGit;
  readonly loops: readonly LoopCall[];
  /** How many times the CI wait slept. */
  readonly slept: () => number;
  readonly project: PlantedProject;
}

/** Dispatches `rafa pr triage --resolve` over the fake, the stub git and a stand-in loop. */
async function resolved(options: CaseOptions): Promise<Ran> {
  const fake = createFakePrGh({ now: () => NOW });
  for (const seed of options.seeds) fake.plant(seed);
  fake.plantRun(RUN_ID, LINT_LOG);
  for (const login of options.trusted ?? [PULL_AUTHOR, FAKE_COMMENT_AUTHOR]) {
    fake.plantPermission(login, 'admin');
  }
  for (const [login, permission] of Object.entries(options.reading ?? {})) {
    fake.plantPermission(login, permission);
  }
  const git = stubGit(options.files ?? ((): readonly string[] => ['bun.lock']), options.worktrees ?? true);
  const loops: LoopCall[] = [];
  let slept = 0;
  const project = plantProject(mkdtempSync(join(tempBase, 'case-')), GH_CONFIG);
  const seams: TriageSeams = {
    pullRequests: () => createGhPullRequests({ gh: fake.run }),
    readBranch: () => BRANCH,
    readRemote: () => GITHUB_ORIGIN,
    git: () => git.runner,
    now: () => NOW,
    permissions: () => createGhPermissions({ gh: fake.run }),
    clock: () => 0,
    sleep: async () => {
      slept += 1;
      options.onSleep?.(fake, slept);
    },
    runLoop: async (run) => {
      loops.push({ worktree: run.worktree, planPath: run.planPath });
      options.attempt?.(fake, loops.length);
      return { ok: true, exitCode: 0, argv: ['loop', 'start'], problem: null };
    },
  };
  const command: RafaCommand = createPrTriageCommand(seams);
  const words = options.words ?? ['41', '--resolve'];
  const run = await dispatchInProject(['pr', 'triage', ...words], SUBJECTS, [command], project);
  return { ...run, fake, git, loops, slept: () => slept, project };
}

/** Every git argv of `name`, as one line each. */
function gitLines(git: StubGit, name: string): readonly string[] {
  return git.sent()
    .filter((args) => args[0] === name)
    .map((args) => args.join(' '));
}

/** The body of the triage comment on pull request 41. */
function commentBody(fake: FakePrGh): string {
  return fake.pull(41)?.comments.at(-1)?.body ?? '';
}

/** The attempt that resolves the conflict: a new head, mergeable, and green checks. */
function fixesIt(fake: FakePrGh): void {
  fake.update(41, (pull) => ({
    ...pull,
    headRefOid: '1'.repeat(40),
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    checks: [PASSING_GATES],
  }));
}

describe('a resolve run that fixed the pull request', () => {
  it('adds the worktree, runs the plan, waits on the checks and exits 0', async () => {
    const outcome = await resolved({ seeds: [CONFLICTED_41], attempt: fixesIt });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.loops).toHaveLength(1);
    expect(gitLines(outcome.git, 'worktree')).toEqual([
      'worktree list --porcelain',
      `worktree add ${resolveWorktreePath(outcome.project.home, 41)} ${BRANCH}`,
      `worktree remove ${resolveWorktreePath(outcome.project.home, 41)}`,
    ]);
    expect(outcome.stdout).toContain('is green after 1 of 2 resolve attempts');
  });

  it('runs the loop in the worktree over a plan written outside it', async () => {
    const outcome = await resolved({ seeds: [CONFLICTED_41], attempt: fixesIt });
    const call = outcome.loops[0];

    expect(call?.worktree).toBe(resolveWorktreePath(outcome.project.home, 41));
    expect(call?.planPath).toBe(join(
      resolveRunDir(outcome.project.home, 41, 1),
      'resolve-conflict-lockfile.md',
    ));
    expect(call?.planPath.startsWith(`${call.worktree}/`)).toBe(false);
  });

  it('writes the pinned plan filled from the triage and capped at pr.resolveBudget', async () => {
    const outcome = await resolved({ seeds: [CONFLICTED_41], attempt: fixesIt });
    const plan = readFileSync(outcome.loops[0]?.planPath ?? '', 'utf8');

    expect(plan).toContain('# Plan: Resolve lockfile conflict');
    expect(plan).toContain('`bun.lock`');
    expect(plan).not.toContain('{CONFLICT_FILES}');
    const tasks = plan.split('\n').filter((line) => line.startsWith('- ['));
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.filter((line) => line.includes(BUDGET_ENTRY))).toHaveLength(tasks.length);
  });

  it('leaves one triage comment saying it was resolved, and removes the worktree without --force', async () => {
    const outcome = await resolved({ seeds: [CONFLICTED_41], attempt: fixesIt });

    expect(outcome.fake.pull(41)?.comments).toHaveLength(1);
    expect(commentBody(outcome.fake)).toContain('resolved');
    expect(commentBody(outcome.fake)).toContain('attempts: 1');
    expect(gitLines(outcome.git, 'worktree').some((line) => line.includes('--force'))).toBe(false);
  });
});

describe('the attempt guard', () => {
  it('stops on an attempt that ends as the one before it, exit 3, prompt and comment', async () => {
    const outcome = await resolved({ seeds: [CONFLICTED_41] });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.loops).toHaveLength(2);
    expect(outcome.stderr).toContain('rafa pr triage --resolve gave up on #41');
    expect(outcome.stdout).toContain('the same reading as the run before it');
    expect(outcome.stdout).toContain('# Assessed pull request: act on this triage');
    expect(gitLines(outcome.git, 'worktree').at(-1))
      .toBe(`worktree remove ${resolveWorktreePath(outcome.project.home, 41)}`);
    expect(commentBody(outcome.fake)).toContain('attempts: 2');
  });

  it('stops at the cap when each attempt left a different simple class, exit 3', async () => {
    let head = 1;
    const files = (): readonly string[] => (head % 2 === 0
      ? ['package.json']
      : ['bun.lock']);
    const outcome = await resolved({
      seeds: [CONFLICTED_41],
      files,
      attempt: (fake) => {
        head += 1;
        fake.update(41, (pull) => ({ ...pull, headRefOid: String(head).repeat(40) }));
      },
    });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.loops).toHaveLength(2);
    expect(outcome.stdout).toContain('2 of 2 resolve attempts spent');
    expect(outcome.stdout).toContain('rafa pr triage --resolve gave up on #41');
    expect(outcome.stdout).toContain(`Removed the worktree at ${resolveWorktreePath(outcome.project.home, 41)}`);
    expect(gitLines(outcome.git, 'worktree').at(-1))
      .toBe(`worktree remove ${resolveWorktreePath(outcome.project.home, 41)}`);
  });

  it('spends the attempts a --max-attempts of 1 allows and no more', async () => {
    const outcome = await resolved({ seeds: [CONFLICTED_41], words: ['41', '--resolve', '--max-attempts=1'] });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.loops).toHaveLength(1);
    expect(outcome.stdout).toContain('1 of 1 resolve attempts spent');
    expect(commentBody(outcome.fake)).toContain('attempts: 1');
  });

  it('writes a plan for each attempt, in a directory of its own', async () => {
    const outcome = await resolved({ seeds: [CONFLICTED_41] });
    const dirs = outcome.loops.map((call) => call.planPath);

    expect(new Set(dirs).size).toBe(2);
    expect(readdirSync(join(outcome.project.home, '.rafa', 'resolve', 'pr-41')).sort())
      .toEqual(['attempt-1', 'attempt-2']);
  });
});

describe('the order inside one attempt', () => {
  it('raises the attempt count in the comment before the loop is run', async () => {
    const seen: string[] = [];
    const outcome = await resolved({
      seeds: [CONFLICTED_41],
      attempt: (fake, attempt) => {
        seen.push(commentBody(fake));
        if (attempt === 1) fixesIt(fake);
      },
    });

    expect(outcome.exitCode).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('attempts: 1');
  });

  it('refuses with exit 1 and spends no attempt when git will not add the worktree', async () => {
    const outcome = await resolved({ seeds: [CONFLICTED_41], worktrees: false });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('could not be added, so no resolve run was started');
    expect(outcome.stderr).toContain('is already used by worktree');
    expect(outcome.loops).toEqual([]);
    expect(commentBody(outcome.fake)).toContain('attempts: 0');
  });

  it('waits on the checks after the attempt, polling until they settle', async () => {
    const outcome = await resolved({
      seeds: [CONFLICTED_41],
      attempt: (fake) => {
        fake.update(41, (pull) => ({
          ...pull,
          headRefOid: '1'.repeat(40),
          mergeable: 'MERGEABLE',
          mergeStateStatus: 'CLEAN',
          checks: [{ ...FAILING_GATES, state: 'IN_PROGRESS' }],
        }));
      },
      onSleep: (fake) => {
        fake.update(41, (pull) => ({ ...pull, checks: [PASSING_GATES] }));
      },
    });

    expect(outcome.slept()).toBe(1);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('Checks are pending after 0s');
    expect(outcome.stdout).toContain('is green after 1 of 2 resolve attempts');
  });

  it('stops with exit 3 when the attempt left a class no pinned plan resolves', async () => {
    const outcome = await resolved({
      seeds: [CONFLICTED_41],
      attempt: (fake) => {
        fake.update(41, (pull) => ({
          ...pull,
          headRefOid: '1'.repeat(40),
          mergeable: 'MERGEABLE',
          mergeStateStatus: 'CLEAN',
          checks: [FAILING_GATES],
        }));
      },
    });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.loops).toHaveLength(1);
    expect(outcome.stdout).toContain('which no pinned plan resolves');
    expect(gitLines(outcome.git, 'worktree').at(-1))
      .toBe(`worktree remove ${resolveWorktreePath(outcome.project.home, 41)}`);
  });
});

describe('what --resolve does not run', () => {
  it('runs nothing for a class no pinned plan resolves, and exits 0', async () => {
    const outcome = await resolved({
      seeds: [{ ...CONFLICTED_41, checks: [FAILING_GATES], mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' }],
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.loops).toEqual([]);
    expect(outcome.stdout).toContain('which is not simple, so --resolve ran nothing');
    expect(gitLines(outcome.git, 'worktree')).toEqual([]);
  });

  it('refuses a cross-repository pull request with exit code 2 and makes no worktree', async () => {
    const outcome = await resolved({ seeds: [{ ...CONFLICTED_41, isCrossRepository: true }] });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('is on a fork');
    expect(outcome.loops).toEqual([]);
    expect(gitLines(outcome.git, 'worktree')).toEqual([]);
  });

  it('refuses a pull request whose author holds no write access, with exit 2 and no worktree', async () => {
    const outcome = await resolved({
      seeds: [{ ...CONFLICTED_41, author: { login: 'stranger', isBot: false, name: 'A Stranger' } }],
      trusted: [FAKE_COMMENT_AUTHOR],
      reading: { stranger: 'read' },
    });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain(
      'pull request #41 was opened by stranger, who has no write access to open-tomato/rafa;'
        + ' a member must open the pull request',
    );
    expect(outcome.loops).toEqual([]);
    expect(gitLines(outcome.git, 'worktree')).toEqual([]);
  });

  it('runs for a dependabot pull request, which holds no write access either', async () => {
    const outcome = await resolved({
      seeds: [{ ...CONFLICTED_41, author: { login: 'dependabot[bot]', isBot: true, name: 'dependabot' } }],
      trusted: [FAKE_COMMENT_AUTHOR],
      attempt: fixesIt,
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.loops).toHaveLength(1);
  });

  it('refuses --resolve beside --no-comment, which has nowhere to raise the count', async () => {
    const outcome = await resolved({ seeds: [CONFLICTED_41], words: ['41', '--resolve', '--no-comment'] });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('--resolve writes the attempt count into the triage comment');
    expect(outcome.loops).toEqual([]);
  });

  it('refuses more than one red candidate with exit code 2, listing the command for each', async () => {
    const outcome = await resolved({
      seeds: [
        { ...CONFLICTED_41, headRefName: 'feat/other-41', checks: [FAILING_GATES] },
        { number: 42, headRefName: 'feat/pr-42', checks: [FAILING_GATES], updatedAt: NOW },
      ],
      words: ['--resolve'],
    });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('rafa pr triage --resolve refuses');
    expect(outcome.stderr).toContain('rafa pr triage 42 --resolve');
    expect(outcome.loops).toEqual([]);
  });
});

describe('a dependabot branch', () => {
  it('is told in the comment that dependabot will not rebase it again', async () => {
    const outcome = await resolved({
      seeds: [{
        ...CONFLICTED_41,
        author: { login: 'dependabot[bot]', isBot: true },
        title: 'chore(deps): bump bun-types',
      }],
      attempt: fixesIt,
    });

    expect(outcome.exitCode).toBe(0);
    expect(commentBody(outcome.fake)).toContain(DEPENDABOT_REBASE_NOTE);
  });

  it('is the only branch told so, where a human author gets no such note', async () => {
    const outcome = await resolved({ seeds: [CONFLICTED_41], attempt: fixesIt });

    expect(commentBody(outcome.fake)).not.toContain('Dependabot stops');
  });
});
