/**
 * The `release.tag: settle` step: once a `push` delivery
 * (`./settle-push.ts`) has put the release commit on the base branch,
 * settle writes `v<version>` on that commit and pushes the tag, so a
 * CI job running `rafa release settle` after each merge leaves a tagged
 * release behind with no operator step.
 *
 * ```text
 * tagSettle(worktree, mode, delivered) → tagged, skipped, or failed
 * ```
 *
 * ## When it tags, and when it leaves the tag alone
 *
 *   - `release.tag: manual` (the default) never tags: the answer is
 *     `skipped`, reason `manual`, and the operator tags with
 *     `rafa release tag`.
 *   - A `pr` delivery (`./settle-pr.ts`) never tags either, whatever
 *     the mode: its release commit is on `rafa/release`, not on the
 *     base, and the commit the base will hold is whatever the pull
 *     request's merge makes. Tagging it is `rafa release tag`'s, after
 *     that merge; the answer is `skipped`, reason `pr-delivery`, with a
 *     sentence naming that command when the mode asked for `settle`.
 *   - A `push` delivery tags only a `pushed` outcome, and tags the
 *     commit that outcome names (`build.release`), which after a retry
 *     is the REBUILT commit, the one the base now holds. A `superseded`
 *     settle tags nothing (the winner's settle tags its own release),
 *     and nor does an `unsettled` or failed one: reason `not-pushed`.
 *
 * ## The tag
 *
 * The tag name is `versionTag` from `src/commands/pr/merge-followups.ts`,
 * the one spelling `rafa release tag` writes too, so the two ways of
 * tagging cannot drift. It is a lightweight tag, as `rafa release tag`
 * writes. Tags are shared between a repository and its worktrees, so
 * writing it through the worktree's runner puts it in the caller's
 * repository as well — a ref, never the caller's checkout or index.
 *
 *   1. `refs/tags/<tag>` is read locally. One naming the release commit
 *      already is kept; one naming any other commit is `failed`, exit 1,
 *      and nothing is written or pushed: which commit the version
 *      belongs to is the operator's call.
 *   2. Otherwise `git tag <tag> <commit>` writes it.
 *   3. `git push --porcelain <remote> refs/tags/<tag>:refs/tags/<tag>`,
 *      never forced, pushes it. A remote tag of that name naming
 *      another commit is refused by git, and the answer is `failed`,
 *      exit 1, with `written` true: the local tag stays, and the
 *      sentence says what git said.
 *
 * ## What git prints, measured
 *
 * git 2.50.1 (2026-09-29), in a scratch bare origin: a first push of the
 * tag printed `*<TAB>refs/tags/v1:refs/tags/v1<TAB>[new tag]`, exit 0; the
 * same push again `=<TAB>…<TAB>[up to date]`, exit 0; a push of a local
 * tag moved to another commit
 * `!<TAB>…<TAB>[rejected] (already exists)`, exit 1; and `git tag v1`
 * over an existing tag `fatal: tag 'v1' already exists`, exit 128 —
 * which is why step 1 reads before it writes.
 *
 * ## Exit codes
 *
 * `tagged` and `skipped` exit 0; `failed` exits 1. The release commit is
 * on the base by then either way, so the command reports a failed tag
 * beside a settle that succeeded.
 */
import type { SettlePrOutcome } from './settle-pr.js';
import type { SettlePushOutcome } from './settle-push.js';
import type { SettleWorktree } from './settle-worktree.js';
import type { ReleaseTagMode } from '../config-readers.js';

import { versionTag } from '../commands/pr/merge-followups.js';
import { gitSaid } from '../pr/git.js';

/** The command that tags what settle leaves untagged. */
export const RELEASE_TAG_COMMAND = 'rafa release tag';

/** How many characters of a hash a sentence names. */
const SHORT_HASH = 12;

/** Which delivery ran, and what it answered. */
export type SettleDelivered =
  | { readonly delivery: 'push'; readonly outcome: SettlePushOutcome }
  | { readonly delivery: 'pr'; readonly outcome: SettlePrOutcome };

/** Settle wrote no tag, and was not meant to. */
export interface SettleTagSkipped {
  readonly outcome: 'skipped';
  readonly exitCode: 0;
  /** `manual`: `release.tag` is `manual`; `pr-delivery`: the tag waits for the pull request; `not-pushed`: nothing reached the base. */
  readonly reason: 'manual' | 'pr-delivery' | 'not-pushed';
  /** One sentence for the operator, or null when there is nothing to say. */
  readonly sentence: string | null;
}

/** The tag names the release commit, locally and on the remote. */
export interface SettleTagged {
  readonly outcome: 'tagged';
  readonly exitCode: 0;
  /** The tag, `v<version>`. */
  readonly tag: string;
  /** The full hash of the release commit it names. */
  readonly commit: string;
  /** One sentence naming the tag, the commit and the remote. */
  readonly sentence: string;
}

/** The tag could not be written or pushed. */
export interface SettleTagFailed {
  readonly outcome: 'failed';
  readonly exitCode: 1;
  readonly tag: string;
  readonly commit: string;
  /** True when the local tag was written (or already named the commit) and only the push failed. */
  readonly written: boolean;
  /** One sentence naming what failed and what git said. */
  readonly sentence: string;
}

/** What {@link tagSettle} answers; see the module note. */
export type SettleTagOutcome = SettleTagSkipped | SettleTagged | SettleTagFailed;

/** A skip, with its sentence. */
function skipped(reason: SettleTagSkipped['reason'], sentence: string | null): SettleTagSkipped {
  return { outcome: 'skipped', exitCode: 0, reason, sentence };
}

/** A failure, with its sentence. */
function failed(tag: string, commit: string, written: boolean, sentence: string): SettleTagFailed {
  return { outcome: 'failed', exitCode: 1, tag, commit, written, sentence };
}

/** The commit `refs/tags/<tag>` names locally, or null when there is no such tag. */
function localTagCommit(worktree: SettleWorktree, tag: string): string | null {
  const read = worktree.git(['rev-parse', '--verify', '--quiet', '--end-of-options', `refs/tags/${tag}^{commit}`]);
  const commit = read.stdout.trim();
  return read.ok && commit !== ''
    ? commit
    : null;
}

/** Writes `tag` on `commit` in the worktree's repository unless it names it already, then pushes it. */
function writeAndPush(worktree: SettleWorktree, tag: string, commit: string): SettleTagged | SettleTagFailed {
  const short = commit.slice(0, SHORT_HASH);
  const existing = localTagCommit(worktree, tag);
  if (existing !== null && existing !== commit) {
    return failed(tag, commit, false, `${tag} already names ${existing.slice(0, SHORT_HASH)}, not the release commit ${short}; settle wrote no tag, so move or delete it by hand and run ${RELEASE_TAG_COMMAND}`);
  }
  if (existing === null) {
    const written = worktree.git(['tag', tag, commit]);
    if (!written.ok) return failed(tag, commit, false, `${tag} could not be written on ${short}: ${gitSaid(written)}`);
  }

  const ref = `refs/tags/${tag}`;
  const pushed = worktree.git(['push', '--porcelain', worktree.remote, `${ref}:${ref}`]);
  if (!pushed.ok) {
    return failed(tag, commit, true, `${tag} is written on ${short} but could not be pushed to ${worktree.remote}: ${gitSaid(pushed)}`);
  }
  return { outcome: 'tagged', exitCode: 0, tag, commit, sentence: `${tag} names ${short} and is pushed to ${worktree.remote}` };
}

/**
 * Tags the commit a `push` delivery pushed with `v<version>` and pushes
 * the tag when `mode` is `settle`; answers `skipped` for every other
 * reading, a `pr` delivery included. See the module note.
 */
export function tagSettle(
  worktree: SettleWorktree,
  mode: ReleaseTagMode,
  delivered: SettleDelivered,
): SettleTagOutcome {
  if (mode === 'manual') return skipped('manual', null);
  if (delivered.delivery === 'pr') {
    const sentence = delivered.outcome.outcome === 'delivered'
      ? `the release pull request is not tagged by settle; run ${RELEASE_TAG_COMMAND} on ${worktree.branch} once it merges`
      : null;
    return skipped('pr-delivery', sentence);
  }
  if (delivered.outcome.outcome !== 'pushed') return skipped('not-pushed', null);

  const { build } = delivered.outcome;
  return writeAndPush(worktree, versionTag(build.version), build.release);
}
