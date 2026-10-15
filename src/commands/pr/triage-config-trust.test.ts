/**
 * The config trust rule of `rafa pr triage --resolve`
 * (`./triage-config-trust.ts`), read over REAL scratch git repositories:
 * the blob ids are git's own answers, never a stub's.
 *
 * `origin/main` is planted with `git update-ref` rather than a fetch, so
 * a case decides exactly what the base holds. Every reading that answers
 * nothing has a control beside it in which the same repository, changed
 * in the one way the rule is about, answers a drift — so an empty answer
 * is the rule passing, not a reader that cannot fire.
 *
 * The last block dispatches `pr triage --resolve` itself over a real
 * repository, the fake provider and a stand-in loop, to hold the call
 * site: refused before the worktree is added, and let through with one
 * warning line under `--allow-local-config`.
 */
import type { TriageSeams } from './triage.js';
import type { GitRunner } from '../../core/git/index.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import '../../adapter-registry.js';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGhPermissions } from '../../board/trust.js';
import { CommandExit } from '../../core/command/index.js';
import { createFakePrGh } from '../../pr/gh-fake.js';
import { createGhPullRequests, createGitRunner } from '../../pr/index.js';
import { resolveWorktreePath } from '../../pr/worktree.js';
import { dispatchInProject, plantProjectConfig } from '../../tests/cli-capture.js';

import {
  ALLOW_LOCAL_CONFIG_FLAG,
  CONFIG_TRUST_REFUSE_EXIT,
  headRevision,
  readConfigDrift,
  requireTrustedConfig,
} from './triage-config-trust.js';
import { createPrTriageCommand } from './triage.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-config-trust-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The base branch every planted repository targets. */
const BASE = 'main';

/** The head branch every planted repository carries. */
const BRANCH = 'feat/pr-12';

/** The pull request number every case names. */
const NUMBER = 12;

/** A config module's text. */
const CONFIG_TEXT = 'export default [{ naming: { branch: \'work/{stub}\' } }];\n';

/** What a planted repository holds on each side. */
interface Sides {
  /** Files the base commit holds, beside a README. */
  readonly base?: Readonly<Record<string, string>>;
  /** Files the head commit adds or changes on top of the base. */
  readonly head?: Readonly<Record<string, string>>;
  /** False to plant no `origin/main` at all. */
  readonly origin?: boolean;
}

/** One planted repository and its git. */
interface Planted {
  readonly work: string;
  readonly home: string;
  readonly git: GitRunner;
}

/** Writes and commits `files` on the branch checked out in `work`. */
function commitFiles(git: GitRunner, work: string, files: Readonly<Record<string, string>>, message: string): void {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(work, name), text, 'utf8');
  expect(git(['add', '--all']).ok).toBe(true);
  expect(git(['commit', '--quiet', '--allow-empty', '--message', message]).ok).toBe(true);
}

/** Plants a repository whose `main` and `feat/pr-12` hold what `sides` says. */
function plantRepo(name: string, sides: Sides = {}): Planted {
  const root = realpathSync(mkdtempSync(join(tempBase, `${name}-`)));
  const work = join(root, 'work');
  const home = join(root, 'home');
  mkdirSync(work, { recursive: true });
  mkdirSync(home, { recursive: true });
  const git = createGitRunner(work);
  expect(git(['init', '--quiet', `--initial-branch=${BASE}`, '.']).ok).toBe(true);
  git(['config', 'user.email', 'rafa@example.test']);
  git(['config', 'user.name', 'rafa test']);
  git(['config', 'commit.gpgsign', 'false']);
  commitFiles(git, work, { 'README.md': 'seed\n', ...sides.base }, 'base');
  if (sides.origin ?? true) expect(git(['update-ref', `refs/remotes/origin/${BASE}`, BASE]).ok).toBe(true);
  expect(git(['switch', '--quiet', '-c', BRANCH]).ok).toBe(true);
  commitFiles(git, work, sides.head ?? {}, 'head');
  expect(git(['switch', '--quiet', BASE]).ok).toBe(true);
  return { work, home, git };
}

/** The drift of the planted head against `origin/main`. */
function driftOf(planted: Planted): ReturnType<typeof readConfigDrift> {
  return readConfigDrift(planted.git, `refs/heads/${BRANCH}`, BASE);
}

describe('readConfigDrift', () => {
  it('answers nothing for a head holding no config module, and its control answers the planted one', () => {
    expect(driftOf(plantRepo('none'))).toEqual([]);

    const control = plantRepo('none-control', { head: { 'rafa.config.ts': CONFIG_TEXT } });
    expect(driftOf(control)).toEqual([{ file: 'rafa.config.ts', base: 'origin/main', reason: 'absent' }]);
  });

  it('answers nothing for a config the base holds as the same blob, and `differs` for one byte changed', () => {
    const same = plantRepo('same', { base: { 'rafa.config.ts': CONFIG_TEXT }, head: { 'other.txt': 'x\n' } });
    expect(driftOf(same)).toEqual([]);

    const changed = plantRepo('changed', {
      base: { 'rafa.config.ts': CONFIG_TEXT },
      head: { 'rafa.config.ts': `${CONFIG_TEXT} ` },
    });
    expect(driftOf(changed)).toEqual([{ file: 'rafa.config.ts', base: 'origin/main', reason: 'differs' }]);
  });

  it('reads `rafa.config.mjs` as well, and both when the head carries both', () => {
    const mjs = plantRepo('mjs', { head: { 'rafa.config.mjs': CONFIG_TEXT } });
    expect(driftOf(mjs)).toEqual([{ file: 'rafa.config.mjs', base: 'origin/main', reason: 'absent' }]);

    const both = plantRepo('both', {
      base: { 'rafa.config.ts': CONFIG_TEXT },
      head: { 'rafa.config.ts': `// changed\n${CONFIG_TEXT}`, 'rafa.config.mjs': CONFIG_TEXT },
    });
    expect(driftOf(both).map((drift) => [drift.file, drift.reason])).toEqual([
      ['rafa.config.ts', 'differs'],
      ['rafa.config.mjs', 'absent'],
    ]);
  });

  it('compares with `origin/main`, not the local `main`, and reads a missing `origin/main` as absent', () => {
    const local = plantRepo('local-only', { base: { 'rafa.config.ts': CONFIG_TEXT }, origin: false });
    expect(local.git(['rev-parse', '--verify', '--quiet', `${BASE}:rafa.config.ts`]).ok).toBe(true);

    expect(driftOf(local)).toEqual([{ file: 'rafa.config.ts', base: 'origin/main', reason: 'absent' }]);
  });

  it('ignores a YAML config beside them, which is data and not code', () => {
    const planted = plantRepo('yaml', { head: { 'rafa.config.yaml': 'pr:\n  provider: gh\n' } });

    expect(driftOf(planted)).toEqual([]);
  });
});

describe('headRevision', () => {
  it('takes the local branch first, then `origin/<branch>`, and answers null when neither is there', () => {
    const planted = plantRepo('head');
    expect(headRevision(planted.git, BRANCH)).toBe(`refs/heads/${BRANCH}`);

    expect(planted.git(['update-ref', `refs/remotes/origin/${BRANCH}`, BRANCH]).ok).toBe(true);
    expect(planted.git(['branch', '--quiet', '-D', BRANCH]).ok).toBe(true);
    expect(headRevision(planted.git, BRANCH)).toBe(`refs/remotes/origin/${BRANCH}`);

    expect(headRevision(planted.git, 'feat/never-pushed')).toBeNull();
  });
});

/** Runs the rule over `planted`, answering the thrown exit and the warnings. */
function checked(planted: Planted, allowLocalConfig: boolean): { thrown: CommandExit | null; warned: string[] } {
  const warned: string[] = [];
  try {
    requireTrustedConfig({
      git: planted.git,
      number: NUMBER,
      headRefName: BRANCH,
      baseRefName: BASE,
      allowLocalConfig,
      output: { warn: (line) => warned.push(line) },
    });
    return { thrown: null, warned };
  } catch (error) {
    if (error instanceof CommandExit) return { thrown: error, warned };
    throw error;
  }
}

describe('requireTrustedConfig', () => {
  it('refuses a head config absent from the base with exit 1, naming the file, the base and the flag', () => {
    const { thrown, warned } = checked(plantRepo('refuse', { head: { 'rafa.config.ts': CONFIG_TEXT } }), false);

    expect(thrown?.exitCode).toBe(CONFIG_TRUST_REFUSE_EXIT);
    expect(CONFIG_TRUST_REFUSE_EXIT).toBe(1);
    expect(thrown?.message).toContain('rafa.config.ts');
    expect(thrown?.message).toContain('origin/main');
    expect(thrown?.message).toContain(`--${ALLOW_LOCAL_CONFIG_FLAG}`);
    expect(thrown?.message).toContain(`#${String(NUMBER)}`);
    expect(warned).toEqual([]);
  });

  it('refuses a head config that differs from the base\'s, saying it differs', () => {
    const planted = plantRepo('refuse-differs', {
      base: { 'rafa.config.mjs': CONFIG_TEXT },
      head: { 'rafa.config.mjs': `${CONFIG_TEXT}// more\n` },
    });

    const { thrown } = checked(planted, false);

    expect(thrown?.exitCode).toBe(1);
    expect(thrown?.message).toContain('`rafa.config.mjs`, which differs from `origin/main`\'s');
  });

  it('lets the same head through under the flag with exactly one warning line', () => {
    const { thrown, warned } = checked(plantRepo('allow', { head: { 'rafa.config.ts': CONFIG_TEXT } }), true);

    expect(thrown).toBeNull();
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(`--${ALLOW_LOCAL_CONFIG_FLAG}`);
    expect(warned[0]).toContain('rafa.config.ts');
    expect(warned[0]).not.toContain('\n');
  });

  it('passes a head whose config is the base\'s silently, with or without the flag', () => {
    const planted = plantRepo('trusted', { base: { 'rafa.config.ts': CONFIG_TEXT }, head: { 'x.txt': 'x\n' } });

    expect(checked(planted, false)).toEqual({ thrown: null, warned: [] });
    expect(checked(planted, true)).toEqual({ thrown: null, warned: [] });
  });
});

/** The subject the command routes under. */
const SUBJECTS = [{ name: 'pr', summary: 'pull requests' }];

/** A config naming the GitHub CLI, so no origin remote needs probing. */
const GH_CONFIG = 'pr:\n  provider: gh\n';

/** The clock every comment is stamped with. */
const NOW = '2026-10-14T09:00:00Z';

/** What one dispatched resolve run left behind. */
interface Dispatched {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly loops: number;
  readonly worktree: string;
}

/**
 * Dispatches `pr triage 12 --resolve` over a repository whose head
 * carries `rafa.config.ts` and a red lint check, the fake provider and a
 * stand-in loop that pushes nothing.
 */
async function dispatched(name: string, extra: readonly string[]): Promise<Dispatched> {
  const planted = plantRepo(name, { head: { 'rafa.config.ts': CONFIG_TEXT } });
  plantProjectConfig(planted.work, GH_CONFIG);
  const fake = createFakePrGh({ now: () => NOW });
  fake.plant({
    number: NUMBER,
    title: 'a config-carrying head',
    headRefName: BRANCH,
    headRefOid: planted.git(['rev-parse', BRANCH]).stdout.trim(),
    checks: [],
    mergeable: 'CONFLICTING',
    mergeStateStatus: 'DIRTY',
  });
  for (const login of ['octo', 'rafa-fake']) fake.plantPermission(login, 'admin');
  let loops = 0;
  const seams: TriageSeams = {
    pullRequests: () => createGhPullRequests({ gh: fake.run }),
    permissions: () => createGhPermissions({ gh: fake.run }),
    git: () => conflictingMergeTree(planted.git),
    now: () => NOW,
    clock: () => 0,
    sleep: async () => undefined,
    runLoop: async () => {
      loops += 1;
      return { ok: true, exitCode: 0, argv: ['loop', 'start'], problem: null };
    },
  };
  const project: PlantedProject = { root: planted.work, home: planted.home };
  const words = ['pr', 'triage', String(NUMBER), '--resolve', ...extra, '--no-hint'];
  const run = await dispatchInProject(words, SUBJECTS, [createPrTriageCommand(seams)], project);
  return { ...run, loops, worktree: resolveWorktreePath(planted.home, NUMBER) };
}

/** The NUL `git merge-tree -z` separates its answer with. */
const NUL = '\u0000';

/**
 * The real runner, except that `merge-tree` answers a `bun.lock` content
 * conflict, so the assessment is the simple `conflict-lockfile` and a
 * resolve run reaches the worktree. Every other argv, the rule's
 * `rev-parse` and the worktree's own commands included, is real git.
 */
function conflictingMergeTree(git: GitRunner): GitRunner {
  return (args) => args[0] === 'merge-tree'
    ? { ok: false, stdout: ['0'.repeat(40), 'bun.lock', '', ''].join(NUL), stderr: '' }
    : git(args);
}

describe('pr triage --resolve over a head carrying its own config module', () => {
  it('refuses with exit 1 before the worktree is added, and runs no loop', async () => {
    const run = await dispatched('dispatch-refused', []);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('rafa.config.ts');
    expect(run.stderr).toContain('origin/main');
    expect(run.stderr).toContain(`--${ALLOW_LOCAL_CONFIG_FLAG}`);
    expect(run.loops).toBe(0);
    expect(existsSync(run.worktree)).toBe(false);
  });

  it('runs under --allow-local-config, printing the one warning line', async () => {
    const run = await dispatched('dispatch-allowed', [`--${ALLOW_LOCAL_CONFIG_FLAG}`]);

    expect(run.loops).toBeGreaterThan(0);
    const warnings = `${run.stdout}\n${run.stderr}`.split('\n').filter((line) => line.includes(`--${ALLOW_LOCAL_CONFIG_FLAG}:`));
    expect(warnings).toHaveLength(1);
    expect(run.stderr).not.toContain('refuses #12');
  });
});
