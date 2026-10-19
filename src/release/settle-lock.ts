/**
 * Settle's lock step: under `release.moveLock`, the release commit moves
 * `rafa.lock` to the version it settles, beside the version file and the
 * changelog.
 *
 * ```text
 * readSettleLock(git, commit, versionFile, version) → the plan, or a problem; writes nothing
 * writeSettleLock(root, version)                    → the lock, written at the worktree root
 * ```
 *
 * The reading is git-only, as the rest of `./settle.ts`'s reading is:
 * the manifest and the lock at `commit` are read as blobs
 * (`git show <commit>:<path>`) and the lock's presence as a tree listing
 * (`git ls-tree`), never from a checkout, so a dry run over
 * `origin/main` and a build over a worktree's `HEAD` answer alike.
 *
 * Two refusals stop a settle before anything is written:
 *
 *   - the manifest at `<commit>:<versionFile>` names a package other
 *     than rafa's ({@link RAFA_PACKAGE_NAME}): only rafa's own release
 *     moves the lock to its own version, so the key is on in the wrong
 *     project, and the sentence names `release.moveLock` and the name
 *     found;
 *   - the blob at `<commit>:rafa.lock` does not read as a lock: the
 *     sentence is `parseProjectLock`'s (`../project/lock.ts`), which
 *     names `rafa.lock`, so a lock a newer rafa wrote is never
 *     overwritten.
 *
 * A git call that fails answers its own sentence too. The caller skips
 * this step entirely when `release.moveLock` is off.
 */
import type { GitRunner } from '@open-tomato/rafa/core/git';

import { gitSaid } from '@open-tomato/rafa/core/git';

import { LOCK_FILE, ProjectLockError, parseProjectLock, writeProjectLock } from '../project/lock.js';

import { gitPathOf, readManifestName } from './version.js';

/**
 * Rafa's published name, the `name` of the root `package.json`, spelled
 * as `packages/rafa/src/core/runtime/identity.ts` spells it.
 * `./settle-lock.test.ts` reads the root manifest, so a drift fails.
 */
export const RAFA_PACKAGE_NAME = '@open-tomato/rafa';

/** How the release commit moves the lock. */
export interface SettleLockPlan {
  /** The lock's path at the repository root: `rafa.lock`. */
  readonly path: typeof LOCK_FILE;
  /** The version the lock records at the commit read, or null when the tree holds no lock. */
  readonly from: string | null;
  /** The version the release commit writes into it. */
  readonly to: string;
}

/** Why the lock cannot move: one sentence. */
export interface SettleLockProblem {
  readonly problem: string;
}

/** The sentence a manifest that is not rafa's is refused with. */
function notRafa(where: string, name: string | null): string {
  const found = name === null
    ? 'no package name'
    : `the package ${JSON.stringify(name)}`;
  return `release.moveLock is on, and ${where} declares ${found}, not ${RAFA_PACKAGE_NAME}: only rafa's own release moves ${LOCK_FILE}`;
}

/** The lock at `commit` read as a blob, or null when the tree holds none. */
function lockAt(git: GitRunner, commit: string): { readonly from: string | null } | SettleLockProblem {
  const listed = git(['ls-tree', '--name-only', commit, '--', LOCK_FILE]);
  if (!listed.ok) return { problem: `${commit}:${LOCK_FILE} could not be listed: ${gitSaid(listed)}` };
  if (listed.stdout.trim() === '') return { from: null };

  const where = `${commit}:${LOCK_FILE}`;
  const shown = git(['show', where]);
  if (!shown.ok) return { problem: `${where} could not be read: ${gitSaid(shown)}` };
  try {
    return { from: parseProjectLock(shown.stdout).rafa };
  } catch (error) {
    if (error instanceof ProjectLockError) return { problem: error.message };
    throw error;
  }
}

/**
 * How the release commit at `version` moves `rafa.lock`, read at
 * `commit`, or the sentence saying why it cannot. Reads git objects only;
 * see the module note for the refusals.
 */
export function readSettleLock(
  git: GitRunner,
  commit: string,
  versionFile: string,
  version: string,
): SettleLockPlan | SettleLockProblem {
  const where = `${commit}:${gitPathOf(versionFile)}`;
  const manifest = git(['show', where]);
  if (!manifest.ok) return { problem: `${where} could not be read: ${gitSaid(manifest)}` };
  const name = readManifestName(manifest.stdout);
  if (name !== RAFA_PACKAGE_NAME) return { problem: notRafa(where, name) };

  const lock = lockAt(git, commit);
  if ('problem' in lock) return lock;
  return { path: LOCK_FILE, from: lock.from, to: version };
}

/** Writes the lock recording `version` at the worktree's `root`. */
export function writeSettleLock(root: string, version: string): void {
  writeProjectLock(root, version);
}
