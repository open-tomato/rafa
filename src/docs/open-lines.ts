/**
 * The open stale-docs lines: every unticked checklist item of every open
 * stale-docs issue, read in one listing. `rafa docs plan` writes a task
 * from each, and `rafa release status` counts them.
 *
 * ## What is read
 *
 * `tracker.openIssues('chore')`, kept to the issues whose body holds
 * {@link STALE_DOCS_MARKER}, whatever their title: a release forecast
 * that shifts between two runs opens a second issue under a new version
 * (`release-issue.ts`), so every marked issue is read, not only the one
 * the current version names. Issues come in the order the tracker lists
 * them, and lines in the order each body holds them.
 *
 * A line is an unticked checklist item, `- [ ] <text>`, its text trimmed;
 * a ticked item (`- [x]` or `- [X]`) is settled and is not read, nor is
 * an item with no text. Each line carries the ref and title of the issue
 * it came from, so a caller can tick it there.
 *
 * ## A failure
 *
 * Nothing here throws. No tracker, a tracker with no `openIssues`, or a
 * listing that rejects answers no lines, a count of zero and a one-line
 * `problem`, which a caller renders as unreadable rather than as zero:
 * zero is a reading, and a failed listing is none. `problem` is null on
 * every listing that answered.
 */
import type { IssueRef, OpenIssue, Tracker } from '../ports/index.js';

import { messageOf } from '../core/config/sections.js';

import { STALE_DOCS_MARKER } from './release-issue.js';

/** An unticked checklist item, and the text after its box. */
const UNTICKED_ITEM = /^\s*- \[ \] (.*)$/;

/** A run of white space, the line and paragraph separators included. */
const WHITE_SPACE = /\s+/g;

/** The `problem` when no tracker was resolved. */
export const NO_TRACKER_PROBLEM = 'no tracker resolved to read the stale-docs issues from';

/** The `problem` when the tracker resolved cannot list its open issues. */
export const NO_LISTING_PROBLEM = 'the tracker cannot list its open issues';

/** One open stale-docs line, with the issue it came from. */
export interface OpenStaleDocLine {
  /** The issue holding the line. */
  readonly ref: IssueRef;
  /** That issue's title. */
  readonly title: string;
  /** The item's text after its box, trimmed: `<where>: <what>`, or `<what>`. */
  readonly text: string;
}

/** What {@link readOpenStaleDocLines} answers; see the module note. */
export interface OpenStaleDocLines {
  /** Every open line, issue by issue in listing order. */
  readonly lines: readonly OpenStaleDocLine[];
  /** How many lines are open: `lines.length`. */
  readonly count: number;
  /** Why the issues could not be read, in one line, or null when they were. */
  readonly problem: string | null;
}

/** The tracker member reading the lines calls. */
export type OpenLinesTracker = Partial<Pick<Tracker, 'openIssues'>>;

/** The answer of a reading that could not list the issues. */
function unread(problem: string): OpenStaleDocLines {
  return { lines: [], count: 0, problem };
}

/** The open lines `issue` holds, in body order. */
function linesOf(issue: OpenIssue): OpenStaleDocLine[] {
  return issue.body.split(/\r?\n/).flatMap((line) => {
    const text = UNTICKED_ITEM.exec(line)?.[1]?.trim() ?? '';
    return text === ''
      ? []
      : [{ ref: issue.ref, title: issue.title, text }];
  });
}

/** Every open stale-docs line `tracker` holds; see the module note. Never throws. */
export async function readOpenStaleDocLines(tracker: OpenLinesTracker | null): Promise<OpenStaleDocLines> {
  if (tracker === null) return unread(NO_TRACKER_PROBLEM);
  if (tracker.openIssues === undefined) return unread(NO_LISTING_PROBLEM);

  let open: OpenIssue[];
  try {
    open = await tracker.openIssues('chore');
  } catch (error) {
    return unread(`listing the open chore issues failed: ${messageOf(error)}`.replace(WHITE_SPACE, ' ').trim());
  }

  const lines = open
    .filter((issue) => issue.body.includes(STALE_DOCS_MARKER))
    .flatMap(linesOf);
  return { lines, count: lines.length, problem: null };
}
