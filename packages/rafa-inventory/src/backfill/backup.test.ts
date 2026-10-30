/**
 * Tests for the backfill's backups (`./backup.ts`): which files are
 * copied, where each copy lands, and the three answers that copy
 * nothing.
 *
 * Every case plants its own tree under a temporary directory of this
 * file's own, so no case reads or writes a real `~/.claude/skills` or a
 * real `~/.rafa/`.
 *
 * ## The controls
 *
 * Two readings here would pass on a module that copied nothing at all,
 * so each is paired:
 *
 *   - **A tracked file is not copied** is asserted beside the SAME file
 *     copied with `repoRoot` null — a module that never copied would be
 *     red on the second.
 *   - **A second backup keeps the first** is asserted on the bytes of
 *     the copy, not on its existence: the file is rewritten between the
 *     two calls, and the copy still holds the original bytes.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  BACKUP_PATH,
  backupDirectory,
  backupFile,
  backupFiles,
  backupPathFor,
  countBackups,
  isUnder,
} from './backup.js';

/** A temporary directory of this file's own, its path resolved through every link. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-backfill-backup-')));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** What one case plants: a base, its skills directory and its backup directory. */
interface Planted {
  /** The `<base>` the backups go under. */
  readonly base: string;
  /** `<base>/.claude/skills`. */
  readonly root: string;
  /** `<base>/.rafa/backfill/backup`. */
  readonly backupDir: string;
}

/** Plants one case's tree, the file names taken as paths under the skills directory. */
function plant(files: Readonly<Record<string, string>>): Planted {
  planted += 1;
  const base = join(tempBase, `case-${String(planted)}`);
  const root = join(base, '.claude', 'skills');
  mkdirSync(root, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  return { base, root, backupDir: backupDirectory(base) };
}

describe('where a backup lands', () => {
  it('spells the backup directory under the base', () => {
    expect(backupDirectory('/home/me')).toBe(join('/home/me', BACKUP_PATH));
    expect(BACKUP_PATH).toBe(join('.rafa', 'backfill', 'backup'));
  });

  it('keeps the path a file has under the skills directory', () => {
    expect(backupPathFor('/s/one/SKILL.md', '/s', '/b')).toBe(join('/b', 'one', 'SKILL.md'));
  });

  it('answers no path for a file outside the skills directory', () => {
    expect(backupPathFor('/elsewhere/one/SKILL.md', '/s', '/b')).toBeNull();
  });

  it('reads a path under a root, the root itself included, and nothing above it', () => {
    expect(isUnder('/s', '/s/one')).toBe(true);
    expect(isUnder('/s', '/s')).toBe(true);
    expect(isUnder('/s', '/other')).toBe(false);
    expect(isUnder('/s/one', '/s')).toBe(false);
  });
});

describe('the copy one file gets', () => {
  it('copies a file outside the checkout, bytes for bytes', () => {
    const tree = plant({ 'one/SKILL.md': 'first\n' });
    const path = join(tree.root, 'one', 'SKILL.md');

    const result = backupFile(path, { root: tree.root, backupDir: tree.backupDir, repoRoot: null });

    expect(result.kind).toBe('copied');
    expect(result.backup).toBe(join(tree.backupDir, 'one', 'SKILL.md'));
    expect(readFileSync(result.backup ?? '', 'utf8')).toBe('first\n');
  });

  it('copies no file of the checkout it runs in, and copies that same file without one', () => {
    const tree = plant({ 'one/SKILL.md': 'first\n' });
    const path = join(tree.root, 'one', 'SKILL.md');
    const options = { root: tree.root, backupDir: tree.backupDir, repoRoot: tree.base };

    const tracked = backupFile(path, options);

    expect(tracked.kind).toBe('tracked');
    expect(tracked.backup).toBeNull();
    expect(existsSync(join(tree.backupDir, 'one', 'SKILL.md'))).toBe(false);

    const copied = backupFile(path, { ...options, repoRoot: null });

    expect(copied.kind).toBe('copied');
    expect(existsSync(join(tree.backupDir, 'one', 'SKILL.md'))).toBe(true);
  });

  it('keeps the first copy when the file is backed up a second time', () => {
    const tree = plant({ 'one/SKILL.md': 'first\n' });
    const path = join(tree.root, 'one', 'SKILL.md');
    const options = { root: tree.root, backupDir: tree.backupDir, repoRoot: null };
    backupFile(path, options);
    writeFileSync(path, 'second\n', 'utf8');

    const again = backupFile(path, options);

    expect(again.kind).toBe('kept');
    expect(readFileSync(join(tree.backupDir, 'one', 'SKILL.md'), 'utf8')).toBe('first\n');
  });

  it('answers missing for a file that is not there and copies nothing', () => {
    const tree = plant({});
    const path = join(tree.root, 'gone', 'SKILL.md');

    const result = backupFile(path, { root: tree.root, backupDir: tree.backupDir, repoRoot: null });

    expect(result.kind).toBe('missing');
    expect(existsSync(tree.backupDir)).toBe(false);
  });

  it('answers outside for a file that is no part of the skills directory', () => {
    const tree = plant({ 'one/SKILL.md': 'first\n' });
    const path = join(tree.base, 'elsewhere.md');
    writeFileSync(path, 'stray\n', 'utf8');

    const result = backupFile(path, { root: tree.root, backupDir: tree.backupDir, repoRoot: null });

    expect(result.kind).toBe('outside');
    expect(result.backup).toBeNull();
  });
});

describe('a list of files', () => {
  it('copies each file once whatever the list repeats, and counts what it did', () => {
    const tree = plant({ 'one/SKILL.md': 'one\n', 'two/SKILL.md': 'two\n' });
    const one = join(tree.root, 'one', 'SKILL.md');
    const two = join(tree.root, 'two', 'SKILL.md');

    const results = backupFiles([one, two, one], {
      root: tree.root,
      backupDir: tree.backupDir,
      repoRoot: null,
    });

    expect(results.map((result) => result.path)).toEqual([one, two]);
    expect(countBackups(results)).toEqual({ copied: 2, kept: 0, tracked: 0, outside: 0, missing: 0 });
  });
});
