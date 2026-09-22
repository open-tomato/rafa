/**
 * Tests for the merge refusals and the clean-up steps
 * (`src/pr/merge.ts`).
 *
 * Everything in that module is pure, so nothing here plants a
 * repository, spawns git or reaches a network: a case builds the
 * reading it wants as a literal and asserts the answer. The point of
 * the module is that the four refusals are cheap to hold, so each one
 * gets a case, and each one gets the SAME reading with the offending
 * input put right as its control — a refusal that fired on a reading
 * which should have passed, or a reading that passed for the wrong
 * input, is what those pairs catch.
 *
 * The parser fixtures are not invented. {@link WORKTREE_LIST} and the
 * status lines are copies of what git 2.50.1 (Apple Git-155) printed on
 * 2026-09-18 in a scratch repository under `/tmp`: a main checkout, a
 * detached one, a linked one holding `feat/ci-gate`, that one locked
 * with a reason, and a staged path with a space in it. That is why the
 * fixtures carry `/private/tmp` paths, a `locked in use` line and a
 * quoted `"src/a b.ts"` — all three are git's own output and all three
 * are what the parsers have to survive.
 *
 * Five mutations of `merge.ts` were driven against this file on
 * 2026-09-18, one at a time, the module restored from a scratch copy
 * and verified with `shasum -c` after each, 40 pass either side:
 *
 *  - the checks verdict read before the merge state: 1 fail, the
 *    conflicting pull request with no checks answering
 *    `checks-not-green`. Only that one case moved, which is why it is
 *    held apart from the plain conflict case above it.
 *  - `mergeable !== 'mergeable'` weakened to
 *    `mergeable === 'conflicting'`, so `unknown` passes: 1 fail.
 *  - `git branch -D` weakened to `-d`: 4 fail.
 *  - `remainingFrom` slicing from `at + 1`, dropping the step that
 *    failed: 4 fail.
 *  - the current worktree no longer excluded from
 *    {@link worktreesHolding}, so a merge refuses its own checkout:
 *    3 fail, two of them the controls on the refusing cases.
 *
 * Three more were driven the same way on 2026-09-22 against the
 * `skipChecks` reading, 48 pass either side:
 *
 *  - the flag allowing every verdict, not `none` alone: 4 fail.
 *  - the flag ignored, so `none` refuses as without it: 6 fail.
 *  - the flag read before the merge state, so a conflicting pull
 *    request reading `none` merges: 2 fail.
 */
import type { CheckRow } from './checks.js';
import type { MergeRefusalReading } from './merge.js';

import { describe, expect, it } from 'bun:test';

import { classifyState } from './checks.js';
import {
  cleanUpSteps,
  commandLine,
  parseWorkingTree,
  parseWorktrees,
  readMergeRefusal,
  remainingFrom,
  worktreesHolding,
} from './merge.js';

/** `git worktree list --porcelain`, as git printed it; see the note. */
const WORKTREE_LIST = [
  'worktree /private/tmp/mergeprobe/main',
  'HEAD 480122d6bf941007bc35aed12de96e5d69601792',
  'branch refs/heads/main',
  '',
  'worktree /private/tmp/mergeprobe/det',
  'HEAD 480122d6bf941007bc35aed12de96e5d69601792',
  'detached',
  '',
  'worktree /private/tmp/mergeprobe/wt',
  'HEAD 480122d6bf941007bc35aed12de96e5d69601792',
  'branch refs/heads/feat/ci-gate',
  'locked in use',
  '',
].join('\n');

const HERE = '/private/tmp/mergeprobe/main';

/** A reading that passes every refusal; each case spoils one input. */
const GREEN: MergeRefusalReading = {
  number: 12,
  branch: 'feat/ci-gate',
  base: 'main',
  tree: parseWorkingTree(''),
  merge: { mergeable: 'mergeable', status: 'CLEAN' },
  checks: 'green',
  worktrees: parseWorktrees('worktree /private/tmp/mergeprobe/main\nbranch refs/heads/main\n'),
  at: HERE,
};

/** A check row as `parseChecks` builds one, from a name and GitHub's state. */
function row(name: string, state: string): CheckRow {
  return { name, state, link: '', outcome: classifyState(state) };
}

describe('parseWorkingTree', () => {
  it('reads a clean tree from the empty answer git gives for one', () => {
    const tree = parseWorkingTree('');
    expect(tree.clean).toBe(true);
    expect(tree.entries).toEqual([]);
  });

  it('keeps each porcelain line as git wrote it, quoting included', () => {
    // Both lines are git 2.50.1 output for a staged path with a space
    // and an untracked file; see the module note.
    const tree = parseWorkingTree('A  "src/a b.ts"\n?? untracked.txt\n');
    expect(tree.clean).toBe(false);
    expect(tree.entries).toEqual(['A  "src/a b.ts"', '?? untracked.txt']);
  });

  it('counts staged, unstaged and untracked lines alike', () => {
    const tree = parseWorkingTree('M  a.ts\n M b.ts\n?? c.ts\n');
    expect(tree.entries).toHaveLength(3);
  });

  it('drops a trailing carriage return rather than keeping it in the line', () => {
    expect(parseWorkingTree('?? a.ts\r\n').entries).toEqual(['?? a.ts']);
  });
});

describe('parseWorktrees', () => {
  it('reads one entry per checkout, with the branch ref stripped', () => {
    expect(parseWorktrees(WORKTREE_LIST)).toEqual([
      { path: '/private/tmp/mergeprobe/main', branch: 'main' },
      { path: '/private/tmp/mergeprobe/det', branch: null },
      { path: '/private/tmp/mergeprobe/wt', branch: 'feat/ci-gate' },
    ]);
  });

  it('reads a bare repository as a checkout holding no branch', () => {
    // git printed exactly these two lines for a bare clone.
    expect(parseWorktrees('worktree /private/tmp/mergeprobe/bare.git\nbare\n')).toEqual([
      { path: '/private/tmp/mergeprobe/bare.git', branch: null },
    ]);
  });

  it('reads nothing from an empty listing', () => {
    expect(parseWorktrees('')).toEqual([]);
  });
});

describe('worktreesHolding', () => {
  const worktrees = parseWorktrees(WORKTREE_LIST);

  it('answers the other checkout that holds the branch', () => {
    expect(worktreesHolding(worktrees, 'feat/ci-gate', HERE))
      .toEqual([{ path: '/private/tmp/mergeprobe/wt', branch: 'feat/ci-gate' }]);
  });

  it('answers nothing when the branch is checked out here', () => {
    // The control on the case above: the same listing, asked from the
    // worktree that holds the branch.
    expect(worktreesHolding(worktrees, 'feat/ci-gate', '/private/tmp/mergeprobe/wt'))
      .toEqual([]);
  });

  it('answers nothing for a branch no checkout holds', () => {
    expect(worktreesHolding(worktrees, 'feat/nothing', HERE)).toEqual([]);
  });

  it('reads a trailing separator on either path as the same path', () => {
    expect(worktreesHolding(worktrees, 'feat/ci-gate', '/private/tmp/mergeprobe/wt/'))
      .toEqual([]);
  });
});

describe('readMergeRefusal', () => {
  it('allows a merge when the tree is clean, the PR green and mergeable', () => {
    expect(readMergeRefusal(GREEN)).toBeNull();
  });

  it('refuses a dirty working tree, naming what is in it', () => {
    const refusal = readMergeRefusal({
      ...GREEN,
      tree: parseWorkingTree('A  "src/a b.ts"\n?? untracked.txt\n'),
    });
    expect(refusal?.reason).toBe('dirty-tree');
    expect(refusal?.message).toContain('the working tree has 2 changes');
    expect(refusal?.message).toContain('A  "src/a b.ts"');
    expect(refusal?.message).toContain('?? untracked.txt');
  });

  it('counts one change in the singular', () => {
    const refusal = readMergeRefusal({ ...GREEN, tree: parseWorkingTree('?? a.ts\n') });
    expect(refusal?.message).toContain('the working tree has 1 change.');
  });

  it('elides a long change list rather than printing the whole tree', () => {
    const lines = Array.from({ length: 14 }, (_, i) => `?? f${String(i)}.ts`).join('\n');
    const refusal = readMergeRefusal({ ...GREEN, tree: parseWorkingTree(lines) });
    expect(refusal?.message).toContain('the working tree has 14 changes');
    expect(refusal?.message).toContain('?? f9.ts');
    expect(refusal?.message).not.toContain('?? f10.ts');
    expect(refusal?.message).toContain('... and 4 more');
  });

  it('refuses a conflicting PR, naming the base and GitHub\'s own word', () => {
    // Green checks and a conflict is the shape a moved base leaves: the
    // rollup is from before it moved. Held apart from the case below so
    // each reads one behaviour.
    const refusal = readMergeRefusal({
      ...GREEN,
      merge: { mergeable: 'conflicting', status: 'DIRTY' },
    });
    expect(refusal?.reason).toBe('not-mergeable');
    expect(refusal?.message).toContain('#12 does not merge into main');
    expect(refusal?.message).toContain('GitHub says conflicting (DIRTY)');
    expect(refusal?.message).toContain('rafa pr triage 12');
  });

  it('names the conflict, not the missing checks, when a conflict caused both', () => {
    // A conflicting PR schedules no workflow run, so its checks read
    // `none`; the module note records why the merge state is read
    // first. This is that reading, held apart from the case above.
    const refusal = readMergeRefusal({
      ...GREEN,
      merge: { mergeable: 'conflicting', status: 'DIRTY' },
      checks: 'none',
    });
    expect(refusal?.reason).toBe('not-mergeable');
    expect(refusal?.message).not.toContain('no checks');
  });

  it('refuses a PR GitHub has not finished computing the merge for', () => {
    const refusal = readMergeRefusal({
      ...GREEN,
      merge: { mergeable: 'unknown', status: 'UNKNOWN' },
    });
    expect(refusal?.reason).toBe('not-mergeable');
    expect(refusal?.message).toContain('is not known to merge into main yet');
    expect(refusal?.message).toContain('GitHub says unknown (UNKNOWN)');
  });

  it('refuses a red PR, pointing at triage', () => {
    const refusal = readMergeRefusal({ ...GREEN, checks: 'red' });
    expect(refusal?.reason).toBe('checks-not-green');
    expect(refusal?.message).toContain('#12 is not green — its checks failed (red)');
    expect(refusal?.message).toContain('Run rafa pr triage 12 to see why.');
  });

  it('refuses a PR whose checks are still running', () => {
    const refusal = readMergeRefusal({ ...GREEN, checks: 'pending' });
    expect(refusal?.reason).toBe('checks-not-green');
    expect(refusal?.message).toContain('its checks are still running (pending)');
  });

  it('refuses a mergeable PR that reports no checks at all', () => {
    const refusal = readMergeRefusal({ ...GREEN, checks: 'none' });
    expect(refusal?.reason).toBe('checks-not-green');
    expect(refusal?.message).toContain('it reports no checks at all (none)');
  });

  it('refuses a branch another worktree holds, naming that worktree', () => {
    const refusal = readMergeRefusal({ ...GREEN, worktrees: parseWorktrees(WORKTREE_LIST) });
    expect(refusal?.reason).toBe('branch-checked-out');
    expect(refusal?.message).toContain('branch feat/ci-gate is checked out in another worktree');
    expect(refusal?.message).toContain('git worktree remove /private/tmp/mergeprobe/wt');
  });

  it('allows the merge when the branch is checked out here and nowhere else', () => {
    // The control on the case above: the same listing, run from the
    // checkout that holds the branch.
    expect(readMergeRefusal({
      ...GREEN,
      worktrees: parseWorktrees(WORKTREE_LIST),
      at: '/private/tmp/mergeprobe/wt',
    })).toBeNull();
  });

  it('quotes a worktree path with a space in the remove line it prints', () => {
    const refusal = readMergeRefusal({
      ...GREEN,
      worktrees: parseWorktrees(
        'worktree /private/tmp/my trees/wt\nbranch refs/heads/feat/ci-gate\n',
      ),
    });
    expect(refusal?.message).toContain('git worktree remove \'/private/tmp/my trees/wt\'');
  });

  it('names every other worktree when several hold the branch', () => {
    const refusal = readMergeRefusal({
      ...GREEN,
      worktrees: parseWorktrees([
        'worktree /private/tmp/a',
        'branch refs/heads/feat/ci-gate',
        '',
        'worktree /private/tmp/b',
        'branch refs/heads/feat/ci-gate',
        '',
      ].join('\n')),
    });
    expect(refusal?.message).toContain('checked out in 2 other worktrees');
    expect(refusal?.message).toContain('git worktree remove /private/tmp/a');
    expect(refusal?.message).toContain('git worktree remove /private/tmp/b');
  });

  it('reports the tree before the PR when both would refuse', () => {
    const refusal = readMergeRefusal({
      ...GREEN,
      tree: parseWorkingTree('?? a.ts\n'),
      checks: 'red',
      merge: { mergeable: 'conflicting', status: 'DIRTY' },
    });
    expect(refusal?.reason).toBe('dirty-tree');
  });
});

describe('readMergeRefusal with skipChecks', () => {
  /** The reading `--skip-checks` is for: mergeable, clean, zero check rows. */
  const UNCHECKED: MergeRefusalReading = { ...GREEN, checks: 'none', rows: [], skipChecks: true };

  it('allows a merge whose checks read none', () => {
    expect(readMergeRefusal(UNCHECKED)).toBeNull();
  });

  it('refuses the same reading without the flag', () => {
    // The control on the case above: only `skipChecks` differs, so the
    // flag is what let it through.
    expect(readMergeRefusal({ ...UNCHECKED, skipChecks: false })?.reason)
      .toBe('checks-not-green');
    expect(readMergeRefusal({ ...GREEN, checks: 'none', rows: [] })?.reason)
      .toBe('checks-not-green');
  });

  it('refuses the flag on a red PR, naming each row and its state', () => {
    const refusal = readMergeRefusal({
      ...UNCHECKED,
      checks: 'red',
      rows: [row('lint', 'SUCCESS'), row('test', 'FAILURE')],
    });
    expect(refusal?.reason).toBe('skip-checks-refused');
    expect(refusal?.message)
      .toContain('--skip-checks is only for a PR that reports no checks at all, and #12 reports checks (red).');
    expect(refusal?.message).toContain('pass    lint — SUCCESS');
    expect(refusal?.message).toContain('fail    test — FAILURE');
    expect(refusal?.message).toContain('without --skip-checks');
  });

  it('refuses the flag on a pending PR, naming each row and its state', () => {
    const refusal = readMergeRefusal({
      ...UNCHECKED,
      checks: 'pending',
      rows: [row('build', 'IN_PROGRESS'), row('lint', 'SUCCESS')],
    });
    expect(refusal?.reason).toBe('skip-checks-refused');
    expect(refusal?.message).toContain('reports checks (pending)');
    expect(refusal?.message).toContain('pending build — IN_PROGRESS');
    expect(refusal?.message).toContain('pass    lint — SUCCESS');
  });

  it('refuses the flag on a green PR, naming each row and its state', () => {
    // Green without the flag merges (the first readMergeRefusal case);
    // this is the flag alone turning it into a refusal.
    const refusal = readMergeRefusal({
      ...UNCHECKED,
      checks: 'green',
      rows: [row('test', 'SUCCESS'), row('docs', 'SKIPPED')],
    });
    expect(refusal?.reason).toBe('skip-checks-refused');
    expect(refusal?.message).toContain('reports checks (green)');
    expect(refusal?.message).toContain('pass    test — SUCCESS');
    expect(refusal?.message).toContain('pass    docs — SKIPPED');
  });

  it('names the verdict alone when no rows were handed in', () => {
    const refusal = readMergeRefusal({ ...UNCHECKED, checks: 'red', rows: undefined });
    expect(refusal?.reason).toBe('skip-checks-refused');
    expect(refusal?.message).toContain('reports checks (red)');
    expect(refusal?.message).not.toContain('no checks reported');
  });

  it('still names the conflict when a conflicting PR reads none', () => {
    // A conflict leaves verdict `none` too; the flag must not turn it
    // into an allowed merge. The allowed case above is its control.
    const refusal = readMergeRefusal({
      ...UNCHECKED,
      merge: { mergeable: 'conflicting', status: 'DIRTY' },
    });
    expect(refusal?.reason).toBe('not-mergeable');
  });

  it('still refuses a dirty tree and a branch held elsewhere', () => {
    expect(readMergeRefusal({ ...UNCHECKED, tree: parseWorkingTree('?? a.ts\n') })?.reason)
      .toBe('dirty-tree');
    expect(readMergeRefusal({ ...UNCHECKED, worktrees: parseWorktrees(WORKTREE_LIST) })?.reason)
      .toBe('branch-checked-out');
  });
});

describe('cleanUpSteps', () => {
  const plan = { branch: 'feat/ci-gate', base: 'main', remoteBranchPresent: true };

  it('orders the five steps the way the merge runs them', () => {
    expect(cleanUpSteps(plan).map((step) => step.id)).toEqual([
      'switch-base',
      'pull-base',
      'delete-local',
      'delete-remote',
      'prune-remotes',
    ]);
  });

  it('runs exactly the commands the clean-up is specified as', () => {
    expect(cleanUpSteps(plan).map((step) => step.argv)).toEqual([
      ['git', 'switch', 'main'],
      ['git', 'pull', '--ff-only'],
      ['git', 'branch', '-D', 'feat/ci-gate'],
      ['git', 'push', 'origin', '--delete', 'feat/ci-gate'],
      ['git', 'fetch', '--prune'],
    ]);
  });

  it('deletes the local branch with -D, since a squash leaves it unmerged', () => {
    const step = cleanUpSteps(plan).find((s) => s.id === 'delete-local');
    expect(step?.argv).toEqual(['git', 'branch', '-D', 'feat/ci-gate']);
  });

  it('leaves the remote delete out when the branch is already gone', () => {
    const steps = cleanUpSteps({ ...plan, remoteBranchPresent: false });
    expect(steps.map((step) => step.id)).toEqual([
      'switch-base',
      'pull-base',
      'delete-local',
      'prune-remotes',
    ]);
  });

  it('pushes the delete to the remote it is given, not always origin', () => {
    const steps = cleanUpSteps({ ...plan, remote: 'upstream' });
    const step = steps.find((s) => s.id === 'delete-remote');
    expect(step?.argv).toEqual(['git', 'push', 'upstream', '--delete', 'feat/ci-gate']);
    expect(step?.label).toBe('delete upstream/feat/ci-gate');
  });

  it('labels each step as the report names it', () => {
    expect(cleanUpSteps(plan).map((step) => step.label)).toEqual([
      'switch to main',
      'pull main, fast-forward only',
      'delete the local branch feat/ci-gate',
      'delete origin/feat/ci-gate',
      'prune deleted remote branches',
    ]);
  });

  it('undoes nothing: no step reverts, resets or force-pushes', () => {
    const words = cleanUpSteps(plan).flatMap((step) => step.argv);
    for (const banned of ['revert', 'reset', '--force', '-f', '--force-with-lease']) {
      expect(words).not.toContain(banned);
    }
  });
});

describe('commandLine', () => {
  const plan = { branch: 'feat/ci gate', base: 'main', remoteBranchPresent: true };

  it('renders a step as one pasteable line', () => {
    const steps = cleanUpSteps({ ...plan, branch: 'feat/ci-gate' });
    expect(steps.map((step) => commandLine(step))).toEqual([
      'git switch main',
      'git pull --ff-only',
      'git branch -D feat/ci-gate',
      'git push origin --delete feat/ci-gate',
      'git fetch --prune',
    ]);
  });

  it('quotes a branch name a shell would split', () => {
    const step = cleanUpSteps(plan).find((s) => s.id === 'delete-local');
    expect(step === undefined
      ? ''
      : commandLine(step)).toBe('git branch -D \'feat/ci gate\'');
  });
});

describe('remainingFrom', () => {
  const steps = cleanUpSteps({
    branch: 'feat/ci-gate',
    base: 'main',
    remoteBranchPresent: true,
  });

  it('keeps the step that failed, since it did not finish', () => {
    expect(remainingFrom(steps, 'delete-local').map((step) => step.id)).toEqual([
      'delete-local',
      'delete-remote',
      'prune-remotes',
    ]);
  });

  it('answers the whole list when the first step failed', () => {
    expect(remainingFrom(steps, 'switch-base')).toHaveLength(steps.length);
  });

  it('answers the last step alone when it failed', () => {
    expect(remainingFrom(steps, 'prune-remotes').map((step) => step.id))
      .toEqual(['prune-remotes']);
  });

  it('answers nothing for a step this plan does not hold', () => {
    const withoutRemote = cleanUpSteps({
      branch: 'feat/ci-gate',
      base: 'main',
      remoteBranchPresent: false,
    });
    expect(remainingFrom(withoutRemote, 'delete-remote')).toEqual([]);
  });

  it('answers commands the operator can paste', () => {
    expect(remainingFrom(steps, 'delete-remote').map((step) => commandLine(step))).toEqual([
      'git push origin --delete feat/ci-gate',
      'git fetch --prune',
    ]);
  });
});
