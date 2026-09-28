/**
 * The epic labels row of `rafa doctor`: every issue carrying two `epic:`
 * labels, and every `epic:` label that no epic carries, named under
 * `Epic labels:` with what fixes each.
 *
 * An issue belongs to exactly one epic, and a mistyped slug drops a
 * member from its epic without a trace, so the epic reads done early
 * (`.rafa/specs/rafa-244-epics-group-issues-features.md`). Both faults
 * are found by `readEpicProblems` (`src/board/epic-problems.ts`), the
 * only reader of them, and each is printed as that module's
 * `epicProblemMessage` spells it: this module never respells a fault. It
 * keeps the two kinds the spec gives `doctor`, `several-epic-labels` and
 * `orphan-label`, in the order the reader answers them; the horizon and
 * checklist faults are the board views' (`rafa roadmap`, `rafa epics`).
 *
 * ## One command
 *
 * The labels are read from the one board listing the roadmap and epic
 * views read (`src/board/roadmap-board.ts`):
 *
 * ```
 * gh issue list --state all --limit 1000 --json number,title,body,state,stateReason,labels
 * ```
 *
 * `--state all` because a closed issue still carries its labels, and a
 * closed member under a mistyped slug is a member its epic does not
 * count. Nothing reads issues one by one. The listing goes through the
 * {@link GhRunner} `rafa doctor` opens for its other board readings
 * (`./doctor-board.ts`), so a repository whose provider is not `gh`
 * sends it not at all, and that module reads it once per run and hands
 * the same answer to the boards row (`./doctor-boards.ts`).
 *
 * ## An orphan is reported only when the whole board was read
 *
 * A label is an orphan when no `type:epic` issue carries it, and an epic
 * past the end of a listing that came back full is an epic this run did
 * not read. So when the listing answers as many issues as it asked for,
 * NO orphan is reported and {@link DoctorEpicsReport.unchecked} carries
 * the sentence saying so, as `./doctor-blocked.ts` refuses to call an id
 * unknown on a half-read board. Two labels on one issue are read off that
 * issue alone and are reported either way.
 *
 * ## What it prints
 *
 * A board where no issue carries an `epic:` label prints nothing, so a
 * project with no epics reads the report it read before this row. One
 * with labels and no fault prints the heading and one line counting
 * them. A fault is one line each. A listing that failed or answered
 * something else is the heading and one line naming why; it is read
 * once, never retried, and {@link readDoctorEpics} never throws.
 *
 * ## Nothing here writes
 *
 * No label is removed and no issue is edited: which of two labels is the
 * right one is the author's to say, and the optional label workflow
 * `rafa init --board` installs is what acts on the forge. The row never
 * changes the exit code. Every case in `./doctor-epics.test.ts` drives a
 * recorded fake runner, so none of them reaches GitHub or spawns `gh`.
 */
import type { GhRunner } from '../adapters/tracker/github.js';
import type { EpicProblem } from '../board/epic-problems.js';
import type { BoardIssue, BoardListing } from '../board/roadmap-board.js';

import { epicProblemMessage, readEpicProblems } from '../board/epic-problems.js';
import { EPIC_LABEL_PREFIX, epicSlugsOf } from '../board/epics.js';
import { BOARD_LISTING_LIMIT, createGhBoardListing } from '../board/roadmap-board.js';
import { messageOf } from '../config-sections.js';

import { plural } from './plan/plan-files.js';

/** The heading the epic label lines sit under, as `Blocked issues:` heads its own. */
export const EPICS_HEADING = 'Epic labels:';

/** The problem kinds this row reports, of those `readEpicProblems` answers. */
export const DOCTOR_EPIC_KINDS: ReadonlySet<EpicProblem['kind']> = new Set(['several-epic-labels', 'orphan-label']);

/** What one reading of the board's `epic:` labels came to. */
export interface DoctorEpicsReport {
  /** How many listed issues carry an `epic:` label, epics included. */
  readonly labelled: number;
  /** Every issue carrying two `epic:` labels and every orphan label, in `readEpicProblems`'s order. */
  readonly faults: readonly EpicProblem[];
  /** Why the listing could not be read; null when it answered. */
  readonly problem: string | null;
  /** Why no label was checked for an epic carrying it; null when every one was. */
  readonly unchecked: string | null;
}

/** What {@link readDoctorEpics} reads through. */
export interface DoctorEpicsOptions {
  /** Runs the listing, in the repository the board belongs to. */
  readonly gh: GhRunner;
  /** How many issues the listing asks for. `BOARD_LISTING_LIMIT` when left out. */
  readonly limit?: number;
  /**
   * The listing, already made over `gh` with `limit`, when a caller shares
   * one between rows (`./doctor-board.ts`); a fresh one when left out.
   */
  readonly listing?: BoardListing;
}

/** The faults of `issues` this row reports, orphans left out when the board was not read whole. */
function faultsOf(issues: readonly BoardIssue[], whole: boolean): readonly EpicProblem[] {
  return Object.freeze(readEpicProblems(issues).filter((problem) => DOCTOR_EPIC_KINDS.has(problem.kind)
    && (whole || problem.kind !== 'orphan-label')));
}

/**
 * Every issue on the board carrying two `epic:` labels, and every
 * `epic:` label no `type:epic` issue carries, read in one listing.
 *
 * Writes nothing and never throws: a listing that failed or answered
 * something else comes back as {@link DoctorEpicsReport.problem} with no
 * fault, and one that came back full as {@link
 * DoctorEpicsReport.unchecked} with no orphan. See the module note.
 */
export async function readDoctorEpics(options: DoctorEpicsOptions): Promise<DoctorEpicsReport> {
  const { gh, limit = BOARD_LISTING_LIMIT } = options;

  let issues: readonly BoardIssue[];
  try {
    issues = await (options.listing ?? createGhBoardListing({ gh, limit }))();
  } catch (error) {
    return Object.freeze({ labelled: 0, faults: [], problem: messageOf(error), unchecked: null });
  }

  const whole = issues.length < limit;
  const labelled = issues.filter((issue) => epicSlugsOf(issue.labels).length > 0).length;
  const unchecked = whole
    ? null
    : `the board answered the ${plural(limit, 'issue')} the listing asked for and may hold more,`
      + ` so no ${EPIC_LABEL_PREFIX} label was checked for an epic carrying it`;
  return Object.freeze({ labelled, faults: faultsOf(issues, whole), problem: null, unchecked });
}

/** The line a report with no fault ends on: what was read, and that it reads. */
function cleanLine(report: DoctorEpicsReport): string {
  const orphans = report.unchecked === null
    ? ', every slug one a type:epic issue carries'
    : '';
  return `  ${plural(report.labelled, 'issue')} with an ${EPIC_LABEL_PREFIX} label, none with two${orphans}`;
}

/**
 * The lines text mode writes for the epic labels: the heading, one
 * sentence per fault, and the line saying no orphan was checked when
 * none was. A report whose board carries no `epic:` label and whose
 * listing answered prints nothing at all; null, for a project with no
 * GitHub board, prints nothing either.
 */
export function renderDoctorEpics(report: DoctorEpicsReport | null): readonly string[] {
  if (report === null) return [];
  if (report.problem !== null) {
    return [EPICS_HEADING, `  the ${EPIC_LABEL_PREFIX} labels could not be read: ${report.problem}`];
  }
  if (report.labelled === 0) return [];

  const body = report.faults.length === 0
    ? [cleanLine(report)]
    : report.faults.map((fault) => `  ${epicProblemMessage(fault)}`);
  const unchecked = report.unchecked === null
    ? []
    : [`  ${report.unchecked}`];
  return [EPICS_HEADING, ...body, ...unchecked];
}
