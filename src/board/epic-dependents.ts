/**
 * The dependents of an epic: every open issue OUTSIDE the epic whose
 * `Blocked by:` line names one of the epic's open members, with the
 * members it waits on. `rafa epic cancel <n>` asks about each of them
 * before it closes the epic, and the cancelled-epic notice names them
 * for an epic already closed as not planned; both read them here.
 *
 * Nothing here spawns `gh`, opens a file or asks anything:
 * {@link readEpicDependents} is a pure function over ONE board listing
 * (`./roadmap-board.ts`) and the epic's number, so every case in
 * `./epic-dependents.test.ts` is a literal listing.
 *
 * ## Members and outsiders
 *
 * Membership is the `epic:<slug>` label, read as `./epics.ts` reads it:
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
 * ## The epic itself
 *
 * An epic number the listing has no `type:epic` issue for answers null,
 * and the caller words the refusal. The epic's own state is not read:
 * an epic already closed as not planned still has its dependents, which
 * is what the notice reports.
 */
import type { BlockedReading } from './blocked.js';
import type { BoardIssue } from './roadmap-board.js';

import { blockedFaultMessage, readBlockedBy } from './blocked.js';
import { epicSlugsOf, groupByEpicLabel } from './epics.js';

/** One open issue outside the epic that waits on its open members. */
export interface EpicDependent {
  /** The waiting issue, as the listing read it. */
  readonly issue: BoardIssue;
  /** The epic's open members its line names, in line order. */
  readonly waitsOn: readonly number[];
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
  /** Its slug, or null when it carries no `epic:` label. */
  readonly slug: string | null;
  /** Its open members, in ascending number. */
  readonly openMembers: readonly number[];
  /** Every dependent, in ascending issue number. */
  readonly dependents: readonly EpicDependent[];
  /** Every unreadable line naming an open member, in ascending issue number. */
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

/**
 * The dependents of epic `epic` over one board listing, and every
 * unreadable line naming one of its open members; the module note holds
 * the rules. Null when the listing has no `type:epic` issue numbered
 * `epic`. Never throws.
 */
export function readEpicDependents(issues: readonly BoardIssue[], epic: number): EpicDependents | null {
  const epicIssue = issues.find((issue) => issue.number === epic && issue.type === 'epic');
  if (epicIssue === undefined) return null;

  const slug = epicSlugsOf(epicIssue.labels)[0] ?? null;
  const members = membersOf(slug, issues);
  const open = new Set(members.open);
  const known = new Set(issues.map((issue) => issue.number));
  const outsiders = issues
    .filter((issue) => issue.state === 'OPEN' && issue.number !== epic && !members.all.has(issue.number))
    .sort((left, right) => left.number - right.number);

  const dependents: EpicDependent[] = [];
  const problems: EpicDependentProblem[] = [];
  for (const issue of outsiders) {
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

  return Object.freeze({
    epic,
    slug,
    openMembers: Object.freeze([...members.open]),
    dependents: Object.freeze(dependents),
    problems: Object.freeze(problems),
  });
}
