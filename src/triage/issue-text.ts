/**
 * The text loop-owned triage (`./triage.ts`) files a bug with: the title,
 * and the body or comment its sections make up.
 *
 * The title is the bug's `what` on one line, cut to
 * {@link TITLE_MAX_LENGTH} code points ({@link issueTitle}). The body
 * opens with a sentence saying where the issue came from
 * ({@link ISSUE_OPENING}), then six sections, each value in a fence one
 * backtick longer than any backtick run it holds ({@link fenced}), so the
 * text a session wrote is shown verbatim and never rendered: `What`,
 * `Artifact`, `Recurrence key` (the key `./triage.ts`'s step 2 searches
 * for), `Plan` (the plan stub), `Task` (the task text, as the dispatch
 * quoted it) and `Feedback` (the report's feedback). A missing artifact,
 * key, stub or feedback is a sentence saying so.
 *
 * Between `Artifact` and `Recurrence key` goes a seventh, `Refs`, when the
 * redacted artifact names a path or a symbol: each one listed with its
 * target's fingerprint as `TriageOptions.verifyRefs` read it at filing
 * time. An artifact that names neither, and a missing one, have no `Refs`
 * section at all. `./refs-section.ts` holds what is read and how a reading
 * that fails is shown.
 *
 * A recurrence's comment carries the same sections under its own opening
 * sentence ({@link COMMENT_OPENING}), its `Refs` stamped when the comment
 * is written, so an issue filed before this rafa, with no key section of
 * its own, gains one from the first recurrence commented on it.
 *
 * An issue filed because the bug came back after the issue its key found
 * was closed as completed opens, after its opening sentence, with one more
 * section, `Supersedes`, naming that issue ({@link supersedesSection}): its
 * URL, or its kind and id when it has none. The name is the tracker's and
 * not a session's, so it is redacted but not fenced, and GitHub links it.
 * A comment never carries it.
 *
 * ## The similarity step
 *
 * When `./triage.ts`'s nearest-open-bug step ran and found no open bug at
 * or above its threshold, the issue filed ends, after `Feedback`, with a
 * `Possible duplicates` section ({@link possibleDuplicatesSection}): the
 * threshold, then the nearest open bugs it listed, each named as
 * `Supersedes` names its issue and followed by its score to two decimals,
 * or a sentence saying no open bug shares a word with this one. Names and
 * scores are the tracker's and this module's, not a session's, so they are
 * redacted but not fenced. An issue filed with the step off or skipped has
 * no such section.
 *
 * A recurrence that step matched is commented on under its own opening
 * ({@link similarCommentOpening}), naming the score and the threshold it
 * met, so whoever reads the issue can tell a match by words from one by
 * key. The sections after it are a recurrence's as ever.
 *
 * Every value goes through the caller's `redact` before it is shown, and
 * the title is cut from text already redacted, so no cut leaves part of a
 * secret behind.
 */
import type { ScoredIssue } from './similarity.js';
import type { IssueRef } from '../ports/index.js';

import { oneLine } from './bug-key.js';

/** The most code points a filed title holds, its cut marker included. */
export const TITLE_MAX_LENGTH = 120;

/** What ends a title that was cut. */
const TITLE_CUT = '...';

/** The shortest fence a value is shown in. */
const MIN_FENCE_LENGTH = 3;

/** What opens a filed issue's body. */
export const ISSUE_OPENING = 'An out-of-scope bug a rafa task session reported. The loop filed it and'
  + ' dispatches no task for it: a plan that wants it fixed declares a task.';

/** What opens a recurrence's comment. */
export const COMMENT_OPENING = 'Reported again by a rafa task session.';

/** A value in a fence one backtick longer than any run of backticks it holds. */
export function fenced(value: string): string {
  const runs = Array.from(value.matchAll(/`+/g), (run) => run[0].length);
  const fence = '`'.repeat(Math.max(MIN_FENCE_LENGTH, ...runs.map((length) => length + 1)));
  const body = value.endsWith('\n')
    ? value
    : `${value}\n`;
  return `${fence}\n${body}${fence}`;
}

/** The title a bug is filed under: its redacted `what` on one line, cut to the cap. */
export function issueTitle(redactedWhat: string): string {
  const line = oneLine(redactedWhat);
  const points = Array.from(line);
  if (points.length <= TITLE_MAX_LENGTH) return line;
  const kept = points.slice(0, TITLE_MAX_LENGTH - TITLE_CUT.length).join('');
  return `${kept.trimEnd()}${TITLE_CUT}`;
}

/** The values one bug's issue and comment show, before redaction. */
export interface BugValues {
  readonly what: string;
  readonly artifact: string | null;
  /** The key `find` is asked for, redacted, or null for a bug with none. */
  readonly key: string | null;
  /** The `Refs` section, heading included and already redacted, or null for none. */
  readonly refs: string | null;
  readonly planStub: string | null;
  readonly taskText: string;
  readonly feedback: string | null;
  /**
   * The issue closed as completed that this one is filed in place of, or
   * absent for a first filing and for a comment; see the module note.
   */
  readonly supersedes?: IssueRef;
  /**
   * The nearest open bugs the similarity step listed for an issue it filed,
   * or absent when that step did not run, as for every comment.
   */
  readonly duplicates?: PossibleDuplicates;
}

/** What a new issue's `Possible duplicates` section shows; see the module note. */
export interface PossibleDuplicates {
  /** The threshold none of {@link nearest} met. */
  readonly threshold: number;
  /** The nearest open bugs, highest score first, already cut to the configured count. */
  readonly nearest: readonly ScoredIssue[];
}

/** A similarity score as a filed text shows it: two decimals. */
export function scoreText(score: number): string {
  return score.toFixed(2);
}

/** The opening of a comment on an issue the similarity step matched; see the module note. */
export function similarCommentOpening(score: number, threshold: number): string {
  return `${COMMENT_OPENING} No key found this issue: the report's words match its first report`
    + ` at a Jaccard similarity of ${scoreText(score)}, at or above the threshold of`
    + ` ${String(threshold)}, so it is taken for the same bug.`;
}

/** The `Possible duplicates` section, redacted; see the module note. */
export function possibleDuplicatesSection(duplicates: PossibleDuplicates, redact: (text: string) => string): string {
  const intro = `No open bug scored at or above the similarity threshold of ${String(duplicates.threshold)}.`;
  const listed = duplicates.nearest.length === 0
    ? 'No open bug shares a word with this one.'
    : duplicates.nearest
      .map(({ issue, score }) => `- ${issueNameOf(issue.ref)} (score ${scoreText(score)})`)
      .join('\n');
  return `## Possible duplicates\n\n${redact(`${intro}\n\n${listed}`)}`;
}

/** How an issue is named: its URL, or its kind and id when it has none. */
export function issueNameOf(ref: IssueRef): string {
  return ref.url ?? `${ref.kind} issue ${ref.externalId}`;
}

/** The `Supersedes` section naming `closed`, redacted; see the module note. */
export function supersedesSection(closed: IssueRef, redact: (text: string) => string): string {
  const sentence = `This bug came back after ${issueNameOf(closed)} was closed as completed;`
    + ' this issue is filed in its place.';
  return `## Supersedes\n\n${redact(sentence)}`;
}

/** One section: its heading, then its value redacted in a fence, or the sentence for none. */
export function section(
  heading: string,
  value: string | null,
  absent: string,
  redact: (text: string) => string,
): string {
  const shown = value === null
    ? absent
    : fenced(redact(value));
  return `## ${heading}\n\n${shown}`;
}

/** An issue body or a comment: `opening`, then the sections; see the module note. */
export function issueText(opening: string, values: BugValues, redact: (text: string) => string): string {
  return [
    opening,
    ...values.supersedes === undefined
      ? []
      : [supersedesSection(values.supersedes, redact)],
    section('What', values.what, '', redact),
    section('Artifact', values.artifact, 'The report gave no artifact, so a recurrence files again.', redact),
    ...values.refs === null
      ? []
      : [values.refs],
    section('Recurrence key', values.key, 'The report gave no artifact, so this bug has no key.', redact),
    section('Plan', values.planStub, 'The dispatch resolved no plan stub.', redact),
    section('Task', values.taskText, '', redact),
    section('Feedback', values.feedback, 'The report gave no feedback.', redact),
    ...values.duplicates === undefined
      ? []
      : [possibleDuplicatesSection(values.duplicates, redact)],
  ].join('\n\n') + '\n';
}
