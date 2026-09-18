/**
 * `rafa pr merge` driven over a real git repository with a bare remote
 * standing in for GitHub: every refusal `readMergeRefusal` reads off real
 * git, the question answered `y`, each clean-up step observed in git
 * afterwards, and a real git failure injected into the clean-up.
 *
 * `merge.test.ts`'s own module note names this file: it proves the
 * command's logic against a planted answer per git command and a stub
 * provider, and promises that "the task after this one drives the same
 * command over a real repository with a bare remote." This is that file.
 * Only the pull request PROVIDER stays a stub — GitHub itself is out of
 * scope for a repository test, and `merge.test.ts` already proves what
 * this action sends it — so `merge 41 squash` is recorded and never
 * actually run; every git command after it is real, spawned by the same
 * `MergeSeams.git` seam the registered command runs through, over an
 * actual working tree and an actual bare remote.
 *
 * {@link plantMergeRepo} plants a work tree and a bare `origin.git`
 * beside it under a HOME of this file's own. `git`'s global and system
 * config are pointed at that HOME (`GIT_CONFIG_GLOBAL`,
 * `GIT_CONFIG_NOSYSTEM`), so no case here reads the operator's real
 * `~/.gitconfig` — the same isolation `src/pr/none.test.ts` uses for
 * `pushBranch`. The base branch (`main`) and the head branch
 * (`feat/merge-driven`) each carry one commit, both pushed to the bare
 * remote, and the work tree is left checked out on the head branch: the
 * ordinary shape of an operator about to merge their own feature branch.
 *
 * The failure case diverges `main` on both sides of the remote — a local
 * commit `work` never pushes, and a different one pushed from a second
 * clone of the same bare repository — so `git pull --ff-only` fails for a
 * REAL reason (`fatal: Not possible to fast-forward, aborting.`, measured
 * on git 2.51 under macOS with `LC_ALL=C`) rather than an injected
 * answer, and the case reads git afterwards to prove the branches sit
 * exactly where the failure left them: `switch-base` ran, so the
 * checkout moved to `main`, and everything from `pull-base` on — the
 * local delete, the remote delete and the prune — never touched a byte,
 * which is what "the merge is left alone" means in git rather than in a
 * message.
 */
import type { MergeSeams } from './merge.js';
import type {
  ChecksReading,
  GitResult,
  GitRunner,
  MergeOutcome,
  PullRequestDetail,
  PullRequests,
} from '../../pr/index.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { dispatchInProject, plantProjectConfig } from '../../tests/cli-capture.js';

import { createPrMergeCommand, summaryLine } from './merge.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-merge-driven-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** A config naming the GitHub CLI, so no origin remote needs probing. */
const GH_CONFIG = 'pr:\n  provider: gh\n';

/** The base branch of every case's repository. */
const BASE = 'main';

/** The head branch of every case's repository, and its pull request. */
const BRANCH = 'feat/merge-driven';

/** The pull request number every case names on the line. */
const NUMBER = 41;

/** Runs real git in `cwd`, isolated from the operator's real HOME; see the module note. */
function git(cwd: string, home: string, ...args: readonly string[]): GitResult {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'rafa test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'rafa test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
      LC_ALL: 'C',
    },
  });
  return { ok: result.status === 0, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() };
}

/** The `MergeSeams.git` seam over real git, isolated the same way {@link git} is. */
function scratchGitRunner(home: string): (root: string) => GitRunner {
  return (root) => (args) => git(root, home, ...args);
}

/** A repository this case owns: a work tree and a bare `origin.git`, both under one HOME. */
interface MergeRepo {
  /** Where every case's setup happens: `work` and `origin.git` sit under it. */
  readonly root: string;
  /** The work tree, which is the project the command dispatches over. */
  readonly work: string;
  /** The bare repository playing `origin`. */
  readonly bare: string;
  /** The HOME every git call here is isolated under. */
  readonly home: string;
}

/**
 * Plants a work tree on {@link BASE} with one commit, pushed to a bare
 * `origin.git` beside it, then {@link BRANCH} off it with one more
 * commit, pushed too and left checked out — see the module note.
 */
function plantMergeRepo(): MergeRepo {
  const root = realpathSync(mkdtempSync(join(tempBase, 'repo-')));
  const work = join(root, 'work');
  const bare = join(root, 'origin.git');
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });

  expect(git(root, home, 'init', '-q', '--bare', `--initial-branch=${BASE}`, bare).ok).toBe(true);
  expect(git(root, home, 'init', '-q', `--initial-branch=${BASE}`, work).ok).toBe(true);
  // `.rafa/` is ignored from the first commit, so planting the project's
  // config after does not itself dirty the tree `readMergeRefusal` reads.
  writeFileSync(join(work, '.gitignore'), '.rafa/\n', 'utf8');
  writeFileSync(join(work, 'README.md'), 'first\n', 'utf8');
  expect(git(work, home, 'add', '.gitignore', 'README.md').ok).toBe(true);
  expect(git(work, home, 'commit', '-q', '-m', 'first').ok).toBe(true);
  expect(git(work, home, 'remote', 'add', 'origin', bare).ok).toBe(true);
  expect(git(work, home, 'push', '-q', '-u', 'origin', BASE).ok).toBe(true);
  expect(git(work, home, 'switch', '-q', '-c', BRANCH).ok).toBe(true);
  writeFileSync(join(work, 'feature.txt'), 'a feature\n', 'utf8');
  expect(git(work, home, 'add', 'feature.txt').ok).toBe(true);
  expect(git(work, home, 'commit', '-q', '-m', 'feature').ok).toBe(true);
  expect(git(work, home, 'push', '-q', '-u', 'origin', BRANCH).ok).toBe(true);
  plantProjectConfig(work, GH_CONFIG);

  return { root, work, bare, home };
}

/** A pull request detail as a stub answers one, filled from `over`. */
function detail(over: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    number: NUMBER,
    title: 'a driven merge',
    url: `https://github.com/open-tomato/rafa/pull/${NUMBER}`,
    state: 'open',
    headRefName: BRANCH,
    baseRefName: BASE,
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-18T11:00:00Z',
    body: '',
    headRefOid: '1f0c2b7de6a94c1a0b5e3d2f4a6b8c0d1e2f3a4b',
    mergeable: 'mergeable',
    mergeStateStatus: 'CLEAN',
    labels: [],
    ...over,
  };
}

/** What a stub provider answers for the members this action can send. */
interface StubAnswers {
  readonly get?: () => Promise<PullRequestDetail | null>;
  readonly checks?: () => Promise<ChecksReading>;
  readonly merge?: () => Promise<MergeOutcome>;
}

/** A stub provider, and the log of every member it was sent; GitHub itself is out of scope here. */
interface StubPulls {
  readonly pulls: PullRequests;
  readonly sent: () => readonly string[];
}

/** A provider answering `get`, `checks` and `merge`, refusing every other call and recording each. */
function stubPulls(answers: StubAnswers = {}): StubPulls {
  const sent: string[] = [];
  const refuse = (name: string) => (): Promise<never> => {
    sent.push(name);
    return Promise.reject(new Error('the stub provider models get, checks and merge alone'));
  };
  const pulls: PullRequests = {
    kind: 'gh',
    findOpen: refuse('findOpen'),
    list: refuse('list'),
    get: (number: number) => {
      sent.push(`get ${number}`);
      return answers.get === undefined
        ? Promise.resolve(detail())
        : answers.get();
    },
    checks: (number: number) => {
      sent.push(`checks ${number}`);
      return answers.checks === undefined
        ? Promise.resolve({ rows: [], verdict: 'green' as const })
        : answers.checks();
    },
    browse: refuse('browse'),
    merge: (number: number, method: string) => {
      sent.push(`merge ${number} ${method}`);
      return answers.merge === undefined
        ? Promise.resolve({ merged: true, detail: 'Squashed and merged pull request' })
        : answers.merge();
    },
    comments: refuse('comments'),
    comment: refuse('comment'),
    editComment: refuse('editComment'),
    failedLog: refuse('failedLog'),
  };
  return { pulls, sent: () => [...sent] };
}

/** What one driven run left, over real git and the real command output. */
interface DrivenRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly lines: readonly string[];
  /** Every question the prompter was asked, in order. */
  readonly asked: readonly string[];
}

/**
 * Dispatches `rafa pr merge` in-process over `repo`'s work tree, with the
 * real `MergeSeams.git` seam and `pulls` the one stub in this file; see
 * the module note. `answer` is what the question is answered with, `y`
 * unless a case says otherwise.
 */
async function ran(repo: MergeRepo, pulls: PullRequests, words: readonly string[], answer: string | null = 'y'): Promise<DrivenRun> {
  const asked: string[] = [];
  const seams: MergeSeams = {
    pullRequests: () => pulls,
    git: scratchGitRunner(repo.home),
    isTerminal: () => true,
    openPrompter: () => ({
      say: () => undefined,
      ask: (question: string) => {
        asked.push(question);
        return Promise.resolve(answer);
      },
      close: () => undefined,
    }),
  };
  const command = createPrMergeCommand(seams);
  const project: PlantedProject = { root: repo.work, home: repo.home };
  const run = await dispatchInProject(['pr', 'merge', ...words], SUBJECTS, [command], project);
  return {
    exitCode: run.exitCode,
    stdout: run.stdout,
    stderr: run.stderr,
    lines: run.stdout.split('\n').filter((line) => line !== ''),
    asked,
  };
}

describe('what it refuses, read off a real repository', () => {
  it('refuses a dirty working tree, listing what git wrote, and merges nothing', async () => {
    const repo = plantMergeRepo();
    writeFileSync(join(repo.work, 'stray.txt'), 'oops\n', 'utf8');
    const stub = stubPulls();

    const run = await ran(repo, stub.pulls, [String(NUMBER)]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('rafa pr merge refuses: the working tree has 1 change.');
    expect(run.stderr).toContain('?? stray.txt');
    expect(stub.sent()).toEqual([`get ${NUMBER}`, `checks ${NUMBER}`]);
    expect(run.asked).toEqual([]);
    // Nothing was touched: the stray file is exactly where it was left.
    expect(git(repo.work, repo.home, 'status', '--porcelain').stdout).toBe('?? stray.txt');
  });

  it('refuses a pull request GitHub reports as conflicting, leaving the branch untouched', async () => {
    const repo = plantMergeRepo();
    const stub = stubPulls({
      get: () => Promise.resolve(detail({ mergeable: 'conflicting', mergeStateStatus: 'DIRTY' })),
    });

    const run = await ran(repo, stub.pulls, [String(NUMBER)]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`#${NUMBER} does not merge into ${BASE} — GitHub says conflicting (DIRTY)`);
    expect(run.stderr).toContain(`Run rafa pr triage ${NUMBER} to see why.`);
    expect(stub.sent()).not.toContain(`merge ${NUMBER} squash`);
    expect(git(repo.work, repo.home, 'rev-parse', '--abbrev-ref', 'HEAD').stdout).toBe(BRANCH);
  });

  it('refuses a pull request whose checks are red, naming the verdict', async () => {
    const repo = plantMergeRepo();
    const stub = stubPulls({ checks: () => Promise.resolve({ rows: [], verdict: 'red' as const }) });

    const run = await ran(repo, stub.pulls, [String(NUMBER)]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`#${NUMBER} is not green — its checks failed (red)`);
    expect(stub.sent()).not.toContain(`merge ${NUMBER} squash`);
  });

  it('refuses a head branch checked out in another worktree, naming the command that frees it', async () => {
    const repo = plantMergeRepo();
    // The clean-up would delete BRANCH, so it has to be free: switch this
    // checkout to the base and hold BRANCH in a second worktree instead,
    // which is the only way git allows the same branch two places at once.
    expect(git(repo.work, repo.home, 'switch', '-q', BASE).ok).toBe(true);
    const elsewhere = join(repo.root, 'elsewhere');
    expect(git(repo.work, repo.home, 'worktree', 'add', '-q', elsewhere, BRANCH).ok).toBe(true);
    const stub = stubPulls();

    const run = await ran(repo, stub.pulls, [String(NUMBER)]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`branch ${BRANCH} is checked out in another worktree`);
    expect(run.stderr).toContain(`git worktree remove ${elsewhere}`);
    expect(stub.sent()).not.toContain(`merge ${NUMBER} squash`);
    // Still there: the refusal only named it, it never ran the remove.
    expect(git(repo.work, repo.home, 'worktree', 'list', '--porcelain').stdout).toContain(elsewhere);
  });
});

describe('the question answered y, and the clean-up observed in git', () => {
  it('asks Merge? [y/N], merges on y, and leaves git switched to the base with both branches gone', async () => {
    const repo = plantMergeRepo();
    const stub = stubPulls();
    const originBaseBefore = git(repo.bare, repo.home, 'rev-parse', BASE).stdout;

    const run = await ran(repo, stub.pulls, [String(NUMBER)]);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(run.asked).toEqual(['Merge? [y/N] ']);
    expect(run.lines[0]).toBe(summaryLine(detail(), 'squash'));
    expect(stub.sent()).toEqual([`get ${NUMBER}`, `checks ${NUMBER}`, `merge ${NUMBER} squash`]);
    expect(run.lines).toContain(`Merged #${NUMBER} into ${BASE} (squash).`);
    expect(run.lines).toContain(`switch to ${BASE}: done`);
    expect(run.lines).toContain(`pull ${BASE}, fast-forward only: done`);
    expect(run.lines).toContain(`delete the local branch ${BRANCH}: done`);
    expect(run.lines).toContain(`delete origin/${BRANCH}: done`);
    expect(run.lines).toContain('prune deleted remote branches: done');
    expect(run.lines.at(-1)).toBe(`${BASE} is checked out and pulled, and ${BRANCH} is gone locally and on origin.`);

    // Each step, read back from real git rather than from the report above.
    expect(git(repo.work, repo.home, 'rev-parse', '--abbrev-ref', 'HEAD').stdout).toBe(BASE);
    expect(git(repo.work, repo.home, 'rev-parse', BASE).stdout).toBe(originBaseBefore);
    expect(git(repo.work, repo.home, 'rev-parse', '--abbrev-ref', `${BASE}@{upstream}`).stdout).toBe(`origin/${BASE}`);
    expect(git(repo.work, repo.home, 'branch', '--list', BRANCH).stdout).toBe('');
    expect(git(repo.bare, repo.home, 'show-ref', '--verify', `refs/heads/${BRANCH}`).ok).toBe(false);
    expect(git(repo.work, repo.home, 'branch', '-r').stdout).not.toContain(`origin/${BRANCH}`);
  });
});

describe('a failure injected after the merge', () => {
  it('stops at the failing step, prints the rest as commands, and leaves the merge and the branches alone', async () => {
    const repo = plantMergeRepo();

    // Diverge `main` on both sides of the remote: a commit `work` never
    // pushes, and a different one pushed from a second clone. See the
    // module note for why this, and not a planted answer, fails the pull.
    expect(git(repo.work, repo.home, 'switch', '-q', BASE).ok).toBe(true);
    writeFileSync(join(repo.work, 'local-only.txt'), 'local\n', 'utf8');
    expect(git(repo.work, repo.home, 'add', 'local-only.txt').ok).toBe(true);
    expect(git(repo.work, repo.home, 'commit', '-q', '-m', 'local only').ok).toBe(true);
    expect(git(repo.work, repo.home, 'switch', '-q', BRANCH).ok).toBe(true);

    const other = join(repo.root, 'other');
    expect(git(repo.root, repo.home, 'clone', '-q', repo.bare, other).ok).toBe(true);
    expect(git(other, repo.home, 'switch', '-q', BASE).ok).toBe(true);
    writeFileSync(join(other, 'remote-only.txt'), 'remote\n', 'utf8');
    expect(git(other, repo.home, 'add', 'remote-only.txt').ok).toBe(true);
    expect(git(other, repo.home, 'commit', '-q', '-m', 'remote only').ok).toBe(true);
    expect(git(other, repo.home, 'push', '-q', 'origin', BASE).ok).toBe(true);

    const baseBefore = git(repo.work, repo.home, 'rev-parse', BASE).stdout;
    const branchBefore = git(repo.work, repo.home, 'rev-parse', BRANCH).stdout;
    const stub = stubPulls();

    const run = await ran(repo, stub.pulls, [String(NUMBER)]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`❌ pull ${BASE}, fast-forward only: failed`);
    expect(run.stderr).toContain('fatal: Not possible to fast-forward, aborting.');
    expect(run.stderr).toContain(`#${NUMBER} is merged, and the merge is left alone. Run the rest yourself:`);
    expect(run.stderr).toContain('git pull --ff-only');
    expect(run.stderr).toContain(`git branch -D ${BRANCH}`);
    expect(run.stderr).toContain(`git push origin --delete ${BRANCH}`);
    expect(run.stderr).toContain('git fetch --prune');
    expect(run.stderr).not.toContain('revert');
    expect(run.stderr).not.toContain('reset');
    expect(run.stderr).not.toContain('--force');
    // The merge itself did happen — it is the git clean-up after it that failed.
    expect(stub.sent()).toContain(`merge ${NUMBER} squash`);
    expect(run.lines).toContain(`Merged #${NUMBER} into ${BASE} (squash).`);
    expect(run.lines).toContain(`switch to ${BASE}: done`);

    // Left alone, in git: the switch ran, and nothing after `pull-base` did.
    expect(git(repo.work, repo.home, 'rev-parse', '--abbrev-ref', 'HEAD').stdout).toBe(BASE);
    expect(git(repo.work, repo.home, 'rev-parse', BASE).stdout).toBe(baseBefore);
    expect(git(repo.work, repo.home, 'rev-parse', BRANCH).stdout).toBe(branchBefore);
    expect(git(repo.work, repo.home, 'branch', '--list', BRANCH).stdout).toContain(BRANCH);
    expect(git(repo.bare, repo.home, 'show-ref', '--verify', `refs/heads/${BRANCH}`).ok).toBe(true);
  });
});
