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
 *     no item is answered in {@link ProjectRefreshed.missing} and nothing
 *     is read or written for it, since adding an item is its caller's
 *     step (`rafa issue create`, `rafa board sync`);
 *  4. for the issues on the project, their facts (`./facts.ts`);
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
 * The widened issues follow the ones asked for, each once; a member with
 * no item on the project is answered in {@link ProjectRefreshed.missing}.
 *
 * ## What it writes
 *
 * The five values come out of the rules (`./rules.ts`) through
 * `./refresh-values.ts`, which compares them with what each item holds
 * and answers only the values that differ; those, and nothing else, go
 * to `writeProjectFields` (`./writes.ts`), batched and paced. A second
 * refresh over unchanged facts therefore sends no write. A field the
 * project does not hold as the template has it is skipped and named in
 * {@link ProjectRefreshed.skipped}; the other fields are still written.
 *
 * ## Failures, answered as warning lines
 *
 * The four rows of the spec's "What can go wrong" table are never
 * thrown: each is answered in the refresh's `warnings`, one line naming
 * its fix (`./refresh-warnings.ts`), for the caller to print after its
 * own output while keeping its own exit code. A refresh with nothing to
 * warn of answers an empty list.
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
 * no default board rejects as `resolveDefaultBoard` does.
 */
import type { IssueFacts } from './facts.js';
import type { FieldMismatch, MatchedField, Project, ProjectItem, ProjectPort, ProjectRef } from './port.js';
import type { ProjectChange, RefreshBoard } from './refresh-values.js';
import type { ProjectWritesResult, ProjectWritesSeams } from './writes.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { RafaConfig } from '../../config.js';
import type { BoardIssue } from '../roadmap-board.js';
import type { RoadmapSearch } from '../roadmap.js';

import { readBoardRepository } from '../../commands/epic/move-native.js';
import { createGhBoardLister, resolveDefaultBoard } from '../boards.js';
import { readEpics } from '../epics.js';
import { selectBoardRelations } from '../relations/select.js';
import { createGhBoardListing } from '../roadmap-board.js';
import { createGhRoadmapSearch, parseRoadmapBody } from '../roadmap.js';

import { readIssueFacts } from './facts.js';
import { createGhProjectPort } from './gh.js';
import { matchProjectFields } from './port.js';
import { projectChangesOf, projectValuesOf } from './refresh-values.js';
import {
  isMissingProjectScope,
  notFoundWarning,
  rateLimitWarning,
  scopeWarning,
  skippedFieldWarning,
} from './refresh-warnings.js';
import { rankOf, ranksOf } from './rules.js';
import { writeProjectFields } from './writes.js';

/** What every refusal of this module opens with. */
const PREFIX = 'board project refresh';

/** The config keys the refresh reads. */
export type RefreshConfig = Pick<RafaConfig, 'boardProjectNumber' | 'boardRelationships' | 'roadmapIssue' | 'releaseFragments'>;

/** What {@link refreshProjectItems} is made with. */
export interface RefreshOptions {
  readonly config: RefreshConfig;
  /** Runs every `gh` call the refresh sends. */
  readonly gh: GhRunner;
  /** The pause between two write requests; `Bun.sleep` when left out. */
  readonly sleep?: ProjectWritesSeams['sleep'];
}

/** What a refresh adds to the issues it is asked for; see the module note. */
export interface RefreshWidening {
  /** The epics whose members, as the refresh's own board reading reads them, are refreshed too. */
  readonly membersOf?: readonly number[];
  /** True to refresh too every item whose Rank on the project is not the one the home board's order gives. */
  readonly shiftedRanks?: boolean;
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
  /** Every value that differed, by issue in the order asked and widened, then in field order. */
  readonly changes: readonly ProjectChange[];
  /** How the writes of {@link ProjectRefreshed.changes} went. */
  readonly writes: ProjectWritesResult;
  /** The issues asked for, or added as an epic's members, that have no item on the project, in that order. */
  readonly missing: readonly number[];
  /** The template's fields the project does not hold as expected, none written. */
  readonly skipped: readonly FieldMismatch[];
  /** The rate-limit line when the writes were refused, then one line per skipped field. */
  readonly warnings: readonly string[];
}

/** What {@link refreshProjectItems} answers. */
export type ProjectRefresh = ProjectRefreshSkipped | ProjectRefreshNotFound | ProjectRefreshRefused | ProjectRefreshed;

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

/** The home board's row: the listing's, else the labelled boards'; throws when neither holds it. */
function homeRow(number: number, listing: readonly BoardIssue[], boards: readonly BoardIssue[]): BoardIssue {
  const row = listing.find((issue) => issue.number === number) ?? boards.find((issue) => issue.number === number);
  if (row === undefined) throw new Error(`${PREFIX}: the default board #${String(number)} is not on the board listing`);
  return row;
}

/** The board every issue's values are computed against, read once; see the module note. */
async function readRefreshBoard(config: RefreshConfig, gh: GhRunner, repository: string): Promise<RefreshBoard> {
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
  };
}

/** The changes the issues on the project need, by issue in the order asked; `read` is the board when it was read already. */
async function changesFor(
  options: RefreshOptions,
  repository: string,
  project: Project,
  present: ReadonlyMap<number, ProjectItem>,
  read: RefreshBoard | null,
): Promise<readonly ProjectChange[]> {
  const { config, gh } = options;
  const numbers = [...present.keys()];
  const facts: ReadonlyMap<number, IssueFacts> = await readIssueFacts({ gh, fragments: config.releaseFragments }, numbers);
  const board = read ?? await readRefreshBoard(config, gh, repository);
  const { matched } = matchProjectFields(project);
  return numbers.flatMap((issue) => {
    const read = facts.get(issue);
    const item = present.get(issue);
    if (read === undefined || item === undefined) throw new Error(`${PREFIX}: no facts were read for #${String(issue)}`);
    return projectChangesOf(issue, item, projectValuesOf(read, board), matched);
  });
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
  board: RefreshBoard,
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
  return [...new Set([...numbers, ...members, ...shifted])];
}

/** True when `widening` asks for anything past the issues named. */
function widens(widening: RefreshWidening): boolean {
  return (widening.membersOf ?? []).length > 0 || widening.shiftedRanks === true;
}

/** The refresh of `asked` on the project `ref` names, widened by `widening`, once the repository is read. */
async function refreshOn(
  options: RefreshOptions,
  repository: string,
  ref: ProjectRef,
  asked: readonly number[],
  widening: RefreshWidening,
): Promise<ProjectRefresh> {
  const { config, gh } = options;
  const port: ProjectPort = createGhProjectPort(gh);
  const project = await port.find(ref);
  if (project === null) return { kind: 'not-found', project: ref, warnings: [notFoundWarning(ref)] };

  const items = issueItems(await port.items(project.id), repository);
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
  const changes = present.size === 0
    ? []
    : await changesFor(options, repository, project, present, board);
  const writes = changes.length === 0
    ? NOTHING_WRITTEN
    : await writeProjectFields(gh, project.id, changes.map(({ write }) => write), options.sleep === undefined
      ? {}
      : { sleep: options.sleep });
  const warnings = [
    ...(writes.rateLimited
      ? [rateLimitWarning(writes.notUpdated)]
      : []),
    ...skipped.map(skippedFieldWarning),
  ];
  return { kind: 'refreshed', project: ref, changes, writes, missing, skipped, warnings };
}

/**
 * Brings the project's items for `issues`, and those `widening` adds, in
 * step with what rafa reads of them, writing only the values that differ;
 * with no `board.project.number` it sends no call. The four failures of
 * the spec's "What can go wrong" table are answered in `warnings`, never
 * thrown. See the module note.
 *
 * Throws a `RangeError`, having sent nothing, for an entry of `issues` or
 * of `widening.membersOf` that is not a positive whole number.
 */
export async function refreshProjectItems(
  options: RefreshOptions,
  issues: readonly number[],
  widening: RefreshWidening = {},
): Promise<ProjectRefresh> {
  const { config, gh } = options;
  const numbers = issueNumbers(issues);
  const membersOf = issueNumbers(widening.membersOf ?? []);
  const widened: RefreshWidening = { membersOf, shiftedRanks: widening.shiftedRanks === true };
  if (config.boardProjectNumber === null) return { kind: 'skipped', reason: 'no-project', warnings: [] };
  if (numbers.length === 0 && !widens(widened)) return { kind: 'skipped', reason: 'no-issues', warnings: [] };

  const repository = await readBoardRepository(gh);
  const ref: ProjectRef = { owner: repository.split('/')[0] ?? '', number: config.boardProjectNumber };
  try {
    return await refreshOn(options, repository, ref, numbers, widened);
  } catch (error) {
    if (isMissingProjectScope(error)) return { kind: 'refused', reason: 'scope', project: ref, warnings: [scopeWarning()] };
    throw error;
  }
}
