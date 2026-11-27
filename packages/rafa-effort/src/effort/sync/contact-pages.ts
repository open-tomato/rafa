/**
 * How a hub contact (`contact.ts` beside this file) keeps each payload
 * under the hub's `maxPayloadRows`: {@link splitPush} sends the rows
 * waiting in payloads of at most the cap, and {@link pagedPull} repeats
 * a pull while its page came back full. Both run over the selected
 * `Sync` alone, reading what core's port names none of by shape, and
 * the strategy keeps the cursors: each bounded push moves its push
 * cursor past the rows it sent, and each pull its pull cursor past the
 * page it merged. `contact.ts`'s module note, `The payload cap`, is the
 * authority for what each does, and its `The order` for a push leaving
 * out the conflicted rows.
 */
import type { Sync, SyncPullRequest, SyncPullResult, SyncPushRequest, SyncPushResult } from '@open-tomato/rafa/ports';

import { conflictedOf, countOf, memberOf, pageRowsOf } from './contact-facts.js';

/**
 * The hub's cap as a run has it: a number of rows, null for none, or
 * the call that asks it, made only once rows wait to push or a page
 * says how many rows it carried.
 */
export type PayloadCap = number | null | (() => Promise<number | null>);

/** A push asked to send at most `limit` rows past the strategy's push cursor; see the module note. */
export interface BoundedPushRequest extends SyncPushRequest {
  /** The most rows the payload carries: the hub's `maxPayloadRows`. */
  readonly limit: number;
}

/** A push asked to leave out every row `merge_conflicts` names, as `contact.ts`'s `pull-then-push` asks it. */
interface ConflictedPushRequest extends SyncPushRequest {
  readonly leaveOutConflicted: true;
}

/** The pages one pull repeats at most before it stops, leaving the rest to the next contact. */
export const MAX_PULL_PAGES = 1000;

/** The push every contact asks for when it bounds nothing: the strategy reaches the hub itself. */
const WHOLE_PUSH: SyncPushRequest = Object.freeze({ to: null });

/** {@link WHOLE_PUSH} leaving out the conflicted rows. */
const WHOLE_PUSH_LEAVING_OUT: ConflictedPushRequest = Object.freeze({ to: null, leaveOutConflicted: true });

/** The merge counts {@link pagedPull} sums over a pull's pages. */
const SUMMED = ['rowsAdded', 'rowsSkipped', 'rowsInConflict', 'rowsHeld', 'rowsRefilled', 'gapsRewritten'] as const;

/** The merge a `pulled` answer carries. */
type Merge = Extract<SyncPullResult, { readonly status: 'pulled' }>['merge'];

/** `cap` as a number of rows or null, asked when it is a call. */
async function capNow(cap: PayloadCap): Promise<number | null> {
  return typeof cap === 'function'
    ? cap()
    : cap;
}

/** `result` carrying `conflicted` as the rows left out across every payload of one push, or `result` itself when it already says so. */
function withConflicted(result: SyncPushResult, conflicted: number): SyncPushResult {
  return conflicted === conflictedOf(result)
    ? result
    : Object.freeze({ ...result, conflicted });
}

/**
 * Sends the rows waiting to push in payloads of at most the hub's cap:
 * one push as core's port asks it for a strategy with no
 * `pendingPush()`, nothing waiting or a hub naming no cap, and bounded
 * pushes otherwise, each followed by a count of the rows still waiting,
 * until none do. Under `leaveOutConflicted` every push asks
 * `leaveOutConflicted: true`, and the answer's `conflicted` is summed
 * over the payloads. Answers the last push's answer. Rejects as the
 * push or the count rejects, and with a line saying so when a bounded
 * push left as many rows waiting as before it, so a strategy whose
 * cursor did not move is never asked again. See the module note.
 */
export async function splitPush(sync: Sync, cap: PayloadCap, leaveOutConflicted = false): Promise<SyncPushResult> {
  const whole = leaveOutConflicted
    ? WHOLE_PUSH_LEAVING_OUT
    : WHOLE_PUSH;
  const pending = memberOf(sync, 'pendingPush');
  if (cap === null || pending === null) return sync.push(whole);
  let waiting = countOf(await pending());
  if (waiting === null || waiting === 0) return sync.push(whole);
  const limit = await capNow(cap);
  if (limit === null) return sync.push(whole);
  const bounded: BoundedPushRequest = Object.freeze({ ...whole, limit });
  let result = await sync.push(bounded);
  let conflicted = conflictedOf(result);
  while (result.status === 'pushed') {
    const left = countOf(await pending());
    if (left === null || left === 0) return withConflicted(result, conflicted);
    if (left >= waiting) {
      throw new Error(
        `the strategy still counts ${String(left)} rows to push after a payload of at most ${String(limit)},`
          + ' so its push cursor did not move; the rest push on the next contact',
      );
    }
    waiting = left;
    result = await sync.push(bounded);
    conflicted += conflictedOf(result);
  }
  return withConflicted(result, conflicted);
}

/** Whether `result`'s page came back full: it says how many rows it carried, and they reach the cap. */
async function cameBackFull(result: SyncPullResult, cap: PayloadCap): Promise<boolean> {
  const rows = pageRowsOf(result);
  if (rows === null || rows === 0) return false;
  const limit = await capNow(cap);
  return limit !== null && rows >= limit;
}

/** The merge counts of `earlier` and `later` summed, every other field the later merge's. */
function summedMerge(earlier: Merge, later: Merge): Merge {
  const sums = Object.fromEntries(SUMMED.map((field) => [field, earlier[field] + later[field]]));
  return Object.freeze({ ...later, ...sums });
}

/** Two pages' answers as one: the later answer, its merge counts summed with the earlier's. */
function combined(earlier: SyncPullResult, later: SyncPullResult): SyncPullResult {
  if (later.status !== 'pulled') return earlier;
  if (earlier.status !== 'pulled') return later;
  return Object.freeze({ ...later, merge: summedMerge(earlier.merge, later.merge) });
}

/**
 * Pulls `request` once, then again while the page came back full, each
 * page's answer handed to `notice` as it lands. A dry run is never
 * repeated, since its cursor does not move. Answers the last page's
 * answer with the merge counts summed over the pages, or the first
 * page's when no later one merged anything. Rejects as a page rejects,
 * the pages before it staying merged, and with a line saying so once
 * {@link MAX_PULL_PAGES} pages came back full. See the module note.
 */
export async function pagedPull(
  sync: Sync,
  request: SyncPullRequest,
  cap: PayloadCap,
  notice: (result: SyncPullResult) => void,
): Promise<SyncPullResult> {
  let page = await sync.pull(request);
  notice(page);
  let total = page;
  for (let pages = 1; !request.dryRun && await cameBackFull(page, cap); pages += 1) {
    if (pages >= MAX_PULL_PAGES) {
      throw new Error(`the hub answered ${String(pages)} full pages to one pull; the rest pull on the next contact`);
    }
    page = await sync.pull(request);
    notice(page);
    total = combined(total, page);
  }
  return total;
}
