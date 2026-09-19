/**
 * The re-run readings: what a second `rafa pr triage` over the same
 * pull request does, decided from the comment already stored on it and
 * the pull request's head and checks as they stand now.
 *
 * Assessing is not free — a conflict read, a run listing and a log tail
 * per failing job — and it is also not idempotent to the reader: every
 * assessment edits the one triage comment, so an assessment that had
 * nothing new to say would rewrite the comment a person is in the
 * middle of reading. So the spec gives four readings for a re-run
 * (`.specs/rafa-20-pr-commands.md`), and this module is them:
 *
 *   1. `already-assessed` — a stored triage whose `head` is the pull
 *      request's head. Print "already assessed at <time>", show the
 *      comment, assess nothing.
 *   2. `pending` — the head moved and a check is still running. Say so
 *      and show the old triage; a partial reading of a run in flight is
 *      not something to re-classify against.
 *   3. `assess` — the head moved, nothing is pending and the pull
 *      request is still not green. Assess again and EDIT the same
 *      comment.
 *   4. `green` — nothing to triage.
 *
 * Pure and total, like `./classify.ts`: no clock, no process, no await,
 * no throw. Every input reaches exactly one of
 * {@link RERUN_DECISIONS}, so one case per reading drives the whole
 * module from literals.
 *
 * ## The precedence, and the one sharp edge in it
 *
 * The questions are asked in the order above, which is the order the
 * spec lists them, and the first one that answers decides.
 *
 * That puts `already-assessed` ahead of `green`, and there is one
 * reading where the two disagree: a stored triage that says `ci-test`
 * at head X, whose checks were then RE-RUN at that same head X and
 * passed. The pull request is green and this module still answers
 * `already-assessed`. That is the spec's rule taken literally — the
 * head is what a triage is pinned to, and the stored comment is the
 * triage of that head — and the cost is one stale line on a pull
 * request that has since gone green without moving. It is named here
 * rather than quietly fixed, because the fix (letting green outrank a
 * stored head) would also re-read every green pull request that already
 * carries a triage.
 *
 * ## Why three of the four readings need a stored comment and `green`
 * does not
 *
 * `already-assessed` and `pending` are re-run readings in the strict
 * sense: both are about a triage that is already there, and both end in
 * SHOWING it. With no stored comment there is nothing to show and
 * nothing to compare a head against, so neither can be reached.
 *
 * That is also what keeps the `pending` CLASS reachable. A first run
 * over a pull request whose checks are still running assesses, and
 * `classifyTriage` answers `pending` for it, which is commented like
 * any other class. It is only the SECOND run that stops short and shows
 * the triage it already has. A `pending` reading that fired without a
 * stored comment would make a first run over a running pull request
 * write nothing at all, and the class would never be reached from the
 * command.
 *
 * `green` is not a re-run reading in that sense — it is "there is
 * nothing here to triage" — so it is reached with or without a stored
 * comment, and it neither assesses nor writes. A green pull request
 * carrying no triage comment therefore leaves with none: a comment
 * saying a pull request is fine is noise on every pull request that
 * ever merges.
 *
 * ## A head that could not be read is a moved head
 *
 * {@link readTriageBlock} answers null for a field that was absent or
 * stored in a shape it refuses — an unquoted sha of digits alone comes
 * back as a number, which its own module note measures. A null head
 * cannot equal the pull request's, so it reads as MOVED and the pull
 * request is assessed again. The alternative, treating an unreadable
 * head as a match, would be a store that silently forgets pinning its
 * triage to anything at all. {@link RerunReading.problems} carries
 * whatever the reader objected to, so the caller reports the unreadable
 * field beside the reading it caused.
 *
 * ## Heads are compared case-folded, and a stored prefix counts
 *
 * rafa writes the full `headRefOid`, so the ordinary comparison is
 * between two 40-character shas. A comment edited by hand can carry an
 * abbreviated one, and git itself resolves an abbreviation, so a stored
 * head that is a prefix of the pull request's counts as the same head
 * from {@link SHORT_HEAD_LENGTH} characters up. Below that it does not:
 * a four-character prefix collides across a repository of any size, and
 * a false `already-assessed` is a pull request that is never assessed
 * again.
 */
import type { TriageBlock } from './comment.js';
import type { CheckRow, ChecksVerdict } from '../checks.js';
import type { PullRequestComment } from '../types.js';

import { verdictOf } from '../checks.js';

import { readTriageBlock } from './comment.js';

/**
 * What one re-run reading concluded. Exactly one of these is the
 * answer; the precedence between them is in the module note.
 */
export type RerunDecision
  = | 'already-assessed'
    | 'pending'
    | 'assess'
    | 'green';

/**
 * Every decision, in the order {@link readTriageRerun} asks for them.
 * Frozen, because a caller that pushed onto it would change what every
 * later reader accepts.
 */
export const RERUN_DECISIONS: readonly RerunDecision[] = Object.freeze([
  'already-assessed',
  'pending',
  'assess',
  'green',
] as const);

/** Whether a value is one of {@link RERUN_DECISIONS}. */
export function isRerunDecision(value: unknown): value is RerunDecision {
  return typeof value === 'string'
    && (RERUN_DECISIONS as readonly string[]).includes(value);
}

/**
 * What the caller does about the triage comment.
 *
 * `edit` and `post` are kept apart rather than left for the caller to
 * work out, so that "one triage comment per pull request, history in
 * its edits" is a value this module answers and a test can measure.
 */
export type RerunWrite = 'none' | 'post' | 'edit';

/**
 * The shortest stored head prefix that counts as the pull request's
 * head; see the module note. Seven is git's own default abbreviation.
 */
export const SHORT_HEAD_LENGTH = 7;

/** How many characters of a head a headline prints. */
const HEADLINE_HEAD_LENGTH = 7;

/** What one re-run reading is made from. */
export interface RerunInput {
  /**
   * The marker comment already on the pull request — `findTriageComment`
   * of its comments — or null when it carries none.
   */
  readonly comment: PullRequestComment | null;
  /** The pull request's head commit now, as the port answered it. */
  readonly head: string;
  /** Its check rows now, as `parseChecks` read them. */
  readonly rows: readonly CheckRow[];
  /**
   * `--no-comment`: read the stored comment and write none. It changes
   * {@link RerunReading.write} to `none` and nothing else, so a run with
   * the flag still assesses and still reports.
   */
  readonly noComment?: boolean;
}

/** What one re-run reading concluded. */
export interface RerunReading {
  /** The reading. One of {@link RERUN_DECISIONS}. */
  readonly decision: RerunDecision;
  /** Whether the caller runs a fresh assessment. */
  readonly assesses: boolean;
  /** What the caller does about the comment; `none` under `--no-comment`. */
  readonly write: RerunWrite;
  /** The stored comment this was read against, or null when there was none. */
  readonly comment: PullRequestComment | null;
  /** Its `rafa:triage` block, or null when there was no readable block. */
  readonly block: TriageBlock | null;
  /** What the block reader objected to; empty when it read clean or was absent. */
  readonly problems: readonly string[];
  /** The verdict over the rows, kept so a report can show `none`. */
  readonly verdict: ChecksVerdict;
  /** Whether the stored head is the pull request's; false when none was readable. */
  readonly sameHead: boolean;
  /**
   * The time "already assessed at <time>" names: the stored block's
   * `at`, or the comment's own `updatedAt` when the block carries none.
   * Null when there is no stored comment.
   */
  readonly storedAt: string | null;
  /** One lower-case sentence naming the reading, for the console. Never empty. */
  readonly headline: string;
}

/**
 * Whether a stored head is the pull request's head: case-folded, and a
 * stored abbreviation of {@link SHORT_HEAD_LENGTH} characters or more
 * counting as the head it abbreviates. See the module note.
 *
 * A null stored head — absent, or stored in a shape the reader refused
 * — is never the pull request's.
 */
export function isSameHead(stored: string | null, head: string): boolean {
  if (stored === null) return false;
  const left = stored.trim().toLowerCase();
  const right = head.trim().toLowerCase();
  if (left === '' || right === '') return false;
  if (left === right) return true;
  return left.length >= SHORT_HEAD_LENGTH && right.startsWith(left);
}

/** A head as a headline prints it. */
function shortHead(head: string): string {
  return head.trim().slice(0, HEADLINE_HEAD_LENGTH);
}

/** `1 check` or `<n> checks`, so a headline reads as a sentence. */
function checkCount(count: number): string {
  return count === 1
    ? '1 check'
    : `${count} checks`;
}

/** The time the `already assessed at` line names; see {@link RerunReading.storedAt}. */
function storedTime(comment: PullRequestComment | null, block: TriageBlock | null): string | null {
  if (comment === null) return null;
  return block?.at ?? comment.updatedAt;
}

/** The headline of the reading that assesses nothing because nothing moved. */
function alreadyHeadline(at: string | null, block: TriageBlock | null): string {
  const when = at ?? 'an unrecorded time';
  const what = block?.class === null || block?.class === undefined
    ? 'the stored triage'
    : `\`${block.class}\``;
  return `already assessed at ${when}, as ${what}; the head has not moved since`;
}

/** The headline of the reading that waits for a run in flight. */
function pendingHeadline(head: string, rows: readonly CheckRow[], at: string | null): string {
  const running = rows.filter((row) => row.outcome === 'pending').length;
  const when = at ?? 'an unrecorded time';
  return `the head moved to ${shortHead(head)} and ${checkCount(running)} of ${rows.length} `
    + `still running, so the triage from ${when} stands`;
}

/** The headline of the reading that assesses. */
function assessHeadline(head: string, verdict: ChecksVerdict, write: RerunWrite): string {
  const state = verdict === 'none'
    ? 'reports no checks at all'
    : 'is not green';
  const comment = write === 'edit'
    ? 'editing the triage comment'
    : 'commenting';
  const posting = write === 'none'
    ? 'writing no comment'
    : comment;
  return `the head ${shortHead(head)} ${state} and nothing is pending, so assessing again and ${posting}`;
}

/** The headline of the reading with nothing to triage. */
function greenHeadline(head: string, rows: readonly CheckRow[]): string {
  return `the head ${shortHead(head)} is green, all ${checkCount(rows.length)} passed, `
    + 'so there is nothing to triage';
}

/** The precedence itself, kept apart so the four branches are one readable list. */
function decide(
  comment: PullRequestComment | null,
  sameHead: boolean,
  verdict: ChecksVerdict,
): RerunDecision {
  if (comment !== null && sameHead) return 'already-assessed';
  if (comment !== null && verdict === 'pending') return 'pending';
  if (verdict === 'green') return 'green';
  return 'assess';
}

/** What a decision does about the comment, with `--no-comment` over the top. */
function writeFor(
  decision: RerunDecision,
  comment: PullRequestComment | null,
  noComment: boolean,
): RerunWrite {
  if (decision !== 'assess' || noComment) return 'none';
  return comment === null
    ? 'post'
    : 'edit';
}

/** The sentence for one decision. */
function headlineFor(
  decision: RerunDecision,
  input: RerunInput,
  reading: { block: TriageBlock | null; at: string | null; verdict: ChecksVerdict; write: RerunWrite },
): string {
  if (decision === 'already-assessed') return alreadyHeadline(reading.at, reading.block);
  if (decision === 'pending') return pendingHeadline(input.head, input.rows, reading.at);
  if (decision === 'green') return greenHeadline(input.head, input.rows);
  return assessHeadline(input.head, reading.verdict, reading.write);
}

/**
 * The re-run reading over one stored comment and one pull request's
 * head and checks.
 *
 * Total and pure: every input reaches exactly one of
 * {@link RERUN_DECISIONS}, nothing is spawned, nothing is awaited and
 * nothing is thrown. The precedence, and what each reading does about
 * the comment, are in the module note.
 */
export function readTriageRerun(input: RerunInput): RerunReading {
  const { comment } = input;
  const stored = comment === null
    ? null
    : readTriageBlock(comment.body);
  const block = stored?.block ?? null;
  const problems = stored?.problems ?? [];
  const sameHead = isSameHead(block?.head ?? null, input.head);
  const verdict = verdictOf(input.rows);
  const decision = decide(comment, sameHead, verdict);
  const write = writeFor(decision, comment, input.noComment === true);
  const storedAt = storedTime(comment, block);

  return {
    decision,
    assesses: decision === 'assess',
    write,
    comment,
    block,
    problems,
    verdict,
    sameHead,
    storedAt,
    headline: headlineFor(decision, input, { at: storedAt, block, verdict, write }),
  };
}
