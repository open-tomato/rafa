/**
 * The boards of a repository, listed, and the DEFAULT board among them:
 * the one every reader that knows no position starts from.
 *
 * A board is an open issue labelled {@link ROADMAP_LABEL}
 * (`.rafa/specs/rafa-245-boards-several-roadmaps-per.md`). They are found
 * by that label in ONE `gh` command, asking for the fields the board
 * listing reads and parsed by its own rule, so a board and an issue on the
 * board are read alike:
 *
 * ```
 * gh issue list --label type:roadmap --state open --limit <n> --json number,title,body,state,stateReason,labels
 * ```
 *
 * `--limit` is {@link BOARD_LISTING_LIMIT} because `gh issue list` stops
 * at 30 by default and answers the newest first: a repository with more
 * boards than that would lose its LOWEST numbers, the very ones the
 * default is picked from. A narrower `--json` list is refused by
 * {@link parseBoardListing}, naming the first field a row lacks.
 *
 * Nothing here spawns: `gh` arrives through the {@link GhRunner} seam
 * declared in `src/adapters/tracker/github.ts`, and every case in
 * `./boards.test.ts` plants the answers it reads.
 *
 * ## Which board is the default
 *
 * {@link resolveDefaultBoard} ranks three answers:
 *
 *  1. `roadmap.issue`, when a layer named one. It is answered as named and
 *     not checked against the listing; the setting is the project's word.
 *  2. The LOWEST-numbered open labelled board, when any issue carries the
 *     label. Several boards are normal once one does, so no count refuses.
 *  3. The title rule, {@link resolveRoadmapIssue} itself, used only while
 *     nothing carries the label. A repository that never labelled a board
 *     is therefore answered exactly as before, its refusals included: no
 *     issue titled "Roadmap", or several, still exit
 *     `ROADMAP_REFUSAL_EXIT` with the same sentence.
 *
 * ## An unlabelled "Roadmap" beside labelled boards
 *
 * Once a labelled board exists the title no longer picks anything, so an
 * open issue titled "Roadmap" that lacks the label is a board nobody
 * reads. The answer names every such issue in
 * {@link DefaultBoard.unlabelled}, whichever rank chose the default, for
 * a report to say so ({@link unlabelledRoadmapMessage}). Finding them is
 * a title search, `gh issue list --search "Roadmap in:title"`, spent
 * ONLY when labelled boards exist: with none, the title rule either spends
 * that search itself or, under `roadmap.issue`, nothing is searched, as
 * before. While nothing is labelled the list is empty by definition.
 *
 * ## gh calls per resolution
 *
 * The listing is read exactly once and handed back in
 * {@link DefaultBoard.boards}, so a command that needs the boards as well
 * as the default reads them once. The title search is read at most once.
 * A failed listing or search rejects, naming its command; a default board
 * found beside a search that failed would hide the unlabelled issue the
 * search was spent to find.
 */
import type { BoardIssue } from './roadmap-board.js';
import type { RoadmapSearch } from './roadmap.js';
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { BOARD_LIST_FIELDS, BOARD_LISTING_LIMIT, parseBoardListing } from './roadmap-board.js';
import { isRoadmapTitle, resolveRoadmapIssue, ROADMAP_TITLE } from './roadmap.js';
import { ROADMAP_LABEL } from './setup.js';

/** What a failed listing's refusal opens with; the board listing's own prefix. */
const PREFIX = 'board listing';

/** Every open labelled board; the seam {@link resolveDefaultBoard} reads through. */
export type BoardLister = () => Promise<readonly BoardIssue[]>;

/** The arguments the board lister hands `gh`. */
export const BOARDS_LIST_ARGS: readonly string[] = Object.freeze([
  'issue', 'list',
  '--label', ROADMAP_LABEL,
  '--state', 'open',
  '--limit', String(BOARD_LISTING_LIMIT),
  '--json', BOARD_LIST_FIELDS,
]);

/** The command a refusal of the board lister names. */
export const BOARDS_LIST_COMMAND = `gh ${BOARDS_LIST_ARGS.join(' ')}`;

/** What a failed command wrote, for a message. Never empty. */
function detailOf(result: GhResult): string {
  const written = result.stderr.trim() || result.stdout.trim();
  return written === ''
    ? `${BOARDS_LIST_COMMAND} failed and wrote nothing`
    : `${BOARDS_LIST_COMMAND} failed: ${written}`;
}

/**
 * The lister over `options.gh`: one {@link BOARDS_LIST_COMMAND} per
 * call, answered as checked issues in the order `gh` wrote them. Rejects,
 * naming the command, when `gh` failed or answered anything
 * {@link parseBoardListing} refuses.
 */
export function createGhBoardLister(options: { readonly gh: GhRunner }): BoardLister {
  const { gh } = options;
  return async () => {
    const result = await gh(BOARDS_LIST_ARGS);
    if (!result.ok) throw new Error(`${PREFIX}: ${detailOf(result)}`);
    return parseBoardListing(result.stdout, BOARDS_LIST_COMMAND);
  };
}

/** Which rank of the module note chose the default board. */
export type DefaultBoardSource = 'configured' | 'label' | 'title';

/** The default board, with what was read to find it. */
export interface DefaultBoard {
  /** The default board's issue number. */
  readonly number: number;
  /** Which rank chose it. */
  readonly source: DefaultBoardSource;
  /** Every open labelled board the one listing read, lowest number first. */
  readonly boards: readonly BoardIssue[];
  /** Every open issue titled "Roadmap" that lacks the label, lowest first; empty while no board is labelled. */
  readonly unlabelled: readonly number[];
}

/** What {@link resolveDefaultBoard} reads. */
export interface DefaultBoardOptions {
  /** `roadmap.issue` as the layers resolved it, or null when none named one. */
  readonly configured: number | null;
  /** The labelled boards, read once. */
  readonly listBoards: BoardLister;
  /** The title search, read at most once. */
  readonly search: RoadmapSearch;
}

/** The numbers of the issues titled "Roadmap" the search found that no labelled board holds, lowest first. */
async function unlabelledRoadmaps(search: RoadmapSearch, boards: readonly BoardIssue[]): Promise<readonly number[]> {
  const labelled = new Set(boards.map((board) => board.number));
  const numbers = (await search())
    .filter((issue) => isRoadmapTitle(issue.title) && !labelled.has(issue.number))
    .map((issue) => issue.number);
  return Object.freeze([...new Set(numbers)].sort((a, b) => a - b));
}

/**
 * The default board, ranked as the module note says: `configured`, else
 * the lowest-numbered labelled board, else the title rule. Throws
 * `CommandExit(`ROADMAP_REFUSAL_EXIT`, ...)`, as
 * {@link resolveRoadmapIssue} does, when nothing is configured or
 * labelled and the title search answers no issue titled "Roadmap" or
 * several. Rejects when the listing or the search fails.
 */
export async function resolveDefaultBoard(options: DefaultBoardOptions): Promise<DefaultBoard> {
  const { configured, listBoards, search } = options;
  const boards = Object.freeze([...await listBoards()].sort((a, b) => a.number - b.number));
  const [lowest] = boards;

  if (lowest === undefined) {
    const number = await resolveRoadmapIssue({ configured, search });
    const source: DefaultBoardSource = configured === null
      ? 'title'
      : 'configured';
    return Object.freeze({ number, source, boards, unlabelled: Object.freeze([]) });
  }

  const unlabelled = await unlabelledRoadmaps(search, boards);
  return configured === null
    ? Object.freeze({ number: lowest.number, source: 'label', boards, unlabelled })
    : Object.freeze({ number: configured, source: 'configured', boards, unlabelled });
}

/**
 * The sentence a report prints for the issues titled "Roadmap" that
 * {@link DefaultBoard.unlabelled} names. Throws a `RangeError` for an
 * empty list: there is nothing to report.
 */
export function unlabelledRoadmapMessage(numbers: readonly number[]): string {
  if (numbers.length === 0) throw new RangeError('unlabelledRoadmapMessage: no issue to name');
  const named = numbers.map((number) => `#${String(number)}`).join(', ');
  const which = numbers.length === 1
    ? `open issue ${named} is titled ${ROADMAP_TITLE} but lacks`
    : `open issues ${named} are titled ${ROADMAP_TITLE} but lack`;
  return `${which} the ${ROADMAP_LABEL} label, so no reader takes it as a board while labelled boards exist;`
    + ' add the label to make it one, or retitle or close it';
}
