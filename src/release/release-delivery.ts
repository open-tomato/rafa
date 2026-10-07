/**
 * Settle's release pull request, told apart from a branch that stamped
 * a version by hand (#843).
 *
 * ```text
 * isReleaseBranch(head)            → whether head is RELEASE_PR_BRANCH   (pure)
 * releaseDeliveryOf(reading)       → the delivery, or null               (pure)
 * releaseDeliveryLine(delivery)    → the one line the guard prints       (pure)
 * ```
 *
 * Under `release.settle: pr`, `rafa release settle` pushes its release
 * commit to `RELEASE_PR_BRANCH` (`./settle-pr.ts`) and opens a pull
 * request from it. That commit stamps the version and folds the waiting
 * fragments away, so the guard (`./guard.ts`) reads it as `stale`
 * (`not-on-base`) and its forecast as a branch carrying no fragment. Both
 * readings are right about the files and wrong about the branch:
 * stamping is that branch's whole job, and the fix line the guard ends
 * on (`rafa pr triage <n> --resolve`) would turn the release back into a
 * fragment.
 *
 * ## What counts as the delivery
 *
 * A guard reading is the delivery when all of these hold:
 *
 *   - its branch's name is `RELEASE_PR_BRANCH` and it has a pull request;
 *   - the guard read `stale` with the relation `not-on-base`: the branch
 *     stamped a version the base neither holds nor has passed, which is
 *     what a settle that is still current leaves.
 *
 * Anything else on that branch is read as the guard reads any branch. A
 * `collision` (the base already names the version with other notes) and
 * a `stale` the base has `passed` or `released` are a release pull
 * request the base has moved past, so "merging it lands <version>" would
 * be false; their lines, fix included, stay. A head of any other name
 * is never the delivery, whatever it stamps.
 *
 * The delivery prints one line, {@link releaseDeliveryLine}, in place of
 * the guard's lines: no `stale` head, no forecast, no `fix:` line.
 */
import type { GuardReading } from './guard.js';

import { RELEASE_PR_BRANCH } from './settle-pr.js';

/** Settle's release pull request, as the guard read it. */
export interface ReleaseDelivery {
  /** Tells the delivery apart from a guard reading in a union. */
  readonly kind: 'release-delivery';
  /** The release pull request's number. */
  readonly pullRequest: number;
  /** The version the release commit stamps, which merging it lands. */
  readonly version: string;
}

/** Whether `head` is the branch settle's `pr` delivery pushes to. */
export function isReleaseBranch(head: string): boolean {
  return head === RELEASE_PR_BRANCH;
}

/**
 * The delivery `reading` is, or null where it is an ordinary reading;
 * see the module note for the conditions.
 */
export function releaseDeliveryOf(reading: GuardReading): ReleaseDelivery | null {
  if (!reading.ok) return null;
  const { branch, verdict } = reading;
  if (!isReleaseBranch(branch.name) || branch.pullRequest === null) return null;
  if (verdict.answer !== 'stale' || verdict.relation !== 'not-on-base') return null;
  return { kind: 'release-delivery', pullRequest: branch.pullRequest, version: verdict.stamp.version };
}

/** The one line the guard prints for the delivery. */
export function releaseDeliveryLine(delivery: ReleaseDelivery): string {
  return `Release: #${delivery.pullRequest} is settle's release pull request; merging it lands ${delivery.version}`;
}
