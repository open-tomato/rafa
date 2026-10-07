/**
 * Tests for which untracked paths `rafa pr merge` refuses on
 * (`./merge-refuse.ts`; the rule is `src/pr/merge.ts`'s, "Which
 * untracked paths refuse"), driven over real git: a scratch clone of a
 * local bare origin holding `main` and a pull request branch that adds
 * `added.txt`, and a scripted provider that answers get, checks and merge.
 *
 *  - An untracked `.claude/settings.local.json` neither incoming tree
 *    holds merges, with one line naming it, and stays on disk.
 *  - An untracked `added.txt`, which the pull request's head adds,
 *    refuses with the dirty-tree message and merges nothing.
 *  - A modified tracked file refuses too, so the untracked rule did not
 *    loosen the tracked one.
 */
import type { MergeSeams } from './merge.js';
import type { PullRequestDetail } from '../../pr/index.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createPullRequestsDouble } from '../../pr/pull-requests-double.js';
import { dispatchInProject, plantProjectConfig } from '../../tests/cli-capture.js';

import { createPrMergeCommand } from './merge.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-merge-untracked-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];
const CONFIG = 'pr:\n  provider: gh\n';
const BRANCH = 'feat/rafa-30-added';
const SETTINGS = '.claude/settings.local.json';

/** Runs git in `cwd`, throwing with what it said when it fails. */
function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

interface Scratch {
  readonly root: string;
  readonly home: string;
  readonly headOid: string;
}

/** A clone on `main` of a bare origin that also holds {@link BRANCH}, adding `added.txt`. */
function plantScratch(): Scratch {
  const scope = mkdtempSync(join(tempBase, 'case-'));
  const origin = join(scope, 'origin.git');
  const seed = join(scope, 'seed');
  const root = join(scope, 'project');
  const home = join(scope, 'home');
  mkdirSync(home);
  git(scope, 'init', '--bare', '-b', 'main', origin);
  git(scope, 'clone', origin, seed);
  git(seed, 'checkout', '-b', 'main');
  writeFileSync(join(seed, 'tracked.txt'), 'one\n');
  // A tracked file beside the settings keeps git from folding them into `.claude/`.
  mkdirSync(join(seed, '.claude'));
  writeFileSync(join(seed, '.claude', 'shared.md'), 'shared\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-m', 'base');
  git(seed, 'push', 'origin', 'main');
  git(seed, 'checkout', '-b', BRANCH);
  writeFileSync(join(seed, 'added.txt'), 'added\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-m', 'add');
  git(seed, 'push', 'origin', BRANCH);
  const headOid = git(seed, 'rev-parse', 'HEAD');
  git(scope, 'clone', '-b', 'main', origin, root);
  git(root, 'fetch', 'origin', BRANCH);
  plantProjectConfig(root, CONFIG);
  writeFileSync(join(root, '.git', 'info', 'exclude'), '.rafa/\n', { flag: 'a' });
  return { root, home, headOid };
}

function detail(headOid: string): PullRequestDetail {
  return {
    number: 41,
    title: 'rafa-30: added',
    url: 'https://github.com/acme/board/pull/41',
    state: 'open',
    headRefName: BRANCH,
    baseRefName: 'main',
    author: { login: 'octo', isBot: false },
    isCrossRepository: false,
    updatedAt: '2026-09-30T11:00:00Z',
    body: 'Adds a file.',
    headRefOid: headOid,
    mergeable: 'mergeable',
    mergeStateStatus: 'CLEAN',
    labels: [],
    closes: [],
  };
}

/** Plants `path` with `text` under `root`. */
function plant(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** Dispatches `rafa pr merge 41 --yes --no-hint` in a scratch after `prepare` ran in its clone. */
async function merged(prepare: (root: string) => void): Promise<{ exitCode: number | null; out: string; merges: number; root: string }> {
  const scratch = plantScratch();
  prepare(scratch.root);
  let merges = 0;
  const pulls = createPullRequestsDouble({
    get: () => Promise.resolve(detail(scratch.headOid)),
    checks: () => Promise.resolve({ rows: [], verdict: 'green' }),
    merge: () => {
      merges += 1;
      return Promise.resolve({ merged: true, detail: 'Squashed and merged pull request #41' });
    },
  }, { refusal: 'the scripted provider models get, checks and merge alone' });
  const seams: MergeSeams = {
    pullRequests: () => pulls.pulls,
    readBranch: () => 'main',
    readRemote: () => 'git@github.com:acme/board.git',
    isTerminal: () => true,
  };
  const run = await dispatchInProject(['pr', 'merge', '41', '--yes', '--no-hint'], SUBJECTS, [createPrMergeCommand(seams)], scratch);
  return { exitCode: run.exitCode, out: `${run.stdout}\n${run.stderr}`, merges, root: scratch.root };
}

describe('rafa pr merge over a scratch clone and a local bare origin', () => {
  it('merges past an untracked file neither incoming tree holds, names it in one line and leaves it', async () => {
    const run = await merged((root) => plant(root, SETTINGS, '{}\n'));

    expect(run.exitCode).toBe(0);
    expect(run.merges).toBe(1);
    const lines = run.out.split('\n').filter((line) => line.includes('Leaving the untracked'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(SETTINGS);
    expect(readFileSync(join(run.root, SETTINGS), 'utf8')).toBe('{}\n');
  });

  it('refuses an untracked file the pull request\'s head adds, with the dirty-tree message', async () => {
    const run = await merged((root) => plant(root, 'added.txt', 'mine\n'));

    expect(run.exitCode).toBe(1);
    expect(run.merges).toBe(0);
    expect(run.out).toContain('the working tree has 1 change');
    expect(run.out).toContain('?? added.txt');
    expect(run.out).not.toContain('Leaving the untracked');
    expect(readFileSync(join(run.root, 'added.txt'), 'utf8')).toBe('mine\n');
  });

  it('still refuses a modified tracked file', async () => {
    const run = await merged((root) => plant(root, 'tracked.txt', 'changed\n'));

    expect(run.exitCode).toBe(1);
    expect(run.merges).toBe(0);
    expect(run.out).toContain('the working tree has 1 change');
    expect(run.out).toContain('M tracked.txt');
    expect(existsSync(join(run.root, 'tracked.txt'))).toBe(true);
  });
});
