/**
 * The tree half of the core-package codemod (`core-package.ts`): listing
 * the files a commit would hold, and carrying a planned move out on disk
 * and in git's index. What moves where is decided by `core-package.ts`;
 * this module only does it.
 *
 * A tracked file moves by `git mv`, one call per destination folder, and
 * an untracked one by a rename, so the commit the loop makes after
 * `git add -A` records each as a rename either way. A deleted tracked file
 * leaves by `git rm -f`: it is deleted whatever its staged or unstaged
 * changes hold, which a plain `git rm` refuses. The folders a move empties are removed; a folder
 * that still holds an ignored file stays.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

/** A git call failed. */
export class TreeError extends Error {}

/** One file that changes path. */
export interface TreeMove {
  readonly from: string;
  readonly to: string;
}

/** What {@link applyTreeChanges} does, every path repository-relative. */
export interface TreeChanges {
  /** The files to move, in order. */
  readonly moves: readonly TreeMove[];
  /** The files to delete. */
  readonly deleted: readonly string[];
  /** The text of each file to write, by its path after the moves. */
  readonly writes: ReadonlyMap<string, string>;
}

/**
 * Runs git in `root`.
 *
 * @param root - The repository root.
 * @param args - The arguments after `git`.
 * @returns What git printed.
 * @throws {TreeError} When git exits non-zero.
 */
function git(root: string, args: readonly string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new TreeError(`git ${args.join(' ')} failed in ${root} (exit ${result.exitCode}): ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

/**
 * The files `git ls-files` lists with the flags handed in, less those
 * missing from disk.
 *
 * @param root - The repository root.
 * @param flags - The selection, such as `--cached`.
 * @returns Their paths, in git's order.
 * @throws {TreeError} When git exits non-zero.
 */
export function listFiles(root: string, flags: readonly string[]): string[] {
  return git(root, ['ls-files', '-z', ...flags]).split('\0')
    .filter((path) => path !== '' && existsSync(join(root, path)));
}

/**
 * The files a commit of the working tree would hold: tracked, or
 * untracked and not ignored, and present on disk.
 *
 * @param root - The repository root.
 * @returns Their paths, in git's order.
 * @throws {TreeError} When git exits non-zero.
 */
export function committableFiles(root: string): string[] {
  return listFiles(root, ['--cached', '--others', '--exclude-standard']);
}

/**
 * Removes the folders under each named one that hold nothing, deepest
 * first, the named folder included.
 *
 * @param root - The repository root.
 * @param folders - The folders to sweep.
 */
function removeEmptyFolders(root: string, folders: readonly string[]): void {
  const sweep = (folder: string): void => {
    const path = join(root, folder);
    if (!existsSync(path) || !statSync(path).isDirectory()) return;
    for (const entry of readdirSync(path)) sweep(posix.join(folder, entry));
    if (readdirSync(path).length === 0) rmdirSync(path);
  };
  folders.forEach(sweep);
}

/**
 * Carries the changes out: moves the files, deletes the listed ones,
 * writes every text, and removes the folders the moves emptied.
 *
 * @param root - The repository root.
 * @param changes - What to do.
 * @throws {TreeError} When a git call fails.
 */
export function applyTreeChanges(root: string, changes: TreeChanges): void {
  const tracked = new Set(listFiles(root, ['--cached']));
  const byFolder = new Map<string, string[]>();
  for (const move of changes.moves) {
    mkdirSync(dirname(join(root, move.to)), { recursive: true });
    if (!tracked.has(move.from)) {
      renameSync(join(root, move.from), join(root, move.to));
      continue;
    }
    const folder = posix.dirname(move.to);
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), move.from]);
  }
  for (const [folder, from] of byFolder) git(root, ['mv', ...from, `${folder}/`]);
  for (const file of changes.deleted) {
    if (tracked.has(file)) {
      git(root, ['rm', '-q', '-f', file]);
    } else {
      unlinkSync(join(root, file));
    }
  }
  for (const [path, text] of changes.writes) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const tops = changes.moves.map((move) => posix.dirname(move.from).split('/')
    .slice(0, 2)
    .join('/'));
  removeEmptyFolders(root, [...new Set(tops)]);
}
