/**
 * Two repo-hygiene claims, pinned against the live tree rather than a
 * fixture standing in for it.
 *
 * The first is what `git rm --cached progress.txt` and deleting the
 * stray `@progress.txt` are FOR: neither name should ever answer to
 * `git ls-files` again, and a check that only asserted the two absences
 * would pass equally against a checkout `ls-files` could not see into
 * at all — so it is read beside a tracked file through the SAME call.
 *
 * The second is what the `tools/control-byte-gate/` → `scripts/…` repoint
 * in `.githooks/pre-commit` is FOR: every repo path the hook's own
 * comments and its `exec` line name has to resolve to something really
 * on disk, or the hook is describing a gate that moved out from under
 * it. A check that always answered `[]` would pass that silently, so it
 * is read beside a planted copy of the hook naming the pre-repoint path,
 * which must come back non-empty.
 *
 * ## The extractor's one false-positive trap
 *
 * The hook's own comment reads "raw control byte or an invisible/bidi
 * codepoint" — `invisible/bidi` carries a `/` and is not a path. A
 * matcher that fires on any slash-joined word pair would name it a
 * missing path and this suite would never pass. What separates a real
 * repo path here is that it carries either a trailing `/` (a directory,
 * as `scripts/control-byte-gate/` is written in the comment) or a
 * recognised source extension (as the `.ts` on the `exec` line is), and
 * `invisible/bidi` has neither.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Extensions a repo path token may end in, besides a bare `/`. */
const PATH_EXTENSIONS = new Set(['ts', 'js', 'mjs', 'cjs', 'json', 'md', 'sh']);

/** A run of path-shaped characters carrying at least one `/`. */
const PATH_TOKEN = /[\w.-]+(?:\/[\w.-]+)+\/?/g;

/**
 * Whether a token {@link PATH_TOKEN} found is really a path and not
 * prose that happens to contain a slash. See the docblock above for
 * why `invisible/bidi` is the case this exists to fail.
 */
function looksLikeRepoPath(token: string): boolean {
  if (token.endsWith('/')) return true;
  const dot = token.lastIndexOf('.');
  return dot !== -1 && PATH_EXTENSIONS.has(token.slice(dot + 1));
}

/** Every repo-relative path a text names, in source order. */
function repoPathsNamedIn(text: string): string[] {
  return [...text.matchAll(PATH_TOKEN)]
    .map((match) => match[0])
    .filter(looksLikeRepoPath);
}

/** The named paths that do not exist under `root`, directories included. */
function missingRepoPaths(text: string, root: string): string[] {
  return repoPathsNamedIn(text).filter((path) => {
    const target = path.endsWith('/')
      ? path.slice(0, -1)
      : path;
    return !existsSync(join(root, target));
  });
}

/** Paths `git ls-files` lists in a directory's index, blanks dropped. */
function lsFiles(cwd: string): string[] {
  return execFileSync('git', ['ls-files'], { cwd, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line !== '');
}

describe('progress.txt and @progress.txt are out of the index', () => {
  it('lists neither stray file, against a tracked file the same call finds', () => {
    const tracked = lsFiles(REPO_ROOT);

    expect(tracked).not.toContain('progress.txt');
    expect(tracked).not.toContain('@progress.txt');

    // The positive control, through the very same `git ls-files` call:
    // without it, the two absences above are satisfied just as well by
    // a checkout this call cannot see into at all.
    expect(tracked).toContain('package.json');
  });
});

describe('.githooks/pre-commit names only paths that exist', () => {
  const hookPath = join(REPO_ROOT, '.githooks', 'pre-commit');
  const hookText = readFileSync(hookPath, 'utf8');

  it('extracts exactly the two paths the hook comment and its exec line carry', () => {
    // Pinned as a literal so a hook rewritten to drop one of these, or
    // to name a third, reddens here before the existence check below
    // gets a chance to hide the change behind an unrelated new path.
    expect(repoPathsNamedIn(hookText)).toEqual([
      'scripts/control-byte-gate/',
      'scripts/control-byte-gate/control-byte-gate.ts',
    ]);
  });

  it('finds every one of them on disk', () => {
    expect(missingRepoPaths(hookText, REPO_ROOT)).toEqual([]);
  });

  it('refuses a planted hook naming the old tools/ path instead', () => {
    // The control for the case above, varied along the ONE axis the
    // phase 0b repoint changed: the same extractor, the same repo root,
    // a hook text that swaps the live directory for the one this repo
    // used before the rename. Without this, a `missingRepoPaths` that
    // always answered `[]` would leave the empty-list case above green
    // forever, whatever the hook actually named.
    const planted = hookText.replaceAll(
      'scripts/control-byte-gate/',
      'tools/control-byte-gate/',
    );

    expect(planted).not.toBe(hookText);
    expect(missingRepoPaths(planted, REPO_ROOT)).toEqual([
      'tools/control-byte-gate/',
      'tools/control-byte-gate/control-byte-gate.ts',
    ]);
  });
});
