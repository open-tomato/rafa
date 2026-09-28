/**
 * The roadmap tick `rafa pr merge` writes once the provider has merged:
 * which issues the merged pull request closes, which boards list them,
 * and the one tick per board that writes their lines.
 *
 * The rule and the writes are `src/board/roadmap-tick.ts`'s; this
 * module is the half that decides whether there is anything to tick at
 * all, and on which boards, and turns everything that can go wrong on
 * the way into a warning.
 *
 * ## Which boards are ticked
 *
 * A board is an open issue labelled `type:roadmap`, and a project may
 * hold several (`.rafa/specs/rafa-245-boards-several-roadmaps-per.md`).
 * An issue closed on one board's checklist is closed on every other
 * board that lists it too, so the tick goes to EVERY open labelled board
 * whose checklist, as `parseRoadmapBody` reads the body the listing
 * answered, lists one of the closed issues — ticked already or not, so
 * a line somebody ticked by hand is still reported as ticked already.
 * The boards are found by ONE `gh issue list --label type:roadmap`
 * (`createGhBoardLister`, `src/board/boards.ts`), and a board whose
 * checklist lists none of them is neither read nor written.
 *
 * `roadmap.issue` is the project's word for its default board and is not
 * checked against the listing (`resolveDefaultBoard`'s own rule), so a
 * configured board the listing does not hold is ticked too, read and
 * all, since there is no listed body to filter it by. The configured
 * board comes first, then the rest lowest number first: the first
 * result is the default board's whenever the default board was ticked.
 *
 * While NO issue carries the label the tick falls back to the default
 * board exactly as before: `resolveDefaultBoard` over the listing already
 * read (so it is not listed twice), `roadmap.issue` first, else the one
 * open issue titled "Roadmap" by a `gh issue list --search`, and that
 * one board is ticked whether or not its checklist lists the issue, so a
 * project that never labelled a board sees the same calls and the same
 * line. Labelled boards none of which lists a closed issue answer an
 * empty list, and `pr merge` says so with {@link noBoardListsLine}.
 *
 * ## Nothing is spent on the ordinary merge
 *
 * A pull request whose body names no issue with a closing keyword ticks
 * nothing, and {@link tickRoadmapAfterMerge} answers null for it BEFORE
 * any board is listed. That matters for cost and for noise: listing the
 * boards, and failing a labelled board, searching for the title, after
 * every merge would spend calls on every repository that keeps no
 * roadmap and warn each of them that it found none.
 *
 * ## Why every failure is a warning
 *
 * The merge has already happened by the time this runs. A listing that
 * fails, a roadmap that cannot be resolved, a board that would not take
 * the edit, a `roadmap.issue` pointing at an issue that is gone — none
 * of them un-merge anything, and failing the command over one would
 * tell an operator their merge broke when what broke is a checkbox. So
 * the refusals `resolveDefaultBoard` raises (`CommandExit`, exit 2 for
 * no roadmap and for several) are caught here with everything else and
 * reported through `warn`, and `pr merge` keeps its exit code. A board
 * whose tick fails does not stop the ticks of the boards after it:
 * `tickRoadmapIssue` answers a failure rather than throwing it.
 *
 * The warning always names the tick, so a line in a merge's output is
 * never read as something the merge itself did.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { BoardIssue } from '../../board/roadmap-board.js';
import type { RoadmapTickResult } from '../../board/roadmap-tick.js';

import { createGhBoardLister, resolveDefaultBoard } from '../../board/boards.js';
import { createGhRoadmapBody, tickRoadmapIssue } from '../../board/roadmap-tick.js';
import { closedIssuesIn, createGhRoadmapSearch, parseRoadmapBody } from '../../board/roadmap.js';
import { ROADMAP_LABEL } from '../../board/setup.js';
import { messageOf } from '../../config-sections.js';

/** What {@link tickRoadmapAfterMerge} is asked. */
export interface MergeTickOptions {
  /** The merged pull request's body, which the closing keywords are read out of. */
  readonly body: string;
  /** `roadmap.issue` as config resolved it, or null for the default board `resolveDefaultBoard` ranks. */
  readonly configured: number | null;
  /** Runs every `gh` command the tick sends. */
  readonly gh: GhRunner;
  /** Where a tick that could not be written says so. */
  readonly warn: (message: string) => void;
}

/** What a tick that could not be attempted at all says. */
export function tickProblemLine(problem: string): string {
  return `the roadmap was not ticked: ${problem}`;
}

/** What `pr merge` prints when labelled boards exist and none lists a closed issue. */
export function noBoardListsLine(issues: readonly number[]): string {
  const named = issues.map((issue) => `#${String(issue)}`).join(', ');
  return `no open ${ROADMAP_LABEL} board lists ${named}, so nothing was ticked.`;
}

/** True when `board` is open, labelled, and its checklist lists one of `issues`. */
function listsAny(board: BoardIssue, issues: readonly number[]): boolean {
  if (board.state !== 'OPEN' || !board.labels.includes(ROADMAP_LABEL)) return false;
  return parseRoadmapBody(board.body).some((line) => issues.includes(line.issue));
}

/** The boards to tick while labelled boards exist, in the order the module note gives. */
function boardsListing(
  boards: readonly BoardIssue[],
  issues: readonly number[],
  configured: number | null,
): readonly number[] {
  const listed = boards
    .filter((board) => listsAny(board, issues))
    .map((board) => board.number)
    .sort((a, b) => a - b);
  if (configured === null) return listed;
  const unlisted = !boards.some((board) => board.number === configured);
  return unlisted || listed.includes(configured)
    ? [configured, ...listed.filter((number) => number !== configured)]
    : listed;
}

/** Every board the tick goes to; see the module note. Rejects when the listing or the fallback fails. */
async function boardsToTick(
  gh: GhRunner,
  issues: readonly number[],
  configured: number | null,
): Promise<readonly number[]> {
  const boards = await createGhBoardLister({ gh })();
  if (boards.length > 0) return boardsListing(boards, issues, configured);

  const { number } = await resolveDefaultBoard({
    configured,
    listBoards: () => Promise.resolve(boards),
    search: createGhRoadmapSearch({ gh }),
  });
  return [number];
}

/**
 * Ticks the lines of every issue the merged pull request closes on every
 * board that lists one, one result per board in the module note's order,
 * or answers null when it closes none or the boards could not be found.
 * Never throws: see the module note.
 */
export async function tickRoadmapAfterMerge(
  options: MergeTickOptions,
): Promise<readonly RoadmapTickResult[] | null> {
  const { body, configured, gh, warn } = options;
  const issues = closedIssuesIn(body);
  if (issues.length === 0) return null;

  let roadmaps: readonly number[];
  try {
    roadmaps = await boardsToTick(gh, issues, configured);
  } catch (error) {
    warn(tickProblemLine(messageOf(error)));
    return null;
  }

  const board = createGhRoadmapBody({ gh });
  let results: readonly RoadmapTickResult[] = [];
  for (const roadmap of roadmaps) {
    results = [...results, await tickRoadmapIssue({ roadmap, issues, board })];
  }
  return Object.freeze(results);
}
