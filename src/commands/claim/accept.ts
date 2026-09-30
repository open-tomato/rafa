/**
 * `rafa claim accept <n>`: takes up a handover of issue `<n>` offered to
 * this device's store, with one accept commit naming this store pushed
 * to the claim branch (`.rafa/plans/rafa-324-claim-issue-so-two`).
 * Starts no Claude session and declares no `spends`.
 *
 * Handover is two-sided: `rafa claim hand <n> --to=<store id>` on the
 * owner (`./hand.ts`) is one side, and this command on the receiver is
 * the other. The accept commit is the latest ownership commit once it
 * lands, so its store, this device's, is the owner from then on
 * (`src/claims/record.ts`).
 *
 * ## What is read
 *
 * The line first: exactly one argument, the issue number
 * (`readIssueArgument`). Then this device's store id, then one fetch of
 * the `feat/rafa-*` branches and every remote branch of the issue, as
 * `rafa claim release` reads them (`./release.ts`). No network means no
 * acceptance.
 *
 * ## Which handover it accepts
 *
 * The one branch of the issue whose claim is held with a handover
 * PENDING to this store: its latest ownership commit is a `hand` whose
 * `Rafa-Claim-To` is this store id. Any later ownership commit ends the
 * offer, so a branch where it ended is refused, and {@link offerOf}
 * names what ended it by the first ownership commit after this store's
 * latest handover:
 *
 * | After the latest `hand` to this store | Reading |
 * |---|---|
 * | nothing | `pending`: accepted |
 * | `withdraw` | refused: withdrawn by the owner, naming it and the commit |
 * | `hand` to another store | refused: replaced by that handover |
 * | `release`, `take`, `claim`, `accept` | refused: ended by that commit |
 * | no `hand` to this store at all | refused: no handover names this store |
 *
 * A claim this store already holds is refused apart, naming it, since
 * there is nothing to accept.
 *
 * ## What it pushes
 *
 * One empty `accept` commit naming this store, made on the branch's
 * remote tip and pushed with `--force-with-lease` on that tip
 * (`src/claims/git.ts`). An owner that withdraws, or hands the claim
 * elsewhere, between this command's fetch and its push moves the tip,
 * so the lease refuses the accept and nothing lands.
 *
 * No label changes: the stage is the same whoever holds the claim. No
 * local ref, index or working tree moves but the remote-tracking ref the
 * push writes; the branch's work commits are fetched as any remote
 * branch is.
 *
 * ## What it writes
 *
 * Text mode writes one line naming the issue, the branch, the store the
 * claim came from and the commit. In json mode the terminal result's
 * `data` is a {@link ClaimAcceptResult}.
 *
 * ## Refusals
 *
 * Exit code 1, each pushing nothing: an argument that is not one issue
 * number; a store that names no id, or cannot be read; a failed fetch;
 * no remote branch of the issue; no branch of the issue with a handover
 * pending to this store, each branch's reason named, a withdrawn one
 * among them; two such branches, naming both; a branch that moved on
 * the remote between the fetch and the push; and a push git refused
 * otherwise.
 */
import type { ClaimCommandSeams, ClaimDoing, ClaimSeamsFactory, FoundBranch } from './release.js';
import type { ClaimBranchReading } from '../../claims/git.js';
import type { ClaimRecord } from '../../claims/record.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';

import { parseClaimMessage } from '../../claims/record.js';
import { CommandExit } from '../../cli/command.js';
import { REMOTE } from '../../start/branch-decision.js';
import { createStartPreflightClaim } from '../../start/preflight-claim.js';
import { requireProject, resolveProjectConfig } from '../plan/plan-files.js';

import { pushOnClaimTip, readClaimStoreId, readIssueArgument, readIssueBranches } from './release.js';

/** The usage line a refusal names. */
const USAGE = 'rafa claim accept <n>';

/** The command's name, as refusals open with it. */
const COMMAND = 'rafa claim accept';

/** How this command's refusals word an acceptance. */
const ACCEPTING: ClaimDoing = { during: 'was being accepted', nothing: 'nothing was accepted' };

/** What one acceptance did. */
export interface ClaimAcceptResult {
  readonly issue: number;
  readonly branch: string;
  /** This device's store, which holds the claim now. */
  readonly storeId: string;
  /** The store that offered the handover and held the claim until now. */
  readonly from: string;
  /** The handover commit accepted. */
  readonly handSha: string;
  /** The accept commit now at the branch's tip on the remote. */
  readonly sha: string;
}

/** Whether one branch holds a handover this store may accept, and why not when it does not. */
export type OfferReading =
  | { readonly state: 'pending'; readonly from: string; readonly handSha: string }
  | { readonly state: 'refused'; readonly reason: string };

/** One ownership commit of a branch, read. */
interface ReadCommit {
  readonly sha: string;
  readonly record: ClaimRecord;
}

/** A refusal with exit code 1, opening with the command's name. */
function refuse(message: string): CommandExit {
  return new CommandExit(1, `❌ ${COMMAND}: ${message}`);
}

/** The well-formed ownership commits of `reading`, oldest first. */
function ownershipCommits(reading: FoundBranch): readonly ReadCommit[] {
  return reading.commits.flatMap((commit) => {
    const parsed = parseClaimMessage(commit.message);
    return parsed.kind === 'ownership'
      ? [{ sha: commit.sha, record: parsed.record }]
      : [];
  });
}

/** Why the handover to this store at `after`'s predecessor ended, as the commit `after` says. */
function endedReason(after: ReadCommit, branch: string): string {
  const { record, sha } = after;
  if (record.action === 'withdraw') {
    return `the handover to this device on ${branch} was withdrawn by store ${record.store} (commit ${sha})`;
  }
  if (record.action === 'hand') {
    return `the handover to this device on ${branch} was replaced by a handover to store ${record.to} (commit ${sha})`;
  }
  return `the handover to this device on ${branch} was ended by a ${record.action} commit of store ${record.store} (commit ${sha})`;
}

/** Why a found branch whose claim is not pending to `storeId` offers nothing, read from its history. */
function noOfferReason(reading: FoundBranch, issue: number, storeId: string): string {
  const { branch, ownership } = reading;
  if (ownership.state === 'held' && ownership.owner === storeId) {
    return `this device (store ${storeId}) already holds the claim on #${String(issue)} on ${branch}`;
  }
  const commits = ownershipCommits(reading);
  const handedHere = commits.map(({ record }) => record.action === 'hand' && record.to === storeId);
  const last = handedHere.lastIndexOf(true);
  const after = commits[last + 1];
  if (last !== -1 && after !== undefined) return endedReason(after, branch);
  if (ownership.state === 'none') return `${branch} carries no claim commit`;
  if (ownership.state === 'released') return `the claim on ${branch} was released by store ${ownership.releasedBy}`;
  return `no handover on ${branch} names this device's store ${storeId}; store ${ownership.owner} holds the claim`;
}

/**
 * Whether `reading` holds a handover pending to `storeId`, or why not;
 * see the module note's table.
 */
export function offerOf(reading: ClaimBranchReading, issue: number, storeId: string): OfferReading {
  const { branch } = reading;
  if (reading.state === 'absent') return { state: 'refused', reason: `${branch} is gone from ${REMOTE}` };
  if (reading.state === 'unreadable') {
    return { state: 'refused', reason: `the claim on ${branch} could not be read: ${reading.reason}` };
  }
  const { ownership } = reading;
  if (ownership.state === 'held' && ownership.pending?.to === storeId) {
    return { state: 'pending', from: ownership.owner, handSha: ownership.pending.sha };
  }
  return { state: 'refused', reason: noOfferReason(reading, issue, storeId) };
}

/** The one branch of the issue with a handover pending to this store, or a refusal naming what each says. */
function findOffer(readings: readonly ClaimBranchReading[], issue: number, storeId: string): { readonly reading: FoundBranch; readonly from: string; readonly handSha: string } {
  const offers = readings.flatMap((reading) => {
    const offer = offerOf(reading, issue, storeId);
    return offer.state === 'pending' && reading.state === 'found'
      ? [{ reading, from: offer.from, handSha: offer.handSha }]
      : [];
  });
  const [only] = offers;
  if (offers.length === 1 && only !== undefined) return only;
  if (offers.length > 1) {
    const names = offers.map((offer) => offer.reading.branch).join(', ');
    throw refuse(`#${String(issue)} is handed over to this device (store ${storeId}) on more than one branch: ${names}; ${ACCEPTING.nothing}`);
  }
  const reasons = readings.map((reading) => {
    const offer = offerOf(reading, issue, storeId);
    return offer.state === 'refused'
      ? offer.reason
      : '';
  });
  throw refuse(`no handover of #${String(issue)} to this device (store ${storeId}) is pending, so ${ACCEPTING.nothing}:\n${reasons.map((reason) => `   ${reason}`).join('\n')}`);
}

/** Accepts the handover of the issue the line names to this device; see the module note. */
export function acceptClaim(context: RafaContext, makeSeams: ClaimSeamsFactory): ClaimAcceptResult {
  const issue = readIssueArgument(context.args, USAGE);
  const project = requireProject(context, COMMAND);
  const config = resolveProjectConfig(project, COMMAND, (message) => context.output.warn(message));
  const seams: ClaimCommandSeams = makeSeams(project.root, config);
  const storeId = readClaimStoreId(seams, refuse);
  const { reading, from, handSha } = findOffer(readIssueBranches(seams.git, issue, refuse), issue, storeId);
  const sha = pushOnClaimTip(seams.git, reading, { action: 'accept', issue, store: storeId }, refuse, ACCEPTING);
  return { issue, branch: reading.branch, storeId, from, handSha, sha };
}

/** The line text mode writes at `info`. */
export function renderAccept(result: ClaimAcceptResult): string {
  return `Accepted the handover of #${String(result.issue)} on ${result.branch} from store ${result.from}:`
    + ` accept commit ${result.sha} pushed to ${REMOTE}; this device (store ${result.storeId}) now owns the claim.`;
}

/** The default seams: the ones `loop start`'s claim check reads through. */
const DEFAULT_SEAMS: ClaimSeamsFactory = (root, config) => createStartPreflightClaim(root, config);

/** The command, reaching git and the store through `makeSeams`; see the module note. */
export function createClaimAcceptCommand(makeSeams: ClaimSeamsFactory = DEFAULT_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'claim accept',
    subject: 'claim',
    action: 'accept',
    summary: 'take up a handover of an issue\'s claim offered to this device',
    description: 'Pushes one accept commit naming this device\'s store to the issue\'s claim branch on'
      + ' origin, leased on the tip it read, so this device owns the claim from then on and no other'
      + ' device\'s push is overwritten. Refused when no handover pending on the branch names this'
      + ' device\'s store, when the handover was withdrawn or replaced, when the branch moved meanwhile,'
      + ' and when origin cannot be reached. No label and no local branch moves. With `--output=json`'
      + ' the issue, the branch, the stores and the commits are the data of the terminal result event.',
    args: [
      {
        name: 'n',
        description: 'The issue number whose handover this device accepts.',
        type: 'string',
        required: true,
      },
    ],
    flags: [],
    examples: [
      {
        cmd: 'rafa claim accept 324',
        note: 'Accepts the handover of #324 offered to this device\'s store; this device owns the claim from then on.',
      },
      {
        cmd: 'rafa claim accept 324 --output=json',
        note: 'Writes a start event, then a result event whose data holds the branch and the accept commit.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const result = acceptClaim(context, makeSeams);
      if (context.outputMode === 'json') {
        context.output.result(result);
      } else {
        context.output.info(renderAccept(result));
      }
      await Promise.resolve();
    },
  };
  return Object.freeze(command);
}

export default createClaimAcceptCommand();
