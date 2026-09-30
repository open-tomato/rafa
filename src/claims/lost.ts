/**
 * The "claim lost" reading: what a push of a claim branch that the
 * remote REFUSED means for the claim, and, when another store now owns
 * it, keeping this device's commits where nothing can pull them away
 * (`.rafa/plans/rafa-324-claim-issue-so-two`). {@link readRefusedPush}
 * reads and keeps; {@link claimLostReport} words the answer. What a run
 * does with it, halting and opening no pull request, is the caller's.
 *
 * ## What is read
 *
 * The caller has already pushed `feat/<stub>` and been refused, so this
 * module never pushes: not again, not with a lease, never with force.
 * It runs one fetch of the `feat/rafa-*` branches and reads the
 * remote's branch as that fetch left it (`./git.ts`); the remote is the
 * authority on who holds the claim.
 *
 * | Reading of the remote | Answer |
 * |---|---|
 * | `held` by another store, a handover pending or not | `lost`, naming the new owner |
 * | `held` by this store | `not-lost` (`owned`): the refusal is not about the claim |
 * | `released` | `not-lost` (`released`): nobody owns it, so nobody took it |
 * | no claim commit on the branch | `not-lost` (`no-claim`): a branch as today |
 * | absent | `not-lost` (`absent`): the remote has no such branch |
 * | a branch that is no claim branch | `not-lost` (`not-a-claim-branch`), with no git run |
 * | a failed fetch, or an unreadable branch | `unknown`, with what git said |
 *
 * A device whose store names no id (`storeId: null`) holds no claim, so
 * a claim held by any store is read as held by another: the commits are
 * kept either way, which costs nothing when it was not needed.
 *
 * ## Keeping the commits
 *
 * On `lost`, the local `refs/heads/lost/<stub>` is pointed at the local
 * tip of `feat/<stub>`, the commits the refused push carried. It is
 * written with `git update-ref`, whose old value makes each write a
 * compare-and-set, so no existing ref is ever moved off commits it held:
 *
 * | `lost/<stub>` before | Written | {@link LostBranch} state |
 * |---|---|---|
 * | absent | created at the tip | `created` |
 * | at the tip already | nothing | `existing` |
 * | at an ancestor of the tip | fast-forwarded to the tip | `advanced` |
 * | at anything else | nothing: its commits stay where they are | `failed` |
 *
 * A `failed` keep still answers `lost`: the claim is lost whether or not
 * the branch could be made, and the commits are still on the local
 * `feat/<stub>`, which the report says. Nothing here touches the working
 * tree, the index, `HEAD` or `feat/<stub>` itself.
 *
 * ## What was measured
 *
 * On git 2.53.0 under Linux with `LC_ALL=C` (2026-09-30):
 * `git update-ref refs/heads/<b> <sha> ''` created an absent ref and,
 * over an existing one, exited 128 with `fatal: update_ref failed for
 * ref 'refs/heads/<b>': cannot lock ref 'refs/heads/<b>': reference
 * already exists`; with the old value a sha the ref did not hold, it
 * exited 128 with the same opening and `is at <x> but expected <y>`;
 * with the old value the sha it held, it moved the ref. `lost.test.ts`
 * drives the absent, fast-forward and refused rows over planted clones.
 */
import type { ClaimBranchReading } from './git.js';
import type { PendingHandover } from './record.js';
import type { GitRunner } from '../pr/index.js';

import { gitSaid } from '../pr/index.js';
import { BRANCH_PREFIX, localRef, REMOTE } from '../start/branch-decision.js';

import { claimBranchIssue, fetchClaimBranches, readClaimBranch } from './git.js';

/** What every branch that keeps a lost claim's commits is called: this, and the plan's stub. */
export const LOST_PREFIX = 'lost/';

/** Why a refused push did not lose the claim. */
export type NotLostCause = 'not-a-claim-branch' | 'absent' | 'no-claim' | 'released' | 'owned';

/** Where this device's commits were kept, or why they could not be. */
export type LostBranch =
  | {
    readonly state: 'created' | 'existing' | 'advanced';
    /** The branch, `lost/<stub>`. */
    readonly name: string;
    /** The commit it now points at: the local tip of `feat/<stub>`. */
    readonly sha: string;
  }
  | {
    readonly state: 'failed';
    readonly name: string;
    /** The local tip of `feat/<stub>`, or null when it could not be read. */
    readonly sha: string | null;
    readonly reason: string;
  };

/** What {@link readRefusedPush} answered; see the module note. */
export type RefusedPushReading =
  | {
    readonly outcome: 'lost';
    readonly issue: number;
    readonly branch: string;
    /** The store that holds the claim on the remote now. */
    readonly owner: string;
    /** A handover the new owner offered and nobody has taken up, or null. */
    readonly pending: PendingHandover | null;
    /** This device's store id, or null when its store names none. */
    readonly storeId: string | null;
    /** The remote's tip, as the fetch left it: the new owner's branch. */
    readonly remoteTip: string;
    readonly kept: LostBranch;
  }
  | {
    readonly outcome: 'not-lost';
    readonly branch: string;
    readonly cause: NotLostCause;
    readonly reason: string;
  }
  | {
    readonly outcome: 'unknown';
    readonly issue: number;
    readonly branch: string;
    readonly reason: string;
  };

/** What {@link readRefusedPush} reads. */
export interface RefusedPushInput {
  /** The branch whose push was refused, `feat/<stub>`. */
  readonly branch: string;
  /** This device's store id, or null when its store names none. */
  readonly storeId: string | null;
}

/** The old value `git update-ref` reads as "the ref must not exist yet". */
const MUST_NOT_EXIST = '';

/**
 * The branch that keeps the commits of a lost claim on `branch`:
 * `feat/<stub>` becomes `lost/<stub>`. Throws on a branch that is not a
 * claim branch, since one reaching here is the caller's mistake.
 */
export function lostBranchFor(branch: string): string {
  if (claimBranchIssue(branch) === null) {
    throw new Error(`claim lost: ${JSON.stringify(branch)} is not a ${BRANCH_PREFIX}rafa-<n> branch`);
  }
  return `${LOST_PREFIX}${branch.slice(BRANCH_PREFIX.length)}`;
}

/**
 * Reads who owns the claim on `branch` after its push was refused and,
 * when another store does, keeps this device's commits on the local
 * `lost/<stub>`. Pushes nothing and never throws for what git says; see
 * the module note for every answer.
 */
export function readRefusedPush(git: GitRunner, input: RefusedPushInput): RefusedPushReading {
  const { branch, storeId } = input;
  const issue = claimBranchIssue(branch);
  if (issue === null) {
    return { outcome: 'not-lost', branch, cause: 'not-a-claim-branch', reason: `${branch} is not a claim branch, so it carries no claim to lose` };
  }
  const fetched = fetchClaimBranches(git);
  if (!fetched.ok) {
    return { outcome: 'unknown', issue, branch, reason: fetched.reason };
  }
  const remote = readClaimBranch(git, branch);
  const notLost = notLostReading(issue, remote, storeId);
  if (notLost !== null) return notLost;
  if (remote.state !== 'found' || remote.ownership.state !== 'held') {
    return { outcome: 'unknown', issue, branch, reason: `the claim on ${REMOTE}/${branch} could not be read` };
  }
  const { owner, pending } = remote.ownership;
  return { outcome: 'lost', issue, branch, owner, pending, storeId, remoteTip: remote.tip, kept: keepCommits(git, branch) };
}

/** The answer for every reading but a claim another store holds, or null for that one. */
function notLostReading(issue: number, remote: ClaimBranchReading, storeId: string | null): RefusedPushReading | null {
  const { branch } = remote;
  if (remote.state === 'unreadable') {
    return { outcome: 'unknown', issue, branch, reason: `the claim on ${REMOTE}/${branch} could not be read: ${remote.reason}` };
  }
  if (remote.state === 'absent') {
    return { outcome: 'not-lost', branch, cause: 'absent', reason: `${REMOTE} has no ${branch}, so no store holds its claim` };
  }
  const { ownership } = remote;
  if (ownership.state === 'none') {
    return { outcome: 'not-lost', branch, cause: 'no-claim', reason: `${REMOTE}/${branch} carries no claim commit` };
  }
  if (ownership.state === 'released') {
    return {
      outcome: 'not-lost',
      branch,
      cause: 'released',
      reason: `the claim on ${REMOTE}/${branch} was released by store ${ownership.releasedBy}, so no store holds it`,
    };
  }
  return ownership.owner === storeId
    ? { outcome: 'not-lost', branch, cause: 'owned', reason: `this device (store ${ownership.owner}) still holds the claim on ${REMOTE}/${branch}` }
    : null;
}

/** The commit `ref` points at, null when it does not exist, or what git said when it could not be read. */
function resolveRef(git: GitRunner, ref: string): { readonly sha: string | null } | { readonly error: string } {
  const resolved = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  const sha = resolved.stdout.trim();
  if (resolved.ok && sha !== '') return { sha };
  const said = gitSaid(resolved);
  return said === ''
    ? { sha: null }
    : { error: said };
}

/** Points `lost/<stub>` at the local tip of `branch` without moving it off any commit; see the module note. */
function keepCommits(git: GitRunner, branch: string): LostBranch {
  const name = lostBranchFor(branch);
  const tip = resolveRef(git, localRef(branch));
  if ('error' in tip || tip.sha === null) {
    const said = 'error' in tip
      ? `: ${tip.error}`
      : '';
    return { state: 'failed', name, sha: null, reason: `the local ${branch} could not be read${said}` };
  }
  const { sha } = tip;
  const lostRef = localRef(name);
  const existing = resolveRef(git, lostRef);
  if ('error' in existing) {
    return { state: 'failed', name, sha, reason: `${name} could not be read: ${existing.error}` };
  }
  if (existing.sha === sha) return { state: 'existing', name, sha };
  if (existing.sha !== null && !git(['merge-base', '--is-ancestor', existing.sha, sha]).ok) {
    return { state: 'failed', name, sha, reason: `${name} already holds ${existing.sha}, which is not an ancestor of ${sha}, so it was left as it was` };
  }
  const written = git(['update-ref', lostRef, sha, existing.sha ?? MUST_NOT_EXIST]);
  if (!written.ok) {
    return { state: 'failed', name, sha, reason: `${name} could not be written: ${gitSaid(written)}` };
  }
  return existing.sha === null
    ? { state: 'created', name, sha }
    : { state: 'advanced', name, sha };
}

/** `this device (store <id>)`, or what it is called when its store names none. */
function thisDevice(storeId: string | null): string {
  return storeId === null
    ? 'this device, whose store names no claimant'
    : `this device (store ${storeId})`;
}

/** Where the commits are, as the report's third line. */
function keptLine(lost: Extract<RefusedPushReading, { outcome: 'lost' }>): string {
  const { kept, branch } = lost;
  if (kept.state !== 'failed') return `This device's commits are kept on the local branch ${kept.name} at ${kept.sha}.`;
  const where = kept.sha === null
    ? `on the local ${branch}`
    : `on the local ${branch} at ${kept.sha}`;
  return `This device's commits stay ${where}: ${kept.reason}.`;
}

/** The report's last line: what this device can do next. */
function nextStep(lost: Extract<RefusedPushReading, { outcome: 'lost' }>): string {
  const { issue, storeId, pending, owner } = lost;
  if (storeId !== null && pending?.to === storeId) {
    return `Next safe step: store ${owner} offered this device the claim; rafa claim accept ${String(issue)} takes it up.`;
  }
  return storeId === null
    ? `Next safe step: agree with store ${owner} who carries #${String(issue)} on.`
    : `Next safe step: agree with store ${owner} who carries #${String(issue)} on; it can hand the claim back with rafa claim hand ${String(issue)} --to=${storeId}.`;
}

/**
 * The "claim lost" report for a `lost` reading: the new owner, the
 * refused push with nothing forced over it, where this device's commits
 * are, and the next safe step, one line each after the first indented.
 */
export function claimLostReport(lost: Extract<RefusedPushReading, { outcome: 'lost' }>): string {
  const { issue, branch, owner, storeId } = lost;
  return [
    `❌ Claim lost: #${String(issue)} is claimed by store ${owner} on ${branch}, not by ${thisDevice(storeId)}.`,
    `${REMOTE} refused the push of ${branch}, and nothing was force-pushed over store ${owner}'s branch.`,
    keptLine(lost),
    nextStep(lost),
  ].map((line, index) => index === 0
    ? line
    : `   ${line}`)
    .join('\n');
}
