/**
 * `rafa board list`: every open board, one line each, with its owner and
 * whether that owner resolves, its epic count, and which board this
 * checkout is on and which is home
 * (`.rafa/specs/rafa-245-boards-several-roadmaps-per.md`).
 *
 * ## One board listing
 *
 * The command reads the board listing once (`createGhBoardListing`,
 * `src/board/roadmap-board.ts`: every issue, open and closed, through
 * `BOARD_LIST_FIELDS` and `parseBoardListing`), and every column is read
 * off that one answer. The default board is ranked over the listing's
 * open `type:roadmap` rows by `defaultBoardOnce` (`../switch.ts`), never
 * a second `gh issue list --label`, and asked at most once.
 *
 * ## Which boards
 *
 * Every open issue on the listing labelled `type:roadmap`, lowest number
 * first; and the default board when it is an open issue on the listing
 * that lacks the label, an issue titled "Roadmap" while nothing is
 * labelled or the `roadmap.issue` a project names, since `rafa switch`
 * and the current place take it as a board too. A project that never
 * labelled a board therefore lists its one Roadmap.
 *
 * ## The columns
 *
 * `#<n> <title> · <owner> · <count> epic(s)`, then ` · current` and
 * ` · home` on the boards they hold:
 *
 * - The OWNER is the `Owner:` line `readBoardBody` (`src/board/board-body.ts`)
 *   reads, asked of GitHub through one `createOwnerResolver`
 *   (`src/board/owner-resolve.ts`), so a handle two boards name is asked
 *   once. A resolved handle is printed bare; one GitHub answered 404 for
 *   is followed by `(unresolved)`, and one that could not be asked by
 *   `(unknown)`, with a warning per such board naming why. A board with
 *   no `Owner:` line, or a malformed one, reads `no owner`.
 * - The EPIC COUNT is the distinct issues its checklist names that the
 *   listing types `epic`, ticked or not, open or closed; a spec line is
 *   no epic.
 * - CURRENT and HOME are the places `resolvePlace` (`src/board/place.ts`)
 *   answers, so with no position file both are the default board. Every
 *   notice it raises but the one saying there is no position file yet is
 *   a warning, as `rafa switch` prints them.
 *
 * In json mode the terminal result's `data` is a {@link BoardListResult}.
 *
 * ## Exit codes
 *
 * {@link BOARD_LIST_REFUSAL_EXIT} (2) for a board listing or a default
 * board that cannot be read, which includes a project with no board at
 * all; 1 for a stray word and a config that cannot be used. An owner that
 * does not resolve is a column, not a failure: the list exits 0.
 *
 * It writes nothing and starts no session, so it declares no `spends`.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { OwnerResolution } from '../../board/owner-resolve.js';
import type { BoardIssue } from '../../board/roadmap-board.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';
import type { Place } from '../../project/position.js';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { readBoardBody } from '../../board/board-body.js';
import { openBoards } from '../../board/epic-board.js';
import { createOwnerResolver } from '../../board/owner-resolve.js';
import { resolvePlace } from '../../board/place.js';
import { createGhBoardListing } from '../../board/roadmap-board.js';
import { ROADMAP_LABEL } from '../../board/setup.js';
import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { issueProject, issueSubjectConfig, lineRefusal } from '../issue/issue-tracker.js';
import { defaultBoardOnce } from '../switch.js';

/** The usage line a refusal names. */
const USAGE = 'rafa board list';

/** The exit code of a board that cannot be read; see the module note. */
export const BOARD_LIST_REFUSAL_EXIT = 2;

/** What separates two columns of a line. */
const SEPARATOR = ' · ';

/** One board's row, as json mode gives it. */
export interface BoardRow {
  readonly number: number;
  readonly title: string;
  /** The owner and what GitHub answered for it; null when the board names none. */
  readonly owner: OwnerResolution | null;
  /** The distinct epics its checklist names. */
  readonly epics: number;
  readonly current: boolean;
  readonly home: boolean;
}

/** What json mode gives as the terminal result's `data`. */
export interface BoardListResult {
  readonly boards: readonly BoardRow[];
  readonly current: Place;
  readonly home: Place;
}

/** How the command reaches `gh`; the system's own when left out. */
export interface BoardListSeams {
  readonly gh?: GhRunner;
}

/**
 * The boards the module note lists, lowest number first: the open
 * labelled rows, and `defaultBoard` when it is open on the listing
 * without the label.
 */
export function listedBoards(listing: readonly BoardIssue[], defaultBoard: number): readonly BoardIssue[] {
  const labelled = openBoards(listing);
  const fallback = listing.find((issue) => issue.number === defaultBoard);
  const isExtra = fallback !== undefined
    && fallback.state === 'OPEN'
    && !fallback.labels.includes(ROADMAP_LABEL);
  return isExtra
    ? [...labelled, fallback].sort((a, b) => a.number - b.number)
    : labelled;
}

/** The distinct issues `board`'s checklist names that the listing types `epic`. */
export function epicCount(board: BoardIssue, listing: readonly BoardIssue[]): number {
  const epics = new Set(listing.filter((issue) => issue.type === 'epic').map((issue) => issue.number));
  const named = new Set(readBoardBody(board.body).lines.map((line) => line.issue));
  return [...named].filter((number) => epics.has(number)).length;
}

/** How a row spells its owner; see the module note. */
export function ownerCell(owner: OwnerResolution | null): string {
  if (owner === null) return 'no owner';
  return owner.state === 'resolved'
    ? owner.handle
    : `${owner.handle} (${owner.state})`;
}

/** The line text mode prints for `row`. */
export function boardLine(row: BoardRow): string {
  const count = row.epics === 1
    ? '1 epic'
    : `${String(row.epics)} epics`;
  const marks = [
    ...row.current
      ? ['current']
      : [],
    ...row.home
      ? ['home']
      : [],
  ];
  return [`#${String(row.number)} ${row.title}`, ownerCell(row.owner), count, ...marks].join(SEPARATOR);
}

/** The listing, read once; a refusal with {@link BOARD_LIST_REFUSAL_EXIT} when it fails. */
async function readListing(gh: GhRunner): Promise<readonly BoardIssue[]> {
  try {
    return await createGhBoardListing({ gh })();
  } catch (error) {
    throw new CommandExit(BOARD_LIST_REFUSAL_EXIT, `❌ Could not read the board, so no board can be listed: ${messageOf(error)}`);
  }
}

/** The warning for an owner that could not be asked, or null for any other. */
function unknownOwnerWarning(row: BoardRow): string | null {
  const { owner } = row;
  if (owner?.state !== 'unknown') return null;
  return `Could not check owner ${owner.handle} of board #${String(row.number)}: ${owner.reason}`;
}

/** Reads the listing, the places and the owners; see the module note. */
export async function readBoardList(context: RafaContext, seams: BoardListSeams): Promise<BoardListResult> {
  if (context.args.length > 0) {
    throw lineRefusal(`Expected no arguments, got ${String(context.args.length)}: ${context.args.join(' ')}`, USAGE);
  }
  const project = issueProject(context);
  const warn = (message: string): void => {
    context.output.warn(message);
  };
  const config = issueSubjectConfig(project, warn);
  const gh = seams.gh ?? createGhRunner({ cwd: project.root });
  const listing = await readListing(gh);
  const defaultBoard = defaultBoardOnce(config, gh, listing);

  const resolved = await resolvePlace({ root: project.root, listing, defaultBoard });
  for (const notice of resolved.notices) {
    if (notice.kind === 'lost' || notice.reason !== 'absent') warn(notice.message);
  }
  const resolveOwner = createOwnerResolver({ gh });
  const boards = await Promise.all(listedBoards(listing, await defaultBoard()).map(async (board): Promise<BoardRow> => {
    const handle = readBoardBody(board.body).owner;
    return Object.freeze({
      number: board.number,
      title: board.title,
      owner: handle === null
        ? null
        : await resolveOwner(handle),
      epics: epicCount(board, listing),
      current: board.number === resolved.current.board,
      home: board.number === resolved.home.board,
    });
  }));
  for (const row of boards) {
    const warning = unknownOwnerWarning(row);
    if (warning !== null) warn(warning);
  }
  return Object.freeze({ boards: Object.freeze(boards), current: resolved.current, home: resolved.home });
}

/** Runs one `board list` line with `seams`, writing it in the line's output mode. */
export async function runBoardList(context: RafaContext, seams: BoardListSeams): Promise<void> {
  const result = await readBoardList(context, seams);
  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  if (result.boards.length === 0) {
    context.output.info(`No open board: board #${String(result.current.board)} is not on the board listing`);
    return;
  }
  for (const row of result.boards) context.output.info(boardLine(row));
}

/** The command, reading the board with `seams`; see the module note. */
export function createBoardListCommand(seams: BoardListSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'list',
    subject: 'board',
    action: 'list',
    summary: 'list the open boards with their owner, epic count, and the current and home marks',
    description: 'Lists every open type:roadmap board, lowest number first, and the default board when it is an'
      + ' unlabelled issue titled "Roadmap" or the roadmap.issue the project names. Each line holds the board\'s'
      + ' number and title, the owner its Owner: line names (followed by (unresolved) when GitHub knows no such'
      + ' account or team, and by (unknown) when it could not be asked), the number of epics its checklist names,'
      + ' and `current` and `home` on the boards this checkout\'s position holds. With no position file both are'
      + ' the default board. Writes nothing. A board listing that cannot be read is refused with exit code 2.'
      + ' With `--output=json` the rows and the two places are the data of the terminal result event.',
    args: [],
    flags: [],
    examples: [
      {
        cmd: 'rafa board list',
        note: 'Lists the open boards, marking the one this checkout is on and its home.',
      },
      {
        cmd: 'rafa board list --output=json',
        note: 'Gives the same rows, each owner with what GitHub answered for it, as the terminal result.',
      },
    ],
    outputs: ['text', 'json'],
    run: (context) => runBoardList(context, seams),
  };
  return Object.freeze(command);
}

export default createBoardListCommand();
