/**
 * The retarget of a delivered pull request opened against another base
 * than the run's (rafa-628, #627).
 *
 * A wrap-up session can open its pull request into `main` while the run
 * was resolved against another base — `stretch/1` in the incident — and
 * the CI wait would then read checks GitHub ran against the wrong base.
 * {@link retargetPullRequest} is the step that closes that gap: handed
 * the pull request `deliverPullRequest` answered as `delivered` and the
 * run's base, it compares the two EXACTLY (`pull.baseRefName !== base`)
 * and, only where they differ, edits the pull request's base through the
 * provider's `editBase` (`pr/types.ts`).
 *
 * ## What it says, and what it never does
 *
 *   - A base that already matches sends nothing to the provider and
 *     prints nothing.
 *   - A retarget prints ONE info line naming the pull request and both
 *     bases ({@link retargetedLine}).
 *   - An edit the provider refused prints ONE warning naming the pull
 *     request, both bases and what the provider said
 *     ({@link refusedRetargetLine}), and returns. It never throws: the
 *     pull request exists and the operator can retarget it by hand, so
 *     the run is not blocked and goes on to the CI wait.
 *
 * The base is the caller's to resolve, once (`start/wrap-up-run.ts`
 * resolves it for the delivery); this module reads no git and no config.
 * Every effect goes through {@link PrRetargetSeams}, so a test drives the
 * provider through the recorded `gh` fake and reads the lines without
 * the process-wide active output.
 */
import type { Output } from '../ports/index.js';
import type { PullRequests, PullRequestSummary } from '../pr/index.js';

import { messageOf } from '../config-sections.js';

/** The effects {@link retargetPullRequest} reaches through. */
export interface PrRetargetSeams {
  /** The provider the base is edited through. */
  readonly pulls: Pick<PullRequests, 'editBase'>;
  /** Where the retarget line and the refusal warning are written. */
  readonly output: Pick<Output, 'info' | 'warn'>;
}

/** A pull request already into the run's base: nothing was sent. */
export interface RetargetUnchanged {
  readonly kind: 'unchanged';
}

/** A pull request whose base was edited from `from` to `to`. */
export interface RetargetDone {
  readonly kind: 'retargeted';
  readonly from: string;
  readonly to: string;
}

/** An edit the provider refused; `detail` is what it said. */
export interface RetargetRefused {
  readonly kind: 'refused';
  readonly from: string;
  readonly to: string;
  readonly detail: string;
}

/** What {@link retargetPullRequest} did. */
export type RetargetOutcome = RetargetUnchanged | RetargetDone | RetargetRefused;

/** The info line a retarget prints. */
export function retargetedLine(number: number, from: string, to: string): string {
  return `↪ Retargeted pull request #${String(number)} from ${from} to ${to} (pr.base).`;
}

/** The warning a refused retarget prints; see the module note. */
export function refusedRetargetLine(number: number, from: string, to: string, detail: string): string {
  return `⚠️  Could not retarget pull request #${String(number)} from ${from} to ${to} (pr.base): ${detail}. Retarget it by hand; the run carries on to the CI wait.`;
}

/**
 * Edits `pull`'s base to `base` when they differ, and answers what it
 * did. Never throws on a refused edit; see the module note.
 */
export async function retargetPullRequest(
  pull: PullRequestSummary,
  base: string,
  seams: PrRetargetSeams,
): Promise<RetargetOutcome> {
  const from = pull.baseRefName;
  if (from === base) return { kind: 'unchanged' };
  try {
    await seams.pulls.editBase(pull.number, base);
  } catch (error) {
    const detail = messageOf(error);
    seams.output.warn(refusedRetargetLine(pull.number, from, base, detail));
    return { kind: 'refused', from, to: base, detail };
  }
  seams.output.info(retargetedLine(pull.number, from, base));
  return { kind: 'retargeted', from, to: base };
}
