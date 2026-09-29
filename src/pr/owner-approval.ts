/**
 * The owner gate reading: whether one pull request may be merged
 * unattended, given which boards own the paths it changes and who has
 * approved it (`.rafa/specs/rafa-247-rafa-next-roadmap.md`, "The owner
 * gate").
 *
 * It reads; it merges nothing and writes nothing. Refusing the merge on
 * its answer, and printing `waiting on #C (owner review)`, are the
 * callers'. The board listing is not read again here: the caller hands
 * in the boards a turn already read (`ownedBoard` in
 * `src/board/board-owns.ts`) and the CODEOWNERS file, or null.
 *
 * ## The five answers
 *
 * ```text
 * not-gated   every changed path's owning board is home, or shares home's owner
 * approved    every other owner resolves, and each has an authoritative approval
 * unresolved  an owner handle GitHub knows nothing of, or a board naming none
 * unknown     a reading failed: changed files, an owner, the reviews, a membership
 * waiting     everything was read, and some owner has not approved
 * ```
 *
 * Only `not-gated` and `approved` let a merge through. Every reading that
 * fails lands in `unknown` and never in `approved`, so an outage can hold
 * a merge back but can never let one through. When several owners answer
 * differently the most severe answer is the gate's, in the order
 * `unresolved`, `unknown`, `waiting`: a handle that does not resolve will
 * never approve, a failed reading might clear, and `waiting` claims the
 * most, that everything was read.
 *
 * ## Which paths are gated
 *
 * Each path of {@link PullRequests.changedFiles} is given to `owningBoard`
 * (CODEOWNERS' last match, else the deepest `Owns:` folder, else the
 * whole-repository board). A path is NOT gated when that board is home,
 * when its `Owner:` handle equals home's (compared case folded, as GitHub
 * compares handles), when neither board names an owner, or when no board
 * owns it. The last two are the light end of the range: two boards no one
 * gave an owner are one person's or one team's, and a path no board owns
 * asks no one's review on GitHub either. A board that names no owner
 * while home does has nobody who could approve, and answers `unresolved`.
 *
 * ## An authoritative approval
 *
 * The reviews are read once ({@link PullRequests.reviews}), and only when
 * every owner resolved. Each reviewer's LATEST review is theirs, latest by
 * `submittedAt`, the provider's order breaking a tie: an approval followed
 * by a comment-only review, a change request or a dismissal is no longer
 * an approval. This is stricter than GitHub's own review decision, which
 * lets an approval stand past a later comment, and the strict reading is
 * the one a gate for unattended work wants.
 *
 * - `@login` is approved when that login's latest review is `APPROVED`.
 * - `@org/team` is approved when some reviewer whose latest review is
 *   `APPROVED` is an ACTIVE member of the team. Membership is asked only
 *   of those reviewers, in the order each first reviewed, stopping at the
 *   first active one, through the {@link TeamMembershipReader} seam
 *   ({@link createGhTeamMembership} on `gh`). When none is active and one
 *   of the lookups failed, the owner is `unknown`, not `waiting`.
 *
 * ## The membership lookup
 *
 * `gh api orgs/<org>/teams/<slug>/memberships/<login>`
 * ({@link teamMembershipArgs}). Measured on 2026-09-28 with `gh` 2.100.0
 * against `open-tomato/maintainers`: a member exits 0 writing
 * `{"state":"active","role":"maintainer","url":…}`, and a login outside
 * the team exits 1 with `gh: Not Found (HTTP 404)` on stderr. GitHub
 * documents `pending` for an invitation not yet accepted; no pending
 * member was at hand to measure it, and it reads as not a member either
 * way, since only `active` is. Any other failure, an answer that is not
 * that JSON, and a login that is not one GitHub login (a bot's
 * `name[bot]`, say, which never enters an API path) are `unknown`.
 */
import type { PullRequestReview, PullRequests } from './types.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { OwnedBoard } from '../board/board-owns.js';
import type { Codeowners } from '../board/codeowners.js';
import type { OwnerResolver } from '../board/owner-resolve.js';

import { isOwnerHandle } from '../board/board-body.js';
import { owningBoard } from '../board/board-owns.js';

/** The state a review is in when it approves. */
export const APPROVED = 'APPROVED';

/** What a 404 from `gh api` carries on stderr. */
const NOT_FOUND = '(HTTP 404)';

/** What one team membership lookup answered; see the module note. */
export type TeamMembership =
  | { readonly state: 'active' }
  | { readonly state: 'pending' }
  | { readonly state: 'not-member' }
  | { readonly state: 'unknown'; readonly reason: string };

/** Answers whether `login` is a member of the team `@org/slug` names. */
export type TeamMembershipReader = (team: string, login: string) => Promise<TeamMembership>;

/** The owner of one or more gated boards. */
export interface GatedOwner {
  /** The `Owner:` handle as the lowest-numbered of its boards spells it; null when those boards name none. */
  readonly handle: string | null;
  /** The boards whose paths the pull request changes, lowest number first. */
  readonly boards: readonly number[];
}

/** One gated owner's approval: which login gave it. */
export interface OwnerApprovalGiven extends GatedOwner {
  /** The reviewer whose latest review is the approval. */
  readonly approvedBy: string;
}

/** What {@link readOwnerApproval} answers; see the module note. */
export type OwnerApproval =
  | { readonly state: 'not-gated' }
  | { readonly state: 'approved'; readonly owners: readonly OwnerApprovalGiven[] }
  | {
    readonly state: 'waiting' | 'unresolved' | 'unknown';
    /** Why it is not approved, one sentence naming the pull request and the owner. */
    readonly reason: string;
    /** Every gated owner; empty when the reading failed before owners were known. */
    readonly owners: readonly GatedOwner[];
  };

/** The five states an {@link OwnerApproval} can be in. */
export type OwnerApprovalState = OwnerApproval['state'];

/** What {@link readOwnerApproval} reads. */
export interface OwnerApprovalRequest {
  /** The pull request's number. */
  readonly pullRequest: number;
  /** The home board's issue number. */
  readonly home: number;
  /** Every board, as the turn's listing gave them. */
  readonly boards: readonly OwnedBoard[];
  /** The repository's CODEOWNERS file, or null when it has none. */
  readonly codeowners: Pick<Codeowners, 'rules'> | null;
}

/** What {@link readOwnerApproval} asks through. */
export interface OwnerApprovalSeams {
  readonly pullRequests: Pick<PullRequests, 'changedFiles' | 'reviews'>;
  /** Make one per command, as `createOwnerResolver` asks. */
  readonly resolveOwner: OwnerResolver;
  readonly membership: TeamMembershipReader;
}

/** A not-approved answer of the gate. */
type Blocked = Extract<OwnerApproval, { readonly reason: string }>;

/** Why one owner is not approved. */
interface Refusal {
  readonly state: Blocked['state'];
  readonly reason: string;
}

/** One owner's own answer, before the gate's is chosen. */
type OwnerAnswer = { readonly state: 'approved'; readonly approvedBy: string } | Refusal;

/** A gated owner whose boards name a handle. */
interface HandledOwner extends GatedOwner {
  readonly handle: string;
}

/** The not-approved states, most severe first. */
const SEVERITY: readonly Blocked['state'][] = Object.freeze(['unresolved', 'unknown', 'waiting'] as const);

/** The message of `error`, whatever was thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** `handle` case folded, or null. */
function folded(handle: string | null): string | null {
  return handle === null
    ? null
    : handle.toLowerCase();
}

/**
 * The `gh` arguments asking whether `login` is a member of `team`, an
 * `@org/slug` handle: `['api', 'orgs/<org>/teams/<slug>/memberships/<login>']`.
 * Null when `team` is not `@org/slug` or `login` is not one GitHub login.
 */
export function teamMembershipArgs(team: string, login: string): readonly string[] | null {
  const isTeam = isOwnerHandle(team) && team.includes('/');
  const isLogin = isOwnerHandle(`@${login}`) && !login.includes('/');
  if (!isTeam || !isLogin) return null;
  const [org = '', slug = ''] = team.slice(1).split('/');
  return ['api', `orgs/${org}/teams/${slug}/memberships/${login}`];
}

/** What a failed command wrote, for an `unknown` reason. Never empty. */
function failureReason(result: GhResult, command: string): string {
  const written = result.stderr.trim() || result.stdout.trim();
  return written === ''
    ? `${command} failed and wrote nothing`
    : `${command} failed: ${written}`;
}

/** The membership an exit-0 answer wrote, or `unknown` when it is not the measured JSON. */
function readMembership(stdout: string, command: string): TeamMembership {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { state: 'unknown', reason: `${command} wrote something that is not JSON` };
  }
  const state = typeof parsed === 'object' && parsed !== null
    ? (parsed as Record<string, unknown>)['state']
    : undefined;
  if (state === 'active' || state === 'pending') return { state };
  return { state: 'unknown', reason: `${command} answered membership state ${JSON.stringify(state) ?? 'undefined'}` };
}

/** A membership reader over `options.gh`: one command per lookup, uncached. */
export function createGhTeamMembership(options: { readonly gh: GhRunner }): TeamMembershipReader {
  const { gh } = options;
  return async (team: string, login: string): Promise<TeamMembership> => {
    const args = teamMembershipArgs(team, login);
    if (args === null) {
      return {
        state: 'unknown',
        reason: `${JSON.stringify(login)} in team ${JSON.stringify(team)} is not a login and a team handle, so nothing was asked`,
      };
    }
    const command = `gh ${args.join(' ')}`;
    const result = await gh(args);
    if (result.ok) return readMembership(result.stdout, command);
    return result.stderr.includes(NOT_FOUND)
      ? { state: 'not-member' }
      : { state: 'unknown', reason: failureReason(result, command) };
  };
}

/** `#<n>`. */
function ref(number: number): string {
  return `#${String(number)}`;
}

/** How an owner is named in a reason: its handle and its boards. */
function ownerName(owner: GatedOwner): string {
  const boards = owner.boards.map(ref).join(', ');
  const noun = owner.boards.length === 1
    ? 'board'
    : 'boards';
  return owner.handle === null
    ? `${noun} ${boards}`
    : `owner ${owner.handle} of ${noun} ${boards}`;
}

/**
 * The owners of the boards `paths` fall in that are neither home nor
 * share home's owner, grouped by handle, lowest board first. Null when
 * home is not among `boards` and some path is another board's.
 */
function gatedOwners(paths: readonly string[], request: OwnerApprovalRequest): readonly GatedOwner[] | null {
  const byNumber = new Map(request.boards.map((board) => [board.number, board]));
  const foreign = new Set<number>();
  for (const path of paths) {
    const owner = owningBoard(path, request.boards, request.codeowners);
    if (owner !== null && owner.board !== request.home) foreign.add(owner.board);
  }
  if (foreign.size === 0) return [];
  const home = byNumber.get(request.home);
  if (home === undefined) return null;

  const groups = new Map<string, { handle: string | null; boards: number[] }>();
  for (const number of [...foreign].sort((a, b) => a - b)) {
    const handle = byNumber.get(number)?.owner ?? null;
    if (folded(handle) === folded(home.owner)) continue;
    const key = folded(handle) ?? `board ${String(number)}`;
    const group = groups.get(key) ?? { handle, boards: [] };
    groups.set(key, { handle: group.handle, boards: [...group.boards, number] });
  }
  return [...groups.values()].map((group) => Object.freeze({ handle: group.handle, boards: Object.freeze(group.boards) }));
}

/** A frozen not-approved answer. */
function blocked(state: Blocked['state'], reason: string, owners: readonly GatedOwner[]): Blocked {
  return Object.freeze({ state, reason, owners: Object.freeze([...owners]) });
}

/** The most severe of `answers` not approved, or null when every one approved. */
function mostSevere(answers: readonly (OwnerAnswer | null)[]): Refusal | null {
  const refusals = answers.filter((answer): answer is Refusal => answer !== null && answer.state !== 'approved');
  for (const state of SEVERITY) {
    const found = refusals.find((refusal) => refusal.state === state);
    if (found !== undefined) return found;
  }
  return null;
}

/** Each reviewer's latest review, keyed by the login case folded; see the module note. */
function latestReviews(reviews: readonly PullRequestReview[]): ReadonlyMap<string, PullRequestReview> {
  const ordered = [...reviews].sort((a, b) => {
    const difference = Date.parse(a.submittedAt) - Date.parse(b.submittedAt);
    return Number.isNaN(difference)
      ? 0
      : difference;
  });
  return new Map(ordered.map((review) => [review.login.toLowerCase(), review]));
}

/** Why `owner` cannot be asked for an approval, or null when its handle resolves. */
async function resolutionRefusal(owner: GatedOwner, seams: OwnerApprovalSeams): Promise<Refusal | null> {
  const name = ownerName(owner);
  if (owner.handle === null) {
    return { state: 'unresolved', reason: `${name} names no Owner:, so nobody can approve its paths` };
  }
  const resolution = await seams.resolveOwner(owner.handle);
  if (resolution.state === 'unresolved') {
    return { state: 'unresolved', reason: `${name} does not resolve to an account or team GitHub knows` };
  }
  return resolution.state === 'unknown'
    ? { state: 'unknown', reason: `could not resolve ${name}: ${resolution.reason}` }
    : null;
}

/** Whether one owner, its handle resolved, has approved; see the module note. */
async function ownerApproval(
  owner: HandledOwner,
  latest: ReadonlyMap<string, PullRequestReview>,
  membership: TeamMembershipReader,
  pullRequest: number,
): Promise<OwnerAnswer> {
  const name = ownerName(owner);
  if (!owner.handle.includes('/')) {
    const review = latest.get(owner.handle.slice(1).toLowerCase());
    return review?.state === APPROVED
      ? { state: 'approved', approvedBy: review.login }
      : { state: 'waiting', reason: `${name} has not approved ${ref(pullRequest)}` };
  }

  const failures: string[] = [];
  for (const review of [...latest.values()].filter((latestReview) => latestReview.state === APPROVED)) {
    const answer = await membership(owner.handle, review.login);
    if (answer.state === 'active') return { state: 'approved', approvedBy: review.login };
    if (answer.state === 'unknown') failures.push(answer.reason);
  }
  return failures.length === 0
    ? { state: 'waiting', reason: `no active member of ${name} has approved ${ref(pullRequest)}` }
    : { state: 'unknown', reason: `could not tell whether ${name} approved ${ref(pullRequest)}: ${failures.join('; ')}` };
}

/** True when `owner`'s boards name a handle. */
function isHandled(owner: GatedOwner): owner is HandledOwner {
  return owner.handle !== null;
}

/**
 * The owner gate for `request.pullRequest` against home board
 * `request.home`, asked through `seams`; see the module note. Never
 * rejects: a reading that fails answers `unknown`.
 */
export async function readOwnerApproval(request: OwnerApprovalRequest, seams: OwnerApprovalSeams): Promise<OwnerApproval> {
  const pull = ref(request.pullRequest);
  let paths: readonly string[];
  try {
    paths = await seams.pullRequests.changedFiles(request.pullRequest);
  } catch (error) {
    return blocked('unknown', `could not read the changed files of ${pull}: ${messageOf(error)}`, []);
  }

  const owners = gatedOwners(paths, request);
  if (owners === null) {
    return blocked('unknown', `home board ${ref(request.home)} is not among the boards read, so its owner is unknown`, []);
  }
  if (owners.length === 0) return Object.freeze({ state: 'not-gated' });

  const unresolved = mostSevere(await Promise.all(owners.map((owner) => resolutionRefusal(owner, seams))));
  if (unresolved !== null) return blocked(unresolved.state, unresolved.reason, owners);

  let latest: ReadonlyMap<string, PullRequestReview>;
  try {
    latest = latestReviews(await seams.pullRequests.reviews(request.pullRequest));
  } catch (error) {
    return blocked('unknown', `could not read the reviews of ${pull}: ${messageOf(error)}`, owners);
  }

  const handled = owners.filter(isHandled);
  const answers = await Promise.all(handled.map((owner) => ownerApproval(owner, latest, seams.membership, request.pullRequest)));
  const refused = mostSevere(answers);
  if (refused !== null) return blocked(refused.state, refused.reason, owners);

  const given = handled.flatMap((owner, index) => {
    const answer = answers[index];
    return answer?.state === 'approved'
      ? [Object.freeze({ ...owner, approvedBy: answer.approvedBy })]
      : [];
  });
  return Object.freeze({ state: 'approved', owners: Object.freeze(given) });
}
