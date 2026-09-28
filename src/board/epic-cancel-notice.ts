/**
 * The cancelled-epic notice: one line per epic closed as NOT PLANNED
 * whose dependents list is not empty, naming the dependents and
 * `rafa epic cancel <n>`. An epic closed as not planned by hand on GitHub
 * strands every issue outside it that its open members block, and the
 * next read says so (`.rafa/specs/rafa-246-epic-lifecycle.md`, "An epic
 * cancelled by hand on GitHub"). A read command asks nothing itself: the
 * line names the command that asks, which on an epic closed already
 * skips the close and asks the questions (`src/commands/epic/cancel.ts`).
 *
 * `rafa epic show`, `rafa roadmap` and `rafa next` print it, each over
 * the board listing it already reads: this module is a pure function
 * over ONE listing (`./roadmap-board.ts`), so nothing here spawns `gh`,
 * and every case in `./epic-cancel-notice.test.ts` is a literal listing.
 * A listing with no epic closed as not planned answers no line, so a
 * project that never cancels an epic prints what it printed before.
 *
 * ## Which epics, and which dependents
 *
 * An epic is every `type:epic` issue on the listing that is CLOSED with
 * the reason `NOT_PLANNED` (`isNotPlanned`, `./epics.ts`), in ascending
 * number. Its dependents are `readEpicDependents`' (`./epic-dependents.ts`):
 * the open issues outside it whose `Blocked by:` line names one of its
 * open members. A dependent a cancel CLOSED is no longer open, so it is
 * gone from that list. A dependent a cancel UNBLOCKED keeps its line as
 * it was, the note being appended below the body, so it is dropped here
 * when its body carries that epic's note (`carriesUnblockNote`,
 * `./epic-trail.ts`). An epic left with no dependent answers no line.
 *
 * A dependent a cancel MOVED is not dropped: the move swaps its `epic:`
 * label and posts a comment, and neither says on the listing which
 * cancelled epic it was answered for, while its line still names the
 * member. So it stays named until its line stops naming an open member
 * of the epic, or the member closes.
 *
 * Unreadable lines the dependents query reports as problems are not
 * named: `rafa epic cancel` warns them, and `rafa doctor` reports them.
 */
import type { BoardIssue } from './roadmap-board.js';

import { readEpicDependents } from './epic-dependents.js';
import { carriesUnblockNote } from './epic-trail.js';
import { isNotPlanned } from './epics.js';

/** One epic closed as not planned that open issues outside it still wait on. */
export interface CancelledEpicNotice {
  /** The epic's number. */
  readonly epic: number;
  /** The dependents not answered yet, in ascending number. */
  readonly dependents: readonly number[];
}

/** `#12`, the way the line names an issue. */
function ref(issue: number): string {
  return `#${String(issue)}`;
}

/** `#12, #13 and #14`. */
function refList(issues: readonly number[]): string {
  const refs = issues.map(ref);
  if (refs.length < 2) return refs.join('');
  return `${refs.slice(0, -1).join(', ')} and ${refs[refs.length - 1] ?? ''}`;
}

/**
 * Every epic on `issues` closed as not planned whose dependents list is
 * not empty, in ascending number; the module note holds which dependents
 * count. Empty when no epic is closed so. Never throws.
 */
export function readCancelledEpicNotices(issues: readonly BoardIssue[]): readonly CancelledEpicNotice[] {
  const cancelled = issues
    .filter((issue) => issue.type === 'epic' && isNotPlanned(issue))
    .map((issue) => issue.number)
    .sort((left, right) => left - right);
  const notices: CancelledEpicNotice[] = [];
  for (const epic of cancelled) {
    const read = readEpicDependents(issues, epic);
    const waiting = (read?.dependents ?? [])
      .filter(({ issue }) => !carriesUnblockNote(issue.body, epic))
      .map(({ issue }) => issue.number);
    if (waiting.length > 0) notices.push(Object.freeze({ epic, dependents: Object.freeze(waiting) }));
  }
  return Object.freeze(notices);
}

/** The line printed for `notice`. */
export function renderCancelledEpicNotice(notice: CancelledEpicNotice): string {
  const { epic, dependents } = notice;
  const [verb, whom] = dependents.length === 1
    ? ['waits', 'it']
    : ['wait', 'each'];
  return `Epic ${ref(epic)} was closed as not planned, and ${refList(dependents)} still ${verb} on its open members;`
    + ` rafa epic cancel ${String(epic)} asks what becomes of ${whom}.`;
}

/** One line per notice {@link readCancelledEpicNotices} answers for `issues`; empty when none. */
export function cancelledEpicNoticeLines(issues: readonly BoardIssue[]): readonly string[] {
  return Object.freeze(readCancelledEpicNotices(issues).map(renderCancelledEpicNotice));
}
