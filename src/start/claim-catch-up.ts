/**
 * Whether the run's existing `feat/<stub>` may catch up with
 * `origin/<base>` before the first task: it holds only claim commits,
 * and how far it is behind.
 *
 * A claim is taken on the branch the loop will run on (`../claims/`),
 * so a plan claimed days before its run starts finds `feat/<stub>` cut
 * from a base that has moved since. A branch that carries nothing but
 * claims has no work a merge could disturb, and the run merges the base
 * into it; a branch with work is never merged, only reported. This
 * module only READS which of the two it is. It merges nothing, fetches
 * nothing and prints nothing: the caller fetches `origin/<base>` when it
 * wants a fresh one, runs the `git merge` in the run's worktree, and
 * says what it did.
 *
 * ## The reading
 *
 * {@link readClaimCatchUp} reads the LOCAL branch, `refs/heads/<branch>`,
 * against the remote-tracking `refs/remotes/origin/<base>` as it stands:
 *
 * | The branch | Reading |
 * |---|---|
 * | not behind `origin/<base>`, whatever it holds | `current` |
 * | behind, every commit past `origin/<base>` a claim commit | `catch-up` |
 * | behind, any other commit past `origin/<base>` | `behind` |
 * | a ref git does not know, no shared history, a git failure | `unreadable` |
 *
 * `current` reads none of the branch's commits: a branch at or ahead of
 * the base has nothing to take. A branch with no commits of its own is
 * `catch-up`, every one of its none being a claim; its merge is a
 * fast-forward.
 *
 * ## What counts as a claim commit
 *
 * The commits read are those on the branch and not on `origin/<base>`
 * (`origin/<base>..<branch>`), which past one shared merge base are the
 * ones the stage calls "past its merge base". Each is one of:
 *
 *  - a CLAIM commit, whose subject matches `claim(rafa-<n>): <action>`
 *    exactly as `../claims/record.ts`'s `CLAIM_SUBJECT` reads it. The
 *    subject decides here, not the trailers: a claim commit is empty, so
 *    what the merge has to fear is a subject that hides work, and a work
 *    commit someone titled as a claim is the one case this cannot see;
 *  - a CATCH-UP MERGE, a merge commit every parent of which past the
 *    first `origin/<base>` already holds. It is what an earlier catch-up
 *    left: measured on git 2.53.0 (2026-10-05), a claim branch merged
 *    with `origin/main` and then left behind again lists that merge
 *    commit in `origin/main..<branch>`, subject `Merge remote-tracking
 *    branch …`, so reading subjects alone would refuse every second
 *    catch-up. A parent is held when `git merge-base <parent> <base tip>`
 *    answers the parent itself; a merge of anything else is work, since
 *    the side it brings in is not the base;
 *  - WORK, anything else, counted in `behind`'s `workCommits`.
 *
 * A merge commit's own changes, a conflict resolved by hand, are not
 * read: a catch-up merge of a claim-only branch cannot conflict, its
 * claim commits being empty.
 *
 * ## What git said, as measured
 *
 * On git 2.53.0 under Linux with `LC_ALL=C` (2026-10-05): `rev-parse
 * --verify --quiet <ref>^{commit}` of an absent ref exited 1 writing
 * nothing; `rev-list --count` and `log` over a range naming an absent
 * ref exited 128 with `fatal: ambiguous argument …`; `merge-base` of two
 * commits with no shared history exited 1 writing nothing. The runner
 * does not hand the exit code on (`../pr/git.ts`), so an absent ref is
 * asked about first and named in the reason, and an empty failed
 * `merge-base` reads as no shared history.
 */
import type { GitRunner } from '../pr/index.js';

import { CLAIM_SUBJECT } from '../claims/record.js';
import { gitSaid } from '../pr/index.js';

import { localRef, REMOTE, remoteTrackingRef } from './branch-decision.js';

/** The fields every reading names: which branch, read against which base. */
interface ReadingOf {
  /** The branch read, `feat/<stub>`. */
  readonly branch: string;
  /** The base it was read against, without `origin/`. */
  readonly base: string;
}

/** Where the branch and `origin/<base>` stand, read when the branch is behind. */
interface BehindReading extends ReadingOf {
  /** Commits `origin/<base>` holds that the branch does not, at least one. */
  readonly behind: number;
  /** Commits the branch holds that `origin/<base>` does not. */
  readonly ahead: number;
  /** The best common ancestor of the branch and `origin/<base>`. */
  readonly mergeBase: string;
  /** The commit `origin/<base>` names. */
  readonly baseTip: string;
}

/** What {@link readClaimCatchUp} read; see the module note. */
export type ClaimCatchUpReading =
  | ({ readonly kind: 'current' } & ReadingOf)
  | ({ readonly kind: 'catch-up' } & BehindReading)
  | ({
    readonly kind: 'behind';
    /** The branch's commits past `origin/<base>` that are neither claims nor catch-up merges. */
    readonly workCommits: number;
  } & BehindReading)
  | ({ readonly kind: 'unreadable'; readonly reason: string } & ReadingOf);

/** One commit of the branch past `origin/<base>`, as the `log` capture lists it. */
interface OwnCommit {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly subject: string;
}

/** The `log` format of an {@link OwnCommit}: sha, parents and subject, tab-separated. */
const OWN_COMMIT_FORMAT = '--format=%H%x09%P%x09%s';

/** The commit `ref` names, or null when git does not know it. */
function commitAt(git: GitRunner, ref: string): string | null {
  const read = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  const sha = read.stdout.trim();
  return read.ok && sha !== ''
    ? sha
    : null;
}

/** The commits of an {@link OWN_COMMIT_FORMAT} capture, newest first as git lists them. */
function ownCommitsOf(stdout: string): readonly OwnCommit[] {
  return stdout
    .split('\n')
    .filter((entry) => entry.trim() !== '')
    .map((entry) => {
      const [sha = '', parents = '', ...subject] = entry.split('\t');
      return {
        sha,
        parents: parents.split(' ').filter((parent) => parent !== ''),
        subject: subject.join('\t'),
      };
    });
}

/** True when `origin/<base>` at `baseTip` already holds `commit`. */
function baseHolds(git: GitRunner, commit: string, baseTip: string): boolean {
  const read = git(['merge-base', commit, baseTip]);
  return read.ok && read.stdout.trim() === commit;
}

/** True for a claim commit or a catch-up merge; see the module note. */
function isClaimOnly(git: GitRunner, commit: OwnCommit, baseTip: string): boolean {
  if (commit.parents.length > 1) {
    return commit.parents.slice(1).every((parent) => baseHolds(git, parent, baseTip));
  }
  return CLAIM_SUBJECT.test(commit.subject.trim());
}

/**
 * Reads whether the local `branch` holds only claim commits past
 * `origin/<base>` and how far it is behind it, through `git`, which runs
 * in any checkout of the repository. Never throws on what git answers:
 * a ref git does not know, a branch sharing no history with the base and
 * a failed read are each an `unreadable` reading naming why. See the
 * module note for the four readings and what counts as a claim commit.
 */
export function readClaimCatchUp(git: GitRunner, branch: string, base: string): ClaimCatchUpReading {
  const named = { branch, base };
  const remoteBase = `${REMOTE}/${base}`;
  const unreadable = (reason: string): ClaimCatchUpReading => ({ kind: 'unreadable', ...named, reason });
  const baseRef = remoteTrackingRef(base);
  const branchRef = localRef(branch);

  const baseTip = commitAt(git, baseRef);
  if (baseTip === null) return unreadable(`${remoteBase} is not known here`);
  if (commitAt(git, branchRef) === null) return unreadable(`${branch} is not known here`);

  const counted = git(['rev-list', '--count', `${branchRef}..${baseRef}`]);
  const behind = Number(counted.stdout.trim());
  if (!counted.ok || counted.stdout.trim() === '' || !Number.isInteger(behind)) {
    return unreadable(`could not count how far ${branch} is behind ${remoteBase}: ${gitSaid(counted)}`);
  }
  if (behind === 0) return { kind: 'current', ...named };

  const shared = git(['merge-base', branchRef, baseRef]);
  const mergeBase = shared.stdout.trim();
  if (!shared.ok || mergeBase === '') {
    const said = gitSaid(shared);
    return unreadable(said === ''
      ? `${branch} shares no history with ${remoteBase}`
      : `could not read where ${branch} left ${remoteBase}: ${said}`);
  }

  const listed = git(['log', OWN_COMMIT_FORMAT, `${baseRef}..${branchRef}`]);
  if (!listed.ok) {
    return unreadable(`could not list ${branch}'s commits past ${remoteBase}: ${gitSaid(listed)}`);
  }
  const own = ownCommitsOf(listed.stdout);
  const workCommits = own.filter((commit) => !isClaimOnly(git, commit, baseTip)).length;
  const standing = { ...named, behind, ahead: own.length, mergeBase, baseTip };
  return workCommits === 0
    ? { kind: 'catch-up', ...standing }
    : { kind: 'behind', ...standing, workCommits };
}
