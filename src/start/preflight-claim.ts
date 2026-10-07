/**
 * The claim check of the preflight `loop start` runs (`start/preflight.ts`):
 * a run of an issue this device does not own is refused before any probe
 * and any session, a claim `plan create` could not push is pushed here,
 * and once the whole preflight has passed the issue's `rafa:claimed`
 * label is swapped for `rafa:in-development`
 * (`.rafa/plans/rafa-324-claim-issue-so-two`).
 *
 * ## Which issue, and which branch
 *
 * The claim lives on `feat/<stub>`, the branch the loop runs on, so the
 * issue is the one the plan's stub names: `PLAN-rafa-7-x.md` is #7 on
 * `feat/rafa-7-x`. A plan whose stub opens no `rafa-<n>` (or a bare
 * `PLAN.md`) has no claim to check, and the run goes on as it always
 * did, touching neither git nor the store.
 *
 * ## What is read
 *
 * The local `feat/<stub>` (`readLocalClaimBranch`), where `plan create`
 * leaves a claim commit it could not push, then one fetch of the
 * `feat/rafa-*` branches and the remote's `feat/<stub>` as it left it
 * (`claims/git.ts`). A branch that carries no claim commit on either
 * side is a run as today: nothing more is read and nothing is printed.
 * Otherwise this device's store id is read (`claims/device.ts`); a store
 * that names none leaves this device holding no claim, and a store that
 * cannot be read at all refuses the run.
 *
 * ## What the remote decides
 *
 * The remote is the authority; the local branch matters only for a
 * claim of this device's waiting there unpushed. In order:
 *
 * | Reading | Answer |
 * |---|---|
 * | the remote held by this store | `owned`; after a failed fetch, `unconfirmed` on what the last fetch left |
 * | the remote held by another store | `refused`, naming the owner |
 * | the remote's claim unreadable | `refused`, owner null |
 * | this store's claim waiting on the local branch | pushed WITHOUT force: `owned` via `pushed`, or `refused` naming who holds the branch, or why the push failed |
 * | the remote released | `refused`, owner null: no device holds it |
 * | the local branch held by another store | `refused`, naming the owner |
 * | anything else | `none`: the run goes on as today |
 *
 * The retry pushes the latest ownership commit of the local branch, not
 * its tip, so the work after it is pushed by the wrap-up as ever. It
 * moves no local ref, so the HEAD the loop guard holds the checkout to
 * stays where it was. A failed fetch refuses a waiting claim without
 * trying the push, which would fail the same way. A claim held by
 * another store is refused whatever its age: taking a stale claim over
 * is `plan create`'s, never the loop's.
 *
 * ## The refusal
 *
 * Thrown as `CommandExit` with exit code 1 by {@link refuseUnownedClaim},
 * the reason under one opening line, ending as every refusal ahead of
 * the probes ends:
 *
 *     ❌ Refusing to start: this device does not own the claim on #7.
 *        #7 is claimed by store store-a on feat/rafa-7-x, not by this
 *        device (store store-b)
 *        Nothing was checked and nothing was dispatched.
 *
 * A run that holds its claim prints one line naming it, `info` for a
 * claim confirmed or just pushed and `warn` for one only the last fetch
 * vouches for.
 *
 * ## The label
 *
 * {@link markInDevelopment} swaps the labels through `claims/labels.ts`
 * once the preflight has passed, on a FIRST DISPATCH alone
 * (`preflight/first-dispatch.ts`): a resume's issue was moved on its
 * first run, so each run sends at most one write. The write is
 * best-effort: a board that is not `gh`, or a write that fails, is one
 * warning beside a run that goes on.
 */
import type { IssueBoard } from '../board/issue-board.js';
import type { RefreshConfig } from '../board/project/refresh.js';
import type { DeviceStoreId } from '../claims/device.js';
import type { ClaimBranchReading } from '../claims/git.js';
import type { Ownership } from '../claims/record.js';
import type { RafaConfig } from '../config.js';
import type { GitRunner } from '../pr/index.js';

import { activeOutput } from '../adapters/output/active.js';
import { createGhRunner } from '../adapters/tracker/github.js';
import { createRefreshingGhIssueBoard } from '../board/project/issue-board-refresh.js';
import { readDeviceStoreId } from '../claims/device.js';
import { claimBranchIssue, fetchClaimBranches, pushNewClaimBranch, readClaimBranch, readLocalClaimBranch } from '../claims/git.js';
import { labelInDevelopment } from '../claims/labels.js';
import { parseClaimMessage } from '../claims/record.js';
import { CommandExit } from '../cli/command.js';
import { messageOf } from '../config-sections.js';
import { createGitRunner } from '../pr/git.js';
import { resolvePrProvider } from '../pr/provider.js';
import { planStubFromPath } from '../utils/plan-stamp.js';

import { branchNameFor, REMOTE } from './branch-decision.js';

/** The seams the claim check reads and writes through. */
export interface StartPreflightClaim {
  /** `git` in the project root. */
  readonly git: GitRunner;
  /** The board the label is swapped on, or null when it is not `gh`. */
  readonly board: IssueBoard | null;
  /** This device's store id; `readDeviceStoreId` over the project. */
  readonly readStoreId: () => DeviceStoreId;
}

/**
 * The seams a `loop start` run in `repoRoot` checks its claim through:
 * `git` in the project root, the `gh` issue board when the repository
 * resolves to `pr.provider: gh` and none otherwise, its label writes
 * refreshing the issue on the project (`../board/project/issue-board-refresh.ts`),
 * and this device's
 * store id read under `config.store`. Resolving the provider reads
 * `origin` unless `pr.provider` is configured; nothing else is read
 * until the check runs.
 */
export function createStartPreflightClaim(
  repoRoot: string,
  config: Pick<RafaConfig, 'prProvider' | 'store'> & RefreshConfig,
): StartPreflightClaim {
  const provider = resolvePrProvider({ configured: config.prProvider, dir: repoRoot }).provider;
  return {
    git: createGitRunner(repoRoot),
    board: provider === 'gh'
      ? createRefreshingGhIssueBoard({ gh: createGhRunner({ cwd: repoRoot }), config })
      : null,
    readStoreId: () => readDeviceStoreId(repoRoot, config),
  };
}

/** How a run came to hold its claim. */
export type OwnedVia = 'held' | 'pushed' | 'unconfirmed';

/** What {@link readRunClaim} answered; see the module note. */
export type RunClaim =
  /** No claim to check: the stub names no issue, or no claim commit exists. */
  | { readonly outcome: 'none' }
  | {
    readonly outcome: 'owned';
    readonly issue: number;
    readonly branch: string;
    readonly storeId: string;
    readonly via: OwnedVia;
    /** What the failed fetch said, for an `unconfirmed` claim; empty otherwise. */
    readonly note: string;
  }
  | {
    readonly outcome: 'refused';
    readonly issue: number;
    readonly branch: string;
    /** The store holding the claim, or null when none can be named. */
    readonly owner: string | null;
    readonly reason: string;
  };

/** The answer for a run with no claim to check. */
const NONE: RunClaim = Object.freeze({ outcome: 'none' });

/** What one check read: the issue, its branch, both readings and the fetch. */
interface Readings {
  readonly issue: number;
  readonly branch: string;
  readonly local: ClaimBranchReading;
  readonly remote: ClaimBranchReading;
  /** What the failed fetch said, or null when it worked. */
  readonly offline: string | null;
}

/** Who this device claims as, or null with why it names nobody. */
type Claimant = { readonly storeId: string } | { readonly storeId: null; readonly why: string };

/** The ownership a reading carries, or null for one that is absent or unreadable. */
function ownershipOf(reading: ClaimBranchReading): Ownership | null {
  return reading.state === 'found'
    ? reading.ownership
    : null;
}

/** True when a reading carries a claim commit, or could not be read. */
function carriesClaim(reading: ClaimBranchReading): boolean {
  if (reading.state === 'unreadable') return true;
  return reading.state === 'found' && reading.ownership.state !== 'none';
}

/** The store that holds a reading's claim, or null when none does. */
function holderOf(reading: ClaimBranchReading): string | null {
  const ownership = ownershipOf(reading);
  return ownership?.state === 'held'
    ? ownership.owner
    : null;
}

/** The sha of the latest well-formed ownership commit of a found reading, or null. */
function latestOwnershipSha(reading: ClaimBranchReading): string | null {
  if (reading.state !== 'found') return null;
  const latest = [...reading.commits].reverse()
    .find((commit) => parseClaimMessage(commit.message).kind === 'ownership');
  return latest?.sha ?? null;
}

/** This device's claimant, or a refusal for a store that cannot be read. */
function claimantOf(seams: StartPreflightClaim, issue: number): Claimant {
  let device: DeviceStoreId;
  try {
    device = seams.readStoreId();
  } catch (error) {
    throw new CommandExit(1, openingWith(`the store id to check the claim on #${String(issue)} could not be read`, messageOf(error)));
  }
  return device.ok
    ? { storeId: device.storeId }
    : { storeId: null, why: device.reason };
}

/** The refusal's lines: the opening, the reason indented under it, and the closing. */
function openingWith(opening: string, reason: string): string {
  return [
    `❌ Refusing to start: ${opening}.`,
    ...reason.split('\n').map((line) => `   ${line}`),
    '   Nothing was checked and nothing was dispatched.',
  ].join('\n');
}

/** `this device (store <id>)`, or what this device's store says in place of an id. */
function thisDevice(claimant: Claimant): string {
  return claimant.storeId === null
    ? `this device, whose store names no claimant: ${claimant.why}`
    : `this device (store ${claimant.storeId})`;
}

/** `, as the last fetch left it (<why>)` after a failed fetch, and nothing otherwise. */
function asLastFetched(readings: Readings): string {
  return readings.offline === null
    ? ''
    : `, as the last fetch left it (${readings.offline})`;
}

/**
 * Reads whether this device owns the claim on the issue of the plan at
 * `planPath`, pushing a claim of its own that waits unpushed on the
 * local branch; see the module note for the order and every answer.
 * Throws `CommandExit` only for a store whose id cannot be read.
 */
export function readRunClaim(planPath: string, seams: StartPreflightClaim): RunClaim {
  const stub = planStubFromPath(planPath);
  const branch = stub === null
    ? null
    : branchNameFor(stub);
  const issue = branch === null
    ? null
    : claimBranchIssue(branch);
  if (branch === null || issue === null) return NONE;

  const { git } = seams;
  const local = readLocalClaimBranch(git, branch);
  const fetched = fetchClaimBranches(git);
  const remote = readClaimBranch(git, branch);
  const offline = fetched.ok
    ? null
    : fetched.reason;
  if (!carriesClaim(local) && !carriesClaim(remote)) return NONE;

  return decide({ issue, branch, local, remote, offline }, claimantOf(seams, issue), git);
}

/** The answer over what was read; see the module note's table. */
function decide(readings: Readings, claimant: Claimant, git: GitRunner): RunClaim {
  const { issue, branch, remote, local } = readings;
  const refused = (owner: string | null, reason: string): RunClaim => ({ outcome: 'refused', issue, branch, owner, reason });
  const tag = `#${String(issue)}`;

  const remoteHolder = holderOf(remote);
  if (remoteHolder !== null && remoteHolder === claimant.storeId) {
    const via: OwnedVia = readings.offline === null
      ? 'held'
      : 'unconfirmed';
    return { outcome: 'owned', issue, branch, storeId: remoteHolder, via, note: readings.offline ?? '' };
  }
  if (remoteHolder !== null) {
    return refused(remoteHolder, `${tag} is claimed by store ${remoteHolder} on ${branch}${asLastFetched(readings)}, not by ${thisDevice(claimant)}`);
  }
  if (remote.state === 'unreadable') {
    return refused(null, `the claim on ${REMOTE}/${branch} could not be read, so ${tag} stays taken: ${remote.reason}`);
  }
  const localHolder = holderOf(local);
  if (localHolder !== null && localHolder === claimant.storeId) return pushWaiting(readings, localHolder, git);

  const remoteOwnership = ownershipOf(remote);
  if (remoteOwnership?.state === 'released') {
    return refused(null, `the claim on ${tag} was released on ${branch} by store ${remoteOwnership.releasedBy}${asLastFetched(readings)},`
      + ' so no device holds it and this run would hold no claim');
  }
  if (localHolder !== null) {
    return refused(localHolder, `${tag} is claimed by store ${localHolder} on the local ${branch}, not by ${thisDevice(claimant)}`);
  }
  if (local.state === 'unreadable') {
    return refused(null, `the claim on the local ${branch} could not be read, so ${tag} stays taken: ${local.reason}`);
  }
  return NONE;
}

/** Pushes this store's claim waiting on the local branch, without force; see the module note. */
function pushWaiting(readings: Readings, storeId: string, git: GitRunner): RunClaim {
  const { issue, branch, local } = readings;
  const refused = (owner: string | null, reason: string): RunClaim => ({ outcome: 'refused', issue, branch, owner, reason });
  const tag = `#${String(issue)}`;
  const waiting = `the claim on ${tag} waits unpushed on the local ${branch}`;
  if (readings.offline !== null) {
    return refused(null, `${waiting} and could not be pushed: ${readings.offline}.\nRun rafa loop start again once ${REMOTE} is reachable`);
  }
  const sha = latestOwnershipSha(local);
  if (sha === null) return refused(null, `${waiting}, but its claim commit could not be found`);

  const pushed = pushNewClaimBranch(git, sha, branch);
  if (pushed.outcome === 'pushed') return { outcome: 'owned', issue, branch, storeId, via: 'pushed', note: '' };
  if (pushed.outcome === 'failed') return refused(null, `${waiting} and could not be pushed: ${pushed.reason}`);
  const holder = holderOf(pushed.holder);
  const who = holder === null
    ? 'another commit'
    : `store ${holder}`;
  return refused(holder, `${tag} is claimed by ${who} on ${branch}: ${REMOTE} refused this device's claim (store ${storeId})`);
}

/** The line a run that holds its claim prints; see the module note. */
export function ownedLine(claim: Extract<RunClaim, { outcome: 'owned' }>): string {
  const tag = `#${String(claim.issue)}`;
  const store = `store ${claim.storeId}`;
  if (claim.via === 'pushed') return `🔒 Pushed the claim on ${tag} to ${REMOTE}/${claim.branch} for ${store}.`;
  return claim.via === 'held'
    ? `🔒 ${tag} is claimed by this device (${store}) on ${claim.branch}.`
    : `⚠️  Could not confirm the claim on ${tag}: ${claim.note}; the last fetch left ${claim.branch} held by this device (${store}), so the run goes on.`;
}

/**
 * Refuses the run with `CommandExit` exit code 1 when this device does
 * not own the claim on its issue, and prints the line of one it holds;
 * answers the reading. See the module note.
 */
export function refuseUnownedClaim(planPath: string, seams: StartPreflightClaim): RunClaim {
  const claim = readRunClaim(planPath, seams);
  if (claim.outcome === 'refused') {
    throw new CommandExit(1, openingWith(`this device does not own the claim on #${String(claim.issue)}`, claim.reason));
  }
  if (claim.outcome === 'owned') {
    const output = activeOutput();
    const line = ownedLine(claim);
    if (claim.via === 'unconfirmed') output.warn(line);
    else output.info(line);
  }
  return claim;
}

/**
 * Swaps `rafa:claimed` for `rafa:in-development` on the issue of an
 * owned claim, on a first dispatch alone, warning when the board did
 * not take it; see the module note. Never throws for what the board says.
 */
export async function markInDevelopment(claim: RunClaim, board: IssueBoard | null, firstDispatch: boolean): Promise<void> {
  if (claim.outcome !== 'owned' || !firstDispatch) return;
  const label = await labelInDevelopment(board, claim.issue);
  if (label.outcome === 'warning') activeOutput().warn(`⚠️  ${label.warning}`);
}
