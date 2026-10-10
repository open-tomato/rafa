/**
 * The relationships row of `rafa doctor` in the `native` mode of
 * `board.relationships`: every relationship list `gh` answered short of
 * what GitHub holds, named under `Relationships:`
 * (`.rafa/specs/rafa-340-relationships-epics-blockers-github.md`,
 * "Updated to make native relationships a mode", Truncated lists).
 *
 * In `native` mode the blocked issues row (`./doctor-blocked.ts`) and
 * the epic labels row (`./doctor-epics.ts`) do not run: a `Blocked by:`
 * line and an `epic:` label are the `labels` mode's marks, and GitHub
 * holds one parent per issue and one blocker per link, so neither fault
 * exists. What can go wrong instead is a list read short: `gh` answers
 * the first 50 `blockedBy` nodes and the first 100 `subIssues` of each
 * issue (`context/pull-requests.md`, "Native relationships"), and a
 * `totalCount` above them is kept on the listing row as `truncated`.
 *
 * ## Read through the port, off the listing doctor holds
 *
 * Both lists are read through the `native` adapter's reads
 * (`src/board/relations/native.ts`), over the one board listing
 * `./doctor-board.ts` makes in the `native` mode and shares with the
 * boards row, so the run sends that listing once. The adapter needs the
 * board's repository to tell a local link from a foreign one, read with
 * one `gh repo view --json nameWithOwner` (`readBoardRepository`,
 * `./epic/move-native.ts`) after the listing answered. No issue is read
 * one at a time.
 *
 *  - Blockers: every OPEN issue whose `blockersOf` reading is truncated.
 *    Such an issue reads as waiting whatever its unread blockers hold
 *    (`isWaiting`, `src/board/relations/port.ts`). A closed issue waits
 *    on nothing, so its list is not named.
 *  - Sub-issues: every epic, open or closed, whose `membersOf` reading is
 *    truncated. Membership is each row's own `parent`, so no member is
 *    lost; the members past the answered nodes have no place GitHub told
 *    the listing, and read after the others in number order.
 *
 * ## What it prints
 *
 * A board where no open issue has a blocker and no epic has a sub-issue
 * prints nothing, as the epic labels row prints nothing for a board with
 * no `epic:` label. One with links and nothing truncated prints the
 * heading and one line counting them. A truncated list is one line
 * each. A listing or a repository read that failed is the heading and
 * one line naming why; each is read once, never retried, and
 * {@link readDoctorRelations} never throws.
 *
 * ## Nothing here writes
 *
 * No link is added or removed: which blockers or sub-issues to drop is
 * the author's to say. The row never changes the exit code. Every case
 * in `./doctor-relations.test.ts` drives a recorded fake runner, so none
 * of them reaches GitHub or spawns `gh`.
 */
import type { GhRunner } from '../adapters/tracker/github.js';
import type { RelationsReading } from '../board/relations/port.js';
import type { BoardIssue, BoardListing } from '../board/roadmap-board.js';

import { selectBoardRelations } from '../board/relations/select.js';
import { messageOf } from '../config-sections.js';
import { plural } from '../plan/plan-files.js';

import { NATIVE_MODE, readBoardRepository } from './epic/move-native.js';

/** The heading the relationship lines sit under. */
export const RELATIONS_HEADING = 'Relationships:';

/** An open issue whose `blockedBy` list `gh` answered short. */
export interface TruncatedBlockers {
  readonly kind: 'blockers';
  readonly issue: number;
  /** How many blockers `gh` answered. */
  readonly answered: number;
  /** GitHub's `totalCount`, above {@link answered}. */
  readonly total: number;
}

/** An epic whose `subIssues` list `gh` answered short. */
export interface TruncatedSubIssues {
  readonly kind: 'sub-issues';
  readonly epic: number;
  /** GitHub's `totalCount`, above the nodes `gh` answered. */
  readonly total: number;
}

/** One relationship list read short. */
export type RelationsTruncation = TruncatedBlockers | TruncatedSubIssues;

/** What one reading of the board's native relationships came to. */
export interface DoctorRelationsReport {
  /** The mode it was read in; the row runs in `native` alone. */
  readonly relationships: 'native';
  /** How many open issues have at least one blocker. */
  readonly blocked: number;
  /** How many epics have at least one sub-issue. */
  readonly epics: number;
  /** Every truncated list: blockers in ascending issue number, then sub-issues in ascending epic number. */
  readonly truncated: readonly RelationsTruncation[];
  /** Why the listing or the repository could not be read; null when both answered. */
  readonly problem: string | null;
}

/** What {@link readDoctorRelations} reads through. */
export interface DoctorRelationsOptions {
  /** Runs the repository read, in the repository the board belongs to. */
  readonly gh: GhRunner;
  /** The board listing, made over `gh` in the `native` mode and shared with the boards row. */
  readonly listing: BoardListing;
}

/** The report for `problem`, with nothing read. */
function failed(problem: string): DoctorRelationsReport {
  return Object.freeze({ relationships: 'native', blocked: 0, epics: 0, truncated: Object.freeze([]), problem });
}

/** The open issues with a blocker, and each whose list was truncated. */
function blockerReadings(listing: readonly BoardIssue[], reading: RelationsReading): {
  readonly blocked: number;
  readonly truncated: readonly TruncatedBlockers[];
} {
  const readings = listing
    .filter((issue) => issue.state === 'OPEN')
    .map((issue) => reading.blockersOf(issue))
    .flatMap((each) => each.kind === 'blocked'
      ? [each]
      : []);
  const truncated = readings.flatMap((each) => each.truncated === undefined
    ? []
    : [Object.freeze({ kind: 'blockers' as const, issue: each.issue, answered: each.blockers.length, total: each.truncated.total })]);
  return { blocked: readings.length, truncated };
}

/** The epics with a sub-issue, and each whose list was truncated. */
function subIssueReadings(listing: readonly BoardIssue[], reading: RelationsReading): {
  readonly epics: number;
  readonly truncated: readonly TruncatedSubIssues[];
} {
  const readings = listing
    .filter((issue) => issue.type === 'epic')
    .map((epic) => reading.membersOf(epic))
    .filter((each) => each.members.length > 0 || each.truncated !== undefined);
  const truncated = readings.flatMap((each) => each.truncated === undefined
    ? []
    : [Object.freeze({ kind: 'sub-issues' as const, epic: each.epic, total: each.truncated.total })]);
  return { epics: readings.length, truncated };
}

/** Sorts by the issue each truncation names, ascending. */
function byNumber<T extends RelationsTruncation>(rows: readonly T[]): readonly T[] {
  const numberOf = (row: RelationsTruncation): number => row.kind === 'blockers'
    ? row.issue
    : row.epic;
  return [...rows].sort((left, right) => numberOf(left) - numberOf(right));
}

/**
 * Every open issue whose blockers and every epic whose sub-issues `gh`
 * answered short, read through the `native` adapter over one listing.
 *
 * Writes nothing and never throws: a listing or repository read that
 * failed comes back as {@link DoctorRelationsReport.problem} with
 * nothing counted. See the module note.
 */
export async function readDoctorRelations(options: DoctorRelationsOptions): Promise<DoctorRelationsReport> {
  const { gh, listing } = options;
  try {
    const issues = await listing();
    const repository = await readBoardRepository(gh);
    const reading = selectBoardRelations({ boardRelationships: 'native' }, { gh, repository }).read(issues);
    const blockers = blockerReadings(issues, reading);
    const subIssues = subIssueReadings(issues, reading);
    return Object.freeze({
      relationships: 'native',
      blocked: blockers.blocked,
      epics: subIssues.epics,
      truncated: Object.freeze([...byNumber(blockers.truncated), ...byNumber(subIssues.truncated)]),
      problem: null,
    });
  } catch (error) {
    return failed(messageOf(error));
  }
}

/** The sentence naming one truncated list. */
export function truncationMessage(row: RelationsTruncation): string {
  if (row.kind === 'blockers') {
    return `#${String(row.issue)}: GitHub holds ${plural(row.total, 'blocker')} and gh answered ${String(row.answered)},`
      + ' so it reads as waiting whatever the rest hold';
  }
  return `epic #${String(row.epic)}: GitHub holds ${plural(row.total, 'sub-issue')}, more than gh answers in order,`
    + ' so the members past them read after the others in number order';
}

/**
 * The lines text mode writes for the relationships: the heading and one
 * sentence per truncated list, or one line counting what read whole. A
 * report with no blocker and no sub-issue prints nothing at all; null,
 * for a project with no GitHub board or in `labels` mode, prints nothing
 * either.
 */
export function renderDoctorRelations(report: DoctorRelationsReport | null): readonly string[] {
  if (report === null) return [];
  if (report.problem !== null) {
    return [RELATIONS_HEADING, `  the ${NATIVE_MODE} relationships could not be read: ${report.problem}`];
  }
  if (report.blocked === 0 && report.epics === 0) return [];
  const body = report.truncated.length === 0
    ? [`  ${plural(report.blocked, 'open issue')} with blockers and ${plural(report.epics, 'epic')} with sub-issues, every list read whole`]
    : report.truncated.map((row) => `  ${truncationMessage(row)}`);
  return [RELATIONS_HEADING, ...body];
}
