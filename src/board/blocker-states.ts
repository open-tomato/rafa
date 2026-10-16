/**
 * The states of the ids `Blocked by:` lines name, read off the board:
 * one state listing, then one `gh issue view` per id that listing could
 * not answer for.
 *
 * `./unblock.ts` asks the board whether each blocker an issue names is
 * open or closed, and only a blocker the board answered CLOSED clears.
 * This module is that reading and nothing else: it takes ids, sends the
 * commands below through one {@link GhRunner}, and answers each id with
 * a {@link BlockerAnswer}. What an answer means for a label is
 * `./unblock.ts`'s to say.
 *
 * ## The two commands
 *
 * | Reading | Command |
 * |---|---|
 * | Every issue's state | `gh issue list --state all --limit 500 --json number,state` |
 * | One id the full listing did not hold | `gh issue view <n> --json number,state` |
 *
 * The listing goes first and answers every id it holds at once, so an
 * issue blocked by three ids still costs one command when the board is
 * small. It asks for {@link KNOWN_LIST_LIMIT} issues, the constant
 * `./blocked-issues.ts` asks for, so the two readings of the board ask
 * for the same number. Nothing is sent when no id was asked about.
 *
 * A listing that comes back SHORT of its limit is the whole board, so
 * it answers every id itself: an id it does not name is `dangling`, and
 * no view is sent. A listing that comes back FULL is a prefix of a
 * board that may hold more, so an id it does not name is read with one
 * view of its own — once per id, however many times the id was asked
 * about.
 *
 * ## The four answers
 *
 *  - `open` and `closed`: what `gh` answered, folded, from either
 *    command.
 *  - `dangling`: the board has no issue for the id — the full listing
 *    was short and does not name it, or its view failed writing
 *    {@link NOT_FOUND}. Read off `gh` 2.102.0 on 2026-10-15 against
 *    this repository: `gh issue view 999999 --json number,state` exits
 *    1 writing `GraphQL: Could not resolve to an issue or pull request
 *    with the number of 999999. (repository.issue)`, the phrase
 *    `src/refs/verify.ts` recorded off 2.100.0.
 *  - `unread`: any other failed view, a view answering something other
 *    than its own issue, or a state that is neither word. The same
 *    reading answered `gh issue view 1 --json number,state`, a pull
 *    request, as `{"number":1,"state":"MERGED"}`, which is `unread`
 *    here. An unread id is never taken for closed.
 *
 * {@link BlockerStatesReading.unchecked} is the sentence naming the
 * unread ids, and is null when every id was answered.
 *
 * ## A listing that failed
 *
 * A state listing that failed, or answered something other than a list
 * of issues, is {@link BlockerStatesReading.problem}, carried rather
 * than thrown. No view is sent after it, every id is answered `unread`
 * so that no caller reading an id alone can take it for closed, and
 * `unchecked` stays null: the problem is the sentence.
 *
 * ## Nothing here spawns
 *
 * GitHub arrives through the {@link GhRunner} seam, so every case in
 * `./blocker-states.test.ts` drives a recorded runner and none of them
 * reaches GitHub or spawns `gh`.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describeValue, isMapping, messageOf } from '@open-tomato/rafa/core/config/sections';

import { KNOWN_LIST_LIMIT } from './blocked-issues.js';

/** What every sentence this module makes about the board opens with: it is the unblock run's reading. */
const PREFIX = 'board unblock';

/**
 * What `gh` writes to stderr for an issue number no issue or pull
 * request holds, followed by the number.
 */
export const NOT_FOUND = 'Could not resolve to an issue or pull request with the number of';

/** What the board answered about one blocker id. See the module note. */
export type BlockerAnswer = 'open' | 'closed' | 'dangling' | 'unread';

/** What {@link readBlockerStates} came to. */
export interface BlockerStatesReading {
  /** One answer per distinct id asked about. */
  readonly states: ReadonlyMap<number, BlockerAnswer>;
  /** What `gh` said when the state listing failed, or null when it answered. */
  readonly problem: string | null;
  /** The sentence naming the ids left `unread`, or null when none was. */
  readonly unchecked: string | null;
}

/** What {@link readBlockerStates} reads through. */
export interface BlockerStatesOptions {
  /** Runs every `gh` command, in the repository the board belongs to. */
  readonly gh: GhRunner;
  /** The blocker ids to answer, in any order and with repeats allowed. */
  readonly ids: readonly number[];
}

/** What a failed command wrote, for a message. Never empty. */
export function detailOf(result: GhResult, command: string): string {
  const written = result.stderr.trim() || result.stdout.trim();
  return written === ''
    ? `${command} failed and wrote nothing`
    : `${command} failed: ${written}`;
}

/** The rows `args` wrote. Throws, naming `command`, when it failed or answered something else. */
export async function rowsOf(gh: GhRunner, args: readonly string[], command: string): Promise<readonly unknown[]> {
  const result = await gh(args);
  if (!result.ok) throw new Error(`${PREFIX}: ${detailOf(result, command)}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout) as unknown;
  } catch (error) {
    throw new Error(`${PREFIX}: ${command} wrote output that is not JSON: ${messageOf(error)}`, { cause: error });
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${PREFIX}: ${command} answered ${describeValue(parsed)}, expected a list of issues`);
  }
  return parsed as readonly unknown[];
}

/** One row's `number`, checked. */
export function rowNumber(row: unknown, command: string, where: string): number {
  if (!isMapping(row)) {
    throw new Error(`${PREFIX}: ${command} answered ${where} as ${describeValue(row)}, expected a mapping`);
  }
  const number = row['number'];
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1) {
    throw new Error(
      `${PREFIX}: ${command} answered ${where}.number as ${describeValue(number)}, expected a positive whole number`,
    );
  }
  return number;
}

/** The arguments and the command line of the board's state listing. */
const STATE_ARGS: readonly string[] = Object.freeze([
  'issue', 'list',
  '--state', 'all',
  '--limit', String(KNOWN_LIST_LIMIT),
  '--json', 'number,state',
]);

/** The state listing, as a message names it. */
const STATE_COMMAND = `gh ${STATE_ARGS.join(' ')}`;

/** The arguments of the one view an id the full listing did not hold is read with. */
function viewArgs(id: number): readonly string[] {
  return ['issue', 'view', String(id), '--json', 'number,state'];
}

/** What the board holds an issue as; a state this reads as neither is no reading at all. */
export type BoardState = 'open' | 'closed';

/** What the board answered about its issues. */
export interface BoardStates {
  /** Every issue number the listing named, whatever it said of its state. */
  readonly numbers: ReadonlySet<number>;
  /** The issues whose state the listing answered as one the board holds. */
  readonly states: ReadonlyMap<number, BoardState>;
  /** True when the listing answered its own limit, so the board may hold more. */
  readonly full: boolean;
}

/** One row's `state`, folded, or null when it is neither state the board holds. */
export function rowState(row: unknown): BoardState | null {
  const state = isMapping(row)
    ? row['state']
    : null;
  if (typeof state !== 'string') return null;
  const folded = state.trim().toUpperCase();
  if (folded === 'OPEN') return 'open';
  return folded === 'CLOSED'
    ? 'closed'
    : null;
}

/** Every issue the board holds with its state; throws, naming the command, when the listing failed. */
export async function readBoardStates(gh: GhRunner): Promise<BoardStates> {
  const rows = await rowsOf(gh, STATE_ARGS, STATE_COMMAND);
  const numbers = new Set<number>();
  const states = new Map<number, BoardState>();
  for (const [index, row] of rows.entries()) {
    const number = rowNumber(row, STATE_COMMAND, `issue ${String(index)}`);
    numbers.add(number);
    const state = rowState(row);
    if (state !== null) states.set(number, state);
  }
  return { numbers, states, full: rows.length >= KNOWN_LIST_LIMIT };
}

/** What one view answered about `id`. Never throws: every failure is an answer. */
async function viewState(gh: GhRunner, id: number): Promise<BlockerAnswer> {
  const result = await gh(viewArgs(id));
  if (!result.ok) {
    return result.stderr.includes(NOT_FOUND)
      ? 'dangling'
      : 'unread';
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout) as unknown;
  } catch {
    return 'unread';
  }
  if (!isMapping(parsed) || parsed['number'] !== id) return 'unread';
  return rowState(parsed) ?? 'unread';
}

/** What the listing alone answers about `id`, or null when it does not hold it and was full. */
function listedState(board: BoardStates, id: number): BlockerAnswer | null {
  if (board.numbers.has(id)) return board.states.get(id) ?? 'unread';
  return board.full
    ? null
    : 'dangling';
}

/** The sentence naming the ids this run read no state for. */
function uncheckedSentence(unread: readonly number[]): string {
  const named = unread.map((id) => `#${String(id)}`).join(' ');
  return `the state of ${named} could not be read off the board, so none of them counts as closed`;
}

/**
 * Every id in `options.ids` answered off the board. See the module note
 * for the commands it sends, when a view is sent, and what each answer
 * means.
 *
 * Throws nothing for the board: a listing that failed is
 * {@link BlockerStatesReading.problem}.
 */
export async function readBlockerStates(options: BlockerStatesOptions): Promise<BlockerStatesReading> {
  const { gh } = options;
  const ids = [...new Set(options.ids)];
  if (ids.length === 0) return Object.freeze({ states: new Map(), problem: null, unchecked: null });

  let board: BoardStates;
  try {
    board = await readBoardStates(gh);
  } catch (error) {
    const states = new Map(ids.map((id): [number, BlockerAnswer] => [id, 'unread']));
    return Object.freeze({ states, problem: messageOf(error), unchecked: null });
  }

  const states = new Map<number, BlockerAnswer>();
  for (const id of ids) {
    states.set(id, listedState(board, id) ?? await viewState(gh, id));
  }
  const unread = ids.filter((id) => states.get(id) === 'unread');
  return Object.freeze({
    states,
    problem: null,
    unchecked: unread.length > 0
      ? uncheckedSentence(unread)
      : null,
  });
}
