/**
 * The lines `rafa doctor` ends its board rows with for the blocked
 * issues: the `Blocked issues:` heading, one sentence per issue whose
 * `Blocked by:` line is missing or unreadable, and the line saying no
 * id was checked when none was. This is the command half of
 * `../board/blocked-issues.ts`, which holds the reading itself
 * (`readBlockedIssues`, its report, the two `gh` commands it sends and
 * why a board-wide id is checked only against a board read whole).
 *
 * The row runs in the `labels` mode of `board.relationships` alone
 * (`./doctor-board.ts`, "The mode"): `spec:blocked` and the `Blocked
 * by:` line are that mode's marks, and a `native` board is read by the
 * relationships row (`./doctor-relations.ts`) instead.
 *
 * It sits beside `./init-board.ts`, the other module holding a
 * board-shaped piece of a command's output. It is a module of its own
 * rather than more functions in `src/commands/doctor.ts`, which is
 * 700-odd lines against a 800-line cap (`context/source.md`).
 *
 * Nothing here reads the board, writes or spawns: {@link
 * renderBlockedIssues} spells a report it is handed, and
 * `./doctor-board.ts` is what reads one, through the runner it opens
 * for the board rows.
 *
 * `./doctor-blocked.test.ts` drives the reading and these lines
 * together over a recorded fake runner, so no case reaches GitHub or
 * spawns `gh`.
 */
import type { BlockedIssuesReport } from '../board/blocked-issues.js';
import type { BlockedReading } from '../board/blocked.js';

import { SPEC_BLOCKED_LABEL } from '../board/blocked.js';
import { plural } from '../plan/plan-files.js';

/** The heading the blocked lines sit under, as `GitHub board:` heads the rows. */
export const BLOCKED_HEADING = 'Blocked issues:';

/** The line a report with no fault ends on: what was read, and that it reads. */
function cleanLine(readings: readonly BlockedReading[]): string {
  const named = new Set(readings.flatMap((read) => read.blockers)).size;
  return `  ${plural(readings.length, 'issue')} labelled ${SPEC_BLOCKED_LABEL},`
    + ` naming ${plural(named, 'blocker')} this run could read`;
}

/**
 * The lines text mode writes for the blocked issues: the heading, one
 * sentence per fault, and the line saying no id was checked when none
 * was. A report with no blocked issue and no problem prints nothing at
 * all, since a board with none has nothing to say about them.
 */
export function renderBlockedIssues(report: BlockedIssuesReport | null): readonly string[] {
  if (report === null) return [];
  if (report.problem !== null) {
    return [BLOCKED_HEADING, `  the issues labelled ${SPEC_BLOCKED_LABEL} could not be read: ${report.problem}`];
  }
  if (report.readings.length === 0) return [];

  const body = report.faults.length === 0
    ? [cleanLine(report.readings)]
    : report.faults.map((fault) => `  ${fault}`);
  const unchecked = report.unchecked === null
    ? []
    : [`  ${report.unchecked}`];
  return [BLOCKED_HEADING, ...body, ...unchecked];
}
