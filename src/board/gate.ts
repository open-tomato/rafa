/**
 * What a `not-ready` verdict does: the plan and prerequisites files
 * moved into `rejected/` under `plan.dir`, the gaps posted on the
 * issue, `spec:ready` swapped for `spec:needs-work`, and exit code 3.
 *
 * This is the enforcing half of check 3 of the readiness gate. The
 * reading half is `./spec-review.ts`, which turns a planner session's
 * output into one of four answers, and the planner adapter
 * (`src/adapters/planner/claude.ts`) carries that reading back on every
 * answer a session stands behind. NOTHING in either of those acts on
 * the verdict, on purpose: the gate is the command's, which is what
 * lets `--skip-review` weigh a verdict the planner still read.
 *
 * ## A review nobody wrote is not a spec nobody can plan from
 *
 * Until 2026-09-20 an `absent` or `malformed` reading was enforced as a
 * `not-ready` verdict is: the plan taken away, the gaps posted, the
 * label swapped. That took away a valid 22-task plan of this repository's own,
 * over a prompt that asked for the block where a `-p` session's final
 * message has no place to put it (`./spec-review.ts` holds that
 * reading). A session that returned no readable block has said nothing
 * ABOUT THE SPEC, and posting "the review block was not returned" on
 * the issue bills the spec's author for the session's silence.
 *
 * So an unread review is weighed against the PLAN instead, by
 * `rafa plan validate`'s own reader ({@link validatePlan}) over the
 * file the session wrote. A plan the parser reads as written stands:
 * one warning ({@link unreadReviewWarning}), no comment, no label
 * change, nothing moved, and `unread` answered so the caller records
 * `review: missing` in its `rafa:plan` block (`src/plan.ts`,
 * `./review-stamp.ts`). Removal, the comment and the label swap are an
 * explicit `verdict: not-ready`'s alone.
 *
 * The AGENT half of `rafa plan validate` is not run here. It resolves a
 * roster from the project the dispatcher found and the config that
 * loads there, and this module is handed neither; what is checked is
 * the parser's issues, which are what says whether the plan reads as
 * written. A plan whose `agent=` resolves nowhere is caught by
 * `loop start`'s preflight, which is where that check halts a run.
 *
 * Reading as written is all the parser reporting no issue says, and no
 * more: a file holding no `rafa:plan` block at all reports none either
 * and stands here (`./gate.test.ts`), and it is the caller's
 * `review: missing` stamp that then finds no block to record in and
 * warns, keeping the plan (`./review-stamp.test.ts`, `src/plan.ts`).
 *
 * A plan that does NOT read as written cannot stand either, and no
 * session judged the spec, so nothing is published for it: the two
 * files are moved aside, every issue the parser reported is named, and the
 * command ends at {@link SPEC_NOT_READY_EXIT} with
 * {@link unreadReviewMessage}.
 *
 * ## The session is not trusted to have written no plan
 *
 * The prompt tells a session that judged a spec not ready to write no
 * plan, and the spec says the loop enforces that in CODE, because a
 * prompt is an instruction and not a guarantee. So
 * {@link enforceSpecReview} MOVES `PLAN-<stub>.md` and
 * `PREREQUISITES-<stub>.md` out of `plan.dir` and into its `rejected/`
 * subdirectory when they are there, and says so. A plan left in place
 * would be picked up by the next `rafa loop start` as an
 * ordinary plan, and nothing downstream would know it was written
 * against a spec its own planner had refused.
 *
 * Nothing here deletes: a planning session costs money, so a rejected
 * plan is kept under {@link REJECTED_DIR} where an operator can read
 * it. The move is bounded: exactly the two paths the caller names,
 * each resolved under the repository root, each moved only when it is
 * a file that exists, and only on a reading that is not ready.
 *
 * ## What a failed write does NOT do
 *
 * The comment and the label swap are reported through the output and
 * their failures are WARNINGS: neither changes the exit code, and
 * neither stops the other. The verdict is the finding, and the comment
 * and the labels are how it is published; a network failure while
 * publishing must not turn "this spec is not ready" into "something
 * went wrong", which is what would happen if the write's own rejection
 * escaped and took the exit code with it. The gaps are in the refusal
 * message either way, so an operator whose comment did not land still
 * reads every one of them.
 *
 * ## What the two flags do
 *
 * `--skip-review` bypasses check 3 ALONE: the caller never reaches this
 * module, and the plan it keeps records `review: skipped`
 * (`./review-stamp.ts`). `--no-comment` suppresses the COMMENT alone,
 * the flag's own scope and the one `rafa pr triage` gives it: the files
 * are still moved aside, the labels still move, and the gaps are still
 * printed, because the refusal message carries them.
 *
 * Both are read off the command line by {@link readGateFlags} rather
 * than by `src/plan.ts`, which is where the flags a wrapped phase 0
 * command declares are otherwise read, and both are DECLARED on
 * `src/commands/plan/create.ts`. `src/commands/index.test.ts` holds
 * that command's declared flags equal to the quoted `--` literals of
 * the modules reading its line, and the words themselves live in
 * `./flags.ts` for that case to read, which is why neither is spelled
 * here: this module holds what they DO.
 *
 * ## An issue is optional, because `--spec` has none
 *
 * `--spec=<file>` runs the same first pass and prints the gaps; it has
 * no labels to move and no issue to comment on. So {@link GateIssue} is
 * null for that route and every board write is skipped, while the
 * move, the printed gaps and exit code 3 are the same. The issue
 * routes, `--issue` and `--next`, fill it with the number and the board
 * `./plan-spec.ts` answers beside the spec.
 */
import type { IssueBoard } from './issue-board.js';
import type { SpecReviewGap, SpecReviewReading } from './spec-review.js';
import type { BoardTrust } from './trust.js';
import type { Output } from '../ports/index.js';

import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { activeOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { issueLine } from '../commands/plan/plan-files.js';
import { validatePlan } from '../commands/plan/validate.js';
import { messageOf } from '../config-sections.js';

import { NO_COMMENT_FLAG, SKIP_REVIEW_FLAG } from './flags.js';
import { SPEC_READY_LABEL } from './readiness.js';
import { specReviewCommentBody, writeSpecReviewComment } from './review-comment.js';

/** The issue the gate publishes a refusal on, and the board it goes through. */
export interface GateIssue {
  /** The issue number the spec was read off. */
  readonly number: number;
  /** The board the comment and the label swap go through. */
  readonly board: IssueBoard;
  /**
   * What the author of a marker comment already on the issue is read
   * through, so the gate never edits one a stranger planted
   * (`./review-comment.ts`).
   */
  readonly trust: BoardTrust;
}

/** What {@link enforceSpecReview} is asked. */
export interface SpecReviewGateOptions {
  /**
   * What the planner's session said about the spec, or undefined when
   * no session judged it; see {@link enforceSpecReview}.
   */
  readonly review: SpecReviewReading | undefined;
  /** What the refusal calls the spec: `issue #20`, or a spec file's path. */
  readonly source: string;
  /** The repository the two paths are resolved under. */
  readonly repoRoot: string;
  /** The plan the session was told to write, as the planner names it. */
  readonly planPath: string;
  /** The prerequisites file beside it, as the planner names it. */
  readonly prerequisitesPath: string;
  /** The issue to publish on, or null for a spec read off a file. */
  readonly issue: GateIssue | null;
  /** False under `--no-comment`: the gaps are printed and not posted. */
  readonly comment: boolean;
  /** Where the lines go; the active output when left out. */
  readonly output?: Output;
}

/** The exit code a spec the planner judged not ready ends with; the spec's own. */
export const SPEC_NOT_READY_EXIT = 3;

/** The label the gate puts on an issue whose spec it refused. */
export const SPEC_NEEDS_WORK_LABEL = 'spec:needs-work';

/**
 * The three ways a plan comes through the gate, in the order
 * {@link enforceSpecReview} weighs them: a verdict that judged the spec
 * ready, a planner that judged nothing, and a session whose review
 * could not be read over a plan that reads as written. Everything else
 * is a refusal and never an answer.
 */
export const SPEC_REVIEW_STANDINGS = ['ready', 'unjudged', 'unread'] as const;

/** One of {@link SPEC_REVIEW_STANDINGS}. */
export type SpecReviewStanding = (typeof SPEC_REVIEW_STANDINGS)[number];

/**
 * The two flags this module reads, re-exported: the readings and the
 * refusals are this module's, and the words are `./flags.js`'s, which
 * records why they sit there.
 */
export { NO_COMMENT_FLAG, SKIP_REVIEW_FLAG };

/** What the command line said about the gate. */
export interface GateFlags {
  /** True when `--skip-review` was given: check 3 is not run. */
  readonly skipReview: boolean;
  /** False when `--no-comment` was given: the gaps are printed and not posted. */
  readonly comment: boolean;
}

/**
 * The gate's two flags, read off the words a command was handed. Both
 * are bare words: neither takes a value.
 */
export function readGateFlags(args: readonly string[]): GateFlags {
  return {
    skipReview: args.includes(SKIP_REVIEW_FLAG),
    comment: !args.includes(NO_COMMENT_FLAG),
  };
}

/** One gap, as the refusal names it. */
function describeGap(gap: SpecReviewGap): string {
  return `   • "${gap.heading}": ${gap.what}`;
}

/** What the operator does next, which differs by whether labels moved. */
function remedyFor(issue: GateIssue | null): string {
  return issue === null
    ? '   Close the gaps in the spec, then plan from it again.'
    : `   Close the gaps, label the issue ${SPEC_READY_LABEL} again, and plan from it again.`;
}

/**
 * The refusal a not-ready review ends the command with: what the
 * reading said, every gap on its own line, and what to do about it.
 *
 * `source` is the caller's name for the spec — `issue #20`, or a spec
 * file's path — as `./readiness.ts` and `./leak.ts` take one.
 */
export function specNotReadyMessage(
  source: string,
  reading: string,
  gaps: readonly SpecReviewGap[],
  issue: GateIssue | null = null,
): string {
  return [
    `❌ ${source} is not ready to plan from: ${reading}`,
    ...gaps.map(describeGap),
    remedyFor(issue),
  ].join('\n');
}

/**
 * The one warning a plan that stands on an unread review leaves behind:
 * what the reading said, and what the plan reader found instead.
 *
 * `reading` is `SpecReviewReading.text`, and `planPath` is the plan as
 * the planner names it.
 */
export function unreadReviewWarning(reading: string, planPath: string): string {
  return `${reading}; ${planPath} reads as written, so the plan stands unreviewed`;
}

/**
 * The refusal an unread review over a plan that does NOT read as
 * written ends the command with: what the reading said, every issue the
 * plan parser reported, and what to do about it.
 *
 * No gap is published for it and no label moves: nothing judged the
 * spec, so there is nothing to tell the spec's author. The module note
 * holds why.
 */
export function unreadReviewMessage(
  source: string,
  reading: string,
  planIssues: readonly string[],
): string {
  return [
    `❌ ${source}: no plan stands — ${reading}, and the plan the session wrote does not read as written:`,
    ...planIssues.map((line) => `   ${line}`),
    '   Plan from the spec again.',
  ].join('\n');
}

/** True when `path`, under `repoRoot`, is a file that is there. */
function isWrittenFile(repoRoot: string, path: string): boolean {
  const full = resolve(repoRoot, path);
  return existsSync(full) && statSync(full).isFile();
}

/** Why the files were moved aside, as the line reporting each move ends. */
const NOT_READY_REASON = 'the planner judged the spec not ready, so no plan stands.';

/** Why an unread review over an unreadable plan moves them aside. */
const UNREAD_REASON = 'no review came back and the plan does not read as written, so no plan stands.';

/**
 * The directory a rejected plan is moved into: `rejected/` beside the
 * file itself, which is `<plan.dir>/rejected` for every path the
 * caller names, since the planner writes both files under `plan.dir`.
 */
export const REJECTED_DIR = 'rejected';

/** Where `path` lands once the gate refuses it, as the report names it. */
export function rejectedPath(path: string): string {
  const parent = dirname(path);
  return parent === '.'
    ? join(REJECTED_DIR, basename(path))
    : join(parent, REJECTED_DIR, basename(path));
}

/**
 * Moves the files a session wrote against a refusal into
 * {@link REJECTED_DIR}, reporting each. A planning session costs money,
 * so a rejected plan is kept where an operator can read it rather than
 * deleted; what matters downstream is that it is no longer under
 * `plan.dir` itself, where the next `rafa loop start` would pick it up.
 *
 * An existing file of that name in `rejected/` is overwritten, which is
 * `renameSync`'s own behaviour: the newest rejection of a stub is the
 * one worth keeping.
 */
function moveWritten(options: SpecReviewGateOptions, output: Output, reason: string): void {
  for (const path of [options.planPath, options.prerequisitesPath]) {
    if (!isWrittenFile(options.repoRoot, path)) continue;
    const destination = rejectedPath(path);
    try {
      mkdirSync(resolve(options.repoRoot, dirname(destination)), { recursive: true });
      renameSync(resolve(options.repoRoot, path), resolve(options.repoRoot, destination));
      output.info(`🗃  Moved ${path} to ${destination}: ${reason}`);
    } catch (error) {
      output.warn(`${path} was written against a refused review and could not be moved: ${messageOf(error)}`);
    }
  }
}

/** What `plan validate`'s reader made of the plan a session wrote. */
interface PlanReading {
  /** True when the plan parser reported no issue at all. */
  readonly reads: boolean;
  /** One line per issue, as `plan validate` writes them, or why there is no reading. */
  readonly issues: readonly string[];
}

/**
 * The plan the session wrote, read as `rafa plan validate` reads one:
 * its parser issues, and nothing about the agents its tasks name; the
 * module note holds why that half is left out.
 *
 * Never throws. A plan that is not there, and one the reader refused,
 * are both readings that do not stand, carrying what was in the way.
 */
function readWrittenPlan(options: SpecReviewGateOptions): PlanReading {
  const { repoRoot, planPath } = options;
  if (!isWrittenFile(repoRoot, planPath)) {
    return { reads: false, issues: [`${planPath}: the session wrote no plan there`] };
  }
  try {
    const { issues } = validatePlan(resolve(repoRoot, planPath));
    return { reads: issues.length === 0, issues: issues.map((issue) => issueLine(planPath, issue)) };
  } catch (error) {
    return { reads: false, issues: [`${planPath}: ${messageOf(error)}`] };
  }
}

/**
 * What an `absent` or `malformed` reading does: the plan stands when it
 * reads as written, and is refused with every parser issue when it does
 * not. Nothing is published either way.
 */
function standOrRefuse(
  options: SpecReviewGateOptions,
  review: SpecReviewReading,
  output: Output,
): SpecReviewStanding {
  const plan = readWrittenPlan(options);
  if (plan.reads) {
    output.warn(unreadReviewWarning(review.text, options.planPath));
    return 'unread';
  }

  moveWritten(options, output, UNREAD_REASON);
  throw new CommandExit(
    SPEC_NOT_READY_EXIT,
    unreadReviewMessage(options.source, review.text, plan.issues),
  );
}

/** Posts or edits the gaps comment, reporting what it did or why it could not. */
async function publishGaps(
  issue: GateIssue,
  gaps: readonly SpecReviewGap[],
  output: Output,
): Promise<void> {
  try {
    const write = await writeSpecReviewComment({
      issue: issue.number,
      body: specReviewCommentBody(gaps),
      board: issue.board,
      trust: issue.trust,
    });
    for (const passed of write.ignored) output.warn(passed.reason);
    output.info(`💬 ${write.action === 'posted'
      ? 'Posted'
      : 'Edited'} the review comment on issue #${String(issue.number)}.`);
  } catch (error) {
    output.warn(`the review comment on issue #${String(issue.number)} was not written: ${messageOf(error)}`);
  }
}

/** Swaps the labels, reporting what it did or why it could not. */
async function swapLabels(issue: GateIssue, output: Output): Promise<void> {
  try {
    await issue.board.swapLabels(issue.number, SPEC_READY_LABEL, SPEC_NEEDS_WORK_LABEL);
    output.info(
      `🏷  Swapped ${SPEC_READY_LABEL} for ${SPEC_NEEDS_WORK_LABEL} on issue #${String(issue.number)}.`,
    );
  } catch (error) {
    output.warn(
      `${SPEC_READY_LABEL} was not swapped for ${SPEC_NEEDS_WORK_LABEL} on issue`
        + ` #${String(issue.number)}: ${messageOf(error)}`,
    );
  }
}

/**
 * Lets a review the plan stands on through, and enforces one it does
 * not, answering which of {@link SPEC_REVIEW_STANDINGS} it was.
 *
 * Answers `ready` for a verdict that judged the spec ready, and
 * `unjudged` for a review the caller left out: a planner that read no
 * session output has judged nothing, and the `review` field of
 * `GeneratedPlan` is optional for exactly that reason.
 *
 * An `absent` or `malformed` reading is weighed against the plan the
 * session wrote. One that reads as written answers `unread` after one
 * warning, with nothing moved, nothing posted and no label moved, for
 * the caller to record `review: missing` on; one that does not is
 * refused with `CommandExit({@link SPEC_NOT_READY_EXIT},
 * {@link unreadReviewMessage})` after the two files are moved into
 * {@link REJECTED_DIR}.
 *
 * An explicit `not-ready` verdict moves the two files aside, publishes the
 * gaps, swaps the labels and throws
 * `CommandExit({@link SPEC_NOT_READY_EXIT}, {@link specNotReadyMessage})`.
 *
 * Which rejections of the planner carry a reading worth enforcing is
 * the caller's decision, not this module's; `src/plan.ts` records the
 * one it makes.
 */
export async function enforceSpecReview(options: SpecReviewGateOptions): Promise<SpecReviewStanding> {
  const { review, issue } = options;
  if (review === undefined) return 'unjudged';
  if (review.ready) return 'ready';

  const output = options.output ?? activeOutput();
  if (review.answer !== 'not-ready') return standOrRefuse(options, review, output);

  moveWritten(options, output, NOT_READY_REASON);

  if (issue !== null) {
    if (options.comment) {
      await publishGaps(issue, review.gaps, output);
    } else {
      output.info(`💬 ${NO_COMMENT_FLAG}: the gaps were not posted on issue #${String(issue.number)}.`);
    }
    await swapLabels(issue, output);
  }

  throw new CommandExit(
    SPEC_NOT_READY_EXIT,
    specNotReadyMessage(options.source, review.text, review.gaps, issue),
  );
}
