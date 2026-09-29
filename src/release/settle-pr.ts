/**
 * Settle's `pr` delivery (`release.settle: pr`): the release commit
 * `./settle.ts` built in the scratch worktree is pushed to one branch of
 * its own, `rafa/release`, and one pending release pull request from it
 * into the base branch is opened or updated through the
 * {@link PullRequests} provider. For a base the forge protects, where
 * `./settle-push.ts`'s direct push is refused.
 *
 * ```text
 * settleByPr(worktree, settings, pulls) → build, read, push, open or update
 * ```
 *
 * ## The steps
 *
 *   1. The commit is built ({@link buildSettle}). Anything but `built`
 *      is answered `unsettled` and nothing is read or pushed: `nothing`
 *      exits 0, the rest exit 1.
 *   2. The open pull request from `rafa/release` is looked up
 *      (`findOpen`). One that goes into another base, or comes from a
 *      fork, is answered `foreign`, exit 1, before anything is pushed:
 *      replacing the branch under it would rewrite a pull request this
 *      settle does not own.
 *   3. The branch is read on the remote with `git ls-remote`. When it
 *      exists it is fetched, and when its commit has the same tree and
 *      the same one parent as the release commit, it already holds this
 *      release, so nothing is pushed: a settle run again over an
 *      unchanged base changes nothing, CI included.
 *   4. Otherwise the release commit is pushed to `rafa/release` with
 *      `--force-with-lease=refs/heads/rafa/release:<what step 3 read>`,
 *      an empty lease when the branch was absent. This is the ONE place a
 *      settle replaces a branch's content, and only this branch: the
 *      release commit's parent is the base as fetched now, so a batch
 *      that changed is never a fast-forward of the last one. The lease
 *      makes the replacement conditional on the branch still holding
 *      what was read, so two settles racing for it cannot both land.
 *   5. The pull request is updated when step 2 found one still open
 *      (`get`, then `editTitle` and `editBody` for whichever differs,
 *      compared exactly), and opened (`create`) otherwise. When `create`
 *      throws, the branch is looked up once more: a pull request another
 *      settle opened in between is updated rather than duplicated.
 *
 * Nothing here pushes to the base branch, and no step retries a push:
 * a lease refused in step 4 is answered `refused`, exit 1, since the
 * other settle's commit is on the branch and settling again reads it.
 *
 * ## What git prints, measured
 *
 * git 2.50.1 (2026-09-29), `--porcelain`, in a scratch bare origin: an
 * empty lease on an absent branch pushed it (`*` … `[new branch]`,
 * exit 0); the same empty lease on a branch that exists, and a lease
 * naming a commit the branch no longer holds, were both refused with
 *
 * ```text
 * !<TAB><commit>:refs/heads/rafa/release<TAB>[rejected] (stale info)
 * ```
 *
 * and exit 1; a lease naming what the branch held replaced it, exit 0.
 * `git ls-remote --heads <remote> refs/heads/rafa/release` exits 0
 * writing nothing when the branch is absent.
 *
 * ## The pull request
 *
 * Its title is the release commit's subject, `chore: release
 * <version>`, so a squash merge lands the subject a `push` delivery
 * would have. Its body names the base branch, the version, the base
 * version, the strategy that answered and every folded fragment in fold
 * order, says to tag with `rafa release tag` after the merge — tagging
 * a `pr` delivery is that command's, never settle's — and ends with the
 * changelog section, receipt included. It holds no hash and no clock,
 * so an unchanged batch writes the same body and step 5 edits nothing.
 *
 * ## Exit codes
 *
 * `delivered` and an `unsettled` build that answered `nothing` exit 0;
 * everything else exits 1. A failure after the push carries `pushed`
 * true: `rafa/release` holds the release and only the pull request step
 * is left to a settle run again.
 */
import type { SettleExitCode } from './settle-push.js';
import type { SettleWorktree } from './settle-worktree.js';
import type { SettleBuild, SettleBuilt, SettleSettings } from './settle.js';
import type { GitRunner, PullRequestDetail, PullRequestDraft, PullRequests, PullRequestSummary } from '../pr/index.js';

import { messageOf } from '../config-sections.js';
import { gitSaid } from '../pr/index.js';

import { buildSettle, releaseCommitSubject } from './settle.js';

/** The branch the `pr` delivery pushes the release commit to. */
export const RELEASE_PR_BRANCH = 'rafa/release';

/** The ref the lease and the push name. */
const RELEASE_PR_REF = `refs/heads/${RELEASE_PR_BRANCH}`;

/** The `--porcelain` line of a push the lease refused. */
const STALE_LEASE = /^!\t[^\t]*\t\[rejected\] \(stale info\)$/;

/** How many characters of a hash a sentence names. */
const SHORT_HASH = 12;

/** The build answered something other than a commit, so nothing was read or pushed. */
export interface SettlePrUnsettled {
  readonly outcome: 'unsettled';
  /** `nothing` exits 0, the rest exit 1. */
  readonly exitCode: SettleExitCode;
  readonly build: Exclude<SettleBuild, SettleBuilt>;
}

/** What the pull request step did: opened one, edited one, or found it as wanted. */
export type ReleasePullAction = 'opened' | 'updated' | 'unchanged';

/** `rafa/release` holds the release and one open pull request carries it. */
export interface SettlePrDelivered {
  readonly outcome: 'delivered';
  readonly exitCode: 0;
  readonly build: SettleBuilt;
  /** The full hash `rafa/release` holds: the build's commit, or an equal one already there. */
  readonly head: string;
  /** False when `rafa/release` already held this release; see the module note, step 3. */
  readonly pushed: boolean;
  /** The pull request, with the title it now carries. */
  readonly pull: PullRequestSummary;
  readonly action: ReleasePullAction;
}

/** A step failed and settling again is the operator's call. */
export interface SettlePrFailed {
  /**
   * `foreign`: the open pull request from `rafa/release` is not this
   * base's; `refused`: the lease was refused; `unpushed`: any other
   * failure reading or pushing the branch; `unopened`: the pull request
   * could not be found, opened or updated.
   */
  readonly outcome: 'foreign' | 'refused' | 'unpushed' | 'unopened';
  readonly exitCode: 1;
  readonly build: SettleBuilt;
  /** True when `rafa/release` holds the release, so only the pull request step failed. */
  readonly pushed: boolean;
  /** One sentence naming what failed, and what git or the provider said. */
  readonly sentence: string;
}

/** What {@link settleByPr} answers; see the module note. */
export type SettlePrOutcome = SettlePrUnsettled | SettlePrDelivered | SettlePrFailed;

/** What `rafa/release` holds on the remote, read before the push. */
interface ReleaseBranch {
  /** Its full hash, or null when the remote has no such branch. */
  readonly current: string | null;
  /** True when it already holds this release; see the module note, step 3. */
  readonly same: boolean;
}

/** A failure answer. */
function failed(
  outcome: SettlePrFailed['outcome'],
  build: SettleBuilt,
  pushed: boolean,
  sentence: string,
): SettlePrFailed {
  return { outcome, exitCode: 1, build, pushed, sentence };
}

/** The pull request's title: the release commit's subject. */
export function releasePullTitle(version: string): string {
  return releaseCommitSubject(version);
}

/** The pull request's body; see the module note. Holds no hash and no clock. */
export function releasePullBody(build: SettleBuilt, base: string): string {
  const fragments = build.fragments.map((each) => `- \`${each.path}\` (\`${each.id}\`, ${each.fragment.level})`);
  return [
    `Settles the change fragments waiting on \`${base}\` into ${build.version}: the \`${build.strategy}\` strategy folded them from ${build.baseVersion}.`,
    '',
    `The fragments, in the order \`${base}\` received them:`,
    '',
    ...fragments,
    '',
    `Merging this pull request releases the section below; tag it afterwards with \`rafa release tag\`. \`rafa release settle\` replaces \`${RELEASE_PR_BRANCH}\` and this body whenever the batch changes, so an edit made here does not last.`,
    '',
    build.section,
    '',
  ].join('\n');
}

/** Whether an open pull request from `rafa/release` belongs to another base or a fork. */
function foreignSentence(pull: PullRequestSummary, base: string): string | null {
  const named = `pull request #${pull.number} from ${RELEASE_PR_BRANCH}`;
  if (pull.isCrossRepository) return `${named} comes from a fork, so settle will not replace the branch under it; close it and settle again`;
  if (pull.baseRefName !== base) {
    return `${named} goes into ${pull.baseRefName}, not ${base}, so settle will not replace the branch under it; close it, or settle with pr.base ${pull.baseRefName}`;
  }
  return null;
}

/** A commit's tree and parents, as `%T` and `%P` spell them, or null when git could not read it. */
function shapeOf(git: GitRunner, commit: string): string | null {
  const shown = git(['show', '-s', '--format=%T %P', commit]);
  return shown.ok
    ? shown.stdout.trim()
    : null;
}

/** What `rafa/release` holds on the remote; see the module note, step 3. */
function readReleaseBranch(worktree: SettleWorktree, build: SettleBuilt): ReleaseBranch | { readonly problem: string } {
  const listed = worktree.git(['ls-remote', '--heads', worktree.remote, RELEASE_PR_REF]);
  if (!listed.ok) return { problem: `${RELEASE_PR_BRANCH} could not be read on ${worktree.remote}: ${gitSaid(listed)}` };
  const current = listed.stdout.trim().split('\t')[0] ?? '';
  if (current === '') return { current: null, same: false };

  const fetched = worktree.git(['fetch', worktree.remote, RELEASE_PR_REF]);
  if (!fetched.ok) return { problem: `${RELEASE_PR_BRANCH} could not be fetched from ${worktree.remote}: ${gitSaid(fetched)}` };
  const theirs = shapeOf(worktree.git, current);
  const ours = shapeOf(worktree.git, build.release);
  return { current, same: theirs !== null && theirs === ours };
}

/** Pushes the release commit to `rafa/release` under the lease; answers null when pushed, or the failure. */
function pushReleaseBranch(worktree: SettleWorktree, build: SettleBuilt, current: string | null): SettlePrFailed | null {
  const lease = `--force-with-lease=${RELEASE_PR_REF}:${current ?? ''}`;
  const pushed = worktree.git(['push', '--porcelain', lease, worktree.remote, `${build.release}:${RELEASE_PR_REF}`]);
  if (pushed.ok) return null;
  const subject = releaseCommitSubject(build.version);
  const said = gitSaid(pushed);
  if (pushed.stdout.split('\n').some((line) => STALE_LEASE.test(line.trimEnd()))) {
    const read = current === null
      ? 'absent'
      : `at ${current.slice(0, SHORT_HASH)}`;
    return failed('refused', build, false, `${RELEASE_PR_BRANCH} moved on ${worktree.remote} after settle read it ${read}, so ${subject} was not pushed; another settle is delivering, so run it again: ${said}`);
  }
  return failed('unpushed', build, false, `${subject} could not be pushed to ${worktree.remote} ${RELEASE_PR_BRANCH}: ${said}`);
}

/** Edits whichever of the title and the body differ from `draft`; answers the pull request as it now reads. */
async function updatePull(
  pulls: PullRequests,
  detail: PullRequestDetail,
  draft: PullRequestDraft,
): Promise<{ readonly pull: PullRequestSummary; readonly action: ReleasePullAction }> {
  const title = detail.title !== draft.title;
  const body = detail.body !== draft.body;
  if (title) await pulls.editTitle(detail.number, draft.title);
  if (body) await pulls.editBody(detail.number, draft.body);
  const action = title || body
    ? 'updated'
    : 'unchanged';
  return { pull: { ...detail, title: draft.title }, action };
}

/** Opens the pull request, or updates the one another settle opened meanwhile; see the module note, step 5. */
async function openPull(
  pulls: PullRequests,
  draft: PullRequestDraft,
): Promise<{ readonly pull: PullRequestSummary; readonly action: ReleasePullAction }> {
  try {
    return { pull: await pulls.create(draft), action: 'opened' };
  } catch (error) {
    const again = await pulls.findOpen(RELEASE_PR_BRANCH);
    const detail = again === null || foreignSentence(again, draft.base) !== null
      ? null
      : await pulls.get(again.number);
    if (detail === null || detail.state !== 'open') throw error;
    return updatePull(pulls, detail, draft);
  }
}

/** The pull request step: update the open one, or open one; see the module note, step 5. */
async function deliverPull(
  pulls: PullRequests,
  open: PullRequestSummary | null,
  draft: PullRequestDraft,
): Promise<{ readonly pull: PullRequestSummary; readonly action: ReleasePullAction }> {
  const detail = open === null
    ? null
    : await pulls.get(open.number);
  return detail !== null && detail.state === 'open'
    ? updatePull(pulls, detail, draft)
    : openPull(pulls, draft);
}

/**
 * Builds the release commit in `worktree`, pushes it to `rafa/release`
 * under a lease, and opens or updates the one pending release pull
 * request into the worktree's base branch through `pulls`; see the
 * module note for the steps and each outcome's exit code. Never pushes
 * to the base branch, and touches no checkout but the worktree's.
 */
export async function settleByPr(
  worktree: SettleWorktree,
  settings: SettleSettings,
  pulls: PullRequests,
): Promise<SettlePrOutcome> {
  const build = buildSettle(worktree, settings);
  if (build.outcome !== 'built') {
    const exitCode = build.outcome === 'nothing'
      ? 0
      : 1;
    return { outcome: 'unsettled', exitCode, build };
  }

  let open: PullRequestSummary | null;
  try {
    open = await pulls.findOpen(RELEASE_PR_BRANCH);
  } catch (error) {
    return failed('unopened', build, false, `the open pull request from ${RELEASE_PR_BRANCH} could not be looked up, so nothing was pushed: ${messageOf(error)}`);
  }
  const foreign = open === null
    ? null
    : foreignSentence(open, worktree.branch);
  if (foreign !== null) return failed('foreign', build, false, foreign);

  const branch = readReleaseBranch(worktree, build);
  if ('problem' in branch) return failed('unpushed', build, false, branch.problem);
  if (!branch.same) {
    const refused = pushReleaseBranch(worktree, build, branch.current);
    if (refused !== null) return refused;
  }
  const head = branch.same && branch.current !== null
    ? branch.current
    : build.release;

  const draft: PullRequestDraft = {
    head: RELEASE_PR_BRANCH,
    base: worktree.branch,
    title: releasePullTitle(build.version),
    body: releasePullBody(build, worktree.branch),
  };
  try {
    const delivered = await deliverPull(pulls, open, draft);
    return { outcome: 'delivered', exitCode: 0, build, head, pushed: !branch.same, ...delivered };
  } catch (error) {
    return failed('unopened', build, true, `${RELEASE_PR_BRANCH} holds ${releaseCommitSubject(build.version)}, but the release pull request into ${worktree.branch} could not be opened or updated; settle again to finish it: ${messageOf(error)}`);
  }
}
