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
 * gh issue list --state all --limit <n> --json number,title,body,state,stateReason,labels
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
 * answers for an issue, as the adapter's `get` reads it), `stateReason`
 * a string or null, and `labels` a list whose every item is a mapping
 * with a string `name`. A missing field is refused as its `undefined`
 * value, so a `--json` list that lost a field fails loudly rather than
 * reading as an empty body. A failed command, output that is not JSON,
 * and JSON that is not a list are each refused naming the command too. Nothing is dropped silently:
 * a row skipped here would be an issue the roadmap rows call missing.
 *
 * An empty list is an empty board, not a refusal.
 *
 * ## Why an issue closed
 *
 * `stateReason` is read by the github tracker's `get` rule (`VIEW_FIELDS`
 * in `src/adapters/tracker/github.ts`): a string or null, anything else
 * refused. An issue with no reason comes back as an empty string or as
 * null (the adapter's note records `gh` 2.100.0 writing the empty string
 * for a merged pull request), so both read here as null. Any other
 * string is kept as `gh` wrote it, `COMPLETED` and `NOT_PLANNED` among
 * them, and is not checked against a closed set. A closed issue whose
 * reason is `NOT_PLANNED` was dropped, not done, and a reader counting
 * done work reads that here.
 *
 * ## Type and module
 *
 * Each row carries its type and module as the github tracker's `get`
 * reads them — {@link typeOfLabels} and {@link moduleOfLabels}, exported
 * by the adapter for this module — so `--roadmap --type=bug` narrows by
 * the same reading `issue list --type=bug` does: the first `type:`
 * label when it names a port type, else `code`; the first `module:`
 * label, else `unassigned`.
 *
 * ## Native relationships
 *
 * `board.relationships: native` (`.rafa/specs/rafa-340-relationships-
 * epics-blockers-github.md`) reads epics and blockers from GitHub's own
 * links. The listing asks `gh` for them only in that mode: its `--json`
 * list is {@link boardListFields} of the mode, {@link BOARD_LIST_FIELDS}
 * in `labels` and {@link nativeBoardListFields} in `native`, so a
 * labels-mode listing sends the command above unchanged.
 * {@link parseBoardListing} reads them only when handed that mode:
 * `parent`, `blockedBy`, `blocking`, `subIssuesSummary` and `subIssues`.
 * `subIssues` is read because `context/pull-requests.md` ("Native
 * relationships") records that it answers the order GitHub holds. In the
 * `labels` mode, the default, none of the five is read and none is a key
 * on the issue: a labels-mode issue has exactly the keys it had before
 * the mode existed.
 *
 * In the `native` mode every row must carry all five, checked like the
 * other fields, so a listing that lost one is refused rather than read
 * as an issue with no links. `parent` is null or one linked issue; the
 * other three lists are `{nodes, totalCount}`. A linked issue is read as
 * its number, title, state and repository. Measured 2026-09-30 with `gh`
 * 2.100.0: `gh issue list --json` answers each linked issue as `id`,
 * `number`, `state`, `title` and `url`, with no `repository` key, so the
 * repository (`owner/name`) is read off the `url`, whose issue number
 * must be the node's own. A blocker's number alone is ambiguous across
 * repositories; the pair is not.
 *
 * `gh` answers the first 50 `blockedBy` and `blocking` nodes and the
 * first 100 `subIssues`. When `totalCount` is above the nodes answered,
 * the list keeps `truncated` with that total, so a reader reports a
 * short list rather than reading it as the whole; otherwise `truncated`
 * is left out. A `totalCount` below the nodes answered is refused.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { BoardRelationshipMode } from '../config-sections.js';
import type { IssueType } from '../ports/index.js';

import { moduleOfLabels, typeOfLabels } from '../adapters/tracker/github.js';
import { describeValue, isMapping, messageOf } from '../config-sections.js';

/** What every refusal this module raises opens with. */
const PREFIX = 'board listing';

/** The fields the listing asks `gh issue list` for in the `labels` mode, the default. */
export const BOARD_LIST_FIELDS = 'number,title,body,state,stateReason,labels';

/**
 * The fields the listing asks `gh issue list` for in the `native` mode:
 * {@link BOARD_LIST_FIELDS} and then the five relationship fields
 * {@link parseBoardListing} reads in that mode, in the order the module
 * note lists them.
 */
export const nativeBoardListFields = `${BOARD_LIST_FIELDS},parent,blockedBy,blocking,subIssuesSummary,subIssues`;

/** The `--json` fields a listing read in `mode` asks for. */
export function boardListFields(mode: BoardRelationshipMode): string {
  return mode === 'native'
    ? nativeBoardListFields
    : BOARD_LIST_FIELDS;
}

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
  /** Why the issue closed, as `gh` wrote it (`NOT_PLANNED`, `COMPLETED`), or null when `gh` wrote an empty string or null. */
  readonly stateReason: string | null;
  /** Every label's name, in the order `gh` answered them. */
  readonly labels: readonly string[];
  /** The type the labels carry, read as the github tracker reads it. */
  readonly type: IssueType;
  /** The module the labels carry, read as the github tracker reads it. */
  readonly module: string;
  /** The sub-issue parent, or null for none. Native mode only; left out otherwise. */
  readonly parent?: BoardIssueLink | null;
  /** The issues this one is blocked by. Native mode only; left out otherwise. */
  readonly blockedBy?: BoardIssueLinks;
  /** The issues this one blocks. Native mode only; left out otherwise. */
  readonly blocking?: BoardIssueLinks;
  /** GitHub's count of this issue's sub-issues. Native mode only; left out otherwise. */
  readonly subIssuesSummary?: BoardSubIssuesSummary;
  /** This issue's sub-issues, in the order GitHub holds. Native mode only; left out otherwise. */
  readonly subIssues?: BoardIssueLinks;
}

/** The issue at the other end of a native relationship, as the listing answered it. */
export interface BoardIssueLink {
  readonly number: number;
  readonly title: string;
  readonly state: BoardIssueState;
  /** `owner/name`, read off the node's `url`; see the module note. */
  readonly repository: string;
}

/** One native relationship list: the nodes `gh` answered, and whether they are all of it. */
export interface BoardIssueLinks {
  /** The linked issues, in the order `gh` answered them. */
  readonly nodes: readonly BoardIssueLink[];
  /** GitHub's `totalCount`, kept only when it is above the nodes answered; left out otherwise. */
  readonly truncated?: { readonly total: number };
}

/** `subIssuesSummary` as `gh` answers it. */
export interface BoardSubIssuesSummary {
  readonly total: number;
  readonly completed: number;
  readonly percentCompleted: number;
}

/** Every issue on the board; the seam the roadmap rows read through. */
export type BoardListing = () => Promise<readonly BoardIssue[]>;

/** What {@link createGhBoardListing} is made with. */
export interface GhBoardListingOptions {
  /** Runs the one `gh` command the listing sends. */
  readonly gh: GhRunner;
  /** How many issues to list: a positive whole number. {@link BOARD_LISTING_LIMIT} when left out. */
  readonly limit?: number;
  /** `board.relationships`: which fields are asked for and read. `labels` when left out. */
  readonly mode?: BoardRelationshipMode;
}

/** The arguments the listing hands `gh` for `limit` in `mode`. */
function listingArgs(limit: number, mode: BoardRelationshipMode): readonly string[] {
  return ['issue', 'list', '--state', 'all', '--limit', String(limit), '--json', boardListFields(mode)];
}

/** The command a refusal names for `limit` in `mode`, `labels` when left out. */
export function boardListingCommand(limit: number, mode: BoardRelationshipMode = 'labels'): string {
  return `gh ${listingArgs(limit, mode).join(' ')}`;
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
  const { number, title, body, state, stateReason, labels } = row;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1) {
    return `number ${describeValue(number)}, expected a positive whole number`;
  }
  if (typeof title !== 'string') return `title ${describeValue(title)}, expected a string`;
  if (typeof body !== 'string') return `body ${describeValue(body)}, expected a string`;
  if (state !== 'OPEN' && state !== 'CLOSED') return `state ${describeValue(state)}, expected "OPEN" or "CLOSED"`;
  if (stateReason !== null && typeof stateReason !== 'string') {
    return `stateReason ${describeValue(stateReason)}, expected a string or null`;
  }
  return labelsProblem(labels);
}

/** A checked `stateReason`, with the empty string `gh` answers for an open issue read as null. */
function reasonOf(value: string | null): string | null {
  return value === ''
    ? null
    : value;
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
    stateReason: reasonOf(row['stateReason'] as string | null),
    labels: Object.freeze(labels),
    type: typeOfLabels(labels),
    module: moduleOfLabels(labels),
  });
}

/** A native field refused: {@link nativeIssueOf} names the command and the row around it. */
class NativeFieldProblem extends Error {}

/** Refuses the row being read with `problem`. */
function refuse(problem: string): never {
  throw new NativeFieldProblem(problem);
}

/** An issue's URL on any host: owner, name and number. */
const ISSUE_URL = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/issues\/(\d+)$/;

/** Whether `value` is a whole number no less than `least`. */
function isWholeNumber(value: unknown, least: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= least;
}

/** `owner/name` of the issue `url` points at, refusing a URL that is not issue `number`'s. */
function repositoryOf(url: unknown, number: number, at: string): string {
  const match = typeof url === 'string'
    ? ISSUE_URL.exec(url)
    : null;
  const [, owner, name, issue] = match ?? [];
  if (owner === undefined || name === undefined || Number(issue) !== number) {
    refuse(`${at}.url ${describeValue(url)}, expected the URL of issue ${number}`);
  }
  return `${owner}/${name}`;
}

/** The linked issue node `value` holds; `at` names it in a refusal. */
function linkOf(value: unknown, at: string): BoardIssueLink {
  if (!isMapping(value)) refuse(`${at} ${describeValue(value)}, expected a mapping`);
  const { number, title, state, url } = value;
  if (!isWholeNumber(number, 1)) refuse(`${at}.number ${describeValue(number)}, expected a positive whole number`);
  if (typeof title !== 'string') refuse(`${at}.title ${describeValue(title)}, expected a string`);
  if (state !== 'OPEN' && state !== 'CLOSED') refuse(`${at}.state ${describeValue(state)}, expected "OPEN" or "CLOSED"`);
  return Object.freeze({ number, title, state, repository: repositoryOf(url, number, at) });
}

/** The relationship list `value` holds, with `truncated` kept only when `totalCount` is above its nodes. */
function linksOf(value: unknown, at: string): BoardIssueLinks {
  if (!isMapping(value)) refuse(`${at} ${describeValue(value)}, expected a mapping with nodes and totalCount`);
  const { nodes, totalCount } = value;
  if (!Array.isArray(nodes)) refuse(`${at}.nodes ${describeValue(nodes)}, expected a list`);
  const links = Object.freeze(nodes.map((node: unknown, index) => linkOf(node, `${at}.nodes[${index}]`)));
  if (!isWholeNumber(totalCount, links.length)) {
    refuse(`${at}.totalCount ${describeValue(totalCount)}, expected a whole number no less than the ${links.length} nodes answered`);
  }
  return totalCount > links.length
    ? Object.freeze({ nodes: links, truncated: Object.freeze({ total: totalCount }) })
    : Object.freeze({ nodes: links });
}

/** The `subIssuesSummary` `value` holds. */
function summaryOf(value: unknown): BoardSubIssuesSummary {
  if (!isMapping(value)) refuse(`subIssuesSummary ${describeValue(value)}, expected a mapping`);
  const { total, completed, percentCompleted } = value;
  if (!isWholeNumber(total, 0)) refuse(`subIssuesSummary.total ${describeValue(total)}, expected a whole number`);
  if (!isWholeNumber(completed, 0) || completed > total) {
    refuse(`subIssuesSummary.completed ${describeValue(completed)}, expected a whole number from 0 to ${total}`);
  }
  if (typeof percentCompleted !== 'number' || percentCompleted < 0 || percentCompleted > 100) {
    refuse(`subIssuesSummary.percentCompleted ${describeValue(percentCompleted)}, expected a number from 0 to 100`);
  }
  return Object.freeze({ total, completed, percentCompleted });
}

/** `issue` with the five native fields `row` carries, in the order the module note lists them. */
function withNativeFields(issue: BoardIssue, row: Readonly<Record<string, unknown>>): BoardIssue {
  const { parent, blockedBy, blocking, subIssuesSummary, subIssues } = row;
  if (parent !== null && !isMapping(parent)) refuse(`parent ${describeValue(parent)}, expected null or a mapping`);
  return Object.freeze({
    ...issue,
    parent: parent === null
      ? null
      : linkOf(parent, 'parent'),
    blockedBy: linksOf(blockedBy, 'blockedBy'),
    blocking: linksOf(blocking, 'blocking'),
    subIssuesSummary: summaryOf(subIssuesSummary),
    subIssues: linksOf(subIssues, 'subIssues'),
  });
}

/** {@link withNativeFields}, a refusal opening with `refusal` (the command and the row). */
function nativeIssueOf(issue: BoardIssue, row: Readonly<Record<string, unknown>>, refusal: string): BoardIssue {
  try {
    return withNativeFields(issue, row);
  } catch (error) {
    if (error instanceof NativeFieldProblem) throw new Error(`${refusal} with ${error.message}`);
    throw error;
  }
}

/**
 * The issues `command` wrote. Throws, naming the command and the first
 * row refused, when the output is not a list of issues. In the `native`
 * `mode` each issue also carries the five relationship fields and a row
 * lacking one is refused; in `labels`, the default, none is read and
 * none is a key on the issue (see the module note).
 */
export function parseBoardListing(
  stdout: string,
  command: string,
  mode: BoardRelationshipMode = 'labels',
): readonly BoardIssue[] {
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
    const refusal = `${PREFIX}: ${command} answered row ${index}`;
    const problem = rowProblem(row);
    if (problem !== null) throw new Error(`${refusal} with ${problem}`);
    const checked = row as Readonly<Record<string, unknown>>;
    const issue = issueOf(checked);
    return mode === 'native'
      ? nativeIssueOf(issue, checked, refusal)
      : issue;
  });
  return Object.freeze(issues);
}

/**
 * `listing`, asked on the first call only: every later call answers or
 * rejects as the first did. A command that hands one listing to several
 * readers — the rows, the epics, the refs column's issue reads — reads
 * the board once.
 */
export function keepListing(listing: BoardListing): BoardListing {
  let kept: Promise<readonly BoardIssue[]> | null = null;
  return () => {
    kept ??= listing();
    return kept;
  };
}

/**
 * The listing over `options.gh`: one
 * `gh issue list --state all --limit <n> --json number,title,body,state,stateReason,labels`
 * per call in the `labels` mode, the default, and the same command over
 * {@link nativeBoardListFields} in the `native` mode, answered as
 * issues checked in that mode by {@link parseBoardListing}. Throws a `TypeError`, sending
 * nothing, for a limit that is not a positive whole number; rejects,
 * naming the command, when `gh` failed or answered anything but a list
 * of issues.
 */
export function createGhBoardListing(options: GhBoardListingOptions): BoardListing {
  const { gh, limit = BOARD_LISTING_LIMIT, mode = 'labels' } = options;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError(`${PREFIX}: limit ${describeValue(limit)}, expected a positive whole number`);
  }
  const args = listingArgs(limit, mode);
  const command = boardListingCommand(limit, mode);
  return async () => {
    const result = await gh(args);
    if (!result.ok) throw new Error(`${PREFIX}: ${detailOf(result, command)}`);
    return parseBoardListing(result.stdout, command, mode);
  };
}
