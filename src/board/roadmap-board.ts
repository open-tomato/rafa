/**
 * The one board listing `rafa issue list --roadmap` reads: every issue
 * on the board, open and closed, with the fields the roadmap rows are
 * built from, in ONE `gh` command.
 *
 * `.rafa/specs/rafa-123-rafa-issue-list-roadmap.md` allows one `gh` read
 * of the board and one of the Roadmap body. The rows need each roadmap
 * issue's title, body, labels and type, and each blocker's open or
 * closed state, so this listing asks for all of them at once:
 *
 * ```
 * gh issue list --state all --limit <n> --json number,title,body,state,labels
 * ```
 *
 * `--state all` because a blocker that has closed is still a reading the
 * `blocked by` column prints (`#n closed`), and a closed issue left off
 * the listing would read as a blocker whose state is unknown.
 * `--limit` defaults to {@link BOARD_LISTING_LIMIT}; that number is a
 * choice made here, not a bound measured against `gh` or GitHub, and a
 * board larger than it answers its newest issues only, as `gh issue
 * list` orders them.
 *
 * Nothing here spawns: the command goes through the {@link GhRunner}
 * seam declared in `src/adapters/tracker/github.ts`, and every case in
 * `./roadmap-board.test.ts` plants the answer it reads.
 *
 * ## Every row is checked, field by field
 *
 * A row is refused, naming the command and the row's index, at the FIRST
 * field that is not what is read here: `number` a positive whole number,
 * `title` and `body` strings, `state` `OPEN` or `CLOSED` (what `gh`
 * answers for an issue, as the adapter's `get` reads it), and `labels` a
 * list whose every item is a mapping with a string `name`. A missing
 * field is refused as its `undefined` value, so a `--json` list that
 * lost a field fails loudly rather than reading as an empty body. A
 * failed command, output that is not JSON, and JSON that is not a list
 * are each refused naming the command too. Nothing is dropped silently:
 * a row skipped here would be an issue the roadmap rows call missing.
 *
 * An empty list is an empty board, not a refusal.
 *
 * ## Type and module
 *
 * Each row carries its type and module as the github tracker's `get`
 * reads them — {@link typeOfLabels} and {@link moduleOfLabels}, exported
 * by the adapter for this module — so `--roadmap --type=bug` narrows by
 * the same reading `issue list --type=bug` does: the first `type:`
 * label when it names a port type, else `code`; the first `module:`
 * label, else `unassigned`.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { IssueType } from '../ports/index.js';

import { moduleOfLabels, typeOfLabels } from '../adapters/tracker/github.js';
import { describeValue, isMapping, messageOf } from '../config-sections.js';

/** What every refusal this module raises opens with. */
const PREFIX = 'board listing';

/** The fields the listing asks `gh issue list` for. */
export const BOARD_LIST_FIELDS = 'number,title,body,state,labels';

/** How many issues one listing reads when the caller names no limit; see the module note. */
export const BOARD_LISTING_LIMIT = 1000;

/** The two states `gh` answers for an issue. */
export type BoardIssueState = 'OPEN' | 'CLOSED';

/** One issue on the board, as the listing read it. */
export interface BoardIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: BoardIssueState;
  /** Every label's name, in the order `gh` answered them. */
  readonly labels: readonly string[];
  /** The type the labels carry, read as the github tracker reads it. */
  readonly type: IssueType;
  /** The module the labels carry, read as the github tracker reads it. */
  readonly module: string;
}

/** Every issue on the board; the seam the roadmap rows read through. */
export type BoardListing = () => Promise<readonly BoardIssue[]>;

/** What {@link createGhBoardListing} is made with. */
export interface GhBoardListingOptions {
  /** Runs the one `gh` command the listing sends. */
  readonly gh: GhRunner;
  /** How many issues to list: a positive whole number. {@link BOARD_LISTING_LIMIT} when left out. */
  readonly limit?: number;
}

/** The arguments the listing hands `gh` for `limit`. */
function listingArgs(limit: number): readonly string[] {
  return ['issue', 'list', '--state', 'all', '--limit', String(limit), '--json', BOARD_LIST_FIELDS];
}

/** The command a refusal names for `limit`. */
export function boardListingCommand(limit: number): string {
  return `gh ${listingArgs(limit).join(' ')}`;
}

/** What a failed command wrote, for a message. Never empty. */
function detailOf(result: GhResult, command: string): string {
  const written = result.stderr.trim() || result.stdout.trim();
  return written === ''
    ? `${command} failed and wrote nothing`
    : `${command} failed: ${written}`;
}

/** The first thing wrong with a row's `labels`, or null when it is a list of named labels. */
function labelsProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return `labels ${describeValue(value)}, expected a list of named labels`;
  const bad = value.findIndex((label: unknown) => !isMapping(label) || typeof label['name'] !== 'string');
  return bad === -1
    ? null
    : `labels[${bad}] ${describeValue(value[bad])}, expected a mapping with a string name`;
}

/** The first thing wrong with one row, or null when every field is read. */
function rowProblem(row: unknown): string | null {
  if (!isMapping(row)) return `${describeValue(row)}, expected a mapping`;
  const { number, title, body, state, labels } = row;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1) {
    return `number ${describeValue(number)}, expected a positive whole number`;
  }
  if (typeof title !== 'string') return `title ${describeValue(title)}, expected a string`;
  if (typeof body !== 'string') return `body ${describeValue(body)}, expected a string`;
  if (state !== 'OPEN' && state !== 'CLOSED') return `state ${describeValue(state)}, expected "OPEN" or "CLOSED"`;
  return labelsProblem(labels);
}

/** The issue one checked row holds. */
function issueOf(row: Readonly<Record<string, unknown>>): BoardIssue {
  // Every field was checked by rowProblem before this is called.
  const labels = (row['labels'] as readonly { readonly name: string }[]).map((label) => label.name);
  return Object.freeze({
    number: row['number'] as number,
    title: row['title'] as string,
    body: row['body'] as string,
    state: row['state'] as BoardIssueState,
    labels: Object.freeze(labels),
    type: typeOfLabels(labels),
    module: moduleOfLabels(labels),
  });
}

/**
 * The issues `command` wrote. Throws, naming the command and the first
 * row refused, when the output is not a list of issues.
 */
export function parseBoardListing(stdout: string, command: string): readonly BoardIssue[] {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(`${PREFIX}: ${command} wrote output that is not JSON: ${messageOf(error)}`, { cause: error });
  }
  if (!Array.isArray(payload)) {
    throw new Error(`${PREFIX}: ${command} answered ${describeValue(payload)}, expected a list`);
  }
  const issues = payload.map((row: unknown, index): BoardIssue => {
    const problem = rowProblem(row);
    if (problem !== null) throw new Error(`${PREFIX}: ${command} answered row ${index} with ${problem}`);
    return issueOf(row as Readonly<Record<string, unknown>>);
  });
  return Object.freeze(issues);
}

/**
 * The listing over `options.gh`: one
 * `gh issue list --state all --limit <n> --json number,title,body,state,labels`
 * per call, answered as checked issues. Throws a `TypeError`, sending
 * nothing, for a limit that is not a positive whole number; rejects,
 * naming the command, when `gh` failed or answered anything but a list
 * of issues.
 */
export function createGhBoardListing(options: GhBoardListingOptions): BoardListing {
  const { gh, limit = BOARD_LISTING_LIMIT } = options;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError(`${PREFIX}: limit ${describeValue(limit)}, expected a positive whole number`);
  }
  const args = listingArgs(limit);
  const command = boardListingCommand(limit);
  return async () => {
    const result = await gh(args);
    if (!result.ok) throw new Error(`${PREFIX}: ${detailOf(result, command)}`);
    return parseBoardListing(result.stdout, command);
  };
}
