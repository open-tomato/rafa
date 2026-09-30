/**
 * Moving a board between relationship modes, planned: the writes that put
 * every relationship one mode holds into the other, in the order they are
 * sent, and the old mode's marks a second question may then remove
 * (`.rafa/specs/rafa-340-relationships-epics-blockers-github.md`,
 * "Updated to make native relationships a mode").
 *
 * {@link planRelationsMove} is pure. It reads the one listing through
 * both modes' port reads (`./port.ts`), sends nothing, and answers a
 * {@link RelationsMovePlan} a command prints before it asks, and a writer
 * then sends through `GhRunner`. The listing must carry the `native`
 * fields whichever way the move goes, since the `native` side is read in
 * both directions and its reader refuses a listing without them; the
 * `native` fields include every `labels` one (`nativeBoardListFields`).
 *
 * ## What moves
 *
 * `labels` to `native`:
 *
 *  - Each epic's members, as the `labels` reading orders them (its
 *    checklist, then the members it does not list in ascending number),
 *    become its sub-issues: ONE `sub-issues` write per epic naming them
 *    in that order, since a sub-issue added goes last in its parent
 *    (`context/pull-requests.md`, "Native relationships").
 *  - Each issue's `Blocked by:` line, read while it carries
 *    `spec:blocked`, becomes ONE `blocked-by` write naming its blockers
 *    in the line's order, foreign ones with their `owner/name`.
 *
 * `native` to `labels`:
 *
 *  - Each epic's sub-issues, in sub-issue order, take the epic's
 *    `epic:<slug>` label, one `epic-label` write each, and then the epic's
 *    checklist gains a line for each one it does not name, in ONE
 *    `checklist` write per epic, ticked for a closed issue and carrying
 *    its title, the line `rafa epic move` writes for an issue that had
 *    none. The slug is the epic's first `epic:` label, as `readEpics`
 *    reads it.
 *  - Each issue's `blockedBy` links become ONE `blocked-line` write:
 *    `spec:blocked` when the issue lacks it, and each blocker its
 *    `Blocked by:` line does not name yet, in link order.
 *
 * Epics go in ascending number, every membership write before any
 * blocker write, and blocker writes in ascending issue number, so
 * two runs over one listing plan the same list.
 *
 * ## Idempotent
 *
 * A relationship the target mode already holds is not planned again: a
 * member whose target reading is already in that epic, a checklist line
 * the epic already names, a label the issue carries, a blocker already
 * linked or named. So a move sent whole plans NO write on a second run,
 * and a move that stopped part way plans exactly what it did not send.
 * A `native` target's links are read off the nodes `gh` answered, so on
 * an issue already holding more than 50 links a blocker past them reads
 * as missing and is planned again. What GitHub answers to a link it
 * already holds has not been measured.
 * A member added to an epic that already held some of its sub-issues goes
 * after them, and a checklist line after the lines already there: an
 * existing order is never rewritten.
 *
 * ## Skipped, never guessed
 *
 * A relationship neither mode can hold alike is SKIPPED, with a sentence
 * saying why, and nothing is written or removed for it:
 *
 *  - the source reads no single epic for a member (two `epic:` labels, a
 *    slug several epics own);
 *  - the target already puts the member in ANOTHER epic, or in none it
 *    can name: the move adds, it never overrides what the target holds;
 *  - the source's blockers are a `labels` fault, or a `native` list `gh`
 *    truncated, so the whole of it cannot be read;
 *  - a `native` epic carries no `epic:<slug>` label, so its sub-issues
 *    have no label to take (`rafa epic new` gives none in `native`
 *    mode). Inventing a slug would need a label created on the
 *    repository, which is not this move's to do.
 *
 * ## The old mode's marks
 *
 * {@link RelationsMovePlan.marks} names, for every relationship the
 * target holds once the writes are sent (planned, or already there),
 * the source mode's mark of it: the member's `epic:` label and the
 * issue's `spec:blocked` label with its `Blocked by:` line in `labels`;
 * the member's sub-issue parent and the issue's `blockedBy` links in
 * `native`. A skipped relationship's marks are never named. An epic's
 * own `epic:<slug>` label and its checklist are not marks: the label
 * names the epic, and is the slug a move back reads.
 *
 * The marks are answered even when no write is planned, so a second run
 * after a move whose old marks were kept still names them for the second
 * question; once they are removed a run answers none.
 */
import type {
  Blocker,
  BlockersReading,
  BoardRelations,
  EpicOfReading,
  RelatedIssue,
  RelationsReading,
} from './port.js';
import type { BoardRelationshipMode } from '../../config-sections.js';
import type { BoardIssue } from '../roadmap-board.js';

import { hasSpecBlockedLabel, SPEC_BLOCKED_LABEL } from '../blocked.js';
import { EPIC_LABEL_PREFIX, epicSlugsOf } from '../epics.js';
import { parseRoadmapBody } from '../roadmap.js';

import { blockerToken } from './labels-blocked-edit.js';
import { labelsLineBlockersOf } from './labels.js';

/** What every failure this module raises opens with. */
const PREFIX = 'board relations move';

/** One mode's reads, which is all a plan asks of an adapter. */
export type RelationsMoveSide = Pick<BoardRelations, 'mode' | 'read'>;

/** Every member of a `native` epic made its sub-issues, in order, in one `--add-sub-issue`. */
export interface SubIssuesWrite {
  readonly kind: 'sub-issues';
  readonly epic: number;
  /** The members to add, in the epic's `labels` order; never empty. */
  readonly issues: readonly number[];
  /** One line naming the write, as a command prints it. */
  readonly what: string;
}

/** An issue's blockers linked in `native` mode, in one `--add-blocked-by`. */
export interface BlockedByWrite {
  readonly kind: 'blocked-by';
  readonly issue: number;
  /** The blockers to link, in line order; never empty. */
  readonly blockers: readonly RelatedIssue[];
  readonly what: string;
}

/** An issue given its epic's `epic:<slug>` label. */
export interface EpicLabelWrite {
  readonly kind: 'epic-label';
  readonly issue: number;
  readonly epic: number;
  /** `epic:<slug>`, as the epic carries it. */
  readonly label: string;
  readonly what: string;
}

/** One checklist line a `checklist` write appends. */
export interface MoveChecklistLine {
  readonly issue: number;
  /** The issue's title, the line's why. */
  readonly why: string;
  /** True for a closed issue. */
  readonly ticked: boolean;
}

/** An epic's checklist gaining a line per member it does not name, in one body edit. */
export interface ChecklistWrite {
  readonly kind: 'checklist';
  readonly epic: number;
  /** The lines to append, in sub-issue order; never empty. */
  readonly lines: readonly MoveChecklistLine[];
  readonly what: string;
}

/** An issue given `spec:blocked` and its blockers on its `Blocked by:` line, in one edit. */
export interface BlockedLineWrite {
  readonly kind: 'blocked-line';
  readonly issue: number;
  /** True when the issue lacks `spec:blocked` and the write puts it on. */
  readonly label: boolean;
  /** The blockers the line does not name yet, in link order; empty only when `label` is true. */
  readonly blockers: readonly RelatedIssue[];
  readonly what: string;
}

/** One planned write; the kind names the target mode's mark it puts on. */
export type RelationsMoveWrite = SubIssuesWrite | BlockedByWrite | EpicLabelWrite | ChecklistWrite | BlockedLineWrite;

/** A `labels` member's `epic:` label, left behind by a move to `native`. */
export interface EpicLabelMark {
  readonly kind: 'epic-label';
  readonly issue: number;
  readonly label: string;
  readonly what: string;
}

/** A `labels` issue's `spec:blocked` label and `Blocked by:` line, left behind by a move to `native`. */
export interface BlockedLineMark {
  readonly kind: 'blocked-line';
  readonly issue: number;
  /** Every `spec:blocked` label the issue carries, as it spells it. */
  readonly labels: readonly string[];
  readonly what: string;
}

/** A `native` member's sub-issue parent, left behind by a move to `labels`. */
export interface ParentMark {
  readonly kind: 'parent';
  readonly issue: number;
  readonly parent: number;
  readonly what: string;
}

/** A `native` issue's `blockedBy` links, left behind by a move to `labels`. */
export interface BlockedByMark {
  readonly kind: 'blocked-by';
  readonly issue: number;
  readonly blockers: readonly RelatedIssue[];
  readonly what: string;
}

/** One mark of the old mode a second question may remove. */
export type RelationsMoveMark = EpicLabelMark | BlockedLineMark | ParentMark | BlockedByMark;

/** A relationship the move leaves where it is; see the module note. */
export interface RelationsMoveSkip {
  readonly issue: number;
  readonly reason: string;
}

/** What {@link planRelationsMove} answers. */
export interface RelationsMovePlan {
  readonly from: BoardRelationshipMode;
  readonly to: BoardRelationshipMode;
  /** Every write, in the order it is sent; empty when the target holds everything already. */
  readonly writes: readonly RelationsMoveWrite[];
  /** The old mode's marks of every relationship the target holds once the writes are sent. */
  readonly marks: readonly RelationsMoveMark[];
  /** Every relationship left where it is, in the order it was met. */
  readonly skipped: readonly RelationsMoveSkip[];
}

/** The plan as it is built, before it is frozen. */
interface Draft {
  readonly writes: readonly RelationsMoveWrite[];
  readonly marks: readonly RelationsMoveMark[];
  readonly skipped: readonly RelationsMoveSkip[];
}

/** Both readings over one listing. */
interface Readings {
  readonly from: RelationsReading;
  readonly to: RelationsReading;
  readonly fromMode: BoardRelationshipMode;
  readonly toMode: BoardRelationshipMode;
}

const EMPTY: Draft = Object.freeze({ writes: [], marks: [], skipped: [] });

/** `#<n>`, as every line here names a local issue. */
function ref(issue: number): string {
  return `#${String(issue)}`;
}

/** `a` and `b` joined, in order. */
function joined(a: Draft, b: Draft): Draft {
  return { writes: [...a.writes, ...b.writes], marks: [...a.marks, ...b.marks], skipped: [...a.skipped, ...b.skipped] };
}

/** A draft holding one skip. */
function skip(issue: number, reason: string): Draft {
  return { ...EMPTY, skipped: [Object.freeze({ issue, reason })] };
}

/** `blocker` as the port names it, without the state a reading carried. */
function related(blocker: Blocker): RelatedIssue {
  return Object.freeze({ number: blocker.number, repository: blocker.repository });
}

/** `blockers` as a line names them, one space apart. */
function tokens(blockers: readonly RelatedIssue[]): string {
  return blockers.map(blockerToken).join(' ');
}

/** The listing's epics, in ascending number. */
function epicsOf(listing: readonly BoardIssue[]): readonly BoardIssue[] {
  return [...listing].filter((row) => row.type === 'epic').sort((left, right) => left.number - right.number);
}

/** Why `reading` puts `issue` in no single epic in `mode`, or null when it puts it in `epic`. */
function epicMismatch(reading: EpicOfReading, epic: number, mode: BoardRelationshipMode): string | null {
  if (reading.kind === 'epic' && reading.epic === epic) return null;
  if (reading.kind === 'epic') return `in ${mode} mode it is already in epic ${ref(reading.epic)}`;
  if (reading.kind === 'unresolved') {
    return `in ${mode} mode its marks (${reading.marks.map((mark) => mark.mark).join(', ')}) name no single epic`;
  }
  return `in ${mode} mode it is in no epic`;
}

/** How one member of an epic comes out: moved, already held by the target, or skipped. */
type MemberState =
  | { readonly kind: 'move' | 'held'; readonly mark: RelationsMoveMark }
  | { readonly kind: 'skip'; readonly draft: Draft };

/** `member`'s mark in the source mode, `mark` being its source reading's; the one a move to the target leaves behind. */
function membershipMark(readings: Readings, epic: number, member: BoardIssue, mark: string): RelationsMoveMark {
  if (readings.toMode === 'native') {
    return Object.freeze({ kind: 'epic-label', issue: member.number, label: mark, what: `take ${mark} off ${ref(member.number)}` });
  }
  return Object.freeze({
    kind: 'parent',
    issue: member.number,
    parent: epic,
    what: `take ${ref(member.number)} out of epic ${ref(epic)}'s sub-issues`,
  });
}

/** Whether `member` of `epic` moves; see the module note for when it is skipped. */
function memberState(readings: Readings, epic: number, member: BoardIssue): MemberState {
  const not = `${ref(member.number)} is not moved into epic ${ref(epic)}`;
  const source = readings.from.epicOf(member);
  const sourceMismatch = epicMismatch(source, epic, readings.fromMode);
  if (sourceMismatch !== null || source.kind !== 'epic') {
    return { kind: 'skip', draft: skip(member.number, `${not}: ${sourceMismatch ?? ''}`) };
  }
  const mark = membershipMark(readings, epic, member, source.mark);
  const target = readings.to.epicOf(member);
  if (target.kind === 'none') return { kind: 'move', mark };
  const targetMismatch = epicMismatch(target, epic, readings.toMode);
  return targetMismatch === null
    ? { kind: 'held', mark }
    : { kind: 'skip', draft: skip(member.number, `${not}: ${targetMismatch}`) };
}

/** `members` of `epic` sorted into moved, held and skipped, with the marks of the first two. */
function sortMembers(
  readings: Readings,
  epic: number,
  members: readonly BoardIssue[],
): { readonly moved: readonly BoardIssue[]; readonly draft: Draft } {
  let moved: readonly BoardIssue[] = [];
  let draft = EMPTY;
  for (const member of members) {
    const state = memberState(readings, epic, member);
    if (state.kind === 'skip') {
      draft = joined(draft, state.draft);
      continue;
    }
    if (state.kind === 'move') moved = [...moved, member];
    draft = joined(draft, { ...EMPTY, marks: [state.mark] });
  }
  return { moved, draft };
}

/** `labels` to `native`: one `sub-issues` write for `epic`'s members the target does not hold. */
function toNativeMembers(readings: Readings, epic: BoardIssue): Draft {
  const { moved, draft } = sortMembers(readings, epic.number, readings.from.membersOf(epic).members);
  if (moved.length === 0) return draft;
  const issues = Object.freeze(moved.map((member) => member.number));
  const write: SubIssuesWrite = Object.freeze({
    kind: 'sub-issues',
    epic: epic.number,
    issues,
    what: `make ${issues.map(ref).join(', ')} sub-issues of epic ${ref(epic.number)}`,
  });
  return { ...draft, writes: [write] };
}

/** The one write putting a line on `epic`'s checklist for each of `members` it does not name, or none. */
function checklistWrite(epic: BoardIssue, members: readonly BoardIssue[]): readonly ChecklistWrite[] {
  const named = new Set(parseRoadmapBody(epic.body).map((line) => line.issue));
  const lines = members
    .filter((member) => !named.has(member.number))
    .map((member): MoveChecklistLine => Object.freeze({ issue: member.number, why: member.title, ticked: member.state === 'CLOSED' }));
  if (lines.length === 0) return [];
  return [Object.freeze({
    kind: 'checklist',
    epic: epic.number,
    lines: Object.freeze(lines),
    what: `put ${lines.map((line) => ref(line.issue)).join(', ')} on epic ${ref(epic.number)}'s checklist`,
  })];
}

/** `native` to `labels`: `epic`'s label writes, then one checklist write for the lines it lacks. */
function toLabelsMembers(readings: Readings, epic: BoardIssue): Draft {
  const members = readings.from.membersOf(epic).members;
  if (members.length === 0) return EMPTY;
  const slug = epicSlugsOf(epic.labels)[0];
  if (slug === undefined) {
    return members.reduce((draft, member) => joined(draft, skip(member.number, `${ref(member.number)} is not moved into epic `
      + `${ref(epic.number)}: the epic carries no ${EPIC_LABEL_PREFIX}<slug> label to give it`)), EMPTY);
  }
  const label = `${EPIC_LABEL_PREFIX}${slug}`;
  const { moved, draft } = sortMembers(readings, epic.number, members);
  const labelWrites = moved.map((member): EpicLabelWrite => Object.freeze({
    kind: 'epic-label',
    issue: member.number,
    epic: epic.number,
    label,
    what: `label ${ref(member.number)} ${label}, putting it in epic ${ref(epic.number)}`,
  }));
  const skipped = new Set(draft.skipped.map((each) => each.issue));
  const checklist = checklistWrite(epic, members.filter((member) => !skipped.has(member.number)));
  return { ...draft, writes: [...labelWrites, ...checklist] };
}

/** The source's blockers of one issue: none, a skip when they cannot be read whole, or the list. */
type SourceBlockers =
  | { readonly kind: 'none' }
  | { readonly kind: 'skip'; readonly draft: Draft }
  | { readonly kind: 'blockers'; readonly blockers: readonly RelatedIssue[] };

/** What the source reads `issue` waiting on. */
function sourceBlockers(readings: Readings, issue: BoardIssue): SourceBlockers {
  const reading: BlockersReading = readings.from.blockersOf(issue);
  if (reading.kind === 'none') return { kind: 'none' };
  const not = `${ref(issue.number)}'s blockers are not moved`;
  if (reading.kind === 'fault') return { kind: 'skip', draft: skip(issue.number, `${not}: ${reading.message}`) };
  if (reading.truncated !== undefined) {
    const reason = `${not}: ${readings.fromMode} mode holds ${String(reading.truncated.total)} and`
      + ` the listing read ${String(reading.blockers.length)}`;
    return { kind: 'skip', draft: skip(issue.number, reason) };
  }
  return { kind: 'blockers', blockers: reading.blockers.map(related) };
}

/**
 * The blockers the target already holds for `issue`, each as a line
 * names it, lowercased: its links in `native`, and in `labels` what its
 * `Blocked by:` line names, whether or not the line reads cleanly.
 */
function heldTokens(readings: Readings, issue: BoardIssue): ReadonlySet<string> {
  const reading = readings.toMode === 'native'
    ? readings.to.blockersOf(issue)
    : labelsLineBlockersOf(issue.number, issue.body);
  if (reading.kind === 'none') return new Set();
  const named = reading.kind === 'blocked'
    ? reading.blockers.map(blockerToken)
    : [...reading.line.blockers.map(ref), ...reading.line.foreign];
  return new Set(named.map((token) => token.toLowerCase()));
}

/** The write putting `missing` on `issue` in the target mode, or none when there is nothing to put. */
function blockerWrite(readings: Readings, issue: BoardIssue, missing: readonly RelatedIssue[]): readonly RelationsMoveWrite[] {
  const blockers = Object.freeze([...missing]);
  if (readings.toMode === 'native') {
    return missing.length === 0
      ? []
      : [Object.freeze({ kind: 'blocked-by', issue: issue.number, blockers, what: `link ${ref(issue.number)} as blocked by ${tokens(missing)}` })];
  }
  const label = !hasSpecBlockedLabel(issue.labels);
  if (!label && missing.length === 0) return [];
  const parts = [
    ...label
      ? [`label ${ref(issue.number)} ${SPEC_BLOCKED_LABEL}`]
      : [],
    ...missing.length > 0
      ? [`name ${tokens(missing)} on ${ref(issue.number)}'s Blocked by: line`]
      : [],
  ];
  return [Object.freeze({ kind: 'blocked-line', issue: issue.number, label, blockers, what: parts.join(' and ') })];
}

/** The source mode's mark of `issue`'s blockers, the one a move to the target leaves behind. */
function blockerMark(readings: Readings, issue: BoardIssue, blockers: readonly RelatedIssue[]): RelationsMoveMark {
  if (readings.toMode === 'native') {
    const labels = Object.freeze(issue.labels.filter((label) => hasSpecBlockedLabel([label])));
    return Object.freeze({
      kind: 'blocked-line',
      issue: issue.number,
      labels,
      what: `take ${SPEC_BLOCKED_LABEL} and the Blocked by: line off ${ref(issue.number)}`,
    });
  }
  return Object.freeze({
    kind: 'blocked-by',
    issue: issue.number,
    blockers: Object.freeze([...blockers]),
    what: `unlink ${ref(issue.number)} from its blockers ${tokens(blockers)}`,
  });
}

/** `issue`'s blocker write and mark, or its skip. */
function moveBlockers(readings: Readings, issue: BoardIssue): Draft {
  const source = sourceBlockers(readings, issue);
  if (source.kind === 'none') return EMPTY;
  if (source.kind === 'skip') return source.draft;
  const held = heldTokens(readings, issue);
  const missing = source.blockers.filter((blocker) => !held.has(blockerToken(blocker).toLowerCase()));
  return { writes: blockerWrite(readings, issue, missing), marks: [blockerMark(readings, issue, source.blockers)], skipped: [] };
}

/**
 * The move of every relationship `from` reads on `listing` into `to`'s
 * mode; the module note holds what moves, in what order, and what is
 * skipped. Pure: nothing is sent. Throws a `TypeError` when both sides
 * read one mode, and whatever a side's reader throws for a listing it
 * refuses.
 */
export function planRelationsMove(
  listing: readonly BoardIssue[],
  from: RelationsMoveSide,
  to: RelationsMoveSide,
): RelationsMovePlan {
  if (from.mode === to.mode) {
    throw new TypeError(`${PREFIX}: refused to move a board from ${from.mode} to ${to.mode}; the two modes must differ`);
  }
  const readings: Readings = { from: from.read(listing), to: to.read(listing), fromMode: from.mode, toMode: to.mode };
  const members = epicsOf(listing).reduce((draft, epic) => joined(draft, to.mode === 'native'
    ? toNativeMembers(readings, epic)
    : toLabelsMembers(readings, epic)), EMPTY);
  const waiting = [...listing]
    .sort((left, right) => left.number - right.number)
    .reduce((draft, row) => joined(draft, moveBlockers(readings, row)), EMPTY);
  const plan = joined(members, waiting);
  return Object.freeze({
    from: from.mode,
    to: to.mode,
    writes: Object.freeze(plan.writes),
    marks: Object.freeze(plan.marks),
    skipped: Object.freeze(plan.skipped),
  });
}
