/**
 * The cleanup steps as data over hand-built rows, the force guard over
 * every flag spelling it names, the runner over a scripted git, and once
 * over a real scratch repository so the refusals the module note records
 * are read from git itself.
 */
import type { LocalBranch } from './branches.js';
import type { MergedBy, MergedRow, NotPushedRow, StaleRow } from './groups.js';
import type { CleanupSelection } from './steps.js';
import type { WorktreeRow } from './worktrees.js';
import type { GitResult, GitRunner } from '../pr/git.js';

import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../pr/git.js';

import {
  cleanupCommandLine,
  cleanupSteps,
  deleteBranchStep,
  dryRunLines,
  forcedFlagRefusal,
  needsForcedDelete,
  removeWorktreeStep,
  runCleanupSteps,
} from './steps.js';

const NOW = new Date('2026-09-24T12:00:00Z');

function localBranch(name: string): LocalBranch {
  return { name, upstream: `origin/${name}`, gone: false, ahead: 0, lastCommit: NOW };
}

function mergedRow(name: string, mergedBy: readonly MergedBy[] = ['base']): MergedRow {
  const pullRequest = mergedBy.includes('pull-request')
    ? { number: 7, headRefName: name, headRefOid: 'abc123', mergedAt: '2026-09-20T00:00:00Z' }
    : null;
  return { group: 'merged', ticked: true, branch: localBranch(name), reason: 'merged', mergedBy, pullRequest };
}

function staleRow(name: string): StaleRow {
  return { group: 'stale', ticked: false, branch: localBranch(name), reason: 'stale', idleDays: 40 };
}

function notPushedRow(name: string): NotPushedRow {
  return { group: 'not-pushed', ticked: false, branch: localBranch(name), reason: 'not pushed', commits: 2 };
}

function worktreeRow(path: string, branch: string | null, tickable = true): WorktreeRow {
  return {
    path,
    branch,
    lastModified: NOW,
    branchMerged: true,
    blockers: tickable
      ? []
      : [{ kind: 'dirty', reason: '1 changed file' }],
    tickable,
    ticked: tickable,
    reason: tickable
      ? 'clean'
      : '1 changed file',
  };
}

function selection(fields: Partial<CleanupSelection>): CleanupSelection {
  return { worktrees: [], merged: [], stale: [], notPushed: [], ...fields };
}

function said(ok: boolean, stderr = ''): GitResult {
  return { ok, stdout: '', stderr };
}

/** A git that answers `answers[argv joined by spaces]`, or success, recording every call. */
function scriptedGit(answers: Record<string, GitResult> = {}): { git: GitRunner; calls: string[] } {
  const calls: string[] = [];
  const git: GitRunner = (args) => {
    const call = args.join(' ');
    calls.push(call);
    return answers[call] ?? said(true);
  };
  return { git, calls };
}

describe('cleanupSteps', () => {
  it('removes worktrees before deleting branches, whatever order the rows came in', () => {
    const plan = cleanupSteps(selection({
      merged: [mergedRow('done')],
      worktrees: [worktreeRow('/w/a', 'other')],
    }));
    expect(plan.steps.map((step) => step.argv.join(' '))).toEqual([
      'git worktree remove /w/a',
      'git branch -d done',
    ]);
    expect(plan.withheld).toEqual([]);
  });

  it('deletes a Merged row reachable from the base with -d, even when a pull request also holds', () => {
    const plan = cleanupSteps(selection({ merged: [mergedRow('both', ['base', 'pull-request'])] }));
    expect(plan.steps[0]?.argv).toEqual(['git', 'branch', '-d', 'both']);
  });

  it('deletes a squash-merged row, merged by its pull request alone, with -D', () => {
    const plan = cleanupSteps(selection({ merged: [mergedRow('squashed', ['pull-request'])] }));
    expect(plan.steps[0]?.argv).toEqual(['git', 'branch', '-D', 'squashed']);
  });

  it('deletes a row merged only because its upstream is gone with -d', () => {
    const plan = cleanupSteps(selection({ merged: [mergedRow('gone', ['gone'])] }));
    expect(plan.steps[0]?.argv).toEqual(['git', 'branch', '-d', 'gone']);
  });

  it('deletes ticked Stale and confirmed Not-pushed rows with -D', () => {
    const plan = cleanupSteps(selection({ stale: [staleRow('old')], notPushed: [notPushedRow('local')] }));
    expect(plan.steps.map((step) => step.argv.join(' '))).toEqual([
      'git branch -D old',
      'git branch -D local',
    ]);
  });

  it('makes a Merged branch held by a ticked worktree wait for that worktree', () => {
    const plan = cleanupSteps(selection({
      worktrees: [worktreeRow('/w/done', 'done')],
      merged: [mergedRow('done')],
    }));
    expect(plan.steps.map((step) => step.after)).toEqual([null, '/w/done']);
  });

  it('withholds a Stale or Not-pushed branch a ticked worktree holds', () => {
    const plan = cleanupSteps(selection({
      worktrees: [worktreeRow('/w/old', 'old'), worktreeRow('/w/local', 'local')],
      stale: [staleRow('old')],
      notPushed: [notPushedRow('local')],
    }));
    expect(plan.steps.map((step) => step.kind)).toEqual(['remove-worktree', 'remove-worktree']);
    expect(plan.withheld).toEqual([
      {
        kind: 'delete-branch',
        subject: 'old',
        reason: 'held by the worktree at /w/old; only a Merged branch is deleted with its worktree',
      },
      {
        kind: 'delete-branch',
        subject: 'local',
        reason: 'held by the worktree at /w/local; only a Merged branch is deleted with its worktree',
      },
    ]);
  });

  it('withholds an untickable worktree and the branch it holds', () => {
    const plan = cleanupSteps(selection({
      worktrees: [worktreeRow('/w/dirty', 'done', false)],
      merged: [mergedRow('done')],
    }));
    expect(plan.steps).toEqual([]);
    expect(plan.withheld).toEqual([
      { kind: 'remove-worktree', subject: '/w/dirty', reason: '1 changed file' },
      { kind: 'delete-branch', subject: 'done', reason: 'held by the worktree at /w/dirty, which is not removed' },
    ]);
  });

  it('removes a detached worktree without any branch step', () => {
    const plan = cleanupSteps(selection({ worktrees: [worktreeRow('/w/detached', null)] }));
    expect(plan.steps.map((step) => step.argv.join(' '))).toEqual(['git worktree remove /w/detached']);
  });

  it('never builds a step the force guard refuses, over every group', () => {
    const plan = cleanupSteps(selection({
      worktrees: [worktreeRow('/w/a', 'done')],
      merged: [mergedRow('done'), mergedRow('squashed', ['pull-request'])],
      stale: [staleRow('old')],
      notPushed: [notPushedRow('local')],
    }));
    expect(plan.steps).toHaveLength(5);
    expect(plan.steps.map((step) => forcedFlagRefusal(step.argv))).toEqual([null, null, null, null, null]);
  });
});

describe('needsForcedDelete', () => {
  it('holds only for a pull-request reading without the base', () => {
    expect(needsForcedDelete(mergedRow('a', ['pull-request']))).toBe(true);
    expect(needsForcedDelete(mergedRow('a', ['pull-request', 'gone']))).toBe(true);
    expect(needsForcedDelete(mergedRow('a', ['base', 'pull-request']))).toBe(false);
    expect(needsForcedDelete(mergedRow('a', ['gone']))).toBe(false);
  });

  it('does not hold when the row names no pull request', () => {
    const row = { ...mergedRow('a', ['pull-request']), pullRequest: null };
    expect(needsForcedDelete(row)).toBe(false);
  });
});

describe('forcedFlagRefusal', () => {
  it.each([
    ['--force'],
    ['--force=yes'],
    ['-f'],
    ['-ff'],
    ['-df'],
  ])('refuses %s', (flag) => {
    expect(forcedFlagRefusal(['git', 'branch', flag, 'x'])).toBe(
      `rafa cleanup refuses a forced removal: \`${flag}\`. Nothing was run.`,
    );
  });

  it('names every forcing word', () => {
    expect(forcedFlagRefusal(['git', 'worktree', 'remove', '-f', '--force', '/w/a'])).toBe(
      'rafa cleanup refuses a forced removal: `-f`, `--force`. Nothing was run.',
    );
  });

  it.each([
    [['git', 'worktree', 'remove', '/w/feature-fix']],
    [['git', 'branch', '-d', 'fix/force']],
    [['git', 'branch', '-D', 'feature']],
  ])('lets %p through', (argv) => {
    expect(forcedFlagRefusal(argv)).toBeNull();
  });
});

describe('command lines', () => {
  it('quotes a word the shell would split', () => {
    expect(cleanupCommandLine(removeWorktreeStep('/w/a b'))).toBe('git worktree remove \'/w/a b\'');
    expect(cleanupCommandLine(deleteBranchStep('feat/x', true))).toBe('git branch -D feat/x');
  });

  it('prints one line per step in run order for --dry-run, and nothing withheld', () => {
    const plan = cleanupSteps(selection({
      worktrees: [worktreeRow('/w/a', 'done'), worktreeRow('/w/dirty', 'other', false)],
      merged: [mergedRow('done')],
      stale: [staleRow('old')],
    }));
    expect(dryRunLines(plan)).toEqual([
      'git worktree remove /w/a',
      'git branch -d done',
      'git branch -D old',
    ]);
  });

  it('builds frozen steps', () => {
    const step = removeWorktreeStep('/w/a');
    expect(Object.isFrozen(step)).toBe(true);
    expect(Object.isFrozen(step.argv)).toBe(true);
  });
});

describe('runCleanupSteps over a scripted git', () => {
  it('runs every step without its leading git and answers each outcome', () => {
    const { git, calls } = scriptedGit({ 'branch -D old': said(false, 'error: boom') });
    const plan = cleanupSteps(selection({
      worktrees: [worktreeRow('/w/a', 'done')],
      merged: [mergedRow('done')],
      stale: [staleRow('old')],
      notPushed: [notPushedRow('local')],
    }));
    const outcomes = runCleanupSteps(git, plan);
    expect(calls).toEqual(['worktree remove /w/a', 'branch -d done', 'branch -D old', 'branch -D local']);
    expect(outcomes.map((outcome) => [outcome.command, outcome.ran, outcome.ok, outcome.said])).toEqual([
      ['git worktree remove /w/a', true, true, ''],
      ['git branch -d done', true, true, ''],
      ['git branch -D old', true, false, 'error: boom'],
      ['git branch -D local', true, true, ''],
    ]);
  });

  it('leaves a branch unrun when the worktree holding it was not removed', () => {
    const { git, calls } = scriptedGit({ 'worktree remove /w/a': said(false, 'fatal: dirty') });
    const plan = cleanupSteps(selection({ worktrees: [worktreeRow('/w/a', 'done')], merged: [mergedRow('done')] }));
    const outcomes = runCleanupSteps(git, plan);
    expect(calls).toEqual(['worktree remove /w/a']);
    expect(outcomes[1]).toMatchObject({
      ran: false,
      ok: false,
      command: 'git branch -d done',
      said: 'not run: the worktree at /w/a was not removed',
    });
  });

  it('refuses a forced step without spawning git, and runs the rest', () => {
    const { git, calls } = scriptedGit();
    const forced = Object.freeze({ ...removeWorktreeStep('/w/a'), argv: ['git', 'worktree', 'remove', '--force', '/w/a'] });
    const outcomes = runCleanupSteps(git, { steps: [forced, deleteBranchStep('done', false)], withheld: [] });
    expect(calls).toEqual(['branch -d done']);
    expect(outcomes[0]).toMatchObject({
      ran: false,
      ok: false,
      said: 'rafa cleanup refuses a forced removal: `--force`. Nothing was run.',
    });
  });

  it('control: the same step without the flag is spawned', () => {
    const { git, calls } = scriptedGit();
    runCleanupSteps(git, { steps: [removeWorktreeStep('/w/a')], withheld: [] });
    expect(calls).toEqual(['worktree remove /w/a']);
  });
});

describe('runCleanupSteps over a real repository', () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-cleanup-steps-')));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  function sh(cwd: string, ...args: string[]): void {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  }

  const repo = join(scratch, 'repo');
  sh(scratch, 'init', '-q', '-b', 'main', repo);
  sh(repo, 'config', 'user.email', 'test@example.com');
  sh(repo, 'config', 'user.name', 'Test');
  sh(repo, 'commit', '-q', '--allow-empty', '-m', 'root');
  sh(repo, 'branch', 'merged');
  sh(repo, 'switch', '-q', '-c', 'squashed');
  writeFileSync(join(repo, 'f'), 'x\n');
  sh(repo, 'add', 'f');
  sh(repo, 'commit', '-q', '-m', 'work');
  sh(repo, 'switch', '-q', 'main');
  sh(repo, 'merge', '-q', '--squash', 'squashed');
  sh(repo, 'commit', '-q', '-m', 'squash');
  sh(repo, 'branch', 'clean');
  sh(repo, 'branch', 'dirty');
  const cleanPath = join(scratch, 'wt-clean');
  const dirtyPath = join(scratch, 'wt-dirty');
  sh(repo, 'worktree', 'add', '-q', cleanPath, 'clean');
  sh(repo, 'worktree', 'add', '-q', dirtyPath, 'dirty');
  writeFileSync(join(dirtyPath, 'untracked'), 'y\n');

  function branchExists(name: string): boolean {
    return spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { cwd: repo }).status === 0;
  }

  it('removes the clean worktree and its branch, keeps the dirty one, and -d refuses a squash merge', () => {
    const git = createGitRunner(repo);
    const outcomes = runCleanupSteps(git, {
      steps: [
        removeWorktreeStep(cleanPath),
        removeWorktreeStep(dirtyPath),
        deleteBranchStep('clean', false, cleanPath),
        deleteBranchStep('dirty', false, dirtyPath),
        deleteBranchStep('merged', false),
        deleteBranchStep('squashed', false),
      ],
      withheld: [],
    });
    expect(outcomes.map((outcome) => [outcome.step.subject, outcome.ran, outcome.ok])).toEqual([
      [cleanPath, true, true],
      [dirtyPath, true, false],
      ['clean', true, true],
      ['dirty', false, false],
      ['merged', true, true],
      ['squashed', true, false],
    ]);
    expect(outcomes[1]?.said).toContain('contains modified or untracked files');
    expect(outcomes[5]?.said).toContain('error: the branch \'squashed\' is not fully merged');
    expect([branchExists('clean'), branchExists('dirty'), branchExists('merged'), branchExists('squashed')])
      .toEqual([false, true, false, true]);
  });

  it('deletes the squash-merged branch with the -D its pull request reading allows', () => {
    const git = createGitRunner(repo);
    const plan = cleanupSteps(selection({ merged: [mergedRow('squashed', ['pull-request'])] }));
    const outcomes = runCleanupSteps(git, plan);
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true]);
    expect(branchExists('squashed')).toBe(false);
  });
});
