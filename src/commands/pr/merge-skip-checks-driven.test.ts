/**
 * `rafa pr merge --skip-checks` driven over the `gh` fake
 * (`src/pr/gh-fake.ts`) and a real scratch git repository with a bare
 * remote standing in for GitHub — the same shape
 * `triage-resolve-driven.test.ts` uses for `pr triage --resolve` and
 * `merge-driven.test.ts` uses for `pr merge`.
 *
 * `merge-skip-checks.test.ts` already proves the flag's own logic over a
 * stub provider and a stub `git`: this file proves that a REAL provider
 * built on `createGhPullRequests`, reading REAL `gh pr checks` and
 * `gh api .../actions/workflows` JSON the fake renders, and REAL git run
 * over an actual work tree and bare `origin.git`, drive the same command
 * to the same refusals and the same merges. Only `gh` itself stays a
 * fake — GitHub is out of scope for a repository test — and git is never
 * stubbed: every `MergeSeams.git` call reaches real git, isolated from
 * the operator's own `~/.gitconfig` the way `merge-driven.test.ts`'s
 * module note describes.
 *
 * This file carries the refusal cases: a pull request whose checks read
 * pending, red or green refuses `--skip-checks` itself, naming the check
 * row; `--yes` is refused where a workflow exists; and the command
 * refuses without a terminal and without `--yes`. Each case reads the
 * fake's own pull request back afterwards to prove nothing was merged —
 * `state` stays `OPEN` and no `pr merge` command reached the fake — the
 * same control `merge-skip-checks.test.ts`'s own module note asks for.
 * The merging cases live in the same file, in a later task.
 */
import type { MergeSeams } from './merge.js';
import type { FakePrCheck, FakePullRequestSeed, FakeWorkflow } from '../../pr/gh-fake.js';
import type { GitResult, GitRunner } from '../../pr/index.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createFakePrGh } from '../../pr/gh-fake.js';
import { createGhPullRequests } from '../../pr/index.js';
import { WORKFLOWS_EXIST_WARNING } from '../../pr/unchecked.js';
import { dispatchInProject, plantProjectConfig } from '../../tests/cli-capture.js';

import { createPrMergeCommand } from './merge.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-merge-skip-driven-')));

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
const BRANCH = 'feat/merge-skip-checks-driven';

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
  /** The commit `BRANCH` was left at, which the planted pull request's `headRefOid` matches. */
  readonly headOid: string;
}

/**
 * Plants a work tree on {@link BASE} with one commit, pushed to a bare
 * `origin.git` beside it, then {@link BRANCH} off it with one more
 * commit, pushed too and left checked out — the same shape
 * `merge-driven.test.ts`'s own `plantMergeRepo` builds.
 */
function plantMergeRepo(name: string): MergeRepo {
  const root = realpathSync(mkdtempSync(join(tempBase, name)));
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

  const headOid = git(work, home, 'rev-parse', BRANCH).stdout;
  return { root, work, bare, home, headOid };
}

/** The pull request seed every case plants, on the real branch and commit `repo` carries. */
function seed(repo: MergeRepo, over: Partial<FakePullRequestSeed> = {}): FakePullRequestSeed {
  return {
    number: NUMBER,
    title: 'a driven skip-checks merge',
    headRefName: BRANCH,
    headRefOid: repo.headOid,
    ...over,
  };
}

/** One pending check row named `name`, in the state `gh pr checks` reports while a run is going. */
function pending(name: string): FakePrCheck {
  return { name, state: 'IN_PROGRESS', link: `https://github.com/open-tomato/rafa/actions/runs/1/job/${name}` };
}

/** One failed check row named `name`. */
function failed(name: string): FakePrCheck {
  return { name, state: 'FAILURE', link: `https://github.com/open-tomato/rafa/actions/runs/1/job/${name}` };
}

/** One passing check row named `name`. */
function passed(name: string): FakePrCheck {
  return { name, state: 'SUCCESS', link: `https://github.com/open-tomato/rafa/actions/runs/1/job/${name}` };
}

/** One workflow the repository defines, for the `workflows-exist` case. */
const ONE_WORKFLOW: readonly FakeWorkflow[] = [{ name: 'CI' }];

/** Typed by every case here, so no case composes the real sources for the ending hint. */
const NO_HINT = '--no-hint';

/** What one driven run left, over real git, the real fake `gh` and the real command output. */
interface DrivenRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Every question the prompter was asked, in order. */
  readonly asked: readonly string[];
}

/**
 * Dispatches `rafa pr merge <words>` in-process over `repo`'s work tree,
 * with the real `MergeSeams.git` seam, the real `gh` fake behind
 * `createGhPullRequests`, and a prompter answering `answer`; `y` unless a
 * case says otherwise. `terminal` false models a machine with no
 * terminal to ask on.
 */
async function ran(
  repo: MergeRepo,
  fake: ReturnType<typeof createFakePrGh>,
  words: readonly string[],
  options: { readonly answer?: string | null; readonly terminal?: boolean } = {},
): Promise<DrivenRun> {
  const asked: string[] = [];
  const seams: MergeSeams = {
    pullRequests: () => createGhPullRequests({ gh: fake.run }),
    git: scratchGitRunner(repo.home),
    isTerminal: () => options.terminal ?? true,
    openPrompter: () => ({
      say: () => undefined,
      ask: (question: string) => {
        asked.push(question);
        return Promise.resolve(Object.hasOwn(options, 'answer')
          ? options.answer ?? null
          : 'y');
      },
      close: () => undefined,
    }),
  };
  const command = createPrMergeCommand(seams);
  const project: PlantedProject = { root: repo.work, home: repo.home };
  const run = await dispatchInProject(['pr', 'merge', ...words, NO_HINT], SUBJECTS, [command], project);
  return { exitCode: run.exitCode, stdout: run.stdout, stderr: run.stderr, asked };
}

/** The commands the fake was sent, without `pr merge` filtered separately below. */
function mergeCommandsSent(fake: ReturnType<typeof createFakePrGh>): readonly (readonly string[])[] {
  return fake.calls().filter((call) => call[0] === 'pr' && call[1] === 'merge');
}

describe('a pull request that reports checks, refused before anything is asked', () => {
  it('refuses one pending check, naming it, and merges nothing', async () => {
    const repo = plantMergeRepo('pending');
    const fake = createFakePrGh();
    fake.plant(seed(repo, { checks: [pending('integration-tests')] }));

    const run = await ran(repo, fake, [String(NUMBER), '--skip-checks', '--yes']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('--skip-checks is only for a PR that reports no checks at all');
    expect(run.stderr).toContain('(pending)');
    expect(run.stderr).toContain('integration-tests');
    expect(mergeCommandsSent(fake)).toEqual([]);
    expect(fake.pull(NUMBER)?.state).toBe('OPEN');
  });

  it('refuses a red check, naming the verdict, and merges nothing', async () => {
    const repo = plantMergeRepo('red');
    const fake = createFakePrGh();
    fake.plant(seed(repo, { checks: [failed('lint')] }));

    const run = await ran(repo, fake, [String(NUMBER), '--skip-checks', '--yes']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('--skip-checks is only for a PR that reports no checks at all');
    expect(run.stderr).toContain('(red)');
    expect(run.stderr).toContain('lint');
    expect(mergeCommandsSent(fake)).toEqual([]);
    expect(fake.pull(NUMBER)?.state).toBe('OPEN');
  });

  it('refuses a green check, naming the verdict, and merges nothing', async () => {
    const repo = plantMergeRepo('green');
    const fake = createFakePrGh();
    fake.plant(seed(repo, { checks: [passed('unit-tests')] }));

    const run = await ran(repo, fake, [String(NUMBER), '--skip-checks', '--yes']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('--skip-checks is only for a PR that reports no checks at all');
    expect(run.stderr).toContain('(green)');
    expect(run.stderr).toContain('unit-tests');
    expect(mergeCommandsSent(fake)).toEqual([]);
    expect(fake.pull(NUMBER)?.state).toBe('OPEN');
  });
});

describe('an unchecked merge refused before the question, over the real workflow count', () => {
  it('refuses --yes where one real workflow exists, naming the warning, and merges nothing', async () => {
    const repo = plantMergeRepo('yes-workflow');
    const fake = createFakePrGh();
    fake.plant(seed(repo, { checks: [] }));
    fake.plantWorkflows(ONE_WORKFLOW);

    const run = await ran(repo, fake, [String(NUMBER), '--skip-checks', '--yes']);

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain(`refuses --yes for #${NUMBER} with no checks`);
    expect(run.stderr).toContain(WORKFLOWS_EXIST_WARNING);
    expect(fake.calls()).toContainEqual(['api', 'repos/{owner}/{repo}/actions/workflows']);
    expect(mergeCommandsSent(fake)).toEqual([]);
    expect(fake.pull(NUMBER)?.state).toBe('OPEN');
  });

  it('refuses with no terminal and no --yes, writing nothing to stdout, and merges nothing', async () => {
    const repo = plantMergeRepo('no-terminal');
    const fake = createFakePrGh();
    fake.plant(seed(repo, { checks: [] }));

    const run = await ran(repo, fake, [String(NUMBER), '--skip-checks'], { terminal: false });

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('standard input is no terminal');
    expect(mergeCommandsSent(fake)).toEqual([]);
    expect(fake.pull(NUMBER)?.state).toBe('OPEN');
  });
});
