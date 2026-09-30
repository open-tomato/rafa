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
 *
 * ## Claim ahead
 *
 * A request carrying an `ahead` request, with `claims.ahead: allow` or
 * its `--claim-ahead`, also claims the line ahead, C (`./ahead.ts`). The
 * home issue's branches are read first, as above, and a home refusal
 * refuses the run with no ahead tried. A C that is not on the home
 * issue's board is reported not claimed, and the home issue is claimed
 * alone. Otherwise C's branches are read the same way, off the same
 * fetch, and the answer carries an `ahead` report:
 *
 * | C's reading | Home | C |
 * |---|---|---|
 * | held by this store | claimed alone, as above | `claimed` via `held` |
 * | refused (another store, or a branch that keeps it taken) | neither: `unclaimed`, `ahead-taken` | `taken` |
 * | absent, released or stale `rafa:claimed` | one `git push --atomic` of both | `claimed` via `claim` or `take` |
 *
 * The atomic push lands both or neither. A refusal over the home branch
 * refuses the run as a lone push would; one over C's answers the home
 * issue `unclaimed` (`ahead-taken`), naming who holds C; any other
 * failure answers it `push-failed`. In every "neither" the home claim
 * commit waits on the local branch as a failed push leaves it, for
 * `loop start` to push, and a home claim this store already held stands.
 * A landed C gets `rafa:claimed` by the home label's rule, over the
 * labels the request read off C, and never `rafa:in-development`.
 */
import type { AheadClaim, AheadRequest, AtomicClaimRef } from './ahead.js';
import type { DeviceStoreId } from './device.js';
import type { ClaimBranchReading } from './git.js';
import type { IssueBoard } from '../board/issue-board.js';
import type { ClaimsAhead, ClaimsStaleAfter } from '../config-sections.js';
import type { GitRunner } from '../pr/index.js';

import path from 'node:path';

import { weighBranchClaim } from '../board/roadmap-claims.js';
import { gitSaid } from '../pr/index.js';
import { BRANCH_PREFIX, branchNameFor, localRef, REMOTE } from '../start/branch-decision.js';

import { aheadEnabled, aheadNotClaimed, pushClaimsAtomic, resolveAheadTarget } from './ahead.js';
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
export type UnclaimedCause =
  | 'no-issue'
  | 'branch-mismatch'
  | 'no-store-id'
  | 'offline'
  | 'commit-failed'
  | 'push-failed'
  | 'ahead-taken';

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
    /** What claim ahead did with the line ahead; absent when claim ahead did not run. */
    readonly ahead?: AheadClaim;
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
    /** What claim ahead did with the line ahead; absent when claim ahead did not run. */
    readonly ahead?: AheadClaim;
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
  /** The line ahead, for a run that walked a board; left out, claim ahead does not run. */
  readonly ahead?: AheadRequest;
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
  /** `claims.ahead`; `--claim-ahead` rides on the request. */
  readonly claimsAhead: ClaimsAhead;
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
 * Claims the issue of a `plan create` run, and the line ahead when claim
 * ahead runs: see the module note for the order and every answer. Never
 * throws for what git or the board says; throws only what `readStoreId`
 * throws for a store it cannot read.
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
  const ahead = request.ahead !== undefined && aheadEnabled(context.claimsAhead, request.ahead.flag)
    ? request.ahead
    : null;
  const answer = claimOnRemote(attempt, ahead, context);
  if (answer.outcome === 'refused') return answer;
  const homeLabel = answer.outcome === 'claimed' && needsClaimedLabel(request.labels)
    ? await labelWarning(context.board, answer.issue)
    : null;
  const aheadLabel = answer.ahead?.outcome === 'claimed' && needsClaimedLabel(ahead?.candidate?.labels ?? null)
    ? await labelWarning(context.board, answer.ahead.issue)
    : null;
  const warnings = [homeLabel, aheadLabel].filter((warning) => warning !== null);
  return warnings.length === 0
    ? answer
    : { ...answer, warnings: [...answer.warnings, ...warnings] };
}

/** The warning a `rafa:claimed` write left, or null when the board took it. */
async function labelWarning(board: IssueBoard | null, issue: number): Promise<string | null> {
  const label = await labelClaimed(board, issue);
  return label.outcome === 'written'
    ? null
    : label.warning;
}

/** `answer` carrying the claim ahead report `ahead`; a refusal carries none. */
function withAhead(answer: PlanClaim, ahead: AheadClaim): PlanClaim {
  return answer.outcome === 'refused'
    ? answer
    : { ...answer, ahead };
}

/** The claim as the remote decides it, after one fetch; the pair when claim ahead runs. */
function claimOnRemote(attempt: Attempt, ahead: AheadRequest | null, context: PlanClaimContext): PlanClaim {
  const { git } = context;
  const fetched = fetchClaimBranches(git);
  if (!fetched.ok) {
    const answer = keepLocally(attempt, git, 'offline', fetched.reason);
    return ahead === null
      ? answer
      : withAhead(answer, notTried(ahead, `${REMOTE} could not be reached`));
  }

  const listed = git(['for-each-ref', '--format=%(refname:lstrip=3)', `refs/remotes/${REMOTE}/${BRANCH_PREFIX}`]);
  if (!listed.ok) {
    return refused(attempt, attempt.branch, null, `the ${REMOTE} branches of #${String(attempt.issue)} could not be listed: ${gitSaid(listed)}`);
  }
  const names = listed.stdout.split('\n').map((line) => line.trim());
  const move = readMove(attempt, names, context);
  if (ahead === null || move.kind === 'answer') return carryOut(attempt, move, git);

  const target = resolveAheadTarget(ahead, attempt.issue);
  if (!target.ok) return withAhead(carryOut(attempt, move, git), target.report);
  const forward: Attempt = { ...attempt, issue: target.issue, branch: target.branch, labels: target.labels };
  return claimPair({ attempt, move }, { attempt: forward, move: readMove(forward, names, context) }, git);
}

/** The report of a line ahead no claim was tried on, since the home issue's could not be pushed. */
function notTried(ahead: AheadRequest, why: string): AheadClaim {
  const issue = ahead.candidate?.issue ?? null;
  const line = issue === null
    ? 'the line ahead'
    : `#${String(issue)}, the line ahead,`;
  return aheadNotClaimed(issue, 'not-tried', `${line} was not claimed: ${why}`);
}

/** What the remote's reading of an attempt's branches leaves to do; see the module note's table. */
type Move =
  | { readonly kind: 'answer'; readonly answer: PlanClaim }
  | { readonly kind: 'held' }
  | { readonly kind: 'fresh' }
  | { readonly kind: 'take'; readonly tip: string };

/** What {@link claimOwnBranch} and the other branches of the issue among `names` leave to do. */
function readMove(attempt: Attempt, names: readonly string[], context: PlanClaimContext): Move {
  const { git } = context;
  const others = names.filter((name) => name !== attempt.branch && claimBranchIssue(name) === attempt.issue);
  for (const other of others) {
    const refusal = otherBranchRefusal(attempt, readClaimBranch(git, other), context);
    if (refusal !== null) return { kind: 'answer', answer: refusal };
  }
  return claimOwnBranch(attempt, readClaimBranch(git, attempt.branch), context);
}

/** Carries out one attempt's move alone, as a run without claim ahead does. */
function carryOut(attempt: Attempt, move: Move, git: GitRunner): PlanClaim {
  if (move.kind === 'answer') return move.answer;
  if (move.kind === 'held') return claimed(attempt, 'held');
  return move.kind === 'fresh'
    ? pushFreshClaim(attempt, git)
    : pushTake(attempt, move.tip, git);
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

/** What the claim on `feat/<stub>` itself leaves to do; see the module note's table. */
function claimOwnBranch(attempt: Attempt, reading: ClaimBranchReading, context: PlanClaimContext): Move {
  if (reading.state === 'absent') return { kind: 'fresh' };
  const unreadable = (): Move => ({
    kind: 'answer',
    answer: refused(attempt, attempt.branch, null, `the claim on ${attempt.branch} could not be read`),
  });
  const unnamed = unnamedRefusal(attempt, reading);
  if (unnamed !== null) return { kind: 'answer', answer: unnamed };
  if (reading.state !== 'found') return unreadable();
  const weighed = weighBranchClaim(reading, { labels: attempt.labels ?? [], staleAfter: context.staleAfter, now: context.now });
  if (weighed.state === 'released' || weighed.state === 'stale-claimed') return { kind: 'take', tip: reading.tip };
  if (weighed.state === 'none' || weighed.state === 'unreadable') return unreadable();
  if (weighed.owner === attempt.storeId) return { kind: 'held' };
  const note = weighed.state === 'stale-in-development'
    ? ', stale but in development, which is never taken over automatically'
    : '';
  const reason = `#${String(attempt.issue)} is claimed by store ${weighed.owner} on ${attempt.branch}${note}`;
  return { kind: 'answer', answer: refused(attempt, attempt.branch, weighed.owner, reason) };
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

/** How a push of one claim commit was refused: the branch held another claim, or moved since the lease. */
type Race = 'claimed' | 'moved';

/** Why a claim lost its race for `attempt`'s branch, naming the store that holds it when one does. */
function raceReason(attempt: Attempt, race: Race, owner: string | null): string {
  const issue = `#${String(attempt.issue)}`;
  if (race === 'claimed') {
    const holder = owner === null
      ? 'another commit'
      : `store ${owner}`;
    return `${issue} is claimed by ${holder} on ${attempt.branch}: ${REMOTE} refused this device's claim`;
  }
  const holder = owner === null
    ? ''
    : `, now held by store ${owner}`;
  return `${attempt.branch} moved on ${REMOTE} while ${issue} was being taken over${holder}`;
}

/** The store holding `branch` after one more fetch, or null when none is named or the fetch failed. */
function refetchedOwner(git: GitRunner, branch: string): string | null {
  const fetched = fetchClaimBranches(git);
  return fetched.ok
    ? ownerOf(readClaimBranch(git, branch))
    : null;
}

/** A claim or take commit made and ready to push, with its lease and the local tip before it. */
type Staged =
  | {
    readonly ok: true;
    readonly sha: string;
    readonly localTip: string | null;
    readonly lease: string | null;
    readonly via: 'claim' | 'take';
  }
  | { readonly ok: false; readonly reason: string };

/** The commit a fresh claim or a take pushes; see "The local branch". */
function stage(attempt: Attempt, move: Extract<Move, { kind: 'fresh' | 'take' }>, git: GitRunner): Staged {
  if (move.kind === 'fresh') {
    const prepared = prepareClaim(attempt, git);
    return prepared.ok
      ? { ...prepared, lease: null, via: 'claim' }
      : prepared;
  }
  const made = makeOwnershipCommit(git, move.tip, { action: 'take', issue: attempt.issue, store: attempt.storeId });
  if (!made.ok) return made;
  return { ok: true, sha: made.sha, localTip: tipOf(git, localRef(attempt.branch)), lease: move.tip, via: 'take' };
}

/** The warning left by fast-forwarding a local branch that exists to a landed commit, or null; see "The local branch". */
function landLocal(attempt: Attempt, staged: Extract<Staged, { ok: true }>, git: GitRunner): string | null {
  return staged.localTip === null
    ? null
    : moveLocal(git, attempt.branch, staged.sha, staged.localTip);
}

/** Pushes a claim commit to a branch the remote does not hold, without force. */
function pushFreshClaim(attempt: Attempt, git: GitRunner): PlanClaim {
  const staged = stage(attempt, { kind: 'fresh' }, git);
  if (!staged.ok) return unclaimed(attempt.issue, 'commit-failed', staged.reason);
  const pushed = pushNewClaimBranch(git, staged.sha, attempt.branch);
  if (pushed.outcome === 'failed') return keepPending(attempt, git, 'push-failed', pushed.reason, staged.sha, staged.localTip);
  if (pushed.outcome === 'claimed') {
    const owner = ownerOf(pushed.holder);
    return refused(attempt, attempt.branch, owner, raceReason(attempt, 'claimed', owner));
  }
  return claimed(attempt, 'claim', warningsOf(landLocal(attempt, staged, git)));
}

/** Pushes a take commit on a released or stale claimed branch's tip, leased on that tip. */
function pushTake(attempt: Attempt, tip: string, git: GitRunner): PlanClaim {
  const staged = stage(attempt, { kind: 'take', tip }, git);
  if (!staged.ok) return unclaimed(attempt.issue, 'commit-failed', staged.reason);
  const pushed = pushOwnershipCommit(git, staged.sha, attempt.branch, tip);
  if (pushed.outcome === 'failed') return keepPending(attempt, git, 'push-failed', pushed.reason, staged.sha, staged.localTip);
  if (pushed.outcome === 'moved') {
    const owner = refetchedOwner(git, attempt.branch);
    return refused(attempt, attempt.branch, owner, raceReason(attempt, 'moved', owner));
  }
  return claimed(attempt, 'take', warningsOf(landLocal(attempt, staged, git)));
}

/** One half of a claim ahead: the attempt and what its reading left to do. */
interface Side {
  readonly attempt: Attempt;
  readonly move: Move;
}

/** The report of a claimed line ahead. */
function aheadClaimed(attempt: Attempt, via: ClaimVia): AheadClaim {
  return { outcome: 'claimed', issue: attempt.issue, branch: attempt.branch, via };
}

/** The ref a staged commit is pushed as. */
function refOf(attempt: Attempt, staged: Extract<Staged, { ok: true }>): AtomicClaimRef {
  return { branch: attempt.branch, sha: staged.sha, lease: staged.lease };
}

/**
 * The home issue's answer when its claim ahead failed, so neither claim
 * lands: a claim this store already held stands; otherwise the home
 * claim commit waits on the local branch, as a push that failed leaves it.
 */
function neither(home: Side, git: GitRunner, cause: UnclaimedCause, why: string, ahead: AheadClaim): PlanClaim {
  const { attempt, move } = home;
  if (move.kind === 'answer') return move.answer;
  if (move.kind === 'held') return withAhead(claimed(attempt, 'held'), ahead);
  const staged = stage(attempt, move, git);
  const answer = staged.ok
    ? keepPending(attempt, git, cause, why, staged.sha, staged.localTip)
    : unclaimed(attempt.issue, 'commit-failed', staged.reason);
  return withAhead(answer, ahead);
}

/** Why the home claim was not pushed when the line ahead `issue` could not be claimed. */
function pairWhy(issue: number, reason: string): string {
  return `claim ahead takes both claims or neither, and #${String(issue)}, the line ahead, was not claimed: ${reason}`;
}

/**
 * The home issue and the line ahead claimed together, or neither; see
 * the module note's "Claim ahead". The home move is never an answer here.
 */
function claimPair(home: Side, ahead: Side, git: GitRunner): PlanClaim {
  if (home.move.kind === 'answer') return home.move.answer;
  const forward = ahead.attempt;
  const line = `#${String(forward.issue)}, the line ahead, was not claimed`;
  if (ahead.move.kind === 'answer') {
    const reason = ahead.move.answer.outcome === 'refused'
      ? ahead.move.answer.reason
      : `the claim on ${forward.branch} could not be read`;
    const report = aheadNotClaimed(forward.issue, 'taken', `${line}: ${reason}`);
    return neither(home, git, 'ahead-taken', pairWhy(forward.issue, reason), report);
  }
  if (ahead.move.kind === 'held') return withAhead(carryOut(home.attempt, home.move, git), aheadClaimed(forward, 'held'));

  const aheadStaged = stage(forward, ahead.move, git);
  if (!aheadStaged.ok) {
    const report = aheadNotClaimed(forward.issue, 'failed', `${line}: ${aheadStaged.reason}`);
    return neither(home, git, 'commit-failed', pairWhy(forward.issue, aheadStaged.reason), report);
  }
  const homeStaged = home.move.kind === 'held'
    ? null
    : stage(home.attempt, home.move, git);
  if (homeStaged?.ok === false) {
    const report = aheadNotClaimed(forward.issue, 'not-tried', `${line}: the claim on #${String(home.attempt.issue)} could not be made`);
    return withAhead(unclaimed(home.attempt.issue, 'commit-failed', homeStaged.reason), report);
  }
  return pushPair(home, homeStaged, { attempt: forward, staged: aheadStaged }, git);
}

/** A staged half of a pair: its attempt and its commit. */
interface StagedSide {
  readonly attempt: Attempt;
  readonly staged: Extract<Staged, { ok: true }>;
}

/** Pushes the pair in one `git push --atomic` and answers what landed; `homeStaged` is null for a home claim already held. */
function pushPair(home: Side, homeStaged: Extract<Staged, { ok: true }> | null, ahead: StagedSide, git: GitRunner): PlanClaim {
  const forward = ahead.attempt;
  const refs = homeStaged === null
    ? [refOf(forward, ahead.staged)]
    : [refOf(home.attempt, homeStaged), refOf(forward, ahead.staged)];
  const pushed = pushClaimsAtomic(git, refs);
  const line = `#${String(forward.issue)}, the line ahead, was not claimed`;

  if (pushed.outcome === 'pushed') {
    const warnings = [
      homeStaged === null
        ? null
        : landLocal(home.attempt, homeStaged, git),
      landLocal(forward, ahead.staged, git),
    ].filter((warning) => warning !== null);
    const via = homeStaged?.via ?? 'held';
    return withAhead(claimed(home.attempt, via, warnings), aheadClaimed(forward, ahead.staged.via));
  }
  if (pushed.outcome === 'refused' && pushed.branch === home.attempt.branch) {
    const owner = refetchedOwner(git, home.attempt.branch);
    return refused(home.attempt, home.attempt.branch, owner, raceReason(home.attempt, pushed.by, owner));
  }
  const reason = pushed.outcome === 'refused'
    ? raceReason(forward, pushed.by, refetchedOwner(git, forward.branch))
    : pushed.reason;
  const cause = pushed.outcome === 'refused'
    ? 'taken'
    : 'failed';
  const report = aheadNotClaimed(forward.issue, cause, `${line}: ${reason}`);
  if (homeStaged === null) return withAhead(claimed(home.attempt, 'held'), report);
  const homeCause = pushed.outcome === 'refused'
    ? 'ahead-taken'
    : 'push-failed';
  const why = pushed.outcome === 'refused'
    ? pairWhy(forward.issue, reason)
    : reason;
  return withAhead(keepPending(home.attempt, git, homeCause, why, homeStaged.sha, homeStaged.localTip), report);
}
