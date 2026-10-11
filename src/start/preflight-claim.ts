/**
 * The claim check of the preflight `loop start` runs (`start/preflight.ts`):
 * a run of an issue this device does not own is refused before any probe
 * and any session, a claim `plan create` could not push is pushed here,
 * a claim the remote holds under an id this store replaced is re-signed
 * to the store's own id, and once the whole preflight has passed the
 * issue's `rafa:claimed` label is swapped for `rafa:in-development`
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
 * Otherwise this device's store id is read (`claims/device.ts`), with
 * the ids that store replaced; a store that names none leaves this
 * device holding no claim, and a store that cannot be read at all
 * refuses the run.
 *
 * ## Which holder is this store
 *
 * `holdsClaim` (`claims/device.ts`) is the one comparison between a
 * holder and this device, for the remote's holder and the local one
 * alike: a claim that names the store's id, or an id the store replaced,
 * is "held by this store" in the table below. The answer's `storeId`
 * and a refusal name the store's own id, never the replaced one the
 * claim was made under; the answer's `replacedId` and the printed line
 * name the replaced one beside it when the remote's claim was read
 * under it. The retry pushes the waiting commit as it was made, so a
 * claim left under a replaced id reaches the remote naming that id, and
 * the next run's check re-signs it there.
 *
 * ## What the remote decides
 *
 * The remote is the authority; the local branch matters only for a
 * claim of this device's waiting there unpushed. In order:
 *
 * | Reading | Answer |
 * |---|---|
 * | the remote held by this store under its own id | `owned`; after a failed fetch, `unconfirmed` on what the last fetch left |
 * | the remote held by this store under an id it replaced | `owned`, re-signed first; see "The re-sign" |
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
 * ## The re-sign
 *
 * A store file that gets a new device or inode under the same host and
 * path mints a new id on its next write and keeps the outgoing one
 * (`claims/device.ts`). A claim the remote holds under such a replaced
 * id is this device's, and this check brings the branch to the store's
 * own id: one empty `take` commit naming it, made on the remote tip
 * (`makeOwnershipCommit`) and pushed with `--force-with-lease` on that
 * tip (`pushOwnershipCommit`, `claims/git.ts`). `take` is one of the six
 * ownership actions every runtime reads as held by its store, so no
 * seventh exists. It runs here and never at the mint, since a store
 * open must not run git. Like the retry, it moves no local ref, index
 * or working tree, only the remote-tracking ref the push writes; the
 * next check reads the store's own id and pushes nothing.
 *
 * The run goes on whatever the push answers, since the claim is this
 * device's either way:
 *
 * | The push | Answer |
 * |---|---|
 * | pushed | `owned` via `re-signed`, one line naming both ids |
 * | not tried: the fetch failed | `owned` via `unconfirmed`, its warning naming both ids |
 * | the commit could not be made, or git refused the push | `owned` via `not-re-signed`, a warning saying why |
 * | the lease refused: the tip moved meanwhile | the branch is fetched and read again ONCE, and decided by the table above |
 *
 * The second reading is decided as any other, so a store that took the
 * claim meanwhile refuses the run, and a tip that only gained work is
 * re-signed on the new tip. A lease refused on that second reading too
 * is not read a third time: the answer is `owned` via `not-re-signed`
 * on that second reading, with a warning.
 *
 * A local `feat/<stub>` does not hold the take commit, since no local
 * ref moves. Measured on git 2.50.1 under macOS with `LC_ALL=C`, in a
 * clone of a bare remote (2026-10-11): once a take commit sat on the
 * remote tip, `git push --set-upstream origin <branch>`, the push a run
 * ends with (`pr/none.ts`), wrote `[rejected] (non-fast-forward)` for a
 * local branch at the claim commit and for one carrying work after it,
 * and landed in the control whose remote tip was still the claim
 * commit. Nothing here brings the local branch to the take commit.
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
 * claim confirmed, just pushed or re-signed, and `warn` for one only
 * the last fetch vouches for or one that could not be re-signed. The
 * re-sign's line names both ids:
 *
 *     🔒 Re-signed the claim on #7 on origin/feat/rafa-7-x from store
 *        store-a, an id this device's store replaced, to store store-b.
 *
 * It is printed as one line; it is wrapped here for the width.
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
import { holdsClaim, readDeviceStoreId } from '../claims/device.js';
import {
  claimBranchIssue,
  fetchClaimBranches,
  makeOwnershipCommit,
  pushNewClaimBranch,
  pushOwnershipCommit,
  readClaimBranch,
  readLocalClaimBranch,
} from '../claims/git.js';
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

/**
 * How a run came to hold its claim: `held` on the remote, `pushed` from
 * the local branch, `unconfirmed` after a failed fetch, `re-signed` from
 * an id the store replaced to its own, or `not-re-signed` when that
 * push did not land. See the module note.
 */
export type OwnedVia = 'held' | 'pushed' | 'unconfirmed' | 're-signed' | 'not-re-signed';

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
    /**
     * What the failed fetch said, for an `unconfirmed` claim, or why the
     * take commit did not land, for a `not-re-signed` one; empty otherwise.
     */
    readonly note: string;
    /**
     * The id the remote's claim named when it was one this store
     * replaced, re-signed or not; null when it named the store's own id
     * or was pushed from the local branch.
     */
    readonly replacedId: string | null;
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

/** How many times a re-sign whose lease the remote refused reads the branch again. */
const REREADS_AFTER_A_MOVED_TIP = 1;

/** A reading of a branch that exists. */
type FoundReading = Extract<ClaimBranchReading, { state: 'found' }>;

/** What one check read: the issue, its branch, both readings and the fetch. */
interface Readings {
  readonly issue: number;
  readonly branch: string;
  readonly local: ClaimBranchReading;
  readonly remote: ClaimBranchReading;
  /** What the failed fetch said, or null when it worked. */
  readonly offline: string | null;
}

/** A device whose store names an id: the id, and the ids that store replaced. */
interface NamedClaimant {
  readonly storeId: string;
  readonly replacedIds: readonly string[];
}

/** Who this device claims as, with the ids its store replaced, or null with why it names nobody. */
type Claimant =
  | NamedClaimant
  | { readonly storeId: null; readonly why: string };

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
    ? { storeId: device.storeId, replacedIds: device.replacedIds }
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

  return decide({ issue, branch, local, remote, offline }, claimantOf(seams, issue), git, REREADS_AFTER_A_MOVED_TIP);
}

/**
 * The answer over what was read; see the module note's table. `rereads`
 * is how many more times a re-sign refused by a moved tip may read the
 * branch again.
 */
function decide(readings: Readings, claimant: Claimant, git: GitRunner, rereads: number): RunClaim {
  const { issue, branch, remote, local } = readings;
  const refused = (owner: string | null, reason: string): RunClaim => ({ outcome: 'refused', issue, branch, owner, reason });
  const tag = `#${String(issue)}`;

  const remoteHolder = holderOf(remote);
  if (remote.state === 'found' && remoteHolder !== null && claimant.storeId !== null && holdsClaim(claimant, remoteHolder)) {
    if (remoteHolder !== claimant.storeId) return resign({ ...readings, remote }, claimant, remoteHolder, git, rereads);
    const via: OwnedVia = readings.offline === null
      ? 'held'
      : 'unconfirmed';
    return { outcome: 'owned', issue, branch, storeId: claimant.storeId, via, note: readings.offline ?? '', replacedId: null };
  }
  if (remoteHolder !== null) {
    return refused(remoteHolder, `${tag} is claimed by store ${remoteHolder} on ${branch}${asLastFetched(readings)}, not by ${thisDevice(claimant)}`);
  }
  if (remote.state === 'unreadable') {
    return refused(null, `the claim on ${REMOTE}/${branch} could not be read, so ${tag} stays taken: ${remote.reason}`);
  }
  const localHolder = holderOf(local);
  if (claimant.storeId !== null && holdsClaim(claimant, localHolder)) return pushWaiting(readings, claimant.storeId, git);

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

/**
 * Re-signs the claim the remote holds under `replacedId`, an id this
 * store replaced: one `take` commit naming the store's own id on the
 * remote tip, leased on it. Every answer but a second reading's is
 * `owned`; see "The re-sign" in the module note.
 */
function resign(
  readings: Readings & { readonly remote: FoundReading },
  claimant: NamedClaimant,
  replacedId: string,
  git: GitRunner,
  rereads: number,
): RunClaim {
  const { issue, branch, remote } = readings;
  const { storeId } = claimant;
  const owned = (via: OwnedVia, note: string): RunClaim => ({ outcome: 'owned', issue, branch, storeId, via, note, replacedId });
  if (readings.offline !== null) return owned('unconfirmed', readings.offline);

  const made = makeOwnershipCommit(git, remote.tip, { action: 'take', issue, store: storeId });
  if (!made.ok) return owned('not-re-signed', made.reason);
  const pushed = pushOwnershipCommit(git, made.sha, branch, remote.tip);
  if (pushed.outcome === 'pushed') return owned('re-signed', '');
  if (pushed.outcome === 'failed') return owned('not-re-signed', pushed.reason);
  if (rereads <= 0) return owned('not-re-signed', `${branch} moved on ${REMOTE} a second time while its take commit was being pushed`);

  const fetched = fetchClaimBranches(git);
  const offline = fetched.ok
    ? null
    : fetched.reason;
  return decide({ ...readings, remote: readClaimBranch(git, branch), offline }, claimant, git, rereads - 1);
}

/** Pushes this store's claim waiting on the local branch, without force, answering as `storeId`, the store's own id; see the module note. */
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
  if (pushed.outcome === 'pushed') return { outcome: 'owned', issue, branch, storeId, via: 'pushed', note: '', replacedId: null };
  if (pushed.outcome === 'failed') return refused(null, `${waiting} and could not be pushed: ${pushed.reason}`);
  const holder = holderOf(pushed.holder);
  const who = holder === null
    ? 'another commit'
    : `store ${holder}`;
  return refused(holder, `${tag} is claimed by ${who} on ${branch}: ${REMOTE} refused this device's claim (store ${storeId})`);
}

/** A run that holds its claim. */
type OwnedClaim = Extract<RunClaim, { outcome: 'owned' }>;

/** The vias whose line is a warning: the claim stands, on less than a confirmed reading or a landed re-sign. */
const WARNED_VIAS: readonly OwnedVia[] = ['unconfirmed', 'not-re-signed'];

/** `this device (store <id>)`, then the replaced id the remote's claim names when it names one. */
function holderWords(claim: OwnedClaim): string {
  const device = `this device (store ${claim.storeId})`;
  return claim.replacedId === null
    ? device
    : `${device} under store ${claim.replacedId}, an id that store replaced`;
}

/** The line a run that holds its claim prints; see the module note. */
export function ownedLine(claim: OwnedClaim): string {
  const tag = `#${String(claim.issue)}`;
  const { branch, note, storeId } = claim;
  switch (claim.via) {
    case 'pushed':
      return `🔒 Pushed the claim on ${tag} to ${REMOTE}/${branch} for store ${storeId}.`;
    case 'held':
      return `🔒 ${tag} is claimed by ${holderWords(claim)} on ${branch}.`;
    case 're-signed':
      return `🔒 Re-signed the claim on ${tag} on ${REMOTE}/${branch} from store ${String(claim.replacedId)}, an id this device's store replaced, to store ${storeId}.`;
    case 'not-re-signed':
      return `⚠️  Could not re-sign the claim on ${tag}: ${note}; ${branch} was read as held by ${holderWords(claim)}, so the run goes on.`;
    case 'unconfirmed':
      return `⚠️  Could not confirm the claim on ${tag}: ${note}; the last fetch left ${branch} held by ${holderWords(claim)}, so the run goes on.`;
  }
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
    if (WARNED_VIAS.includes(claim.via)) output.warn(line);
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
