/**
 * The source roots the content sweeps walk, and the workspace members
 * kept out of them: the list and the record hold what the module note
 * names, every `packages/<name>/` directory of the repository is sorted
 * into one of the two, and every listed root exists.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import { MEMBERS_LEFT_OUT, SOURCE_ROOTS } from './source-roots.js';

/** The repository root. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The repo-relative directory of every folder directly under `packages/`. */
function packageDirectories(): string[] {
  return readdirSync(join(REPO_ROOT, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}`)
    .sort();
}

/** The directories of `dirs` that hold no listed root and are no member left out. */
function unsorted(dirs: readonly string[]): string[] {
  const holders = new Set(SOURCE_ROOTS.filter((root) => root.startsWith('packages/')).map((root) => dirname(root)));
  return dirs.filter((dir) => !holders.has(dir) && !Object.hasOwn(MEMBERS_LEFT_OUT, dir));
}

describe('SOURCE_ROOTS', () => {
  it('holds the eight roots in order', () => {
    expect(SOURCE_ROOTS).toEqual([
      'src',
      'packages/rafa/src',
      'packages/rafa-board/src',
      'packages/rafa-run/src',
      'packages/rafa-pr/src',
      'packages/rafa-release/src',
      'packages/rafa-inventory/src',
      'packages/rafa-effort/src',
    ]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(SOURCE_ROOTS)).toBe(true);
  });

  it('names roots that exist as directories', () => {
    const missing = SOURCE_ROOTS.filter((root) => {
      const path = join(REPO_ROOT, root);
      return !existsSync(path) || !statSync(path).isDirectory();
    });
    expect(missing).toEqual([]);
  });

  it('reads a root that is not there as missing', () => {
    expect(existsSync(join(REPO_ROOT, 'packages/rafa-not-a-member/src'))).toBe(false);
  });
});

describe('MEMBERS_LEFT_OUT', () => {
  it('names the two members kept out, each with a reason', () => {
    expect(Object.keys(MEMBERS_LEFT_OUT).sort()).toEqual([
      'packages/rafa-hub',
      'packages/rafa-sync-service',
    ]);
    expect(Object.values(MEMBERS_LEFT_OUT).filter((reason) => reason.trim() === '')).toEqual([]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(MEMBERS_LEFT_OUT)).toBe(true);
  });

  it('shares no member with the roots', () => {
    const holders = new Set(SOURCE_ROOTS.map((root) => dirname(root)));
    expect(Object.keys(MEMBERS_LEFT_OUT).filter((member) => holders.has(member))).toEqual([]);
  });
});

describe('every workspace member', () => {
  it('is the holder of a listed root or a member left out', () => {
    const dirs = packageDirectories();
    expect(dirs).toContain('packages/rafa');
    expect(dirs).toContain('packages/rafa-hub');
    expect(unsorted(dirs)).toEqual([]);
  });

  it('reads a package added later as unsorted', () => {
    expect(unsorted([...packageDirectories(), 'packages/rafa-planted'])).toEqual(['packages/rafa-planted']);
  });
});
