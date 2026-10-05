/**
 * The pull request port: what every pull request provider answers, and
 * the record shapes it answers with.
 *
 * Until this port, the wrap-up stage reached `gh` directly through
 * `src/utils/pr.ts` — deleted now — so the only way to hold a caller to
 * a behaviour was to run `gh`. This port is the seam that replaced it:
 * an adapter over the GitHub CLI implements it, a second provider later
 * is another adapter, and a caller typed against {@link PullRequests}
 * names neither.
 *
 * ## What the port owes, and what it leaves out
 *
 *   - Every member answers a promise, because the `gh` adapter spawns a
 *     process for each one. A provider that could answer synchronously
 *     still answers a resolved promise rather than widening the port.
 *   - A pull request a READ is looking for and does not find is `null`,
 *     never a throw: the current branch having no open PR is the
 *     ordinary first case of `pr current`, not a failure. A provider
 *     that could not be ASKED — no network, no authentication, a command
 *     that did not run — throws, so an outage never reads as an empty
 *     repository. A WRITE is the other way round
 *     ({@link PullRequests.editBody}): it was handed the pull request to
 *     act on rather than discovering it, so a number nothing answers for
 *     throws there. {@link PullRequests.changedFiles} and
 *     {@link PullRequests.reviews} throw on an absent pull request too:
 *     their caller, the owner gate, was handed the number it reads, and
 *     an empty list would read as "touches nothing" or "nobody has
 *     reviewed" where the truth is "could not be read".
 *     {@link PullRequests.workflowCount} is the one read
 *     that answers null on ANY failure rather than throwing: its null is
 *     not an empty answer but the riskier one, read by the caller the
 *     same as "workflows exist", so an outage cannot pass for "this
 *     repository has no workflow" and a throw would buy nothing.
 *   - The states GitHub spells in its own words are narrowed here
 *     ({@link PullRequestState}, {@link Mergeability}) so a caller
 *     switches on a closed set, while the words that have no closed set
 *     worth inventing — `mergeStateStatus`, a check's `state` — stay
 *     verbatim on the record, because an unrecognised one has to stay
 *     reportable rather than be flattened into a wrong verdict. That is
 *     the same rule {@link CheckRow} already keeps for check states.
 *   - The check-row readers are NOT the port's. `parseChecks`,
 *     `verdictOf` and `waitForChecks` in `./checks.js` are pure, they
 *     work on any provider's rows, and a provider re-implementing them
 *     could disagree with the wrap-up gate about what green means. The
 *     port answers rows and the verdict over them ({@link ChecksReading});
 *     the waiting is done by the caller around {@link PullRequests.checks}.
 *   - There is no `close`, and nothing is cached. Each call asks the
 *     provider, because a triage that acted on a stale reading would act
 *     on a pull request that has already moved.
 *
 * ## Why the members are function-typed properties
 *
 * TypeScript compares a method signature's parameters bivariantly and a
 * function-typed property's contravariantly, so only the property
 * spelling refuses an adapter that narrows a parameter. `merge` is the
 * member that makes this matter: an adapter implementing
 * `merge(n: number, method: 'squash')` would compile against a method
 * signature and then be handed `'rebase'` by a caller reading
 * `pr.mergeMethod` out of the config. Measured in `types.test.ts`, which
 * holds that refusal (TS2322) and, as its control, the same port spelled
 * with method signatures accepting the same adapter. The store port
 * (`src/effort/store/types.ts`) is spelled this way for the same reason.
 */
import type { CheckRow, ChecksVerdict } from './checks.js';

export type { CheckRow, ChecksVerdict } from './checks.js';

/**
 * How a merge is made. GitHub's three, and no other: `gh pr merge`
 * takes exactly `--squash`, `--merge` and `--rebase`, and a provider
 * that cannot do one of them refuses the call rather than substituting
 * another, which would rewrite history the operator did not ask for.
 */
export type MergeMethod = 'squash' | 'merge' | 'rebase';

/**
 * The merge methods, in the order a refusal lists them.
 *
 * A runtime value beside the type so the config reader and the
 * `--method` flag validate against one list rather than each spelling
 * the three words again. Frozen: a caller that pushed onto it would
 * change what every later refusal says it accepts.
 */
export const MERGE_METHODS: readonly MergeMethod[] = Object.freeze([
  'squash',
  'merge',
  'rebase',
] as const);

/** Whether a value is one of {@link MERGE_METHODS}. */
export function isMergeMethod(value: unknown): value is MergeMethod {
  return typeof value === 'string'
    && (MERGE_METHODS as readonly string[]).includes(value);
}

/**
 * Where a pull request stands. `merged` is its own member rather than a
 * flag on `closed`: a merged PR and an abandoned one are the same state
 * to GitHub's `closed` and opposite answers to every caller here.
 */
export type PullRequestState = 'open' | 'closed' | 'merged';

/**
 * Whether the head merges into the base.
 *
 * `unknown` is GitHub's own answer while it computes the merge commit,
 * and it is kept rather than resolved to a guess: a caller waits or
 * reports it, and `merge` refuses on it, where treating it as mergeable
 * would send a merge GitHub is about to refuse anyway.
 */
export type Mergeability = 'mergeable' | 'conflicting' | 'unknown';

/** Who opened a pull request, or wrote a comment on it. */
export interface PullRequestAuthor {
  /** The account's login, as trust and the dependabot rule read it. */
  readonly login: string;
  /** True for a bot account, which `dependabot[bot]` is. */
  readonly isBot: boolean;
}

/**
 * One pull request as a list answers it: enough for a line of `pr list`
 * or `pr current`, and for choosing which PR an action acts on.
 */
export interface PullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: PullRequestState;
  /** The branch the PR is FROM, which is the branch a caller matches on. */
  readonly headRefName: string;
  /** The branch the PR is INTO. */
  readonly baseRefName: string;
  readonly author: PullRequestAuthor;
  /**
   * True when the head is on a fork. Such a PR cannot be checked out
   * into a worktree of this repository, so `triage --resolve` refuses it.
   */
  readonly isCrossRepository: boolean;
  /** When the PR last moved, ISO 8601, as the 72-hour selection rule reads it. */
  readonly updatedAt: string;
}

/**
 * One issue a pull request closes when it merges, as the provider links
 * the two.
 *
 * The provider's link, not the body's words: on GitHub it is
 * `closingIssuesReferences`, which holds the issues a closing keyword in
 * the body names (measured on `open-tomato/rafa#763`, whose sixteen
 * `Closes #<n>` lines are its sixteen references) and, by GitHub's
 * documentation, the ones linked by hand from the pull request's
 * Development panel — so it can hold an issue the body never mentions.
 * Reading the body's keywords is `closedIssuesIn` in
 * `src/board/roadmap.ts`, a separate reading a caller compares this one
 * with.
 *
 * An issue can live in another repository — `GoogleCloudPlatform/scion#2453`
 * closes eight issues of the fork `ptone/scion` — so
 * {@link ClosingIssue.repository} is always written, and a caller that
 * matches on {@link ClosingIssue.number} alone checks the repository
 * first.
 */
export interface ClosingIssue {
  /** The issue's number in its own repository. */
  readonly number: number;
  /** The issue's repository, `owner/name`. */
  readonly repository: string;
  /** The issue's own URL. */
  readonly url: string;
}

/**
 * One pull request in full: the summary widened with what only a
 * per-PR read answers.
 */
export interface PullRequestDetail extends PullRequestSummary {
  /** The PR body. Empty string when it has none, never null. */
  readonly body: string;
  /** The head commit, which a triage comment is pinned to. */
  readonly headRefOid: string;
  readonly mergeable: Mergeability;
  /**
   * GitHub's `mergeStateStatus` verbatim — `CLEAN`, `BLOCKED`, `DIRTY`,
   * `BEHIND`, `UNKNOWN` and whatever it adds next. Kept unnarrowed so a
   * refusal can name the word GitHub used.
   */
  readonly mergeStateStatus: string;
  /** Label names, as the readiness gate and triage read them. */
  readonly labels: readonly string[];
  /**
   * The issues the PR closes on merge, in the provider's order — on
   * `gh`, issue number ascending, not the order the body names them in
   * (`open-tomato/rafa#763`). Empty when it closes none.
   */
  readonly closes: readonly ClosingIssue[];
}

/**
 * One merged pull request, as {@link PullRequests.listMerged} answers it:
 * which head was merged, at which commit, and when.
 *
 * Only what telling a local branch's fate needs. `headRefOid` is the head
 * commit the pull request was merged AT, which a squash merge leaves
 * unreachable from the base, so a caller compares it with a local tip
 * rather than asking git whether the branch is merged.
 */
export interface MergedPullRequest {
  readonly number: number;
  /** The branch the PR was FROM. Still answered after the branch is deleted. */
  readonly headRefName: string;
  /** The head commit when the PR was merged. */
  readonly headRefOid: string;
  /** When the PR was merged, ISO 8601. Never null: the PR is merged. */
  readonly mergedAt: string;
}

/** A PR's checks, and the one verdict over them. */
export interface ChecksReading {
  readonly rows: readonly CheckRow[];
  /** `none` when the PR has no checks at all, which a conflict produces. */
  readonly verdict: ChecksVerdict;
}

/**
 * One comment on a pull request — the shape the triage marker comment is
 * read back from and edited through.
 */
export interface PullRequestComment {
  /** The provider's own id, which {@link PullRequests.editComment} takes. */
  readonly id: string;
  readonly author: PullRequestAuthor;
  readonly body: string;
  /** ISO 8601. A rerun reports when the comment it found was written. */
  readonly updatedAt: string;
  /** The comment's own URL, for the line that points at it. */
  readonly url: string;
}

/**
 * One review submitted on a pull request, as the owner gate reads it:
 * who reviewed, what they said, and when.
 *
 * Only what telling "the latest review of this login" and whether it
 * approves needs; the review's body, comments and commit are not
 * answered.
 */
export interface PullRequestReview {
  /** The reviewer's login. */
  readonly login: string;
  /**
   * GitHub's review state verbatim — `APPROVED`, `CHANGES_REQUESTED`,
   * `COMMENTED`, `DISMISSED` and whatever it adds next. Kept unnarrowed,
   * as `mergeStateStatus` is, so a caller compares it with `APPROVED`
   * and an unrecognised word is simply not an approval.
   */
  readonly state: string;
  /** When the review was submitted, ISO 8601. */
  readonly submittedAt: string;
}

/**
 * A pull request to open, as {@link PullRequests.create} takes it.
 *
 * The head is a branch already pushed to the repository the provider
 * resolves: opening one never pushes, forks or asks where to push, so
 * the branch and its commit are the caller's to have put there first.
 */
export interface PullRequestDraft {
  /** The branch the PR is FROM, already on the remote. */
  readonly head: string;
  /** The branch the PR is INTO. */
  readonly base: string;
  readonly title: string;
  /** The PR body. An empty one is a body, and opens a PR with none. */
  readonly body: string;
}

/**
 * What a merge did.
 *
 * `merged` false is a merge the provider REFUSED — not green, not
 * mergeable, a protected base — and `detail` is what it said, so the
 * caller prints the provider's reason rather than a guess. A merge that
 * could not be attempted at all throws instead, because the clean-up
 * that follows a merge must never run on an unread outcome.
 */
export interface MergeOutcome {
  readonly merged: boolean;
  /** Non-empty either way: what the provider reported. */
  readonly detail: string;
}

/**
 * A pull request provider.
 *
 * Every member is a function-typed property, for the reason in the
 * module note. Nothing here touches git: switching branches, pulling and
 * deleting branches after a merge are the merge command's own steps, so
 * a provider is only ever the remote half.
 */
export interface PullRequests {
  /** The provider's name, as a refusal and `doctor` spell it. */
  readonly kind: 'gh';
  /**
   * The open PR whose head is this branch, or null when there is none.
   * The first of several, when a branch somehow has more than one.
   */
  findOpen: (branch: string) => Promise<PullRequestSummary | null>;
  /** Every open PR, newest first. */
  list: () => Promise<readonly PullRequestSummary[]>;
  /**
   * The most recent merged PRs, newest CREATED first — not newest merged,
   * which is `gh`'s own order — up to a fixed limit the provider names.
   * A merged PR past that limit is not answered, so an absent head is
   * "not among the recent merges" and never "never merged".
   */
  listMerged: () => Promise<readonly MergedPullRequest[]>;
  /** One PR in full, or null when the repository has no such PR. */
  get: (number: number) => Promise<PullRequestDetail | null>;
  /** The PR's checks now. One poll: the waiting is the caller's. */
  checks: (number: number) => Promise<ChecksReading>;
  /**
   * The paths the PR changes, in the provider's order.
   *
   * The WHOLE list or a throw, never a part of it: a list short of the
   * PR's own changed-file count throws, because an owner gate reading
   * a partial list could find every path it saw at home and let through
   * a path it never saw. An absent PR throws too; see the module note.
   */
  changedFiles: (number: number) => Promise<readonly string[]>;
  /**
   * Every review submitted on the PR, in the provider's order, oldest
   * first on `gh`. Throws when the provider could not be asked or the PR
   * is absent, so a failed read never passes for "no reviews".
   */
  reviews: (number: number) => Promise<readonly PullRequestReview[]>;
  /** Opens the PR in a browser. */
  browse: (number: number) => Promise<void>;
  /** Merges the PR, or answers why the provider would not. */
  merge: (number: number, method: MergeMethod) => Promise<MergeOutcome>;
  /**
   * Opens a PR from `draft.head` into `draft.base`, answering it as
   * opened.
   *
   * A WRITE, so every failure throws — a head with a PR already open
   * into that base among them, since answering the one already there
   * would hide that the caller did not look first. The head must
   * already be pushed; see {@link PullRequestDraft}.
   */
  create: (draft: PullRequestDraft) => Promise<PullRequestSummary>;
  /**
   * Replaces the PR's title and answers nothing. An absent PR throws,
   * for the reason {@link PullRequests.editBody} gives.
   */
  editTitle: (number: number, title: string) => Promise<void>;
  /**
   * Retargets the PR onto the branch `base` and answers nothing. An
   * absent PR throws, for the reason {@link PullRequests.editBody}
   * gives; nothing reads back what the edit wrote, so a caller that
   * needs the new {@link PullRequestSummary.baseRefName} reads the PR
   * again.
   */
  editBase: (number: number, base: string) => Promise<void>;
  /**
   * Replaces the PR's own body — the description above the
   * conversation, not a comment under it — and answers nothing.
   *
   * The body is written WHOLE, because a provider has no way to append
   * one: the text to keep is what {@link PullRequests.get} already
   * answered, and composing the new body out of it is the caller's.
   *
   * A pull request that is absent THROWS here, where
   * {@link PullRequests.get} answers null. A caller writing a body has
   * already chosen which pull request it is writing to, so a number
   * nothing answers for is a fault, and an edit that silently wrote
   * nowhere would lose the sentence it was carrying.
   */
  editBody: (number: number, body: string) => Promise<void>;
  /** Every comment on the PR, oldest first. */
  comments: (number: number) => Promise<readonly PullRequestComment[]>;
  /** Posts a comment, answering the comment as posted. */
  comment: (number: number, body: string) => Promise<PullRequestComment>;
  /**
   * Replaces a comment's body, answering it as edited. One triage
   * comment per PR, with its history in that comment's edits, is what
   * this member is for.
   */
  editComment: (id: string, body: string) => Promise<PullRequestComment>;
  /**
   * The failing log of one CI run, as the evidence a triage quotes.
   * Empty string when the provider has no log for it.
   */
  failedLog: (runId: string) => Promise<string>;
  /**
   * How many workflows the repository holds, or null when that could not
   * be read.
   *
   * Zero is the one answer that means "nothing on the provider tests a
   * pull request here". Null — a denied read, a missing repository, an
   * outage, a payload that carries no count — must be read by the caller
   * as the riskier case, workflows existing, and never as zero: a check
   * that has not reported is ambiguous exactly when a workflow could
   * still report it. The count is the whole repository's, not one page
   * of it.
   */
  workflowCount: () => Promise<number | null>;
}
