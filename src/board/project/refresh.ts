/**
 * The refresh: {@link refreshProjectItems} brings the project's items for
 * some issues in step with what rafa reads of those issues
 * (`.rafa/specs/rafa-791-github-project-each-repository.md`, "The
 * refresh"). The project is a mirror of the labels, pull requests, close
 * state, fragments and the home board's order; the issues stay the source
 * of truth, so nothing read off the project decides a value.
 *
 * ## Nothing without `board.project.number`
 *
 * With `board.project.number` unset the refresh answers `no-project` at
 * once, having sent no call, so a caller never checks whether the
 * repository opted in. An empty list of issues with nothing to widen it
 * (see below) answers `no-issues` the same way.
 *
 * ## What one refresh reads, in order
 *
 * Every call goes through the `GhRunner` seam (`src/adapters/tracker/github.ts`):
 *
 *  1. the repository, `gh repo view --json nameWithOwner`, whose owner
 *     holds the project (`readBoardRepository`);
 *  2. the project at that owner and number, with its fields (`./gh.ts`);
 *     a project that is not there answers `not-found`, and nothing more
 *     is read;
 *  3. the project's items, every page; an issue of this repository with
 *     no item there, and none among the known items (see below), is
 *     answered in {@link ProjectRefreshed.missing} and nothing is read or
 *     written for it, since adding an item is its caller's step
 *     (`rafa issue create`, `rafa board sync`);
 *  4. for the issues on the project, their facts (`./facts.ts`), each
 *     issue read or refused on its own;
 *  5. the board once for all of them: the listing in the
 *     `board.relationships` mode, the labelled boards, the default board
 *     among them (`resolveDefaultBoard`, `../boards.ts`) whose lines Rank
 *     numbers, the epics `readEpics` reads off the listing, and the
 *     relations port's reading for Blocked by. The title search is spent
 *     only while no board is labelled, where it picks the default; beside
 *     a labelled board it would only name unlabelled "Roadmap" issues,
 *     which the refresh does not print.
 *
 * Steps 4 and 5 are skipped when no issue asked for is on the project.
 *
 * ## One issue refused, the rest written
 *
 * An issue whose facts could not be read — a call that failed for it
 * alone, an answer that is not the recorded shape, a list whose cursor
 * repeats — is refused alone: nothing is written for it, it is answered
 * in {@link ProjectRefreshed.refused}, and its line,
 * `#<n> not refreshed: <reason>` (`notRefreshedWarning`), opens the
 * warnings. Every other issue's values are written as read, so the next
 * refresh or `rafa board sync` picks the refused one up.
 *
 * ## Known items, for issues just added
 *
 * A caller that has just added issues holds the item id each add answered
 * ({@link ProjectPort.addItem}), and hands them as {@link KnownItem}s
 * ({@link knownItem}), so the refresh fills those issues whether or not
 * the listing of step 3 shows their items yet. Measured on 0.41.0: a sync
 * added #939 and #941, its second refresh read the facts of one issue, and
 * #939 kept an empty Stage until the next sync
 * (`.rafa/specs/rafa-947-board-project-follow-ups.md`). That the listing
 * lags an add fits those facts and is NOT a reading.
 *
 * A known item is matched to its issue by its content: the issue's number,
 * and its repository compared with this one's as the listing's items are,
 * case aside. The matched ones join the listing's items before anything is
 * widened, so a widening reads them as it reads the others. Where the
 * listing and a known item both name an issue the listing's wins, since
 * it carries the values already held; of two known items naming one issue
 * the later is used. A known item holds no value, so every field the rules
 * give a value reads as differing and is written.
 *
 * Each known item the refresh did not fill is answered in
 * {@link ProjectRefreshed.notFilled} with its reason, in the order given:
 *
 *  - its content names another repository, so it is matched to no issue
 *    and never written to;
 *  - its issue is not among the issues asked for and widened;
 *  - its issue's facts were refused, the refusal's reason kept;
 *  - a rate-limit refusal stopped the writes with one of its issue's
 *    unsent.
 *
 * The last is read off the order of the writes: the first
 * `writes.written` of {@link ProjectRefreshed.changes} are taken as
 * landed, the requests going in that order and stopping at the refusal.
 * It is exact for every request before the refused one; that the writes a
 * refused request's data answers anyway are its first ones is NOT a
 * reading (`./writes.ts`).
 *
 * They are answered as data and add no line to `warnings`: the caller
 * that made the adds words them. A dry run writes nothing and answers
 * none for its writes; a refresh that read no project (`skipped`,
 * `not-found`, `refused`) answers none at all.
 *
 * ## Widening: an epic's members, and the items whose Rank shifted
 *
 * A caller that changed the home board's order or an epic's membership
 * (the `rafa epic` actions, `src/commands/epic/epic-project.ts`) cannot
 * name every issue that change reached, so it hands a
 * {@link RefreshWidening}, and the board of step 5 is then read before
 * the facts, once, to widen the issues asked for:
 *
 *  - {@link RefreshWidening.membersOf} adds each named epic's members as
 *    that board reads them, in the epic's member order, so a member the
 *    caller's write just moved in is read off the listing it changed;
 *  - {@link RefreshWidening.shiftedRanks} adds every item of this
 *    repository whose Rank on the project is not the one the home
 *    board's order gives, lowest number first, compared as the writes
 *    compare it (`projectChangesOf`). Against a project that was in step
 *    before the caller's write, those are the items whose Rank the write
 *    shifted; an item that drifted for another reason is caught up too.
 *    With the Rank field skipped (renamed, or of another type) none is
 *    added.
 *
 *  - {@link RefreshWidening.everyItem} adds every item of this
 *    repository on the project, lowest number first, which is how
 *    `rafa board sync` refreshes the whole project;
 *  - {@link RefreshWidening.openIssues} adds every open issue on that
 *    board's listing, lowest number first, so an open issue with no item
 *    is answered in {@link ProjectRefreshed.missing} for the sync to add.
 *
 * The widened issues follow the ones asked for, each once, in that order
 * of the widenings; a member or an open issue with no item on the project
 * is answered in {@link ProjectRefreshed.missing}.
 *
 * ## What it writes
 *
 * The five values come out of the rules (`./rules.ts`) through
 * `./refresh-values.ts`, which compares them with what each item holds
 * and answers only the values that differ; those, and nothing else, go
 * to `writeProjectFields` (`./writes.ts`), batched by
 * `board.project.writeBatchSize` and paced by `board.project.writePauseMs`,
 * both read off {@link RefreshOptions.config}. A second
 * refresh over unchanged facts therefore sends no write. A field the
 * project does not hold as the template has it is skipped and named in
 * {@link ProjectRefreshed.skipped}; the other fields are still written.
 *
 * ## Progress
 *
 * Given {@link RefreshOptions.progress}, the facts read of step 4 is the
 * `reading facts` phase (`./progress.ts`): its total is the issues on the
 * project to read, it advances as `readIssueFacts` hears their first
 * pages come back, and its end counts the issues read and those refused.
 * The writes are the `writing fields` phase, fed by `writeProjectFields`
 * (`./writes.ts`). A phase the refresh never enters — no issue on the
 * project to read, or nothing to write — prints nothing.
 *
 * With {@link RefreshOptions.dryRun} set, everything above is read and
 * the changes are answered as they would be written, but no write is
 * sent: `writes` counts none written and none refused. That is
 * `rafa board sync --dry-run`.
 *
 * ## Failures, answered as warning lines
 *
 * The four rows of the spec's "What can go wrong" table, and each issue
 * refused as above, are never thrown: each is answered in the refresh's
 * `warnings`, one line naming its fix (`./refresh-warnings.ts`), for the
 * caller to print after its own output while keeping its own exit code.
 * A refresh with nothing to warn of answers an empty list.
 *
 *  - A token without the `project` scope, read off the refusal of any
 *    project call, answers `refused` with the scope line; what was
 *    written before the refusal stays written.
 *  - A rate-limit refusal stops the writes and is answered in
 *    {@link ProjectRefreshed.writes} with the line counting the issues
 *    not updated.
 *  - A `board.project.number` naming no project answers `not-found` with
 *    the line naming the number.
 *  - Each field in {@link ProjectRefreshed.skipped} gets its own line;
 *    the other fields are still written.
 *
 * Any other failed read or write rejects with the reader's own error, a
 * `ProjectPortError` from the port keeping what `gh` wrote; a board with
 * no default board rejects as `resolveDefaultBoard` does. A failed facts
 * read never rejects: it refuses the issues it reached, as above.
 */
import type { FactsRefusal } from './facts.js';
import type {
  FieldMismatch,
  MatchedField,
  Project,
  ProjectContentRef,
  ProjectItem,
  ProjectPort,
  ProjectRef,
} from './port.js';
import type { ProgressFeed } from './progress.js';
import type { ProjectChange, RefreshBoard } from './refresh-values.js';
import type { ProjectWritesOptions, ProjectWritesResult } from './writes.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { RafaConfig } from '../../config.js';
import type { BoardIssue } from '../roadmap-board.js';
import type { RoadmapSearch } from '../roadmap.js';

import { createGhBoardLister, resolveDefaultBoard } from '../boards.js';
import { readEpics } from '../epics.js';
import { selectBoardRelations } from '../relations/select.js';
import { readBoardRepository } from '../repository.js';
import { createGhBoardListing } from '../roadmap-board.js';
import { createGhRoadmapSearch, parseRoadmapBody } from '../roadmap.js';

import { readIssueFacts } from './facts.js';
import { createGhProjectPort } from './gh.js';
import { matchProjectFields } from './port.js';
import { openPhase } from './progress.js';
import { projectChangesOf, projectValuesOf } from './refresh-values.js';
import {
  isMissingProjectScope,
  notFoundWarning,
  notRefreshedWarning,
  rateLimitWarning,
  scopeWarning,
  skippedFieldWarning,
} from './refresh-warnings.js';
import { rankOf, ranksOf } from './rules.js';
import { writeProjectFields } from './writes.js';

/** What every refusal of this module opens with. */
const PREFIX = 'board project refresh';

/**
 * The config keys the refresh reads, and the two retry keys its callers
 * open the runner with (`./project-runner.ts`).
 */
export type RefreshConfig = Pick<
  RafaConfig,
  | 'boardProjectNumber'
  | 'boardProjectRetries'
  | 'boardProjectRetryWaitSeconds'
  | 'boardProjectWriteBatchSize'
  | 'boardProjectWritePauseMs'
  | 'boardRelationships'
  | 'roadmapIssue'
  | 'releaseFragments'
>;

/** What {@link refreshProjectItems} is made with. */
export interface RefreshOptions {
  readonly config: RefreshConfig;
  /** Runs every `gh` call the refresh sends. */
  readonly gh: GhRunner;
  /** The pause between two write requests; `Bun.sleep` when left out. */
  readonly sleep?: ProjectWritesOptions['sleep'];
  /** True to read and answer the changes and send no write; see the module note. */
  readonly dryRun?: boolean;
  /** Hears the `reading facts` and `writing fields` phases; silent when left out. See the module note. */
  readonly progress?: ProgressFeed;
}

/** The pace of the writes: the two `board.project` keys off the config, and the sleep seam and progress feed when given. */
function writesOptionsOf(options: RefreshOptions): ProjectWritesOptions {
  const { sleep, progress } = options;
  return {
    batchSize: options.config.boardProjectWriteBatchSize,
    pauseMs: options.config.boardProjectWritePauseMs,
    ...(sleep === undefined
      ? {}
      : { sleep }),
    ...(progress === undefined
      ? {}
      : { progress }),
  };
}

/** What a refresh adds to the issues it is asked for; see the module note. */
export interface RefreshWidening {
  /** The epics whose members, as the refresh's own board reading reads them, are refreshed too. */
  readonly membersOf?: readonly number[];
  /** True to refresh too every item whose Rank on the project is not the one the home board's order gives. */
  readonly shiftedRanks?: boolean;
  /** True to refresh too every item of this repository on the project. */
  readonly everyItem?: boolean;
  /** True to refresh too every open issue on the board listing, one with no item answered as missing. */
  readonly openIssues?: boolean;
}

/**
 * The item of an issue just added, as its add answered it: the node id
 * {@link ProjectPort.addItem} answered, the issue the add sent as its
 * content, and no value. Built by {@link knownItem}; see the module note.
 */
export interface KnownItem extends ProjectItem {
  readonly content: { readonly kind: 'issue'; readonly number: number; readonly repository: string };
}

/** An issue just added that the refresh did not fill; see the module note. */
export interface AddedNotFilled {
  /** The issue the known item names. */
  readonly number: number;
  /** Why, worded to follow `#<n> added but not filled: `. */
  readonly reason: string;
}

/** A refresh that sent no call. */
export interface ProjectRefreshSkipped {
  readonly kind: 'skipped';
  /** `no-project` with `board.project.number` unset; `no-issues` when none was asked for. */
  readonly reason: 'no-project' | 'no-issues';
  /** Always empty: a refresh that sent no call has nothing to warn of. */
  readonly warnings: readonly string[];
}

/** A refresh whose `board.project.number` names no project of the repository's owner. */
export interface ProjectRefreshNotFound {
  readonly kind: 'not-found';
  readonly project: ProjectRef;
  /** The one line naming the number and `rafa init --board`. */
  readonly warnings: readonly string[];
}

/** A refresh a project call refused for the token's missing `project` scope. */
export interface ProjectRefreshRefused {
  readonly kind: 'refused';
  readonly reason: 'scope';
  readonly project: ProjectRef;
  /** The one line naming `gh auth refresh -s project`. */
  readonly warnings: readonly string[];
}

/** A refresh that read the project, and wrote what differed. */
export interface ProjectRefreshed {
  readonly kind: 'refreshed';
  readonly project: ProjectRef;
  /** Every value that differed, by issue in the order asked and widened, then in field order; not written on a dry run. */
  readonly changes: readonly ProjectChange[];
  /** How the writes of {@link ProjectRefreshed.changes} went. */
  readonly writes: ProjectWritesResult;
  /**
   * The issues asked for, or added as an epic's members or as open issues,
   * that have no item on the project's listing and none among the known
   * items, in that order.
   */
  readonly missing: readonly number[];
  /** The template's fields the project does not hold as expected, none written. */
  readonly skipped: readonly FieldMismatch[];
  /** The issues on the project whose facts could not be read, none written, in the order asked and widened. */
  readonly refused: readonly FactsRefusal[];
  /** The known items the refresh did not fill, each with its reason, in the order given; empty when none was handed. */
  readonly notFilled: readonly AddedNotFilled[];
  /** One line per refused issue, then the rate-limit line when the writes were refused, then one line per skipped field. */
  readonly warnings: readonly string[];
}

/** What {@link refreshProjectItems} answers. */
export type ProjectRefresh = ProjectRefreshSkipped | ProjectRefreshNotFound | ProjectRefreshRefused | ProjectRefreshed;

/** The changes the issues read need, and the issues refused; see the module note. */
interface IssueChanges {
  readonly changes: readonly ProjectChange[];
  readonly refused: readonly FactsRefusal[];
}

/** The facts answer of a refresh with no issue on the project to read. */
const NOTHING_READ: IssueChanges = Object.freeze({ changes: [], refused: [] });

/** The writes answer of a refresh that had nothing to write. */
const NOTHING_WRITTEN: ProjectWritesResult = Object.freeze({ written: 0, notUpdated: 0, rateLimited: false, detail: '' });

/**
 * The title search handed `resolveDefaultBoard` once a labelled board is
 * found: there it only names unlabelled "Roadmap" issues for a report,
 * which the refresh prints none of, so it is not spent.
 */
const NO_UNLABELLED_SEARCH: RoadmapSearch = () => Promise.resolve([]);

/** `issues` deduped in the order given; throws a `RangeError` on one that is not an issue number. */
function issueNumbers(issues: readonly number[]): readonly number[] {
  const bad = issues.find((issue) => !Number.isSafeInteger(issue) || issue < 1);
  if (bad !== undefined) throw new RangeError(`${PREFIX}: ${String(bad)} is not an issue number`);
  return [...new Set(issues)];
}

/** The items of `items` standing for an issue of `repository`, by issue number. */
function issueItems(items: readonly ProjectItem[], repository: string): ReadonlyMap<number, ProjectItem> {
  const wanted = repository.toLowerCase();
  return new Map(items.flatMap((item) => (item.content.kind === 'issue' && item.content.repository.toLowerCase() === wanted
    ? [[item.content.number, item] as const]
    : [])));
}

/** The {@link KnownItem} of the add that answered the item id `id` for `content`; see the module note. */
export function knownItem(id: string, content: ProjectContentRef): KnownItem {
  return { id, archived: false, content: { kind: 'issue', number: content.number, repository: content.repository }, values: new Map() };
}

/** The reason of a known item whose issue is not among those asked for and widened. */
const NOT_REFRESHED_REASON = 'not among the issues refreshed';

/** The reason of a known item whose issue a rate-limit refusal left with a write unsent. */
const RATE_LIMIT_REASON = 'GitHub\'s rate limit refused its writes';

/** What one refresh did, as far as it decides whether a known item was filled. */
interface FillReading {
  readonly repository: string;
  /** The issues the refresh held an item for, by number. */
  readonly present: ReadonlyMap<number, ProjectItem>;
  readonly refused: readonly FactsRefusal[];
  /** The issues with a change a rate-limit refusal left unwritten. */
  readonly unwritten: ReadonlySet<number>;
}

/** The issues of the `changes` a rate-limit refusal left unwritten: those past the first `writes.written`; see the module note. */
function unwrittenIssues(changes: readonly ProjectChange[], writes: ProjectWritesResult): ReadonlySet<number> {
  return new Set(writes.rateLimited
    ? changes.slice(writes.written).map(({ issue }) => issue)
    : []);
}

/** Why the refresh `reading` describes did not fill `item`, or null when it did; see the module note. */
function notFilledReason(item: KnownItem, reading: FillReading): string | null {
  const { number, repository } = item.content;
  if (repository.toLowerCase() !== reading.repository.toLowerCase()) return `its item is of ${repository}, not ${reading.repository}`;
  if (!reading.present.has(number)) return NOT_REFRESHED_REASON;
  const refusal = reading.refused.find((refused) => refused.number === number);
  if (refusal !== undefined) return refusal.reason;
  return reading.unwritten.has(number)
    ? RATE_LIMIT_REASON
    : null;
}

/** The items of `known` the refresh `reading` describes did not fill, each with its reason, in the order given. */
function notFilledOf(known: readonly KnownItem[], reading: FillReading): readonly AddedNotFilled[] {
  return known.flatMap((item) => {
    const reason = notFilledReason(item, reading);
    return reason === null
      ? []
      : [{ number: item.content.number, reason }];
  });
}

/** The home board's row: the listing's, else the labelled boards'; throws when neither holds it. */
function homeRow(number: number, listing: readonly BoardIssue[], boards: readonly BoardIssue[]): BoardIssue {
  const row = listing.find((issue) => issue.number === number) ?? boards.find((issue) => issue.number === number);
  if (row === undefined) throw new Error(`${PREFIX}: the default board #${String(number)} is not on the board listing`);
  return row;
}

/** The board of a widened refresh: what the values are computed against, and the issues on its listing. */
export interface WidenedBoard extends RefreshBoard {
  /** Every open issue on the listing, lowest number first. */
  readonly open: readonly number[];
  /** Every closed issue on the listing, lowest number first; `rafa init --board --project` adds those with a Rank. */
  readonly closed: readonly number[];
}

/** The numbers of the rows of `listing` in `state`, lowest first. */
function numbersIn(listing: readonly BoardIssue[], state: BoardIssue['state']): readonly number[] {
  return listing
    .filter((issue) => issue.state === state)
    .map(({ number }) => number)
    .sort((a, b) => a - b);
}

/**
 * The board every issue's values are computed against, read once; see
 * the module note. Exported for the project step of `rafa init --board`
 * (`src/commands/init-board-project.ts`), which picks the issues to add
 * off the same reading.
 */
export async function readRefreshBoard(config: RefreshConfig, gh: GhRunner, repository: string): Promise<WidenedBoard> {
  const mode = config.boardRelationships;
  const listing = await createGhBoardListing({ gh, mode })();
  const boards = await createGhBoardLister({ gh, mode })();
  const home = await resolveDefaultBoard({
    configured: config.roadmapIssue,
    listBoards: () => Promise.resolve(boards),
    search: boards.length === 0
      ? createGhRoadmapSearch({ gh })
      : NO_UNLABELLED_SEARCH,
  });
  const lines = parseRoadmapBody(homeRow(home.number, listing, home.boards).body);
  const relations = selectBoardRelations(config, { gh, repository });
  // Claims and the day decide an epic's state and lateness, which no field shows; its counts read neither.
  const { epics } = readEpics({ issues: listing, claims: new Set(), today: new Date(), relations });
  const reading = relations.read(listing);
  const rows = new Map(listing.map((issue) => [issue.number, issue]));
  return {
    ranks: ranksOf({ lines, epics }),
    epics: new Map(epics.map((epic) => [epic.number, epic])),
    blockersOf: (issue) => {
      const row = rows.get(issue);
      return row === undefined
        ? { kind: 'none', issue }
        : reading.blockersOf(row);
    },
    open: numbersIn(listing, 'OPEN'),
    closed: numbersIn(listing, 'CLOSED'),
  };
}

/** The changes the issues on the project need, by issue in the order asked; `read` is the board when it was read already. */
async function changesFor(
  options: RefreshOptions,
  repository: string,
  project: Project,
  present: ReadonlyMap<number, ProjectItem>,
  read: RefreshBoard | null,
): Promise<IssueChanges> {
  const { config, gh } = options;
  const numbers = [...present.keys()];
  const phase = openPhase(options.progress, 'facts', numbers.length);
  const { facts, refused } = await readIssueFacts({ gh, fragments: config.releaseFragments, onRead: phase.advance }, numbers);
  phase.end({ done: facts.size, refused: refused.length });
  const board = read ?? await readRefreshBoard(config, gh, repository);
  const { matched } = matchProjectFields(project);
  const changes = numbers.flatMap((issue) => {
    const issueFacts = facts.get(issue);
    const item = present.get(issue);
    return issueFacts === undefined || item === undefined
      ? []
      : projectChangesOf(issue, item, projectValuesOf(issueFacts, board), matched);
  });
  return { changes, refused };
}

/** True when `item` holds another Rank than `rank`, compared as a write would compare it. */
function rankShifted(issue: number, item: ProjectItem, rankField: MatchedField, rank: number | null): boolean {
  const values = { stage: null, horizon: null, rank, blockedBy: null, progress: null };
  return projectChangesOf(issue, item, values, [rankField]).length > 0;
}

/** `numbers`, then what `widening` adds off `board` and the project's `items`, each once; see the module note. */
function widenedIssues(
  numbers: readonly number[],
  widening: RefreshWidening,
  board: WidenedBoard,
  items: ReadonlyMap<number, ProjectItem>,
  project: Project,
): readonly number[] {
  const members = (widening.membersOf ?? []).flatMap((epic) => (board.epics.get(epic)?.members ?? []).map(({ number }) => number));
  const rankField = matchProjectFields(project).matched.find(({ template }) => template.key === 'rank');
  const shifted = widening.shiftedRanks !== true || rankField === undefined
    ? []
    : [...items]
      .filter(([issue, item]) => rankShifted(issue, item, rankField, rankOf(board.ranks, issue)))
      .map(([issue]) => issue)
      .sort((a, b) => a - b);
  const every = widening.everyItem === true
    ? [...items.keys()].sort((a, b) => a - b)
    : [];
  const open = widening.openIssues === true
    ? board.open
    : [];
  return [...new Set([...numbers, ...members, ...shifted, ...every, ...open])];
}

/** True when `widening` asks for anything past the issues named. */
function widens(widening: RefreshWidening): boolean {
  return (widening.membersOf ?? []).length > 0
    || widening.shiftedRanks === true
    || widening.everyItem === true
    || widening.openIssues === true;
}

/** What one refresh is asked for: the issues named, what widens them, and the items of those just added. */
interface RefreshAsk {
  readonly asked: readonly number[];
  readonly widening: RefreshWidening;
  readonly known: readonly KnownItem[];
}

/** The refresh `ask` describes on the project `ref` names, once the repository is read. */
async function refreshOn(
  options: RefreshOptions,
  repository: string,
  ref: ProjectRef,
  { asked, widening, known }: RefreshAsk,
): Promise<ProjectRefresh> {
  const { config, gh } = options;
  const port: ProjectPort = createGhProjectPort(gh);
  const project = await port.find(ref);
  if (project === null) return { kind: 'not-found', project: ref, warnings: [notFoundWarning(ref)] };

  const listed = issueItems(await port.items(project.id), repository);
  // The listing's item wins where both hold one for an issue: it carries the values already held.
  const items = new Map([...issueItems(known, repository), ...listed]);
  const board = widens(widening)
    ? await readRefreshBoard(config, gh, repository)
    : null;
  const numbers = board === null
    ? asked
    : widenedIssues(asked, widening, board, items, project);
  const present = new Map(numbers.flatMap((issue) => {
    const item = items.get(issue);
    return item === undefined
      ? []
      : [[issue, item] as const];
  }));
  const missing = numbers.filter((issue) => !present.has(issue));
  const { mismatched: skipped } = matchProjectFields(project);
  const { changes, refused } = present.size === 0
    ? NOTHING_READ
    : await changesFor(options, repository, project, present, board);
  const writes = changes.length === 0 || options.dryRun === true
    ? NOTHING_WRITTEN
    : await writeProjectFields(gh, project.id, changes.map(({ write }) => write), writesOptionsOf(options));
  const warnings = [
    ...refused.map(notRefreshedWarning),
    ...(writes.rateLimited
      ? [rateLimitWarning(writes.notUpdated)]
      : []),
    ...skipped.map(skippedFieldWarning),
  ];
  const notFilled = notFilledOf(known, { repository, present, refused, unwritten: unwrittenIssues(changes, writes) });
  return { kind: 'refreshed', project: ref, changes, writes, missing, skipped, refused, notFilled, warnings };
}

/**
 * Brings the project's items for `issues`, and those `widening` adds, in
 * step with what rafa reads of them, writing only the values that differ;
 * with no `board.project.number` it sends no call. The four failures of
 * the spec's "What can go wrong" table, and each issue whose facts could
 * not be read, are answered in `warnings`, never thrown. See the module
 * note.
 *
 * `known` holds the items of issues just added, which the refresh reads
 * beside the project's listing, so an issue whose item the listing does
 * not show yet is filled all the same; each one it did not fill is
 * answered in `notFilled` with its reason.
 *
 * Throws a `RangeError`, having sent nothing, for an entry of `issues` or
 * of `widening.membersOf`, or the issue of a known item, that is not a
 * positive whole number.
 */
export async function refreshProjectItems(
  options: RefreshOptions,
  issues: readonly number[],
  widening: RefreshWidening = {},
  known: readonly KnownItem[] = [],
): Promise<ProjectRefresh> {
  const { config, gh } = options;
  const numbers = issueNumbers(issues);
  const membersOf = issueNumbers(widening.membersOf ?? []);
  // Read for its refusal alone: a known item is matched by its own content, never by this list.
  issueNumbers(known.map(({ content }) => content.number));
  const widened: RefreshWidening = {
    membersOf,
    shiftedRanks: widening.shiftedRanks === true,
    everyItem: widening.everyItem === true,
    openIssues: widening.openIssues === true,
  };
  if (config.boardProjectNumber === null) return { kind: 'skipped', reason: 'no-project', warnings: [] };
  if (numbers.length === 0 && !widens(widened)) return { kind: 'skipped', reason: 'no-issues', warnings: [] };

  const repository = await readBoardRepository(gh);
  const ref: ProjectRef = { owner: repository.split('/')[0] ?? '', number: config.boardProjectNumber };
  try {
    return await refreshOn(options, repository, ref, { asked: numbers, widening: widened, known });
  } catch (error) {
    if (isMissingProjectScope(error)) return { kind: 'refused', reason: 'scope', project: ref, warnings: [scopeWarning()] };
    throw error;
  }
}
