/**
 * Which held lessons a task may use, and which have recurred enough to
 * promote.
 *
 * {@link bless} answers the records a pull injects: `active`, not
 * promoted, and at or above the confidence floor, ordered so the most
 * trusted lesson comes first. {@link promotable} narrows that list to
 * the lessons the wrap-up session is asked to write into a page: it
 * reads the records as same-action groups (`groups.ts`), so a lesson
 * learned under several triggers counts its sources once, and names one
 * record for each group enough distinct sources confirmed, at a higher
 * floor.
 *
 * ## Readings the rules leave open
 *
 *   - **Two decimals.** A confidence is compared with a floor, and with
 *     another confidence, in whole hundredths, as `merge` compares them,
 *     so 0.7 − 0.2 (0.49999999999999994) meets a floor of 0.5.
 *   - **Promoted means `promoted_to` is set.** A record carrying the
 *     field, whatever path it names, is left out: the page it names
 *     carries the lesson now.
 *   - **Ties.** Equal confidences in hundredths are ordered by
 *     `usage_count`, highest first, then by `id` in code-unit order, the
 *     order every machine agrees on.
 *   - **The bundle's `version`** is the sha256 of what the bundle holds,
 *     in order, rather than a time: the library reads no clock, and two
 *     machines holding one set answer one version. An adapter that wants
 *     a time stamps its own.
 *   - **`promotable` floors the group, not its members.** It reads
 *     the records {@link bless} would keep at any floor (`active` and not
 *     promoted), groups them by `action_hash` with
 *     {@link sameActionGroups}, and compares each group's source union
 *     with `after` and its pooled confidence with `minConfidence`: three
 *     wordings from three sources at 0.5 pool to 0.6, so they pass a
 *     floor of 0.6 that none of them meets alone. A caller hands it a
 *     blessed set (the wrap-up and `rafa instinct promote` pass the
 *     adapter's `pullBlessed` bundle), so the blessing floor still keeps
 *     out the members tasks may not use.
 *   - **One record per group.** A passing group answers its named record
 *     (its most trusted member) once, whatever its member count; the
 *     answers come in the groups' order: pooled confidence, then source
 *     count, both highest first, then the named record's `id`.
 *   - **A flagged member never counts.** It is left out before grouping,
 *     so it neither lifts its group's sources or confidence nor is
 *     answered.
 *
 * Like the rest of `src/learning/`, this module imports nothing from
 * the rest of `src/`, reads no clock and uses no randomness; no record
 * passed in is changed.
 */

import type { BlessedBundle, InstinctRecord } from './types.js';

import { createHash } from 'node:crypto';

import { sameActionGroups } from './groups.js';

/** The scale a confidence is compared at: whole hundredths. */
const HUNDREDTHS = 100;

/** What {@link bless} reads. */
export interface BlessOptions {
  /** The lowest confidence a blessed record may carry, inclusive. */
  minConfidence: number;
}

/** What {@link promotable} reads. */
export interface PromoteOptions {
  /** The fewest distinct sources a promotable group has, inclusive. */
  after: number;
  /** The lowest pooled confidence a promotable group may carry, inclusive. */
  minConfidence: number;
}

/** A confidence in whole hundredths. */
function hundredths(confidence: number): number {
  return Math.round(confidence * HUNDREDTHS);
}

/** Orders two strings by code unit, as every machine does. */
function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/** Highest confidence first, then highest usage, then `id`. */
function byTrust(left: InstinctRecord, right: InstinctRecord): number {
  return hundredths(right.confidence) - hundredths(left.confidence)
    || right.usage_count - left.usage_count
    || compareText(left.id, right.id);
}

/** Whether a record is `active` and not promoted: bless's exclusions. */
function isUsable(record: InstinctRecord): boolean {
  return record.status === 'active' && record.promoted_to === undefined;
}

/** The records a task may use at `minConfidence`, most trusted first. */
function blessedRecords(held: readonly InstinctRecord[], minConfidence: number): InstinctRecord[] {
  const floor = hundredths(minConfidence);
  return held
    .filter((each) => isUsable(each) && hundredths(each.confidence) >= floor)
    .sort(byTrust);
}

/** The sha256 of the records a bundle holds, in their order. */
function versionOf(instincts: readonly InstinctRecord[]): string {
  return createHash('sha256').update(JSON.stringify(instincts))
    .digest('hex');
}

/**
 * The held records a task may use: `active` (so never `flagged`), not
 * promoted, and with a confidence of at least `minConfidence`. Ordered
 * by confidence, then `usage_count`, both highest first, then `id`.
 */
export function bless(held: readonly InstinctRecord[], options: BlessOptions): BlessedBundle {
  const instincts = blessedRecords(held, options.minConfidence);
  return { version: versionOf(instincts), instincts };
}

/**
 * The lessons that recurred enough to promote: the `active`, unpromoted
 * records read as same-action groups, each group whose source union
 * holds at least `after` sources and whose pooled confidence is at least
 * `minConfidence` answering its named record once, in the groups' order.
 * See the module note for the readings.
 */
export function promotable(held: readonly InstinctRecord[], options: PromoteOptions): InstinctRecord[] {
  const floor = hundredths(options.minConfidence);
  return sameActionGroups(held.filter(isUsable))
    .filter((group) => group.sources.length >= options.after
      && hundredths(group.confidence) >= floor)
    .map((group) => group.named);
}
