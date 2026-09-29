/**
 * Tests for `start/checkout-watch.ts`: the expectation a run opens its
 * checkout with, the expected HEAD moved on by the loop's own commits,
 * and the halt run before each dispatch.
 *
 * Every case runs against a real repository under the temporary
 * directory, moved the way a person in another terminal would move it.
 * Each refusal and each halt is paired with the held reading of the same
 * repository before the move, so a watch that always refused or always
 * halted reddens as surely as one that never did. The halt's mark is read
 * back through `findNextTask`, the reader the task's next dispatch goes
 * through, and the operator's lines through a sink output set for each
 * case and unset after it.
 */
import type { CheckoutExpectation } from './checkout-guard.js';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { commitTaskWork } from '../utils/commit.js';
import { findNextTask } from '../utils/tracker.js';

import { CHECKOUT_MOVED } from './checkout-guard.js';
import { advanceExpectation, expectWrapUpCommits, haltIfCheckoutMoved, haltIfWrapUpMoved, openCheckoutExpectation } from './checkout-watch.js';

/** The branch every case's run holds. */
const BRANCH = 'feat/rafa-370';

/** A tracker with one done task and the open one about to be dispatched, on line 1. */
const TRACKER = '- [x] The task before\n- [ ] Run the guard before each dispatch\n';

/** The line of the task about to be dispatched. */
const NEXT_TASK = { lineNum: 1 };

let scratch = '';

/** Runs git in `cwd` under `LC_ALL=C`, answering its trimmed stdout. */
function git(cwd: string, args: readonly string[]): string {
  return execFileSync(
    'git',
    [...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } },
  ).trim();
}

/** A fresh repository on `main` with one commit, and the loop's branch cut from it. */
function repository(name: string): string {
  const root = join(scratch, name);
  mkdirSync(root);
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'watch@example.invalid']);
  git(root, ['config', 'user.name', 'watch']);
  writeFileSync(join(root, 'f.txt'), 'one\n');
  git(root, ['add', 'f.txt']);
  git(root, ['commit', '-q', '-m', 'one']);
  git(root, ['switch', '-q', '-c', BRANCH]);
  return root;
}

/** A main-checkout loop's expectation, opened in `root`. */
function openIn(root: string): CheckoutExpectation {
  return openCheckoutExpectation({ projectRoot: root, checkout: root, branch: BRANCH });
}

/** The refusal `open` threw, or a failure when it threw none. */
function refusalOf(open: () => unknown): CommandExit {
  try {
    open();
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('the expectation opened where a refusal was expected');
}

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-checkout-watch-')));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('openCheckoutExpectation', () => {
  it('opens at the branch and the HEAD the checkout stands on', () => {
    const root = repository('open');
    const expected = openIn(root);
    expect(expected).toEqual({ projectRoot: root, checkout: root, branch: BRANCH, head: git(root, ['rev-parse', 'HEAD']) });
    expect(Object.isFrozen(expected)).toBe(true);
  });

  it('refuses a detached HEAD, which it opens once the branch is checked out again', () => {
    const root = repository('detached');
    git(root, ['switch', '-q', '--detach']);
    const refusal = refusalOf(() => openIn(root));
    expect(refusal.exitCode).toBe(1);
    expect(refusal.message).toBe(`❌ Refusing to start: the loop guard cannot hold this checkout: ${root} is at a detached HEAD, on no branch.`);

    git(root, ['switch', '-q', BRANCH]);
    expect(openIn(root).branch).toBe(BRANCH);
  });

  it('refuses a checkout on another branch than the run names', () => {
    const root = repository('other-branch');
    git(root, ['switch', '-q', 'main']);
    expect(refusalOf(() => openIn(root)).message).toContain(`${root} is on main, not ${BRANCH}.`);
  });

  it('refuses a branch with no commit yet', () => {
    const root = join(scratch, 'unborn');
    mkdirSync(root);
    git(root, ['init', '-q', '-b', BRANCH]);
    expect(refusalOf(() => openIn(root)).message).toContain(`${BRANCH} has no commit yet.`);
  });

  it('refuses a checkout that is not there, and one that is no checkout of its own', () => {
    const gone = join(scratch, 'never-made');
    expect(refusalOf(() => openCheckoutExpectation({ projectRoot: gone, checkout: gone, branch: BRANCH })).message)
      .toContain(`${gone} does not exist.`);

    const plain = join(repository('host'), 'plain-dir');
    mkdirSync(plain);
    expect(refusalOf(() => openCheckoutExpectation({ projectRoot: plain, checkout: plain, branch: BRANCH })).message)
      .toContain(`${plain} is no git checkout of its own.`);
  });
});

describe('advanceExpectation', () => {
  const expected: CheckoutExpectation = Object.freeze({ projectRoot: '/p', checkout: '/p', branch: BRANCH, head: 'a'.repeat(40) });
  const sha = 'b'.repeat(40);

  it('moves the expected HEAD to the commit an attempt made, leaving the old expectation as it was', () => {
    const advanced = advanceExpectation(expected, { outcome: 'committed', sha });
    expect(advanced).toEqual({ ...expected, head: sha });
    expect(expected.head).toBe('a'.repeat(40));
  });

  it('keeps it where it was when no commit was made, or git did not name the one it made', () => {
    expect(advanceExpectation(expected, { outcome: 'nothing-to-commit', sha: null })).toBe(expected);
    expect(advanceExpectation(expected, { outcome: 'failed', sha: null })).toBe(expected);
    expect(advanceExpectation(expected, { outcome: 'committed', sha: null })).toBe(expected);
  });
});

describe('haltIfCheckoutMoved', () => {
  let errors: string[] = [];
  let infos: string[] = [];

  beforeEach(() => {
    errors = [];
    infos = [];
    setActiveOutput(sinkOutput({
      error: (line) => errors.push(line),
      info: (line) => infos.push(line),
    }));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  /** A tracker beside the repository, as `.rafa/plans` holds it under the project root. */
  const trackerIn = (name: string): string => {
    const path = join(scratch, `${name}-TRACKER.md`);
    writeFileSync(path, TRACKER);
    return path;
  };

  it('dispatches on, writing and printing nothing, while the checkout holds', () => {
    const root = repository('held');
    const trackerPath = trackerIn('held');
    const halted = haltIfCheckoutMoved({ expected: openIn(root), trackerPath, taskInfo: NEXT_TASK });
    expect(halted).toBe(false);
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
    expect([...errors, ...infos]).toEqual([]);
  });

  it('halts on a branch switched under the loop, marking the task and leaving the checkout and its edits alone', () => {
    const root = repository('incident');
    const trackerPath = trackerIn('incident');
    const expected = openIn(root);
    writeFileSync(join(root, 'f.txt'), 'the loop\'s edit\n');
    git(root, ['switch', '-q', 'main']);

    expect(haltIfCheckoutMoved({ expected, trackerPath, taskInfo: NEXT_TASK })).toBe(true);
    expect(findNextTask(readFileSync(trackerPath, 'utf8'))).toEqual({
      task: 'Run the guard before each dispatch',
      lineNum: 1,
      status: 'blocked',
      blocker: CHECKOUT_MOVED,
    });
    expect(errors).toEqual([
      `\n⛔ Run halted: ${CHECKOUT_MOVED} in ${root}. Nothing was committed.`,
      `   Expected: ${BRANCH} at ${expected.head.slice(0, 12)}`,
      `   Found:    main at ${expected.head.slice(0, 12)}`,
      `   Restore:  git switch ${BRANCH}`,
      '   Uncommitted work was left where it is; the checkout was not switched back.',
      `   Task marked as blocked on ${CHECKOUT_MOVED}; nothing was dispatched. Restore the checkout, then run again.`,
    ]);
    expect(git(root, ['symbolic-ref', '--short', 'HEAD'])).toBe('main');
    expect(readFileSync(join(root, 'f.txt'), 'utf8')).toBe('the loop\'s edit\n');
    expect(git(root, ['rev-list', '--count', '--all'])).toBe('1');
  });

  it('holds after the loop\'s own commit once the expectation is advanced, and halts on the stale one', () => {
    const root = repository('own-commit');
    const trackerPath = trackerIn('own-commit');
    const expected = openIn(root);
    writeFileSync(join(root, 'f.txt'), 'the task\'s work\n');
    git(root, ['commit', '-q', '-am', 'the loop\'s own']);
    const advanced = advanceExpectation(expected, { outcome: 'committed', sha: git(root, ['rev-parse', 'HEAD']) });

    expect(haltIfCheckoutMoved({ expected: advanced, trackerPath, taskInfo: NEXT_TASK })).toBe(false);
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);

    expect(haltIfCheckoutMoved({ expected, trackerPath, taskInfo: NEXT_TASK })).toBe(true);
    expect(errors).toContain(`   Restore:  git reset --soft ${expected.head}`);
  });

  it('holds after a commit made through the loop\'s own commit helper, advanced from the attempt it answers', () => {
    const root = repository('helper-commit');
    const trackerPath = trackerIn('helper-commit');
    const expected = openIn(root);
    writeFileSync(join(root, 'f.txt'), 'the helper\'s work\n');
    const attempt = commitTaskWork({ taskText: 'Add the helper\'s work', cwd: root });
    expect(attempt.outcome).toBe('committed');

    const advanced = advanceExpectation(expected, attempt);
    expect(advanced.head).toBe(git(root, ['rev-parse', 'HEAD']));
    expect(haltIfCheckoutMoved({ expected: advanced, trackerPath, taskInfo: NEXT_TASK })).toBe(false);
    expect(haltIfCheckoutMoved({ expected, trackerPath, taskInfo: NEXT_TASK })).toBe(true);
  });

  it('halts on a worktree removed under its loop, and recreates nothing', () => {
    const root = repository('worktree-root');
    git(root, ['switch', '-q', 'main']);
    const checkout = join(scratch, 'worktree-removed');
    git(root, ['worktree', 'add', '-q', checkout, BRANCH]);
    const trackerPath = trackerIn('worktree-removed');
    const expected = openCheckoutExpectation({ projectRoot: root, checkout, branch: BRANCH });
    expect(haltIfCheckoutMoved({ expected, trackerPath, taskInfo: NEXT_TASK })).toBe(false);

    rmSync(checkout, { recursive: true, force: true });
    expect(haltIfCheckoutMoved({ expected, trackerPath, taskInfo: NEXT_TASK })).toBe(true);
    expect(existsSync(checkout)).toBe(false);
    expect(findNextTask(readFileSync(trackerPath, 'utf8'))?.blocker).toBe(CHECKOUT_MOVED);
    expect(errors[2]).toBe(`   Found:    no checkout: ${checkout} does not exist`);
    expect(errors[3]).toContain(`worktree add ${checkout} ${BRANCH}`);
  });

  it('replaces the blocker text an earlier run left on the task, rather than adding a second', () => {
    const root = repository('reblocked');
    const trackerPath = join(scratch, 'reblocked-TRACKER.md');
    writeFileSync(trackerPath, '- [x] The task before\n- [BLOCKED] Run the guard before each dispatch  <!-- blocked: budget exceeded -->\n');
    const expected = openIn(root);
    git(root, ['switch', '-q', 'main']);

    expect(haltIfCheckoutMoved({ expected, trackerPath, taskInfo: NEXT_TASK })).toBe(true);
    expect(readFileSync(trackerPath, 'utf8').split('\n')[1]).toBe(`- [BLOCKED] Run the guard before each dispatch  <!-- blocked: ${CHECKOUT_MOVED} -->`);
  });
});

describe('haltIfCheckoutMoved before a task commit', () => {
  let errors: string[] = [];

  beforeEach(() => {
    errors = [];
    setActiveOutput(sinkOutput({ error: (line) => errors.push(line) }));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  /** A tracker beside the repository, as `.rafa/plans` holds it under the project root. */
  const trackerIn = (name: string): string => {
    const path = join(scratch, `${name}-TRACKER.md`);
    writeFileSync(path, TRACKER);
    return path;
  };

  it('lets the commit go on while the checkout holds, and halts on the same work once a commit is made outside the loop', () => {
    const root = repository('commit-held');
    const trackerPath = trackerIn('commit-held');
    const expected = openIn(root);
    writeFileSync(join(root, 'f.txt'), 'the session\'s work\n');

    expect(haltIfCheckoutMoved({ expected, trackerPath, taskInfo: NEXT_TASK, before: 'commit' })).toBe(false);
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
    expect(errors).toEqual([]);

    writeFileSync(join(root, 'other.txt'), 'by hand\n');
    git(root, ['add', 'other.txt']);
    git(root, ['commit', '-q', '-m', 'made in another terminal']);
    const outside = git(root, ['rev-parse', 'HEAD']);

    expect(haltIfCheckoutMoved({ expected, trackerPath, taskInfo: NEXT_TASK, before: 'commit' })).toBe(true);
    expect(findNextTask(readFileSync(trackerPath, 'utf8'))?.blocker).toBe(CHECKOUT_MOVED);
    expect(errors).toEqual([
      `\n⛔ Run halted: ${CHECKOUT_MOVED} in ${root}. Nothing was committed.`,
      `   Expected: ${BRANCH} at ${expected.head.slice(0, 12)}`,
      `   Found:    ${BRANCH} at ${outside.slice(0, 12)}`,
      `   Restore:  git reset --soft ${expected.head}`,
      '   Uncommitted work was left where it is; the checkout was not switched back.',
      `   Task marked as blocked on ${CHECKOUT_MOVED}; its session's work was left uncommitted. Restore the checkout, then run again to retry the task.`,
    ]);
    expect(readFileSync(join(root, 'f.txt'), 'utf8')).toBe('the session\'s work\n');
    expect(git(root, ['status', '--porcelain'])).toBe('M f.txt');
    expect(git(root, ['rev-parse', 'HEAD'])).toBe(outside);
  });

  it('holds across two task commits the loop made, advanced from each attempt, and halts on a branch switched after the second', () => {
    const root = repository('two-commits');
    const trackerPath = trackerIn('two-commits');
    let expected = openIn(root);

    for (const text of ['first', 'second']) {
      writeFileSync(join(root, 'f.txt'), `${text}\n`);
      expect(haltIfCheckoutMoved({ expected, trackerPath, taskInfo: NEXT_TASK, before: 'commit' })).toBe(false);
      expected = advanceExpectation(expected, commitTaskWork({ taskText: `Write the ${text} line`, cwd: root }));
      expect(haltIfCheckoutMoved({ expected, trackerPath, taskInfo: NEXT_TASK })).toBe(false);
    }
    expect(expected.head).toBe(git(root, ['rev-parse', 'HEAD']));
    expect(git(root, ['rev-list', '--count', 'HEAD'])).toBe('3');

    writeFileSync(join(root, 'f.txt'), 'the third task\'s work\n');
    git(root, ['switch', '-q', '-c', 'elsewhere']);
    expect(haltIfCheckoutMoved({ expected, trackerPath, taskInfo: NEXT_TASK, before: 'commit' })).toBe(true);
    expect(errors[2]).toBe(`   Found:    elsewhere at ${expected.head.slice(0, 12)}`);
    expect(errors[3]).toBe(`   Restore:  git switch ${BRANCH}`);
    expect(git(root, ['rev-list', '--count', 'elsewhere'])).toBe('3');
  });

  it('halts on a commit the task\'s own session made, which the loop never advanced to', () => {
    const root = repository('session-commit');
    const trackerPath = trackerIn('session-commit');
    const expected = openIn(root);
    writeFileSync(join(root, 'f.txt'), 'committed by the session\n');
    git(root, ['commit', '-q', '-am', 'the session committed']);

    expect(haltIfCheckoutMoved({ expected, trackerPath, taskInfo: NEXT_TASK, before: 'commit' })).toBe(true);
    expect(errors.at(-1)).toContain('its session\'s work was left uncommitted');
  });
});

describe('the guard around the wrap-up', () => {
  let errors: string[] = [];

  beforeEach(() => {
    errors = [];
    setActiveOutput(sinkOutput({ error: (line) => errors.push(line) }));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  it('dispatches the wrap-up while the checkout holds, and halts it on a switched branch, writing no tracker', () => {
    const root = repository('wrap-up-dispatch');
    const expected = openIn(root);
    expect(haltIfWrapUpMoved({ expected, before: 'dispatch' })).toBe(false);
    expect(errors).toEqual([]);

    git(root, ['switch', '-q', 'main']);
    expect(haltIfWrapUpMoved({ expected, before: 'dispatch' })).toBe(true);
    expect(errors[0]).toBe(`\n⛔ Run halted: ${CHECKOUT_MOVED} in ${root}. Nothing was committed.`);
    expect(errors[3]).toBe(`   Restore:  git switch ${BRANCH}`);
    expect(errors.at(-1)).toBe('   The wrap-up was not started. Restore the checkout, then run again to retry the wrap-up.');
    expect(git(root, ['symbolic-ref', '--short', 'HEAD'])).toBe('main');
  });

  it('halts the wrap-up on a commit made outside the loop since its last task commit', () => {
    const root = repository('wrap-up-outside');
    const expected = openIn(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'by hand']);
    expect(haltIfWrapUpMoved({ expected, before: 'dispatch' })).toBe(true);
    expect(errors[3]).toBe(`   Restore:  git reset --soft ${expected.head}`);
  });

  it('re-bases the release commit\'s expectation on the commits the wrap-up session left on the run\'s branch', () => {
    const root = repository('wrap-up-commits');
    const expected = openIn(root);
    expect(expectWrapUpCommits(expected)).toBe(expected);

    writeFileSync(join(root, 'f.txt'), 'promoted\n');
    git(root, ['commit', '-q', '-am', 'docs: promote the findings']);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'Merge main']);
    const rebased = expectWrapUpCommits(expected);

    expect(rebased).toEqual({ ...expected, head: git(root, ['rev-parse', 'HEAD']) });
    expect(Object.isFrozen(rebased)).toBe(true);
    expect(expected.head).not.toBe(rebased.head);
    expect(haltIfWrapUpMoved({ expected: rebased, before: 'release' })).toBe(false);
    expect(haltIfWrapUpMoved({ expected, before: 'release' })).toBe(true);
    expect(errors).not.toEqual([]);
  });

  it('keeps the expectation on a switched branch, so the release commit halts, headlined as the release not committed', () => {
    const root = repository('wrap-up-switched');
    const expected = openIn(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'the session\'s commit']);
    git(root, ['switch', '-q', 'main']);

    const kept = expectWrapUpCommits(expected);
    expect(kept).toBe(expected);
    expect(haltIfWrapUpMoved({ expected: kept, before: 'release' })).toBe(true);
    expect(errors[0]).toBe(`\n⛔ Run halted: ${CHECKOUT_MOVED} in ${root}. The release was not committed.`);
    expect(errors[1]).toBe(`   Expected: ${BRANCH} at ${expected.head.slice(0, 12)}`);
    expect(errors[2]).toBe(`   Found:    main at ${expected.head.slice(0, 12)}`);
    expect(errors[3]).toMatch(/^ {3}Restore: {2}git stash push -u -m .+ && git switch feat\/rafa-370$/);
    expect(errors.at(-1)).toBe('   The wrap-up session\'s own commits stand; the release commit, its push and the CI wait were skipped. Restore the checkout, then run again to retry the wrap-up.');
    expect(git(root, ['symbolic-ref', '--short', 'HEAD'])).toBe('main');
  });

  it('halts the release commit on a worktree removed under its loop, and recreates nothing', () => {
    const root = repository('wrap-up-root');
    git(root, ['switch', '-q', 'main']);
    const checkout = join(scratch, 'wrap-up-worktree');
    git(root, ['worktree', 'add', '-q', checkout, BRANCH]);
    const expected = openCheckoutExpectation({ projectRoot: root, checkout, branch: BRANCH });
    expect(haltIfWrapUpMoved({ expected: expectWrapUpCommits(expected), before: 'release' })).toBe(false);

    rmSync(checkout, { recursive: true, force: true });
    const kept = expectWrapUpCommits(expected);
    expect(kept).toBe(expected);
    expect(haltIfWrapUpMoved({ expected: kept, before: 'release' })).toBe(true);
    expect(existsSync(checkout)).toBe(false);
    expect(errors[2]).toBe(`   Found:    no checkout: ${checkout} does not exist`);
  });
});
