/**
 * The push `rafa release tag --push` makes once the tag is written
 * (#736): `refs/tags/v<version>` sent to the remote the release branch
 * tracks, so a tagged release reaches the remote with no hand-typed
 * `git push`.
 *
 * ```text
 * pushTag(git, tag, branch) → pushed, or failed with git's words
 * ```
 *
 * ## Which remote
 *
 * The one `branch.<release branch>.remote` names, the remote a plain
 * `git push` from that branch would reach. A branch that tracks none, a
 * config git could not read, and the `.` git writes for a branch
 * tracking another LOCAL branch all read as {@link RELEASE_REMOTE}
 * (`origin`), the remote every other release reading fetches from.
 *
 * ## The push
 *
 * `git push --porcelain <remote> refs/tags/<tag>:refs/tags/<tag>`, never
 * forced, as `./settle-tag.ts` pushes the tag `release.tag: settle`
 * writes: a remote tag of that name on another commit is refused by git
 * (`[rejected] (already exists)`, measured there), and a refusal is not
 * this module's to overrule. A push that fails answers `failed`, exit 1,
 * with a sentence that says the local tag is kept, what git said
 * ({@link pushSaid}, so the porcelain `Done` line a refusal still ends
 * on is not read as success), and the push to run once the cause is
 * fixed. Nothing here deletes the local tag: it names the right commit
 * whether or not the remote has it.
 *
 * Measured on git 2.53.0 (2026-10-06) through `tag-push.test.ts`: a
 * bare origin takes the tag with exit 0, and a `pre-receive` hook that
 * declines makes the push exit 1 with the hook's words on stderr and a
 * `[remote rejected] (pre-receive hook declined)` status line.
 */
import type { GitResult, GitRunner } from '../pr/git.js';

import { pushSaid } from './settle-push.js';
import { RELEASE_REMOTE } from './version.js';

/** What `branch.<name>.remote` holds for a branch tracking a local branch. */
const LOCAL_REMOTE = '.';

/** The tag is on the remote. */
export interface TagPushed {
  /** Tells this apart from {@link TagPushFailed}. */
  readonly outcome: 'pushed';
  /** The command's exit code for this answer. */
  readonly exitCode: 0;
  /** The tag pushed, `v<version>`. */
  readonly tag: string;
  /** The remote it was pushed to. */
  readonly remote: string;
  /** One sentence naming the tag and the remote. */
  readonly sentence: string;
}

/** The push failed, and the local tag is kept. */
export interface TagPushFailed {
  /** Tells this apart from {@link TagPushed}. */
  readonly outcome: 'failed';
  /** The command's exit code for this answer. */
  readonly exitCode: 1;
  /** The tag that stays local, `v<version>`. */
  readonly tag: string;
  /** The remote that did not take it. */
  readonly remote: string;
  /** One sentence naming the kept tag, what git said and the push to run again. */
  readonly sentence: string;
}

/** What {@link pushTag} answers; see the module note. */
export type TagPushOutcome = TagPushed | TagPushFailed;

/**
 * The remote `branch` tracks, read off `branch.<branch>.remote`, or
 * {@link RELEASE_REMOTE} when it tracks none, tracks a local branch, or
 * the config could not be read; see the module note.
 */
export function trackedRemote(git: GitRunner, branch: string): string {
  const read: GitResult = git(['config', '--get', `branch.${branch}.remote`]);
  const remote = read.stdout.trim();
  return read.ok && remote !== '' && remote !== LOCAL_REMOTE
    ? remote
    : RELEASE_REMOTE;
}

/**
 * Pushes the written `tag` to the remote `branch` tracks, never forced,
 * and answers `pushed` or `failed`; a failure leaves the local tag where
 * it is. See the module note.
 */
export function pushTag(git: GitRunner, tag: string, branch: string): TagPushOutcome {
  const remote = trackedRemote(git, branch);
  const ref = `refs/tags/${tag}`;
  const pushed = git(['push', '--porcelain', remote, `${ref}:${ref}`]);
  if (pushed.ok) {
    return { outcome: 'pushed', exitCode: 0, tag, remote, sentence: `${tag} is pushed to ${remote}` };
  }
  const sentence = `${tag} is written and kept locally, but could not be pushed to ${remote}; once the cause is`
    + ` fixed, run git push ${remote} ${tag}: ${pushSaid(pushed)}`;
  return { outcome: 'failed', exitCode: 1, tag, remote, sentence };
}
