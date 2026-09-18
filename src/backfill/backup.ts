/**
 * The copy the backfill takes of a file before it rewrites it, and the
 * one place that decides which files get one.
 *
 * The backfill writes into skills directories that no version control
 * watches: `~/.claude/skills` is not a git repository, so a derivation
 * that wrote a `when_to_use` nobody wanted would be an edit with no
 * `git checkout` behind it. Every file the pass rewrites outside the
 * checkout it runs in is therefore copied to
 * `<base>/.rafa/backfill/backup/<relative path>` first, where `<base>`
 * is the home for the user tier and the project root for a project one
 * — the same `<base>` the proposal files are written under.
 *
 * ## The one file kind that is not copied
 *
 * A file under the checkout the command runs in ({@link
 * BackupOptions.repoRoot}) is answered `tracked` and copied nowhere:
 * git already holds it, the loop commits the pass's edits like any
 * task's, and a second copy under `.rafa/` would be a tracked file
 * duplicated into a gitignored directory. Every OTHER file is copied,
 * including one in some other git repository — the sibling checkout's
 * `.claude/skills` is a working tree this run does not commit, and its
 * operator asked for the copy.
 *
 * ## The first copy wins
 *
 * A backup that already exists is kept and answered `kept`, never
 * overwritten. A backfill is run in passes — `--propose`, a review,
 * `--apply`, then repairs — and the copy worth having is the file as it
 * stood before the FIRST of them touched it. Overwriting would make the
 * backup of a second pass a copy of what the first pass wrote, which is
 * the one state nobody needs a copy of.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { BACKFILL_PATH } from './proposal-file.js';

/** `<base>/.rafa/backfill/backup`, relative to a `<base>`. */
export const BACKUP_PATH = join(BACKFILL_PATH, 'backup');

/** What became of one file's backup. */
export type BackupKind = 'copied' | 'kept' | 'tracked' | 'outside' | 'missing';

/** Every kind, in the order a summary counts them. */
export const BACKUP_KINDS: readonly BackupKind[] = ['copied', 'kept', 'tracked', 'outside', 'missing'];

/** Where one backup is taken, and which files are exempt. */
export interface BackupOptions {
  /** The skills directory the relative path is taken against, absolute. */
  readonly root: string;
  /** `<base>/.rafa/backfill/backup`, which the copies go under. */
  readonly backupDir: string;
  /** The checkout the command runs in, whose files git already holds, or null when there is none. */
  readonly repoRoot: string | null;
}

/** One file, and what became of its backup. */
export interface BackupResult {
  /** The file, absolute, as it was handed in. */
  readonly path: string;
  /** What became of its backup. */
  readonly kind: BackupKind;
  /** The copy, absolute, or null when none was taken. */
  readonly backup: string | null;
}

/** `<base>/.rafa/backfill/backup`. */
export function backupDirectory(base: string): string {
  return join(base, BACKUP_PATH);
}

/** Whether `path` is `root` itself or sits under it. */
export function isUnder(root: string, path: string): boolean {
  const step = relative(resolve(root), resolve(path));
  return step === '' || (!step.startsWith(`..${sep}`) && step !== '..' && !isAbsolute(step));
}

/**
 * Where `path` is copied to, or null when it sits outside `root` and so
 * has no place under the backup directory.
 */
export function backupPathFor(
  path: string,
  root: string,
  backupDir: string,
): string | null {
  if (!isUnder(root, path)) return null;
  return join(backupDir, relative(resolve(root), resolve(path)));
}

/**
 * Copies one file, unless it is tracked, already copied, outside the
 * skills directory or not there at all. See the module note.
 */
export function backupFile(path: string, options: BackupOptions): BackupResult {
  if (options.repoRoot !== null && isUnder(options.repoRoot, path)) {
    return { path, kind: 'tracked', backup: null };
  }

  const backup = backupPathFor(path, options.root, options.backupDir);
  if (backup === null) return { path, kind: 'outside', backup: null };
  if (!existsSync(path)) return { path, kind: 'missing', backup: null };
  if (existsSync(backup)) return { path, kind: 'kept', backup };

  mkdirSync(dirname(backup), { recursive: true });
  copyFileSync(path, backup);
  return { path, kind: 'copied', backup };
}

/**
 * Copies every file of `paths`, each at most once whatever the list
 * repeats, in the order they were handed in.
 */
export function backupFiles(
  paths: readonly string[],
  options: BackupOptions,
): readonly BackupResult[] {
  const seen = new Set<string>();
  const results: BackupResult[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    results.push(backupFile(path, options));
  }
  return results;
}

/** How many results came to each kind. */
export function countBackups(
  results: readonly BackupResult[],
): Readonly<Record<BackupKind, number>> {
  const counts = Object.fromEntries(
    BACKUP_KINDS.map((kind) => [kind, 0]),
  ) as Record<BackupKind, number>;

  for (const result of results) counts[result.kind] += 1;
  return counts;
}
