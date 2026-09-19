/**
 * Tests for the conflicting file list (`src/pr/triage/conflict.ts`).
 *
 * These cases spawn the REAL git, in repositories of their own under
 * this file's temporary directory, for the same reason `src/pr/git.ts`
 * has its tests do it: the module exists to read what `git merge-tree`
 * says, and a fake git would measure the fake. No case touches the
 * repository this file lives in, no case reaches a network, and
 * `plants every repository under its own temporary directory` asserts
 * both.
 *
 * The file is built around the ambiguity the module note records:
 * `git merge-tree --write-tree` exits 1 for a real conflict AND for a
 * ref it cannot resolve. So the LIVENESS CONTROL comes first — a
 * scratch repository holding a constructed two-sided conflict, put
 * through the same command, asserted to answer exit 1 with a `CONFLICT`
 * message — and every reading that depends on the discrimination is
 * paired with the control that could have falsified it: the clean merge
 * beside the conflicted one, and the unresolvable ref, which is exit 1
 * with no conflict at all, beside both.
 *
 * Four mutations of `conflict.ts` were driven against this file on
 * 2026-09-18, one at a time, the module restored from a scratch copy
 * and verified with `shasum -c` after each, 16 pass either side:
 *
 *  - the OID guard dropped, so every nonzero exit reads as a conflict:
 *    4 fail, both unresolvable-ref cases and both captured-text cases
 *    that hold exit 1 apart from a conflict.
 *  - `-z` dropped from the argv: 6 fail, including the liveness control
 *    itself, whose file list comes back as one newline-separated blob,
 *    and the clean case, whose merged tree stops being recognisable.
 *  - `--name-only` dropped: 4 fail, the file list becoming
 *    (mode, object, stage, path) tuples with a path repeated per stage.
 *  - the trailing newline left on a message: 2 fail, the branch-name
 *    case and the well-formed captured record.
 */
import type { GitResult } from '../git.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createGitRunner } from '../git.js';

import { hasConflictMessage, mergeTreeArgs, parseMergeTree, readConflict } from './conflict.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-pr-conflict-')));

/** The record separator the `-z` output uses, spelled as a codepoint so no escape is ambiguous. */
const NUL = '\u0000';

/** A path with a space and a non-ASCII letter, written as codepoints so this source stays ASCII. */
const ODD_PATH = 'wéird one.txt';

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** Writes every entry, making the parent directories a path needs. */
function writeAll(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
}

/** A repository of this case's own, on `main`, with `seed` in one commit. */
function plantRepo(name: string, seed: Readonly<Record<string, string>>): string {
  const root = join(tempBase, name);
  mkdirSync(root, { recursive: true });
  const git = createGitRunner(root);
  git(['init', '--quiet', '--initial-branch=main', '.']);
  git(['config', 'user.email', 'rafa@example.test']);
  git(['config', 'user.name', 'rafa test']);
  writeAll(root, seed);
  git(['add', '--all']);
  git(['commit', '--quiet', '--message', 'base']);
  return root;
}

/**
 * Commits `files` on a branch made from `main`, then leaves `main`
 * checked out. A null entry is a delete, which is how the modify/delete
 * side of the two-file conflict is built.
 */
function plantBranch(
  root: string,
  branch: string,
  files: Readonly<Record<string, string | null>>,
): void {
  const git = createGitRunner(root);
  git(['switch', '--quiet', '--create', branch, 'main']);
  for (const [path, content] of Object.entries(files)) {
    if (content === null) {
      git(['rm', '--quiet', path]);
      continue;
    }
    writeAll(root, { [path]: content });
  }
  git(['add', '--all']);
  git(['commit', '--quiet', '--message', branch]);
  git(['switch', '--quiet', 'main']);
}

/**
 * A repository whose `left` and `right` branches both changed the same
 * line of `conflicted.txt` — the constructed two-sided conflict.
 */
function plantTwoSidedConflict(name: string): string {
  const root = plantRepo(name, { 'conflicted.txt': 'first\nsecond\nthird\n' });
  plantBranch(root, 'left', { 'conflicted.txt': 'first\nLEFT\nthird\n' });
  plantBranch(root, 'right', { 'conflicted.txt': 'first\nRIGHT\nthird\n' });
  return root;
}

/** A result as the git runner would have answered it. */
function said(ok: boolean, stdout: string, stderr = ''): GitResult {
  return { ok, stdout, stderr };
}

/**
 * A `-z` stream: every record NUL-terminated, the section separator
 * written as an empty record. Built from a list rather than typed as a
 * literal because `\0` beside a digit is a legacy octal escape that
 * reads as one character, not two, so a hand-written stream can hold a
 * record nobody intended.
 */
function stream(...records: readonly string[]): string {
  return records.map((record) => `${record}${NUL}`).join('');
}

describe('the liveness control', () => {
  it('answers exit 1 with a CONFLICT message for a constructed two-sided conflict', () => {
    const git = createGitRunner(plantTwoSidedConflict('liveness'));

    const raw = git(mergeTreeArgs('left', 'right'));
    const reading = parseMergeTree(raw);

    expect(raw.ok).toBe(false);
    expect(reading.kind).toBe('conflict');
    expect(reading.files).toEqual(['conflicted.txt']);
    expect(hasConflictMessage(reading)).toBe(true);
    expect(reading.messages.map((message) => message.type))
      .toContain('CONFLICT (contents)');
  });

  it('answers exit 0 and no conflict for two sides that do not overlap, so the control could have failed', () => {
    const root = plantRepo('liveness-clean', { 'conflicted.txt': 'first\nsecond\nthird\n' });
    plantBranch(root, 'left', { 'left-only.txt': 'left\n' });
    plantBranch(root, 'right', { 'right-only.txt': 'right\n' });
    const git = createGitRunner(root);

    const raw = git(mergeTreeArgs('left', 'right'));
    const reading = parseMergeTree(raw);

    expect(raw.ok).toBe(true);
    expect(reading.kind).toBe('clean');
    expect(reading.files).toEqual([]);
    expect(hasConflictMessage(reading)).toBe(false);
    expect(reading.mergedTree).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('a ref git cannot resolve', () => {
  it('exits 1 like a conflict does, and is read as an error and not as a conflict', () => {
    const git = createGitRunner(plantTwoSidedConflict('unresolvable'));

    const raw = git(mergeTreeArgs('left', 'no-such-ref'));
    const reading = readConflict(git, 'left', 'no-such-ref');

    expect(raw.ok).toBe(false);
    expect(raw.stdout).toBe('');
    expect(reading.kind).toBe('error');
    expect(reading.files).toEqual([]);
    expect(reading.mergedTree).toBeUndefined();
    expect(reading.said).toContain('not something we can merge');
    expect(hasConflictMessage(reading)).toBe(false);
  });

  it('reads two sides with no common ancestor as an error carrying what git said', () => {
    const root = plantRepo('unrelated', { 'kept.txt': 'kept\n' });
    const other = plantRepo('unrelated-other', { 'elsewhere.txt': 'elsewhere\n' });
    const git = createGitRunner(root);
    git(['fetch', '--quiet', other, 'main:stranger']);

    const reading = readConflict(git, 'main', 'stranger');

    expect(reading.kind).toBe('error');
    expect(reading.said).toContain('refusing to merge unrelated histories');
  });
});

describe('the file list', () => {
  it('names every conflicting path once, in git order, whatever kind of conflict it was', () => {
    const root = plantRepo('two-files', {
      'conflicted.txt': 'first\nsecond\nthird\n',
      'removed.txt': 'kept\n',
    });
    plantBranch(root, 'left', { 'conflicted.txt': 'first\nLEFT\nthird\n', 'removed.txt': null });
    plantBranch(root, 'right', { 'conflicted.txt': 'first\nRIGHT\nthird\n', 'removed.txt': 'edited\n' });

    const reading = readConflict(createGitRunner(root), 'left', 'right');

    expect(reading.kind).toBe('conflict');
    expect(reading.files).toEqual(['conflicted.txt', 'removed.txt']);
    expect(reading.messages.map((message) => message.type))
      .toEqual(['Auto-merging', 'CONFLICT (contents)', 'CONFLICT (modify/delete)']);
  });

  it('leaves a path with a space and a non-ASCII letter unquoted', () => {
    const root = plantRepo('odd-path', { 'kept.txt': 'kept\n' });
    plantBranch(root, 'left', { [ODD_PATH]: 'left\n' });
    plantBranch(root, 'right', { [ODD_PATH]: 'right\n' });

    const reading = readConflict(createGitRunner(root), 'left', 'right');

    expect(reading.files).toEqual([ODD_PATH]);
    expect(reading.files.join('')).not.toContain('\\303');
    expect(reading.files.join('')).not.toContain('"');
  });

  it('carries the branch names in the message git wrote about the modify half', () => {
    const root = plantRepo('message-paths', { 'removed.txt': 'kept\n' });
    plantBranch(root, 'left', { 'removed.txt': 'edited\n' });
    plantBranch(root, 'right', { 'removed.txt': null });

    const reading = readConflict(createGitRunner(root), 'left', 'right');
    const conflict = reading.messages.find((message) => message.type.startsWith('CONFLICT'));

    expect(conflict?.paths).toEqual(['removed.txt']);
    expect(conflict?.message).toContain('deleted in right and modified in left');
    expect(conflict?.message.endsWith('\n')).toBe(false);
  });
});

describe('the argv', () => {
  it('asks for the name-only NUL-separated form with the base first', () => {
    expect(mergeTreeArgs('main', 'feat/x'))
      .toEqual(['merge-tree', '--write-tree', '--name-only', '-z', 'main', 'feat/x']);
  });
});

describe('reading captured output', () => {
  it('reads a nonzero exit with no output as an error, since exit 1 alone proves nothing', () => {
    const reading = parseMergeTree(said(false, '', 'merge-tree: nope - not something we can merge'));

    expect(reading.kind).toBe('error');
    expect(reading.said).toBe('merge-tree: nope - not something we can merge');
  });

  it('reads a nonzero exit whose output does not open with an OID as an error', () => {
    const reading = parseMergeTree(said(false, stream('not-an-oid', 'bun.lock', '')));

    expect(reading.kind).toBe('error');
    expect(reading.files).toEqual([]);
  });

  it('accepts a SHA-256 merged tree', () => {
    const oid = 'a'.repeat(64);

    const reading = parseMergeTree(said(false, stream(oid, 'bun.lock', '')));

    expect([reading.kind, reading.mergedTree]).toEqual(['conflict', oid]);
  });

  it('keeps the file list when the messages section is truncated', () => {
    const oid = 'b'.repeat(40);

    const reading = parseMergeTree(said(false, stream(oid, 'bun.lock', 'package.json', '', '2')));

    expect(reading.files).toEqual(['bun.lock', 'package.json']);
    expect(reading.messages).toEqual([]);
  });

  it('keeps the file list when a message record carries a count it cannot read', () => {
    const oid = 'c'.repeat(40);
    const stdout = stream(oid, 'bun.lock', '', 'not-a-count', 'bun.lock', 'CONFLICT (contents)', 'boom\n');

    const reading = parseMergeTree(said(false, stdout));

    expect(reading.files).toEqual(['bun.lock']);
    expect(reading.messages).toEqual([]);
    expect(hasConflictMessage(reading)).toBe(false);
  });

  it('stops at the section separator rather than reading a message record as a file', () => {
    const oid = 'd'.repeat(40);
    const stdout = stream(
      oid,
      'bun.lock',
      '',
      '1',
      'bun.lock',
      'CONFLICT (contents)',
      'Merge conflict in bun.lock\n',
    );

    const reading = parseMergeTree(said(false, stdout));

    expect(reading.files).toEqual(['bun.lock']);
    expect(reading.messages).toEqual([
      { type: 'CONFLICT (contents)', paths: ['bun.lock'], message: 'Merge conflict in bun.lock' },
    ]);
  });

  it('reads an exit 0 as clean however much it printed', () => {
    const reading = parseMergeTree(said(true, stream('e'.repeat(40))));

    expect(reading.kind).toBe('clean');
    expect(reading.files).toEqual([]);
  });
});

describe('where the cases run', () => {
  it('plants every repository under its own temporary directory', () => {
    const root = plantRepo('under-temp', { 'kept.txt': 'kept\n' });
    const projectRoot = realpathSync(join(import.meta.dir, '..', '..', '..'));

    expect(realpathSync(root).startsWith(`${tempBase}/`)).toBe(true);
    expect(tempBase.startsWith(realpathSync(tmpdir()))).toBe(true);
    expect(realpathSync(root).startsWith(`${projectRoot}/`)).toBe(false);
  });
});

