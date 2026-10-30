/**
 * The dependents of an epic: every open issue OUTSIDE the epic that
 * waits on one of the epic's open members, with the members it waits
 * on; in `labels` mode its `Blocked by:` line names them, in `native`
 * mode its `blockedBy` links do. `rafa epic cancel <n>` asks about each of them
 * before it closes the epic, and the cancelled-epic notice names them
 * for an epic already closed as not planned; both read them here.
 *
 * Nothing here spawns `gh`, opens a file or asks anything:
 * {@link readEpicDependents} is a pure function over ONE board listing
 * (`./roadmap-board.ts`) and the epic's number, so every case in
 * `./epic-dependents.test.ts` and `./epic-dependents-native.test.ts` is
 * a literal listing.
 *
 * ## Members and outsiders
 *
 * In `labels` mode membership is the `epic:<slug>` label, read as
 * `./epics.ts` reads it:
 * the epic's slug is its first `epic:` label, and its members are the
 * issues carrying that label that are not `type:epic` themselves
 * ({@link groupByEpicLabel}). An epic carrying no `epic:` label has no
 * members, so nothing can depend on it. Only OPEN members are waited on;
 * a closed one, whatever its reason, blocks nothing.
 *
 * An issue is OUTSIDE the epic when it is open, is not a member and is
 * not the epic itself. An issue carrying this epic's label and another's
 * is a member, and is never its own epic's dependent. A `type:epic`
 * issue of another epic is outside, and is read like any other.
 *
 * ## Reading the line
 *
 * Each outsider's line is read with {@link readBlockedBy}, handed the
 * listing's numbers as `known`. Only a `blocked` reading is acted on: its
 * local ids that are open members are {@link EpicDependent.waitsOn}, in
 * the order the line names them, and an issue naming none of them is no
 * dependent. A body with no line, and a line that names no local id,
 * name no member and are left alone.
 *
 * A line that parses but is a fault — it names its own issue, or an id
 * the listing has no issue for — is UNREADABLE: its ids are for
 * printing, not for acting on (`./blocked.ts`). When such a line names
 * an open member, the issue may well wait on the epic, and guessing
 * either way would be wrong, so it is reported as an
 * {@link EpicDependentProblem} carrying {@link blockedFaultMessage}'s
 * sentence and is not listed as a dependent. A faulty line naming no
 * member is not this epic's business and is not reported here;
 * `rafa doctor` reports it.
 *
 * ## The mode
 *
 * Who is in the epic and what an outsider waits on are relationships,
 * read in the mode `board.relationships` names through the board's
 * relationships port (`./relations/port.ts`),
 * {@link EpicDependentsOptions.relations}; left out, the mode is
 * `labels` (`LABELS_READS`), what every caller before the port read.
 *
 * - In `labels` mode everything reads as the two sections above spell
 *   it. That reading stays here rather than going through the port's
 *   `blockersOf`, which reads a line only under `spec:blocked` and
 *   without the listing's numbers, so routing it through the port would
 *   change who `rafa epic cancel` asks about.
 * - In `native` mode the port's one reading over the listing answers
 *   both, and no `epic:` label and no `Blocked by:` line is read. The
 *   members are `membersOf`'s, the rows whose `parent` is the epic, and
 *   {@link EpicDependents.slug} is null: a native epic is named by its
 *   number and title. An outsider waits on the epic when a `blockedBy`
 *   node of its reading names an open member on this board;
 *   {@link EpicDependent.waitsOn} lists them in the order `gh` answered
 *   the nodes. A node on another repository is never a member. A native
 *   issue has one parent and a blocker per link, so there is no fault to
 *   read and {@link EpicDependents.problems} is always empty.
 *
 * ## The epic itself
 *
 * An epic number the listing has no `type:epic` issue for answers null,
 * and the caller words the refusal. The epic's own state is not read:
 * an epic already closed as not planned still has its dependents, which
 * is what the notice reports.
 */
import type { BlockedReading } from './blocked.js';
import type { EpicRelations } from './epics.js';
import type { RelationsReading } from './relations/port.js';
import type { BoardIssue } from './roadmap-board.js';

import { blockedFaultMessage, readBlockedBy } from './blocked.js';
import { epicSlugsOf, groupByEpicLabel } from './epics.js';
import { LABELS_READS } from './relations/labels.js';

/** One open issue outside the epic that waits on its open members. */
export interface EpicDependent {
  /** The waiting issue, as the listing read it. */
  readonly issue: BoardIssue;
  /** The epic's open members its line names, in line order; in `native` mode, in the order of its `blockedBy` nodes. */
  readonly waitsOn: readonly number[];
}

/** What {@link readEpicDependents} reads besides the listing and the epic. */
export interface EpicDependentsOptions {
  /** The board's relationships, which read the members and what each outsider waits on; `labels` mode when left out. */
  readonly relations?: EpicRelations;
}

/** An outsider whose unreadable `Blocked by:` line names an open member. */
export interface EpicDependentProblem {
  /** The issue whose line it is. */
  readonly issue: number;
  /** The line, read; never `blocked`. */
  readonly reading: BlockedReading;
  /** The epic's open members the line names, in line order. */
  readonly names: readonly number[];
  /** What a report prints: {@link blockedFaultMessage} for the reading. */
  readonly message: string;
}

/** What {@link readEpicDependents} answers for an epic on the listing. */
export interface EpicDependents {
  /** The epic's number. */
  readonly epic: number;
  /** Its slug, or null when it carries no `epic:` label, and always in `native` mode. */
  readonly slug: string | null;
  /** Its open members, in ascending number. */
  readonly openMembers: readonly number[];
  /** Every dependent, in ascending issue number. */
  readonly dependents: readonly EpicDependent[];
  /** Every unreadable line naming an open member, in ascending issue number; always empty in `native` mode. */
  readonly problems: readonly EpicDependentProblem[];
}

/** The epic's open members, in ascending number, and every member's number. */
function membersOf(slug: string | null, issues: readonly BoardIssue[]): {
  readonly open: readonly number[];
  readonly all: ReadonlySet<number>;
} {
  const members = slug === null
    ? []
    : groupByEpicLabel(issues).get(slug) ?? [];
  return {
    open: members.filter((member) => member.state === 'OPEN').map((member) => member.number),
    all: new Set(members.map((member) => member.number)),
  };
}

/** The open issues outside the epic, in ascending number: not the epic, and not one of `members`. */
function outsidersOf(issues: readonly BoardIssue[], epic: number, members: ReadonlySet<number>): readonly BoardIssue[] {
  return issues
    .filter((issue) => issue.state === 'OPEN' && issue.number !== epic && !members.has(issue.number))
    .sort((left, right) => left.number - right.number);
}

/** The frozen answer. */
function answer(
  epic: number,
  slug: string | null,
  openMembers: readonly number[],
  dependents: readonly EpicDependent[],
  problems: readonly EpicDependentProblem[],
): EpicDependents {
  return Object.freeze({
    epic,
    slug,
    openMembers: Object.freeze([...openMembers]),
    dependents: Object.freeze([...dependents]),
    problems: Object.freeze([...problems]),
  });
}

/** The `labels`-mode reading: the `epic:` label and each outsider's `Blocked by:` line; see the module note. */
function readLabelsDependents(issues: readonly BoardIssue[], epicIssue: BoardIssue): EpicDependents {
  const epic = epicIssue.number;
  const slug = epicSlugsOf(epicIssue.labels)[0] ?? null;
  const members = membersOf(slug, issues);
  const open = new Set(members.open);
  const known = new Set(issues.map((issue) => issue.number));

  const dependents: EpicDependent[] = [];
  const problems: EpicDependentProblem[] = [];
  for (const issue of outsidersOf(issues, epic, members.all)) {
    const reading = readBlockedBy(issue.number, issue.body, known);
    const names = reading.blockers.filter((id) => open.has(id));
    if (names.length === 0) continue;
    if (reading.kind === 'blocked') {
      dependents.push(Object.freeze({ issue, waitsOn: Object.freeze(names) }));
      continue;
    }
    problems.push(Object.freeze({
      issue: issue.number,
      reading,
      names: Object.freeze(names),
      message: blockedFaultMessage(reading),
    }));
  }
  return answer(epic, slug, members.open, dependents, problems);
}

/** The open members on this board `issue`'s `blockedBy` nodes name, in node order. */
function nativeWaitsOn(reading: RelationsReading, issue: BoardIssue, open: ReadonlySet<number>): readonly number[] {
  const blockers = reading.blockersOf(issue);
  if (blockers.kind !== 'blocked') return [];
  return blockers.blockers
    .filter((blocker) => blocker.repository === null && open.has(blocker.number))
    .map((blocker) => blocker.number);
}

/** The `native`-mode reading: the epic's sub-issues and each outsider's `blockedBy` nodes; see the module note. */
function readNativeDependents(issues: readonly BoardIssue[], epicIssue: BoardIssue, relations: EpicRelations): EpicDependents {
  const reading = relations.read(issues);
  const members = reading.membersOf(epicIssue).members;
  const openMembers = members
    .filter((member) => member.state === 'OPEN')
    .map((member) => member.number)
    .sort((left, right) => left - right);
  const open = new Set(openMembers);
  const all = new Set(members.map((member) => member.number));

  const dependents: EpicDependent[] = [];
  for (const issue of outsidersOf(issues, epicIssue.number, all)) {
    const waitsOn = nativeWaitsOn(reading, issue, open);
    if (waitsOn.length > 0) dependents.push(Object.freeze({ issue, waitsOn: Object.freeze([...waitsOn]) }));
  }
  return answer(epicIssue.number, null, openMembers, dependents, []);
}

/**
 * The dependents of epic `epic` over one board listing, and every
 * unreadable line naming one of its open members, in the mode
 * `options.relations` answers; the module note holds the rules. Null
 * when the listing has no `type:epic` issue numbered `epic`. In `native`
 * mode, throws the port's `TypeError` for a listing read without the
 * native fields; never throws otherwise.
 */
export function readEpicDependents(
  issues: readonly BoardIssue[],
  epic: number,
  options: EpicDependentsOptions = {},
): EpicDependents | null {
  const epicIssue = issues.find((issue) => issue.number === epic && issue.type === 'epic');
  if (epicIssue === undefined) return null;
  const relations = options.relations ?? LABELS_READS;
  return relations.mode === 'native'
    ? readNativeDependents(issues, epicIssue, relations)
    : readLabelsDependents(issues, epicIssue);
}
