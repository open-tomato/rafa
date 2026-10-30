/**
 * `./merge-cleanup.ts` driven through a fake {@link GitRunner} that
 * answers each argv from a table and records what it was asked, and
 * through a planted `package.json` under `tmpdir` for the follow-ups.
 * The clean-up cases spawn no git; the settle follow-up's cases plant a
 * one-commit repository with its fragments and an `origin/main` ref,
 * since the dry run it gathers from reads git objects, and each case
 * that names settle sits beside one over the same base that names
 * nothing (a `none` fragment, the release off, another base).
 * `merge.test.ts` and `merge-driven.test.ts` run the same functions
 * through `rafa pr merge` itself.
 */
import type { FollowUpPlace, KeepSettings } from './merge-cleanup.js';
import type { GitResult, GitRunner } from '../../pr/index.js';
import type { Fragment } from '@open-tomato/rafa/release/fragment';
import type { MergeGuardSettings } from '@open-tomato/rafa-release/release/guard-merge';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CommandExit } from '@open-tomato/rafa/core/command';
import { RUNTIME_SUBDIR } from '@open-tomato/rafa/core/runtime';
import { serializeFragment } from '@open-tomato/rafa/release/fragment';
import { afterEach, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../../pr/index.js';

import {
  cleanUpAfterMerge,
  followUpsFor,
  keptBecause,
  localHoldsBranch,
  readyLine,
  remoteHoldsBranch,
  reportFollowUps,
  runCleanUp,
} from './merge-cleanup.js';

const OK: GitResult = { ok: true, stdout: '', stderr: '' };
const MERGED = { number: 41, headRefName: 'feat/x', baseRefName: 'main' };

/** A runner answering by the argv's joined words, OK for anything unlisted, recording each call. */
function fakeGit(answers: Readonly<Record<string, GitResult>> = {}): { git: GitRunner; calls: string[] } {
  const calls: string[] = [];
  const git: GitRunner = (args) => {
    const key = args.join(' ');
    calls.push(key);
    return answers[key] ?? OK;
  };
  return { git, calls };
}

/** The release settings the follow-ups read: on under `auto`, over the default files. */
const RELEASE: MergeGuardSettings = {
  releaseEnabled: 'auto',
  releaseVersionFile: 'package.json',
  releaseChangelog: 'CHANGELOG.md',
  releaseFragments: '.changes',
  releaseStrategy: 'semver-by-level',
  releaseHeading: '## {version} — {date}, {title}',
  prVersionCollision: 'report',
  dangerousAcceptVersionCollision: false,
  releaseMoveLock: false,
};

/** Runs git in `cwd` under a fixed identity and no system config, answering what it wrote. */
function runGit(cwd: string, ...args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'rafa test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'rafa test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
      GIT_CONFIG_NOSYSTEM: '1',
      LC_ALL: 'C',
    },
  });
}

/** Collects every line a report function is handed. */
function collector(): { lines: string[]; report: (message: string) => void } {
  const lines: string[] = [];
  return { lines, report: (message) => { lines.push(message); } };
}

describe('remoteHoldsBranch', () => {
  it('reads a line from ls-remote as present', () => {
    const { git } = fakeGit({ 'ls-remote --heads origin feat/x': { ok: true, stdout: 'abc\trefs/heads/feat/x\n', stderr: '' } });
    const warned = collector();
    expect(remoteHoldsBranch(git, 'feat/x', warned.report)).toBe(true);
    expect(warned.lines).toEqual([]);
  });

  it('reads exit 0 with nothing written as absent', () => {
    const { git } = fakeGit();
    expect(remoteHoldsBranch(git, 'feat/x', collector().report)).toBe(false);
  });

  it('reads a failed probe as absent and warns naming what git said', () => {
    const { git } = fakeGit({ 'ls-remote --heads origin feat/x': { ok: false, stdout: '', stderr: 'fatal: no remote' } });
    const warned = collector();
    expect(remoteHoldsBranch(git, 'feat/x', warned.report)).toBe(false);
    expect(warned.lines).toEqual([
      'origin could not be asked whether it still holds feat/x, so it is left alone: fatal: no remote',
    ]);
  });
});

describe('localHoldsBranch', () => {
  const probe = 'show-ref --verify --quiet refs/heads/feat/x';

  it('reads exit 0 as present', () => {
    expect(localHoldsBranch(fakeGit().git, 'feat/x', collector().report)).toBe(true);
  });

  it('reads a probe that failed and said nothing as absent, with no warning', () => {
    const warned = collector();
    const { git } = fakeGit({ [probe]: { ok: false, stdout: '', stderr: '' } });
    expect(localHoldsBranch(git, 'feat/x', warned.report)).toBe(false);
    expect(warned.lines).toEqual([]);
  });

  it('reads a probe that failed and said something as present, and warns', () => {
    const warned = collector();
    const { git } = fakeGit({ [probe]: { ok: false, stdout: '', stderr: 'fatal: not a git repository' } });
    expect(localHoldsBranch(git, 'feat/x', warned.report)).toBe(true);
    expect(warned.lines).toEqual([
      'could not read whether this checkout holds a local branch feat/x, so its delete runs: fatal: not a git repository',
    ]);
  });
});

describe('readyLine', () => {
  it('names each of the four combinations of branches deleted', () => {
    expect(readyLine('main', 'feat/x', { local: true, remote: true }))
      .toBe('main is checked out and pulled, and feat/x is gone locally and on origin.');
    expect(readyLine('main', 'feat/x', { local: true, remote: false }))
      .toBe('main is checked out and pulled, and feat/x is gone locally; origin had already deleted it.');
    expect(readyLine('main', 'feat/x', { local: false, remote: true }))
      .toBe('main is checked out and pulled, and feat/x is gone on origin; there was no local branch to delete.');
    expect(readyLine('main', 'feat/x', { local: false, remote: false }))
      .toBe('main is checked out and pulled; feat/x had no local branch, and origin had already deleted it.');
  });
});

describe('runCleanUp', () => {
  it('runs every step in order and reports each done', () => {
    const { git, calls } = fakeGit();
    const info = collector();
    const reports = runCleanUp(git, MERGED, { local: true, remote: true }, info.report);
    expect(calls).toEqual([
      'switch main',
      'pull --ff-only',
      'branch -D feat/x',
      'push origin --delete feat/x',
      'fetch --prune',
    ]);
    expect(reports.every((report) => report.ok && !report.skipped)).toBe(true);
    expect(info.lines).toEqual([
      'switch to main: done',
      'pull main, fast-forward only: done',
      'delete the local branch feat/x: done',
      'delete origin/feat/x: done',
      'prune deleted remote branches: done',
    ]);
  });

  it('reports an absent local branch as a skipped step and spawns nothing for it', () => {
    const { git, calls } = fakeGit();
    const info = collector();
    const reports = runCleanUp(git, MERGED, { local: false, remote: false }, info.report);
    expect(calls).toEqual(['switch main', 'pull --ff-only', 'fetch --prune']);
    expect(reports.find((report) => report.id === 'delete-local')).toMatchObject({ ok: true, skipped: true });
    expect(info.lines).toContain('delete the local branch feat/x: skipped — no local branch feat/x; nothing to delete');
  });

  it('refuses with exit 1 at the first failed step, quoting git and listing the rest to paste', () => {
    const { git, calls } = fakeGit({ 'pull --ff-only': { ok: false, stdout: '', stderr: 'fatal: Not possible to fast-forward\nhint: diverged' } });
    let thrown: unknown = null;
    try {
      runCleanUp(git, MERGED, { local: true, remote: true }, collector().report);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CommandExit);
    expect((thrown as CommandExit).exitCode).toBe(1);
    expect((thrown as CommandExit).message.split('\n')).toEqual([
      '❌ pull main, fast-forward only: failed',
      '   fatal: Not possible to fast-forward',
      '   hint: diverged',
      '#41 is merged, and the merge is left alone. Run the rest yourself:',
      '   git pull --ff-only',
      '   git branch -D feat/x',
      '   git push origin --delete feat/x',
      '   git fetch --prune',
    ]);
    expect(calls).toEqual(['switch main', 'pull --ff-only']);
  });
});

/** The git line `readRemoteHead` reads the remote's default branch with. */
const REMOTE_HEAD = 'symbolic-ref --quiet --short refs/remotes/origin/HEAD';

/** The keep settings of a project naming no base and no pattern, the flag off. */
const NOTHING_KEPT: KeepSettings = { base: null, keep: [], keepBranch: false };

/** The promotion pull request the incident merged: the trunk into the release branch. */
const PROMOTED = { number: 1265, headRefName: 'integration', baseRefName: 'main' };

describe('keptBecause', () => {
  it('keeps the branch pr.base names, asking git nothing', () => {
    const { git, calls } = fakeGit();
    expect(keptBecause(git, 'integration', { ...NOTHING_KEPT, base: 'integration' })).toBe('it is pr.base');
    expect(calls).toEqual([]);
  });

  it('keeps the remote\'s default branch even where pr.base names another', () => {
    const { git } = fakeGit({ [REMOTE_HEAD]: { ok: true, stdout: 'origin/integration\n', stderr: '' } });
    expect(keptBecause(git, 'integration', { ...NOTHING_KEPT, base: 'develop' }))
      .toBe('it is origin\'s default branch');
  });

  it('keeps main where pr.base names none and the remote names no default', () => {
    const { git } = fakeGit({ [REMOTE_HEAD]: { ok: false, stdout: '', stderr: '' } });
    expect(keptBecause(git, 'main', NOTHING_KEPT)).toBe('it is main, the base where pr.base names none');
  });

  it('keeps a branch a cleanup.keep pattern names', () => {
    const { git } = fakeGit();
    expect(keptBecause(git, 'release/1.2', { ...NOTHING_KEPT, keep: ['release/*'] }))
      .toBe('a cleanup.keep pattern names it');
  });

  it('keeps any branch under --keep-branch', () => {
    const { git } = fakeGit();
    expect(keptBecause(git, 'feat/x', { ...NOTHING_KEPT, keepBranch: true })).toBe('--keep-branch was given');
  });

  it('keeps nothing else: a feature branch is deleted', () => {
    const { git } = fakeGit({ [REMOTE_HEAD]: { ok: true, stdout: 'origin/main\n', stderr: '' } });
    expect(keptBecause(git, 'feat/x', { base: 'integration', keep: ['release/*'], keepBranch: false })).toBeNull();
  });
});

describe('cleanUpAfterMerge', () => {
  it('probes the remote before the local branch, runs the steps, and ends on the ready line', () => {
    const { git, calls } = fakeGit({
      'ls-remote --heads origin feat/x': { ok: false, stdout: '', stderr: 'remote gone' },
      'show-ref --verify --quiet refs/heads/feat/x': { ok: false, stdout: '', stderr: 'bad' },
    });
    const info = collector();
    const warned = collector();
    const { steps, kept } = cleanUpAfterMerge(git, MERGED, NOTHING_KEPT, { info: info.report, warn: warned.report });
    expect(calls.slice(0, 3)).toEqual([
      REMOTE_HEAD,
      'ls-remote --heads origin feat/x',
      'show-ref --verify --quiet refs/heads/feat/x',
    ]);
    expect(warned.lines.map((line) => line.split(' ')[0])).toEqual(['origin', 'could']);
    expect(steps.map((step) => step.id)).toEqual(['switch-base', 'pull-base', 'delete-local', 'prune-remotes']);
    expect(kept).toBeNull();
    expect(info.lines.at(-1)).toBe('main is checked out and pulled, and feat/x is gone locally; origin had already deleted it.');
  });

  it('still deletes a feature branch on both sides where the project names trunks', () => {
    const { git, calls } = fakeGit({
      'ls-remote --heads origin feat/x': { ok: true, stdout: 'abc\trefs/heads/feat/x\n', stderr: '' },
    });
    const { kept } = cleanUpAfterMerge(git, MERGED, { ...NOTHING_KEPT, base: 'integration' }, {
      info: collector().report,
      warn: collector().report,
    });
    expect(kept).toBeNull();
    expect(calls).toContain('branch -D feat/x');
    expect(calls).toContain('push origin --delete feat/x');
  });

  it('keeps a trunk head on both sides, probing neither, and says so in one line', () => {
    const { git, calls } = fakeGit();
    const info = collector();
    const { steps, kept } = cleanUpAfterMerge(git, PROMOTED, { ...NOTHING_KEPT, base: 'integration' }, {
      info: info.report,
      warn: collector().report,
    });
    expect(calls).toEqual(['switch main', 'pull --ff-only', 'fetch --prune']);
    expect(steps.map((step) => step.id)).toEqual(['switch-base', 'pull-base', 'prune-remotes']);
    expect(kept).toBe('it is pr.base');
    expect(info.lines.filter((line) => line.includes('kept'))).toEqual([
      'main is checked out and pulled; integration is kept locally and on origin, since it is pr.base.',
    ]);
  });

  it('names no trunk delete in the tail a failed step prints', () => {
    const { git } = fakeGit({ 'pull --ff-only': { ok: false, stdout: '', stderr: 'fatal: diverged' } });
    let thrown: unknown = null;
    try {
      cleanUpAfterMerge(git, PROMOTED, { ...NOTHING_KEPT, base: 'integration' }, {
        info: collector().report,
        warn: collector().report,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CommandExit);
    const message = (thrown as CommandExit).message;
    expect(message).not.toContain('branch -D');
    expect(message).not.toContain('--delete');
    expect(message.split('\n').slice(-2)).toEqual(['   git pull --ff-only', '   git fetch --prune']);
  });

  it('keeps a feature branch under --keep-branch, deleting it on neither side', () => {
    const { git, calls } = fakeGit();
    const info = collector();
    const { kept } = cleanUpAfterMerge(git, MERGED, { ...NOTHING_KEPT, keepBranch: true }, {
      info: info.report,
      warn: collector().report,
    });
    expect(kept).toBe('--keep-branch was given');
    expect(calls).toEqual([REMOTE_HEAD, 'switch main', 'pull --ff-only', 'fetch --prune']);
    expect(info.lines.at(-1))
      .toBe('main is checked out and pulled; feat/x is kept locally and on origin, since --keep-branch was given.');
  });
});

describe('followUpsFor and reportFollowUps', () => {
  const planted: string[] = [];

  afterEach(() => {
    for (const dir of planted.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** A project root and a home under tmpdir, the root holding `packageJson` when it is given. */
  function place(packageJson?: object, over: Partial<MergeGuardSettings> = {}): FollowUpPlace {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'merge-cleanup-root-')));
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'merge-cleanup-home-')));
    planted.push(root, home);
    if (packageJson !== undefined) writeFileSync(join(root, 'package.json'), JSON.stringify(packageJson));
    return { root, home, base: 'main', release: { ...RELEASE, ...over } };
  }

  /**
   * `at`'s root made a repository whose one commit holds its
   * `package.json`, a changelog and one fragment per level in `levels`,
   * with `origin/main` pointing at that commit as a pull leaves it.
   */
  function plantBase(at: FollowUpPlace, levels: readonly string[]): GitRunner {
    writeFileSync(join(at.root, 'CHANGELOG.md'), '# Changelog\n');
    mkdirSync(join(at.root, '.changes'), { recursive: true });
    levels.forEach((level, index) => {
      const plan = `rafa-${String(index + 1)}`;
      const fragment = { plan, title: `Plan ${plan}`, level: level as Fragment['level'], package: null, notes: ['- loop: a change'] };
      writeFileSync(join(at.root, '.changes', `${plan}.md`), serializeFragment(fragment));
    });
    runGit(at.root, 'init', '--quiet', '--initial-branch=main');
    runGit(at.root, 'add', '-A');
    runGit(at.root, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-verify', '-m', 'base');
    runGit(at.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    return createGitRunner(at.root);
  }

  it('names nothing and asks git nothing where the root holds no package.json and the release is off', () => {
    const { git, calls } = fakeGit();
    expect(followUpsFor(place(), git)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('names no tag for a version nothing has tagged, and asks git nothing where the release does not run', () => {
    const { git, calls } = fakeGit();
    const info = collector();
    expect(reportFollowUps(place({ name: 'other', version: '1.2.3' }), git, info.report)).toEqual([]);
    expect(calls).toEqual([]);
    expect(info.lines).toEqual([]);
  });

  it('reads the runtime directory under the home for a rafa checkout', () => {
    const { git } = fakeGit();
    const at = place({ name: '@open-tomato/rafa', version: '1.2.3' });
    expect(followUpsFor(at, git).map((followUp) => followUp.id)).toEqual(['self-update']);
    mkdirSync(join(at.home, RUNTIME_SUBDIR, '1.2.3'), { recursive: true });
    expect(followUpsFor(at, git)).toEqual([]);
  });

  it('prints rafa release settle as the last line where a shipping fragment waits on origin/main', () => {
    const at = place({ name: 'other', version: '1.2.3' });
    const git = plantBase(at, ['patch']);
    const info = collector();

    const followUps = reportFollowUps(at, git, info.report);

    expect(followUps.map((followUp) => followUp.id)).toEqual(['release-settle']);
    expect(info.lines).toEqual([
      'Follow-ups:',
      '   rafa release settle — 1 fragment waits on main and folds into 1.2.4',
    ]);
  });

  it('prints settle after self-update in a rafa checkout, so it stays the last line', () => {
    const at = place({ name: '@open-tomato/rafa', version: '1.2.3' });
    const git = plantBase(at, ['patch', 'minor']);
    const info = collector();

    reportFollowUps(at, git, info.report);

    expect(info.lines).toEqual([
      'Follow-ups:',
      '   rafa self-update — 1.2.3 is not installed as this machine\'s rafa runtime',
      '   rafa release settle — 2 fragments wait on main and fold into 1.3.0',
    ]);
  });

  it('names no settle where only level none fragments wait, since settle would commit nothing', () => {
    const at = place({ name: 'other', version: '1.2.3' });
    const git = plantBase(at, ['none']);
    expect(followUpsFor(at, git)).toEqual([]);
  });

  it('names no settle where release.enabled is false, over the same base that names it when on', () => {
    const at = place({ name: 'other', version: '1.2.3' }, { releaseEnabled: false });
    const git = plantBase(at, ['patch']);
    expect(followUpsFor(at, git)).toEqual([]);
    expect(followUpsFor({ ...at, release: RELEASE }, git).map((followUp) => followUp.id)).toEqual(['release-settle']);
  });

  it('names no settle where origin/<base> names no commit', () => {
    const at = place({ name: 'other', version: '1.2.3' });
    const git = plantBase(at, ['patch']);
    expect(followUpsFor({ ...at, base: 'trunk' }, git)).toEqual([]);
  });
});
