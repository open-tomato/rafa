/**
 * The same-action arithmetic: what several records taking one action
 * read as together.
 *
 * {@link pooledConfidence} is the one place it is written. `merge`
 * calls it when it collapses the records one trigger holds for one
 * action, and `sameActionGroups` when it reads one action across every
 * trigger, so a group and a collapsed record can never disagree about
 * what three sources at 0.5 are worth: 0.60.
 *
 * ## The arithmetic
 *
 *   - **The source step is counted once.** A record's confidence
 *     already carries {@link SOURCE_STEP} for each of its own sources
 *     beyond the first, so each member's step is taken off before the
 *     mean and the step for the union is added after it.
 *   - **A source counts once.** Members are read in the order given, and
 *     a member weighs only as many sources as it adds to those already
 *     read, so the mean is weighted by usage without counting a source
 *     twice.
 *   - **A record without `sources`** stands as one source named by its
 *     own `id`.
 *   - **Two decimals.** The mean is taken in whole hundredths, clamped
 *     to {@link CONFIDENCE_MIN} and {@link CONFIDENCE_MAX}, and answered
 *     at two decimals.
 *
 * Like the rest of `src/learning/`, this module imports nothing from
 * the rest of `src/`, reads no clock and uses no randomness; no record
 * passed in is changed.
 */

import type { InstinctRecord } from './types.js';

import { CONFIDENCE_MAX, CONFIDENCE_MIN, SOURCE_STEP } from './identity.js';

/** Hundredths in one unit of confidence. */
const HUNDREDTHS = 100;

/** {@link SOURCE_STEP} in whole hundredths. */
const STEP_H = Math.round(SOURCE_STEP * HUNDREDTHS);

/** {@link CONFIDENCE_MIN} in whole hundredths. */
const MIN_H = Math.round(CONFIDENCE_MIN * HUNDREDTHS);

/** {@link CONFIDENCE_MAX} in whole hundredths. */
const MAX_H = Math.round(CONFIDENCE_MAX * HUNDREDTHS);

/** What several records taking one action read as together. */
export interface Pooled {
  /** The union of the members' sources, in code-unit order. */
  readonly sources: string[];
  /** Their pooled confidence, at two decimals. */
  readonly confidence: number;
}

/** The distinct sources a record stands for; its own `id` when it names none. */
export function sourcesOf(record: InstinctRecord): string[] {
  return record.sources !== undefined && record.sources.length > 0
    ? [...new Set(record.sources)]
    : [record.id];
}

/**
 * The union of `ordered`'s sources and the confidence they pool to: the
 * usage-weighted mean of the members' confidences, each member's own
 * source step taken off first, plus {@link SOURCE_STEP} per distinct
 * source beyond the first, clamped to the confidence bounds.
 *
 * @param ordered - one or more records taking one action, in the order
 *   a source shared by two of them is credited to the first.
 */
export function pooledConfidence(ordered: readonly InstinctRecord[]): Pooled {
  const seen = new Set<string>();
  let weighted = 0;
  for (const member of ordered) {
    const own = sourcesOf(member);
    const fresh = own.filter((source) => !seen.has(source));
    const base = Math.round(member.confidence * HUNDREDTHS) - STEP_H * (own.length - 1);
    weighted += base * fresh.length;
    for (const source of fresh) {
      seen.add(source);
    }
  }
  const sources = [...seen].sort();
  const stepped = Math.round(weighted / sources.length + STEP_H * (sources.length - 1));
  const confidence = Math.min(MAX_H, Math.max(MIN_H, stepped)) / HUNDREDTHS;
  return { sources, confidence };
}
