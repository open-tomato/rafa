/**
 * `rafa switch <n | -> [--no-rehome]`: move this checkout to a board or
 * an epic by its issue number, or back to where it was, and write the
 * move to the position file (`src/project/position.ts`)
 * (`.rafa/specs/rafa-245-boards-several-roadmaps-per.md`).
 *
 * ## One board listing
 *
 * The command reads the board listing once (`createGhBoardListing`,
 * `src/board/roadmap-board.ts`: every issue, open and closed, through
 * `BOARD_LIST_FIELDS` and `parseBoardListing`), and everything it
 * decides is read off that one answer. The labelled boards the default
 * board is ranked from are the listing's open `type:roadmap` rows, not a
 * second `gh issue list --label`. The default board (`resolveDefaultBoard`,
 * `src/board/boards.ts`) is asked at most once and only when an answer
 * needs it, so its title search is spent only then.
 *
 * ## The relationships mode
 *
 * Which issues are in an epic is read in the mode `board.relationships`
 * names (`readConfiguredRelations`, `src/board/configured-relations.ts`).
 * In `labels`, the default, nothing more is sent and the listing is the
 * one above. In `native` the board's repository is read first, with one
 * `gh repo view`, and the listing is asked for the native fields, so an
 * epic's members are its sub-issues and its progress GitHub's own count
 * of them (`readListedEpics`, `src/board/roadmap-epic-rows.ts`, the
 * count `rafa roadmap` prints).
 *
 * ## Board or epic
 *
 * Issue numbers are unique in a repository, so the number alone says
 * which it is, read off the listing's labels: a row carrying
 * `type:roadmap` is a board; else a row the listing types `epic` (a
 * `type:epic` label) is an epic; else a row that is the default board
 * (an unlabelled issue titled "Roadmap" or the `roadmap.issue` the
 * project names) is a board. A number the listing does not hold is a
 * board only when it is `roadmap.issue`, as `resolvePlace`
 * (`src/board/place.ts`) lets such a board stand. Anything else is
 * refused, and so is a closed board or epic.
 *
 * ## Where it moves
 *
 * - A board moves to that board and its first `now` epic that is not
 *   done: its checklist read with `parseRoadmapBody` and asked through
 *   `firstNowEpic` (`./epic/show.ts`), the pick `rafa epics` makes with no
 *   number, the epic null when it names none.
 * - An epic moves to that epic and to the board whose checklist lists
 *   it, ticked or not: the current board first, then the default board,
 *   then the lowest-numbered open labelled board. An epic that no board
 *   lists moves with the default board. That pick is `boardOfEpic`
 *   (`src/board/epic-board.ts`), which the blocker epic
 *   locator (`src/board/blocker-epic.ts`) reads too.
 * - `-` moves to the position's `previous` place, as `cd -` does. That
 *   place is checked as a number is: a board or an epic closed or
 *   relabelled since is refused, naming what it lost.
 *
 * The move starts from the place {@link resolvePlace} answers, not the
 * file as written: with no position file, or with a place that no
 * longer stands, the current place and home are its fallback, so the
 * first switch's `previous` is where the checkout stood before it and
 * `rafa switch -` goes back there. Its notices are warnings, all but
 * the one saying there is no position file yet.
 *
 * ## Home
 *
 * A switch made by hand re-homes: the new place becomes current and
 * home, the old current becomes previous (`rehome`). `--no-rehome`
 * keeps home (`hop`), for a workflow moving for a single task. `-`
 * re-homes too unless `--no-rehome` is typed.
 *
 * ## What it writes
 *
 * The new position, written whole through a temporary file and a rename
 * by `writePositionFile`, then one line naming the new place:
 * `board #<b> · epic #<e> <title> (<horizon>) · <done>/<total> done`,
 * or `board #<b> · no epic` when the board names no `now` epic that is
 * not done. Progress is `readListedEpics` over the listing, in the mode
 * above; the horizon is
 * `horizonOf` (`src/board/roadmap-epic-rows.ts`). In json mode the
 * terminal result's `data` is a {@link SwitchResult}.
 *
 * ## Exit codes
 *
 * {@link SWITCH_REFUSAL_EXIT} (2) for a number that is no open board or
 * epic, for `-` with no previous place or one that no longer stands,
 * and for a board listing, a `native` board's repository or a default
 * board that cannot be read; 1 for
 * a line that names no target, a config that cannot be used and a
 * position file that cannot be written.
 *
 * It starts no session, so it declares no `spends`.
 */
import type { GhRunner } from '../adapters/tracker/github.js';
import type { BoardView } from '../board/epic-board.js';
import type { EpicRelations, Epics } from '../board/epics.js';
import type { ResolvedPlace } from '../board/place.js';
import type { BoardIssue } from '../board/roadmap-board.js';
import type { RafaCommand, RafaContext } from '../cli/command.js';
import type { RafaConfig } from '../config.js';
import type { Place, Position } from '../project/position.js';

import { createGhRunner } from '../adapters/tracker/github.js';
import { resolveDefaultBoard } from '../board/boards.js';
import { readConfiguredRelations } from '../board/configured-relations.js';
import { boardOfEpic, openBoards } from '../board/epic-board.js';
import { resolvePlace } from '../board/place.js';
import { createGhBoardListing } from '../board/roadmap-board.js';
import { horizonOf, readListedEpics } from '../board/roadmap-epic-rows.js';
import { createGhRoadmapSearch, parseRoadmapBody } from '../board/roadmap.js';
import { ROADMAP_LABEL } from '../board/setup.js';
import { CommandExit } from '../cli/command.js';
import { messageOf } from '../config-sections.js';
import { hop, positionFilePath, rehome, writePositionFile } from '../project/position.js';

import { firstNowEpic } from './epic/show.js';
import { issueProject, issueSubjectConfig, lineRefusal } from './issue/issue-tracker.js';

/** The usage line a refusal names. */
const USAGE = 'rafa switch <n | -> [--no-rehome]';

/** The exit code of a target that cannot be moved to; see the module note. */
export const SWITCH_REFUSAL_EXIT = 2;

/** The word that goes back to the previous place. */
export const BACK = '-';

/** The flag a switch keeps home with, typed `--no-rehome`. */
const REHOME_FLAG = 'rehome';

/** An issue number as written: a whole number from 1, no leading zero. */
const ISSUE_NUMBER = /^[1-9]\d*$/u;

/** What a line asks to move to. */
export type SwitchTarget =
  | { readonly kind: 'number'; readonly number: number }
  | { readonly kind: 'back' };

/** What a number reads as on the listing. */
export type TargetKind = 'board' | 'epic';

/** What json mode gives as the terminal result's `data`. */
export interface SwitchResult {
  /** What the line asked for: a board, an epic, or `-`. */
  readonly asked: TargetKind | 'back';
  /** The new current place. */
  readonly current: Place;
  /** The place moved off of. */
  readonly previous: Place | null;
  readonly home: Place;
  /** False under `--no-rehome`. */
  readonly rehomed: boolean;
  /** The line text mode prints. */
  readonly line: string;
}

/** How the command reaches `gh`; the system's own when left out. */
export interface SwitchSeams {
  readonly gh?: GhRunner;
}

/** A refusal with {@link SWITCH_REFUSAL_EXIT}. */
function refusal(message: string): CommandExit {
  return new CommandExit(SWITCH_REFUSAL_EXIT, `❌ ${message}`);
}

/** `#<n>`. */
function id(number: number): string {
  return `#${String(number)}`;
}

/**
 * The target a line names; a refusal with exit code 1 for no word, a
 * second word, and a word that is neither `-` nor a whole number from 1.
 * Read before anything is opened.
 */
export function readSwitchTarget(args: readonly string[]): SwitchTarget {
  const [word] = args;
  if (word === undefined) throw lineRefusal('Name a board or an epic by its number, or - for the previous place', USAGE);
  if (args.length > 1) throw lineRefusal(`Expected one target, got ${String(args.length)}: ${args.join(' ')}`, USAGE);
  if (word === BACK) return { kind: 'back' };
  if (!ISSUE_NUMBER.test(word)) {
    throw lineRefusal(`"${word}" is no issue number, which is a whole number from 1, nor - for the previous place`, USAGE);
  }
  return { kind: 'number', number: Number(word) };
}

/** Whether the line re-homes: true unless `--no-rehome`; a refusal with exit code 1 for a value typed to it. */
export function readRehome(flags: RafaContext['flags']): boolean {
  const value = flags[REHOME_FLAG];
  if (value === undefined) return true;
  if (typeof value === 'boolean') return value;
  throw lineRefusal(`--${REHOME_FLAG} takes no value, and read "${value}" as one; type the target before the flags`, USAGE);
}

/** Everything the one listing answers, and the default board asked at most once. */
export interface SwitchBoard extends BoardView {
  /** `roadmap.issue`, or null when no layer names one. */
  readonly configured: number | null;
}

/** What a number reads as, or why it is refused; see the module note. */
export async function kindOf(
  number: number,
  board: SwitchBoard,
): Promise<{ readonly kind: TargetKind } | { readonly why: string }> {
  const row = board.rows.get(number);
  if (row === undefined) {
    return number === board.configured
      ? { kind: 'board' }
      : { why: `${id(number)} is not on the board listing, so it is no board and no epic` };
  }
  let kind: TargetKind;
  if (row.labels.includes(ROADMAP_LABEL)) kind = 'board';
  else if (row.type === 'epic') kind = 'epic';
  else if (number === await board.defaultBoard()) kind = 'board';
  else return { why: `${id(number)} is neither a board nor an epic: it carries neither ${ROADMAP_LABEL} nor type:epic` };
  return row.state === 'CLOSED'
    ? { why: `${id(number)} is a closed ${kind}` }
    : { kind };
}

/** Board `number` at its first `now` epic that is not done; the epic null when it names none. */
export function boardPlace(number: number, board: SwitchBoard, epics: Epics): Place {
  const row = board.rows.get(number);
  const epic = row === undefined
    ? null
    : firstNowEpic(parseRoadmapBody(row.body), board.listing, epics)?.number ?? null;
  return { board: number, epic };
}

/** How a refusal names `place`. */
function placePhrase(place: Place): string {
  return place.epic === null
    ? `board ${id(place.board)}`
    : `board ${id(place.board)} at epic ${id(place.epic)}`;
}

/** The previous place, checked as a number is; a refusal when there is none or it no longer stands. */
async function previousPlace(resolved: ResolvedPlace, board: SwitchBoard, root: string): Promise<Place> {
  const previous = resolved.position?.previous ?? null;
  if (previous === null) {
    const why = resolved.position === null
      ? `there is no position at ${positionFilePath(root)} yet`
      : 'this checkout has not moved since it was placed';
    throw refusal(`There is no previous place to go back to: ${why}; switch by number first: rafa switch <n>`);
  }
  const wanted: readonly (readonly [number, TargetKind])[] = previous.epic === null
    ? [[previous.board, 'board']]
    : [[previous.board, 'board'], [previous.epic, 'epic']];
  for (const [number, kind] of wanted) {
    const read = await kindOf(number, board);
    const why = 'why' in read
      ? read.why
      : read.kind === kind
        ? null
        : `${id(number)} is no longer a ${kind}`;
    if (why !== null) throw refusal(`The previous place, ${placePhrase(previous)}, no longer stands: ${why}`);
  }
  return previous;
}

/** The place a number moves to; a refusal when it is no open board or epic. */
async function numberPlace(number: number, resolved: ResolvedPlace, board: SwitchBoard, epics: Epics): Promise<{
  readonly kind: TargetKind;
  readonly place: Place;
}> {
  const read = await kindOf(number, board);
  if ('why' in read) throw refusal(`Cannot switch to ${id(number)}: ${read.why}; name an open board or epic`);
  if (read.kind === 'board') return { kind: 'board', place: boardPlace(number, board, epics) };
  return { kind: 'epic', place: { board: await boardOfEpic(number, resolved.current, board), epic: number } };
}

/** The line naming `place`; see the module note. */
export function placeLine(place: Place, board: Pick<SwitchBoard, 'rows'>, epics: Epics): string {
  const head = `board ${id(place.board)}`;
  if (place.epic === null) return `${head} · no epic`;
  const epic = epics.epics.find((read) => read.number === place.epic);
  const row = board.rows.get(place.epic);
  if (epic === undefined || row === undefined) return `${head} · epic ${id(place.epic)}`;
  const { done, total } = epic.progress;
  return `${head} · epic ${id(epic.number)} ${epic.title} (${horizonOf(row.labels)}) · ${String(done)}/${String(total)} done`;
}

/** `thunk`, asked at most once, any failure refused with {@link SWITCH_REFUSAL_EXIT}. */
export function defaultBoardOnce(config: RafaConfig, gh: GhRunner, listing: readonly BoardIssue[]): () => Promise<number> {
  let answer: Promise<number> | null = null;
  const read = async (): Promise<number> => {
    try {
      const found = await resolveDefaultBoard({
        configured: config.roadmapIssue,
        listBoards: () => Promise.resolve(openBoards(listing)),
        search: createGhRoadmapSearch({ gh }),
      });
      return found.number;
    } catch (error) {
      throw refusal(`Could not find the default board: ${messageOf(error)}`);
    }
  };
  return () => {
    answer ??= read();
    return answer;
  };
}

/**
 * The relations `board.relationships` names, and the listing read once
 * in that mode; a refusal with {@link SWITCH_REFUSAL_EXIT} when either
 * read fails. See the module note's "The relationships mode".
 */
async function readBoard(config: RafaConfig, gh: GhRunner): Promise<{
  readonly relations: EpicRelations | undefined;
  readonly listing: readonly BoardIssue[];
}> {
  try {
    const relations = await readConfiguredRelations(config, gh);
    const listing = await createGhBoardListing(relations === undefined
      ? { gh }
      : { gh, mode: relations.mode })();
    return { relations, listing };
  } catch (error) {
    throw refusal(`Could not read the board, so no target can be checked: ${messageOf(error)}`);
  }
}

/** Writes `position`; a refusal with exit code 1 when it cannot. */
function writePosition(root: string, position: Position): void {
  try {
    writePositionFile(root, position);
  } catch (error) {
    throw new CommandExit(1, `❌ Could not write ${positionFilePath(root)}: ${messageOf(error)}`);
  }
}

/** Reads the line, moves, and writes the position; see the module note. */
export async function runSwitchMove(context: RafaContext, seams: SwitchSeams): Promise<SwitchResult> {
  const target = readSwitchTarget(context.args);
  const rehomed = readRehome(context.flags);
  const project = issueProject(context);
  const warn = (message: string): void => {
    context.output.warn(message);
  };
  const config = issueSubjectConfig(project, warn);
  const gh = seams.gh ?? createGhRunner({ cwd: project.root });
  const { relations, listing } = await readBoard(config, gh);
  const defaultBoard = defaultBoardOnce(config, gh, listing);
  const board: SwitchBoard = {
    listing,
    rows: new Map(listing.map((issue) => [issue.number, issue])),
    configured: config.roadmapIssue,
    defaultBoard,
  };

  const resolved = await resolvePlace({ root: project.root, listing, defaultBoard });
  for (const notice of resolved.notices) {
    if (notice.kind === 'lost' || notice.reason !== 'absent') warn(notice.message);
  }
  const epics = readListedEpics({ issues: listing, claims: new Set(), today: new Date(), relations });
  const moved = target.kind === 'back'
    ? { kind: 'back' as const, place: await previousPlace(resolved, board, project.root) }
    : await numberPlace(target.number, resolved, board, epics);

  const base: Position = {
    current: resolved.current,
    previous: resolved.position?.previous ?? null,
    home: resolved.home,
  };
  const position = rehomed
    ? rehome(base, moved.place)
    : hop(base, moved.place);
  writePosition(project.root, position);
  return Object.freeze({
    asked: moved.kind,
    current: position.current,
    previous: position.previous,
    home: position.home,
    rehomed,
    line: placeLine(position.current, board, epics),
  });
}

/** Runs one `switch` line with `seams`, writing it in the line's output mode. */
export async function runSwitch(context: RafaContext, seams: SwitchSeams): Promise<void> {
  const result = await runSwitchMove(context, seams);
  if (context.outputMode === 'json') {
    context.output.result(result);
    return;
  }
  context.output.info(result.line);
}

/** The command, reading the board with `seams`; see the module note. */
export function createSwitchCommand(seams: SwitchSeams = {}): RafaCommand {
  const command: RafaCommand = {
    name: 'switch',
    subject: 'switch',
    action: 'switch',
    summary: 'move this checkout to a board or an epic by number, or back to where it was with -',
    description: 'Moves this checkout\'s position, kept in `.rafa/position.json`, to the issue numbered: a'
      + ' type:roadmap board, at its first now epic that is not done, or a type:epic epic, on the board whose'
      + ' checklist lists it (the current board first, then the default board, then the lowest-numbered board;'
      + ' the default board when none lists it). `-` goes back to the previous place, as `cd -` does. A switch'
      + ' re-homes: the new place becomes home as well as current. `--no-rehome` keeps home, for a workflow'
      + ' moving for a single task. A number that is no open board or epic, a closed one, and `-` with no'
      + ' previous place are refused with exit code 2. Prints the new place on one line: the board, the epic'
      + ' with its title and horizon, and its done/total. With `--output=json` the new current, previous and'
      + ' home places are the data of the terminal result event.',
    args: [
      {
        name: 'target',
        description: 'The board\'s or the epic\'s issue number, or - for the previous place.',
        type: 'string',
        required: true,
      },
    ],
    flags: [
      {
        name: REHOME_FLAG,
        description: 'Make the new place home too; `--no-rehome` keeps home where it is.',
        type: 'boolean',
        default: true,
      },
    ],
    examples: [
      {
        cmd: 'rafa switch 252',
        note: 'Moves to epic #252 and the board listing it, and makes that place home.',
      },
      {
        cmd: 'rafa switch -',
        note: 'Goes back to the place this checkout was at before its last switch.',
      },
      {
        cmd: 'rafa switch 31 --no-rehome',
        note: 'Moves to board #31 at its first now epic that is not done, leaving home where it was.',
      },
    ],
    outputs: ['text', 'json'],
    run: (context) => runSwitch(context, seams),
  };
  return Object.freeze(command);
}

export default createSwitchCommand();
