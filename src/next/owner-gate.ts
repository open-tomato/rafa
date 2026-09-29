/**
 * The owner gate as `rafa next --roadmap` asks it: the
 * {@link NextRoadmapSources.ownerApproval} reading `openNextSources`
 * (`./sources.ts`) hands the table, composed over the project's `gh`
 * runner, its pull request provider and its root. The reading itself,
 * its five answers and every `gh` argument it sends are
 * `readOwnerApproval`'s (`src/pr/owner-approval.ts`); this module only
 * gathers what that function is handed.
 *
 * ## What one reading gathers
 *
 * - **Home.** The position's `home` board (`.rafa/position.json`), which
 *   a hop keeps, since it moves with `switch --no-rehome`. With no
 *   position file, or one that does not read, home is the default board
 *   `resolveDefaultBoard` ranks, as a first `rafa switch` resolves it.
 * - **The boards.** Every open `type:roadmap` board on the board listing
 *   (`openBoards`), and home besides when the listing holds it
 *   unlabelled, as a project whose one board is the issue titled
 *   `Roadmap` has it. Each is read for its `Owner:` and `Owns:` lines
 *   (`ownedBoard`).
 * - **CODEOWNERS**, read afresh off the root (`readCodeowners`).
 *
 * The owner resolver is made once per composition, which is once per
 * `rafa next` line, as `createOwnerResolver` asks. Everything else is
 * read afresh on each call: the gate is asked at most once per turn, and
 * a turn never takes what an earlier one read.
 *
 * ## A reading that fails
 *
 * Any of the three that throws — the listing, the default board, a
 * CODEOWNERS file that is there and cannot be read — makes the returned
 * promise reject. The row that asks (`readPrOwnerReview`,
 * `./hop-rows.ts`) reads a rejection as `unknown`, so a failed reading
 * holds the merge back and never lets it through.
 */
import type { NextRoadmapSources } from './readings.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { OwnedBoard } from '../board/board-owns.js';
import type { BoardIssue, BoardListing } from '../board/roadmap-board.js';
import type { OwnerApproval } from '../pr/owner-approval.js';
import type { PullRequests } from '../pr/types.js';

import { ownedBoard } from '../board/board-owns.js';
import { createGhBoardLister, resolveDefaultBoard } from '../board/boards.js';
import { readCodeowners } from '../board/codeowners.js';
import { openBoards } from '../board/epic-board.js';
import { createOwnerResolver } from '../board/owner-resolve.js';
import { createGhBoardListing } from '../board/roadmap-board.js';
import { createGhRoadmapSearch } from '../board/roadmap.js';
import { createGhTeamMembership, readOwnerApproval } from '../pr/owner-approval.js';
import { readPositionFile } from '../project/position.js';

/** What {@link nextOwnerGate} reads through. */
export interface NextOwnerGateOptions {
  /** Runs every `gh` command the gate sends. */
  readonly gh: GhRunner;
  /** The project root whose position file names home and whose CODEOWNERS file is read. */
  readonly root: string;
  /** The provider the changed files and the reviews are read from. */
  readonly pulls: Pick<PullRequests, 'changedFiles' | 'reviews'>;
  /** `roadmap.issue` as the config resolved it, or null; ranks the default board. */
  readonly configured: number | null;
  /** The board listing; `createGhBoardListing` over `gh` when left out. */
  readonly listing?: BoardListing;
}

/** The home board: the position's, else the default board; see the module note. */
async function homeBoard(options: NextOwnerGateOptions): Promise<number> {
  const reading = readPositionFile(options.root);
  if (reading.set) return reading.position.home.board;

  const { gh, configured } = options;
  const board = await resolveDefaultBoard({
    configured,
    listBoards: createGhBoardLister({ gh }),
    search: createGhRoadmapSearch({ gh }),
  });
  return board.number;
}

/** The boards the gate weighs: every open labelled board, and home when the listing holds it unlabelled. */
export function gateBoards(listing: readonly BoardIssue[], home: number): readonly OwnedBoard[] {
  const labelled = openBoards(listing);
  const unlabelledHome = labelled.some((board) => board.number === home)
    ? undefined
    : listing.find((issue) => issue.number === home && issue.state === 'OPEN');
  const boards = unlabelledHome === undefined
    ? labelled
    : [...labelled, unlabelledHome].sort((a, b) => a.number - b.number);
  return Object.freeze(boards.map(ownedBoard));
}

/**
 * The owner gate `rafa next --roadmap` asks, over `options`; see the
 * module note. A reading that fails rejects, which the asking row reads
 * as `unknown`.
 */
export function nextOwnerGate(options: NextOwnerGateOptions): NextRoadmapSources['ownerApproval'] {
  const { gh, root, pulls } = options;
  const listing = options.listing ?? createGhBoardListing({ gh });
  const resolveOwner = createOwnerResolver({ gh });
  const membership = createGhTeamMembership({ gh });

  return async (pullRequest: number): Promise<OwnerApproval> => {
    const home = await homeBoard(options);
    const boards = gateBoards(await listing(), home);
    return readOwnerApproval(
      { pullRequest, home, boards, codeowners: readCodeowners(root) },
      { pullRequests: pulls, resolveOwner, membership },
    );
  };
}
