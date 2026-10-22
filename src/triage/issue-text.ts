/**
 * The text loop-owned triage (`./triage.ts`) files a bug with: the body
 * or comment its sections make up.
 *
 * Triage titles a bug from its record (`bugTitle`, `../bugs/record.ts`,
 * #991). The body opens with a sentence saying where the issue came from
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
 * threshold, then the open bugs it ranked (`RankedIssue`,
 * `./similarity.ts`), one line each, as
 * `- <issue name> (score 0.31; same cause, same module and action)`: the
 * issue named as `Supersedes` names it, its rank to two decimals
 * ({@link scoreText}), then the bonus signals that matched, in
 * `MatchedSignal` order and joined by `, `, as `same cause`, `same cause
 * family` and `same module and action`. A line matched on words alone
 * reads `- <issue name> (score 0.31)`. An empty list is the sentence
 * {@link NO_DUPLICATES}. Names, ranks and signals are the tracker's and
 * this module's, not a session's, so they are redacted but not fenced. An
 * issue filed with the step off or skipped has no such section.
 *
 * A recurrence that step matched is commented on under its own opening
 * ({@link similarCommentOpening}), naming the score and the threshold it
 * met, so whoever reads the issue can tell a match by words from one by
 * key. The sections after it are a recurrence's as ever.
 *
 * ## The record's sections
 *
 * An issue built with the bug record (#991, {@link BugValues.record})
 * carries the record's sections after `Feedback` and before `Possible
 * duplicates` ({@link recordSections}): one per field holding a value,
 * in `BUG_FIELDS` order (`../bugs/record.ts`), with `What`, `Artifact`
 * and `Error line` left out, since `What` and `Artifact` are written
 * above and the recurrence key holds the error line's stripped text. So
 * `Reproduce`, `Rerun`, `Cause`, `Proposed cause`, `Suspected cause`,
 * `Module`, `Action`, `Project`, `Environment`, `Versions`. A free text
 * is fenced and a token (the cause codes, the module, the action and the
 * place) is written plain, as `renderBugBody` writes them, so the
 * record's own parser (`parseBugRecord`) reads the body back. Then
 * `Reported module` and `Reported action`, fenced, for a session's word
 * the record holds as `unknown` ({@link BugValues.reported}); the record
 * reads no field from them.
 *
 * The sections above `Feedback` keep their text byte for byte, so
 * `./similarity.ts`'s `issueTextOf` and `./bug-key.ts` read a body with
 * the record as they read one without.
 *
 * A recurrence's comment carries no record field but `Versions`
 * ({@link BugValues.versions}), the versions the bug was seen again on,
 * after `Feedback`. A `versions` beside a `record` is not written: the
 * record's own `Versions` section is.
 *
 * Every value goes through the caller's `redact` before it is shown.
 */
import type { MatchedSignal, RankedIssue } from './similarity.js';
import type { BugRecord } from '@open-tomato/rafa/bugs/record';
import type { IssueRef } from '@open-tomato/rafa/ports';

import { fenced } from '@open-tomato/rafa/bugs/fenced';
import { BUG_FIELDS } from '@open-tomato/rafa/bugs/record';

export { fenced };

/** What opens a filed issue's body. */
export const ISSUE_OPENING: string = 'An out-of-scope bug a rafa task session reported. The loop filed it and'
  + ' dispatches no task for it: a plan that wants it fixed declares a task.';

/** What opens a recurrence's comment. */
export const COMMENT_OPENING = 'Reported again by a rafa task session.';

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
  /**
   * The bug record an issue is filed with, its free text redacted, or
   * absent for a comment and for a body without one; see the module note.
   */
  readonly record?: BugRecord;
  /** The session's module and action words the record holds as `unknown`; see the module note. */
  readonly reported?: ReportedWords;
  /**
   * The versions a recurrence was seen again on, written in a comment's
   * `Versions` section, or absent; see the module note.
   */
  readonly versions?: string;
}

/** The session's own words beside an `unknown` module or action, redacted; null where none was set aside. */
export interface ReportedWords {
  readonly module: string | null;
  readonly action: string | null;
}

/** The fields of the record written above `Feedback`, or never, and so left out of {@link recordSections}. */
const FIELDS_WRITTEN_ELSEWHERE: ReadonlySet<keyof BugRecord> = new Set(['what', 'artifact', 'errorLine']);

/** The heading of the session's module word the record holds as `unknown`. */
export const REPORTED_MODULE_HEADING = 'Reported module';

/** The heading of the session's action word the record holds as `unknown`. */
export const REPORTED_ACTION_HEADING = 'Reported action';

/** The heading of the record's and a comment's versions. */
const VERSIONS_HEADING = 'Versions';

/** One section holding `value`, redacted, fenced or plain; none for a null value. */
function valueSection(
  heading: string,
  value: string | null,
  shape: 'fenced' | 'plain',
  redact: (text: string) => string,
): string[] {
  if (value === null) return [];
  const shown = shape === 'fenced'
    ? fenced(redact(value))
    : redact(value);
  return [`## ${heading}\n\n${shown}`];
}

/** The record's sections after `Feedback`, the reported words last; see the module note. */
export function recordSections(
  record: BugRecord,
  reported: ReportedWords | undefined,
  redact: (text: string) => string,
): string[] {
  const fields = BUG_FIELDS.flatMap(({ key, heading, shape }) => shape === 'unwritten' || FIELDS_WRITTEN_ELSEWHERE.has(key)
    ? []
    : valueSection(heading, record[key], shape, redact));
  return [
    ...fields,
    ...valueSection(REPORTED_MODULE_HEADING, reported?.module ?? null, 'fenced', redact),
    ...valueSection(REPORTED_ACTION_HEADING, reported?.action ?? null, 'fenced', redact),
  ];
}

/** What follows `Feedback` in a body or a comment, short of `Possible duplicates`; see the module note. */
function afterFeedback(values: BugValues, redact: (text: string) => string): string[] {
  if (values.record !== undefined) return recordSections(values.record, values.reported, redact);
  return valueSection(VERSIONS_HEADING, values.versions ?? null, 'fenced', redact);
}

/** What a new issue's `Possible duplicates` section shows; see the module note. */
export interface PossibleDuplicates {
  /** The threshold none of {@link nearest} met. */
  readonly threshold: number;
  /** The ranked open bugs, highest rank first, already cut to the configured count. */
  readonly nearest: readonly RankedIssue[];
}

/** The sentence a `Possible duplicates` section shows for an empty list. */
export const NO_DUPLICATES = 'No open bug shares a word, a cause or a module and action with this one.';

/** How a line names each bonus signal; `words` is the score itself and is not named. */
const SIGNAL_TEXT: Readonly<Record<Exclude<MatchedSignal, 'words'>, string>> = {
  'cause': 'same cause',
  'cause-family': 'same cause family',
  'boundary': 'same module and action',
};

/** One line of the `Possible duplicates` list, before redaction; see the module note. */
export function duplicateLine({ issue, score, matched }: RankedIssue): string {
  const signals = matched.flatMap((signal) => signal === 'words'
    ? []
    : [SIGNAL_TEXT[signal]]);
  const named = signals.length === 0
    ? ''
    : `; ${signals.join(', ')}`;
  return `- ${issueNameOf(issue.ref)} (score ${scoreText(score)}${named})`;
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
    ? NO_DUPLICATES
    : duplicates.nearest.map(duplicateLine).join('\n');
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
    ...afterFeedback(values, redact),
    ...values.duplicates === undefined
      ? []
      : [possibleDuplicatesSection(values.duplicates, redact)],
  ].join('\n\n') + '\n';
}
