/**
 * The offer `plan create --issue` and `plan create --next` make when the
 * issue they were pointed at carries no `spec:ready` label: `rafa issue
 * ready`'s own run, put where the refusal used to stand.
 *
 * Check 1 of the readiness gate is a person's decision
 * (`src/board/plan-spec.ts`, `context/pull-requests.md`), and until now
 * an operator who had made it still had to make it somewhere else — the
 * run ended with `issue #<n> is not marked spec:ready` and the next move
 * was a second command over the same issue. This module is the seam that
 * ends: {@link createPlanReadyOffer} answers the offer
 * `resolvePlanSpec` takes, and the offer runs {@link runIssueReady} over
 * the issue the route has ALREADY read
 * (`.rafa/specs/rafa-63-one-command-next-step.md`).
 *
 * ## What the operator sees, and what it costs
 *
 * {@link offerHeadLine} first, naming the label that is missing and the
 * command this is; then the three lines `issue ready` prints — the trust
 * reading, the completeness reading and the outcome. A yes swaps the
 * labels in the one `gh issue edit` that command makes, and the
 * resolution goes on to the leak and completeness checks and the
 * snapshot. A no prints `#<n> was left unmarked` and the route throws
 * the refusal check 1 always threw.
 *
 * The issue is handed over as the `readIssue` seam, so the offer spends
 * NO second `gh issue view` on a body the route read a moment ago, and
 * the body it checks is the body it will be planned from. The trust is
 * the one check 0 built, already memoised, so the author lookup inside
 * `issue ready` costs nothing either. The only command an offer sends is
 * the label swap, and only after a yes.
 *
 * ## The terminal is read once, before any body is
 *
 * {@link createPlanReadyOffer} answers NULL where standard input is no
 * terminal, so a run that cannot ask hands `resolvePlanSpec` no offer at
 * all and is refused with the sentence it was refused with before. The
 * reading is made when the command starts rather than when an unlabelled
 * issue turns up, which is what keeps the no-terminal refusal exactly
 * today's: an offer that answered false from inside check 1 would have
 * read the body for the leak refusal first, and a leaking unlabelled
 * body would change which sentence the run ends with.
 *
 * The prompter is opened only to ask, through `issue ready`'s own
 * {@link lazyPrompter}, and closed as soon as the question is answered.
 *
 * ## Nothing here spawns
 *
 * The terminal, the prompter and the run itself are all seams
 * ({@link ReadyOfferSeams}), so every case in `./ready-offer.test.ts`
 * drives a fake and none of them reaches GitHub, opens a terminal or
 * waits on an answer.
 */
import type { ReadyOffer, ReadyOfferRequest } from '../../board/plan-spec.js';
import type { Prompter } from '../../project/root-choice.js';
import type { ReadyReport } from '../issue/ready.js';

import { SPEC_READY_LABEL } from '../../board/readiness.js';
import { createLinePrompter } from '../../project/root-choice.js';
import { lazyPrompter, runIssueReady } from '../issue/ready.js';

/** What the offer is: one run of `rafa issue ready` over an issue already read. */
export type ReadyRun = typeof runIssueReady;

/** How the terminal, the question and the run are reached; each left out is the system's own. */
export interface ReadyOfferSeams {
  /** True when a question can be answered. `process.stdin.isTTY` when left out. */
  readonly isTerminal?: () => boolean;
  /** Opens the prompter the question is asked through. Called only to ask. */
  readonly openPrompter?: () => Prompter;
  /** Makes the run; `runIssueReady` when left out. */
  readonly run?: ReadyRun;
}

/** The seams a `plan create` run offers with: the system's own, every one. */
export const DEFAULT_OFFER_SEAMS: ReadyOfferSeams = Object.freeze({});

/**
 * The line the offer opens with: what is missing, and which command the
 * three lines under it come from.
 */
export function offerHeadLine(issue: number): string {
  const number = String(issue);
  return `🏷  issue #${number} is not marked ${SPEC_READY_LABEL} — reading it as rafa issue ready ${number} would.`;
}

/** Writes the head line and the three lines a report is printed as. */
function writeOffer(request: ReadyOfferRequest, report: ReadyReport): void {
  request.output.info(report.trust);
  request.output.info(report.checked);
  request.output.info(report.message);
}

/**
 * The offer `resolvePlanSpec` takes, or null where there is no terminal
 * to ask on and the run keeps check 1's refusal.
 *
 * The answer is whether the issue now carries the label: true after a
 * yes and the swap it wrote, false after a no. Every refusal
 * {@link runIssueReady} throws — an untrusted author, a body with gaps,
 * a swap `gh` refused — is thrown on unchanged, so `plan create` ends
 * with the sentence `issue ready` would have ended with.
 */
export function createPlanReadyOffer(seams: ReadyOfferSeams = DEFAULT_OFFER_SEAMS): ReadyOffer | null {
  const isTerminal = seams.isTerminal ?? ((): boolean => process.stdin.isTTY === true);
  if (!isTerminal()) return null;

  const openPrompter = seams.openPrompter ?? ((): Prompter => createLinePrompter(process.stdin, process.stderr));
  const run = seams.run ?? runIssueReady;

  return async (request: ReadyOfferRequest): Promise<boolean> => {
    const { issue } = request;
    request.output.info(offerHeadLine(issue.number));

    const prompter = lazyPrompter(openPrompter);
    try {
      const report = await run({
        gh: request.gh,
        issue: issue.number,
        trust: request.trust,
        ask: prompter.ask,
        // The issue the route read a moment ago: no second read, and
        // the body checked here is the body the plan is written from.
        readIssue: () => Promise.resolve(issue),
      });
      writeOffer(request, report);
      return report.status === 'marked';
    } finally {
      prompter.close();
    }
  };
}
