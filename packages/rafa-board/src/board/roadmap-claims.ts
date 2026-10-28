/**
 * The claim half of the roadmap's taken reading: what the claim on a
 * claim branch says, read off the remote once per walk and weighed with
 * the stale reading. `./roadmap.ts` asks the question and words the
 * answer; this module only reads and weighs.
 *
 * ## The claim branch, through the template
 *
 * A claim branch is the `naming.branch` template with the stub in it,
 * `feat/rafa-<n>-<slug>` under the default, `feat/{stub}`. Every reading
 * here takes the template as an optional trailing `template`, defaulting
 * to `DEFAULT_BRANCH_TEMPLATE`, and reads only that template: under
 * `work/{stub}`, `feat/rafa-20-x` is no claim branch, and under the
 * default `work/rafa-20-x` is none.
 *
 * ## Which branches carry a claim reading
 *
 * Only a claim branch the REMOTE holds, as the branch scan's
 * `git ls-remote --heads` half saw it, since the claim lives in git on
 * the remote (`packages/rafa/src/claims/git.ts`). A branch held only by this checkout
 * has no claim anybody else can read, so it answers `none` and stays
 * taken as a branch always was; so does every branch when the remote
 * half of the scan failed, and every branch when the scan asked a
 * remote other than `origin`, the one remote `packages/rafa/src/claims/git.ts` reads
 * claims from. No reading is ever `released` or stale by default:
 * data this module could not read keeps a line taken.
 *
 * ## One fetch, on the first line that asks
 *
 * {@link createRemoteClaimReader} fetches the template's claim branches,
 * `feat/rafa-*` by default (`fetchClaimBranches`), the first time a
 * line asks about a branch the remote holds, and never again in the
 * same walk; each branch is then
 * read once (`readClaimBranch`) and kept. A walk whose lines are all
 * ticked, closed or unbranched spends no fetch at all, and a failed
 * fetch answers every branch `unreadable` with git's own words, which
 * `./roadmap.ts` prints beside the branch: a claim that could not be
 * read is neither swallowed nor guessed.
 *
 * ## How a reading is weighed
 *
 * | Branch reading | Answer |
 * |---|---|
 * | not held by the remote, `absent`, or no ownership commit | `none` |
 * | `unreadable` | `unreadable`, with the reason |
 * | an ownership | `readClaimState` over it (`packages/rafa/src/claims/stale.ts`) |
 *
 * So a released claim answers `released`, a held one `held` until it
 * has stood `claims.staleAfter` idle, and then `stale-claimed` or
 * `stale-in-development` by the issue's stage labels.
 */
import type { ClaimBranchReading } from '@open-tomato/rafa/claims/git';
import type { ClaimState } from '@open-tomato/rafa/claims/stale';
import type { ClaimsStaleAfter } from '@open-tomato/rafa/core/config/sections';
import type { GitRunner } from '@open-tomato/rafa/core/git';

import { claimBranchIssue, fetchClaimBranches, readClaimBranch } from '@open-tomato/rafa/claims/git';
import { readClaimState } from '@open-tomato/rafa/claims/stale';
import { DEFAULT_BRANCH_TEMPLATE } from '@open-tomato/rafa/core/config/sections';
import { REMOTE } from '@open-tomato/rafa/start/branch-decision';

/** What the claim on one branch says, as the taken reading weighs it. */
export type BranchClaim =
  /** No claim to read: see the module note. The branch is taken as it always was. */
  | { readonly state: 'none' }
  /** The branch's claim could not be read; `reason` is what git said. */
  | { readonly state: 'unreadable'; readonly reason: string }
  /** `readClaimState`'s answer over the branch's ownership. */
  | ClaimState;

/**
 * Reads the claim branch `branch` as the remote holds it, or null when
 * the remote does not hold it. The seam the scan carries its claim
 * reading through.
 */
export type RemoteClaimReader = (branch: string) => ClaimBranchReading | null;

/** What {@link weighBranchClaim} weighs a reading against. */
export interface ClaimWeights {
  /** The labels on the branch's issue. */
  readonly labels: readonly string[];
  /** `claims.staleAfter`. */
  readonly staleAfter: ClaimsStaleAfter;
  /** The clock the idle time is read against. */
  readonly now: Date;
}

/**
 * The claim branch a ref names under `template`, whatever prefix the
 * ref carries, or null when it names none. Under the default template
 * `origin/feat/rafa-20-x`, `refs/heads/feat/rafa-20-x` and
 * `feat/rafa-20-x` all name `feat/rafa-20-x`; under `work/{stub}`,
 * `origin/work/rafa-20-x` names `work/rafa-20-x` and
 * `origin/feat/rafa-20-x` names none.
 *
 * The ref is read from each of its `/` boundaries in turn, the whole ref
 * first, and the first tail that is a claim branch under the template
 * (`claimBranchIssue`) is the answer, so the longest such tail wins.
 */
export function claimBranchOfRef(ref: string, template: string = DEFAULT_BRANCH_TEMPLATE): string | null {
  const starts = [0, ...[...ref.matchAll(/\//gu)].map((slash) => slash.index + 1)];
  return starts
    .map((start) => ref.slice(start))
    .find((tail) => claimBranchIssue(tail, template) !== null) ?? null;
}

/**
 * The claim reader over `git`, for the claim branches under `template`
 * among `pushedRefs`, the refs `git ls-remote --heads <remote>` answered.
 * It fetches the template's claim branches once, on the first branch
 * asked about that the remote holds, and reads each branch once. Answers
 * null for every branch when `remote` is not the remote claims are read
 * from; see the module note.
 */
export function createRemoteClaimReader(
  git: GitRunner,
  remote: string,
  pushedRefs: readonly string[],
  template: string = DEFAULT_BRANCH_TEMPLATE,
): RemoteClaimReader {
  const pushed = new Set(remote === REMOTE
    ? pushedRefs.map((ref) => claimBranchOfRef(ref, template)).filter((name) => name !== null)
    : []);
  let fetched: ReturnType<typeof fetchClaimBranches> | null = null;
  const read = new Map<string, ClaimBranchReading>();

  return (branch: string): ClaimBranchReading | null => {
    if (!pushed.has(branch)) return null;
    const kept = read.get(branch);
    if (kept !== undefined) return kept;

    fetched = fetched ?? fetchClaimBranches(git, template);
    const reading: ClaimBranchReading = fetched.ok
      ? readClaimBranch(git, branch, template)
      : { state: 'unreadable', branch, reason: fetched.reason };
    read.set(branch, reading);
    return reading;
  };
}

/** The claim `reading` names, weighed; see the module note's table. */
export function weighBranchClaim(reading: ClaimBranchReading | null, weights: ClaimWeights): BranchClaim {
  if (reading === null || reading.state === 'absent') return { state: 'none' };
  if (reading.state === 'unreadable') return { state: 'unreadable', reason: reading.reason };

  const { ownership, tipCommittedAt } = reading;
  if (ownership.state === 'none') return { state: 'none' };
  return readClaimState({ ownership, tipCommittedAt, ...weights });
}

/**
 * Whether a branch with claim `claim` keeps its issue taken: every claim
 * does but a released one, and a stale `rafa:claimed` one, which is
 * offered for a takeover instead.
 */
export function keepsTaken(claim: BranchClaim): boolean {
  return claim.state !== 'released' && claim.state !== 'stale-claimed';
}

const MS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;

/** How long a claim has stood idle, in the units `claims.staleAfter` is written in: `5d`, or `36h` under two days. */
export function idleText(idleMs: number): string {
  const hours = Math.floor(idleMs / MS_PER_HOUR);
  return hours < 2 * HOURS_PER_DAY
    ? `${String(hours)}h`
    : `${String(Math.floor(hours / HOURS_PER_DAY))}d`;
}
