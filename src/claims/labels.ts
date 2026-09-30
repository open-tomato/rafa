/**
 * The stage labels a claim's issue carries, written at each stage
 * transition: `rafa:claimed` put on when the issue is claimed,
 * `rafa:claimed` swapped for `rafa:in-development` at `loop start`, and
 * both taken off when the claim is released or its pull request merges
 * through `rafa pr merge` (`.rafa/plans/rafa-324-claim-issue-so-two`).
 *
 * ## Labels show the stage, never the owner
 *
 * The claim lives in git (`./git.ts`, `./record.ts`); a label is only a
 * reading of how far the claim has gone, for the people looking at the
 * board. So every write here is best-effort: a transition never throws
 * and never undoes anything. It answers a {@link LabelOutcome}, `written`
 * when the board took the write, or a `warning` naming the issue, the
 * stage and why the label was not written, for the caller to print
 * beside a claim that stands regardless. `./stale.ts` reads a missing or
 * doubled stage label as "in development", so no warning answered here
 * can turn a claim into a takeover candidate.
 *
 * Two things answer a warning:
 *
 *   - **A board that is not `gh`.** The caller passes `null` for the
 *     board, the convention `src/commands/doctor-board.ts` keeps for a
 *     project whose `pr.provider` is not `gh`; nothing is sent.
 *   - **A write that fails.** Anything the {@link IssueBoard} member
 *     rejects or throws — a failed `gh issue edit`, and the `TypeError`
 *     it raises for an issue number that is not a positive whole number
 *     before sending anything — is caught and answered as the warning,
 *     carrying the board's own message.
 *
 * ## One command per transition, save the removal
 *
 * The move to in development is ONE `swapLabels`, for the reason
 * `src/board/issue-board.ts` records: two commands can half-apply and
 * leave the issue with neither label. The removal is two `removeLabel`
 * commands, `rafa:in-development` then `rafa:claimed`, because
 * {@link IssueBoard} has no member that takes two labels off at once,
 * and the second is sent even when the first failed, so one failure
 * costs one label and not both. Release and merge are the same removal:
 * a claim is released at either stage, and an issue a failed swap left
 * carrying both labels must lose both.
 *
 * What `gh issue edit --remove-label` does with a label the issue does
 * not carry, so what the removal answers for an issue still at
 * `rafa:claimed`, was not measured here: every case in `./labels.test.ts`
 * drives a board of its own and none reaches GitHub. If `gh` refuses it,
 * the removal answers a warning naming that label while the label it
 * did carry is still taken off.
 */
import type { IssueBoard } from '../board/issue-board.js';

import { messageOf } from '../config-sections.js';

import { CLAIMED_LABEL, IN_DEVELOPMENT_LABEL } from './stale.js';

/** What every warning this module answers opens with. */
const PREFIX = 'claim labels';

/** What a warning says the label's absence does not change. */
const CLAIM_STANDS = 'the claim stands in git';

/** The stage labels a release or a merge takes off, in the order they are sent. */
export const STAGE_LABELS = Object.freeze([IN_DEVELOPMENT_LABEL, CLAIMED_LABEL] as const);

/** What a transition answered: the board took it, or why it did not. */
export type LabelOutcome =
  | { readonly outcome: 'written' }
  | { readonly outcome: 'warning'; readonly warning: string };

const WRITTEN: LabelOutcome = Object.freeze({ outcome: 'written' });

/** The warning outcome, frozen. */
function warn(warning: string): LabelOutcome {
  return Object.freeze({ outcome: 'warning', warning });
}

/** The warning for a project with no `gh` board, where `stage` is what was not written. */
function noBoard(issue: number, stage: string): LabelOutcome {
  return warn(`${PREFIX}: #${String(issue)} was not ${stage}: the board is not gh; ${CLAIM_STANDS}`);
}

/** Runs one board write, answering the failure as a warning rather than throwing it. */
async function attempt(issue: number, stage: string, write: () => Promise<void>): Promise<LabelOutcome> {
  try {
    await write();
    return WRITTEN;
  } catch (error) {
    return warn(`${PREFIX}: #${String(issue)} was not ${stage}: ${messageOf(error)}; ${CLAIM_STANDS}`);
  }
}

/** Puts `rafa:claimed` on the claimed issue; see the module note. */
export async function labelClaimed(board: IssueBoard | null, issue: number): Promise<LabelOutcome> {
  const stage = `labelled ${CLAIMED_LABEL}`;
  if (board === null) return noBoard(issue, stage);
  return attempt(issue, stage, () => board.addLabel(issue, CLAIMED_LABEL));
}

/** Swaps `rafa:claimed` for `rafa:in-development` in one write at `loop start`; see the module note. */
export async function labelInDevelopment(board: IssueBoard | null, issue: number): Promise<LabelOutcome> {
  const stage = `moved from ${CLAIMED_LABEL} to ${IN_DEVELOPMENT_LABEL}`;
  if (board === null) return noBoard(issue, stage);
  return attempt(issue, stage, () => board.swapLabels(issue, CLAIMED_LABEL, IN_DEVELOPMENT_LABEL));
}

/**
 * Takes both stage labels off, each in a write of its own, the second
 * sent even when the first failed; every failure is one line of the
 * warning. `why` is the transition, for the message.
 */
async function clearStage(board: IssueBoard | null, issue: number, why: string): Promise<LabelOutcome> {
  if (board === null) return noBoard(issue, `unlabelled on ${why}`);
  const warnings: string[] = [];
  for (const label of STAGE_LABELS) {
    const outcome = await attempt(issue, `unlabelled ${label} on ${why}`, () => board.removeLabel(issue, label));
    if (outcome.outcome === 'warning') warnings.push(outcome.warning);
  }
  return warnings.length === 0
    ? WRITTEN
    : warn(warnings.join('\n'));
}

/** Takes the stage labels off an issue whose claim was released; see the module note. */
export async function unlabelReleased(board: IssueBoard | null, issue: number): Promise<LabelOutcome> {
  return clearStage(board, issue, 'release');
}

/** Takes the stage labels off an issue whose pull request merged; see the module note. */
export async function unlabelMerged(board: IssueBoard | null, issue: number): Promise<LabelOutcome> {
  return clearStage(board, issue, 'merge');
}
