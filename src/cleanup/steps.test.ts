/**
 * The cleanup steps as data over hand-built rows, the force guard over
 * every flag spelling it names, the runner over a scripted git, and once
 * over a real scratch repository so the refusals the module note records
 * are read from git itself. The one remote write, the delete of a ticked
 * remote-only row, is read the same three ways, its real run over a
 * clone of a bare remote that holds a branch named `-f`.
 */
import type { RemoteOnlyRow } from './remote-only.js';
import type { RunRow } from './runs.js';
import type { CleanupFiles, CleanupSelection } from './steps.js';
import type { GitResult, GitRunner } from '@open-tomato/rafa/core/git';
import type { LocalBranch } from '@open-tomato/rafa-pr/cleanup/branches';
import type { MergedBy, MergedRow, NotPushedRow, StaleRow } from '@open-tomato/rafa-pr/cleanup/groups';
import type { WorktreeRow } from '@open-tomato/rafa-pr/cleanup/worktrees';
import type { PastHeadCommit } from '@open-tomato/rafa-release/cleanup/past-head';

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '@open-tomato/rafa/core/git';

import {
  cleanupCommandLine,
  cleanupSteps,
  deleteBranchStep,
  deletedNotPushed,
  deleteRemoteBranchStep,
  dryRunLines,
  forcedFlagRefusal,
  needsForcedDelete,
  removeRunStep,
  removeWorktreeStep,
  runCleanupSteps,
  unheldPastHeadReason,
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

/** A commit past the head, its hash `<letter>` repeated to 40. */
function pastCommit(letter: string, subject: string, held: boolean): PastHeadCommit {
  return { hash: letter.repeat(40), subject, paths: [held
    ? '.changes/x.md'
    : 'src/x.ts'], held };
}

/** A Merged row listed by its gone upstream alone, its tip past pull request #21's head by `commits`. */
function pastHeadRow(name: string, commits: readonly PastHeadCommit[], mergedBy: readonly MergedBy[] = ['gone']): MergedRow {
  const pullRequest = { number: 21, headRefName: name, headRefOid: 'abc123', mergedAt: '2026-09-20T00:00:00Z' };
  return {
    ...mergedRow(name, mergedBy),
    ticked: false,
    pastHead: {
      kind: 'past-head',
      pullRequest,
      count: commits.length,
      commits,
      held: commits.every((commit) => commit.held),
    },
  };
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

/** A remote-only row as `./remote-only.ts` reads one: never ticked, two of its three commits with no copy on the base. */
function remoteOnlyRow(name: string): RemoteOnlyRow {
  return {
    group: 'remote-only',
    name,
    lastCommit: NOW,
    commits: 3,
    uncopied: 2,
    ticked: false,
    reason: '2 of 3 commits with no patch-equal copy on origin/main',
  };
}

/** A run-record row under `/p/.rafa/runs/`, with its events file unless `events` is false. */
function runRow(sessionId: string, ticked = true, events = true): RunRow {
  return {
    sessionId,
    path: `/p/.rafa/runs/${sessionId}.json`,
    eventsPath: events
      ? `/p/.rafa/runs/${sessionId}.events.ndjson`
      : null,
    plan: 'demo',
    startedAt: '2026-09-01T12:00:00.000Z',
    ticked,
  };
}

/** Files that remove nothing, recording every path asked for, and throwing for the paths in `refuse`. */
function scriptedFiles(refuse: readonly string[] = []): { files: CleanupFiles; removed: string[] } {
  const removed: string[] = [];
  const files: CleanupFiles = {
    remove: (path) => {
      removed.push(path);
      if (refuse.includes(path)) throw new Error(`EACCES: permission denied, unlink '${path}'`);
    },
  };
  return { files, removed };
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

  it('withholds, with one warning, a held Merged row ticked anyway, so --dry-run prints no step for it', () => {
    const held: MergedRow = {
      ...mergedRow('done'),
      ticked: false,
      heldBy: { path: '/repo/.claude/worktrees/cranky', name: 'cranky', blockers: ['recent'] },
    };
    const plan = cleanupSteps(selection({ merged: [held, mergedRow('other')] }));
    expect(dryRunLines(plan)).toEqual(['git branch -d other']);
    expect(plan.withheld).toEqual([
      { kind: 'delete-branch', subject: 'done', reason: 'checked out in cranky (recent), which is not removed' },
    ]);
  });

  it('withholds a held Merged row once when its untickable worktree is passed too', () => {
    const held: MergedRow = {
      ...mergedRow('done'),
      ticked: false,
      heldBy: { path: '/w/dirty', name: 'dirty', blockers: ['dirty'] },
    };
    const plan = cleanupSteps(selection({ worktrees: [worktreeRow('/w/dirty', 'done', false)], merged: [held] }));
    expect(plan.steps).toEqual([]);
    expect(plan.withheld.filter((entry) => entry.kind === 'delete-branch')).toEqual([
      { kind: 'delete-branch', subject: 'done', reason: 'checked out in dirty (dirty), which is not removed' },
    ]);
  });

  it('withholds a ticked Stale row a dirty worktree holds, never a git branch -D step (#852)', () => {
    const held: StaleRow = { ...staleRow('old'), heldBy: { path: '/w/scratch', name: 'scratch', blockers: ['dirty'] } };
    const plan = cleanupSteps(selection({ stale: [held, staleRow('other')] }));
    expect(dryRunLines(plan)).toEqual(['git branch -D other']);
    expect(plan.withheld).toEqual([
      { kind: 'delete-branch', subject: 'old', reason: 'checked out in scratch (dirty), which is not removed' },
    ]);
  });

  it('withholds a ticked Not-pushed row a locked worktree holds, never a git branch -D step (#852)', () => {
    const held: NotPushedRow = { ...notPushedRow('local'), heldBy: { path: '/w/pinned', name: 'pinned', blockers: ['locked'] } };
    const plan = cleanupSteps(selection({ notPushed: [held] }));
    expect(plan.steps).toEqual([]);
    expect(plan.withheld).toEqual([
      { kind: 'delete-branch', subject: 'local', reason: 'checked out in pinned (locked), which is not removed' },
    ]);
  });

  it('still deletes a row a ticked worktree holds after it, beside held Stale and Not-pushed rows', () => {
    const plan = cleanupSteps(selection({
      worktrees: [worktreeRow('/w/done', 'done')],
      merged: [mergedRow('done')],
      stale: [{ ...staleRow('old'), heldBy: { path: '/w/scratch', name: 'scratch', blockers: ['dirty'] } }],
      notPushed: [{ ...notPushedRow('local'), heldBy: { path: '/w/pinned', name: 'pinned', blockers: ['locked'] } }],
    }));
    expect(plan.steps.map((step) => ({ argv: step.argv.join(' '), after: step.after }))).toEqual([
      { argv: 'git worktree remove /w/done', after: null },
      { argv: 'git branch -d done', after: '/w/done' },
    ]);
    expect(plan.withheld.map((entry) => entry.subject)).toEqual(['old', 'local']);
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
      remoteOnly: [remoteOnlyRow('fix/force-f')],
    }));
    expect(plan.steps).toHaveLength(6);
    expect(plan.steps.map((step) => forcedFlagRefusal(step.argv))).toEqual([null, null, null, null, null, null]);
  });
});

describe('deletedNotPushed', () => {
  it('leaves out a row a ticked, removable worktree holds, which cleanupSteps withholds (#978)', () => {
    const picked = selection({ worktrees: [worktreeRow('/w/local', 'local')], notPushed: [notPushedRow('local')] });
    expect(deletedNotPushed(picked)).toEqual([]);
    expect(cleanupSteps(picked).withheld.map((entry) => entry.subject)).toEqual(['local']);
  });

  it('leaves out a row an untickable worktree holds (#860)', () => {
    const held: NotPushedRow = { ...notPushedRow('local'), heldBy: { path: '/w/pinned', name: 'pinned', blockers: ['locked'] } };
    expect(deletedNotPushed(selection({ notPushed: [held] }))).toEqual([]);
  });

  it('names a row no worktree holds (control)', () => {
    const row = notPushedRow('local');
    const picked = selection({ notPushed: [row] });
    expect(deletedNotPushed(picked)).toEqual([row]);
    expect(dryRunLines(cleanupSteps(picked))).toEqual(['git branch -D local']);
  });

  it('names exactly the rows cleanupSteps turns into a delete-branch step, in the order handed over', () => {
    const free = notPushedRow('free');
    const other = notPushedRow('other');
    const picked = selection({
      worktrees: [worktreeRow('/w/local', 'local'), worktreeRow('/w/dirty', 'stuck', false)],
      notPushed: [
        free,
        notPushedRow('local'),
        notPushedRow('stuck'),
        { ...notPushedRow('pinned'), heldBy: { path: '/w/pinned', name: 'pinned', blockers: ['locked'] } },
        other,
      ],
    });
    const deleted = cleanupSteps(picked).steps.filter((step) => step.kind === 'delete-branch').map((step) => step.subject);
    expect(deletedNotPushed(picked).map((row) => row.branch.name)).toEqual(['free', 'other']);
    expect(deleted).toEqual(['free', 'other']);
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

  it('holds for a gone row past a pull request\'s head only when every commit past it is held', () => {
    expect(needsForcedDelete(pastHeadRow('a', [pastCommit('a', 'fragment', true)]))).toBe(true);
    expect(needsForcedDelete(pastHeadRow('a', [pastCommit('a', 'source', false)]))).toBe(false);
    expect(needsForcedDelete(pastHeadRow('a', [pastCommit('a', 'fragment', true), pastCommit('b', 'source', false)])))
      .toBe(false);
  });

  it('does not hold for a held past-head row the base reaches, which -d deletes', () => {
    expect(needsForcedDelete(pastHeadRow('a', [pastCommit('a', 'fragment', true)], ['base', 'gone']))).toBe(false);
  });
});

describe('a Merged row past its pull request\'s head', () => {
  it('deletes it with -D when the commits past the head are held release fragments', () => {
    const plan = cleanupSteps(selection({ merged: [pastHeadRow('fragment', [pastCommit('a', 'chore: fragment', true)])] }));
    expect(dryRunLines(plan)).toEqual(['git branch -D fragment']);
    expect(plan.withheld).toEqual([]);
  });

  it('withholds a tick otherwise, naming the commits the base does not hold', () => {
    const commits = [pastCommit('a', 'chore: fragment', true), pastCommit('b', 'feat: late', false)];
    const plan = cleanupSteps(selection({ merged: [pastHeadRow('source', commits), mergedRow('other')] }));
    expect(dryRunLines(plan)).toEqual(['git branch -d other']);
    expect(plan.withheld).toEqual([{
      kind: 'delete-branch',
      subject: 'source',
      reason: '1 commit past #21\'s head is not a release fragment the base holds: bbbbbbb feat: late;'
        + ' deleting it would lose them',
    }]);
  });

  it('names every unheld commit, oldest first, when there are several', () => {
    const { pastHead } = pastHeadRow('source', [pastCommit('a', 'one', false), pastCommit('c', 'two', false)]);
    if (pastHead === undefined) throw new Error('the fixture carries no past-head reading');
    expect(unheldPastHeadReason(pastHead)).toBe(
      '2 commits past #21\'s head are not release fragments the base holds: aaaaaaa one, ccccccc two;'
        + ' deleting it would lose them',
    );
  });

  it('deletes a gone row with no past-head reading with -d, which git refuses for a tip nothing reaches', () => {
    const plan = cleanupSteps(selection({ merged: [{ ...mergedRow('gone', ['gone']), ticked: false }] }));
    expect(dryRunLines(plan)).toEqual(['git branch -d gone']);
  });
});

describe('forcedFlagRefusal', () => {
  it.each([
    ['--force'],
    ['--force=yes'],
    ['--force-with-lease'],
    ['--force-with-lease=old-fix:abc123'],
    ['--force-if-includes'],
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
    [['git', 'push', 'origin', '--delete', 'old-fix']],
    [['git', 'push', 'origin', '--delete', 'fix/force-f']],
    [['git', 'push', 'origin', '--delete', '+plus']],
  ])('lets %p through', (argv) => {
    expect(forcedFlagRefusal(argv)).toBeNull();
  });

  it.each([
    ['--force'],
    ['--force-with-lease'],
    ['--force-if-includes'],
    ['-f'],
  ])('refuses a remote delete carrying %s', (flag) => {
    expect(forcedFlagRefusal(['git', 'push', 'origin', '--delete', flag, 'old-fix'])).toBe(
      `rafa cleanup refuses a forced removal: \`${flag}\`. Nothing was run.`,
    );
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

describe('run-record steps', () => {
  it('turns a ticked run row into one step removing the record and its events file', () => {
    const plan = cleanupSteps(selection({ runs: [runRow('r1')] }));
    expect(plan.steps).toEqual([{
      kind: 'remove-run',
      subject: '/p/.rafa/runs/r1.json',
      argv: ['rm', '/p/.rafa/runs/r1.json', '/p/.rafa/runs/r1.events.ndjson'],
      after: null,
    }]);
    expect(plan.withheld).toEqual([]);
  });

  it('turns an unticked run row into no step and nothing withheld', () => {
    const plan = cleanupSteps(selection({ runs: [runRow('r1', false)] }));
    expect(plan.steps).toEqual([]);
    expect(plan.withheld).toEqual([]);
  });

  it('removes the record alone when no events file sits beside it', () => {
    expect(removeRunStep(runRow('r1', true, false)).argv).toEqual(['rm', '/p/.rafa/runs/r1.json']);
  });

  it('puts the run records after the worktrees and branches, and the force guard lets them through', () => {
    const plan = cleanupSteps(selection({
      runs: [runRow('r1')],
      worktrees: [worktreeRow('/w/a', 'other')],
      merged: [mergedRow('done')],
    }));
    expect(plan.steps.map((step) => step.kind)).toEqual(['remove-worktree', 'delete-branch', 'remove-run']);
    expect(plan.steps.map((step) => forcedFlagRefusal(step.argv))).toEqual([null, null, null]);
  });

  it('prints one --dry-run line per ticked record', () => {
    const plan = cleanupSteps(selection({ runs: [runRow('r1'), runRow('r2', false), runRow('r3', true, false)] }));
    expect(dryRunLines(plan)).toEqual([
      'rm /p/.rafa/runs/r1.json /p/.rafa/runs/r1.events.ndjson',
      'rm /p/.rafa/runs/r3.json',
    ]);
  });

  it('removes both files through the files seam and spawns no git', () => {
    const { git, calls } = scriptedGit();
    const { files, removed } = scriptedFiles();
    const outcomes = runCleanupSteps(git, cleanupSteps(selection({ runs: [runRow('r1')] })), files);
    expect(calls).toEqual([]);
    expect(removed).toEqual(['/p/.rafa/runs/r1.json', '/p/.rafa/runs/r1.events.ndjson']);
    expect(outcomes.map((outcome) => [outcome.ran, outcome.ok, outcome.command, outcome.said])).toEqual([
      [true, true, 'rm /p/.rafa/runs/r1.json /p/.rafa/runs/r1.events.ndjson', ''],
    ]);
  });

  it('keeps the events file when the record cannot be removed, says why, and runs the next record', () => {
    const { git } = scriptedGit();
    const { files, removed } = scriptedFiles(['/p/.rafa/runs/r1.json']);
    const plan = cleanupSteps(selection({ runs: [runRow('r1'), runRow('r2', true, false)] }));
    const outcomes = runCleanupSteps(git, plan, files);
    expect(removed).toEqual(['/p/.rafa/runs/r1.json', '/p/.rafa/runs/r2.json']);
    expect(outcomes.map((outcome) => [outcome.ran, outcome.ok])).toEqual([[true, false], [true, true]]);
    expect(outcomes[0]?.said)
      .toBe('cannot remove /p/.rafa/runs/r1.json: EACCES: permission denied, unlink \'/p/.rafa/runs/r1.json\'');
  });

  it('removes both files from the real disk by default, and says so for a file already gone', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-cleanup-steps-runs-')));
    try {
      const record = join(dir, 'r1.json');
      const events = join(dir, 'r1.events.ndjson');
      writeFileSync(record, '{}\n');
      writeFileSync(events, '{}\n');
      const row = { ...runRow('r1'), path: record, eventsPath: events };
      expect([existsSync(record), existsSync(events)]).toEqual([true, true]);

      const { git } = scriptedGit();
      const outcomes = runCleanupSteps(git, cleanupSteps(selection({ runs: [row] })));
      expect(outcomes.map((outcome) => outcome.ok)).toEqual([true]);
      expect([existsSync(record), existsSync(events)]).toEqual([false, false]);

      const again = runCleanupSteps(git, cleanupSteps(selection({ runs: [row] })));
      expect(again.map((outcome) => outcome.ok)).toEqual([false]);
      expect(again[0]?.said).toStartWith(`cannot remove ${record}: `);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('remote-only steps', () => {
  it('turns a ticked remote-only row into one step, git push origin --delete <name>', () => {
    const plan = cleanupSteps(selection({ remoteOnly: [remoteOnlyRow('old-fix')] }));
    expect(plan.steps).toEqual([{
      kind: 'delete-remote-branch',
      subject: 'old-fix',
      argv: ['git', 'push', 'origin', '--delete', 'old-fix'],
      after: null,
    }]);
    expect(plan.withheld).toEqual([]);
  });

  it('builds no step for an unticked row: only the rows handed over are deleted on origin', () => {
    const listed = [remoteOnlyRow('old-fix'), remoteOnlyRow('spike'), remoteOnlyRow('wip')];
    const ticked = listed.filter((row) => row.name === 'spike');
    const plan = cleanupSteps(selection({ remoteOnly: ticked }));
    expect(plan.steps.map((step) => step.argv.join(' '))).toEqual(['git push origin --delete spike']);
    expect(plan.withheld).toEqual([]);
  });

  it('builds no step when no row was ticked, the field empty or left out', () => {
    expect(cleanupSteps(selection({ remoteOnly: [] }))).toEqual({ steps: [], withheld: [] });
    expect(cleanupSteps(selection({}))).toEqual({ steps: [], withheld: [] });
  });

  it('builds no remote write from any other group, a ticked Stale row with an upstream included', () => {
    const plan = cleanupSteps(selection({
      worktrees: [worktreeRow('/w/a', 'done')],
      merged: [mergedRow('done'), mergedRow('squashed', ['pull-request'])],
      stale: [staleRow('old')],
      notPushed: [notPushedRow('local')],
      runs: [runRow('r1')],
    }));
    expect(plan.steps).toHaveLength(6);
    expect(plan.steps.filter((step) => step.kind === 'delete-remote-branch')).toEqual([]);
    expect(plan.steps.filter((step) => step.argv.includes('push'))).toEqual([]);
  });

  it('control: the same selection with one ticked remote-only row holds exactly one remote write', () => {
    const plan = cleanupSteps(selection({
      worktrees: [worktreeRow('/w/a', 'done')],
      merged: [mergedRow('done'), mergedRow('squashed', ['pull-request'])],
      stale: [staleRow('old')],
      notPushed: [notPushedRow('local')],
      runs: [runRow('r1')],
      remoteOnly: [remoteOnlyRow('old-fix')],
    }));
    expect(plan.steps.filter((step) => step.argv.includes('push')).map((step) => [step.kind, step.subject]))
      .toEqual([['delete-remote-branch', 'old-fix']]);
  });

  it('puts the remote deletes after the local branches and before the run records', () => {
    const plan = cleanupSteps(selection({
      runs: [runRow('r1')],
      remoteOnly: [remoteOnlyRow('old-fix')],
      merged: [mergedRow('done')],
      worktrees: [worktreeRow('/w/a', 'other')],
    }));
    expect(plan.steps.map((step) => step.kind)).toEqual([
      'remove-worktree',
      'delete-branch',
      'delete-remote-branch',
      'remove-run',
    ]);
  });

  it.each([
    ['-f', '-f'],
    ['--force', '--force'],
    ['--force-with-lease', '--force-with-lease'],
    ['--receive-pack=x', '\'--receive-pack=x\''],
    ['-', '-'],
  ])('withholds a row named %s, which git would read as an option, and builds no step for it', (name, quoted) => {
    const plan = cleanupSteps(selection({ remoteOnly: [remoteOnlyRow(name), remoteOnlyRow('old-fix')] }));
    expect(dryRunLines(plan)).toEqual(['git push origin --delete old-fix']);
    expect(plan.withheld).toEqual([{
      kind: 'delete-remote-branch',
      subject: name,
      reason: 'its name opens with `-`, which git reads as an option, not as a branch; to delete it on origin:'
        + ` git push origin --delete -- ${quoted}`,
    }]);
  });

  it('control: a dash inside a name withholds nothing', () => {
    const plan = cleanupSteps(selection({ remoteOnly: [remoteOnlyRow('fix-f'), remoteOnlyRow('a/-f')] }));
    expect(dryRunLines(plan)).toEqual(['git push origin --delete fix-f', 'git push origin --delete a/-f']);
    expect(plan.withheld).toEqual([]);
  });

  it('prints one --dry-run line per ticked row, quoting a name the shell would read', () => {
    const plan = cleanupSteps(selection({ remoteOnly: [remoteOnlyRow('old-fix'), remoteOnlyRow('fix/$HOME'), remoteOnlyRow('+plus')] }));
    expect(dryRunLines(plan)).toEqual([
      'git push origin --delete old-fix',
      'git push origin --delete \'fix/$HOME\'',
      'git push origin --delete \'+plus\'',
    ]);
  });

  it('builds a frozen step', () => {
    const step = deleteRemoteBranchStep('old-fix');
    expect(Object.isFrozen(step)).toBe(true);
    expect(Object.isFrozen(step.argv)).toBe(true);
  });

  it('runs the push through git without its leading git, and a refused one does not stop the rest', () => {
    const refusal = 'error: unable to delete \'gone\': remote ref does not exist';
    const { git, calls } = scriptedGit({ 'push origin --delete gone': said(false, refusal) });
    const { files, removed } = scriptedFiles();
    const plan = cleanupSteps(selection({
      remoteOnly: [remoteOnlyRow('gone'), remoteOnlyRow('old-fix')],
      runs: [runRow('r1', true, false)],
    }));
    const outcomes = runCleanupSteps(git, plan, files);
    expect(calls).toEqual(['push origin --delete gone', 'push origin --delete old-fix']);
    expect(removed).toEqual(['/p/.rafa/runs/r1.json']);
    expect(outcomes.map((outcome) => [outcome.command, outcome.ran, outcome.ok, outcome.said])).toEqual([
      ['git push origin --delete gone', true, false, refusal],
      ['git push origin --delete old-fix', true, true, ''],
      ['rm /p/.rafa/runs/r1.json', true, true, ''],
    ]);
  });

  it.each([
    ['--force'],
    ['--force-with-lease'],
    ['--force-if-includes'],
    ['-f'],
  ])('refuses a remote delete forced with %s without spawning git, and runs the rest', (flag) => {
    const { git, calls } = scriptedGit();
    const forced = Object.freeze({
      ...deleteRemoteBranchStep('old-fix'),
      argv: ['git', 'push', 'origin', '--delete', flag, 'old-fix'],
    });
    const outcomes = runCleanupSteps(git, { steps: [forced, deleteRemoteBranchStep('spike')], withheld: [] });
    expect(calls).toEqual(['push origin --delete spike']);
    expect(outcomes[0]).toMatchObject({
      ran: false,
      ok: false,
      command: `git push origin --delete ${flag} old-fix`,
      said: `rafa cleanup refuses a forced removal: \`${flag}\`. Nothing was run.`,
    });
  });

  it('refuses a step built by hand for a name that is a force flag, without spawning git', () => {
    const { git, calls } = scriptedGit();
    const outcomes = runCleanupSteps(git, { steps: [deleteRemoteBranchStep('--force')], withheld: [] });
    expect(calls).toEqual([]);
    expect(outcomes[0]?.said).toBe('rafa cleanup refuses a forced removal: `--force`. Nothing was run.');
  });

  it('control: the same step without the flag is spawned', () => {
    const { git, calls } = scriptedGit();
    runCleanupSteps(git, { steps: [deleteRemoteBranchStep('old-fix')], withheld: [] });
    expect(calls).toEqual(['push origin --delete old-fix']);
  });
});

describe('runCleanupSteps over a real remote', () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-cleanup-steps-remote-')));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  function sh(cwd: string, ...args: string[]): string {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout;
  }

  /** The identity `git commit-tree` needs in the bare remote, which holds no `user.*` of its own. */
  const IDENTITY = {
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };

  const origin = join(scratch, 'origin.git');
  const repo = join(scratch, 'repo');
  sh(scratch, 'init', '-q', '--bare', '-b', 'main', origin);
  sh(scratch, 'init', '-q', '-b', 'main', repo);
  sh(repo, 'config', 'user.email', 'test@example.com');
  sh(repo, 'config', 'user.name', 'Test');
  sh(repo, 'commit', '-q', '--allow-empty', '-m', 'root');
  sh(repo, 'remote', 'add', 'origin', origin);
  sh(repo, 'push', '-q', 'origin', 'main');
  const tip = sh(repo, 'rev-parse', 'main').trim();
  // Written in the remote itself: `git branch` refuses a name that opens with a dash, a remote does not.
  for (const name of ['old-fix', 'kept', '+plus', 'plus', '-f']) sh(origin, 'update-ref', `refs/heads/${name}`, tip);
  sh(repo, 'fetch', '-q', 'origin');

  /** The branches the remote holds, read in the remote itself. */
  function remoteBranches(): string[] {
    return sh(origin, 'for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads').split('\n')
      .filter((line) => line !== '');
  }

  /**
   * The branches this clone believes the remote holds. `origin/HEAD` is
   * left out: git 2.53.0 wrote it on the fetch above, and whether a
   * fetch writes it depends on the git version.
   */
  function trackedBranches(): string[] {
    return sh(repo, 'for-each-ref', '--format=%(refname:lstrip=3)', 'refs/remotes/origin').split('\n')
      .filter((line) => line !== '' && line !== 'HEAD');
  }

  it('control: the remote holds every branch before any step, the one named -f among them', () => {
    expect(remoteBranches()).toEqual(['+plus', '-f', 'kept', 'main', 'old-fix', 'plus']);
    expect(trackedBranches()).toEqual(['+plus', '-f', 'kept', 'main', 'old-fix', 'plus']);
  });

  it('deletes the ticked branch on the remote and in the clone\'s tracking refs, and no other', () => {
    const plan = cleanupSteps(selection({ remoteOnly: [remoteOnlyRow('old-fix')] }));
    const outcomes = runCleanupSteps(createGitRunner(repo), plan);
    expect(outcomes.map((outcome) => [outcome.command, outcome.ran, outcome.ok])).toEqual([
      ['git push origin --delete old-fix', true, true],
    ]);
    expect(outcomes[0]?.said).toContain(' - [deleted]         old-fix');
    expect(remoteBranches()).toEqual(['+plus', '-f', 'kept', 'main', 'plus']);
    expect(trackedBranches()).toEqual(['+plus', '-f', 'kept', 'main', 'plus']);
  });

  it('reports a branch the remote no longer holds as a step that did not run clean', () => {
    const outcomes = runCleanupSteps(createGitRunner(repo), { steps: [deleteRemoteBranchStep('old-fix')], withheld: [] });
    expect(outcomes.map((outcome) => [outcome.ran, outcome.ok])).toEqual([[true, false]]);
    expect(outcomes[0]?.said).toContain('error: unable to delete \'old-fix\': remote ref does not exist');
    expect(remoteBranches()).toEqual(['+plus', '-f', 'kept', 'main', 'plus']);
  });

  it('deletes a branch whose tip moved on the remote after the fetch: the delete is not conditional', () => {
    const tree = sh(origin, 'rev-parse', `${tip}^{tree}`).trim();
    const moved = spawnSync('git', ['commit-tree', tree, '-p', tip, '-m', 'pushed after the fetch'], {
      cwd: origin,
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C', ...IDENTITY },
    }).stdout.trim();
    sh(origin, 'update-ref', 'refs/heads/kept', moved);
    expect(sh(repo, 'rev-parse', 'refs/remotes/origin/kept').trim()).toBe(tip);
    expect(sh(origin, 'rev-parse', 'refs/heads/kept').trim()).not.toBe(tip);

    const outcomes = runCleanupSteps(createGitRunner(repo), cleanupSteps(selection({ remoteOnly: [remoteOnlyRow('kept')] })));
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true]);
    expect(remoteBranches()).toEqual(['+plus', '-f', 'main', 'plus']);
  });

  it('deletes the branch named +plus and leaves plus: a leading + forces nothing under --delete', () => {
    const outcomes = runCleanupSteps(createGitRunner(repo), cleanupSteps(selection({ remoteOnly: [remoteOnlyRow('+plus')] })));
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true]);
    expect(remoteBranches()).toEqual(['-f', 'main', 'plus']);
  });

  it('leaves a branch named -f on the remote: withheld by the builder, refused unspawned by the guard', () => {
    const plan = cleanupSteps(selection({ remoteOnly: [remoteOnlyRow('-f')] }));
    expect(plan.steps).toEqual([]);
    const outcomes = runCleanupSteps(createGitRunner(repo), { steps: [deleteRemoteBranchStep('-f')], withheld: [] });
    expect(outcomes.map((outcome) => [outcome.ran, outcome.ok])).toEqual([[false, false]]);
    expect(remoteBranches()).toEqual(['-f', 'main', 'plus']);
  });

  it('measures what the withheld reason offers: git reads the bare name as a flag, and -- deletes it', () => {
    const bare = spawnSync('git', ['push', 'origin', '--delete', '-f'], { cwd: repo, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
    expect(bare.status).toBe(128);
    expect(bare.stderr).toContain('fatal: --delete doesn\'t make sense without any refs');
    expect(remoteBranches()).toEqual(['-f', 'main', 'plus']);
    sh(repo, 'push', '-q', 'origin', '--delete', '--', '-f');
    expect(remoteBranches()).toEqual(['main', 'plus']);
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
  sh(repo, 'switch', '-q', '-c', 'past', 'squashed');
  sh(repo, 'commit', '-q', '--allow-empty', '-m', 'fragment past the head');
  sh(repo, 'switch', '-q', 'main');
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

  it('deletes a branch past its pull request\'s head with the -D held fragments allow, which -d refuses', () => {
    const git = createGitRunner(repo);
    const refused = runCleanupSteps(git, { steps: [deleteBranchStep('past', false)], withheld: [] });
    expect(refused[0]?.said).toContain('error: the branch \'past\' is not fully merged');
    const plan = cleanupSteps(selection({ merged: [pastHeadRow('past', [pastCommit('a', 'fragment past the head', true)])] }));
    const outcomes = runCleanupSteps(git, plan);
    expect(outcomes.map((outcome) => [outcome.command, outcome.ok])).toEqual([['git branch -D past', true]]);
    expect(branchExists('past')).toBe(false);
  });

  it('deletes the squash-merged branch with the -D its pull request reading allows', () => {
    const git = createGitRunner(repo);
    const plan = cleanupSteps(selection({ merged: [mergedRow('squashed', ['pull-request'])] }));
    const outcomes = runCleanupSteps(git, plan);
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true]);
    expect(branchExists('squashed')).toBe(false);
  });
});
