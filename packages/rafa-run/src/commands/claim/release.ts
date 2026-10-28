/**
 * `rafa claim release <n>`: gives up this device's claim on issue `<n>`
 * with one release commit pushed to the claim branch, then takes the
 * stage label, `rafa:claimed` or `rafa:in-development`, off the issue
 * (`.rafa/plans/rafa-324-claim-issue-so-two`). Starts no Claude session
 * and declares no `spends`.
 *
 * ## What is read
 *
 * The line first: exactly one argument, a positive whole number with no
 * leading zero. Then this device's store id (`packages/rafa-run/src/claims/device.ts`),
 * since a claim names a store and a device with no id holds none. Then
 * one fetch of the claim branches the `naming.branch` template names
 * (`packages/rafa/src/claims/git.ts`), `feat/rafa-*` by default, and every remote
 * branch of the issue, the template with the stub `rafa-<n>` or
 * `rafa-<n>-<slug>` (`feat/rafa-<n>-<slug>` by default), read as that
 * fetch left it. Only the configured template is read: under
 * `work/{stub}` the issue's branch is `work/rafa-<n>-<slug>`, and a
 * `feat/rafa-<n>-<slug>` beside it is no claim. No network means no
 * release: the remote is the authority on who holds a claim, and a
 * release that could not be pushed would release nothing.
 *
 * ## What it pushes
 *
 * The one branch of the issue whose claim this store holds, with a
 * handover pending or not, is released: a `release` commit made on the
 * branch's remote tip (`makeOwnershipCommit`) and pushed with
 * `--force-with-lease` on that tip (`pushOwnershipCommit`). A release
 * over a pending handover ends it, since the latest ownership commit
 * decides (`packages/rafa/src/claims/record.ts`). The release is read from the
 * RECORD, not from staleness: an owner may release its claim at any
 * age and at either stage.
 *
 * ## Whose claim it is
 *
 * `holdsClaim` (`packages/rafa-run/src/claims/device.ts`) decides whether a branch's
 * claim is this device's: the holder is the store's id, or an id the
 * store carried before its file got a new device or inode under the
 * same host and path. A claim naming such a replaced id is released as
 * any other of this device's. The release commit, the result and every
 * refusal name the store's own id, never the replaced one the claim was
 * made under, so the record the remote keeps says which store let go.
 *
 * No local ref, index or working tree moves. The push itself writes
 * `refs/remotes/origin/<branch>` (measured in `packages/rafa-run/src/claims/plan-claim.ts`),
 * and a local branch of that name is left where it was: its work commits are
 * the owner's to keep, and a later `loop start` reads the remote,
 * finds the claim released, and refuses the run.
 *
 * ## The label
 *
 * Once the push lands, `unlabelReleased` (`packages/rafa-run/src/claims/labels.ts`) takes
 * both stage labels off, best-effort: a board that is not `gh`, or a
 * write that fails, is one warning beside a release that stands.
 *
 * ## What it writes
 *
 * Text mode writes one line naming the issue, the branch and the release
 * commit, then any label warning at `warn`. In json mode the terminal
 * result's `data` is a {@link ClaimReleaseResult}, the label warning
 * included as `labelWarning`.
 *
 * ## Refusals
 *
 * Exit code 1, each pushing nothing: an argument that is not one issue
 * number; a store that names no id, or cannot be read; a failed fetch;
 * no remote branch of the issue; a claim held by another store, one
 * already released, a branch carrying no claim commit, or one that
 * cannot be read, each naming the branch; two branches of the issue
 * held by this store, naming both; a branch that moved on the remote
 * between the fetch and the push; and a push git refused otherwise.
 *
 * ## Shared with the other claim actions
 *
 * The reading and pushing steps are exported, each taking the refusal
 * its caller makes and a {@link ClaimDoing} for the words, so
 * `./hand.ts` reads the line, the store's ids, the issue's branches
 * and this store's claim, and pushes its commit, exactly as a release
 * does, and `./accept.ts` reads the line, the store id and the issue's
 * branches the same way and pushes its commit the same way.
 * {@link readClaimDevice} answers the store's id with the ids it
 * replaced, for a caller that compares a holder; {@link readClaimStoreId}
 * answers the id alone. {@link readIssueBranches} and
 * {@link pushOnClaimTip} take the template as a trailing argument, the
 * default `feat/{stub}` when left out; a release passes its seams'
 * `branchTemplate`.
 */
import type { DeviceStoreId, DeviceStoreIds } from '../../claims/device.js';
import type { ClaimBranchReading } from '@open-tomato/rafa/claims/git';
import type { ClaimRecord } from '@open-tomato/rafa/claims/record';
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';
import type { RafaConfig } from '@open-tomato/rafa/core/config';
import type { IssueBoard } from '@open-tomato/rafa-board';
import type { GitRunner } from '@open-tomato/rafa-pr';

import {
  claimBranchGlob,
  claimBranchIssue,
  fetchClaimBranches,
  makeOwnershipCommit,
  pushOwnershipCommit,
  readClaimBranch,
} from '@open-tomato/rafa/claims/git';
import { expectOneArgument, requireProject, resolveProjectConfig } from '@open-tomato/rafa/commands/plan/plan-files';
import { CommandExit } from '@open-tomato/rafa/core/command';
import { branchFromTemplate, DEFAULT_BRANCH_TEMPLATE, messageOf } from '@open-tomato/rafa/core/config/sections';
import { REMOTE } from '@open-tomato/rafa/start/branch-decision';
import { gitSaid } from '@open-tomato/rafa-pr';

import { holdsClaim } from '../../claims/device.js';
import { unlabelReleased } from '../../claims/labels.js';
import { createStartPreflightClaim } from '../../start/preflight-claim.js';

import { CLAIM_RELEASE_DECLARATION } from './declarations.js';

/** The usage line a refusal names. */
const USAGE = 'rafa claim release <n>';

/** The command's name, as refusals open with it. */
const COMMAND = 'rafa claim release';

/** An issue number as typed: a positive whole number with no leading zero. */
const ISSUE_NUMBER = /^[1-9]\d*$/;

/** The seams a claim command reaches git, the board and the store through. */
export interface ClaimCommandSeams {
  /** `git` in the project root. */
  readonly git: GitRunner;
  /** The board the stage labels are written on, or null when it is not `gh`. */
  readonly board: IssueBoard | null;
  /** This device's store id; `readDeviceStoreId` over the project. */
  readonly readStoreId: () => DeviceStoreId;
  /**
   * The `naming.branch` template the claim branches are named under,
   * `config.namingBranch`; `DEFAULT_BRANCH_TEMPLATE` when left out.
   */
  readonly branchTemplate?: string;
}

/** Makes the seams for the project at `root` under `config`. */
export type ClaimSeamsFactory = (root: string, config: RafaConfig) => ClaimCommandSeams;

/** What one release did. */
export interface ClaimReleaseResult {
  readonly issue: number;
  readonly branch: string;
  /** The store that held the claim and released it: this device's. */
  readonly storeId: string;
  /** The release commit now at the branch's tip on the remote. */
  readonly sha: string;
  /** Why the stage labels were not taken off, or null when they were. */
  readonly labelWarning: string | null;
}

/** A found reading of a remote claim branch. */
export type FoundBranch = Extract<ClaimBranchReading, { readonly state: 'found' }>;

/** How a claim command's refusals word what it would have done. */
export interface ClaimDoing {
  /** Closes a moved-branch refusal: `was being released`. */
  readonly during: string;
  /** Closes the not-owned, two-branch and moved-branch refusals: `nothing was released`. */
  readonly nothing: string;
}

/** How this command's refusals word a release. */
const RELEASING: ClaimDoing = { during: 'was being released', nothing: 'nothing was released' };

/** A refusal with exit code 1, opening with the command's name. */
function refuse(message: string): CommandExit {
  return new CommandExit(1, `❌ ${COMMAND}: ${message}`);
}

/**
 * The issue number `word` names, or a refusal naming `usage`: a claim
 * command's one argument.
 */
export function readIssueArgument(args: readonly string[], usage: string): number {
  const word = expectOneArgument(args, usage);
  if (!ISSUE_NUMBER.test(word) || !Number.isSafeInteger(Number(word))) {
    throw new CommandExit(1, `❌ "${word}" is no issue number, expected a positive whole number\nUsage: ${usage}`);
  }
  return Number(word);
}

/** The ids a claim's holder is compared with: the store's own and the ones it replaced. */
export type ClaimDevice = Pick<DeviceStoreIds, 'storeId' | 'replacedIds'>;

/**
 * This device's store id and the ids that store replaced, or a refusal
 * made by `refuseWith` saying why it has none.
 */
export function readClaimDevice(seams: ClaimCommandSeams, refuseWith: (message: string) => CommandExit): ClaimDevice {
  let device: DeviceStoreId;
  try {
    device = seams.readStoreId();
  } catch (error) {
    throw refuseWith(`the effort store could not be read for this device's store id: ${messageOf(error)}`);
  }
  if (!device.ok) throw refuseWith(device.reason);
  return { storeId: device.storeId, replacedIds: device.replacedIds };
}

/** This device's store id, or a refusal made by `refuseWith` saying why it has none. */
export function readClaimStoreId(seams: ClaimCommandSeams, refuseWith: (message: string) => CommandExit): string {
  return readClaimDevice(seams, refuseWith).storeId;
}

/**
 * Every branch of `issue` on the remote under `template`, read after one
 * fetch of the claim branches it names; a refusal for a fetch or a
 * listing that fails, and for an issue with none, naming the branch the
 * template gives the issue: `feat/rafa-<n>-<slug>` by default.
 */
export function readIssueBranches(
  git: GitRunner,
  issue: number,
  refuseWith: (message: string) => CommandExit,
  template: string = DEFAULT_BRANCH_TEMPLATE,
): readonly ClaimBranchReading[] {
  const fetched = fetchClaimBranches(git, template);
  if (!fetched.ok) throw refuseWith(fetched.reason);
  const listed = git(['for-each-ref', '--format=%(refname:lstrip=3)', `refs/remotes/${REMOTE}/${claimBranchGlob(template)}`]);
  if (!listed.ok) throw refuseWith(`the ${REMOTE} branches could not be listed: ${gitSaid(listed)}`);
  const branches = listed.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((name) => name !== '' && claimBranchIssue(name, template) === issue);
  if (branches.length === 0) {
    const shape = branchFromTemplate(template, `rafa-${String(issue)}-<slug>`);
    throw refuseWith(`${REMOTE} has no ${shape} branch, so #${String(issue)} carries no claim`);
  }
  return branches.map((branch) => readClaimBranch(git, branch, template));
}

/** Why `reading` is not a claim this store may release. */
function notOwnedReason(reading: ClaimBranchReading, issue: number, storeId: string): string {
  const { branch } = reading;
  if (reading.state === 'absent') return `${branch} is gone from ${REMOTE}`;
  if (reading.state === 'unreadable') return `the claim on ${branch} could not be read: ${reading.reason}`;
  const { ownership } = reading;
  if (ownership.state === 'none') return `${branch} carries no claim commit`;
  if (ownership.state === 'released') return `the claim on ${branch} was already released by store ${ownership.releasedBy}`;
  return `#${String(issue)} is claimed by store ${ownership.owner} on ${branch}, not by this device (store ${storeId})`;
}

/**
 * The one branch of the issue this device holds, under its store's id
 * or one that store replaced (`holdsClaim`), or a refusal made by
 * `refuseWith` naming what the others say and closing with
 * `doing.nothing`. A refusal names the store's own id.
 */
export function findOwnedBranch(
  readings: readonly ClaimBranchReading[],
  owner: { readonly issue: number; readonly device: ClaimDevice },
  refuseWith: (message: string) => CommandExit,
  doing: ClaimDoing,
): FoundBranch {
  const { issue, device } = owner;
  const { storeId } = device;
  const owned = readings.filter((reading): reading is FoundBranch => reading.state === 'found'
    && reading.ownership.state === 'held'
    && holdsClaim(device, reading.ownership.owner));
  const [only] = owned;
  if (owned.length === 1 && only !== undefined) return only;
  if (owned.length > 1) {
    const names = owned.map((reading) => reading.branch).join(', ');
    throw refuseWith(`this device (store ${storeId}) holds #${String(issue)} on more than one branch: ${names}; ${doing.nothing}`);
  }
  const reasons = readings.map((reading) => notOwnedReason(reading, issue, storeId));
  throw refuseWith(`this device does not own the claim on #${String(issue)}, so ${doing.nothing}:\n${reasons.map((reason) => `   ${reason}`).join('\n')}`);
}

/**
 * Pushes the ownership commit `record` makes on `reading`'s tip, leased
 * on it; answers the commit's sha, or a refusal made by `refuseWith`.
 * `template` is the one {@link readIssueBranches} read `reading` under.
 */
export function pushOnClaimTip(
  git: GitRunner,
  reading: FoundBranch,
  record: ClaimRecord,
  refuseWith: (message: string) => CommandExit,
  doing: ClaimDoing,
  template: string = DEFAULT_BRANCH_TEMPLATE,
): string {
  const { branch, tip } = reading;
  const made = makeOwnershipCommit(git, tip, record);
  if (!made.ok) throw refuseWith(made.reason);
  const pushed = pushOwnershipCommit(git, made.sha, branch, tip, template);
  if (pushed.outcome === 'moved') {
    throw refuseWith(`${branch} moved on ${REMOTE} while the claim on #${String(record.issue)} ${doing.during}; ${doing.nothing}. Run it again to read the branch afresh`);
  }
  if (pushed.outcome === 'failed') throw refuseWith(pushed.reason);
  return made.sha;
}

/** Releases this device's claim on the issue the line names; see the module note. */
export async function releaseClaim(context: RafaContext, makeSeams: ClaimSeamsFactory): Promise<ClaimReleaseResult> {
  const issue = readIssueArgument(context.args, USAGE);
  const project = requireProject(context, COMMAND);
  const config = await resolveProjectConfig(project, COMMAND, (message) => context.output.warn(message));
  const seams = makeSeams(project.root, config);
  const device = readClaimDevice(seams, refuse);
  const { storeId } = device;
  const template = seams.branchTemplate ?? DEFAULT_BRANCH_TEMPLATE;
  const reading = findOwnedBranch(readIssueBranches(seams.git, issue, refuse, template), { issue, device }, refuse, RELEASING);
  const record: ClaimRecord = { action: 'release', issue, store: storeId };
  const sha = pushOnClaimTip(seams.git, reading, record, refuse, RELEASING, template);
  const label = await unlabelReleased(seams.board, issue);
  const labelWarning = label.outcome === 'warning'
    ? label.warning
    : null;
  return { issue, branch: reading.branch, storeId, sha, labelWarning };
}

/** The line text mode writes at `info`; a label warning goes at `warn`. */
export function renderRelease(result: ClaimReleaseResult): string {
  return `Released the claim on #${String(result.issue)} (store ${result.storeId}) on ${result.branch}:`
    + ` release commit ${result.sha} pushed to ${REMOTE}.`;
}

/**
 * The default seams: the ones `loop start`'s claim check reads through,
 * with the claim branches named under `config.namingBranch`.
 */
const DEFAULT_SEAMS: ClaimSeamsFactory = (root, config) => ({
  ...createStartPreflightClaim(root, config),
  branchTemplate: config.namingBranch,
});

/** The command, reaching git, the board and the store through `makeSeams`; see the module note. */
export function createClaimReleaseCommand(makeSeams: ClaimSeamsFactory = DEFAULT_SEAMS): RafaCommand {
  const command: RafaCommand = {
    ...CLAIM_RELEASE_DECLARATION,
    run: async (context) => {
      const result = await releaseClaim(context, makeSeams);
      if (context.outputMode === 'json') {
        context.output.result(result);
        return;
      }
      context.output.info(renderRelease(result));
      if (result.labelWarning !== null) context.output.warn(result.labelWarning);
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createClaimReleaseCommand();
export default command;
