/**
 * The board side of `rafa plan create`: the seams `./spec-source.ts`
 * needs, built for one project, and the checks that run between an issue
 * being read and its body being written down.
 *
 * `src/plan.ts` builds the prompt and runs the planner session, and
 * `src/commands/plan/spec-route.ts` is the route it resolves through.
 * What neither must also carry is the wiring: which runner reads the
 * board, which readings answer "taken", which checks a route runs and
 * what the readiness gate then publishes on. That is this module, and
 * `spec-route.ts` is its one caller
 * (`.rafa/specs/rafa-20-pr-commands.md`, `context/cli.md`).
 *
 * ```text
 * spec-route.ts   readSpecSourceFlags(argv)      the words
 *    │
 *    └─► resolvePlanSpec                   the seams, and the checks
 *           └─► resolveSpecSource          the route (./spec-source.ts)
 *                  ├─► createGhSpecIssueReader     gh issue view
 *                  ├─► inspectSpecIssue            the checks below
 *                  └─► settleSpecSnapshot          <specs.dir>/rafa-<n>-<slug>.md
 * ```
 *
 * The two runners are made LAZILY in the sense that matters: making one
 * spawns nothing (`createGhRunner`, `createGitRunner` answer functions),
 * and the `--spec=<file>` route calls neither. So a run that plans from a
 * file needs no `gh` on the PATH and no network, exactly as it did before
 * the board routes existed, and `src/plan.test.ts` — whose child PATH
 * carries no `gh` — proves it: every `--spec` case there is green with
 * this module wired in.
 *
 * Both are seams anyway ({@link PlanSpecOptions.gh},
 * {@link PlanSpecOptions.git}), so `./plan-spec.test.ts` drives fakes and
 * no case here reaches GitHub, spawns `gh` or `git`, or reads the
 * configuration `gh` keeps under the home.
 *
 * ## Which checks run, in the order they run
 *
 * The readiness gate is five checks, cheapest first
 * (`.rafa/specs/rafa-20-pr-commands.md`, and check 4 from
 * `.rafa/specs/rafa-151-references-specs-bugs-are.md`).
 * {@link inspectSpecIssue} is the three of them that run on the issue
 * as read, in the spec's order, and each is a refusal that exits
 * {@link BOARD_REFUSAL_EXIT} before the body is snapshotted:
 *
 *  0. the author's TRUST (`./trust.ts`): whether the login that opened
 *     the issue holds write access to the repository, or is listed in
 *     `board.trustedAuthors`. A failed lookup is a refusal too;
 *  1. the `spec:ready` label (`./readiness.ts`), a person's decision.
 *     An issue carrying none is OFFERED `issue ready` when the run
 *     was handed an offer to make ({@link PlanSpecOptions.offerReady}),
 *     and refused as it always was when it was not; see below;
 *  2. the code reading of the body, in two halves and the leak half
 *     first: the leak refusal (`./leak.ts`), which keeps a home path
 *     or a credential out of a prompt and off the disk, and then the
 *     completeness gaps (`requireCompleteSpec` in `./readiness.ts`) —
 *     every template heading present and non-empty, "Tasks the plan
 *     must carry" and "Definition of done" each holding a list item,
 *     and no placeholder left in the text.
 *
 * Check 3, the planner's own pass over the spec, is a session and is
 * `./gate.ts`'s. Check 4, the references the spec names, reads the
 * saved copy this module settles, so it runs after the resolution has
 * answered and before that session, in `src/plan.ts` through
 * `src/commands/plan/refs-check.ts`; this module neither runs nor
 * knows it.
 *
 * ## Why trust runs first, and what it costs
 *
 * Check 0 is the only one of the three whose subject is the AUTHOR
 * rather than the body, and the spec puts it first because a body
 * nobody trusts should not be read, quoted in a refusal, or written
 * down at all: the label refusal names only a number, but the
 * completeness refusal quotes headings off the body, and the snapshot
 * is the body. Running it ahead of the label is what makes "nothing of
 * an untrusted body reaches the disk" a fact about the order and not a
 * hope.
 *
 * It is also the only one that ASKS something: one
 * `gh api repos/{owner}/{repo}/collaborators/<login>/permission` per
 * LOGIN a run checks, spent before the free checks rather than after,
 * so an unlabelled issue now costs a lookup it did not cost before. A
 * login in `board.trustedAuthors` spends none (`./trust.ts`), and
 * `--spec` spends none because it reads no issue.
 *
 * The check needs a login, and the read carries one:
 * `ISSUE_VIEW_FIELDS` asks for `author` and every issue holds it as
 * {@link SpecIssue.author} (`./issue.ts`). A payload naming no author
 * reads as the empty login, which is no account and therefore no
 * trust, so it is refused as a failed lookup rather than passed.
 *
 * ## The bodies a run reads, and the checks each one gets
 *
 * `--issue=<n>` reads ONE body, the issue named, and
 * {@link inspectSpecIssue} checks it. `--next` reads TWO: the ROADMAP,
 * whose lines decide the order, and the issue the line it picks names.
 * Both are checked, through two seams `./spec-source.ts` declares —
 * `inspect` for the line, {@link inspectRoadmapIssue} for the roadmap
 * — and neither body is parsed, quoted or snapshotted before its
 * author has been read.
 *
 * The roadmap is checked for what it can TAKE, which is not what a
 * spec issue can take: nothing of it reaches a prompt and nothing of
 * it is written down, but a line planted in it points the next session
 * at an issue of the planter's choosing, ahead of everything the
 * roadmap's owner put there. So it runs check 0 and only check 0 — it
 * carries no `spec:ready` label and fills no template heading, and
 * running the other two over it would refuse every roadmap there is.
 *
 * A `--next` run therefore checks two authors, usually the same
 * person, and spends ONE lookup for a login however many bodies it
 * wrote: the lookup is memoised for the length of one resolution
 * ({@link memoisePermissions}).
 *
 * ## The offer check 1 makes
 *
 * An issue nobody has marked `spec:ready` used to end the run with one
 * sentence, and the operator's next move was a second command over the
 * same issue. {@link PlanSpecOptions.offerReady} is that move offered
 * where the refusal stood: `src/commands/plan/ready-offer.ts` fills the
 * seam with `rafa issue ready`'s own run, so the author and the body
 * are checked again, the two readings are printed, and
 * `Mark #<n> spec:ready? [y/N]` is put through the line prompter. A yes
 * labels the issue and the resolution goes on to the leak and
 * completeness checks and the snapshot; a no throws the refusal check 1
 * always threw.
 *
 * The offer is a SEAM and it is optional, so this module keeps its old
 * behaviour wherever there is nothing to fill it with. Two runs fill it
 * with nothing on purpose: one with no terminal to ask on, which the
 * wiring answers null for before this module is reached, and one under
 * `--dry-run`, which writes nothing and a label swap is a write. Both
 * are refused with the sentence they were refused with before.
 *
 * The LEAK refusal runs BEFORE the offer, which the check order above
 * does not otherwise ask for: the offer reads the body for its gaps and
 * quotes headings off it, which is exactly what `requireNoLeak` clears
 * a body for. So an unlabelled body carrying a home path is refused for
 * the leak when there is an offer and for the label when there is not,
 * and `./plan-spec.test.ts` measures both.
 *
 * ## The blocked line `--next` offers its way past
 *
 * {@link PlanSpecOptions.offerAlternative} is the second question a
 * `plan create` run can put, and it is filled the same way check 1's is:
 * `src/commands/plan/blocked-offer.ts` reads the terminal once and
 * answers null where there is none, and this module hands the seam on
 * only when the run may write. A `--next` walk whose pick carries
 * `spec:blocked` with a blocker still open names what it waits on, finds
 * the first line under it that is ready, not blocked and not taken, and
 * plans that one only on a yes (`./spec-source.ts`, `./blocked-line.ts`).
 *
 * The question asks about the ROADMAP's order rather than about a
 * label, so no board write stands behind it and no trust reading is
 * spent on it: the issue it names is checked exactly as a typed
 * `--issue=<n>` would be, by {@link inspectSpecIssue}, once the answer
 * is yes.
 *
 * ## The question a changed body is asked
 *
 * {@link PlanSpecOptions.offerRefresh} is the third question, put when a
 * saved copy's BODY no longer matches the issue and `--refresh` was not
 * given (`./snapshot-settle.ts`). It is asked only after every check
 * above has passed on the body as it reads now, so an edit by an author
 * nobody trusts, or one that emptied a template heading, is refused by
 * its check before anybody is asked. It is handed on under the same two
 * rules as the others: null from the wiring where there is no terminal,
 * and none here under `--dry-run`, because a yes rewrites the saved copy.
 * A run handed none refuses a changed body with the sentence it always
 * did.
 *
 * ## The repository a refusal names
 *
 * A trust refusal names the repository, and `gh` is never told which
 * one it is working on — it resolves that from the directory it runs
 * in, the rule `./trust.ts` keeps for the path it builds. So the name
 * is a LABEL, read from `origin` through the `git` seam by
 * {@link boardRepoLabel} and falling back to {@link UNNAMED_REPO}.
 *
 * The label is read when an issue is, not on every run:
 * {@link resolvePlanSpec} builds the trust inside the seams it hands
 * over, so `--spec=<file>` spends no `git remote get-url origin` for a
 * sentence it will never print. The trust is built ONCE for a
 * resolution and shared by both seams, so a `--next` run that checks
 * the roadmap and then the line it picks still reads the label once,
 * which `./plan-spec.test.ts` counts on both routes.
 *
 * ## What the completeness refusal costs
 *
 * Check 2's completeness half was written and left unwired, and this
 * note argued for leaving it that way. What ran in its place was a
 * WARNING over the two headings a plan is written from, printed and
 * never refused. Both are gone: the spec decided the refusal, and the
 * warning could not have survived beside it anyway, since every gap
 * `findListSectionGaps` names is a gap `requireCompleteSpec` refuses
 * and a warning printed after a refusal reaches no output.
 * `./readiness.ts` keeps the warning pair with its own cases and no
 * caller.
 *
 * The argument for leaving it unwired was a real cost, and wiring it
 * does not make that cost go away — it decides to pay it. An issue
 * opened before `src/board/templates/spec.md` carries none of the six
 * headings, so it is refused on its first reading, with all six named
 * missing in one sentence, nothing snapshotted and nothing planned.
 * The remedy is the refusal's own last clause, fill each gap and
 * rerun, which for such a body means pasting the template over it and
 * filling it in once, by hand. `--next` STOPS at a line that refuses
 * rather than skipping ahead (`./spec-source.ts`), so one unmigrated
 * issue on the roadmap holds up the walk until somebody edits it.
 *
 * That is the trade the spec took. A body nobody has migrated costs an
 * edit; every body that HAS been migrated stops costing a planner
 * session to discover it was thin, because this refusal is free and
 * check 3 is a session.
 *
 * ## The gate's issue
 *
 * A not-ready verdict posts its gaps on the issue, and swaps its labels
 * when one of those gaps blocks planning, and `./gate.ts` takes that as
 * a {@link GateIssue}: the number, the
 * board to write through, and the TRUST, which the gate spends on the
 * author of a `rafa:spec-review` marker comment already on the issue so
 * it never edits one a stranger planted (`./review-comment.ts`). It is
 * the same trust check 0 was read through, already built and already
 * memoised, because an issue route has read an issue by then.
 *
 * Only the issue routes have a gate issue, so this module answers it
 * beside the spec — null under `--spec=<file>`, which has no labels to
 * move and nothing to comment on.
 */
import type { AlternativeOffer } from './blocked-line.js';
import type { GateIssue } from './gate.js';
import type { SpecIssue } from './issue.js';
import type { RefreshOffer } from './snapshot-settle.js';
import type { ResolvedSpec, SpecSourceRequest, SpecSourceStop } from './spec-source.js';
import type { BoardTrust, PermissionReading, Permissions } from './trust.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { Output } from '../ports/index.js';
import type { GitRunner } from '../pr/git.js';

import { activeOutput } from '../adapters/output/active.js';
import { createGhRunner } from '../adapters/tracker/github.js';
import { createGitRunner } from '../pr/git.js';
import { normalizeRemote } from '../schema/project-id.js';

import { createGhIssueBoard } from './issue-board.js';
import { createGhSpecIssueReader } from './issue.js';
import { requireNoLeak } from './leak.js';
import { hasSpecReadyLabel, requireCompleteSpec, requireSpecReadyLabel } from './readiness.js';
import { createGhOpenPullRequests, createGhRoadmapSearch } from './roadmap.js';
import { resolveSpecSource } from './spec-source.js';
import { ghBoardTrust, requireTrustedBoardAuthor } from './trust.js';

/** The exit code every board refusal this module composes carries; the spec's own. */
export const BOARD_REFUSAL_EXIT = 2;

/** What a refusal calls the issue it refused: `issue #20`. */
export function issueSource(issue: number): string {
  return `issue #${String(issue)}`;
}

/** What a trust refusal calls a repository `origin` names none of. */
export const UNNAMED_REPO = 'this repository';

/**
 * What a trust refusal calls the repository: `origin` normalised as
 * `host/owner/name`, or {@link UNNAMED_REPO} when `git` answers no
 * remote, no repository or nothing at all.
 *
 * Read through the `git` seam rather than `gitRemoteUrl`, so a case in
 * `./plan-spec.test.ts` spawns nothing for it. The module note holds
 * why the repository is a label here and never an input to the lookup.
 */
export function boardRepoLabel(git: GitRunner): string {
  const result = git(['remote', 'get-url', 'origin']);
  const normalized = result.ok
    ? normalizeRemote(result.stdout.trim())
    : '';
  return normalized === ''
    ? UNNAMED_REPO
    : normalized;
}

/** What an offer is handed: the issue check 1 found unlabelled, and what it takes to mark it. */
export interface ReadyOfferRequest {
  /** The issue as read, whose author check 0 has already trusted. */
  readonly issue: SpecIssue;
  /** Runs `gh`, in the repository the board belongs to. */
  readonly gh: GhRunner;
  /** The permission lookup, the allow-list and the repository label, already memoised. */
  readonly trust: BoardTrust;
  /** Where the offer's own lines go. */
  readonly output: Output;
}

/**
 * Offers `rafa issue ready` on an issue check 1 found unlabelled, and
 * answers whether it now carries the label.
 *
 * Filled by `src/commands/plan/ready-offer.ts`, which is where the
 * terminal, the prompter and the label swap live; nothing in this
 * module asks a question or writes to the board.
 */
export type ReadyOffer = (request: ReadyOfferRequest) => Promise<boolean>;

/** The offer as {@link inspectSpecIssue} takes it, everything but the issue bound. */
export type BoundReadyOffer = (issue: SpecIssue) => Promise<boolean>;

/**
 * Check 1: an issue carrying `spec:ready` passes, and one carrying none
 * is refused with {@link requireSpecReadyLabel}'s own sentence unless
 * `offer` marks it.
 *
 * The offer is made after the LEAK refusal and nowhere else in this
 * module is: it reads the body for its gaps and quotes headings off it,
 * so the body must be cleared before it is made. A run with no offer
 * reads no byte of the body here, as it never did. The module note
 * holds why the offer exists and which runs are handed none.
 */
async function passReadyLabel(issue: SpecIssue, offer: BoundReadyOffer | undefined): Promise<void> {
  if (hasSpecReadyLabel(issue.labels)) return;
  if (offer !== undefined) {
    requireNoLeak(issueSource(issue.number), issue.body);
    if (await offer(issue)) return;
  }
  // Nothing marked it ready — neither the person who opened it nor the
  // offer, where one was made — so check 1 refuses it as it always did.
  requireSpecReadyLabel(issue.number, issue.labels);
}

/**
 * The checks that run on an issue as read, before a byte of it is
 * written: the author's trust over `trust`, then the `spec:ready`
 * label, then the leak refusal, then the completeness gaps over every
 * template heading. Throws
 * `CommandExit({@link BOARD_REFUSAL_EXIT}, ...)` at the first that
 * refuses; the module note holds which checks are here, why the trust
 * one is first and what the completeness refusal costs.
 *
 * The order is the spec's, and it is also what keeps a body out of a
 * refusal sentence it should never have reached: nothing is read off
 * the body until its author is trusted and a person has marked the
 * issue ready, and the completeness refusal QUOTES headings taken from
 * the body, so it must not run over a body `requireNoLeak` has not
 * cleared first. `./plan-spec.test.ts` measures all three orderings.
 *
 * `offer` is the one check 1 makes on an issue carrying no label
 * ({@link passReadyLabel}); left out, the label check refuses as it
 * always did and no byte of the body is read before it.
 */
export async function inspectSpecIssue(
  issue: SpecIssue,
  trust: BoardTrust,
  offer?: BoundReadyOffer,
): Promise<void> {
  const source = issueSource(issue.number);
  await requireTrustedBoardAuthor({ kind: 'issue', number: issue.number }, trust, issue.author);
  await passReadyLabel(issue, offer);
  requireNoLeak(source, issue.body);
  requireCompleteSpec(source, issue.body);
}

/**
 * The one check that runs on the ROADMAP issue as read, before a line
 * is parsed out of its body: check 0, its author's trust over `trust`.
 * Throws `CommandExit({@link BOARD_REFUSAL_EXIT}, ...)` when the login
 * that opened it is trusted with nothing, so a `--next` run over a
 * planted roadmap walks no line of it.
 *
 * It is check 0 ALONE, and the module note holds why: a roadmap is not
 * a spec, so the label, the leak and the completeness refusals would
 * refuse every roadmap there is, while the order it carries is exactly
 * what a planted line would take.
 *
 * The refusal is the one {@link requireTrustedBoardAuthor} spells, so
 * it names the roadmap as `issue #<n>` and ends with the remedy the
 * issue kind carries, "a member must open the spec" (`./trust.ts`).
 * The claim about access is the half an operator acts on and it is
 * exact; the remedy names the spec on a route that refused the
 * roadmap, and giving the roadmap one of its own means a third
 * `BoardItemKind`, which is `./trust.ts`'s to add rather than this
 * module's to spell a second way.
 */
export async function inspectRoadmapIssue(issue: SpecIssue, trust: BoardTrust): Promise<void> {
  await requireTrustedBoardAuthor({ kind: 'issue', number: issue.number }, trust, issue.author);
}

/**
 * `permissions` reading each login at most once, for the length of one
 * resolution: a `--next` run checks two authors, the roadmap's and the
 * picked line's, and they are usually one person whose access cannot
 * change between two calls made a moment apart.
 *
 * The memo does not outlive the call, so no run is answered from
 * another run's reading, and it is keyed by the login as the board
 * spelled it: a reading answers about the login it was handed, and a
 * refusal names it, so a memo folding `Octocat` into `octocat` would
 * name an account the issue does not.
 */
function memoisePermissions(permissions: Permissions): Permissions {
  const read = new Map<string, Promise<PermissionReading>>();
  return (login: string): Promise<PermissionReading> => {
    const taken = read.get(login) ?? permissions(login);
    read.set(login, taken);
    return taken;
  };
}

/** What {@link resolvePlanSpec} is asked. */
export interface PlanSpecOptions {
  /** The source the command line named, as `readSpecSourceFlags` read it. */
  readonly request: SpecSourceRequest;
  /** True under `--refresh`. */
  readonly refresh: boolean;
  /** True under `--dry-run`. */
  readonly dryRun: boolean;
  /** The project root every path and every runner is made against. */
  readonly repoRoot: string;
  /** Where snapshots live, as `specs.dir` resolved it. */
  readonly specsDir: string;
  /** `roadmap.issue` as config resolved it, or null for the titled issue. */
  readonly roadmapIssue: number | null;
  /** `board.trustedAuthors` as config resolved it; check 0's allow-list. */
  readonly trustedAuthors: readonly string[];
  /** Where `--spec` looks for its file; `src/commands/plan/spec-route.ts`'s own candidate rule. */
  readonly findSpec: (spec: string) => string;
  /**
   * Offers `issue ready` on an issue check 1 found unlabelled; null, or
   * left out, for a run that refuses one as it always did. Never called
   * under `--dry-run`, which writes nothing.
   */
  readonly offerReady?: ReadyOffer | null;
  /**
   * Asks whether to plan the line `--next` offers in place of a blocked
   * one; null, or left out, for a run that plans nothing and says so.
   * Never called under `--dry-run`, for the same reason.
   */
  readonly offerAlternative?: AlternativeOffer | null;
  /**
   * Asks whether to plan from an issue whose body changed since its
   * saved copy; null, or left out, for a run that refuses one as it
   * always did. Never called under `--dry-run`, for the same reason.
   */
  readonly offerRefresh?: RefreshOffer | null;
  /** Runs `gh`; one made for the project root when left out. */
  readonly gh?: GhRunner;
  /** Runs `git`; one made for the project root when left out. */
  readonly git?: GitRunner;
  /** Where the lines go; the active output when left out. */
  readonly output?: Output;
}

/** What a resolution answers: one spec with its issue, or the reason it stopped. */
export type PlanSpecResolution =
  | { readonly outcome: 'stopped'; readonly reason: SpecSourceStop }
  | {
    readonly outcome: 'spec';
    /** The spec the run plans from. */
    readonly spec: ResolvedSpec;
    /** The issue the readiness gate publishes on, or null under `--spec`. */
    readonly gate: GateIssue | null;
  };

/**
 * The spec a `plan create` run plans from, resolved for one project, or
 * the reason the run stops without one.
 *
 * Throws the `CommandExit` of every refusal the routes carry: exit 1 for
 * the words typed (`./spec-source.ts`) and exit
 * {@link BOARD_REFUSAL_EXIT} for the board's own state — an issue or a
 * roadmap whose author is trusted with nothing, a closed or unlabelled
 * issue, a leaking body, an incomplete body, a snapshot whose issue
 * body differs with no `--refresh` and no yes to the question, a roadmap that cannot be resolved.
 */
export async function resolvePlanSpec(options: PlanSpecOptions): Promise<PlanSpecResolution> {
  const { repoRoot } = options;
  const gh = options.gh ?? createGhRunner({ cwd: repoRoot });
  const git = options.git ?? createGitRunner(repoRoot);
  const output = options.output ?? activeOutput();
  // Made when an issue is read and not before: `--spec=<file>` reads
  // none, and the label is a `git remote get-url origin` that route
  // must not spend. Made ONCE, because a `--next` run checks two
  // authors and neither the label nor a login's access changes between
  // them. See the module note.
  let board: BoardTrust | null = null;
  const trust = (): BoardTrust => {
    if (board === null) {
      const made = ghBoardTrust({
        gh,
        trustedAuthors: options.trustedAuthors,
        repo: boardRepoLabel(git),
      });
      board = Object.freeze({ ...made, permissions: memoisePermissions(made.permissions) });
    }
    return board;
  };

  // The offer check 1 makes, with everything but the issue bound. A
  // `--dry-run` run is handed none: its contract is that it writes
  // nothing, and the label swap behind the question is a write.
  const offerReady = options.offerReady ?? null;
  const offer = offerReady === null || options.dryRun
    ? undefined
    : (issue: SpecIssue): Promise<boolean> => offerReady({ issue, gh, trust: trust(), output });

  // The question `--next` asks about a blocked line, under the same two
  // rules: a run with nobody to ask is handed none, and a `--dry-run`
  // run is handed none because a yes would plan, which is a write.
  const offerAlternative = options.offerAlternative ?? null;
  const alternative = offerAlternative === null || options.dryRun
    ? undefined
    : offerAlternative;

  // The question a changed body is asked, under the same two rules: a
  // yes rewrites the saved copy, which a `--dry-run` run must not.
  const offerRefresh = options.dryRun
    ? null
    : options.offerRefresh ?? null;

  const resolution = await resolveSpecSource({
    request: options.request,
    refresh: options.refresh,
    dryRun: options.dryRun,
    repoRoot,
    specsDir: options.specsDir,
    findSpec: options.findSpec,
    issues: createGhSpecIssueReader({ gh }),
    inspect: (issue) => inspectSpecIssue(issue, trust(), offer),
    offerRefresh,
    roadmap: {
      configured: options.roadmapIssue,
      search: createGhRoadmapSearch({ gh }),
      git,
      pullRequests: createGhOpenPullRequests({ gh }),
      inspectRoadmap: (issue) => inspectRoadmapIssue(issue, trust()),
      offerAlternative: alternative,
    },
    output,
  });

  if (resolution.outcome === 'stopped') {
    return Object.freeze({ outcome: 'stopped' as const, reason: resolution.reason });
  }

  const { spec } = resolution;
  return Object.freeze({
    outcome: 'spec' as const,
    spec,
    gate: spec.issue === null
      ? null
      : Object.freeze({ number: spec.issue, board: createGhIssueBoard({ gh }), trust: trust() }),
  });
}
