/**
 * One lesson learned under several wordings: the held records sharing
 * one action across triggers.
 *
 * `merge` settles each trigger alone, so one action pushed under three
 * triggers is held as three records, each with its own sources.
 * {@link sameActionGroups} reads them back as one group per
 * `action_hash`, after `merge` and never inside it, so no record is
 * rewritten and nothing is stored: every machine holding one set
 * derives the same groups from it.
 *
 * ## Readings the rules leave open
 *
 *   - **A flagged member never counts.** A `flagged` record is left out
 *     of its group's members, sources and confidence, so a wrong lesson
 *     cannot lift a right one. An action held only by flagged records
 *     answers no group.
 *   - **Every action answers a group,** one held under a single trigger
 *     included, so a caller counting sources reads one shape whatever the
 *     wording count; a caller after groups of two or more filters on
 *     `members`.
 *   - **The arithmetic is `merge`'s.** `pool.ts`'s
 *     {@link pooledConfidence} gives the sources and confidence, over the
 *     members oldest first (by `created_at`, then `id`), as `merge`
 *     credits a shared source: three sources at 0.5 read 0.6.
 *   - **Ordering.** Members are ordered by confidence, then
 *     `usage_count`, both highest first, then `id` in code-unit order, and
 *     the group is named by the first. Groups are ordered by confidence,
 *     then source count, both highest first, then the named record's
 *     `id`. Confidences are compared in whole hundredths.
 *
 * Like the rest of `src/learning/`, this module imports nothing from
 * the rest of `src/`, reads no clock and uses no randomness; no record
 * passed in is changed.
 */

import type { InstinctRecord, SameActionGroup } from './types.js';

import { pooledConfidence } from './pool.js';

/** Hundredths in one unit of confidence. */
const HUNDREDTHS = 100;

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

/** Oldest first: by `created_at`, then `id`. */
function byAge(left: InstinctRecord, right: InstinctRecord): number {
  return compareText(left.created_at, right.created_at) || compareText(left.id, right.id);
}

/** Highest confidence first, then highest usage, then `id`. */
function byTrust(left: InstinctRecord, right: InstinctRecord): number {
  return hundredths(right.confidence) - hundredths(left.confidence)
    || right.usage_count - left.usage_count
    || compareText(left.id, right.id);
}

/** Highest confidence first, then most sources, then the named `id`. */
function byGroupTrust(left: SameActionGroup, right: SameActionGroup): number {
  return hundredths(right.confidence) - hundredths(left.confidence)
    || right.sources.length - left.sources.length
    || compareText(left.named.id, right.named.id);
}

/** One action's unflagged records as its group. */
function groupOf(hash: string, records: readonly InstinctRecord[]): SameActionGroup {
  const { sources, confidence } = pooledConfidence([...records].sort(byAge));
  const members = [...records].sort(byTrust);
  return { action_hash: hash, members, sources, confidence, named: members[0]! };
}

/**
 * The held records as one group per `action_hash`, across triggers,
 * `flagged` records left out. See the module note for the readings.
 *
 * @param held - the records held, on any trigger.
 * @returns one group per action at least one unflagged record takes,
 *   ordered by confidence, then source count, then the named `id`.
 */
export function sameActionGroups(held: readonly InstinctRecord[]): SameActionGroup[] {
  const byAction = new Map<string, InstinctRecord[]>();
  for (const record of held) {
    if (record.status === 'flagged') {
      continue;
    }
    const found = byAction.get(record.action_hash);
    if (found === undefined) {
      byAction.set(record.action_hash, [record]);
    } else {
      found.push(record);
    }
  }
  return [...byAction].map(([hash, records]) => groupOf(hash, records))
    .sort(byGroupTrust);
}
