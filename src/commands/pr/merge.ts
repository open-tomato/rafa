/**
 * `rafa pr merge [<n>] [--yes] [--skip-checks] [--method=squash|merge|rebase]`:
 * the pull request merged through the provider, and the five git steps
 * after it run here, each one reported.
 *
 * `src/pr/merge.ts` holds what this refuses on and what the clean-up
 * is, both as data and neither of them spawning anything. This module
 * is the half that acts: it gathers what that reading decides from,
 * asks the one question, sends the merge, and walks the steps.
 *
 * ## The order, and why everything is gathered before anything is asked
 *
 * The line first, then the config and the provider, then the pull
 * request, its checks and the three git readings, the loop worktree
 * step, then ONE call to `readMergeRefusal`, and only then the question.
 * The git readings, the loop worktree step and that call are
 * `./merge-refuse.ts`'s `refuseFromGit`, whose module note names each
 * git command it reads. That step (`./merge-loop-worktree.ts`) frees a
 * clean, ended loop worktree holding the head branch, printing one line
 * and listing the worktrees again, and refuses on one that is not. Two
 * things follow:
 *
 *   - Nothing is asked and nothing is merged while any refusal stands,
 *     which is the spec's "refuse before it asks anything".
 *   - The refusal ORDER is `src/pr/merge.ts`'s alone. Gathering the
 *     working tree first and refusing on it before the provider is
 *     asked anything would save two `gh` calls on a dirty tree and put
 *     a second copy of that order here, where the two could drift. The
 *     calls are two round trips; the drift would be a refusal naming
 *     the wrong problem.
 *
 * ## What the checks reading leaves in the store
 *
 * Straight after the checks are read, before any refusal, the pull
 * request and the rows its checks answered go to `recordPlanCi`
 * (`src/effort/store/plan-ci.ts`), which stores one `plan_ci` row for a
 * settled verdict on a head branch that names a plan. So a merge refused
 * on red checks, or on none, still records what it read. A store that
 * refuses the row is warned about and never changes the exit code.
 *
 * ## The release guard
 *
 * Straight after `readMergeRefusal` and before the question, one call
 * hands the pull request to `./merge-guard.ts`, which reads the release
 * guard where the release runs and meets its answer as
 * `pr.versionCollision` and `dangerous.acceptVersionCollision` say:
 * printed, warned about, asked about, or refused with exit 1 — that
 * module's note has the table. Its question is asked before
 * `Merge? [y/N]`, `--yes` does not answer it, and a no to it declines
 * the merge the way a no to the merge question does. What it read is
 * {@link PrMergeResult.guard}, null where the release does not run.
 *
 * ## The question
 *
 * `rafa init` reads an answer only when standard input is a TTY and
 * refuses otherwise, and this follows that shape: the summary line goes
 * through the output, the question goes to stderr through the same
 * {@link Prompter} `init` uses, so a json-mode stdout stays NDJSON, and
 * `--yes` skips it. Without a TTY and without `--yes` the command
 * refuses with exit code 1 rather than waiting on an answer nobody can
 * type, and it refuses BEFORE the summary line is written, so that
 * refusal carries the summary once, indented, and leaves stdout empty.
 * An answer that is not `y` or `yes`, the empty answer included,
 * declines: the question is spelled `[y/N]` and the default is no. A
 * declined merge is not a failure — nothing was merged and nothing was
 * broken — so it ends 0, saying so.
 *
 * ## `--skip-checks`
 *
 * A pull request whose checks read verdict `none` — zero check rows — is
 * refused without the flag, and with it is the one verdict let past the
 * checks refusal; on `pending`, `red` or `green` the flag is itself
 * refused, naming each row (`readMergeRefusal`, which is handed the rows
 * and the flag). What the flag adds past that is `./merge-unchecked.ts`'s
 * and is called at the three points its module note names: the workflow
 * count read, the base's workflow files read through this module's git
 * runner, and the two refusals in place of {@link requireTerminal},
 * the warning and `Merge #<n> with no checks? [y/N]` in place of
 * `Merge? [y/N]`, and the one comment posted straight after the provider
 * merged, before the roadmap tick and the clean-up, so a clean-up that
 * fails cannot drop it. The merge, the clean-up, the follow-ups and the
 * unblock reading are this module's own and run as they do without the
 * flag. {@link PrMergeResult.unchecked} carries what the flag read and
 * posted, and is null without it.
 *
 * ## After the merge, nothing is undone
 *
 * A step that fails ends the command with exit code 1 carrying that
 * step, what git said, and the whole remaining tail as commands to
 * paste. It never reverts, resets or re-pushes: the pull request IS
 * merged by then, and the clean-up is housekeeping the operator can
 * finish by hand. The follow-ups are printed for a clean-up that
 * finished, since what they turn on — the version and the fragments now
 * on the base — is only true once the base has been pulled. They are
 * the last lines of the merge's own report, after the unblock reading
 * below, so `rafa release settle`, printed last among them when
 * fragments wait on the base (`./merge-followups.ts`), is the last line
 * the merge prints; only the ending hint, which `--no-hint` turns off,
 * comes after it.
 * The clean-up, its two branch probes and the follow-up reading are
 * `./merge-cleanup.ts`'s, whose module note says how each branch is
 * probed and on which remote; this module calls them in that order and
 * nothing else.
 *
 * ## The roadmap tick
 *
 * GitHub closes an issue the merged pull request says `Closes #<n>` for
 * and does not tick the `- [ ] #<n>` box naming it on the roadmap, so
 * this command ticks it (per the PR commands spec), on every open board
 * whose checklist lists it. The rule and the two `gh` calls per board are
 * `src/board/roadmap-tick.ts`'s and the decision to make them at all, and
 * on which boards, is `./merge-tick.ts`'s; what is decided HERE is WHEN, and
 * it is straight after the provider merged, before the clean-up. The
 * clean-up is local git and can fail, and a tick behind it would be the
 * one piece of the merge that a failed `git pull` silently dropped —
 * where the board write has nothing to do with this checkout and is as
 * true then as it is after. Before the boards, the closed issue's line
 * is ticked on the checklist of the epic its `epic:` label names, one
 * line printed per epic (`./merge-tick.ts`, `epicTickSentence`).
 *
 * Nothing it comes to fails the command, so a roadmap that cannot be
 * read, an edit that would not land and a pull request closing no issue
 * all leave the merge reported exactly as it happened.
 *
 * ## The unblock reading, and why it comes after the clean-up
 *
 * A merge that closes an issue can be the thing that clears another
 * issue's blocker, so after the clean-up the command runs the reading
 * `rafa issue unblock` runs, over every open issue whose `Blocked by:` line
 * names an issue this pull request closes (`./merge-unblock.ts`, per
 * the spec). Like the tick, nothing it comes to changes the exit code.
 *
 * Unlike the tick it runs after the clean-up, and only the follow-ups
 * come after it, for two reasons. It ASKS, and a question in the middle of the
 * clean-up would interleave with the step lines an operator is reading
 * to see whether their branches are gone. And where a step FAILED the
 * command is already exiting 1 with the remaining commands to paste, so
 * a question about somebody else's label on top of that is noise; the
 * label is no worse for staying on, and `rafa issue unblock` clears it
 * whenever the operator gets to it.
 *
 * `--yes` does NOT answer that question. It is declared as merging
 * without asking, and a flag that also took labels off the board would
 * write something its own description does not name; without a terminal
 * the reading asks nothing and writes nothing, as it does under `rafa
 * issue unblock`.
 *
 * ## Native mode
 *
 * Under `board.relationships: native` an epic is a sub-issue parent and a
 * blocker a blocked-by link, which GitHub clears by itself when the
 * blocking issue closes. So the epic checklist tick is left out
 * (`./merge-tick.ts`'s `epics`), the roadmap boards are ticked as above,
 * and in the unblock reading's place, after the clean-up, the command
 * prints the issues the merge freed, read from one board listing through
 * the relationships port's `freedBy`, asking nothing and writing nothing
 * (`./merge-freed.ts`). What that reading came to is the result's
 * `freed`, a key the `labels` mode leaves out; `unblocked` is null there.
 * The `labels` mode, the default, runs `./merge-tick.ts` and
 * `./merge-unblock.ts` exactly as above: they are what that mode's
 * `afterMerge` is (`src/board/relations/labels.ts`), called here at the
 * two points their own notes name.
 *
 * ## The project refresh
 *
 * Straight after that board reading and before the follow-ups, in both
 * modes, `./merge-project.ts` refreshes on the repository's project the
 * issues the pull request closes and the issues those were blocking,
 * sending nothing with `board.project.number` unset. Its lines are
 * warnings, and like the tick it never changes the exit code.
 *
 * ## The ending, on a merge that went through
 *
 * Last of all, after the follow-ups, the command names the one
 * step that follows — with the base pulled and both branches gone, that
 * is the next plan or the loop on a plan already there
 * (`src/next/ending.ts`, `--no-hint` to turn it off). A DECLINED merge
 * ends without one: nothing moved, so the state still reads as a green
 * pull request waiting to be merged, and the hint would put the very
 * question that was just answered no.
 *
 * ## Refusals
 *
 * `pr-context.ts`'s: exit 2 for a provider that is not `gh`, exit 1 for
 * a second word, a word that is no whole number from 1, a flag that
 * swallowed the number, a config that cannot be used, a branch that
 * cannot be read, a detached HEAD, and a branch with no open pull
 * request. Its own, all exit 1: a `--method` that is none of the three;
 * a number the repository has no pull request for; a git reading that
 * failed; a loop worktree holding the head branch that cannot be freed
 * or removed; each of the refusals `readMergeRefusal` answers, `--skip-checks`
 * on a pull request that reports checks among them; no terminal to ask
 * on and no `--yes`; `--yes` beside `--skip-checks` where workflows exist
 * and one may run on pull requests into the base, or their count could
 * not be read; the release guard's refusals; a
 * provider that would not merge; and a clean-up step that failed.
 */
import type { MergeStepReport } from './merge-cleanup.js';
import type { FollowUp } from './merge-followups.js';
import type { FreedReport } from './merge-freed.js';
import type { MergeGuardReport } from './merge-guard.js';
import type { UncheckedMerge, UncheckedMergeReport } from './merge-unchecked.js';
import type { PrContext, PrSeams, PullSource } from './pr-context.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { RoadmapTickResult } from '../../board/roadmap-tick.js';
import type { UnblockAsk, UnblockReport } from '../../board/unblock.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { Prompter } from '../../cli/prompt/confirm.js';
import type { PidProbe } from '../../loop/sessions.js';
import type { NextEndingSeams } from '../../next/ending.js';
import type { GitRunner, MergeMethod, PullRequestDetail } from '../../pr/index.js';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { commandRetrySeams } from '../../board/project/project-runner.js';
import { tickSentence } from '../../board/roadmap-tick.js';
import { closedIssuesIn } from '../../board/roadmap.js';
import { CommandExit } from '../../cli/command.js';
import { createLinePrompter } from '../../cli/prompt/confirm.js';
import { recordPlanCi } from '../../effort/store/plan-ci.js';
import { endWithNextStep, HINT_FLAG_SPEC } from '../../next/ending.js';
import {
  createGitRunner,
  isMergeMethod,
  MERGE_METHODS,
} from '../../pr/index.js';

import { cleanUpAfterMerge, INDENT, reportFollowUps } from './merge-cleanup.js';
import { freedAfterMerge } from './merge-freed.js';
import { guardBeforeMerge } from './merge-guard.js';
import { refreshProjectAfterMerge } from './merge-project.js';
import { refuseFromGit } from './merge-refuse.js';
import { epicTickSentence, noBoardListsLine, tickRoadmapAfterMerge } from './merge-tick.js';
import { unblockAfterMerge } from './merge-unblock.js';
import { commentIfUnchecked, confirmUncheckedMerge, readUncheckedMerge, uncheckedReport } from './merge-unchecked.js';
import {
  lineRefusal,
  onProvider,
  openPrContext,
  pickPullRequest,
  PR_USAGE,
  readBooleanFlag,
  readPullArgument,
} from './pr-context.js';

/** One clean-up step that ran; `./merge-cleanup.ts` reports it, and the result carries it. */
export type { MergeStepReport } from './merge-cleanup.js';

/** What `--skip-checks` read and posted; `./merge-unchecked.ts` makes it, and the result carries it. */
export type { UncheckedMergeReport } from './merge-unchecked.js';

/** The usage line this action's refusals name. */
const USAGE = PR_USAGE.merge;

/** The answers that mean yes to the question, which is spelled `[y/N]`. */
const YES_ANSWERS: readonly string[] = ['y', 'yes'];

/** How this action reaches git and the terminal, beside what every `pr` action reaches. */
export interface MergeSeams extends PrSeams {
  /** The git runner for a root. `createGitRunner` when left out. */
  readonly git?: (root: string) => GitRunner;
  /** The `gh` runner the roadmap tick sends its two calls through. `createGhRunner` when left out. */
  readonly gh?: (root: string) => GhRunner;
  /** True when a question can be answered. Standard input being a TTY when left out. */
  readonly isTerminal?: () => boolean;
  /** Opens the prompter the question is asked through. Called only to ask. */
  readonly openPrompter?: () => Prompter;
  /** How the ending hint reaches the state and the terminal. The system's own when left out. */
  readonly ending?: NextEndingSeams;
  /** The clock the release guard's forecast is dated by. The system's own when left out. */
  readonly now?: () => Date;
  /** Whether a loop record's pid is alive, for the update follow-up. `isPidAlive` when left out. */
  readonly isAlive?: PidProbe;
}

/** The seams the registered command runs with: the system's own, every one. */
export const DEFAULT_MERGE_SEAMS: MergeSeams = Object.freeze({});

/** What json mode gives as the terminal result's `data`. */
export interface PrMergeResult {
  readonly number: number;
  /** `argument` when `<n>` named it, `branch` when the checked-out branch did. */
  readonly source: PullSource;
  /** The head branch, which the clean-up deletes. */
  readonly branch: string;
  /** The base branch, which the clean-up switches to and pulls. */
  readonly base: string;
  readonly method: MergeMethod;
  /** The line the question was asked under. */
  readonly summary: string;
  /** True when the provider merged it. */
  readonly merged: boolean;
  /** True when the question was answered with anything but yes. */
  readonly declined: boolean;
  /** What the provider said about the merge, empty when it said nothing. */
  readonly detail: string;
  /** Each clean-up step that ran or was skipped, in order; empty for a declined merge. */
  readonly steps: readonly MergeStepReport[];
  /** The follow-ups that apply, settle last; empty when neither does. */
  readonly followUps: readonly FollowUp[];
  /** What the tick of the first board in `roadmapTicks` came to, the default board's when it was ticked; null when none was. */
  readonly roadmapTick: RoadmapTickResult | null;
  /** What the tick of every board listing a closed issue came to, or null when the pull request closes no issue. */
  readonly roadmapTicks: readonly RoadmapTickResult[] | null;
  /** What the unblock reading came to, or null when the pull request closes no issue or the mode is `native`. */
  readonly unblocked: UnblockReport | null;
  /** What the freed-issue reading came to under `native`, null when it closes no issue; left out in `labels`. */
  readonly freed?: FreedReport | null;
  /** What `--skip-checks` read and posted, or null when the flag was not given. */
  readonly unchecked: UncheckedMergeReport | null;
  /** What the release guard answered and how the merge met it, or null where the release does not run. */
  readonly guard: MergeGuardReport | null;
}

/** A refusal of this action with exit code 1. */
function refusal(lines: readonly string[]): CommandExit {
  return new CommandExit(1, lines.join('\n'));
}

/**
 * The merge method `--method` names, or null when the line named none,
 * which reads `pr.mergeMethod`. Any other value is refused naming the
 * three GitHub takes.
 */
export function readMethodFlag(flags: RafaContext['flags'], usage: string): MergeMethod | null {
  const value = flags['method'];
  if (value === undefined) return null;
  if (isMergeMethod(value)) return value;
  const spelled = typeof value === 'boolean'
    ? '--method with no value'
    : `"${value}"`;
  throw lineRefusal(`${spelled} is no merge method; one of: ${MERGE_METHODS.join(', ')}`, usage);
}

/** The line the question is asked under: the pull request, its branches and the method. */
export function summaryLine(detail: PullRequestDetail, method: MergeMethod): string {
  const title = detail.title.trim();
  const head = title === ''
    ? `#${detail.number}`
    : `#${detail.number} ${title}`;
  return `${head} — ${detail.headRefName} → ${detail.baseRefName} — ${method}`;
}

/** True when a question can be answered: the seam's reading, or standard input being a TTY. */
function terminalOf(seams: MergeSeams): () => boolean {
  return seams.isTerminal ?? ((): boolean => process.stdin.isTTY === true);
}

/**
 * Refuses when there is no terminal to ask on. Read BEFORE the summary
 * line is written, so the refusal carries it once and the run that
 * cannot be answered writes nothing to stdout.
 */
function requireTerminal(seams: MergeSeams, summary: string): void {
  if (terminalOf(seams)()) return;
  throw refusal([
    '❌ rafa pr merge asks before merging, and standard input is no terminal.',
    `${INDENT}${summary}`,
    'Merge it without the question with --yes.',
  ]);
}

/** An answer to a question spelled `[y/N]`: yes for `y` or `yes`, however it is cased and padded. */
function isYes(answer: string | null): boolean {
  return answer !== null && YES_ANSWERS.includes(answer.trim().toLowerCase());
}

/** Opens the prompter a question is asked through; the system's own when the seams name none. */
function prompterOf(seams: MergeSeams): () => Prompter {
  return seams.openPrompter ?? ((): Prompter => createLinePrompter(process.stdin, process.stderr));
}

/** Whether the operator answered the question with yes. */
async function confirmed(seams: MergeSeams): Promise<boolean> {
  const prompter = prompterOf(seams)();
  try {
    return isYes(await prompter.ask('Merge? [y/N] '));
  } finally {
    prompter.close();
  }
}

/** The `gh` runner the board reads and writes after the merge go through, at the project root. */
function openGh(pr: PrContext, seams: MergeSeams): GhRunner {
  return (seams.gh ?? ((root: string) => createGhRunner({ cwd: root })))(pr.project.root);
}

/**
 * Asks one unblock question through a prompter of its own, or null
 * where there is no terminal to ask on. Opened per question rather
 * than per run, as {@link confirmed} opens one, so a merge that
 * unblocks nothing opens none.
 */
function unblockAsk(seams: MergeSeams): UnblockAsk | null {
  if (!terminalOf(seams)()) return null;

  const open = prompterOf(seams);
  return async (question: string): Promise<boolean> => {
    const prompter = open();
    try {
      return isYes(await prompter.ask(question));
    } finally {
      prompter.close();
    }
  };
}

/**
 * Runs the unblock reading over the issues this merge closed and
 * prints what it came to; see the module note. Every failure is a
 * warning and nothing else.
 */
async function reportUnblock(
  context: RafaContext,
  pr: PrContext,
  seams: MergeSeams,
  detail: PullRequestDetail,
): Promise<UnblockReport | null> {
  return unblockAfterMerge({
    body: detail.body,
    gh: openGh(pr, seams),
    ask: unblockAsk(seams),
    info: (message: string): void => {
      context.output.info(message);
    },
    warn: (message: string): void => {
      context.output.warn(message);
    },
  });
}

/**
 * Ticks each epic and every board listing an issue the merge that just
 * went through closes and prints the one line each came to; see the
 * module note. A tick that could not be written is a warning and nothing else.
 */
async function reportTick(
  context: RafaContext,
  pr: PrContext,
  seams: MergeSeams,
  detail: PullRequestDetail,
): Promise<readonly RoadmapTickResult[] | null> {
  const warn = (message: string): void => {
    context.output.warn(message);
  };
  const tick = await tickRoadmapAfterMerge({
    body: detail.body,
    configured: pr.roadmapIssue,
    gh: openGh(pr, seams),
    warn,
    epics: pr.relationships !== 'native',
    epicTicked: (epic) => {
      if (epic.status === 'failed') warn(epicTickSentence(epic));
      else context.output.info(epicTickSentence(epic));
    },
  });
  if (tick === null) return null;
  if (tick.length === 0) context.output.info(noBoardListsLine(closedIssuesIn(detail.body)));

  for (const board of tick) {
    if (board.status === 'failed') warn(tickSentence(board));
    else context.output.info(tickSentence(board));
  }
  return tick;
}

/**
 * The board reading after the clean-up: the unblock reading in `labels`,
 * the freed issues in `native`, the result's key for which it adds; see
 * the module note. Every failure is a warning and nothing else.
 */
async function reportAfterCleanUp(
  context: RafaContext,
  pr: PrContext,
  seams: MergeSeams,
  detail: PullRequestDetail,
): Promise<Pick<PrMergeResult, 'unblocked' | 'freed'>> {
  if (pr.relationships !== 'native') return { unblocked: await reportUnblock(context, pr, seams, detail) };
  const freed = await freedAfterMerge({
    body: detail.body,
    gh: openGh(pr, seams),
    info: (message: string): void => {
      context.output.info(message);
    },
    warn: (message: string): void => {
      context.output.warn(message);
    },
  });
  return { unblocked: null, freed };
}

/** What {@link askToMerge} decided: whether to merge, and what `--skip-checks` read when it was given. */
interface MergeAnswer {
  readonly go: boolean;
  readonly unchecked: UncheckedMerge | null;
}

/** What {@link askToMerge} is asked about: the pull request, the flags, and its base and git for `--skip-checks`. */
interface UncheckedAsk {
  readonly number: number;
  readonly summary: string;
  readonly yes: boolean;
  readonly skipChecks: boolean;
  readonly base: string;
  readonly git: GitRunner;
}

/**
 * Makes the terminal refusals, writes the summary line, and asks — the
 * unchecked question where `--skip-checks` was given, `Merge? [y/N]`
 * otherwise — with `--yes` answering where it may; see the module note.
 */
async function askToMerge(
  context: RafaContext,
  pr: PrContext,
  seams: MergeSeams,
  ask: UncheckedAsk,
): Promise<MergeAnswer> {
  const { number, summary, yes, skipChecks, base, git } = ask;
  const unchecked = skipChecks
    ? await readUncheckedMerge({ pulls: pr.pulls, number, yes, summary, isTerminal: seams.isTerminal, base, git })
    : null;
  if (unchecked === null && !yes) requireTerminal(seams, summary);
  context.output.info(summary);

  if (unchecked !== null) {
    const warn = (message: string): void => {
      context.output.warn(message);
    };
    return { go: await confirmUncheckedMerge(unchecked, { warn, openPrompter: seams.openPrompter }), unchecked };
  }
  return { go: yes || await confirmed(seams), unchecked };
}

/** Merges the pull request and cleans up after it, reporting each line; see the module note. */
export async function runMerge(context: RafaContext, seams: MergeSeams): Promise<PrMergeResult> {
  const yes = readBooleanFlag(context.flags, 'yes', USAGE);
  const skipChecks = readBooleanFlag(context.flags, 'skip-checks', USAGE);
  const wanted = readMethodFlag(context.flags, USAGE);
  const asked = readPullArgument(context.args, USAGE);
  const pr = openPrContext(context, seams);
  const git = (seams.git ?? createGitRunner)(pr.project.root);
  const method = wanted ?? pr.mergeMethod;

  const pick = await pickPullRequest(pr, asked, USAGE);
  const detail = await onProvider(`read pull request #${pick.number}`, () => pr.pulls.get(pick.number));
  if (detail === null) {
    throw lineRefusal(`No pull request #${pick.number} at ${pr.project.root}`, USAGE);
  }
  const checks = await onProvider(`read the checks of #${pick.number}`, () => pr.pulls.checks(pick.number));
  recordPlanCi({
    repoRoot: pr.project.root,
    planDir: pr.planDir,
    pullRequest: detail,
    rows: checks.rows,
    warn: (message) => {
      context.output.warn(message);
    },
  });
  refuseFromGit({ git, pr, seams, info: (message) => context.output.info(message) }, detail, checks, skipChecks);
  const guard = await guardBeforeMerge({
    pr,
    git,
    detail,
    now: (seams.now ?? ((): Date => new Date()))(),
    info: (message) => {
      context.output.info(message);
    },
    warn: (message) => {
      context.output.warn(message);
    },
    isTerminal: terminalOf(seams),
    openPrompter: prompterOf(seams),
  });

  const summary = summaryLine(detail, method);
  const answer: MergeAnswer = guard.go
    ? await askToMerge(context, pr, seams, { number: detail.number, summary, yes, skipChecks, base: detail.baseRefName, git })
    : { go: false, unchecked: null };
  // What the run answers if it stops here, and the base of what it answers if it does not.
  const answered: PrMergeResult = {
    number: detail.number,
    source: pick.source,
    branch: detail.headRefName,
    base: detail.baseRefName,
    method,
    summary,
    merged: false,
    declined: true,
    detail: '',
    steps: [],
    followUps: [],
    roadmapTick: null,
    roadmapTicks: null,
    unblocked: null,
    unchecked: uncheckedReport(answer.unchecked, null),
    guard: guard.report,
  };
  if (!answer.go) {
    context.output.info('Nothing was merged.');
    return answered;
  }

  const outcome = await onProvider(`merge #${detail.number}`, () => pr.pulls.merge(detail.number, method));
  if (!outcome.merged) {
    throw refusal([`❌ ${pr.pulls.kind} would not merge #${detail.number}: ${outcome.detail}`]);
  }
  context.output.info(`Merged #${detail.number} into ${detail.baseRefName} (${method}).`);
  const warn = (message: string): void => {
    context.output.warn(message);
  };
  const info = (message: string): void => {
    context.output.info(message);
  };
  const commentUrl = await commentIfUnchecked(pr.pulls, detail.number, answer.unchecked, { info, warn });
  const roadmapTicks = await reportTick(context, pr, seams, detail);

  const steps = cleanUpAfterMerge(git, detail, { info, warn });
  const board = await reportAfterCleanUp(context, pr, seams, detail);
  await refreshProjectAfterMerge({
    body: detail.body,
    config: pr.projectRefresh,
    openGh: () => openGh(pr, seams),
    unblocked: board.unblocked,
    warn,
    retry: commandRetrySeams(context.output, context.outputMode),
  });
  const followUps = reportFollowUps(
    {
      root: pr.project.root,
      home: pr.project.home,
      base: detail.baseRefName,
      release: pr.versionGuard,
      isAlive: seams.isAlive,
    },
    git,
    info,
  );

  return {
    ...answered,
    merged: true,
    declined: false,
    detail: outcome.detail,
    steps,
    followUps,
    roadmapTick: roadmapTicks?.[0] ?? null,
    roadmapTicks,
    ...board,
    unchecked: uncheckedReport(answer.unchecked, commentUrl),
  };
}

/** The command, reaching the provider, git and the terminal through `seams`; see the module note. */
export function createPrMergeCommand(seams: MergeSeams = DEFAULT_MERGE_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'pr merge',
    subject: 'pr',
    action: 'merge',
    summary: 'merge a pull request and clean up both branches',
    description: 'Merges one pull request through the GitHub CLI and then, in code, switches to the base branch,'
      + ' pulls it fast-forward only, deletes the head branch locally and on the remote where it is still there,'
      + ' and prunes, reporting each step; a head branch this checkout has no local branch for is reported as a'
      + ' skipped local delete, and the rest still run. Refuses before it asks anything on a tracked change in the working tree or an'
      + ' untracked path the pull request\'s head or the base\'s remote-tracking branch holds, on a pull'
      + ' request that is not green or does not merge, and on a head branch checked out in another worktree, except a'
      + ' clean, ended loop worktree under `loop.worktreeDir`, which it removes after copying its two plan files out. It'
      + ' shows the pull request, its branches and the method and asks `Merge? [y/N]`; `--yes` skips the question,'
      + ' and without a terminal and without `--yes` it refuses. A pull request that reports no checks at all is'
      + ' refused unless `--skip-checks` is given, which is refused on any pull request that does report checks;'
      + ' with it the command reads how many workflows the repository defines, prints a warning for that case, asks'
      + ' `Merge #<n> with no checks? [y/N]` (which `--yes` answers only where the repository defines no workflow, or'
      + ' where no workflow file on the base has a `pull_request` trigger naming it),'
      + ' and after the merge posts one comment on the pull request saying so. Where the release runs, the release'
      + ' guard reads the branch before the question: a `collision` is refused unless'
      + ' `dangerous.acceptVersionCollision` is true, and `pr.versionCollision` sets whether a `missing` or'
      + ' `stale` branch merges silently, with a warning, after its own question, or not at all. A step that fails never undoes the merge: it'
      + ' prints what is left as commands to paste and exits 1. After the merge it ticks the `Closes #<n>` line of'
      + ' every issue the pull request closes on every open board whose checklist lists it, or on the roadmap issue while no issue carries `type:roadmap`, warning rather than failing when that write'
      + ' does not land. It ends by reading every open issue whose "Blocked by:" line names an issue this pull'
      + ' request closes, asking whether to remove `spec:blocked` from each one whose blockers have all closed;'
      + ' `--yes` does not answer that question, and every failure of that reading is a warning. With'
      + ' board.relationships set to native it ticks no epic checklist and, in place of that reading, prints the'
      + ' open issues the merge freed, whose blockers GitHub clears by itself, asking nothing and writing nothing. With'
      + ' `--output=json` the pull request, the method, the steps that ran, the follow-ups, the roadmap tick and'
      + ' the unblock reading, or the freed issues in native mode, are the data of the terminal result event. Refuses with exit code 2 where'
      + ' `pr.provider` is not `gh`.',
    args: [
      {
        name: 'n',
        description: 'The pull request number. The open pull request of the current branch when it is left out.',
        type: 'number',
      },
    ],
    flags: [
      {
        name: 'yes',
        description: 'Merge without asking. Needed where standard input is no terminal.',
        type: 'boolean',
      },
      {
        name: 'skip-checks',
        description: 'Merge a pull request that reports no checks at all, after a warning and its own question.'
          + ' Refused where the pull request reports any check; `--yes` beside it is refused where the repository'
          + ' defines a workflow that may run on pull requests into the base, or its workflow count could not be read.',
        type: 'boolean',
      },
      {
        name: 'method',
        description: 'How to merge: squash, merge or rebase. `pr.mergeMethod` when it is left out.',
        type: 'string',
      },
      HINT_FLAG_SPEC,
    ],
    examples: [
      {
        cmd: 'rafa pr merge',
        note: 'Asks, then merges the open pull request of the branch checked out at the project root.',
      },
      {
        cmd: 'rafa pr merge 41 --yes',
        note: 'Merges pull request 41 without asking, then runs the clean-up.',
      },
      {
        cmd: 'rafa pr merge 41 --skip-checks',
        note: 'Warns that nothing on GitHub tested pull request 41, asks, merges it and comments that it had no checks.',
      },
      {
        cmd: 'rafa pr merge 41 --method=rebase --output=json',
        note: 'Merges by rebase and writes a result event holding each clean-up step and the follow-ups.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const merged = await runMerge(context, seams);
      if (context.outputMode === 'json') context.output.result(merged);
      // A declined merge left the project where it was; see the module note.
      if (merged.merged) await endWithNextStep(context, seams.ending);
    },
  };
  return Object.freeze(command);
}

export default createPrMergeCommand();
