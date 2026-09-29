/**
 * `./merge-cleanup.ts` driven through a fake {@link GitRunner} that
 * answers each argv from a table and records what it was asked, and
 * through a planted `package.json` under `tmpdir` for the follow-ups.
 * Nothing here spawns git; `merge.test.ts` and `merge-driven.test.ts`
 * run the same functions through `rafa pr merge` itself.
 */
import type { GitResult, GitRunner } from '../../pr/index.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { CommandExit } from '../../cli/command.js';
import { RUNTIME_SUBDIR } from '../../start/runtime.js';

import {
  cleanUpAfterMerge,
  followUpsFor,
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

describe('cleanUpAfterMerge', () => {
  it('probes the remote before the local branch, runs the steps, and ends on the ready line', () => {
    const { git, calls } = fakeGit({
      'ls-remote --heads origin feat/x': { ok: false, stdout: '', stderr: 'remote gone' },
      'show-ref --verify --quiet refs/heads/feat/x': { ok: false, stdout: '', stderr: 'bad' },
    });
    const info = collector();
    const warned = collector();
    const steps = cleanUpAfterMerge(git, MERGED, { info: info.report, warn: warned.report });
    expect(calls.slice(0, 2)).toEqual(['ls-remote --heads origin feat/x', 'show-ref --verify --quiet refs/heads/feat/x']);
    expect(warned.lines.map((line) => line.split(' ')[0])).toEqual(['origin', 'could']);
    expect(steps.map((step) => step.id)).toEqual(['switch-base', 'pull-base', 'delete-local', 'prune-remotes']);
    expect(info.lines.at(-1)).toBe('main is checked out and pulled, and feat/x is gone locally; origin had already deleted it.');
  });
});

describe('followUpsFor and reportFollowUps', () => {
  const planted: string[] = [];

  afterEach(() => {
    for (const dir of planted.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** A project root and a home under tmpdir, the root holding `packageJson` when it is given. */
  function place(packageJson?: object): { root: string; home: string } {
    const root = mkdtempSync(join(tmpdir(), 'merge-cleanup-root-'));
    const home = mkdtempSync(join(tmpdir(), 'merge-cleanup-home-'));
    planted.push(root, home);
    if (packageJson !== undefined) writeFileSync(join(root, 'package.json'), JSON.stringify(packageJson));
    return { root, home };
  }

  it('names nothing and asks git nothing where the root holds no package.json', () => {
    const { git, calls } = fakeGit();
    expect(followUpsFor(place(), git)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('names the tag for an untagged version and prints it under Follow-ups', () => {
    const { git, calls } = fakeGit();
    const info = collector();
    const followUps = reportFollowUps(place({ name: 'other', version: '1.2.3' }), git, info.report);
    expect(calls).toEqual(['tag --list v1.2.3']);
    expect(followUps.map((followUp) => followUp.id)).toEqual(['release-tag']);
    expect(info.lines).toEqual([
      'Follow-ups:',
      '   rafa release tag — 1.2.3 is on the base branch and no v1.2.3 tag names it',
    ]);
  });

  it('prints nothing where the version is tagged and the project is no rafa checkout', () => {
    const { git } = fakeGit({ 'tag --list v1.2.3': { ok: true, stdout: 'v1.2.3\n', stderr: '' } });
    const info = collector();
    expect(reportFollowUps(place({ name: 'other', version: '1.2.3' }), git, info.report)).toEqual([]);
    expect(info.lines).toEqual([]);
  });

  it('reads the runtime directory under the home for a rafa checkout', () => {
    const tagged = fakeGit({ 'tag --list v1.2.3': { ok: true, stdout: 'v1.2.3\n', stderr: '' } }).git;
    const at = place({ name: '@open-tomato/rafa', version: '1.2.3' });
    expect(followUpsFor(at, tagged).map((followUp) => followUp.id)).toEqual(['self-update']);
    mkdirSync(join(at.home, RUNTIME_SUBDIR, '1.2.3'), { recursive: true });
    expect(followUpsFor(at, tagged)).toEqual([]);
  });
});
