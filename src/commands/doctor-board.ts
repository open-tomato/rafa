/**
 * The GitHub board readings of `rafa doctor` (`./doctor.ts`): the runner
 * they go through, and the three readings made over it — the board rows,
 * the blocked issues and the epic labels — each null for a project that
 * has no board, with the lines text mode writes for all three.
 *
 * A module of its own because `./doctor.ts` stood at 766 lines against
 * the 800-line cap (`context/source.md`) when the epic labels row was
 * added, so the readings it held moved here first. Each reading keeps
 * its own module and its own module note: this one only opens the
 * runner, reads them in order and joins their lines.
 *
 * ## The runner
 *
 * A repository that resolves to `pr.provider: gh` gets one {@link
 * GhRunner}, opened ONCE per run in the project root by {@link
 * boardRunner}. `./doctor.ts` hands that same runner to the cleanup row
 * and the references row, so every `gh` command of a run goes through
 * one seam. The provider is the one the preflight's automatic items
 * resolved, so `pr.provider: none` opens no runner, sends no `gh`
 * command and prints no board line.
 *
 * ## The board rows
 *
 * One row per part of the GitHub board `rafa init --board` makes — the
 * labels, the spec issue template, the Roadmap issue and
 * `roadmap.issue` — each read through `readBoardStatus`
 * (`src/board/status.ts`) as present, missing or, for a reading that
 * failed, unknown. A run with any row that is not present ends those
 * lines with `rafa init --board` as the fix (`./doctor-render.ts`),
 * which is the one command that would change them.
 *
 * ## The blocked issues
 *
 * Every open issue labelled `spec:blocked` whose `Blocked by:` line is
 * missing or unreadable, named under `Blocked issues:`
 * (`./doctor-blocked.ts`, which holds the `gh` commands, the lines and
 * why a board-wide id is checked only against a board read whole). It
 * is the report half of a dependency the spec keeps as data and refuses
 * to guess at.
 *
 * ## The epic labels
 *
 * Every issue carrying two `epic:` labels and every `epic:` label no
 * `type:epic` issue carries, named under `Epic labels:`
 * (`./doctor-epics.ts`), read off one board listing and worded by
 * `src/board/epic-problems.ts`, the only reader of either fault.
 *
 * ## Order, and what none of them does
 *
 * They are read and printed in that order: board rows, blocked issues,
 * epic labels. None writes to the board, none throws for a `gh` command
 * that failed — each prints the failure as a line of its own — and none
 * changes the exit code. A run whose preflight halted prints them before
 * its refusal, since they were read by then and a person reading a halt
 * still wants the whole picture.
 */
import type { BlockedIssuesReport } from './doctor-blocked.js';
import type { DoctorEpicsReport } from './doctor-epics.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { BoardStatus } from '../board/status.js';
import type { PrProvider } from '../config-sections.js';

import { createGhRunner } from '../adapters/tracker/github.js';
import { readBoardStatus } from '../board/status.js';

import { readBlockedIssues, renderBlockedIssues } from './doctor-blocked.js';
import { readDoctorEpics, renderDoctorEpics } from './doctor-epics.js';
import { renderBoard } from './doctor-render.js';

/** How the board runner is opened; see the module note. */
export interface DoctorBoardSeams {
  /** Opens the runner every board reading goes through. `gh` spawned in the root when left out. */
  readonly openGh?: (root: string) => GhRunner;
}

/** The three readings of the GitHub board, each null for a project that has none. */
export interface DoctorBoardReadings {
  /** Every part of the board `rafa init --board` makes, as it was read. */
  readonly board: BoardStatus | null;
  /** Every open issue labelled `spec:blocked`, read. */
  readonly blocked: BlockedIssuesReport | null;
  /** Every issue carrying two `epic:` labels and every `epic:` label no epic carries. */
  readonly epics: DoctorEpicsReport | null;
}

/** No reading at all, for a project whose provider is not `gh`. */
const NO_BOARD: DoctorBoardReadings = Object.freeze({ board: null, blocked: null, epics: null });

/**
 * The runner every board reading goes through, opened once in `root`,
 * or null for a project whose provider is not `gh` and so has no board.
 */
export function boardRunner(provider: PrProvider, root: string, seams: DoctorBoardSeams): GhRunner | null {
  if (provider !== 'gh') return null;
  const openGh = seams.openGh ?? ((dir: string): GhRunner => createGhRunner({ cwd: dir }));
  return openGh(root);
}

/**
 * The board rows, the blocked issues and the epic labels, read over
 * `gh` in that order, or all three null when there is no runner. Writes
 * nothing; see the module note.
 */
export async function readDoctorBoard(gh: GhRunner | null, root: string): Promise<DoctorBoardReadings> {
  if (gh === null) return NO_BOARD;
  const board = await readBoardStatus({ gh, root });
  const blocked = await readBlockedIssues({ gh });
  const epics = await readDoctorEpics({ gh });
  return Object.freeze({ board, blocked, epics });
}

/** The lines text mode writes for the three readings, in the order they were read. */
export function renderDoctorBoard(readings: DoctorBoardReadings): readonly string[] {
  return [
    ...renderBoard(readings.board),
    ...renderBlockedIssues(readings.blocked),
    ...renderDoctorEpics(readings.epics),
  ];
}
