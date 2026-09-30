/**
 * Claim ahead: a `plan create` run that claims its issue, H, also
 * claims the next undone line of H's board, C, in the same step, so the
 * issue after this one is reserved before another device reaches it
 * (`.rafa/plans/rafa-324-claim-issue-so-two`, stage "Claim ahead").
 * `./plan-claim.ts` makes the pair; this module holds what it reads to
 * do so and the one push that lands both.
 *
 * ## When it runs
 *
 * Opt-in, off by default: `claims.ahead: allow`, or the run's own
 * `--claim-ahead` ({@link aheadEnabled}). It runs only for a request
 * that carries an {@link AheadRequest}, which is a run that walked a
 * board and so has a line after H to name; a run handed none (`--issue`,
 * `--spec`) claims H alone and says nothing about ahead.
 *
 * ## One ahead, never more
 *
 * The request names at most ONE candidate, matching #247's one-hop rule
 * (`src/next/hop-*.ts`): the next undone line after H, which
 * {@link nextUndoneLine} reads off the walk's lines. Undone is neither
 * ticked nor closed, and nothing more: a line another device has taken
 * is still the line ahead, so its claim is refused rather than stepped
 * over, and the pair is refused with it.
 *
 * ## Only on H's board
 *
 * Which boards a claim may reach across is #248's border value
 * (`allow | report | ask | refuse`), which does not exist yet. Until it
 * does, C is claimed only when it sits on the board H was picked from;
 * a C on another board, or one whose board or H's was not read, is NOT
 * claimed, and the run says so ({@link resolveAheadTarget}, cause
 * `other-board`). H is then claimed alone, as with claim ahead off.
 *
 * ## Both claims or neither
 *
 * The two claim commits go to the remote in one `git push --atomic`
 * ({@link pushClaimsAtomic}), each ref pushed as `./git.ts` pushes it
 * alone: a claim on a branch the remote does not hold WITHOUT force, so
 * the remote's refusal is the compare-and-set, and a take commit with
 * `--force-with-lease` on the tip it was made on. When either ref is
 * refused, git refuses the other with it and the remote keeps neither.
 * C's branch is named as `plan create --issue=<C>` would later name it
 * (`feat/` and `planStub`), so that run finds the claim already held.
 *
 * | Porcelain line of the refused ref | Answer |
 * |---|---|
 * | no lease, `[rejected] (fetch first)` or `(non-fast-forward)` | `refused`, `claimed` |
 * | lease, `[rejected] (stale info)` | `refused`, `moved` |
 * | every ref `*`, space, `+` or `=` | `pushed` |
 * | anything else, or no line | `failed` |
 *
 * ## What was measured
 *
 * On git 2.53.0 under Linux with `LC_ALL=C`, over a bare repository and
 * two clones (2026-09-30): an atomic pair whose second branch the other
 * clone had claimed wrote `!` and `[rejected] (fetch first)` for that
 * ref (`(non-fast-forward)` once fetched, `(stale info)` for a lease on
 * a tip that had moved), `!` and `[rejected] (atomic push failed)` for
 * the other, exit 1, and `ls-remote` listed neither; a pair with both
 * free wrote `*` `[new branch]` (a space and `<old>..<new>` for a lease
 * that matched) for each, exit 0, and wrote both remote-tracking refs
 * in the pushing clone; the same pair again wrote `=` `[up to date]`
 * for each, exit 0.
 */
import type { RoadmapLine, RoadmapReadings } from '../board/roadmap.js';
import type { ClaimsAhead } from '../config-sections.js';
import type { GitRunner } from '../pr/index.js';

import { planStub } from '../board/naming.js';
import { gitSaid } from '../pr/index.js';
import { branchNameFor, REMOTE } from '../start/branch-decision.js';

import { CLAIMED_REASONS, claimBranchIssue, LANDED_FLAGS, porcelainFor, STALE_LEASE } from './git.js';

/** The line ahead of the home issue, as the walk read it. */
export interface AheadCandidate {
  readonly issue: number;
  /** Its title, which its branch is named from. */
  readonly title: string;
  /** The board whose lines hold it, or null when that was not read. */
  readonly board: number | null;
  /** Its labels as read, or null when none were read. */
  readonly labels: readonly string[] | null;
}

/** What a run that walked a board hands the claim about the line ahead. */
export interface AheadRequest {
  /** True under `--claim-ahead`. */
  readonly flag: boolean;
  /** The board the home issue was picked from, or null when that was not read. */
  readonly homeBoard: number | null;
  /** The next undone line after the home issue, or null when there is none. */
  readonly candidate: AheadCandidate | null;
}

/** Why the line ahead was not claimed. */
export type AheadSkipCause = 'no-line' | 'other-board' | 'taken' | 'not-tried' | 'failed';

/** How a claimed line ahead came to be held. */
export type AheadVia = 'claim' | 'take' | 'held';

/** What claim ahead did with the line ahead; see the module note. */
export type AheadClaim =
  | {
    readonly outcome: 'claimed';
    readonly issue: number;
    readonly branch: string;
    readonly via: AheadVia;
  }
  | {
    readonly outcome: 'not-claimed';
    /** The line ahead, or null when there was none. */
    readonly issue: number | null;
    readonly cause: AheadSkipCause;
    readonly reason: string;
  };

/** The line ahead to claim, or the report of why it is not claimed. */
export type AheadTarget =
  | {
    readonly ok: true;
    readonly issue: number;
    readonly branch: string;
    readonly labels: readonly string[] | null;
  }
  | { readonly ok: false; readonly report: AheadClaim };

/** One ref of an atomic push: the claim commit and the lease, or null to push without force. */
export interface AtomicClaimRef {
  readonly branch: string;
  readonly sha: string;
  readonly lease: string | null;
}

/** What {@link pushClaimsAtomic} answered. */
export type AtomicClaimPush =
  /** Every ref now points at its pushed commit. */
  | { readonly outcome: 'pushed' }
  /** The remote refused `branch`, and so every ref: it holds another claim, or it moved since the lease. */
  | { readonly outcome: 'refused'; readonly branch: string; readonly by: 'claimed' | 'moved' }
  /** Anything else git refused or could not do, or the push was not tried. */
  | { readonly outcome: 'failed'; readonly reason: string };

/** A full object name, SHA-1 or SHA-256. */
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** True when `claims.ahead` is `allow` or the run said `--claim-ahead`. */
export function aheadEnabled(setting: ClaimsAhead, flag: boolean): boolean {
  return setting === 'allow' || flag;
}

/** The not-claimed report for the line ahead `issue`. */
export function aheadNotClaimed(issue: number | null, cause: AheadSkipCause, reason: string): AheadClaim {
  return { outcome: 'not-claimed', issue, cause, reason };
}

/**
 * The first line after `home`'s in `lines` that is neither ticked nor
 * closed, or null when `home` is not among them or nothing after it is
 * undone. A taken line is undone; see the module note.
 */
export async function nextUndoneLine(
  lines: readonly RoadmapLine[],
  home: number,
  readings: Pick<RoadmapReadings, 'isClosed'>,
): Promise<RoadmapLine | null> {
  const at = lines.findIndex((line) => line.issue === home);
  if (at === -1) return null;
  for (const line of lines.slice(at + 1)) {
    if (line.issue === home || line.ticked) continue;
    if (!await readings.isClosed(line.issue)) return line;
  }
  return null;
}

/** `#<n>`. */
function numbered(issue: number): string {
  return `#${String(issue)}`;
}

/** Why a C whose board is not H's is not claimed, naming both boards as far as they were read. */
function otherBoardReason(candidate: AheadCandidate, homeBoard: number | null, home: number): string {
  const where = candidate.board === null
    ? 'its board was not read'
    : `it is on board ${numbered(candidate.board)}`;
  const homeWhere = homeBoard === null
    ? `the board of ${numbered(home)} was not read`
    : `${numbered(home)} is on board ${numbered(homeBoard)}`;
  return `${numbered(candidate.issue)}, the line ahead, was not claimed: ${where} and ${homeWhere};`
    + ' claiming across boards waits on the border setting (#248)';
}

/**
 * The line ahead to claim for home issue `home`, or the report of why
 * none is: no line ahead, the home issue itself, or a line on another
 * board. See the module note's "Only on H's board".
 */
export function resolveAheadTarget(request: AheadRequest, home: number): AheadTarget {
  const { candidate, homeBoard } = request;
  if (candidate === null || candidate.issue === home) {
    const reason = `no undone line follows ${numbered(home)} on its board, so there is nothing to claim ahead`;
    return { ok: false, report: aheadNotClaimed(null, 'no-line', reason) };
  }
  if (homeBoard === null || candidate.board !== homeBoard) {
    return { ok: false, report: aheadNotClaimed(candidate.issue, 'other-board', otherBoardReason(candidate, homeBoard, home)) };
  }
  const branch = branchNameFor(planStub(candidate.issue, candidate.title));
  return { ok: true, issue: candidate.issue, branch, labels: candidate.labels };
}

/** Why `refs` cannot be pushed as given, or null when they can; a ref here is the caller's to get right. */
function refProblem(refs: readonly AtomicClaimRef[]): string | null {
  if (refs.length === 0) return 'no ref to push';
  if (new Set(refs.map((ref) => ref.branch)).size !== refs.length) return 'one branch named twice';
  for (const { branch, sha, lease } of refs) {
    if (claimBranchIssue(branch) === null) return `${JSON.stringify(branch)} is not a claim branch`;
    if (!FULL_SHA.test(sha) || (lease !== null && !FULL_SHA.test(lease))) return `a sha for ${branch} is not a full sha`;
  }
  return null;
}

/** The first leased ref whose pushed commit does not descend from its lease, as a refusal, or null. */
function droppedWork(git: GitRunner, refs: readonly AtomicClaimRef[]): string | null {
  for (const { branch, sha, lease } of refs) {
    if (lease === null) continue;
    const ancestry = git(['merge-base', '--is-ancestor', lease, sha]);
    if (!ancestry.ok) return `${sha} does not descend from ${lease}, so pushing it would drop commits from ${branch}`;
  }
  return null;
}

/** The ref git refused on its own account, and why, or null when none was; see the module note's table. */
function refusedRef(stdout: string, refs: readonly AtomicClaimRef[]): AtomicClaimPush | null {
  for (const { branch, lease } of refs) {
    const line = porcelainFor(stdout, `refs/heads/${branch}`);
    if (line?.flag !== '!') continue;
    if (lease === null && CLAIMED_REASONS.includes(line.summary)) return { outcome: 'refused', branch, by: 'claimed' };
    if (lease !== null && line.summary === STALE_LEASE) return { outcome: 'refused', branch, by: 'moved' };
  }
  return null;
}

/**
 * Pushes every ref of `refs` in ONE `git push --atomic`: each without
 * force when its lease is null, else with `--force-with-lease` on it.
 * Answers `pushed` only when every ref landed; see the module note.
 * Refuses without pushing when a ref names no claim branch, a sha is
 * not a full sha, a branch is named twice, or a pushed commit does not
 * descend from its lease, since work commits never leave a branch.
 */
export function pushClaimsAtomic(git: GitRunner, refs: readonly AtomicClaimRef[]): AtomicClaimPush {
  const problem = refProblem(refs) ?? droppedWork(git, refs);
  if (problem !== null) return { outcome: 'failed', reason: problem };

  const leases = refs.flatMap(({ branch, lease }) => lease === null
    ? []
    : [`--force-with-lease=refs/heads/${branch}:${lease}`]);
  const specs = refs.map(({ branch, sha }) => `${sha}:refs/heads/${branch}`);
  const pushed = git(['push', '--atomic', '--porcelain', ...leases, REMOTE, ...specs]);
  const landed = refs.every(({ branch }) => {
    const line = porcelainFor(pushed.stdout, `refs/heads/${branch}`);
    return line !== null && LANDED_FLAGS.includes(line.flag);
  });
  if (pushed.ok && landed) return { outcome: 'pushed' };
  const names = refs.map((ref) => ref.branch).join(' and ');
  return refusedRef(pushed.stdout, refs)
    ?? { outcome: 'failed', reason: `could not push ${names} to ${REMOTE}: ${gitSaid(pushed)}` };
}

/** The line a run prints for a claimed line ahead. */
export function aheadClaimedLine(ahead: Extract<AheadClaim, { outcome: 'claimed' }>): string {
  const issue = numbered(ahead.issue);
  return ahead.via === 'held'
    ? `🔒 ${issue}, the line ahead, is already claimed by this device on ${ahead.branch}.`
    : `🔒 Claimed ${issue}, the line ahead, on ${ahead.branch}.`;
}

/** The warning a run prints for a line ahead it did not claim. */
export function aheadNotClaimedWarning(ahead: Extract<AheadClaim, { outcome: 'not-claimed' }>): string {
  return `⚠️  Claim ahead: ${ahead.reason}`;
}
