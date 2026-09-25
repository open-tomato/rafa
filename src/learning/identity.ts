/**
 * What makes two lessons the same lesson, and the fixed numbers a merge
 * settles them by.
 *
 * Two records answer one trigger when their {@link triggerKey}s are
 * equal, and take one action when their {@link actionHash}es are. Both
 * forgive case and surrounding whitespace, so a lesson retyped with a
 * capital letter or a trailing newline still meets its earlier copy.
 * The trigger key also collapses inner whitespace runs, because a
 * trigger is matched as a phrase; the action hash does not, because it
 * is the spec's `sha256(trim(lower(action)))` and a record written
 * before this library already carries that digest.
 *
 * The numbers are library constants rather than settings: a project
 * that tuned them would settle the same payloads differently from its
 * neighbours, and the merge would stop being a fixed rule.
 *
 * Like the rest of `src/learning/`, this module imports nothing from the
 * rest of `src/`; `node:crypto` is the one built-in it takes.
 */

import { createHash } from 'node:crypto';

/**
 * How far below the leading action another action on one trigger may
 * sit before it is discarded rather than flagged beside the leader.
 */
export const GAP = 0.10;

/**
 * The confidence a same-action merge adds for each distinct source
 * beyond the first.
 */
export const SOURCE_STEP = 0.05;

/** The lowest confidence a record may carry. */
export const CONFIDENCE_MIN = 0.3;

/** The highest confidence a record may carry; a merge caps at it. */
export const CONFIDENCE_MAX = 0.9;

/** One or more whitespace characters, the run {@link triggerKey} folds. */
const WHITESPACE_RUN = /\s+/g;

/**
 * `sha256(trim(lower(action)))` in hex: the key a merge collapses
 * records by, so a record and a pushed payload can never disagree about
 * what two records sharing an action means.
 */
export function actionHash(action: string): string {
  return createHash('sha256').update(action.trim().toLowerCase())
    .digest('hex');
}

/**
 * The trigger as a merge groups it: trimmed, lower-cased, and each run
 * of whitespace collapsed to one space.
 */
export function triggerKey(trigger: string): string {
  return trigger.trim().toLowerCase()
    .replace(WHITESPACE_RUN, ' ');
}
