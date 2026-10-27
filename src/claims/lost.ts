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
 * The caller has already pushed the claim branch, the `naming.branch`
 * template with the stub in it (`feat/rafa-<n>-<slug>` by default), and
 * been refused, so this module never pushes: not again, not with a
 * lease, never with force. It runs one fetch of the template's claim
 * branches and reads the remote's branch as that fetch left it
 * (`./git.ts`); the remote is the authority on who holds the claim.
 * The template is {@link RefusedPushInput.branchTemplate}, the default
 * `feat/{stub}` when left out; a branch under any other template is no
 * claim branch.
 *
 * | Reading of the remote | Answer |
 * |---|---|
 * | `held` by another store, a handover pending or not | `lost`, naming the new owner |
 * | `held` by this store, under its id or one it replaced | `not-lost` (`owned`): the refusal is not about the claim |
 * | `released` | `not-lost` (`released`): nobody owns it, so nobody took it |
 * | no claim commit on the branch | `not-lost` (`no-claim`): a branch as today |
 * | absent | `not-lost` (`absent`): the remote has no such branch |
 * | a branch that is no claim branch | `not-lost` (`not-a-claim-branch`), with no git run |
 * | a failed fetch, or an unreadable branch | `unknown`, with what git said |
 *
 * `holdsClaim` (`./device.ts`) decides whether the remote's holder is
 * this device: true for the store's id and for each id it replaced
 * (`replacedIds`), so a claim made before the store re-minted in place
 * is not read as lost. The same comparison decides whether a pending
 * handover (`pending.to`) names this device, so an offer made to a
 * replaced id still carries into the report's next step. The `owned`
 * reason and the next step's `--to=` both name the store's own id,
 * never the replaced one the claim or the handover named.
 *
 * A device whose store names no id (`storeId: null`) holds no claim, so
 * a claim held by any store is read as held by another: the commits are
 * kept either way, which costs nothing when it was not needed.
 *
 * ## Keeping the commits
 *
 * On `lost`, the local `refs/heads/lost/<stub>` is pointed at the local
 * tip of the claim branch, the commits the refused push carried. The
 * `lost/` prefix is rafa's own namespace and stays fixed whatever the
 * template: `work/rafa-7-x` under `work/{stub}` keeps `lost/rafa-7-x`,
 * the stub `stubOfBranch` reads. It is
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
 * claim branch, which the report says. Nothing here touches the working
 * tree, the index, `HEAD` or the claim branch itself.
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
import type { DeviceStoreIds } from './device.js';
import type { ClaimBranchReading } from '@open-tomato/rafa/claims/git';
import type { PendingHandover } from '@open-tomato/rafa/claims/record';
import type { GitRunner } from '@open-tomato/rafa-pr';

import { gitSaid } from '@open-tomato/rafa-pr';

import { claimBranchIssue, fetchClaimBranches, readClaimBranch } from '@open-tomato/rafa/claims/git';
import { branchFromTemplate, DEFAULT_BRANCH_TEMPLATE, stubOfBranch } from '@open-tomato/rafa/core/config/sections';
import { localRef, REMOTE } from '@open-tomato/rafa/start/branch-decision';

import { holdsClaim } from './device.js';

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
    /** The commit it now points at: the local tip of the claim branch. */
    readonly sha: string;
  }
  | {
    readonly state: 'failed';
    readonly name: string;
    /** The local tip of the claim branch, or null when it could not be read. */
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
    /** The ids that store carried before; empty when `storeId` is null. */
    readonly replacedIds: DeviceStoreIds['replacedIds'];
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
  /** The branch whose push was refused: the template with the stub, `feat/rafa-<n>-<slug>` by default. */
  readonly branch: string;
  /**
   * The `naming.branch` template the claim branch is read under, for the
   * fetch, the issue and the remote reading; `DEFAULT_BRANCH_TEMPLATE`
   * when left out.
   */
  readonly branchTemplate?: string;
  /** This device's store id, or null when its store names none. */
  readonly storeId: string | null;
  /** The ids that store carried before; none for a store that names no id. */
  readonly replacedIds: DeviceStoreIds['replacedIds'];
}

/** The old value `git update-ref` reads as "the ref must not exist yet". */
const MUST_NOT_EXIST = '';

/**
 * The branch that keeps the commits of a lost claim on `branch`, a
 * claim branch under `template`: its stub, as `stubOfBranch` reads it,
 * under `lost/`, so `feat/rafa-7-x` and, under `work/{stub}`,
 * `work/rafa-7-x` both become `lost/rafa-7-x`. Throws on a branch that
 * is not a claim branch under `template`, since one reaching here is
 * the caller's mistake.
 */
export function lostBranchFor(branch: string, template: string = DEFAULT_BRANCH_TEMPLATE): string {
  const stub = stubOfBranch(template, branch);
  if (stub === null || claimBranchIssue(branch, template) === null) {
    throw new Error(`claim lost: ${JSON.stringify(branch)} is not a ${branchFromTemplate(template, 'rafa-<n>')} branch`);
  }
  return `${LOST_PREFIX}${stub}`;
}

/**
 * Reads who owns the claim on `branch` after its push was refused and,
 * when another store does, keeps this device's commits on the local
 * `lost/<stub>`. Pushes nothing and never throws for what git says; see
 * the module note for every answer.
 */
export function readRefusedPush(git: GitRunner, input: RefusedPushInput): RefusedPushReading {
  const { branch, storeId } = input;
  const template = input.branchTemplate ?? DEFAULT_BRANCH_TEMPLATE;
  const device = storeId === null
    ? null
    : { storeId, replacedIds: input.replacedIds };
  const issue = claimBranchIssue(branch, template);
  if (issue === null) {
    return { outcome: 'not-lost', branch, cause: 'not-a-claim-branch', reason: `${branch} is not a claim branch, so it carries no claim to lose` };
  }
  const fetched = fetchClaimBranches(git, template);
  if (!fetched.ok) {
    return { outcome: 'unknown', issue, branch, reason: fetched.reason };
  }
  const remote = readClaimBranch(git, branch, template);
  const notLost = notLostReading(issue, remote, device);
  if (notLost !== null) return notLost;
  if (remote.state !== 'found' || remote.ownership.state !== 'held') {
    return { outcome: 'unknown', issue, branch, reason: `the claim on ${REMOTE}/${branch} could not be read` };
  }
  const { owner, pending } = remote.ownership;
  return {
    outcome: 'lost',
    issue,
    branch,
    owner,
    pending,
    storeId,
    replacedIds: input.replacedIds,
    remoteTip: remote.tip,
    kept: keepCommits(git, branch, template),
  };
}

/** This device's ids, or null when its store names none. */
type Claimant = Pick<DeviceStoreIds, 'storeId' | 'replacedIds'> | null;

/** The answer for every reading but a claim another store holds, or null for that one. */
function notLostReading(issue: number, remote: ClaimBranchReading, device: Claimant): RefusedPushReading | null {
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
  return device !== null && holdsClaim(device, ownership.owner)
    ? { outcome: 'not-lost', branch, cause: 'owned', reason: `this device (store ${device.storeId}) still holds the claim on ${REMOTE}/${branch}` }
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

/** Points `lost/<stub>` at the local tip of `branch`, a claim branch under `template`, without moving it off any commit; see the module note. */
function keepCommits(git: GitRunner, branch: string, template: string): LostBranch {
  const name = lostBranchFor(branch, template);
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
  const { issue, storeId, replacedIds, pending, owner } = lost;
  const device = storeId === null
    ? null
    : { storeId, replacedIds };
  if (device !== null && pending !== null && holdsClaim(device, pending.to)) {
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
