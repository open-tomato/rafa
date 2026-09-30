/**
 * The stale reading: whether a claim branch's claim still stands, from
 * who holds it, when its tip was committed, the stage labels on its
 * issue, `claims.staleAfter` and the clock. Nothing here touches git,
 * the board or the clock itself: `./git.ts` reads the branch
 * (`readClaimBranch` answers the ownership and `tipCommittedAt`), the
 * caller reads the labels and passes `now`, and {@link readClaimState}
 * only decides.
 *
 * ## The four answers
 *
 * | Ownership | Stage label | Idle for | Answer |
 * |---|---|---|---|
 * | `released` | any | any | `released` |
 * | `held` | any | `staleAfter` is `disabled` | `held` |
 * | `held` | any | less than `staleAfter` | `held` |
 * | `held` | `rafa:claimed` alone | `staleAfter` or more | `stale-claimed` |
 * | `held` | anything else | `staleAfter` or more | `stale-in-development` |
 *
 * "Idle for" is `now` less the tip's committer date, since git records
 * no push time and every ownership commit moves the tip. A tip dated
 * after `now`, which a skewed clock on another device can write, is
 * idle for no time and so never stale, and a tip date that is no date
 * at all (an invalid `Date`) is read the same way: data that cannot be
 * read never offers a takeover. A claim idle for EXACTLY
 * `staleAfter` is stale: the setting is how long a claim stands, and at
 * that moment it has stood that long.
 *
 * ## Three readings this module makes
 *
 *   - **Only `stale-claimed` may be taken over without being asked.**
 *     `claims.staleAfter` applies to `rafa:claimed` claims alone, so a
 *     held claim is answered `stale-claimed` only when its issue carries
 *     `rafa:claimed` and not `rafa:in-development`. An issue carrying
 *     both, which a failed label swap at `loop start` leaves, and one
 *     carrying neither, which a board that is not `gh` or a failed label
 *     write leaves, are read as in development: label writes are
 *     best-effort, and a missing label must never turn a running loop's
 *     branch into a takeover candidate. `stale-in-development` is a note
 *     on a claim that stays taken; only `rafa claim take <n> --stale`
 *     takes it.
 *   - **`disabled` is never stale**, whatever the label or the age.
 *   - **A release decides alone.** The claim lives in git and labels
 *     show the stage, never the owner, so a released branch is
 *     `released` even when a failed label removal left a stage label
 *     on its issue; the drift check reports that label.
 *
 * A branch carrying no ownership commit at all (`state: 'none'`) has no
 * claim to read and is not this module's: it stays taken as a branch
 * does today, so {@link readClaimState} takes only the two ownerships a
 * claim can have, and the type refuses the third.
 */
import type { ClaimsStaleAfter } from '../config-sections.js';
import type { Ownership, PendingHandover } from './record.js';

import { claimDurationHours, CLAIMS_STALE_DISABLED } from '../config-sections.js';

/** The label a claim's issue carries from `plan create` to `loop start`. */
export const CLAIMED_LABEL = 'rafa:claimed';

/** The label a claim's issue carries from `loop start` until it merges. */
export const IN_DEVELOPMENT_LABEL = 'rafa:in-development';

/** The four answers of {@link readClaimState}, in the module note's order. */
export const CLAIM_STATES = ['held', 'released', 'stale-claimed', 'stale-in-development'] as const;

/** One answer of {@link readClaimState}. */
export type ClaimStateName = (typeof CLAIM_STATES)[number];

/** An ownership that names a claim: every one but `none`. */
export type ClaimOwnership = Exclude<Ownership, { readonly state: 'none' }>;

/** What {@link readClaimState} reads. */
export interface ClaimStateInput {
  /** Who holds the branch's claim, from `readOwnership`. */
  readonly ownership: ClaimOwnership;
  /** The committer date of the branch's tip on the remote. */
  readonly tipCommittedAt: Date;
  /** The labels on the claim's issue, as the board reads them. */
  readonly labels: readonly string[];
  /** `claims.staleAfter`, as the config holds it. */
  readonly staleAfter: ClaimsStaleAfter;
  /** The clock the idle time is read against. */
  readonly now: Date;
}

/** What {@link readClaimState} answered. */
export type ClaimState =
  /** A store holds the claim and it still stands. */
  | { readonly state: 'held'; readonly owner: string; readonly pending: PendingHandover | null }
  /** The claim was released: nobody holds it. */
  | { readonly state: 'released'; readonly releasedBy: string }
  /** A `rafa:claimed` claim idle for `staleAfter` or more: a takeover candidate. */
  | { readonly state: 'stale-claimed'; readonly owner: string; readonly idleMs: number }
  /** A claim in development idle for `staleAfter` or more: still taken. */
  | { readonly state: 'stale-in-development'; readonly owner: string; readonly idleMs: number };

const MS_PER_HOUR = 3_600_000;

/**
 * The milliseconds `staleAfter` spells, or null when it is `disabled`.
 * Throws on a value the config reader would have refused, since one
 * reaching here is the caller's mistake.
 */
function staleAfterMs(staleAfter: ClaimsStaleAfter): number | null {
  if (staleAfter === CLAIMS_STALE_DISABLED) {
    return null;
  }
  const hours = claimDurationHours(staleAfter);
  if (hours === null) {
    throw new Error(`claim state: claims.staleAfter ${JSON.stringify(staleAfter)} is no duration`);
  }
  return hours * MS_PER_HOUR;
}

/** True when only `rafa:claimed`, and not `rafa:in-development`, marks the issue. */
function isClaimedStage(labels: readonly string[]): boolean {
  return labels.includes(CLAIMED_LABEL) && !labels.includes(IN_DEVELOPMENT_LABEL);
}

/**
 * Whether a branch's claim still stands; see the module note for the
 * table and the three readings behind it.
 */
export function readClaimState(input: ClaimStateInput): ClaimState {
  const { ownership, tipCommittedAt, labels, staleAfter, now } = input;
  if (ownership.state === 'released') {
    return { state: 'released', releasedBy: ownership.releasedBy };
  }
  const { owner, pending } = ownership;
  const threshold = staleAfterMs(staleAfter);
  const elapsed = now.getTime() - tipCommittedAt.getTime();
  const idleMs = Number.isFinite(elapsed)
    ? Math.max(0, elapsed)
    : 0;
  if (threshold === null || idleMs < threshold) {
    return { state: 'held', owner, pending };
  }
  return isClaimedStage(labels)
    ? { state: 'stale-claimed', owner, idleMs }
    : { state: 'stale-in-development', owner, idleMs };
}
