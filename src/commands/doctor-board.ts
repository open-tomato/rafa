/**
 * The GitHub board readings of `rafa doctor` (`./doctor.ts`): the runner
 * they go through, and the readings made over it — the board rows, the
 * blocked issues and the epic labels (or the relationships, in `native`
 * mode) and the boards — each null for a project that has no board, with
 * the lines text mode writes for them.
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
 * ## The mode
 *
 * `board.relationships` (`mode`, `labels` when left out) picks which
 * rows read the board's relationships. In `labels` mode the blocked
 * issues and epic labels rows run, and the readings carry no
 * `relations` key at all, so a `labels` run reads, sends and prints
 * what it did before the mode existed. In `native` mode those two rows
 * do not run and read null, since the marks they check are the `labels`
 * mode's, and the relationships row (`./doctor-relations.ts`) runs in
 * their place over the same shared listing, asked for the native fields.
 *
 * ## The blocked issues
 *
 * `labels` mode only. Every open issue labelled `spec:blocked` whose `Blocked by:` line is
 * missing or unreadable, named under `Blocked issues:`
 * (`./doctor-blocked.ts` holds the lines, and
 * `../board/blocked-issues.ts` the `gh` commands and why a board-wide
 * id is checked only against a board read whole). It
 * is the report half of a dependency the spec keeps as data and refuses
 * to guess at.
 *
 * ## The epic labels
 *
 * `labels` mode only. Every issue carrying two `epic:` labels and every `epic:` label no
 * `type:epic` issue carries, named under `Epic labels:`
 * (`./doctor-epics.ts`), read off one board listing and worded by
 * `src/board/epic-problems.ts`, the only reader of either fault.
 *
 * ## The relationships
 *
 * `native` mode only. Every open issue whose `blockedBy` list and every
 * epic whose `subIssues` list `gh` answered short of GitHub's
 * `totalCount`, named under `Relationships:` (`./doctor-relations.ts`).
 *
 * ## The other mode's marks
 *
 * Only when a config layer sets `board.relationships` (`modeSet`): every
 * mark on the board of the mode the key does not name — `epic:` labels,
 * `spec:blocked` and its `Blocked by:` line in `native` mode, sub-issue
 * parents and blocked-by links in `labels` mode — named under
 * `Other mode's marks:` with `rafa init --board` as the fix
 * (`./doctor-marks.ts`). With the key set the shared listing is read in
 * the native fields in either mode, since they carry the `labels` ones
 * too and the `labels` mode's marks row needs `parent` and `blockedBy`;
 * with the key unset the row does not run, its `marks` key is left out
 * of the readings, and the listing is read in the fields it was before.
 *
 * ## The boards
 *
 * Every board whose `Owner:` handle resolves to nobody, every open issue
 * titled "Roadmap" without `type:roadmap` beside labelled boards, and
 * every position slot on a board or epic that no longer stands, named
 * under `Boards:` (`./doctor-boards.ts`). It reads the SAME board listing
 * the epic labels row reads, or the relationships row in `native` mode:
 * {@link readDoctorBoard} makes one listing in the configured mode,
 * asked at most once, and hands it to both, so a run sends
 * `gh issue list --state all ... --json number,title,body,state,stateReason,labels`
 * (with the native fields appended in `native` mode) once whichever rows
 * read it, and both see one answer, a failure included.
 *
 * ## Order, and what none of them does
 *
 * They are read and printed in that order: board rows, blocked issues,
 * epic labels (or the relationships in their place), the other mode's
 * marks, boards. None writes to the board, none throws for a `gh` command
 * that failed — each prints the failure as a line of its own — and none
 * changes the exit code. A run whose preflight halted prints them before
 * its refusal, since they were read by then and a person reading a halt
 * still wants the whole picture.
 */
import type { DoctorBoardsReport } from './doctor-boards.js';
import type { DoctorEpicsReport } from './doctor-epics.js';
import type { DoctorMarksReport } from './doctor-marks.js';
import type { DoctorRelationsReport } from './doctor-relations.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { BlockedIssuesReport } from '../board/blocked-issues.js';
import type { BoardStatus } from '../board/status.js';
import type { BoardRelationshipMode, PrProvider } from '../config-sections.js';

import { createGhRunner } from '../adapters/tracker/github.js';
import { readBlockedIssues } from '../board/blocked-issues.js';
import { createGhBoardListing } from '../board/roadmap-board.js';
import { readBoardStatus } from '../board/status.js';

import { renderBlockedIssues } from './doctor-blocked.js';
import { readDoctorBoards, renderDoctorBoards } from './doctor-boards.js';
import { readDoctorEpics, renderDoctorEpics } from './doctor-epics.js';
import { readDoctorMarks, renderDoctorMarks } from './doctor-marks.js';
import { readDoctorRelations, renderDoctorRelations } from './doctor-relations.js';
import { renderBoard } from './doctor-render.js';

/** How the board runner is opened; see the module note. */
export interface DoctorBoardSeams {
  /** Opens the runner every board reading goes through. `gh` spawned in the root when left out. */
  readonly openGh?: (root: string) => GhRunner;
}

/** The readings of the GitHub board, each null for a project that has none. */
export interface DoctorBoardReadings {
  /** Every part of the board `rafa init --board` makes, as it was read. */
  readonly board: BoardStatus | null;
  /** Every open issue labelled `spec:blocked`, read; null in `native` mode too. */
  readonly blocked: BlockedIssuesReport | null;
  /** Every issue carrying two `epic:` labels and every `epic:` label no epic carries; null in `native` mode too. */
  readonly epics: DoctorEpicsReport | null;
  /** Every truncated relationship list, in `native` mode only; the key is left out otherwise. */
  readonly relations?: DoctorRelationsReport;
  /** Every mark of the mode `board.relationships` does not name, when a config layer sets it; the key is left out otherwise. */
  readonly marks?: DoctorMarksReport;
  /** Every unresolved board owner, unlabelled Roadmap and lost position slot. */
  readonly boards: DoctorBoardsReport | null;
}

/** No reading at all, for a project whose provider is not `gh`. */
const NO_BOARD: DoctorBoardReadings = Object.freeze({ board: null, blocked: null, epics: null, boards: null });

/**
 * The runner every board reading goes through, opened once in `root`,
 * or null for a project whose provider is not `gh` and so has no board.
 */
export function boardRunner(provider: PrProvider, root: string, seams: DoctorBoardSeams): GhRunner | null {
  if (provider !== 'gh') return null;
  const openGh = seams.openGh ?? ((dir: string): GhRunner => createGhRunner({ cwd: dir }));
  return openGh(root);
}

/** The `marks` key of the readings: the other mode's marks when the key is set, left out otherwise. */
async function marksOf(modeSet: boolean, options: Parameters<typeof readDoctorMarks>[0]): Promise<{ readonly marks?: DoctorMarksReport }> {
  return modeSet
    ? { marks: await readDoctorMarks(options) }
    : {};
}

/**
 * The board rows, the blocked issues and the epic labels in `labels`
 * mode or the relationships in `native` mode, and the boards, read over
 * `gh` in that order, or all four null when there is no runner.
 * `configured` is `roadmap.issue`, or null when no layer names one;
 * `mode` is `board.relationships`, and `modeSet` true when a config
 * layer sets it, which adds the other mode's marks. The board listing is
 * read once, in `mode`'s fields or the native ones when `modeSet`, and
 * shared; writes nothing. See the module note.
 */
export async function readDoctorBoard(
  gh: GhRunner | null,
  root: string,
  configured: number | null,
  mode: BoardRelationshipMode = 'labels',
  modeSet = false,
): Promise<DoctorBoardReadings> {
  if (gh === null) return NO_BOARD;
  const read = createGhBoardListing({ gh, mode: modeSet
    ? 'native'
    : mode });
  let answer: ReturnType<typeof read> | null = null;
  const listing = (): ReturnType<typeof read> => {
    answer ??= read();
    return answer;
  };
  const board = await readBoardStatus({ gh, root });
  if (mode === 'native') {
    const relations = await readDoctorRelations({ gh, listing });
    const marks = await marksOf(modeSet, { gh, listing, mode });
    const boards = await readDoctorBoards({ gh, root, configured, listing });
    return Object.freeze({ board, blocked: null, epics: null, relations, ...marks, boards });
  }
  const blocked = await readBlockedIssues({ gh });
  const epics = await readDoctorEpics({ gh, listing });
  const marks = await marksOf(modeSet, { gh, listing, mode });
  const boards = await readDoctorBoards({ gh, root, configured, listing });
  return Object.freeze({ board, blocked, epics, ...marks, boards });
}

/** The lines text mode writes for the readings, in the order they were read. */
export function renderDoctorBoard(readings: DoctorBoardReadings): readonly string[] {
  return [
    ...renderBoard(readings.board),
    ...renderBlockedIssues(readings.blocked),
    ...renderDoctorEpics(readings.epics),
    ...renderDoctorRelations(readings.relations ?? null),
    ...renderDoctorMarks(readings.marks ?? null),
    ...renderDoctorBoards(readings.boards),
  ];
}

/**
 * The keys `rafa doctor`'s json result carries for `board.relationships`:
 * `relations` in `native` mode and `marks` when a config layer sets the
 * key, each left out otherwise.
 */
export function relationsResultOf(readings: DoctorBoardReadings): {
  readonly relations?: DoctorRelationsReport;
  readonly marks?: DoctorMarksReport;
} {
  return {
    ...readings.relations === undefined
      ? {}
      : { relations: readings.relations },
    ...readings.marks === undefined
      ? {}
      : { marks: readings.marks },
  };
}
