/**
 * Tests for the settle follow-up as `rafa pr merge` prints it
 * (`merge-followups.ts`, gathered by `merge-cleanup.ts`), dispatched
 * through the real command over a real repository: a bare `origin.git`
 * and a work tree under a HOME of this file's own, git isolated from
 * the operator's config as `merge-driven.test.ts` isolates it.
 *
 * The provider is the one stub, and its `merge` is made real enough to
 * land the branch: it pushes the head branch onto the base as a
 * fast-forward, so the clean-up's `git pull` brings the branch's
 * fragment onto `origin/main` exactly as a merge on GitHub would.
 *
 * The pull request closes an issue and `gh` fails every call, so the
 * unblock reading warns: the case that names settle reads it as the
 * last line of the whole run, after that warning, and not merely the
 * last `info`. Beside it sit its controls over the same shape of world:
 * a branch whose fragment is `level: none`, and a world whose release
 * does not run, both of which merge and name no settle.
 *
 * `merge.test.ts` is past 800 lines, so these cases live here, beside
 * the module they cover.
 */
import type { MergeSeams, PrMergeResult } from './merge.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { GitResult, GitRunner, PullRequestDetail } from '../../pr/index.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createPullRequestsDouble } from '../../pr/pull-requests-double.js';
import { dispatchInProject, eventsOf, plantProjectConfig } from '../../tests/cli-capture.js';
import { gitIdentityEnv } from '../../tests/git-identity.js';

import { createPrMergeCommand } from './merge.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-merge-settle-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** A config naming the GitHub CLI, so no origin remote needs probing. */
const GH_CONFIG = 'pr:\n  provider: gh\n';

/** The base branch. */
const BASE = 'main';

/** The head branch, and its pull request. */
const BRANCH = 'feat/settled';

/** The pull request number every case names. */
const NUMBER = 41;

/** The clock the guard's forecast is dated by. */
const NOW = new Date('2026-09-29T12:00:00Z');

/** The line the settle follow-up prints for the minor fragment the branch lands. */
const SETTLE_LINE = '   rafa release settle — 1 fragment waits on main and folds into 0.25.0';

/** A world this case owns. */
interface SettleRepo {
  readonly work: string;
  readonly home: string;
}

/** Runs real git in `cwd`, isolated under `home`. */
function git(cwd: string, home: string, ...args: readonly string[]): GitResult {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      ...gitIdentityEnv(),
      LC_ALL: 'C',
    },
  });
  return { ok: result.status === 0, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() };
}

/** Runs git and fails the case where it did not work. */
function must(cwd: string, home: string, ...args: readonly string[]): void {
  const result = git(cwd, home, ...args);
  expect([args.join(' '), result.ok, result.stderr]).toEqual([args.join(' '), true, result.stderr]);
}

/** A fragment's text. */
function fragment(plan: string, level: string): string {
  return ['---', `plan: ${plan}`, `title: ${plan} title`, `level: ${level}`, '---', '', '- loop: a change', ''].join('\n');
}

/** Commits `files` on the branch checked out in `repo` and pushes it. */
function commitAndPush(repo: SettleRepo, branch: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo.work, path)), { recursive: true });
    writeFileSync(join(repo.work, path), text, 'utf8');
  }
  must(repo.work, repo.home, 'add', '-A');
  must(repo.work, repo.home, 'commit', '-q', '-m', `on ${branch}`);
  must(repo.work, repo.home, 'push', '-q', '-u', 'origin', branch);
}

/**
 * Plants the base at 0.24.0 — with a changelog unless `changelog` is
 * false, so `release.enabled: auto` reads on — forks {@link BRANCH}
 * off it adding one source file and a fragment at `level`, and leaves
 * the work tree on the base, clean.
 */
function plantWorld(level: string, changelog = true): SettleRepo {
  const root = realpathSync(mkdtempSync(join(tempBase, 'repo-')));
  const repo = { work: join(root, 'work'), home: join(root, 'home') };
  const bare = join(root, 'origin.git');
  mkdirSync(repo.home, { recursive: true });
  must(root, repo.home, 'init', '-q', '--bare', `--initial-branch=${BASE}`, bare);
  must(root, repo.home, 'init', '-q', `--initial-branch=${BASE}`, repo.work);
  must(repo.work, repo.home, 'remote', 'add', 'origin', bare);
  const first: Record<string, string> = {
    '.gitignore': '.rafa/\n',
    'package.json': '{\n  "name": "demo",\n  "version": "0.24.0"\n}\n',
  };
  const withChangelog = changelog
    ? { ...first, 'CHANGELOG.md': '# Changelog\n\n## 0.24.0 — 2026-09-28, a plan\n\n- loop: the first note\n' }
    : first;
  commitAndPush(repo, BASE, withChangelog);
  must(repo.work, repo.home, 'switch', '-q', '-c', BRANCH);
  commitAndPush(repo, BRANCH, { 'src/a.ts': 'export const a = 1;\n', '.changes/rafa-1.md': fragment('rafa-1', level) });
  must(repo.work, repo.home, 'switch', '-q', BASE);
  plantProjectConfig(repo.work, GH_CONFIG);
  return repo;
}

/** A pull request detail for {@link BRANCH} into {@link BASE}, closing an issue. */
function detail(): PullRequestDetail {
  return {
    number: NUMBER,
    title: 'a merge that leaves a fragment',
    url: `https://github.com/open-tomato/rafa/pull/${NUMBER}`,
    state: 'open',
    headRefName: BRANCH,
    baseRefName: BASE,
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-18T11:00:00Z',
    body: 'Closes #20',
    headRefOid: '1f0c2b7de6a94c1a0b5e3d2f4a6b8c0d1e2f3a4b',
    mergeable: 'mergeable',
    mergeStateStatus: 'CLEAN',
    labels: [],
  };
}

/** A `gh` that fails every call, so the tick and the unblock reading warn. */
const BROKEN_GH: GhRunner = () => Promise.resolve({ ok: false, stdout: '', stderr: 'gh: Not Found (HTTP 404)' });

/** One json-mode event, as far as these cases read it. */
interface ReadEvent {
  readonly type: string;
  readonly level?: string;
  readonly message?: string;
  readonly data?: PrMergeResult;
}

/** What one run left. */
interface SettleRun {
  readonly exitCode: number | null;
  /** Every log line, `info` and `warn` alike, in the order written. */
  readonly logged: readonly string[];
  /** The ids of the result's follow-ups. */
  readonly followUps: readonly string[];
}

/**
 * Dispatches `rafa pr merge <n> --yes --output=json --no-hint` over
 * `repo`, the stub's merge pushing the head onto the base.
 */
async function ran(repo: SettleRepo): Promise<SettleRun> {
  const stub = createPullRequestsDouble({
    get: () => Promise.resolve(detail()),
    checks: () => Promise.resolve({ rows: [], verdict: 'green' as const }),
    merge: () => {
      must(repo.work, repo.home, 'push', '-q', 'origin', `${BRANCH}:${BASE}`);
      return Promise.resolve({ merged: true, detail: 'Merged by fast-forward' });
    },
  }, { refusal: 'the stub provider models get, checks and merge alone' });
  const runner = (root: string): GitRunner => (args) => git(root, repo.home, ...args);
  const seams: MergeSeams = {
    pullRequests: () => stub.pulls,
    git: runner,
    gh: () => BROKEN_GH,
    isTerminal: () => false,
    now: () => NOW,
  };
  const project: PlantedProject = { root: repo.work, home: repo.home };
  const line = ['pr', 'merge', String(NUMBER), '--yes', '--output=json', '--no-hint'];
  const run = await dispatchInProject(line, SUBJECTS, [createPrMergeCommand(seams)], project);
  const events = eventsOf(run.stdout) as unknown as readonly ReadEvent[];
  const result = events.find((event) => event.type === 'result');
  return {
    exitCode: run.exitCode,
    logged: events.filter((event) => event.type === 'log').map((event) => event.message ?? ''),
    followUps: (result?.data?.followUps ?? []).map((followUp) => followUp.id),
  };
}

describe('the settle follow-up', () => {
  it('prints rafa release settle as the last line, after the unblock reading, where the merge left a fragment waiting', async () => {
    const run = await ran(plantWorld('minor'));

    expect(run.exitCode).toBe(0);
    expect(run.followUps).toEqual(['release-settle']);
    expect(run.logged.slice(-2)).toEqual(['Follow-ups:', SETTLE_LINE]);
    const unblockWarning = run.logged.findIndex((message) => message.startsWith('the blocked-issue reading'));
    expect(unblockWarning).toBeGreaterThan(-1);
    expect(unblockWarning).toBeLessThan(run.logged.indexOf(SETTLE_LINE));
  });

  it('names no settle where the fragment the merge left is level none, since settle would commit nothing', async () => {
    const run = await ran(plantWorld('none'));

    expect(run.exitCode).toBe(0);
    expect(run.followUps).toEqual([]);
    expect(run.logged.some((message) => message.includes('rafa release settle'))).toBe(false);
  });

  it('names no settle where the release does not run, over a branch that lands a shipping fragment', async () => {
    const run = await ran(plantWorld('minor', false));

    expect(run.exitCode).toBe(0);
    expect(run.followUps).toEqual([]);
    expect(run.logged.some((message) => message.includes('rafa release settle'))).toBe(false);
  });
});
