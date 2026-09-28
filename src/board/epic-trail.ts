/**
 * The trail: the wording of every comment an epic command leaves on the
 * issue it changed, and of the one question those commands ask when no
 * `--reason` was passed.
 *
 * Every change to an epic is a command that leaves a trail
 * (`.rafa/specs/rafa-246-epic-lifecycle.md`), so a board's history answers
 * "why is this later now?" from the comments alone. The wording lives
 * here and nowhere else: a command renders its comment through one of the
 * functions below and posts it through `./issue-board.ts`, and a test
 * asserts a posted comment by calling the same renderer rather than by
 * spelling the sentence a second time. Nothing here reads or writes the
 * board; every function is pure.
 *
 * ## The comments
 *
 * | Renderer | Posted on | Opens with |
 * |---|---|---|
 * | {@link renderHorizonComment} | the epic, by `defer` and `promote` | `Moved now → later: <reason>` |
 * | {@link renderParkedPullRequestComment} | a pull request of a deferred epic, closed by `defer` on a no | `Closed: epic #A was deferred now → later: <reason>` |
 * | {@link renderMoveComment} | the moved issue, by `move` | `Moved from epic #A to #B: <reason>` |
 * | {@link renderCloseComment} | the epic, by `close` | `Closed through the closing gate:` |
 * | {@link renderCancelComment} | the epic, by `cancel` | `Cancelled:` |
 * | {@link renderDependentComment} | a dependent of a cancelled epic | `Unblocked:` or `Closed as not planned:` |
 *
 * A dependent the person chose to MOVE gets the move comment, with
 * {@link cancelMoveReason} as its reason, so a move reads the same
 * whichever command made it.
 *
 * One piece of the trail is not a comment: a dependent the person chose
 * to UNBLOCK also gets {@link renderUnblockNote} appended below its body,
 * `**Updated <date>, epic #E cancelled:**` and the members it no longer
 * waits on, since a body is changed only by a note below the original.
 * The note never opens a line with `Blocked by:`, so it is not read as
 * the field; {@link carriesUnblockNote} reads it back, so the
 * cancelled-epic notice stops naming a dependent once it is unblocked.
 *
 * The first line of each comment is the sentence the spec names; what
 * follows it, after a blank line, is detail. The move comment names the
 * issue's open branches and pull requests when it has any, because the
 * move changes nothing about them and whoever finds the branch later
 * needs to know it now belongs to another epic. A branch name is written
 * as a code span fenced longer than any backtick run inside it
 * ({@link codeSpan}), since git allows a backtick in a branch name.
 *
 * ## The reason
 *
 * A reason is one line: {@link normaliseReason} trims it and folds every
 * run of whitespace, line breaks included, into one space, so
 * `Moved now → later: <reason>` stays a single sentence however the
 * reason was typed. {@link readReason} takes `--reason` when it was
 * passed and asks {@link reasonQuestion} otherwise, and answers one of
 * three {@link ReasonReading}s:
 *
 * - `given`, with the normalised reason;
 * - `unasked`, with the question, when `--reason` was absent and there
 *   was no terminal to ask on — the caller changes nothing and prints
 *   {@link unaskedReasonMessage};
 * - `blank`, when the flag or the answer held nothing but whitespace, or
 *   the input ended before an answer — the caller changes nothing and
 *   prints {@link blankReasonMessage}. A trail entry without a reason
 *   answers nothing, so an empty one is refused rather than posted.
 *
 * The asker is the `ask` of a `Prompter` (`src/cli/prompt/confirm.ts`),
 * handed in by the command, which passes null where standard input is no
 * terminal: this module never looks at a stream itself.
 */
import type { Horizon } from './roadmap-epic-rows.js';

/** The flag every epic command that changes a horizon or a membership takes its reason from. */
export const REASON_FLAG = 'reason';

/** Any run of whitespace, line breaks included, that a reason folds into one space. */
const WHITESPACE_RUN = /\s+/gu;

/** Every run of backticks in a string, for fencing a code span around it. */
const BACKTICK_RUN = /`+/gu;

/** `#12`, the way every comment names an issue. */
function ref(issue: number): string {
  return `#${String(issue)}`;
}

/** `a, b and c`, the way a comment lists words. */
function wordList(words: readonly string[]): string {
  if (words.length < 2) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] ?? ''}`;
}

/** `#12, #13 and #14`, the way a comment lists issues. */
function refList(issues: readonly number[]): string {
  return wordList(issues.map(ref));
}

/**
 * A code span holding `text` verbatim: fenced with one backtick more than
 * its longest backtick run, and padded with a space where it opens or
 * closes with a backtick, as CommonMark reads a code span.
 */
export function codeSpan(text: string): string {
  const longest = (text.match(BACKTICK_RUN) ?? []).reduce((most, run) => Math.max(most, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  const padding = text.startsWith('`') || text.endsWith('`')
    ? ' '
    : '';
  return `${fence}${padding}${text}${padding}${fence}`;
}

/** A reason as a comment writes it: trimmed, every whitespace run one space. */
export function normaliseReason(reason: string): string {
  return reason.trim().replace(WHITESPACE_RUN, ' ');
}

/** A horizon change on one epic, which `defer` and `promote` make. */
export interface HorizonChange {
  readonly kind: 'horizon';
  /** The epic whose horizon label is swapped. */
  readonly epic: number;
  readonly from: Horizon;
  readonly to: Horizon;
}

/** A membership change on one issue, which `move` makes. */
export interface MembershipChange {
  readonly kind: 'move';
  /** The issue whose `epic:` label is swapped. */
  readonly issue: number;
  /** The epic it leaves. */
  readonly from: number;
  /** The epic it joins. */
  readonly to: number;
}

/** A change a reason is asked for. */
export type ReasonedChange = HorizonChange | MembershipChange;

/** The work on an issue a move leaves exactly where it is. */
export interface OpenWork {
  /** Open branch names, in the order the caller found them. */
  readonly branches: readonly string[];
  /** Open pull request numbers, in the order the caller found them. */
  readonly pullRequests: readonly number[];
}

/** The comment `defer` and `promote` post on the epic: `Moved now → later: <reason>`. */
export function renderHorizonComment(change: HorizonChange, reason: string): string {
  return `Moved ${change.from} → ${change.to}: ${normaliseReason(reason)}`;
}

/**
 * The comment `defer` closes an open pull request of the deferred epic's
 * members with, when the answer to keeping that work was no. It names the
 * epic and the move, and says the branch is kept, since the close deletes
 * no branch and reopening the pull request takes up the work again.
 */
export function renderParkedPullRequestComment(change: HorizonChange, reason: string): string {
  return `Closed: epic ${ref(change.epic)} was deferred ${change.from} → ${change.to}: ${normaliseReason(reason)}`
    + '\n\nThe branch is kept; reopen this pull request to take the work up again.';
}

/** `branch \`a\`, pull request #7`, the open work a move comment names; empty when there is none. */
function openWorkPhrase(work: OpenWork): string {
  const branches = work.branches.map((branch) => `branch ${codeSpan(branch)}`);
  const pullRequests = work.pullRequests.map((pr) => `pull request ${ref(pr)}`);
  return [...branches, ...pullRequests].join(', ');
}

/**
 * The comment `move` posts on the moved issue:
 * `Moved from epic #A to #B: <reason>`, followed, when the issue has an
 * open branch or pull request, by a paragraph naming each one as left
 * where it is. `work` left out is no open work.
 */
export function renderMoveComment(change: MembershipChange, reason: string, work?: OpenWork): string {
  const head = `Moved from epic ${ref(change.from)} to ${ref(change.to)}: ${normaliseReason(reason)}`;
  const named = work === undefined
    ? ''
    : openWorkPhrase(work);
  return named === ''
    ? head
    : `${head}\n\nOpen work stays as it is: ${named}.`;
}

/** An acceptance criterion the closing gate could not turn into a check. */
export interface UncheckedCriterion {
  readonly criterion: string;
  /** Why it could not be checked, as the verification plan said. */
  readonly reason: string;
}

/** What the closing gate found, for the comment it closes the epic with. */
export interface CloseTrail {
  /** Every criterion whose check passed against main, in the epic's order. */
  readonly passed: readonly string[];
  /** Every criterion closed over with `--accept-unchecked`, in the epic's order. */
  readonly unchecked: readonly UncheckedCriterion[];
}

/** `1 acceptance criterion` or `3 acceptance criteria`. */
function criteriaCount(count: number): string {
  return count === 1
    ? '1 acceptance criterion'
    : `${String(count)} acceptance criteria`;
}

/**
 * The comment `close` posts on the epic it closes as completed: the gate
 * it went through, then every passed criterion ticked and, when
 * `--accept-unchecked` closed over any, every unchecked one unticked with
 * its reason.
 */
export function renderCloseComment(trail: CloseTrail): string {
  const head = `Closed through the closing gate: every member is closed, and ${criteriaCount(trail.passed.length)}`
    + ' passed against main.';
  const lines = [head];
  if (trail.passed.length > 0) {
    lines.push('', ...trail.passed.map((criterion) => `- [x] ${normaliseReason(criterion)}`));
  }
  if (trail.unchecked.length > 0) {
    lines.push(
      '',
      `Closed over ${criteriaCount(trail.unchecked.length)} left unchecked, with --accept-unchecked:`,
      '',
      ...trail.unchecked.map(({ criterion, reason }) => `- [ ] ${normaliseReason(criterion)} — ${normaliseReason(reason)}`),
    );
  }
  return lines.join('\n');
}

/** What a cancel did with one dependent: an issue in another epic one of this epic's open members blocked. */
export type DependentAnswer =
  | { readonly kind: 'moved'; readonly to: number }
  | { readonly kind: 'unblocked' }
  | { readonly kind: 'cancelled' };

/** One dependent and what the cancel did with it. */
export interface DependentOutcome {
  readonly issue: number;
  readonly answer: DependentAnswer;
}

/** `#12 moved to epic #40`, one dependent as the cancel comment lists it. */
function dependentLine(outcome: DependentOutcome): string {
  const { answer } = outcome;
  switch (answer.kind) {
    case 'moved': {
      return `- ${ref(outcome.issue)} moved to epic ${ref(answer.to)}`;
    }
    case 'unblocked': {
      return `- ${ref(outcome.issue)} unblocked`;
    }
    case 'cancelled': {
      return `- ${ref(outcome.issue)} closed as not planned`;
    }
  }
}

/**
 * The comment `cancel` posts on the epic: `Cancelled.` or
 * `Cancelled: <reason>`, then what became of each dependent, in the order
 * they were asked about. `reason` null or blank is no reason.
 */
export function renderCancelComment(reason: string | null, dependents: readonly DependentOutcome[]): string {
  const said = reason === null
    ? ''
    : normaliseReason(reason);
  const head = said === ''
    ? 'Cancelled.'
    : `Cancelled: ${said}`;
  if (dependents.length === 0) return `${head}\n\nNo issue in another epic waited on its open members.`;
  return [head, '', 'Issues in other epics that waited on its open members:', '', ...dependents.map(dependentLine)].join('\n');
}

/** The reason a dependent the person chose to move is moved with. */
export function cancelMoveReason(epic: number): string {
  return `epic ${ref(epic)}, which it was blocked by, was cancelled`;
}

/** What a cancel did with one dependent that is not a move, which posts the move comment instead. */
export type DependentAction = 'unblocked' | 'cancelled';

/**
 * The comment `cancel` posts on one dependent it unblocked or closed as
 * not planned, naming the cancelled epic and the members of it the
 * dependent waited on.
 */
export function renderDependentComment(action: DependentAction, epic: number, waitedOn: readonly number[]): string {
  const why = `epic ${ref(epic)} was cancelled, so ${refList(waitedOn)}`;
  const verb = waitedOn.length === 1
    ? 'blocks'
    : 'block';
  return action === 'unblocked'
    ? `Unblocked: ${why} no longer ${verb} this issue.`
    : `Closed as not planned: ${why}, which this issue waited on, will not land.`;
}

/**
 * The note `cancel` appends below the body of a dependent it unblocked:
 * `**Updated <day>, epic #E cancelled:**`, the members of the epic it no
 * longer waits on, then what its `Blocked by:` line still names, each as
 * the line wrote it (`#26`, `owner/repo#3`), or that nothing else blocks
 * it. `day` is the local calendar day, `YYYY-MM-DD`.
 */
export function renderUnblockNote(day: string, epic: number, dropped: readonly number[], still: readonly string[]): string {
  const verb = dropped.length === 1
    ? 'blocks'
    : 'block';
  const rest = still.length === 0
    ? 'nothing else blocks it.'
    : `it is still blocked by ${wordList(still)}.`;
  return `**Updated ${day}, epic ${ref(epic)} cancelled:** ${refList(dropped)} no longer ${verb} this issue; ${rest}`;
}

/**
 * True when `body` carries the note {@link renderUnblockNote} writes for
 * epic `epic`, on any day: the dependent was unblocked from it already.
 * The cancelled-epic notice (`./epic-cancel-notice.ts`) reads it, since
 * the note leaves the dependent's `Blocked by:` line as it was.
 */
export function carriesUnblockNote(body: string, epic: number): boolean {
  return new RegExp(String.raw`\*\*Updated \d{4}-\d{2}-\d{2}, epic #${String(epic)} cancelled:\*\*`, 'u').test(body);
}

/** The question asked for a change's reason when `--reason` was not passed. */
export function reasonQuestion(change: ReasonedChange): string {
  return change.kind === 'horizon'
    ? `Why move epic ${ref(change.epic)} from ${change.from} to ${change.to}? `
    : `Why move ${ref(change.issue)} from epic ${ref(change.from)} to ${ref(change.to)}? `;
}

/** Puts one question and answers the line typed, or null when the input ended first. */
export type ReasonAsk = (question: string) => Promise<string | null>;

/** Where a change's reason came from, or why there is none. */
export type ReasonReading =
  /** `--reason` or the answer held a reason, normalised. */
  | { readonly status: 'given'; readonly reason: string }
  /** `--reason` was absent and there was no terminal; this is what would have been asked. */
  | { readonly status: 'unasked'; readonly question: string }
  /** The flag or the answer held only whitespace, or the input ended before an answer. */
  | { readonly status: 'blank' };

/**
 * The reason for `change`: `flag` when `--reason` was passed (null when
 * it was not), else the answer to {@link reasonQuestion} through `ask`,
 * which is null where there is no terminal to ask on. Asks at most once.
 */
export async function readReason(change: ReasonedChange, flag: string | null, ask: ReasonAsk | null): Promise<ReasonReading> {
  if (flag !== null) return readingOf(flag);
  const question = reasonQuestion(change);
  if (ask === null) return { status: 'unasked', question };
  const answer = await ask(question);
  return answer === null
    ? { status: 'blank' }
    : readingOf(answer);
}

/** `given` for text holding a reason, `blank` otherwise. */
function readingOf(text: string): ReasonReading {
  const reason = normaliseReason(text);
  return reason === ''
    ? { status: 'blank' }
    : { status: 'given', reason };
}

/** What a run without a terminal prints in place of the reason question. */
export function unaskedReasonMessage(question: string): string {
  return `No terminal to ask on, so nothing changed. It would have asked: ${question.trim()}`
    + ` Pass --${REASON_FLAG} "<why>" to answer it.`;
}

/** What a run whose reason came out empty prints. */
export function blankReasonMessage(): string {
  return 'No reason was given, so nothing changed: every change to an epic leaves its reason on the issue.'
    + ` Pass --${REASON_FLAG} "<why>" or answer the question.`;
}
