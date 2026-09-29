/**
 * Tests for `start/checkout-guard.ts`: reading a checkout's branch and
 * HEAD, comparing them with the pair the run holds, and the `checkout
 * moved` lines with their restore command.
 *
 * The pure half (`compareCheckout`, `restoreLine`, `checkoutMovedLines`)
 * is driven with planted readings. The reading half runs against real
 * repositories under the temporary directory, each case moving the
 * checkout the way a person in another terminal would. Every halt is
 * paired with the held reading it was moved from, so a guard that
 * always halted and one that never did both redden, and every restore
 * line a case asserts is then RUN in a shell, after which the guard
 * must hold again: the line is proven to restore, not only to read
 * right. The diverged case also runs a plain `git switch` first and
 * expects git to refuse it, the control for why that line stashes.
 */
import type { CheckoutExpectation, CheckoutReading } from './checkout-guard.js';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  CHECKOUT_MOVED,
  checkoutMovedLines,
  compareCheckout,
  guardCheckout,
  readCheckout,
  restoreLine,
} from './checkout-guard.js';

/** A full commit the pure cases expect HEAD at. */
const HEAD_A = 'a'.repeat(40);

/** A second full commit, where something else left HEAD. */
const HEAD_B = 'b'.repeat(40);

/** The branch every case's run holds. */
const BRANCH = 'feat/rafa-370';

/** A project root the pure cases name. */
const ROOT = join('/', 'nonesuch', 'project');

/** A worktree checkout under it. */
const WORKTREE = join(ROOT, '.rafa', 'worktrees', 'rafa-370');

/** The expectation the pure cases vary: a worktree loop on its branch at HEAD_A. */
const EXPECTED: CheckoutExpectation = { projectRoot: ROOT, checkout: WORKTREE, branch: BRANCH, head: HEAD_A };

/** A reading of a checkout on `branch` at `head`. */
function read(branch: string | null, head: string | null): CheckoutReading {
  return { kind: 'read', branch, head };
}

describe('compareCheckout', () => {
  it('holds a checkout on the expected branch at the expected HEAD', () => {
    expect(compareCheckout(EXPECTED, read(BRANCH, HEAD_A))).toBeNull();
  });

  it('names a moved branch, before a HEAD that moved with it', () => {
    expect(compareCheckout(EXPECTED, read('main', HEAD_A))).toBe('branch');
    expect(compareCheckout(EXPECTED, read('main', HEAD_B))).toBe('branch');
  });

  it('reads a detached HEAD as a moved branch, even at the expected commit', () => {
    expect(compareCheckout(EXPECTED, read(null, HEAD_A))).toBe('branch');
  });

  it('names a HEAD that moved on the expected branch, and one with no commit', () => {
    expect(compareCheckout(EXPECTED, read(BRANCH, HEAD_B))).toBe('head');
    expect(compareCheckout(EXPECTED, read(BRANCH, null))).toBe('head');
  });

  it('passes a missing and a foreign checkout through as their own moves', () => {
    expect(compareCheckout(EXPECTED, { kind: 'missing' })).toBe('missing');
    expect(compareCheckout(EXPECTED, { kind: 'foreign', toplevel: ROOT })).toBe('foreign');
  });
});

describe('restoreLine', () => {
  it('switches back alone when the found HEAD is the expected branch\'s tip', () => {
    const line = restoreLine({ expected: EXPECTED, move: 'branch', reading: read('main', HEAD_A), branchTip: HEAD_A });
    expect(line).toBe(`git switch ${BRANCH}`);
  });

  it('stashes first when the found HEAD is another commit', () => {
    const line = restoreLine({ expected: EXPECTED, move: 'branch', reading: read('main', HEAD_B), branchTip: HEAD_A });
    expect(line).toBe(`git stash push -u -m 'rafa: ${CHECKOUT_MOVED} off ${BRANCH}' && git switch ${BRANCH}`);
  });

  it('recreates a deleted branch at the expected HEAD, stashing only when HEAD differs', () => {
    expect(restoreLine({ expected: EXPECTED, move: 'branch', reading: read('main', HEAD_A), branchTip: null }))
      .toBe(`git switch -c ${BRANCH} ${HEAD_A}`);
    expect(restoreLine({ expected: EXPECTED, move: 'branch', reading: read('main', HEAD_B), branchTip: null }))
      .toBe(`git stash push -u -m 'rafa: ${CHECKOUT_MOVED} off ${BRANCH}' && git switch -c ${BRANCH} ${HEAD_A}`);
  });

  it('soft-resets a HEAD that moved on the right branch', () => {
    const line = restoreLine({ expected: EXPECTED, move: 'head', reading: read(BRANCH, HEAD_B), branchTip: null });
    expect(line).toBe(`git reset --soft ${HEAD_A}`);
  });

  it('re-adds a missing worktree from the project root, quoting a path with a space', () => {
    const expected = { ...EXPECTED, checkout: join(ROOT, 'my trees', 'x') };
    const line = restoreLine({ expected, move: 'missing', reading: { kind: 'missing' }, branchTip: null });
    expect(line).toBe(`git -C ${ROOT} worktree prune && git -C ${ROOT} worktree add '${join(ROOT, 'my trees', 'x')}' ${BRANCH}`);
  });

  it('offers nothing for a missing project root or a foreign directory', () => {
    const mainLoop = { ...EXPECTED, checkout: ROOT };
    expect(restoreLine({ expected: mainLoop, move: 'missing', reading: { kind: 'missing' }, branchTip: null })).toBeNull();
    expect(restoreLine({ expected: EXPECTED, move: 'foreign', reading: { kind: 'foreign', toplevel: ROOT }, branchTip: null })).toBeNull();
  });
});

describe('checkoutMovedLines', () => {
  it('names the reason, the expected branch, the found branch and the restore line', () => {
    const lines = checkoutMovedLines({ expected: EXPECTED, move: 'branch', reading: read('main', HEAD_A), branchTip: HEAD_A });
    expect(lines).toEqual([
      `⛔ Run halted: ${CHECKOUT_MOVED} in ${WORKTREE}. Nothing was committed.`,
      `   Expected: ${BRANCH} at aaaaaaaaaaaa`,
      '   Found:    main at aaaaaaaaaaaa',
      `   Restore:  git switch ${BRANCH}`,
      '   Uncommitted work was left where it is; the checkout was not switched back.',
    ]);
  });

  it('names a detached HEAD, a missing directory and a foreign one in the found line', () => {
    const found = (reading: CheckoutReading): string | undefined => {
      const move = compareCheckout(EXPECTED, reading) ?? 'head';
      return checkoutMovedLines({ expected: EXPECTED, move, reading, branchTip: HEAD_A })[2];
    };
    expect(found(read(null, HEAD_B))).toBe('   Found:    a detached HEAD at bbbbbbbbbbbb');
    expect(found({ kind: 'missing' })).toBe(`   Found:    no checkout: ${WORKTREE} does not exist`);
    expect(found({ kind: 'foreign', toplevel: ROOT })).toBe(`   Found:    no checkout of its own: git answers ${ROOT} from inside ${WORKTREE}`);
    expect(found({ kind: 'foreign', toplevel: null })).toBe(`   Found:    no git checkout at ${WORKTREE}`);
  });

  it('says so when no command restores the checkout', () => {
    const lines = checkoutMovedLines({ expected: EXPECTED, move: 'foreign', reading: { kind: 'foreign', toplevel: null }, branchTip: null });
    expect(lines[3]).toBe('   No git command restores it; the loop did not touch it.');
  });
});

describe('guardCheckout over real repositories', () => {
  let scratch = '';

  /** Runs git in `cwd` under `LC_ALL=C`, answering its trimmed stdout. */
  const git = (cwd: string, args: readonly string[]): string => execFileSync(
    'git',
    [...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } },
  ).trim();

  /** Runs a restore line the way an operator pastes it, in `cwd`. */
  const shell = (cwd: string, line: string): void => {
    execFileSync('/bin/sh', ['-c', line], { cwd, stdio: 'ignore', env: { ...process.env, LC_ALL: 'C' } });
  };

  /** A fresh repository on `main` with one commit, and the loop's branch cut from it. */
  const repository = (name: string): string => {
    const root = join(scratch, name);
    mkdirSync(root);
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', 'user.email', 'guard@example.invalid']);
    git(root, ['config', 'user.name', 'guard']);
    writeFileSync(join(root, 'f.txt'), 'one\n');
    git(root, ['add', 'f.txt']);
    git(root, ['commit', '-q', '-m', 'one']);
    git(root, ['switch', '-q', '-c', BRANCH]);
    return root;
  };

  /** The expectation of a main-checkout loop on its branch at the current HEAD. */
  const expectationIn = (root: string): CheckoutExpectation => ({
    projectRoot: root,
    checkout: root,
    branch: BRANCH,
    head: git(root, ['rev-parse', 'HEAD']),
  });

  /** The verdict's lines, or a failure when it held. */
  const linesOf = (verdict: ReturnType<typeof guardCheckout>): readonly string[] => {
    if (verdict.held) throw new Error('the guard held where a move was expected');
    return verdict.lines;
  };

  /** The move a verdict names, or null when it held. */
  const moveOf = (verdict: ReturnType<typeof guardCheckout>): string | null => {
    if (verdict.held) return null;
    return verdict.move;
  };

  /** The restore command in a halt's lines. */
  const restoreIn = (lines: readonly string[]): string => {
    const line = lines.find((entry) => entry.startsWith('   Restore:  '));
    if (line === undefined) throw new Error(`no restore line in ${lines.join('\n')}`);
    return line.slice('   Restore:  '.length);
  };

  beforeAll(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-checkout-guard-')));
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('holds where the run left the checkout, and holds again after the loop advances its expected HEAD', () => {
    const root = repository('own-commit');
    const expected = expectationIn(root);
    expect(guardCheckout(expected)).toEqual({ held: true });

    writeFileSync(join(root, 'f.txt'), 'two\n');
    git(root, ['commit', '-q', '-am', 'the loop\'s own']);
    const stale = guardCheckout(expected);
    expect(moveOf(stale)).toBe('head');
    expect(guardCheckout({ ...expected, head: git(root, ['rev-parse', 'HEAD']) })).toEqual({ held: true });
  });

  it('halts on the 2026-09-29 incident, and its switch line restores the checkout with the edits', () => {
    const root = repository('incident');
    const expected = expectationIn(root);
    writeFileSync(join(root, 'f.txt'), 'the loop\'s edit\n');
    git(root, ['switch', '-q', 'main']);

    const verdict = guardCheckout(expected);
    expect(moveOf(verdict)).toBe('branch');
    const lines = linesOf(verdict);
    expect(lines[2]).toBe(`   Found:    main at ${expected.head.slice(0, 12)}`);
    expect(restoreIn(lines)).toBe(`git switch ${BRANCH}`);
    expect(git(root, ['symbolic-ref', '--short', 'HEAD'])).toBe('main');

    shell(root, restoreIn(lines));
    expect(guardCheckout(expected)).toEqual({ held: true });
    expect(readFileSync(join(root, 'f.txt'), 'utf8')).toBe('the loop\'s edit\n');
  });

  it('stashes before switching when the found branch is another commit, where a plain switch is refused', () => {
    const root = repository('diverged');
    const expected = expectationIn(root);
    git(root, ['switch', '-q', 'main']);
    writeFileSync(join(root, 'f.txt'), 'main moved\n');
    git(root, ['commit', '-q', '-am', 'main moved']);
    writeFileSync(join(root, 'f.txt'), 'an edit on main\n');

    const lines = linesOf(guardCheckout(expected));
    const restore = restoreIn(lines);
    expect(restore).toBe(`git stash push -u -m 'rafa: ${CHECKOUT_MOVED} off ${BRANCH}' && git switch ${BRANCH}`);
    expect(() => git(root, ['switch', '-q', BRANCH])).toThrow();

    shell(root, restore);
    expect(guardCheckout(expected)).toEqual({ held: true });
    expect(git(root, ['stash', 'list'])).toContain(`rafa: ${CHECKOUT_MOVED} off ${BRANCH}`);
  });

  it('halts on a commit made outside the loop, and its soft reset restores HEAD with the change kept', () => {
    const root = repository('outside-commit');
    const expected = expectationIn(root);
    writeFileSync(join(root, 'f.txt'), 'by hand\n');
    git(root, ['commit', '-q', '-am', 'by hand']);

    const verdict = guardCheckout(expected);
    expect(moveOf(verdict)).toBe('head');
    const restore = restoreIn(linesOf(verdict));
    expect(restore).toBe(`git reset --soft ${expected.head}`);

    shell(root, restore);
    expect(guardCheckout(expected)).toEqual({ held: true });
    expect(readFileSync(join(root, 'f.txt'), 'utf8')).toBe('by hand\n');
  });

  it('reads a detached HEAD at the expected commit as a moved branch', () => {
    const root = repository('detached');
    const expected = expectationIn(root);
    git(root, ['switch', '-q', '--detach', 'HEAD']);

    const lines = linesOf(guardCheckout(expected));
    expect(lines[2]).toBe(`   Found:    a detached HEAD at ${expected.head.slice(0, 12)}`);
    expect(restoreIn(lines)).toBe(`git switch ${BRANCH}`);
  });

  it('recreates a deleted branch where the loop left it', () => {
    const root = repository('deleted-branch');
    const expected = expectationIn(root);
    git(root, ['switch', '-q', 'main']);
    git(root, ['branch', '-q', '-D', BRANCH]);

    const restore = restoreIn(linesOf(guardCheckout(expected)));
    expect(restore).toBe(`git switch -c ${BRANCH} ${expected.head}`);
    shell(root, restore);
    expect(guardCheckout(expected)).toEqual({ held: true });
  });

  it('halts on a removed worktree without recreating it, and its line re-adds it', () => {
    const root = repository('removed');
    git(root, ['switch', '-q', 'main']);
    const tree = join(scratch, 'removed-tree');
    git(root, ['worktree', 'add', '-q', tree, BRANCH]);
    const expected = { ...expectationIn(tree), projectRoot: root };
    expect(guardCheckout(expected)).toEqual({ held: true });

    rmSync(tree, { recursive: true, force: true });
    const verdict = guardCheckout(expected);
    expect(moveOf(verdict)).toBe('missing');
    expect(existsSync(tree)).toBe(false);

    shell(root, restoreIn(linesOf(verdict)));
    expect(guardCheckout(expected)).toEqual({ held: true });
  });

  it('reads a nested worktree whose .git link is gone as foreign, never as the main checkout\'s branch', () => {
    const root = repository('nested');
    git(root, ['switch', '-q', 'main']);
    const tree = join(root, '.rafa', 'worktrees', 'rafa-370');
    git(root, ['worktree', 'add', '-q', tree, BRANCH]);
    const expected = { ...expectationIn(tree), projectRoot: root };
    expect(readCheckout(tree)).toEqual({ kind: 'read', branch: BRANCH, head: expected.head });

    rmSync(join(tree, '.git'));
    expect(git(tree, ['symbolic-ref', '--short', 'HEAD'])).toBe('main');
    expect(readCheckout(tree)).toEqual({ kind: 'foreign', toplevel: root });
    const lines = linesOf(guardCheckout(expected));
    expect(lines[3]).toBe('   No git command restores it; the loop did not touch it.');
  });

  it('answers the checkout the caller named, not the working directory it ran from', () => {
    const root = repository('named');
    expect(readCheckout(root).kind).toBe('read');
    expect(readCheckout(join(scratch, 'nothing-here'))).toEqual({ kind: 'missing' });
  });
});
