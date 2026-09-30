/**
 * The claim a `plan create` run makes on its issue, BEFORE its planning
 * session is spawned, so a lost race costs no session
 * (`.rafa/plans/rafa-324-claim-issue-so-two`). {@link claimPlanIssue}
 * resolves the issue, reads this device's store id, pushes the claim,
 * puts `rafa:claimed` on the issue, and answers one of three outcomes;
 * what a command does with each is the caller's.
 *
 * | Outcome | When | Carries |
 * |---|---|---|
 * | `claimed` | this device holds the claim now | `via`: `claim`, `take` or `held` |
 * | `refused` | another store holds it, or a branch of the issue keeps it taken | the owner's store id, or null, and a reason naming it |
 * | `unclaimed` | no claim could be made or pushed | the cause, a reason, and the claim commit left on the local branch, if any |
 *
 * ## Which issue, and which branch
 *
 * The issue is the one the run read (`--issue`, `--next`), else the one
 * the spec's basename opens with (`rafa-<n>-`). The claim lives on the
 * branch the loop runs on, `feat/<stub>`, so that branch must be a claim
 * branch of THAT issue: a `--stub` naming no issue, or another one,
 * answers `unclaimed` (`branch-mismatch`) rather than claim a branch the
 * loop would never run on.
 *
 * ## What the remote decides
 *
 * One fetch of the `feat/rafa-*` branches (`./git.ts`), then:
 *
 * | Reading | Answer |
 * |---|---|
 * | another branch of the issue that keeps it taken, or is this device's or a takeover candidate | `refused`, naming the branch to plan on (`--stub`) |
 * | `feat/<stub>` absent | a claim commit pushed WITHOUT force; the remote's refusal is the compare-and-set |
 * | `feat/<stub>` held by this store, stale or not | `claimed` via `held`: nothing is pushed |
 * | `feat/<stub>` released, or a stale `rafa:claimed` claim | a take commit on its tip, pushed with the tip as lease |
 * | `feat/<stub>` held by another store, stale in development included | `refused` naming the owner |
 * | `feat/<stub>` with no claim commit, or unreadable | `refused`, owner null: taken as a branch always was |
 *
 * A released or stale branch of the issue under ANOTHER name is not
 * taken over from here: the loop would run on `feat/<stub>`, not on it.
 * A released one is passed over; a stale one refuses, naming the stub
 * to plan it under. Staleness is weighed as the roadmap walk weighs it
 * (`weighBranchClaim`), with the labels the run read off the issue; a
 * run with no labels (`--spec`) weighs none, which reads as in
 * development and so never as a takeover candidate.
 *
 * ## The local branch
 *
 * The claim commit is made on the local `feat/<stub>` when this checkout
 * has one, so its commits stay on the branch, and otherwise on `base`
 * (`HEAD` unless the caller names another). A local tip that is already
 * this store's claim commit for the issue is pushed again as it stands,
 * so a retried run makes no second commit. On a failed fetch or push
 * the commit stays on the local `feat/<stub>`, created or fast-forwarded
 * to it, with no upstream, and the answer names it as `pending` for
 * `loop start`'s preflight to push. On a landed push the local branch is
 * fast-forwarded when it exists and is not created when it does not:
 * measured on git 2.53.0 (2026-09-30), `git push origin <sha>:refs/heads/<b>`
 * from a clone also wrote `refs/remotes/origin/<b>`, so `loop start`'s
 * branch offer finds the claim as a remote branch and tracks it. A local
 * branch that does not lead to a taken-over tip is left as it was, with
 * a warning. Nothing here touches the working tree or the index.
 *
 * ## The label
 *
 * `rafa:claimed` is written through `./labels.ts`, best-effort: a failed
 * write is a warning beside a claim that stands. It is written only when
 * the issue is not known to carry a stage label already, so a takeover
 * of a stale `rafa:claimed` claim sends nothing and an issue in
 * development is never given `rafa:claimed` beside it.
 */
import type { DeviceStoreId } from './device.js';
import type { ClaimBranchReading } from './git.js';
import type { IssueBoard } from '../board/issue-board.js';
import type { ClaimsStaleAfter } from '../config-sections.js';
import type { GitRunner } from '../pr/index.js';

import path from 'node:path';

import { weighBranchClaim } from '../board/roadmap-claims.js';
import { gitSaid } from '../pr/index.js';
import { BRANCH_PREFIX, branchNameFor, localRef, REMOTE } from '../start/branch-decision.js';

import {
  claimBranchIssue,
  fetchClaimBranches,
  makeOwnershipCommit,
  pushNewClaimBranch,
  pushOwnershipCommit,
  readClaimBranch,
} from './git.js';
import { labelClaimed } from './labels.js';
import { parseClaimMessage } from './record.js';
import { CLAIMED_LABEL, IN_DEVELOPMENT_LABEL } from './stale.js';

/** Why a run made no claim. */
export type UnclaimedCause = 'no-issue' | 'branch-mismatch' | 'no-store-id' | 'offline' | 'commit-failed' | 'push-failed';

/** How a claimed run came to hold its claim. */
export type ClaimVia = 'claim' | 'take' | 'held';

/** A claim commit left on the local branch, waiting to be pushed. */
export interface PendingClaim {
  readonly branch: string;
  readonly sha: string;
}

/** What {@link claimPlanIssue} answered; see the module note. */
export type PlanClaim =
  | {
    readonly outcome: 'claimed';
    readonly issue: number;
    readonly branch: string;
    readonly storeId: string;
    readonly via: ClaimVia;
    readonly warnings: readonly string[];
  }
  | {
    readonly outcome: 'refused';
    readonly issue: number;
    /** The branch whose claim refused this run. */
    readonly branch: string;
    /** The store holding that branch's claim, or null when it names none. */
    readonly owner: string | null;
    readonly reason: string;
  }
  | {
    readonly outcome: 'unclaimed';
    readonly issue: number | null;
    readonly cause: UnclaimedCause;
    readonly reason: string;
    readonly pending: PendingClaim | null;
    readonly warnings: readonly string[];
  };

/** What the run knows of its issue and its plan. */
export interface PlanClaimRequest {
  /** The issue the run read (`--issue`, `--next`), or null under `--spec`. */
  readonly issue: number | null;
  /** The spec's path, whose basename names the issue under `--spec`. */
  readonly specPath: string;
  /** The plan's stub: the loop runs on `feat/<stub>`. */
  readonly stub: string;
  /** The labels on the issue as the run read them, or null when it read none. */
  readonly labels: readonly string[] | null;
  /** What a claim commit is made on when this checkout has no `feat/<stub>`; `HEAD` when left out. */
  readonly base?: string;
}

/** The seams and settings a claim is made through. */
export interface PlanClaimContext {
  readonly git: GitRunner;
  /** The board labels are written to, or null when it is not `gh`. */
  readonly board: IssueBoard | null;
  /** This device's store id; `readDeviceStoreId` over the project. */
  readonly readStoreId: () => DeviceStoreId;
  /** `claims.staleAfter`. */
  readonly staleAfter: ClaimsStaleAfter;
  /** The clock a claim's idle time is read against. */
  readonly now: Date;
}

/** One claim attempt: the issue, its branch, and who claims it. */
interface Attempt {
  readonly issue: number;
  readonly branch: string;
  readonly storeId: string;
  readonly base: string;
  readonly labels: readonly string[] | null;
}

/** The branch-mismatch or no-issue answer, or the issue and branch to claim. */
type Target =
  | { readonly ok: true; readonly issue: number; readonly branch: string }
  | { readonly ok: false; readonly answer: PlanClaim };

function unclaimed(
  issue: number | null,
  cause: UnclaimedCause,
  reason: string,
  pending: PendingClaim | null = null,
  warnings: readonly string[] = [],
): PlanClaim {
  return { outcome: 'unclaimed', issue, cause, reason, pending, warnings };
}

function refused(attempt: Attempt, branch: string, owner: string | null, reason: string): PlanClaim {
  return { outcome: 'refused', issue: attempt.issue, branch, owner, reason };
}

function claimed(attempt: Attempt, via: ClaimVia, warnings: readonly string[] = []): PlanClaim {
  const { issue, branch, storeId } = attempt;
  return { outcome: 'claimed', issue, branch, storeId, via, warnings };
}

/** The issue and branch a run claims, or why it claims none; see the module note. */
export function resolveClaimTarget(request: PlanClaimRequest): Target {
  const specStub = path.basename(request.specPath).replace(/\.md$/, '');
  const issue = request.issue ?? claimBranchIssue(branchNameFor(specStub));
  if (issue === null) {
    const reason = 'the run names no issue (no --issue or --next, and the spec\'s name does not open rafa-<n>-),'
      + ' so there is nothing to claim';
    return { ok: false, answer: unclaimed(null, 'no-issue', reason) };
  }
  const branch = branchNameFor(request.stub);
  if (claimBranchIssue(branch) !== issue) {
    const reason = `the plan's branch ${branch} is not ${BRANCH_PREFIX}rafa-${String(issue)}-<slug>,`
      + ` so no claim on #${String(issue)} can live on it; pass --stub=rafa-${String(issue)}-<slug>`;
    return { ok: false, answer: unclaimed(issue, 'branch-mismatch', reason) };
  }
  return { ok: true, issue, branch };
}

/** True unless the issue is known to carry a stage label already; see the module note. */
function needsClaimedLabel(labels: readonly string[] | null): boolean {
  return labels === null || (!labels.includes(CLAIMED_LABEL) && !labels.includes(IN_DEVELOPMENT_LABEL));
}

/**
 * Claims the issue of a `plan create` run: see the module note for the
 * order and every answer. Never throws for what git or the board says;
 * throws only what `readStoreId` throws for a store it cannot read.
 */
export async function claimPlanIssue(request: PlanClaimRequest, context: PlanClaimContext): Promise<PlanClaim> {
  const target = resolveClaimTarget(request);
  if (!target.ok) return target.answer;
  const device = context.readStoreId();
  if (!device.ok) return unclaimed(target.issue, 'no-store-id', device.reason);

  const attempt: Attempt = {
    issue: target.issue,
    branch: target.branch,
    storeId: device.storeId,
    base: request.base ?? 'HEAD',
    labels: request.labels,
  };
  const answer = claimOnRemote(attempt, context);
  if (answer.outcome !== 'claimed' || !needsClaimedLabel(request.labels)) return answer;
  const label = await labelClaimed(context.board, answer.issue);
  return label.outcome === 'written'
    ? answer
    : { ...answer, warnings: [...answer.warnings, label.warning] };
}

/** The claim as the remote decides it, after one fetch. */
function claimOnRemote(attempt: Attempt, context: PlanClaimContext): PlanClaim {
  const { git } = context;
  const fetched = fetchClaimBranches(git);
  if (!fetched.ok) return keepLocally(attempt, git, 'offline', fetched.reason);

  const listed = git(['for-each-ref', '--format=%(refname:lstrip=3)', `refs/remotes/${REMOTE}/${BRANCH_PREFIX}`]);
  if (!listed.ok) {
    return refused(attempt, attempt.branch, null, `the ${REMOTE} branches of #${String(attempt.issue)} could not be listed: ${gitSaid(listed)}`);
  }
  const others = listed.stdout.split('\n')
    .map((line) => line.trim())
    .filter((name) => name !== attempt.branch && claimBranchIssue(name) === attempt.issue);
  for (const other of others) {
    const refusal = otherBranchRefusal(attempt, readClaimBranch(git, other), context);
    if (refusal !== null) return refusal;
  }
  return claimOwnBranch(attempt, readClaimBranch(git, attempt.branch), context);
}

/** The owner a reading names, or null when it names none. */
function ownerOf(reading: ClaimBranchReading): string | null {
  return reading.state === 'found' && reading.ownership.state === 'held'
    ? reading.ownership.owner
    : null;
}

/** The refusal of a branch that keeps its issue taken with no claim to name, or null. */
function unnamedRefusal(attempt: Attempt, reading: ClaimBranchReading): PlanClaim | null {
  if (reading.state === 'unreadable') {
    return refused(attempt, reading.branch, null, `the claim on ${reading.branch} could not be read, so #${String(attempt.issue)} stays taken: ${reading.reason}`);
  }
  if (reading.state === 'found' && reading.ownership.state === 'none') {
    return refused(attempt, reading.branch, null, `${reading.branch} exists on ${REMOTE} carrying no claim commit, so #${String(attempt.issue)} stays taken`);
  }
  return null;
}

/** The stub a branch is planned under: `feat/rafa-7-x` is `rafa-7-x`. */
function stubOf(branch: string): string {
  return branch.slice(BRANCH_PREFIX.length);
}

/** Why a branch of the issue other than `feat/<stub>` refuses the run, or null; see the module note. */
function otherBranchRefusal(attempt: Attempt, reading: ClaimBranchReading, context: PlanClaimContext): PlanClaim | null {
  if (reading.state === 'absent') return null;
  const unnamed = unnamedRefusal(attempt, reading);
  if (unnamed !== null || reading.state !== 'found') return unnamed;

  const { branch } = reading;
  const issue = `#${String(attempt.issue)}`;
  const weighed = weighBranchClaim(reading, { labels: attempt.labels ?? [], staleAfter: context.staleAfter, now: context.now });
  if (weighed.state === 'released' || weighed.state === 'none' || weighed.state === 'unreadable') return null;
  const { owner } = weighed;
  if (owner === attempt.storeId) {
    return refused(attempt, branch, owner, `this device (store ${owner}) already holds ${issue} on ${branch}; plan it there with --stub=${stubOf(branch)}`);
  }
  return weighed.state === 'stale-claimed'
    ? refused(attempt, branch, owner, `${issue} is claimed by store ${owner} on ${branch}, stale; take it over by planning there with --stub=${stubOf(branch)}`)
    : refused(attempt, branch, owner, `${issue} is claimed by store ${owner} on ${branch}`);
}

/** The claim on `feat/<stub>` itself; see the module note's table. */
function claimOwnBranch(attempt: Attempt, reading: ClaimBranchReading, context: PlanClaimContext): PlanClaim {
  if (reading.state === 'absent') return pushFreshClaim(attempt, context.git);
  const unnamed = unnamedRefusal(attempt, reading);
  if (unnamed !== null || reading.state !== 'found') {
    return unnamed ?? refused(attempt, attempt.branch, null, `the claim on ${attempt.branch} could not be read`);
  }
  const weighed = weighBranchClaim(reading, { labels: attempt.labels ?? [], staleAfter: context.staleAfter, now: context.now });
  if (weighed.state === 'released' || weighed.state === 'stale-claimed') return pushTake(attempt, reading.tip, context.git);
  if (weighed.state === 'none' || weighed.state === 'unreadable') {
    return refused(attempt, attempt.branch, null, `the claim on ${attempt.branch} could not be read`);
  }
  if (weighed.owner === attempt.storeId) return claimed(attempt, 'held');
  const note = weighed.state === 'stale-in-development'
    ? ', stale but in development, which is never taken over automatically'
    : '';
  return refused(attempt, attempt.branch, weighed.owner, `#${String(attempt.issue)} is claimed by store ${weighed.owner} on ${attempt.branch}${note}`);
}

/** The sha `ref` points at, or null when it names no commit. */
function tipOf(git: GitRunner, ref: string): string | null {
  const resolved = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  const sha = resolved.stdout.trim();
  return resolved.ok && sha !== ''
    ? sha
    : null;
}

/** True when `sha` is this store's claim commit on the attempt's issue. */
function isOwnClaim(git: GitRunner, sha: string, attempt: Attempt): boolean {
  const shown = git(['log', '-1', '--format=%B', sha]);
  if (!shown.ok) return false;
  const reading = parseClaimMessage(shown.stdout);
  return reading.kind === 'ownership'
    && reading.record.action === 'claim'
    && reading.record.issue === attempt.issue
    && reading.record.store === attempt.storeId;
}

/** A claim commit to push, and the local branch's tip before it; see "The local branch". */
type Prepared =
  | { readonly ok: true; readonly sha: string; readonly localTip: string | null }
  | { readonly ok: false; readonly reason: string };

/** The claim commit a fresh claim pushes: the local tip when it is one already, else a new one. */
function prepareClaim(attempt: Attempt, git: GitRunner): Prepared {
  const localTip = tipOf(git, localRef(attempt.branch));
  if (localTip !== null && isOwnClaim(git, localTip, attempt)) return { ok: true, sha: localTip, localTip };
  const made = makeOwnershipCommit(git, localTip ?? attempt.base, {
    action: 'claim',
    issue: attempt.issue,
    store: attempt.storeId,
  });
  return made.ok
    ? { ok: true, sha: made.sha, localTip }
    : made;
}

/**
 * Points the local branch at `sha`: creates it when `localTip` is null,
 * fast-forwards it when `localTip` is an ancestor of `sha`, and
 * otherwise leaves it. Answers a warning, or null when it was moved or
 * already there.
 */
function moveLocal(git: GitRunner, branch: string, sha: string, localTip: string | null): string | null {
  if (localTip === sha) return null;
  if (localTip !== null && !git(['merge-base', '--is-ancestor', localTip, sha]).ok) {
    return `${branch} on this checkout does not lead to the claim ${sha}; it was left as it was.`
      + ` Reset it to ${REMOTE}/${branch} before rafa loop start`;
  }
  const moved = git(['update-ref', '-m', 'rafa: claim', localRef(branch), sha, localTip ?? '']);
  return moved.ok
    ? null
    : `${branch} on this checkout could not be pointed at the claim ${sha}: ${gitSaid(moved)}`;
}

/** The local branch keeps the claim commit it could not push; see "The local branch". */
function keepLocally(attempt: Attempt, git: GitRunner, cause: UnclaimedCause, why: string): PlanClaim {
  const prepared = prepareClaim(attempt, git);
  if (!prepared.ok) return unclaimed(attempt.issue, 'commit-failed', prepared.reason);
  return keepPending(attempt, git, cause, why, prepared.sha, prepared.localTip);
}

/** The unclaimed answer for a claim commit `sha` left on the local branch, or refused to be. */
function keepPending(
  attempt: Attempt,
  git: GitRunner,
  cause: UnclaimedCause,
  why: string,
  sha: string,
  localTip: string | null,
): PlanClaim {
  const { branch } = attempt;
  const warning = moveLocal(git, branch, sha, localTip);
  const reason = `the claim on #${String(attempt.issue)} was not pushed: ${why}`;
  return warning === null
    ? unclaimed(attempt.issue, cause, `${reason}. It waits on the local ${branch} for rafa loop start to push`, { branch, sha })
    : unclaimed(attempt.issue, cause, reason, null, [warning]);
}

/** A warning list of one, or none. */
function warningsOf(warning: string | null): readonly string[] {
  return warning === null
    ? []
    : [warning];
}

/** Pushes a claim commit to a branch the remote does not hold, without force. */
function pushFreshClaim(attempt: Attempt, git: GitRunner): PlanClaim {
  const prepared = prepareClaim(attempt, git);
  if (!prepared.ok) return unclaimed(attempt.issue, 'commit-failed', prepared.reason);
  const { sha, localTip } = prepared;
  const pushed = pushNewClaimBranch(git, sha, attempt.branch);
  if (pushed.outcome === 'failed') return keepPending(attempt, git, 'push-failed', pushed.reason, sha, localTip);
  if (pushed.outcome === 'claimed') {
    const owner = ownerOf(pushed.holder);
    const holder = owner === null
      ? 'another commit'
      : `store ${owner}`;
    return refused(attempt, attempt.branch, owner, `#${String(attempt.issue)} is claimed by ${holder} on ${attempt.branch}: ${REMOTE} refused this device's claim`);
  }
  const warning = localTip === null
    ? null
    : moveLocal(git, attempt.branch, sha, localTip);
  return claimed(attempt, 'claim', warningsOf(warning));
}

/** Pushes a take commit on a released or stale claimed branch's tip, leased on that tip. */
function pushTake(attempt: Attempt, tip: string, git: GitRunner): PlanClaim {
  const made = makeOwnershipCommit(git, tip, { action: 'take', issue: attempt.issue, store: attempt.storeId });
  if (!made.ok) return unclaimed(attempt.issue, 'commit-failed', made.reason);
  const localTip = tipOf(git, localRef(attempt.branch));
  const pushed = pushOwnershipCommit(git, made.sha, attempt.branch, tip);
  if (pushed.outcome === 'failed') return keepPending(attempt, git, 'push-failed', pushed.reason, made.sha, localTip);
  if (pushed.outcome === 'moved') {
    const fetched = fetchClaimBranches(git);
    const owner = fetched.ok
      ? ownerOf(readClaimBranch(git, attempt.branch))
      : null;
    const holder = owner === null
      ? ''
      : `, now held by store ${owner}`;
    return refused(attempt, attempt.branch, owner, `${attempt.branch} moved on ${REMOTE} while #${String(attempt.issue)} was being taken over${holder}`);
  }
  const warning = localTip === null
    ? null
    : moveLocal(git, attempt.branch, made.sha, localTip);
  return claimed(attempt, 'take', warningsOf(warning));
}
