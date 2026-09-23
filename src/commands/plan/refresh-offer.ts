/**
 * The question `plan create --issue` and `plan create --next` ask when
 * the issue they were pointed at no longer reads as its saved copy: the
 * {@link RefreshOffer} `src/board/snapshot-settle.ts` takes.
 *
 * `settleSpecSnapshot` decides WHETHER to ask — only on a changed body,
 * only without `--refresh`, only after every check has run on the body
 * as it reads now — and prints the difference lines before it does.
 * This module is only the asking: {@link createPlanRefreshOffer} puts
 * {@link refreshQuestion}, `Issue #<n> changed since the saved copy of
 * <YYYY-MM-DD>. Plan from it as it reads now? [y/N] `, and answers
 * whether it was said yes to. The date is the saved copy's modification
 * time in UTC, handed in on the request, so this module reads no clock.
 *
 * ## What reads as yes
 *
 * `y` or `yes`, read by `answeredYes` (`src/start/branch-decision.ts`)
 * inside `lazyPrompter`: trimmed and in any case, the reading every
 * other `[y/N]` question in rafa makes. Anything else
 * declines, the empty answer included, and so does an input that ended
 * before an answer — the prompter's null — so a closed standard input
 * refuses the run rather than planning from a body nobody agreed to.
 *
 * ## The terminal is read once, when the command starts
 *
 * {@link createPlanRefreshOffer} answers NULL where standard input is no
 * terminal, so a run that cannot ask hands `resolvePlanSpec` no offer
 * and is refused with `snapshotDiffersMessage`, the sentence a
 * changed body met before there was a question. It reads the terminal as
 * `./ready-offer.ts` does and for the same reason: the reading is made
 * before any body is, so what a run without one ends with does not hang
 * on how far the resolution got.
 *
 * The prompter is opened only to ask, through `issue ready`'s own
 * {@link lazyPrompter}, and closed once the question is answered — or
 * once the prompter threw, which is thrown on unchanged.
 *
 * ## Nothing here opens a terminal
 *
 * The terminal and the prompter are seams ({@link RefreshOfferSeams}),
 * so every case in `./refresh-offer.test.ts` drives a fake and none of
 * them reads standard input or waits on an answer.
 */
import type { RefreshOffer, RefreshOfferRequest } from '../../board/snapshot-settle.js';
import type { Prompter } from '../../cli/prompt/confirm.js';

import { refreshQuestion } from '../../board/snapshot-settle.js';
import { createLinePrompter } from '../../cli/prompt/confirm.js';
import { lazyPrompter } from '../issue/ready.js';

/** How the terminal and the question are reached; each left out is the system's own. */
export interface RefreshOfferSeams {
  /** True when a question can be answered. `process.stdin.isTTY` when left out. */
  readonly isTerminal?: () => boolean;
  /** Opens the prompter the question is asked through. Called only to ask. */
  readonly openPrompter?: () => Prompter;
}

/** The seams a `plan create` run asks with: the system's own, every one. */
export const DEFAULT_REFRESH_OFFER_SEAMS: RefreshOfferSeams = Object.freeze({});

/**
 * The offer `resolvePlanSpec` takes, or null where there is no terminal
 * to ask on and a changed body is refused as it was before.
 *
 * The offer asks {@link refreshQuestion} over the request's issue and the
 * date its saved copy was taken, and answers true on `y` or `yes`
 * (`answeredYes`), false on anything else or an input that ended.
 * The prompter is closed after every question, answered or thrown.
 */
export function createPlanRefreshOffer(
  seams: RefreshOfferSeams = DEFAULT_REFRESH_OFFER_SEAMS,
): RefreshOffer | null {
  const isTerminal = seams.isTerminal ?? ((): boolean => process.stdin.isTTY === true);
  if (!isTerminal()) return null;

  const openPrompter = seams.openPrompter ?? ((): Prompter => createLinePrompter(process.stdin, process.stderr));

  return async (request: RefreshOfferRequest): Promise<boolean> => {
    const prompter = lazyPrompter(openPrompter);
    try {
      return await prompter.ask(refreshQuestion(request.issue, request.savedAt));
    } finally {
      prompter.close();
    }
  };
}
