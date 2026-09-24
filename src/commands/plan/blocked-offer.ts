/**
 * The offer `plan create --next` makes when the line the roadmap points
 * at is blocked: the first line under it that is ready, not blocked and
 * not taken, named by number and asked about.
 *
 * `src/board/blocked-line.ts` reads what the line waits on and finds the
 * alternative, and asks nobody anything. This module is the half that
 * does: {@link createPlanBlockedOffer} answers the
 * {@link AlternativeOffer} `resolvePlanSpec` takes, and a run it answers
 * null for plans nothing and says so
 * (`.rafa/specs/rafa-63-one-command-next-step.md`).
 *
 * ## One question, and nothing else
 *
 * Unlike the `spec:ready` offer beside it (`./ready-offer.ts`), this one
 * runs no command and writes nothing to the board: the yes it collects
 * moves the run past ONE roadmap line, and every check the issue it
 * names has to pass is the check a typed `--issue=<n>` would put it
 * through, run after the answer by `src/board/plan-spec.ts`. So a yes
 * here is not a decision about the issue — it is a decision about the
 * ORDER, which is the only thing a blocked line takes away.
 *
 * That is why the lines the operator reads before the question —
 * `#57 is blocked by #24 (open)`, each line passed, and the alternative
 * — are printed by the walk rather than here: they are what was READ,
 * and this module owns only what was ASKED.
 *
 * ## The terminal is read once, when the command starts
 *
 * {@link createPlanBlockedOffer} answers NULL where standard input is no
 * terminal, so a run that cannot ask hands `resolvePlanSpec` no offer at
 * all rather than one that answers false. The difference is what the
 * operator is told: no offer prints the sentence naming the alternative
 * and the two commands that reach it, while a false would read as an
 * answer nobody gave.
 *
 * The prompter is opened only to ask, through `rafa issue ready`'s own
 * {@link lazyPrompter}, and closed as soon as the question is answered —
 * the same pair the other offer opens, spelled once.
 *
 * ## Nothing here spawns
 *
 * The terminal and the prompter are both seams
 * ({@link BlockedOfferSeams}), so every case in `./blocked-offer.test.ts`
 * drives a fake and none of them opens a terminal or waits on an answer.
 */
import type { AlternativeOffer, AlternativeOfferRequest } from '../../board/blocked-line.js';
import type { Prompter } from '../../cli/prompt/confirm.js';

import { alternativeQuestion } from '../../board/blocked-line.js';
import { createLinePrompter } from '../../cli/prompt/confirm.js';
import { lazyPrompter } from '../issue/ready.js';

/** How the terminal and the question are reached; each left out is the system's own. */
export interface BlockedOfferSeams {
  /** True when a question can be answered. `process.stdin.isTTY` when left out. */
  readonly isTerminal?: () => boolean;
  /** Opens the prompter the question is asked through. Called only to ask. */
  readonly openPrompter?: () => Prompter;
}

/** The seams a `plan create` run offers with: the system's own, both of them. */
export const DEFAULT_BLOCKED_SEAMS: BlockedOfferSeams = Object.freeze({});

/**
 * The offer `resolvePlanSpec` takes, or null where there is no terminal
 * to ask on and the run plans nothing.
 *
 * The answer is the operator's: true after a yes to
 * `Plan #<n> instead? [y/N]`, false after anything else.
 */
export function createPlanBlockedOffer(
  seams: BlockedOfferSeams = DEFAULT_BLOCKED_SEAMS,
): AlternativeOffer | null {
  const isTerminal = seams.isTerminal ?? ((): boolean => process.stdin.isTTY === true);
  if (!isTerminal()) return null;

  const openPrompter = seams.openPrompter ?? ((): Prompter => createLinePrompter(process.stdin, process.stderr));

  return async (request: AlternativeOfferRequest): Promise<boolean> => {
    const prompter = lazyPrompter(openPrompter);
    try {
      return await prompter.ask(alternativeQuestion(request.line.issue));
    } finally {
      prompter.close();
    }
  };
}
