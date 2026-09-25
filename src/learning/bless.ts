/**
 * Which held lessons a task may use, and which have recurred enough to
 * promote.
 *
 * {@link bless} answers the records a pull injects: `active`, not
 * promoted, and at or above the confidence floor, ordered so the most
 * trusted lesson comes first. {@link promotable} narrows that list to
 * the lessons the wrap-up session is asked to write into a page: the
 * ones enough distinct sources confirmed, at a higher floor.
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
 *   - **`promotable` takes one floor.** Its `minConfidence` is the only
 *     confidence it reads, so a record is blessed for it when it meets
 *     that floor; the promotion floor is meant to sit above the blessing
 *     one, and a caller configured the other way round should bless first
 *     and pass the higher of the two.
 *
 * Like the rest of `src/learning/`, this module imports nothing from
 * the rest of `src/`, reads no clock and uses no randomness; no record
 * passed in is changed.
 */

import type { BlessedBundle, InstinctRecord } from './types.js';

import { createHash } from 'node:crypto';

/** The scale a confidence is compared at: whole hundredths. */
const HUNDREDTHS = 100;

/** What {@link bless} reads. */
export interface BlessOptions {
  /** The lowest confidence a blessed record may carry, inclusive. */
  minConfidence: number;
}

/** What {@link promotable} reads. */
export interface PromoteOptions {
  /** The fewest distinct sources a promotable record has, inclusive. */
  after: number;
  /** The lowest confidence a promotable record may carry, inclusive. */
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

/** The records a task may use at `minConfidence`, most trusted first. */
function blessedRecords(held: readonly InstinctRecord[], minConfidence: number): InstinctRecord[] {
  const floor = hundredths(minConfidence);
  return held
    .filter((each) => each.status === 'active'
      && each.promoted_to === undefined
      && hundredths(each.confidence) >= floor)
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
 * The blessed records that recurred enough to promote: a `usage_count`
 * of at least `after` and a confidence of at least `minConfidence`, in
 * {@link bless}'s order.
 */
export function promotable(held: readonly InstinctRecord[], options: PromoteOptions): InstinctRecord[] {
  return blessedRecords(held, options.minConfidence)
    .filter((each) => each.usage_count >= options.after);
}
