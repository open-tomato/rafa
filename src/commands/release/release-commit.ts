/**
 * Which commit on the release branch a version belongs to: the one
 * that SET it, read off git, and how many first-parent commits HEAD is
 * past it. `rafa release tag` puts the tag there rather than on HEAD.
 *
 * ## Why not HEAD
 *
 * The version is set by the merge that carries the bump, and a
 * package is published from that commit. Nothing stops more merges
 * landing on the release branch before anybody tags it, and then HEAD
 * is a tree the published package is not. Measured on 2026-09-28:
 * `@open-tomato/rafa@0.24.0` was published from 7db04a2, the registry's
 * `gitHead` for it; three merges landed after it; and a tag written on
 * HEAD named ffe501a, which had to be moved by hand.
 *
 * ## Why not the registry's `gitHead`
 *
 * It would mean a network call on the way to a local tag, which
 * `./tag.ts` rules out, and it is not always on the release branch:
 * 0.22.0's `gitHead` is d53c168, a commit of the branch that was
 * squash-merged, which `main` never holds. The commit that set the
 * version on the release branch is df0f61a, the squash itself, and that
 * is the commit a tag on `main` can name.
 *
 * ## How it is read
 *
 * `git log --first-parent --format=%H HEAD -- <file>` lists, newest
 * first, the commits of the release branch that changed the version
 * file. On a merge commit `--first-parent` compares against the first
 * parent, so a merge that brought a bump from its branch is listed
 * itself, rather than the commit inside the branch (measured on git
 * 2.50.1, 2026-09-28). The newest listed commit holds the file as HEAD
 * holds it. Walking the list while the file still declares the version
 * finds the oldest commit of that unbroken run, which is the one that
 * set it; a commit that touched the file and kept the version, such as
 * a field added, is passed over.
 *
 * Two readings refuse rather than guess, both before anything is
 * written. A version the working tree declares and no commit holds
 * (the newest listed commit says another) means the bump is not
 * committed yet; a version file no commit holds means the same of the
 * whole file. A git that could not answer is its own reason, as it is
 * in `./tag.ts`.
 *
 * `ahead` counts first-parent commits, so on a branch that takes merge
 * commits it is the number of merges past the release, which is what
 * `git log --first-parent` shows the operator.
 */
import type { GitRunner } from '../../pr/index.js';

import { gitSaid } from '../../pr/index.js';
import { readManifestVersion } from '../../release/version.js';

/** Why the release commit could not be named: the version is not committed, or git did not answer. */
export interface ReleaseCommitProblem {
  readonly reason: 'version' | 'git';
  /** The whole problem, one sentence, with no marker on the front. */
  readonly message: string;
}

/** The commit that set the version, and how far HEAD is past it. */
export interface ReleaseCommitReading {
  /** The full hash of the commit that set the version, or null when it could not be named. */
  readonly commit: string | null;
  /** First-parent commits from {@link commit} to HEAD; 0 when HEAD set it, or when there is no commit. */
  readonly ahead: number;
  /** Why there is no commit, or null when there is one. */
  readonly problem: ReleaseCommitProblem | null;
}

/** A reading that names no commit, for `problem`. */
function unread(reason: ReleaseCommitProblem['reason'], message: string): ReleaseCommitReading {
  return { commit: null, ahead: 0, problem: { reason, message } };
}

/**
 * The version `path` declares at `commit`, or null when the commit
 * does not hold the file or it declares none. `./` makes the path
 * relative to the directory git runs in, as the version file is.
 */
function versionAt(git: GitRunner, commit: string, path: string): string | null {
  const shown = git(['show', `${commit}:./${path}`]);
  return shown.ok
    ? readManifestVersion(shown.stdout)
    : null;
}

/**
 * The commit on the branch HEAD is on that set `version` in the
 * version file at `path`, and how far HEAD is past it; see the module
 * note. Every git call here is a read.
 */
export function readReleaseCommit(git: GitRunner, path: string, version: string): ReleaseCommitReading {
  const log = git(['log', '--first-parent', '--format=%H', 'HEAD', '--', `./${path}`]);
  if (!log.ok) return unread('git', `the history of ${path} could not be read: ${gitSaid(log)}`);

  const changed = log.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (changed.length === 0) {
    return unread('version', `no commit on this branch holds ${path}; commit it before tagging`);
  }

  let release: string | null = null;
  let newest: string | null | undefined;
  for (const commit of changed) {
    const declared = versionAt(git, commit, path);
    if (newest === undefined) newest = declared;
    if (declared !== version) break;
    release = commit;
  }
  if (release === null) {
    return unread('version', `${path} says ${version}, and the last commit on this branch that changed it`
      + ` says ${newest ?? 'no version'}; commit the version before tagging it`);
  }

  const count = git(['rev-list', '--count', '--first-parent', `${release}..HEAD`]);
  if (!count.ok) return unread('git', `the commits past ${release} could not be counted: ${gitSaid(count)}`);
  return { commit: release, ahead: Number.parseInt(count.stdout.trim(), 10), problem: null };
}
