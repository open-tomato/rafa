/**
 * The claims section of `rafa status`: each claim branch on the remote,
 * with the store that owns its claim, the stage label on its issue and
 * its stale state (`.rafa/plans/rafa-324-claim-issue-so-two`). The
 * reader lives here, and `./sections.ts` only wires it in.
 *
 * ## What is read, and what is not
 *
 * The claim branches are the `refs/remotes/origin/feat/rafa-*` refs AS
 * LAST FETCHED: {@link readClaimBranches} lists them with one
 * `for-each-ref` and reads each with `readClaimBranch`
 * (`src/claims/git.ts`), which reads the remote-tracking ref and runs
 * no fetch. `rafa status` fetches nothing, so this is a local reading,
 * read with the branch and the loops before any `gh` is spawned. What
 * moves those refs is the claim commands, `plan create`'s and
 * `loop start`'s claim pushes, and the fetch a refused wrap-up push runs
 * (`src/claims/lost.ts`), so a clone that lost its claim reads the new
 * owner here. A claim commit waiting on a LOCAL branch with no upstream
 * is not a claim yet and is not listed.
 *
 * A branch that carries no ownership commit is no claim and is passed
 * over: it stays taken as a branch does, which is not this section's
 * to say. A branch git cannot read is a note, and the others are listed.
 *
 * ## The row
 *
 * | Field | From |
 * |---|---|
 * | `owner` | the store the latest ownership commit names, null once released |
 * | `handingTo` | a pending handover's receiver, null when none is pending |
 * | `releasedBy` | the store that released it, null while held |
 * | `stage` | the stage labels on the issue, `rafa:claimed` and `rafa:in-development`; null when they were not read |
 * | `state` | `readClaimState` (`src/claims/stale.ts`) over the ownership, the tip's committer date, the labels, `claims.staleAfter` and the clock |
 * | `idleMs` | the clock less the tip's committer date, never below 0 |
 *
 * ## The labels
 *
 * The stage labels come from the board listing `./sections.ts` already
 * reads once for the board section (`gh issue list --state all`), so
 * this section costs no `gh` command of its own. They are read under the
 * network deadline, and a listing that failed, timed out, or a provider
 * that is not `gh` leaves every `stage` null, with one note saying why;
 * an issue the listing does not hold leaves its own `stage` null, named
 * in a note too. Labels that were not read are passed to
 * `readClaimState` as none, which reads a stale claim as in development,
 * as `rafa claim take` does: a label that could not be read never makes
 * a claim a takeover candidate.
 */
import type { BoardIssue } from '../board/roadmap-board.js';
import type { ClaimBranchReading } from '../claims/git.js';
import type { ClaimOwnership, ClaimStateName } from '../claims/stale.js';
import type { ClaimsStaleAfter } from '../config-sections.js';
import type { GitRunner } from '../pr/index.js';

import { claimBranchIssue, readClaimBranch } from '../claims/git.js';
import { STAGE_LABELS } from '../claims/labels.js';
import { readClaimState } from '../claims/stale.js';
import { gitSaid } from '../pr/index.js';
import { BRANCH_PREFIX, REMOTE } from '../start/branch-decision.js';

/** One claim branch as `rafa status` shows it; see the module note's table. */
export interface ClaimRow {
  /** The branch, `feat/rafa-<n>-<slug>`. */
  readonly branch: string;
  /** The issue the branch claims. */
  readonly issue: number;
  /** The store that owns the claim, or null once it was released. */
  readonly owner: string | null;
  /** The store a pending handover is offered to, or null. */
  readonly handingTo: string | null;
  /** The store that released the claim, or null while it is held. */
  readonly releasedBy: string | null;
  /** The stage labels on the issue, in `STAGE_LABELS` order, or null when they were not read. */
  readonly stage: readonly string[] | null;
  /** Whether the claim stands, as `readClaimState` answers it. */
  readonly state: ClaimStateName;
  /** The committer date of the branch's tip on the remote, ISO 8601. */
  readonly tipCommittedAt: string;
  /** How long the tip has stood, in milliseconds. */
  readonly idleMs: number;
}

/** The claims section's reading. */
export interface ClaimsReading {
  /** Every claim branch on the remote as last fetched, in branch name order. */
  readonly claims: readonly ClaimRow[];
  /** What was read around: a branch not read, stage labels not read. */
  readonly notes: readonly string[];
}

/** A claim branch found carrying at least one ownership commit. */
export type FoundClaim = Extract<ClaimBranchReading, { readonly state: 'found' }> & { readonly ownership: ClaimOwnership };

/** What {@link readClaimBranches} read: the claim branches, and the ones it could not. */
export interface ClaimBranches {
  readonly found: readonly FoundClaim[];
  readonly notes: readonly string[];
}

/** The board listing's issues, or why they were not read. */
export type ClaimLabels =
  | { readonly read: true; readonly issues: readonly BoardIssue[] }
  | { readonly read: false; readonly problem: string };

/** What {@link readClaims} weighs the branches against. */
export interface ClaimsInput {
  readonly branches: ClaimBranches;
  readonly labels: ClaimLabels;
  /** `claims.staleAfter`, as the config holds it. */
  readonly staleAfter: ClaimsStaleAfter;
  /** The clock the idle time is read against. */
  readonly now: Date;
}

/**
 * Every claim branch on the remote as last fetched, read with no fetch;
 * see the module note. Throws, with what git said, when the remote
 * branches cannot be listed.
 */
export function readClaimBranches(git: GitRunner): ClaimBranches {
  const listed = git(['for-each-ref', '--format=%(refname:lstrip=3)', `refs/remotes/${REMOTE}/${BRANCH_PREFIX}`]);
  if (!listed.ok) throw new Error(`the ${REMOTE} branches could not be listed: ${gitSaid(listed)}`);
  const branches = listed.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((name) => name !== '' && claimBranchIssue(name) !== null)
    .sort();
  let found: readonly FoundClaim[] = [];
  let notes: readonly string[] = [];
  for (const branch of branches) {
    const reading = readClaimBranch(git, branch);
    if (reading.state === 'unreadable') notes = [...notes, `the claim on ${branch} could not be read: ${reading.reason}`];
    if (isClaim(reading)) found = [...found, reading];
  }
  return { found, notes };
}

/** True for a branch found carrying an ownership commit: a claim, held or released. */
function isClaim(reading: ClaimBranchReading): reading is FoundClaim {
  return reading.state === 'found' && reading.ownership.state !== 'none';
}

/** The stage labels among `labels`, in `STAGE_LABELS` order. */
function stageOf(labels: readonly string[]): readonly string[] {
  return STAGE_LABELS.filter((label) => labels.includes(label));
}

/** The labels of `issue` in `labels`, or null when they were not read or the listing lacks it. */
function labelsOf(labels: ClaimLabels, issue: number): readonly string[] | null {
  if (!labels.read) return null;
  return labels.issues.find((one) => one.number === issue)?.labels ?? null;
}

/** One row for `reading`, weighed under `input`; see the module note. */
function rowOf(reading: FoundClaim, input: ClaimsInput): ClaimRow {
  const { ownership, tipCommittedAt, branch } = reading;
  const issue = claimBranchIssue(branch) ?? 0;
  const labels = labelsOf(input.labels, issue);
  const state = readClaimState({ ownership, tipCommittedAt, labels: labels ?? [], staleAfter: input.staleAfter, now: input.now });
  const elapsed = input.now.getTime() - tipCommittedAt.getTime();
  return {
    branch,
    issue,
    owner: ownership.state === 'held'
      ? ownership.owner
      : null,
    handingTo: ownership.state === 'held'
      ? ownership.pending?.to ?? null
      : null,
    releasedBy: ownership.state === 'released'
      ? ownership.releasedBy
      : null,
    stage: labels === null
      ? null
      : stageOf(labels),
    state: state.state,
    tipCommittedAt: tipCommittedAt.toISOString(),
    idleMs: Number.isFinite(elapsed)
      ? Math.max(0, elapsed)
      : 0,
  };
}

/** Why the stage labels of `rows` were not read, one note each; none when they all were. */
function labelNotes(rows: readonly ClaimRow[], labels: ClaimLabels): readonly string[] {
  if (rows.length === 0) return [];
  if (!labels.read) return [`the stage labels were not read: ${labels.problem}`];
  return rows
    .filter((row) => row.stage === null)
    .map((row) => `#${String(row.issue)} is not in the board listing, so its stage labels were not read`);
}

/** The claims section's reading of `input`; see the module note. */
export function readClaims(input: ClaimsInput): ClaimsReading {
  const claims = input.branches.found.map((reading) => rowOf(reading, input));
  return { claims, notes: [...input.branches.notes, ...labelNotes(claims, input.labels)] };
}
