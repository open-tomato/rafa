/**
 * The boards row of `rafa doctor`: every board whose `Owner:` handle
 * resolves to nobody, every open issue titled "Roadmap" that lacks
 * `type:roadmap` while labelled boards exist, and every slot of this
 * checkout's position that points at a board or epic that no longer
 * stands, named under `Boards:` with what fixes each
 * (`.rafa/specs/rafa-245-boards-several-roadmaps-per.md`, "Tasks the plan
 * must carry").
 *
 * Each fault is found by the module that already reads it, and printed in
 * that module's words: this one never respells a fault.
 *
 * - An OWNER is the `Owner:` line `readBoardBody` (`src/board/board-body.ts`)
 *   reads off each open `type:roadmap` board, asked of GitHub through one
 *   `createOwnerResolver` (`src/board/owner-resolve.ts`), so a handle two
 *   boards name is asked once. `unresolved` is a fault; `unknown` is a
 *   line saying the owner could not be checked and why, since nobody said
 *   the handle is wrong and nobody said it is right.
 * - The UNLABELLED Roadmaps are `DefaultBoard.unlabelled`, found by
 *   `resolveDefaultBoard` (`src/board/boards.ts`) and worded by
 *   `unlabelledRoadmapMessage`: one sentence naming every such issue.
 * - The POSITION is checked by `resolvePlace` (`src/board/place.ts`), and
 *   each `lost` notice it raises is a fault, printed as its `message`: a
 *   board closed, unlabelled or not on the listing, an epic closed,
 *   untyped or not on the listing, each naming the slots it held and the
 *   fallback. `previous` is not checked, as `resolvePlace` does not check
 *   it. A position file that reads unset is not a fault here: `rafa
 *   switch` and `rafa status` already say so where it matters.
 *
 * ## gh calls
 *
 * The board listing (`src/board/roadmap-board.ts`) is the one the epic
 * labels row reads (`./doctor-epics.ts`): `./doctor-board.ts` reads it
 * once per run and hands both rows the same answer, so this row adds no
 * listing. The open boards are the listing's own open `type:roadmap` rows
 * (`openBoards`, `./switch.ts`), never a second `gh issue list --label`.
 * Beyond that it spends:
 *
 * - one `gh api` per distinct owner handle;
 * - at most one title search, `gh issue list --search "Roadmap in:title"`,
 *   through `resolveDefaultBoard`, asked when labelled boards exist, or
 *   when a position place needs the default board to stand or fall back.
 *
 * A project with no open `type:roadmap` board and no position file
 * spends nothing beyond the shared listing and prints nothing, so it
 * reads the report it read before this row.
 *
 * ## What it prints
 *
 * Nothing when there is no fault and no reading failed: a clean project
 * gets no `Boards:` heading at all. Otherwise the heading, then one line
 * per fault in the order owners (lowest board first), unlabelled
 * Roadmaps, position, then one line per reading that failed — an owner
 * lookup, the title search or the position — each naming why.
 *
 * A listing that failed is {@link DoctorBoardsReport.listing} and prints
 * NOTHING here: the epic labels row reads the same answer and always
 * prints that failure under `Epic labels:`, so a line here would name
 * one failed command twice in one report. Json mode still carries it.
 *
 * ## Nothing here writes
 *
 * No label is added, no body is edited and the position file is not
 * rewritten: only `rafa switch` writes it. The row never throws and never
 * changes the exit code. Every case in `./doctor-boards.test.ts` drives a
 * recorded fake runner and a planted position file under `tmpdir`, so
 * none of them reaches GitHub or spawns `gh`.
 */
import type { GhRunner } from '../adapters/tracker/github.js';
import type { DefaultBoard } from '../board/boards.js';
import type { OwnerResolution } from '../board/owner-resolve.js';
import type { PlaceNotice } from '../board/place.js';
import type { BoardIssue, BoardListing } from '../board/roadmap-board.js';

import { readBoardBody } from '../board/board-body.js';
import { resolveDefaultBoard, unlabelledRoadmapMessage } from '../board/boards.js';
import { createOwnerResolver } from '../board/owner-resolve.js';
import { resolvePlace } from '../board/place.js';
import { createGhRoadmapSearch } from '../board/roadmap.js';
import { messageOf } from '../config-sections.js';
import { readPositionFile } from '../project/position.js';

import { openBoards } from './switch.js';

/** The heading the board lines sit under, as `Epic labels:` heads its own. */
export const BOARDS_HEADING = 'Boards:';

/** One fault the row names; see the module note. */
export type DoctorBoardsFault =
  | {
    readonly kind: 'unresolved-owner';
    readonly board: number;
    readonly handle: string;
    readonly message: string;
  }
  | {
    readonly kind: 'unlabelled-roadmap';
    readonly issues: readonly number[];
    readonly message: string;
  }
  | {
    readonly kind: 'lost-position';
    readonly notice: Extract<PlaceNotice, { kind: 'lost' }>;
    readonly message: string;
  };

/** What one reading of the boards came to. */
export interface DoctorBoardsReport {
  /** How many open `type:roadmap` boards the listing holds. */
  readonly boards: number;
  /** Every fault, in the order the module note gives. */
  readonly faults: readonly DoctorBoardsFault[];
  /** One sentence per reading past the listing that failed, naming why; empty when every one answered. */
  readonly problems: readonly string[];
  /** Why the board listing could not be read, nothing else then read; null when it answered. */
  readonly listing: string | null;
}

/** What {@link readDoctorBoards} reads through. */
export interface DoctorBoardsOptions {
  /** Runs the owner lookups and the title search. */
  readonly gh: GhRunner;
  /** The project root whose `.rafa/position.json` is read. */
  readonly root: string;
  /** `roadmap.issue` as the layers resolved it, or null when none named one. */
  readonly configured: number | null;
  /** The board listing, shared with the epic labels row; see the module note. */
  readonly listing: BoardListing;
}

/** No board, no position, nothing read beyond the listing. */
const EMPTY: DoctorBoardsReport = Object.freeze({ boards: 0, faults: Object.freeze([]), problems: Object.freeze([]), listing: null });

/** `thunk`, asked at most once, its rejection kept as its answer. */
function once<T>(thunk: () => Promise<T>): () => Promise<T> {
  let answer: Promise<T> | null = null;
  return () => {
    answer ??= thunk();
    return answer;
  };
}

/** The sentence an unresolved owner prints. */
export function unresolvedOwnerMessage(board: number, handle: string): string {
  return `board #${String(board)} names owner ${handle}, which resolves to no account or team this token can see,`
    + ' so CODEOWNERS matches nobody for it; correct its Owner: line or create that account or team';
}

/** The owner of every open board naming one, asked once per handle. */
async function readOwners(gh: GhRunner, boards: readonly BoardIssue[]): Promise<readonly {
  readonly board: number;
  readonly owner: OwnerResolution;
}[]> {
  const resolve = createOwnerResolver({ gh });
  const named = boards.flatMap((board) => {
    const handle = readBoardBody(board.body).owner;
    return handle === null
      ? []
      : [{ board: board.number, handle }];
  });
  return Promise.all(named.map(async ({ board, handle }) => ({ board, owner: await resolve(handle) })));
}

/** The owner faults and the owner lookups that could not be asked. */
async function ownerReadings(gh: GhRunner, boards: readonly BoardIssue[]): Promise<{
  readonly faults: readonly DoctorBoardsFault[];
  readonly problems: readonly string[];
}> {
  const owners = await readOwners(gh, boards);
  const faults: DoctorBoardsFault[] = [];
  const problems: string[] = [];
  for (const { board, owner } of owners) {
    if (owner.state === 'unresolved') {
      faults.push({ kind: 'unresolved-owner', board, handle: owner.handle, message: unresolvedOwnerMessage(board, owner.handle) });
    }
    if (owner.state === 'unknown') problems.push(`owner ${owner.handle} of board #${String(board)} could not be checked: ${owner.reason}`);
  }
  return { faults, problems };
}

/** The unlabelled Roadmaps fault, none, or the sentence saying the search failed. */
async function unlabelledReading(defaultBoard: () => Promise<DefaultBoard>): Promise<DoctorBoardsFault | string | null> {
  try {
    const { unlabelled } = await defaultBoard();
    return unlabelled.length === 0
      ? null
      : { kind: 'unlabelled-roadmap', issues: unlabelled, message: unlabelledRoadmapMessage(unlabelled) };
  } catch (error) {
    return `the issues titled Roadmap could not be read: ${messageOf(error)}`;
  }
}

/** Every lost slot of the position, or the sentence saying it could not be checked. */
async function positionReading(
  root: string,
  listing: readonly BoardIssue[],
  defaultBoard: () => Promise<DefaultBoard>,
): Promise<readonly DoctorBoardsFault[] | string> {
  try {
    const resolved = await resolvePlace({ root, listing, defaultBoard: async () => (await defaultBoard()).number });
    return resolved.notices.flatMap((notice): DoctorBoardsFault[] => notice.kind === 'lost'
      ? [{ kind: 'lost-position', notice, message: notice.message }]
      : []);
  } catch (error) {
    return `the position could not be checked: ${messageOf(error)}`;
  }
}

/**
 * Every unresolved owner, unlabelled Roadmap and lost position slot, read
 * as the module note says. Writes nothing and never throws: a failed
 * listing comes back as {@link DoctorBoardsReport.listing}, any other
 * reading that failed as one of {@link DoctorBoardsReport.problems}.
 */
export async function readDoctorBoards(options: DoctorBoardsOptions): Promise<DoctorBoardsReport> {
  const { gh, root, configured } = options;

  let listing: readonly BoardIssue[];
  try {
    listing = await options.listing();
  } catch (error) {
    return Object.freeze({ ...EMPTY, listing: messageOf(error) });
  }

  const boards = openBoards(listing);
  const hasPosition = readPositionFile(root).set;
  if (boards.length === 0 && !hasPosition) return EMPTY;

  const defaultBoard = once(() => resolveDefaultBoard({
    configured,
    listBoards: () => Promise.resolve(boards),
    search: createGhRoadmapSearch({ gh }),
  }));
  const owners = await ownerReadings(gh, boards);
  const unlabelled = boards.length === 0
    ? null
    : await unlabelledReading(defaultBoard);
  const position = hasPosition
    ? await positionReading(root, listing, defaultBoard)
    : [];

  const faults = [
    ...owners.faults,
    ...typeof unlabelled === 'object' && unlabelled !== null
      ? [unlabelled]
      : [],
    ...typeof position === 'string'
      ? []
      : position,
  ];
  const problems = [
    ...owners.problems,
    ...typeof unlabelled === 'string'
      ? [unlabelled]
      : [],
    ...typeof position === 'string'
      ? [position]
      : [],
  ];
  return Object.freeze({ boards: boards.length, faults: Object.freeze(faults), problems: Object.freeze(problems), listing: null });
}

/**
 * The lines text mode writes for the boards: the heading, one sentence
 * per fault, then one per reading that failed. A report with neither
 * prints nothing, nor does one whose listing failed (see the module
 * note); null, for a project with no GitHub board, prints nothing either.
 */
export function renderDoctorBoards(report: DoctorBoardsReport | null): readonly string[] {
  if (report === null) return [];
  if (report.faults.length === 0 && report.problems.length === 0) return [];
  return [
    BOARDS_HEADING,
    ...report.faults.map((fault) => `  ${fault.message}`),
    ...report.problems.map((problem) => `  ${problem}`),
  ];
}
