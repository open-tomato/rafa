/**
 * `rafa claim hand <n> --to=<store id>`: offers this device's claim on
 * issue `<n>` to another store with one handover commit pushed to the
 * claim branch; `rafa claim hand <n> --withdraw` takes a pending offer
 * back with one withdraw commit (`.rafa/plans/rafa-324-claim-issue-so-two`).
 * Starts no Claude session and declares no `spends`.
 *
 * Handover is two-sided: this command is the owner's side, and
 * `rafa claim accept <n>` on the receiver is the other. Until the
 * receiver accepts, the owner stays the owner (`src/claims/record.ts`)
 * and may withdraw.
 *
 * ## What is read
 *
 * The line first, before anything else: exactly one of `--to=<store id>`
 * and `--withdraw`, then exactly one argument, the issue number
 * (`readIssueArgument`). A `--to` must hold one word with no blank, the
 * form a claim record's store id takes; `--withdraw` takes no value, so
 * a line typed `--withdraw 7` reads `7` as its value and is refused,
 * naming the order to type it in. The flags are read first so that line
 * is told so, rather than that it gave no argument. Then this device's
 * store id, and a `--to` naming that very store, or an id it replaced
 * (`holdsClaim`, `src/claims/device.ts`), is refused. Then one fetch of
 * the claim branches (the `naming.branch` template with the stub,
 * `feat/rafa-<n>-<slug>` by default) and every remote branch of the issue, as
 * `rafa claim release` reads them (`./release.ts`). No network means no
 * handover.
 *
 * ## What it pushes
 *
 * The one branch of the issue whose claim this store holds gets one
 * empty commit made on its remote tip and pushed with
 * `--force-with-lease` on that tip (`src/claims/git.ts`). A claim
 * naming an id the store replaced is this store's too, as
 * `rafa claim release` reads it (`./release.ts`), and the commit pushed
 * over it names the store's own id, never the replaced one:
 *
 * | Line | Pending handover | Commit |
 * |---|---|---|
 * | `--to=<b>` | none | `hand`, `Rafa-Claim-To: <b>` |
 * | `--to=<b>` | to another store `c` | `hand` to `b`, which replaces the offer to `c` |
 * | `--to=<b>` | to `b` already | none: refused, the offer stands |
 * | `--withdraw` | to `b` | `withdraw`, which ends the offer to `b` |
 * | `--withdraw` | none | none: refused, nothing to withdraw |
 *
 * The latest ownership commit decides, so a second handover replaces the
 * first and a withdraw clears either; the reader cannot tell a repeat
 * from a replacement, so the repeat is refused here rather than pushed
 * as noise. Whether `<b>` names a real store is not checked: no device
 * can see another's store, and a handover nobody accepts only waits to
 * be withdrawn.
 *
 * No label changes: the stage, `rafa:claimed` or `rafa:in-development`,
 * is the same whoever holds the claim. No local ref, index or working
 * tree moves but the remote-tracking ref the push writes.
 *
 * ## What it writes
 *
 * Text mode writes one line naming the issue, the branch, the receiver
 * and the commit. In json mode the terminal result's `data` is a
 * {@link ClaimHandResult}.
 *
 * ## Refusals
 *
 * Exit code 1, each pushing nothing: a line that is not one issue number
 * with exactly one of `--to` and `--withdraw`, or whose `--to` is no
 * store id; a store that names no id, or cannot be read; a `--to` naming
 * this device's own store; a failed fetch; no remote branch of the
 * issue; a claim this store does not hold, as `rafa claim release`
 * words it; a repeat handover and a withdraw with none pending; a branch
 * that moved on the remote between the fetch and the push; and a push
 * git refused otherwise.
 */
import type { ClaimCommandSeams, ClaimDoing, ClaimSeamsFactory, FoundBranch } from './release.js';
import type { ClaimRecord } from '../../claims/record.js';
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';

import { CommandExit } from '@open-tomato/rafa/core/command';

import { holdsClaim } from '../../claims/device.js';
import { REMOTE } from '../../start/branch-decision.js';
import { createStartPreflightClaim } from '../../start/preflight-claim.js';
import { requireProject, resolveProjectConfig } from '../plan/plan-files.js';

import { CLAIM_HAND_DECLARATION, CLAIM_HAND_TO_FLAG, CLAIM_HAND_WITHDRAW_FLAG } from './declarations.js';
import {
  findOwnedBranch,
  pushOnClaimTip,
  readClaimDevice,
  readIssueArgument,
  readIssueBranches,
} from './release.js';

/** The usage line a refusal names. */
const USAGE = 'rafa claim hand <n> --to=<store id> | rafa claim hand <n> --withdraw';

/** The command's name, as refusals open with it. */
const COMMAND = 'rafa claim hand';

/** A store id as a claim record holds it: one run of non-blank characters. */
const STORE_ID = /^\S+$/;

/** How this command's refusals word a handover. */
const HANDING: ClaimDoing = { during: 'was being handed over', nothing: 'nothing was pushed' };

/** What the line asks for: a handover to one store, or a withdrawal. */
export type HandRequest =
  | { readonly action: 'hand'; readonly to: string }
  | { readonly action: 'withdraw' };

/** What one handover or withdrawal did. */
export interface ClaimHandResult {
  readonly issue: number;
  readonly branch: string;
  /** `hand` for a handover pushed, `withdraw` for one taken back. */
  readonly action: HandRequest['action'];
  /** This device's store, which held the claim before and still holds it. */
  readonly storeId: string;
  /** The store offered the claim, or, on a withdrawal, the one whose offer ended. */
  readonly to: string;
  /** On a handover, the store an earlier pending offer named, which this one replaced; else null. */
  readonly replaced: string | null;
  /** The ownership commit now at the branch's tip on the remote. */
  readonly sha: string;
}

/** A refusal with exit code 1, opening with the command's name. */
function refuse(message: string): CommandExit {
  return new CommandExit(1, `❌ ${COMMAND}: ${message}`);
}

/** A refusal of the line itself, naming the usage. */
function lineRefusal(message: string): CommandExit {
  return refuse(`${message}\nUsage: ${USAGE}`);
}

/** Whether the line says `--withdraw`; a refusal for a value typed to it. */
function readWithdraw(flags: RafaContext['flags']): boolean {
  const value = flags[CLAIM_HAND_WITHDRAW_FLAG];
  if (value === undefined) return false;
  if (typeof value === 'boolean') return value;
  throw lineRefusal(`--${CLAIM_HAND_WITHDRAW_FLAG} takes no value, and read "${value}" as one; type the issue number before the flags`);
}

/** The store `--to` names, null when the line gives none; a refusal for one that is no store id. */
function readTo(flags: RafaContext['flags']): string | null {
  const value = flags[CLAIM_HAND_TO_FLAG];
  if (value === undefined) return null;
  if (typeof value === 'boolean') throw lineRefusal(`--${CLAIM_HAND_TO_FLAG} needs a store id, as --${CLAIM_HAND_TO_FLAG}=<store id>`);
  const to = value.trim();
  if (!STORE_ID.test(to)) throw lineRefusal(`--${CLAIM_HAND_TO_FLAG}=${JSON.stringify(value)} is no store id, which is one word with no blank`);
  return to;
}

/** What the line's flags ask for: exactly one of `--to` and `--withdraw`, or a refusal. */
export function readHandRequest(flags: RafaContext['flags']): HandRequest {
  const withdraw = readWithdraw(flags);
  const to = readTo(flags);
  if (withdraw && to !== null) {
    throw lineRefusal(`--${CLAIM_HAND_TO_FLAG} and --${CLAIM_HAND_WITHDRAW_FLAG} are two actions; give one`);
  }
  if (withdraw) return { action: 'withdraw' };
  if (to === null) throw lineRefusal(`name the receiving store with --${CLAIM_HAND_TO_FLAG}=<store id>, or take a pending handover back with --${CLAIM_HAND_WITHDRAW_FLAG}`);
  return { action: 'hand', to };
}

/** The ownership record to push on `reading` for `request`, or a refusal when there is nothing to push. */
function recordFor(reading: FoundBranch, request: HandRequest, issue: number, storeId: string): { readonly record: ClaimRecord; readonly to: string; readonly replaced: string | null } {
  const { branch, ownership } = reading;
  const pending = ownership.state === 'held'
    ? ownership.pending
    : null;
  if (request.action === 'withdraw') {
    if (pending === null) {
      throw refuse(`no handover of #${String(issue)} is pending on ${branch}, so there is nothing to withdraw; ${HANDING.nothing}`);
    }
    return { record: { action: 'withdraw', issue, store: storeId }, to: pending.to, replaced: null };
  }
  if (pending?.to === request.to) {
    throw refuse(`#${String(issue)} is already handed over to store ${request.to} on ${branch} (commit ${pending.sha}); ${HANDING.nothing}`);
  }
  return {
    record: { action: 'hand', issue, store: storeId, to: request.to },
    to: request.to,
    replaced: pending?.to ?? null,
  };
}

/** Hands over, or withdraws a handover of, this device's claim on the issue the line names; see the module note. */
export async function handClaim(context: RafaContext, makeSeams: ClaimSeamsFactory): Promise<ClaimHandResult> {
  const request = readHandRequest(context.flags);
  const issue = readIssueArgument(context.args, USAGE);
  const project = requireProject(context, COMMAND);
  const config = await resolveProjectConfig(project, COMMAND, (message) => context.output.warn(message));
  const seams: ClaimCommandSeams = makeSeams(project.root, config);
  const device = readClaimDevice(seams, refuse);
  const { storeId } = device;
  if (request.action === 'hand' && holdsClaim(device, request.to)) {
    throw refuse(`--${CLAIM_HAND_TO_FLAG}=${request.to} is this device's own store; a handover names another store`);
  }
  const reading = findOwnedBranch(readIssueBranches(seams.git, issue, refuse), { issue, device }, refuse, HANDING);
  const { record, to, replaced } = recordFor(reading, request, issue, storeId);
  const sha = pushOnClaimTip(seams.git, reading, record, refuse, HANDING);
  return { issue, branch: reading.branch, action: request.action, storeId, to, replaced, sha };
}

/** The line text mode writes at `info`. */
export function renderHand(result: ClaimHandResult): string {
  const issue = String(result.issue);
  if (result.action === 'withdraw') {
    return `Withdrew the handover of #${issue} to store ${result.to} on ${result.branch}:`
      + ` withdraw commit ${result.sha} pushed to ${REMOTE}; store ${result.storeId} keeps the claim.`;
  }
  const replaced = result.replaced === null
    ? ''
    : ` It replaces the handover to store ${result.replaced}.`;
  return `Handed the claim on #${issue} (store ${result.storeId}) on ${result.branch} over to store ${result.to}:`
    + ` hand commit ${result.sha} pushed to ${REMOTE}. This device stays the owner until store ${result.to}`
    + ` runs rafa claim accept ${issue}.${replaced}`;
}

/** The default seams: the ones `loop start`'s claim check reads through. */
const DEFAULT_SEAMS: ClaimSeamsFactory = (root, config) => createStartPreflightClaim(root, config);

/** The command, reaching git and the store through `makeSeams`; see the module note. */
export function createClaimHandCommand(makeSeams: ClaimSeamsFactory = DEFAULT_SEAMS): RafaCommand {
  const command: RafaCommand = {
    ...CLAIM_HAND_DECLARATION,
    run: async (context) => {
      const result = await handClaim(context, makeSeams);
      if (context.outputMode === 'json') {
        context.output.result(result);
      } else {
        context.output.info(renderHand(result));
      }
      await Promise.resolve();
    },
  };
  return Object.freeze(command);
}

const command: RafaCommand = createClaimHandCommand();
export default command;
