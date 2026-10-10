/**
 * The other mode's marks row of `rafa doctor`: every mark on the board
 * of the relationship mode `board.relationships` does NOT name, named
 * under `Other mode's marks:` with `rafa init --board` as the fix
 * (`.rafa/specs/rafa-340-relationships-epics-blockers-github.md`,
 * "Updated to make native relationships a mode": only the configured
 * mode is read, and `rafa doctor` names the other mode's marks).
 *
 * ## When it runs
 *
 * Only when a config layer SETS `board.relationships`, the same answer
 * that decides whether `rafa init --board` offers the move
 * (`./init-board.ts`). A project that left the key at its default reads,
 * sends and prints what it did before the mode existed, so the row is
 * not read and its key is left out of the readings (`./doctor-board.ts`).
 *
 * ## What a mark is
 *
 * In `native` mode, the `labels` mode's marks, read off each row's
 * labels and body:
 *
 *  - an `epic:` label on an issue that is not `type:epic`. An epic's
 *    own `epic:<slug>` label is not a mark: it names the epic, and is
 *    the slug a move back to `labels` reads (`src/board/relations/move.ts`,
 *    "The old mode's marks");
 *  - a `spec:blocked` label, with whether a `Blocked by:` line sits
 *    beside it. A `Blocked by:` line WITHOUT the label is not named:
 *    the `labels` mode reads the line only while the label is on
 *    (`src/board/relations/labels.ts`), so such a line records no
 *    relationship, `rafa issue unblock` leaves it behind when it takes
 *    the label off, and `rafa init --board` neither moves nor removes
 *    it — naming it would point at a command that does nothing to it.
 *
 * In `labels` mode, the `native` mode's marks, read off each row's
 * native fields:
 *
 *  - a sub-issue `parent`;
 *  - `blockedBy` links, each named as the move names a blocker
 *    (`#<n>`, or `owner/name#<n>` for another repository), with the
 *    links `gh` did not answer counted from GitHub's `totalCount`.
 *
 * Every issue is read, open and closed alike, as the move reads them.
 * Marks go in ascending issue number, and within one issue in the order
 * above.
 *
 * ## One listing, and the repository in `labels` mode
 *
 * The row reads the board listing `./doctor-board.ts` shares with the
 * other board rows, so it sends no listing of its own. The native fields
 * carry the `labels` ones too, so a listing in the native fields serves
 * both modes; `./doctor-board.ts` asks for them whenever the key is set.
 * In `labels` mode one `gh repo view --json nameWithOwner`
 * (`readBoardRepository`, `../board/repository.ts`) follows the listing,
 * to tell a local link from a foreign one; `native` mode reads labels and
 * bodies only, and sends nothing more. No issue is read one at a time.
 *
 * ## What it prints, and what it never does
 *
 * A board holding no mark of the other mode prints nothing. One with
 * marks prints the heading, a line naming the mode and the count, a line
 * per mark, and the line pointing at `rafa init --board`, which moves
 * the marks into the configured mode and, on its second question, takes
 * them off. A listing or repository read that failed is the heading and
 * one line naming why; {@link readDoctorMarks} never throws, writes
 * nothing, and never changes the exit code. Every case in
 * `./doctor-marks.test.ts` drives in-process fakes, so none reaches
 * GitHub or spawns `gh`.
 */
import type { GhRunner } from '../adapters/tracker/github.js';
import type { BoardIssue, BoardIssueLink, BoardListing } from '../board/roadmap-board.js';
import type { BoardRelationshipMode } from '../config-sections.js';

import { hasSpecBlockedLabel, readBlockedBy, SPEC_BLOCKED_LABEL } from '../board/blocked.js';
import { EPIC_LABEL_PREFIX } from '../board/epics.js';
import { readBoardRepository } from '../board/repository.js';
import { messageOf } from '../config-sections.js';
import { plural } from '../plan/plan-files.js';

import { MOVE_FIX } from './init-board.js';

/** The heading the marks sit under. */
export const MARKS_HEADING = 'Other mode\'s marks:';

/** An issue carrying `epic:` labels in `native` mode. */
export interface EpicLabelMark {
  readonly kind: 'epic-label';
  readonly issue: number;
  /** Every `epic:` label the issue carries, as it spells them. */
  readonly labels: readonly string[];
}

/** An issue carrying `spec:blocked` in `native` mode. */
export interface SpecBlockedMark {
  readonly kind: 'spec-blocked';
  readonly issue: number;
  /** True when a `Blocked by:` line sits in the body beside the label. */
  readonly line: boolean;
}

/** An issue with a sub-issue parent in `labels` mode. */
export interface ParentMark {
  readonly kind: 'parent';
  readonly issue: number;
  /** The parent, `#<n>` or `owner/name#<n>`. */
  readonly parent: string;
}

/** An issue with `blockedBy` links in `labels` mode. */
export interface BlockedByMark {
  readonly kind: 'blocked-by';
  readonly issue: number;
  /** The links `gh` answered, each `#<n>` or `owner/name#<n>`, in the order it answered them. */
  readonly blockers: readonly string[];
  /** GitHub's count of the links, never below {@link blockers}' length. */
  readonly total: number;
}

/** One mark of the mode `board.relationships` does not name. */
export type OtherModeMark = EpicLabelMark | SpecBlockedMark | ParentMark | BlockedByMark;

/** What one reading of the other mode's marks came to. */
export interface DoctorMarksReport {
  /** The mode `board.relationships` names, the one the board is read in. */
  readonly relationships: BoardRelationshipMode;
  /** The mode whose marks were looked for. */
  readonly other: BoardRelationshipMode;
  /** Every mark, in ascending issue number; see the module note. */
  readonly marks: readonly OtherModeMark[];
  /** Why the listing or the repository could not be read; null when both answered. */
  readonly problem: string | null;
}

/** What {@link readDoctorMarks} reads through. */
export interface DoctorMarksOptions {
  /** Runs the repository read in `labels` mode. */
  readonly gh: GhRunner;
  /** The board listing, in the native fields, shared with the other board rows. */
  readonly listing: BoardListing;
  /** The mode `board.relationships` names. */
  readonly mode: BoardRelationshipMode;
}

/** The mode `mode` is not. */
export function otherModeOf(mode: BoardRelationshipMode): BoardRelationshipMode {
  return mode === 'native'
    ? 'labels'
    : 'native';
}

/** The `labels` marks on `issue`: its `epic:` labels unless it is an epic, then `spec:blocked`. */
function labelsMarksOf(issue: BoardIssue): readonly OtherModeMark[] {
  const epicLabels = issue.type === 'epic'
    ? []
    : issue.labels.filter((label) => label.toLowerCase().startsWith(EPIC_LABEL_PREFIX));
  const epic: readonly OtherModeMark[] = epicLabels.length === 0
    ? []
    : [Object.freeze({ kind: 'epic-label', issue: issue.number, labels: Object.freeze(epicLabels) })];
  const blocked: readonly OtherModeMark[] = hasSpecBlockedLabel(issue.labels)
    ? [Object.freeze({ kind: 'spec-blocked', issue: issue.number, line: readBlockedBy(issue.number, issue.body).kind !== 'no-line' })]
    : [];
  return [...epic, ...blocked];
}

/** `link` as a line names it: `#<n>` on the board's repository, `owner/name#<n>` elsewhere. */
function linkName(link: BoardIssueLink, repository: string): string {
  const number = `#${String(link.number)}`;
  return link.repository.toLowerCase() === repository.toLowerCase()
    ? number
    : `${link.repository}${number}`;
}

/** The `native` marks on `issue`: its parent, then its `blockedBy` links. */
function nativeMarksOf(issue: BoardIssue, repository: string): readonly OtherModeMark[] {
  if (issue.parent === undefined || issue.blockedBy === undefined) {
    throw new Error(`the listing carries no native fields for #${String(issue.number)}`);
  }
  const parent: readonly OtherModeMark[] = issue.parent === null
    ? []
    : [Object.freeze({ kind: 'parent', issue: issue.number, parent: linkName(issue.parent, repository) })];
  const { nodes, truncated } = issue.blockedBy;
  const total = truncated?.total ?? nodes.length;
  const blockedBy: readonly OtherModeMark[] = total === 0
    ? []
    : [Object.freeze({
      kind: 'blocked-by',
      issue: issue.number,
      blockers: Object.freeze(nodes.map((node) => linkName(node, repository))),
      total,
    })];
  return [...parent, ...blockedBy];
}

/** Every mark `marksOf` finds on `issues`, in ascending issue number. */
function allMarks(issues: readonly BoardIssue[], marksOf: (issue: BoardIssue) => readonly OtherModeMark[]): readonly OtherModeMark[] {
  return Object.freeze([...issues].sort((left, right) => left.number - right.number).flatMap(marksOf));
}

/**
 * Every mark on the board of the mode `board.relationships` does not
 * name, read off the shared listing.
 *
 * Writes nothing and never throws: a listing or repository read that
 * failed comes back as {@link DoctorMarksReport.problem} with no mark.
 * See the module note.
 */
export async function readDoctorMarks(options: DoctorMarksOptions): Promise<DoctorMarksReport> {
  const { gh, listing, mode } = options;
  const other = otherModeOf(mode);
  const report = (marks: readonly OtherModeMark[], problem: string | null): DoctorMarksReport => Object.freeze({
    relationships: mode,
    other,
    marks: Object.freeze([...marks]),
    problem,
  });
  try {
    const issues = await listing();
    if (mode === 'native') return report(allMarks(issues, labelsMarksOf), null);
    const repository = await readBoardRepository(gh);
    return report(allMarks(issues, (issue) => nativeMarksOf(issue, repository)), null);
  } catch (error) {
    return report([], messageOf(error));
  }
}

/** The sentence naming one mark. */
export function markMessage(mark: OtherModeMark): string {
  const issue = `#${String(mark.issue)}`;
  if (mark.kind === 'epic-label') return `${issue} carries ${mark.labels.join(', ')}`;
  if (mark.kind === 'spec-blocked') {
    return mark.line
      ? `${issue} carries ${SPEC_BLOCKED_LABEL} and a Blocked by: line`
      : `${issue} carries ${SPEC_BLOCKED_LABEL}`;
  }
  if (mark.kind === 'parent') return `${issue} is a sub-issue of ${mark.parent}`;
  const unread = mark.total - mark.blockers.length;
  const more = unread > 0
    ? ` and ${String(unread)} more`
    : '';
  return `${issue} is linked as blocked by ${mark.blockers.join(' ')}${more}`;
}

/**
 * The lines text mode writes for the marks: the heading, what the board
 * holds, one line per mark and the fix. A report with no mark prints
 * nothing; null, for a project with no GitHub board or that left
 * `board.relationships` unset, prints nothing either.
 */
export function renderDoctorMarks(report: DoctorMarksReport | null): readonly string[] {
  if (report === null) return [];
  const { relationships, other, marks, problem } = report;
  if (problem !== null) {
    return [MARKS_HEADING, `  board.relationships is ${relationships}: the board could not be read for ${other} marks: ${problem}`];
  }
  if (marks.length === 0) return [];
  return [
    MARKS_HEADING,
    `  board.relationships is ${relationships}, and the board holds ${plural(marks.length, `${other} mark`)} it does not read:`,
    ...marks.map((mark) => `    ${markMessage(mark)}`),
    `  run ${MOVE_FIX} to move them into ${relationships} mode; its second question takes them off`,
  ];
}
