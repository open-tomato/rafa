/**
 * `rafa pr triage --resolve`: the assessed pull request handed to the
 * ordinary loop over a pinned plan, once per attempt, until CI is green
 * or the attempt guard stops the run.
 *
 * `./triage.ts` assesses; this module acts on what it concluded. The
 * pieces it acts through were each built and tested on their own, and
 * nothing here re-decides what they decided:
 *
 *   - `src/pr/worktree.ts` — where the worktree goes, the
 *     cross-repository refusal, and the removal that is never forced.
 *   - `src/pr/plans/load.ts` — the pinned plan for the class, filled
 *     from the triage block, the shared conflict sentence and the
 *     failing job's log excerpt.
 *   - `src/pr/plans/budget.ts` — `pr.resolveBudget` written into that
 *     plan's task lines, which is how a session is handed
 *     `--max-budget-usd`.
 *   - `./resolve-loop.ts` — the plan written outside the worktree and
 *     `rafa loop start` spawned inside it.
 *   - `src/pr/checks.ts`'s `waitForChecks` — the CI wait, the same one
 *     the loop's own gate polls with.
 *   - `src/pr/triage/attempts.ts` — the counter and the two stops.
 *
 * ## The order of one attempt, and why it is that order
 *
 * The worktree is added BEFORE the counter is raised. Everything after
 * the add is a run that was really made, and the counter's own module
 * note explains why it is raised before that run rather than after it:
 * a count raised afterwards is lost whenever the run does not come
 * back. A failed `git worktree add`, though, is a machine that could
 * not give the run a workspace — a branch checked out somewhere else, a
 * directory left behind — and no session was spawned, no commit made
 * and nothing pushed. Spending an attempt on it would hand a pull
 * request one fewer real try each time the operator has another
 * worktree open, so the add refuses the run with exit code 1 instead,
 * naming what git said.
 *
 * Then, in order: the counter raised into the triage comment, the plan
 * filled and written, the loop run, the CI wait, and a fresh
 * assessment. The fresh assessment is what the attempt ENDED as, and
 * the pair it answers — the class and the failing step — is what the
 * repeat reading compares against the attempt before it.
 *
 * ## A run that pushed nothing reads as a repeat
 *
 * When the loop makes no commit, the head does not move, and the
 * re-assessment reads `already-assessed` and classifies nothing
 * (`src/pr/triage/rerun.ts`). There is then no fresh pair to compare,
 * and {@link ATTEMPT_OUTCOME_UNCHANGED} is the reading taken: the
 * attempt is treated as having ended exactly as it began, which makes
 * the second such attempt a repeat and stops the loop. The other
 * direction — treating an unreadable outcome as progress — would spend
 * every attempt a cap allows on a plan that is doing nothing.
 *
 * The same fallback covers the other two readings that classify
 * nothing, `pending` and `green`, and only `already-assessed` is SAID
 * to have pushed nothing: a head that moved with a run still going has
 * pushed, and after a CI wait that ran out of its deadline it is the
 * checks rather than the attempt that are unfinished.
 *
 * ## The failing log is filled from the evidence beside the assessment
 *
 * The two CI plans carry a `{FAILING_LOG}` slot, and the triage block
 * they are otherwise filled from does not hold a log: it records the
 * class, the files and the attempts only (`src/pr/plans/load.ts`). The
 * log is in the ASSESSMENT's evidence, which this module has in hand:
 * the run reads it off the reading with `evidenceOf`
 * (`./triage-report.ts`), and {@link planFor} caps it with
 * `excerptLines` (`src/pr/triage/follow-up.ts`) — the reader the
 * FOLLOW-UP PROMPT is capped by, deliberately, so the plan a session
 * runs and the prompt a person pastes quote the same lines of the same
 * log rather than two different tails of it. A fill carrying no excerpt still answers the
 * slot, and the two conflict plans carry no such slot at all, so the
 * value goes unused there.
 *
 * The evidence travels WITH the assessment, as {@link AssessedLog},
 * and moves only when the re-assessment classified something. That is
 * the same rule the assessment itself follows — `reading.assessment ??
 * before` in {@link endOfAttempt} — and it has to be, because the two
 * are one reading. A fresh class read off a fresh log takes both; an
 * attempt whose re-assessment classified nothing, the head not having
 * moved, keeps both, so the next attempt runs the plan for the class
 * it is still about with the log that class was read from. Taking the
 * evidence from the latest reading alone would hand that attempt no
 * log at all, and pinning it to the run's FIRST reading would quote,
 * after a class change, the log of a failure the plan is no longer
 * about.
 *
 * ## A class the attempt left unresolvable stops the run
 *
 * An attempt can leave a pull request failing in a way no pinned plan
 * covers: a lockfile conflict resolved into a red test battery, say.
 * The plan for the NEW class is what the next attempt would run, and
 * there is none, so the run stops there — the comment is updated, the
 * worktree removed, the follow-up prompt printed and the exit code is
 * {@link RESOLVE_STOP_EXIT}, the same ending the two guards have,
 * because the operator is in the same position either way: a pull
 * request `--resolve` was asked about and did not fix. It is not one of
 * the guards' own stops, so {@link ResolveResult.stop} stays null and
 * the reason says what the class became.
 *
 * ## What "green" means here
 *
 * Two readings answer it, because a conflict and a red battery leave
 * the pull request in different shapes. The checks going green is the
 * ordinary one. The other is a fresh assessment whose class is `green`,
 * which is what a resolved conflict answers in a repository that
 * schedules no run for the merge ref at all (`src/pr/checks.ts`: `none`
 * is a verdict, not a wait).
 *
 * ## The comment is written twice per attempt, and once more at the end
 *
 * Before the run, so the raised counter is stored where the next
 * invocation reads it; and by the re-assessment itself, which edits the
 * same comment as every ordinary triage does. The stop and the success
 * write once more, the first with the follow-up prompt of the reading
 * that stopped it and the second with the headline `resolved`.
 *
 * A write that failed is REPORTED and never refuses the run, as
 * `./triage.ts` reports its own: the worktree, the branch and the
 * pushed commits are all real whatever GitHub said about a comment.
 *
 * ## The author is trusted before anything is done
 *
 * The first step of a run, ahead of the assessment it was handed being
 * looked at at all, is `requireTrustedResolveAuthor`
 * (`./triage-trust.ts`): a pull request whose author holds no write
 * access is refused with exit {@link RESOLVE_REFUSE_EXIT} and
 * `trustRefusalMessage`'s sentence, unless the author is listed in
 * `board.trustedAuthors` or is a known bump bot. A resolve run checks
 * out that pull request's branch into a worktree and hands a session a
 * plan over it, so the branch's content is board text in the strongest
 * sense the spec has, and the check comes before the worktree, the plan
 * and the counter alike.
 *
 * The bump bots are allowed because they are what `--resolve` is for: a
 * lockfile conflict on a dependabot branch is the class the pinned
 * plans were written against, and dependabot holds no write access for
 * the lookup to report.
 *
 * ## The dependabot note
 *
 * Pushing to a dependabot branch stops dependabot rebasing it, so a
 * comment on one carries {@link DEPENDABOT_REBASE_NOTE}. The reading is
 * the AUTHOR alone and not `isDependencyBump`, whose other half is a
 * `chore(deps` title: a human's pull request titled that way is nobody's
 * to rebase, and a note telling its author that dependabot has stopped
 * doing something it never did is worse than no note.
 */
import type { ResolveLoopOutcome, ResolveLoopRunner } from './resolve-loop.js';
import type { TriageReading } from './triage-report.js';
import type { TriageTrust } from './triage-trust.js';
import type { Output } from '../../ports/index.js';
import type { GitRunner, PullRequestDetail, PullRequests } from '../../pr/index.js';
import type { AttemptOutcome, AttemptReading } from '../../pr/triage/attempts.js';
import type { TriageAssessment } from '../../pr/triage/classify.js';
import type { TriageBlock } from '../../pr/triage/comment.js';
import type { FailedLogEvidence } from '../../pr/triage/evidence.js';
import type { ExcerptReading } from '../../pr/triage/follow-up.js';

import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { waitForChecks } from '../../pr/index.js';
import { withTaskBudget } from '../../pr/plans/budget.js';
import { hasPinnedPlan, loadPinnedPlan } from '../../pr/plans/load.js';
import { readAttemptRepeat, readAttemptStart, spentAttempts } from '../../pr/triage/attempts.js';
import { DEPENDENCY_BUMP_AUTHORS } from '../../pr/triage/classes.js';
import { triageCommentBody, writeTriageComment } from '../../pr/triage/comment.js';
import { buildFollowUpPrompt, excerptLines } from '../../pr/triage/follow-up.js';
import {
  addResolveWorktree,
  crossRepositoryRefusal,
  removeResolveWorktree,
  resolveWorktreePath,
  worktreeAt,
} from '../../pr/worktree.js';
import { CI_POLL_INTERVAL_MS, DEFAULT_CI_TIMEOUT_MIN } from '../../start/pr-lifecycle.js';

import { runResolveLoop, writeResolvePlan } from './resolve-loop.js';
import { evidenceOf } from './triage-report.js';
import { readTrustedTriageComment, requireTrustedResolveAuthor } from './triage-trust.js';

/** The exit code a `--resolve` run that gave up ends with; the spec's. */
export const RESOLVE_STOP_EXIT = 3;

/** The exit code a `--resolve` refusal ends with, as `select.ts` refuses. */
export const RESOLVE_REFUSE_EXIT = 2;

/** How long the CI wait after an attempt runs for, from the loop's own gate. */
export const RESOLVE_CI_TIMEOUT_MS = DEFAULT_CI_TIMEOUT_MIN * 60_000;

/** The reading taken when an attempt pushed nothing; see the module note. */
export const ATTEMPT_OUTCOME_UNCHANGED = 'the attempt pushed nothing, so it ended as it began';

/** What a comment on a dependabot branch says about the push; the spec's rule. */
export const DEPENDABOT_REBASE_NOTE = 'Note: rafa pushed to this dependabot branch. Dependabot stops'
  + ' rebasing a branch once anyone else has pushed to it, so this pull request will not be'
  + ' refreshed by dependabot again; close it and let dependabot open a new one if that is wanted.';

/** What one resolve run is handed. */
export interface ResolveRun {
  /** The provider, for the checks poll and the comment writes. */
  readonly pulls: PullRequests;
  /** How the author and the stored comment are trusted; see the module note. */
  readonly trust: TriageTrust;
  /** The project root, whose git adds and removes the worktree. */
  readonly root: string;
  /** The home the worktree and the plans go under. */
  readonly home: string;
  /** The pull request number. */
  readonly number: number;
  /** The assessment this run acts on, as `./triage.ts` read it. */
  readonly reading: TriageReading;
  /** `--max-attempts`. */
  readonly maxAttempts: number;
  /** `pr.resolveBudget`, in US dollars, which every session is capped at. */
  readonly budgetUsd: number;
  /** The clock, ISO 8601, which every comment is stamped with. */
  readonly now: () => string;
  /** Where progress goes: one line per step, the loop's own lines among them. */
  readonly output: Output;
  /** The git runner for a directory. */
  readonly git: (root: string) => GitRunner;
  /** How one attempt's loop is run. */
  readonly runLoop?: ResolveLoopRunner;
  /** A fresh assessment of the same pull request, which edits the same comment. */
  readonly reassess: () => Promise<TriageReading>;
  /** The CI wait's clock, in milliseconds. The system's when left out. */
  readonly clock?: () => number;
  /** The CI wait's sleep. A real timer when left out. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** What one resolve run came to. */
export interface ResolveResult {
  /** True when at least one attempt was run. */
  readonly ran: boolean;
  /** True when the pull request ended green. */
  readonly resolved: boolean;
  /** Why the run stopped, or null when it did not stop at a guard. */
  readonly stop: AttemptReading['stop'];
  /** How many attempts were spent. */
  readonly attempts: number;
  /** The cap they were spent against. */
  readonly maxAttempts: number;
  /** The last reading of the pull request, which the report renders. */
  readonly reading: TriageReading;
  /** The lines the report carries under it. */
  readonly lines: readonly string[];
  /** The one line naming how the run ended, which a nonzero exit reports. */
  readonly headline: string;
  /** The exit code the command ends with: {@link RESOLVE_STOP_EXIT} or 0. */
  readonly exitCode: number;
}

/** Whether a pull request is on a branch dependabot would rebase; see the module note. */
export function isDependabotBranch(detail: Pick<PullRequestDetail, 'author'>): boolean {
  const login = detail.author.login.toLowerCase();
  return DEPENDENCY_BUMP_AUTHORS.some((known) => known.toLowerCase() === login);
}

/** A run that resolved nothing and spent no attempt, for the one reason given. */
function nothingToDo(run: ResolveRun, line: string): ResolveResult {
  return {
    ran: false,
    resolved: false,
    stop: null,
    attempts: spentAttempts(run.reading.attempts),
    maxAttempts: run.maxAttempts,
    reading: run.reading,
    lines: [line],
    headline: line,
    exitCode: 0,
  };
}

/** The triage block a pinned plan is filled from, built from the assessment in hand. */
function blockOf(detail: PullRequestDetail, assessment: TriageAssessment, at: string, attempts: number): TriageBlock {
  return {
    head: detail.headRefOid,
    at,
    class: assessment.triageClass,
    simple: assessment.simple,
    attempts,
    files: assessment.files,
  };
}

/** The comment body one write puts on the pull request, the dependabot note included. */
function resolveCommentBody(
  run: ResolveRun,
  detail: PullRequestDetail,
  assessment: TriageAssessment,
  attempts: number,
  resolved: boolean,
): string {
  const body = triageCommentBody({
    pr: detail,
    assessment,
    at: run.now(),
    attempts,
    resolved,
    evidence: evidenceOf(run.reading),
  });
  return isDependabotBranch(detail)
    ? `${body}\n${DEPENDABOT_REBASE_NOTE}\n`
    : body;
}

/**
 * Writes the triage comment, reporting a refused write rather than
 * refusing the run.
 *
 * The comment it EDITS is found through `./triage-trust.ts` rather than
 * through the writer's own lookup, so a marker comment planted by an
 * account nobody trusted is neither edited nor read as the store this
 * run raises its counter in. Each one passed over is warned about, one
 * line, which is the "reported" half of ignoring it.
 */
async function writeResolveComment(
  run: ResolveRun,
  detail: PullRequestDetail,
  assessment: TriageAssessment,
  attempts: number,
  resolved: boolean,
): Promise<void> {
  const body = resolveCommentBody(run, detail, assessment, attempts, resolved);
  try {
    const found = await readTrustedTriageComment(await run.pulls.comments(run.number), run.trust);
    for (const ignored of found.ignored) run.output.warn(`   ${ignored.reason}`);
    await writeTriageComment({ pulls: run.pulls, number: run.number, body, existing: found.comment });
  } catch (error) {
    run.output.warn(`   The triage comment could not be written: ${messageOf(error)}`);
  }
}

/** Adds the worktree when there is none, refusing the run when git would not; see the module note. */
function openWorktree(run: ResolveRun, detail: PullRequestDetail): string {
  const path = resolveWorktreePath(run.home, run.number);
  const git = run.git(run.root);
  if (worktreeAt(git, path) !== null) {
    run.output.info(`   Reusing the worktree at ${path}`);
    return path;
  }
  const added = addResolveWorktree(git, path, detail.headRefName);
  if (!added.ok) {
    throw new CommandExit(
      1,
      [
        `❌ The worktree for #${run.number} could not be added, so no resolve run was started.`,
        `   ${added.command}`,
        `   ${added.said}`,
      ].join('\n'),
    );
  }
  run.output.info(`   Added the worktree at ${path}`);
  return path;
}

/** Removes the worktree, reporting git's refusal as a line rather than a throw. */
function closeWorktree(run: ResolveRun, path: string): string {
  const removed = removeResolveWorktree(run.git(run.root), path);
  return removed.ok
    ? `Removed the worktree at ${path}.`
    : `The worktree at ${path} was left in place: ${removed.said}`;
}

/** One assessment and the failing job log it was read from; see the module note. */
interface AssessedLog {
  /** What the classifier concluded. */
  readonly assessment: TriageAssessment;
  /** The log that assessment was read from, or undefined when none was read. */
  readonly evidence: FailedLogEvidence | undefined;
}

/**
 * The excerpt a plan is filled with: the same reading, from the same
 * reader, a follow-up prompt is capped by. See the module note.
 */
function excerptOf(assessed: AssessedLog): ExcerptReading | undefined {
  return assessed.evidence === undefined
    ? undefined
    : excerptLines(assessed.evidence);
}

/** Fills the pinned plan for one attempt and writes it outside the worktree. */
function planFor(run: ResolveRun, detail: PullRequestDetail, assessed: AssessedLog, attempt: number): string {
  const { assessment } = assessed;
  const block = blockOf(detail, assessment, run.now(), attempt);
  const fill = { block, excerpt: excerptOf(assessed) };
  const plan = withTaskBudget(loadPinnedPlan(assessment.triageClass, fill), run.budgetUsd);
  return writeResolvePlan({
    home: run.home,
    number: run.number,
    attempt,
    triageClass: assessment.triageClass,
    plan,
  });
}

/** The CI wait after one attempt: the same poll the loop's own gate runs. */
async function waitForCi(run: ResolveRun): Promise<ReturnType<typeof waitForChecks>> {
  return waitForChecks({
    probe: async () => (await run.pulls.checks(run.number)).rows,
    timeoutMs: RESOLVE_CI_TIMEOUT_MS,
    intervalMs: CI_POLL_INTERVAL_MS,
    ...run.clock === undefined
      ? {}
      : { now: run.clock },
    ...run.sleep === undefined
      ? {}
      : { sleep: run.sleep },
    onPoll: (_rows, verdict, elapsedMs) => {
      run.output.info(`   Checks are ${verdict} after ${Math.round(elapsedMs / 1000)}s`);
    },
  });
}

/** What one attempt ended as, and the pair the repeat reading compares. */
interface AttemptEnd {
  /** The fresh reading of the pull request. */
  readonly reading: TriageReading;
  /** Its class and failing step, or the attempt's own when it classified nothing. */
  readonly outcome: AttemptOutcome;
  /** The assessment a comment and a prompt are written from. */
  readonly assessment: TriageAssessment;
  /** The log that assessment was read from; see the module note. */
  readonly evidence: FailedLogEvidence | undefined;
  /** True when the pull request is green; see the module note. */
  readonly green: boolean;
  /** What is said about a run that pushed nothing, or null when it pushed. */
  readonly unchanged: string | null;
}

/** Reads what one attempt ended as, out of the CI wait and a fresh assessment. */
async function endOfAttempt(
  run: ResolveRun,
  before: AssessedLog,
  waited: Awaited<ReturnType<typeof waitForChecks>>,
): Promise<AttemptEnd> {
  const reading = await run.reassess();
  const fresh = reading.assessment;
  const assessment = fresh ?? before.assessment;
  const green = waited.verdict === 'green' || fresh?.triageClass === 'green';
  return {
    reading,
    outcome: { triageClass: assessment.triageClass, step: assessment.step },
    assessment,
    evidence: fresh === null
      ? before.evidence
      : evidenceOf(reading),
    green,
    unchanged: reading.rerun.decision === 'already-assessed'
      ? ATTEMPT_OUTCOME_UNCHANGED
      : null,
  };
}

/** The lines a stopped run reports, the follow-up prompt among them when the report carries none. */
function stopLines(
  run: ResolveRun,
  reason: string,
  end: Pick<AttemptEnd, 'assessment' | 'reading'>,
  removal: string,
): readonly string[] {
  const prompt = end.reading.prompt ?? buildFollowUpPrompt({
    pr: end.reading.detail,
    assessment: end.assessment,
    evidence: evidenceOf(end.reading),
  });
  return [
    `⛔ rafa pr triage --resolve gave up on #${run.number}: ${reason}.`,
    removal,
    'Hand the follow-up prompt below to a session, or take it from here by hand.',
    prompt,
  ];
}

/** Whether a pinned plan can be run over an assessment at all. */
function resolvable(assessment: TriageAssessment): boolean {
  return assessment.simple && hasPinnedPlan(assessment.triageClass);
}

/** What is said about a loop that did not exit 0. */
function loopProblem(loop: ResolveLoopOutcome): string {
  const said = loop.problem === null
    ? ''
    : `: ${loop.problem}`;
  return `The loop exited ${String(loop.exitCode)}${said}`;
}

/** Why a run that is no longer resolvable stopped; see the module note. */
export function noPlanReason(triageClass: string): string {
  return `the attempt left it \`${triageClass}\`, which no pinned plan resolves`;
}

/** What one attempt writes as it starts. */
function attemptHeadline(run: ResolveRun, assessment: TriageAssessment, guard: AttemptReading): string {
  return `🔧 Resolving #${run.number} as \`${assessment.triageClass}\`: ${guard.reason},`
    + ` budget $${String(run.budgetUsd)} a session`;
}

/**
 * Runs the pinned plan for one assessed pull request until it is green
 * or a guard stops it.
 *
 * Answers a result rather than throwing for the two guard stops, so the
 * caller renders the run's report and then ends with
 * {@link ResolveResult.exitCode}. It throws `CommandExit` only where no
 * run could be started at all: a cross-repository pull request (exit
 * {@link RESOLVE_REFUSE_EXIT}) and a worktree git refused (exit 1).
 */
export async function resolvePullRequest(run: ResolveRun): Promise<ResolveResult> {
  const { reading } = run;
  const detail = reading.detail;
  await requireTrustedResolveAuthor(detail, run.trust);
  const first = reading.assessment;
  if (first === null) {
    return nothingToDo(run, `Nothing was assessed for #${run.number}, so --resolve ran nothing.`);
  }
  if (!resolvable(first)) {
    return nothingToDo(
      run,
      `#${run.number} is \`${first.triageClass}\`, which is not simple, so --resolve ran nothing:`
        + ' no pinned plan resolves it and it is assessed only.',
    );
  }
  const refusal = crossRepositoryRefusal(detail);
  if (refusal !== null) throw new CommandExit(RESOLVE_REFUSE_EXIT, `❌ ${refusal}`);

  return runAttempts(run, detail, first);
}

/** What the attempt loop carries from one attempt to the next. */
interface AttemptState {
  /** The assessment the next attempt runs the plan of. */
  assessment: TriageAssessment;
  /** The log that assessment was read from; see the module note. */
  evidence: FailedLogEvidence | undefined;
  /** The latest reading of the pull request, which the report renders. */
  reading: TriageReading;
  /** What the attempt before this one ended as, or null before the first. */
  previous: AttemptOutcome | null;
  /** How many attempts have been spent. */
  spent: number;
  /** One line per attempt, for the report. */
  readonly lines: string[];
}

/** One ending of the attempt loop, built from the state it ended in. */
function ended(
  run: ResolveRun,
  state: AttemptState,
  parts: Pick<ResolveResult, 'ran' | 'resolved' | 'stop' | 'exitCode'> & { readonly lines: readonly string[] },
): ResolveResult {
  return {
    ran: parts.ran,
    resolved: parts.resolved,
    stop: parts.stop,
    attempts: state.spent,
    maxAttempts: run.maxAttempts,
    reading: state.reading,
    lines: [...state.lines, ...parts.lines],
    headline: parts.lines[0] ?? '',
    exitCode: parts.exitCode,
  };
}

/** The attempt loop itself; see the module note for the order inside one attempt. */
async function runAttempts(
  run: ResolveRun,
  detail: PullRequestDetail,
  first: TriageAssessment,
): Promise<ResolveResult> {
  const runLoop = run.runLoop ?? runResolveLoop;
  const state: AttemptState = {
    assessment: first,
    evidence: evidenceOf(run.reading),
    reading: run.reading,
    previous: null,
    spent: spentAttempts(run.reading.attempts),
    lines: [],
  };

  while (true) {
    const start = readAttemptStart({ stored: state.spent, maxAttempts: run.maxAttempts });
    if (start.stopped) {
      await writeResolveComment(run, detail, state.assessment, state.spent, false);
      const removal = closeWorktree(run, resolveWorktreePath(run.home, run.number));
      return ended(run, state, {
        ran: state.lines.length > 0,
        resolved: false,
        stop: start.stop,
        exitCode: RESOLVE_STOP_EXIT,
        lines: stopLines(run, start.reason, state, removal),
      });
    }

    run.output.info(attemptHeadline(run, state.assessment, start));
    const worktree = openWorktree(run, detail);
    state.spent = start.attempts;
    await writeResolveComment(run, detail, state.assessment, state.spent, false);

    const planPath = planFor(run, detail, state, state.spent);
    run.output.info(`   Running ${planPath}`);
    const loop = await runLoop({
      worktree,
      planPath,
      onLine: (line) => {
        run.output.info(line);
      },
    });
    if (!loop.ok) run.output.warn(`   ${loopProblem(loop)}`);

    const waited = await waitForCi(run);
    const end = await endOfAttempt(run, state, waited);
    if (end.unchanged !== null) run.output.warn(`   ${end.unchanged}`);
    state.reading = end.reading;
    state.assessment = end.assessment;
    state.evidence = end.evidence;

    if (end.green) {
      await writeResolveComment(run, detail, state.assessment, state.spent, true);
      return ended(run, state, {
        ran: true,
        resolved: true,
        stop: null,
        exitCode: 0,
        lines: [
          `✅ #${run.number} is green after ${String(state.spent)} of ${String(run.maxAttempts)} resolve attempts.`,
          closeWorktree(run, worktree),
        ],
      });
    }

    const repeat = readAttemptRepeat({
      previous: state.previous,
      outcome: end.outcome,
      attempts: state.spent,
      maxAttempts: run.maxAttempts,
    });
    state.previous = end.outcome;
    state.lines.push(`Attempt ${String(state.spent)} of ${String(run.maxAttempts)}: ${repeat.reason}.`);

    const reason = resolvable(end.assessment)
      ? null
      : noPlanReason(end.assessment.triageClass);
    if (!repeat.stopped && reason === null) continue;

    await writeResolveComment(run, detail, state.assessment, state.spent, false);
    const removal = closeWorktree(run, worktree);
    return ended(run, state, {
      ran: true,
      resolved: false,
      stop: repeat.stop,
      exitCode: RESOLVE_STOP_EXIT,
      lines: stopLines(run, reason ?? repeat.reason, end, removal),
    });
  }
}
