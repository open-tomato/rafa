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
 * leading zero. Then this device's store id (`src/claims/device.ts`),
 * since a claim names a store and a device with no id holds none. Then
 * one fetch of the `feat/rafa-*` branches (`src/claims/git.ts`) and
 * every remote branch of the issue, `feat/rafa-<n>` or
 * `feat/rafa-<n>-<slug>`, read as that fetch left it. No network means
 * no release: the remote is the authority on who holds a claim, and a
 * release that could not be pushed would release nothing.
 *
 * ## What it pushes
 *
 * The one branch of the issue whose claim this store holds, with a
 * handover pending or not, is released: a `release` commit made on the
 * branch's remote tip (`makeOwnershipCommit`) and pushed with
 * `--force-with-lease` on that tip (`pushOwnershipCommit`). A release
 * over a pending handover ends it, since the latest ownership commit
 * decides (`src/claims/record.ts`). The release is read from the
 * RECORD, not from staleness: an owner may release its claim at any
 * age and at either stage.
 *
 * No local ref, index or working tree moves. The push itself writes
 * `refs/remotes/origin/<branch>` (measured in `src/claims/plan-claim.ts`),
 * and a local `feat/<stub>` is left where it was: its work commits are
 * the owner's to keep, and a later `loop start` reads the remote,
 * finds the claim released, and refuses the run.
 *
 * ## The label
 *
 * Once the push lands, `unlabelReleased` (`src/claims/labels.ts`) takes
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
 */
import type { IssueBoard } from '../../board/issue-board.js';
import type { DeviceStoreId } from '../../claims/device.js';
import type { ClaimBranchReading } from '../../claims/git.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { RafaConfig } from '../../config.js';
import type { GitRunner } from '../../pr/index.js';

import {
  claimBranchIssue,
  fetchClaimBranches,
  makeOwnershipCommit,
  pushOwnershipCommit,
  readClaimBranch,
} from '../../claims/git.js';
import { unlabelReleased } from '../../claims/labels.js';
import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { gitSaid } from '../../pr/index.js';
import { BRANCH_PREFIX, REMOTE } from '../../start/branch-decision.js';
import { createStartPreflightClaim } from '../../start/preflight-claim.js';
import { expectOneArgument, requireProject, resolveProjectConfig } from '../plan/plan-files.js';

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
type FoundBranch = Extract<ClaimBranchReading, { readonly state: 'found' }>;

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

/** This device's store id, or a refusal saying why it has none. */
function storeIdOf(seams: ClaimCommandSeams): string {
  let device: DeviceStoreId;
  try {
    device = seams.readStoreId();
  } catch (error) {
    throw refuse(`the effort store could not be read for this device's store id: ${messageOf(error)}`);
  }
  if (!device.ok) throw refuse(device.reason);
  return device.storeId;
}

/**
 * Every branch of `issue` on the remote, read after one fetch; a refusal
 * for a fetch or a listing that fails, and for an issue with none.
 */
export function readIssueBranches(git: GitRunner, issue: number, refuseWith: (message: string) => CommandExit): readonly ClaimBranchReading[] {
  const fetched = fetchClaimBranches(git);
  if (!fetched.ok) throw refuseWith(fetched.reason);
  const listed = git(['for-each-ref', '--format=%(refname:lstrip=3)', `refs/remotes/${REMOTE}/${BRANCH_PREFIX}`]);
  if (!listed.ok) throw refuseWith(`the ${REMOTE} branches could not be listed: ${gitSaid(listed)}`);
  const branches = listed.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((name) => name !== '' && claimBranchIssue(name) === issue);
  if (branches.length === 0) {
    throw refuseWith(`${REMOTE} has no ${BRANCH_PREFIX}rafa-${String(issue)}-<slug> branch, so #${String(issue)} carries no claim`);
  }
  return branches.map((branch) => readClaimBranch(git, branch));
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

/** The one branch of the issue this store holds, or a refusal naming what the others say. */
function ownedBranch(readings: readonly ClaimBranchReading[], issue: number, storeId: string): FoundBranch {
  const owned = readings.filter((reading): reading is FoundBranch => reading.state === 'found'
    && reading.ownership.state === 'held'
    && reading.ownership.owner === storeId);
  const [only] = owned;
  if (owned.length === 1 && only !== undefined) return only;
  if (owned.length > 1) {
    const names = owned.map((reading) => reading.branch).join(', ');
    throw refuse(`this device (store ${storeId}) holds #${String(issue)} on more than one branch: ${names}; nothing was released`);
  }
  const reasons = readings.map((reading) => notOwnedReason(reading, issue, storeId));
  throw refuse(`this device does not own the claim on #${String(issue)}, so nothing was released:\n${reasons.map((reason) => `   ${reason}`).join('\n')}`);
}

/** Pushes the release commit on `reading`'s tip, leased on it; answers the commit's sha. */
function pushRelease(git: GitRunner, reading: FoundBranch, issue: number, storeId: string): string {
  const { branch, tip } = reading;
  const made = makeOwnershipCommit(git, tip, { action: 'release', issue, store: storeId });
  if (!made.ok) throw refuse(made.reason);
  const pushed = pushOwnershipCommit(git, made.sha, branch, tip);
  if (pushed.outcome === 'moved') {
    throw refuse(`${branch} moved on ${REMOTE} while the claim on #${String(issue)} was being released; nothing was released. Run it again to read the branch afresh`);
  }
  if (pushed.outcome === 'failed') throw refuse(pushed.reason);
  return made.sha;
}

/** Releases this device's claim on the issue the line names; see the module note. */
export async function releaseClaim(context: RafaContext, makeSeams: ClaimSeamsFactory): Promise<ClaimReleaseResult> {
  const issue = readIssueArgument(context.args, USAGE);
  const project = requireProject(context, COMMAND);
  const config = resolveProjectConfig(project, COMMAND, (message) => context.output.warn(message));
  const seams = makeSeams(project.root, config);
  const storeId = storeIdOf(seams);
  const reading = ownedBranch(readIssueBranches(seams.git, issue, refuse), issue, storeId);
  const sha = pushRelease(seams.git, reading, issue, storeId);
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

/** The default seams: the ones `loop start`'s claim check reads through. */
const DEFAULT_SEAMS: ClaimSeamsFactory = (root, config) => createStartPreflightClaim(root, config);

/** The command, reaching git, the board and the store through `makeSeams`; see the module note. */
export function createClaimReleaseCommand(makeSeams: ClaimSeamsFactory = DEFAULT_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'claim release',
    subject: 'claim',
    action: 'release',
    summary: 'give up this device\'s claim on an issue, and take its stage label off',
    description: 'Pushes one release commit to the issue\'s claim branch on origin, leased on the tip it'
      + ' read, so no other device\'s push is overwritten, then takes `rafa:claimed` or'
      + ' `rafa:in-development` off the issue; a label that cannot be written is a warning beside a'
      + ' release that stands. Refused when this device does not own the claim, when the branch moved'
      + ' meanwhile, and when origin cannot be reached. No local branch moves. With `--output=json`'
      + ' the issue, the branch, the store and the release commit are the data of the terminal result event.',
    args: [
      {
        name: 'n',
        description: 'The issue number whose claim this device gives up.',
        type: 'string',
        required: true,
      },
    ],
    flags: [],
    examples: [
      {
        cmd: 'rafa claim release 324',
        note: 'Releases this device\'s claim on #324 and takes its stage label off.',
      },
      {
        cmd: 'rafa claim release 324 --output=json',
        note: 'Writes a start event, then a result event whose data holds the branch and the release commit.',
      },
    ],
    outputs: ['text', 'json'],
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

export default createClaimReleaseCommand();
