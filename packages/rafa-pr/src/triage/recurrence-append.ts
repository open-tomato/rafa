/**
 * A recurrence's append: what follows a public comment that triage
 * (`./triage.ts`) makes on the issue a bug recurs in.
 *
 * ## A recurrence's append
 *
 * Given `TriageOptions.appendUpdate` (`./triage.ts`), a comment made on
 * the public tracker, by any of the three paths `./triage.ts`'s module
 * note names that comment, is followed by an append when the session
 * gave its own reproduce text: one that is not the `seen while running`
 * fallback `./bug-filing.ts`'s `reproduceOf` answers for none. The
 * tracker's `editable` reads the body once; a body that already holds
 * the redacted text (`bodyHoldsText`, `./issue-text.ts`) is answered
 * `held` and the seam is not called, and any other has the seam called
 * with `recurrenceReason`'s reason and `recurrenceAddition`'s fenced
 * text. The comment's action is kept whatever the append comes to: its
 * outcome, and its problem redacted, go on `BugTriage.append`, and a read
 * or a seam that fails answers `failed` there. A comment that fails, a
 * bug with no text of its own, a tracker with no `editable`, a private
 * bug and an issue filed in place of a closed one append nothing and
 * carry no `append` at all, as does every bug with the seam left out.
 *
 * The types and {@link appendAfterComment} live here and `./triage.ts`
 * imports them back, re-exporting the type names, so this file reads
 * nothing of `./triage.ts`: {@link AppendRun} is the part of its bug run
 * the append needs.
 */
import type { IssueRef, Tracker } from '@open-tomato/rafa/ports';

import { messageOf } from '@open-tomato/rafa/core/config/sections';

import { bodyHoldsText, recurrenceAddition } from './issue-text.js';

/** What a recurrence's append came to; see the module note. */
export type RecurrenceAppendOutcome =
  /** The text was appended below the body as one dated `Updated` block. */
  | 'appended'
  /** The body already held the text, so nothing was written. */
  | 'held'
  /** The issue is planned: the text was appended, and the plan's copy of it is stale. */
  | 'stale-copy'
  /** The write refused the append, as `rafa issue edit` refuses one. */
  | 'refused'
  /** The body read or the write failed. */
  | 'failed';

/** A recurrence's append outcome, with the problem it names, redacted, or null. */
export interface RecurrenceAppend {
  readonly outcome: RecurrenceAppendOutcome;
  readonly problem: string | null;
}

/**
 * Appends `text` below the body of the issue `ref` names, under `reason`,
 * through the write `rafa issue edit --append` uses, and answers what the
 * write came to. Rejecting is answered as `failed`.
 */
export type AppendUpdate = (ref: IssueRef, reason: string, text: string) => Promise<RecurrenceAppend>;

/** The seam a recurrence's text is appended through, and the reason it names. */
export interface AppendStep {
  readonly update: AppendUpdate;
  readonly reason: string;
}

/** The part of one bug's run through a route that {@link appendAfterComment} reads. */
export interface AppendRun {
  readonly route: {
    readonly channel: string;
    readonly tracker: Tracker;
    /** The append after a comment, or null where none is made. */
    readonly append: AppendStep | null;
  };
  /** The session's own reproduce text, trimmed and not yet redacted, or null for the fallback. */
  readonly filing: { readonly reproduce: string | null };
  readonly redact: (text: string) => string;
}

/** A step's value, or the redacted problem it failed with. */
type AppendStepOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: string };

/** Runs one step of the append, answering its failure, redacted, rather than rejecting. */
async function appendStep<T>(run: AppendRun, name: string, action: () => Promise<T>): Promise<AppendStepOutcome<T>> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { ok: false, problem: run.redact(`${name} failed: ${messageOf(error)}`) };
  }
}

/**
 * Appends the session's reproduce text below the body of the issue just
 * commented on, unless the body holds it; null when no append is tried.
 * See the module note.
 */
export async function appendAfterComment(run: AppendRun, ref: IssueRef): Promise<RecurrenceAppend | null> {
  const { append, tracker, channel } = run.route;
  const { reproduce } = run.filing;
  const { editable } = tracker;
  if (append === null || reproduce === null || editable === undefined) return null;

  const read = await appendStep(run, `the ${channel} tracker editable`, () => editable.call(tracker, ref));
  if (!read.ok) return { outcome: 'failed', problem: read.problem };
  if (bodyHoldsText(read.value.body, run.redact(reproduce))) return { outcome: 'held', problem: null };
  const written = await appendStep(run, 'the recurrence append', () => append.update(ref, append.reason, recurrenceAddition(reproduce, run.redact)));
  if (!written.ok) return { outcome: 'failed', problem: written.problem };
  const { outcome, problem } = written.value;
  return {
    outcome,
    problem: problem === null
      ? null
      : run.redact(problem),
  };
}
