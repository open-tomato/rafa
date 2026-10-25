/**
 * Which board an epic sits on, read off ONE board listing: the open
 * boards, whether a board's checklist lists an epic, and the board an
 * epic moves with.
 *
 * These lived in `src/commands/switch.ts`, where `rafa switch <epic>`
 * first needed them; they moved here when `./blocker-epic.ts` needed
 * the same answer, so a board-layer reader does not import a command.
 * `rafa switch`, `rafa board list` and the boards row of `rafa doctor`
 * import them from here.
 *
 * Nothing here spawns `gh`: the listing is handed in, and the default
 * board is a thunk the caller owns, asked only when an answer needs it,
 * so its title search is spent only then. A thunk that rejects rejects
 * {@link boardOfEpic} with it.
 */
import type { BoardIssue } from './roadmap-board.js';

import { parseRoadmapBody } from './roadmap.js';
import { ROADMAP_LABEL } from './setup.js';

/** The one listing, keyed by number, and the default board asked at most once. */
export interface BoardView {
  readonly listing: readonly BoardIssue[];
  readonly rows: ReadonlyMap<number, BoardIssue>;
  readonly defaultBoard: () => Promise<number>;
}

/** The listing's open `type:roadmap` rows, lowest number first. */
export function openBoards(listing: readonly BoardIssue[]): readonly BoardIssue[] {
  return listing
    .filter((issue) => issue.state === 'OPEN' && issue.labels.includes(ROADMAP_LABEL))
    .sort((a, b) => a.number - b.number);
}

/** True when board `number` is open on the listing and its checklist lists `epic`, ticked or not. */
export function boardListsEpic(number: number, epic: number, view: Pick<BoardView, 'rows'>): boolean {
  const row = view.rows.get(number);
  if (row?.state !== 'OPEN') return false;
  return parseRoadmapBody(row.body).some((line) => line.issue === epic);
}

/**
 * The board epic `epic` moves with: board `current` when it lists the
 * epic, then the default board, then the lowest-numbered open board
 * listing it, else the default board, which may not list it.
 */
export async function boardOfEpic(epic: number, current: { readonly board: number }, view: BoardView): Promise<number> {
  if (boardListsEpic(current.board, epic, view)) return current.board;
  const fallback = await view.defaultBoard();
  if (boardListsEpic(fallback, epic, view)) return fallback;
  return openBoards(view.listing).find((row) => boardListsEpic(row.number, epic, view))?.number ?? fallback;
}
