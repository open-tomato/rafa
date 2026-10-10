/**
 * The rows `rafa issue list --roadmap` prints: the Roadmap issue's
 * lines, in its order, each joined to its issue on the board listing
 * and carrying the four readings the plain list has not got — `spec`,
 * `blocked by` and `has` (`.rafa/specs/rafa-123-rafa-issue-list-roadmap.md`),
 * and `refs` (`.rafa/specs/rafa-151-references-specs-bugs-are.md`).
 *
 * Every reading here is one another module already makes, called and
 * never respelled:
 *
 *  - the order: the current place's board ({@link readCurrentPlace}) read
 *    with {@link parseRoadmapBody} (`./roadmap.ts`); see "Which board";
 *  - `spec`: {@link findReadinessGaps} and {@link hasSpecReadyLabel}
 *    (`./readiness.ts`), the two functions `issue ready` calls;
 *  - `blocked by`: in `labels` mode {@link readBlockedBy} (`./blocked.ts`),
 *    with each blocker's state taken off the board listing rather than
 *    asked for; in `native` mode the relationships port's `blockersOf`
 *    (`./relations/port.ts`), each state off its `blockedBy` node;
 *  - `has`: {@link stubOfPlanFile} over the plan dir's file names, the
 *    branch scan {@link scanClaimBranches} with {@link branchClaims}, and
 *    the open pull request list with {@link closedIssuesIn};
 *  - `refs`: whatever {@link RoadmapRefs} answers, asked once for every
 *    selected line; `issue list --roadmap` hands in the reading `rafa
 *    doctor`'s references row makes (`src/commands/doctor-refs.ts`).
 *
 * Nothing here spawns or opens a file on its own account: `gh` arrives
 * through {@link BoardListing}, {@link RoadmapSearch},
 * {@link SpecIssueReader} and {@link OpenPullRequestLister}, git through
 * {@link GitRunner}, the plan dir through {@link PlanNames}, and the
 * saved copies under `specs.dir` through {@link RoadmapRefs}.
 * {@link createPlanDirNames} is the one filesystem read, made for the
 * caller that resolved the dir as `resolvePlansDir`
 * (`src/commands/plan/plan-files.ts`) resolves it: `issue list
 * --roadmap` takes `plan.dir` off the config it already loaded and
 * hands it to `plansDirAt`. This module never loads a config.
 *
 * ## Which board
 *
 * The DEFAULT board is found first, by {@link resolveDefaultBoard}
 * (`./boards.ts`), so `roadmap.issue`, the lowest-numbered `type:roadmap`
 * board or the title search names it exactly as `plan create --next`
 * finds it, and its refusals stay this reading's. The board whose lines
 * are read is then the CURRENT PLACE's, {@link readCurrentPlace}: with
 * {@link RoadmapRowsOptions.root} handed in and a position file there,
 * `resolvePlace` (`./place.ts`) over the one board listing, which the
 * rows then read again from the kept answer rather than asking twice.
 * With no root, or no position file, the default board is read as it
 * was before positions, the listing asked after the Roadmap as before;
 * a position whose place no longer stands falls back to the default
 * board by `resolvePlace`'s own rule. Each notice it gives but the
 * absent-file one is a warning, ahead of the rows' own, and so is a
 * listing that failed, since the default board is then read without
 * the position being weighed.
 *
 * ## What is read, and how often
 *
 * One listing of the `type:roadmap` boards, one Roadmap read (`gh issue
 * view`, after at most one title search, spent as
 * {@link resolveDefaultBoard} spends it), one board listing, one branch
 * scan and at most one open pull request list, whatever the number of
 * lines. The
 * spec allows one `gh` read of the board and one of the Roadmap body;
 * the pull request list is the `has` column's own and is the reading
 * `plan create --next` already spends for the same question.
 *
 * The Roadmap's AUTHOR is not weighed here, as `plan create --next`
 * weighs it through its `inspectRoadmap` seam: that check guards a
 * session from being pointed at an issue of someone else's choosing,
 * and a listing points nothing anywhere.
 *
 * ## Which lines
 *
 * The UNTICKED lines, in body order; `all` keeps the ticked ones in
 * their places too. A line naming an issue twice is kept twice, as
 * {@link parseRoadmapBody} keeps it. A closed issue on an unticked line
 * stays: the tick is what the Roadmap says, and a row that disappeared
 * on close would hide a list that needs its tick.
 *
 * The lines need not be the Roadmap's. {@link readRoadmapRows} finds and
 * reads the Roadmap and hands its lines to {@link readLineRows}, which
 * makes every reading below over whatever lines it is handed, the same
 * selection applied; `rafa epics` hands it one epic's lines, its
 * checklist then its label-only members (`src/commands/epic/show.ts`). Only
 * the Roadmap read is `readRoadmapRows`' own, so only it can reject.
 *
 * ## The spec column
 *
 * {@link SpecReading.kind}, in the order it is decided:
 *
 *  - `stale-label` — labelled `spec:ready` and the body has gaps; spelled
 *    `label: ready, gate: gaps`, so a label that outlived its body shows.
 *  - `ready` — labelled, and the body has no gap: both checks pass.
 *  - `unlabelled` — no gap and no label; spelled `label: none, gate:
 *    ready`. The spec names the label-and-reading disagreement in one
 *    direction only; this is the other direction, spelled the same way,
 *    because printing it as `ready` would claim a check that did not
 *    pass and printing `gaps:` would name no heading.
 *  - `outline` — not labelled, and fewer than {@link OUTLINE_HEADINGS} of
 *    the template's headings are present.
 *  - `gaps` — anything else: `gaps: <headings>`, each heading a gap
 *    names, once, in the gap list's own order.
 *
 * ## The blocked by column
 *
 * Read in the mode {@link RoadmapRowsOptions.relations} answers,
 * `labels` when it is left out, and only in that mode: a `native` board's
 * `Blocked by:` lines, and a `labels` board's `blockedBy` links, are
 * `rafa doctor`'s to name.
 *
 * In `labels` mode, the port is not asked. The column is the first
 * `Blocked by:` line, read with the board's numbers as
 * `known`. Each local blocker is `#n open` or `#n closed` by the
 * listing's own state, and `#n unknown` when the listing has no such
 * issue; each `owner/repo#n` is printed as written with state
 * `unknown`, since this board cannot answer for another. The line is
 * read whatever the labels say and whatever kind the reading is: the
 * column shows what the line NAMES, and {@link RoadmapRow.blocked}
 * carries the reading itself for a caller that reports faults. The
 * port's `labels` reading is not this one: it reads a line only under
 * `spec:blocked` and without the board's numbers, so asking it would
 * change what the column prints.
 *
 * In `native` mode the column is the port's one reading over the
 * listing: each `blockedBy` node, in the order `gh` answered them, `#n`
 * on this board and `owner/name#n` on another, each `open` or `closed`
 * as its node reads, whatever it closed as. Nothing is asked per
 * blocker, and a foreign blocker's state is read as a local one's is.
 * There is no line, so {@link RoadmapRow.blocked} is null. A node list
 * `gh` cut short ({@link BlockersReading} `truncated`) is one warning
 * per issue naming GitHub's count, since the column names only the
 * nodes answered.
 *
 * ## The has column
 *
 * `plan` when the plan dir holds a `PLAN-<stub>.md` whose stub is
 * `rafa-<n>` or opens `rafa-<n>-`, the name `plan create` writes; a
 * tracker copy alone is not a plan. `branch` when a scanned ref claims
 * the issue. `pr #n` for each open pull request whose body closes it,
 * in the list's order. The three are printed in that order.
 *
 * ## The refs column
 *
 * For a line whose issue has a saved copy under `specs.dir`, how many
 * of the references that copy names read `suspect` or `dangling`, one
 * number, `0` for a clean copy; two copies of one issue are summed. A
 * line with no saved copy has no {@link RefsCell}, and its cell is
 * empty. `unknown` references are carried in {@link RefsCell.unknown}
 * for json mode and not counted: they could not be checked, and a
 * number counting them would claim a fault nobody measured. A copy whose
 * references could not be read makes the cell `?`, since the count
 * would be short by what was not read, and its reason is a warning
 * naming `rafa issue check <n>` (`issueCheckCommand`,
 * `src/refs/check-command.ts`). The reading writes nothing: a
 * reference a copy keeps no stamp for is compared as `rafa issue check`
 * compares it, and is not stamped here.
 *
 * With {@link RoadmapRowsOptions.refsWhen} `plain`, the column is read
 * only when no selected line names an epic: a roadmap of epics prints no
 * `refs` column anywhere (`src/commands/issue/roadmap-epic-table.ts`), and
 * the reading is the slowest thing the roadmap does, since each saved
 * copy's symbols are confirmed by `ts-symbols`. Left out, or `always`, it
 * is read for every selected line, as json mode and `rafa epics` need.
 *
 * ## When something cannot be read
 *
 * A Roadmap that cannot be found or read REJECTS: there is no order to
 * print. Everything after it degrades to a sentence in
 * {@link RoadmapRows.warnings} and an emptier column, and never to a
 * throw, because the listing is a reading and a partial one is still
 * worth printing:
 *
 *  - The board listing failing is the spec's "board unreachable": one
 *    warning, every row kept in the Roadmap's order, `issue`, `spec`
 *    and `blocked` null. The open pull request list is then NOT asked
 *    — it goes to the same GitHub the listing just failed to reach, and
 *    a second warning about one outage is noise — so `has` holds what
 *    the plan dir and the branch scan answer.
 *  - A roadmap line whose issue the listing does not hold: that row's
 *    `issue`, `spec` and `blocked` are null, with no warning, since the
 *    listing has a limit and the issue may sit past it.
 *  - The branch scan's problems are carried through as warnings, as
 *    `plan create --next` warns them (`./spec-source-roadmap.ts`).
 *  - The pull request list or the plan dir failing: one warning each,
 *    and no `pr` or `plan` marks.
 *  - {@link RoadmapRefs} rejecting: one warning, and every `refs` cell
 *    empty. The saved copies are local, so the board being unreachable
 *    does not stop them being read.
 *
 * The one throw past the Roadmap read is the `native` adapter's
 * `TypeError` for a listing read without the native fields: that is a
 * listing asked for in the wrong mode, not a reading that failed, and
 * reading it as a board with no blocker would hide it.
 */
import type { BlockedReading } from './blocked.js';
import type { BoardLister } from './boards.js';
import type { EpicRelations } from './epics.js';
import type { SpecIssueReader } from './issue.js';
import type { ReadinessGap } from './readiness.js';
import type { BlockersReading } from './relations/port.js';
import type { BoardIssue, BoardIssueState, BoardListing } from './roadmap-board.js';
import type { OpenPullRequestLister, RoadmapLine, RoadmapPullRequest, RoadmapSearch } from './roadmap.js';
import type { GitRunner } from '../pr/git.js';
import type { Place } from '../project/position.js';

import { existsSync, readdirSync } from 'node:fs';

import { messageOf } from '../config-sections.js';
import { stubOfPlanFile } from '../plan/plan-files.js';
import { positionFilePath } from '../project/position.js';
import { issueCheckCommand } from '../refs/check-command.js';

import { readBlockedBy } from './blocked.js';
import { resolveDefaultBoard } from './boards.js';
import { boardId } from './naming.js';
import { resolvePlace } from './place.js';
import { findReadinessGaps, hasSpecReadyLabel, TEMPLATE_HEADINGS } from './readiness.js';
import {
  branchClaims,
  closedIssuesIn,
  parseRoadmapBody,
  scanClaimBranches,
} from './roadmap.js';

/** An unlabelled body with fewer template headings than this reads `outline`. */
export const OUTLINE_HEADINGS = 3;

/** What a blocker's state is printed as when the board cannot answer for it. */
export const UNKNOWN_STATE = 'unknown';

/** What the spec column read a body as; see the module note for the order. */
export type SpecReadingKind = 'ready' | 'gaps' | 'outline' | 'stale-label' | 'unlabelled';

/** One issue's `spec` column, as data. */
export interface SpecReading {
  /** What it read as. */
  readonly kind: SpecReadingKind;
  /** Whether the issue carries `spec:ready`. */
  readonly labelled: boolean;
  /** Every gap {@link findReadinessGaps} answered, in its order. */
  readonly gaps: readonly ReadinessGap[];
  /** How many of {@link TEMPLATE_HEADINGS} the body carries. */
  readonly headings: number;
}

/** One blocker in the `blocked by` column. */
export interface BlockerCell {
  /** `#24`, or `owner/repo#12` as the line wrote it. */
  readonly reference: string;
  /** `open` or `closed` off the board, else `unknown`. */
  readonly state: 'open' | 'closed' | typeof UNKNOWN_STATE;
}

/** One mark in the `has` column. */
export type HasMark =
  | { readonly kind: 'plan' }
  | { readonly kind: 'branch'; readonly ref: string }
  | { readonly kind: 'pr'; readonly number: number };

/** One row: a Roadmap line and what was read about its issue. */
export interface RoadmapRow {
  /** The line, as {@link parseRoadmapBody} read it. */
  readonly line: RoadmapLine;
  /** The issue on the board, or null when the listing failed or does not hold it. */
  readonly issue: BoardIssue | null;
  /** The `spec` column, or null with no issue to read. */
  readonly spec: SpecReading | null;
  /** The `Blocked by:` reading, or null with no issue to read, and always in `native` mode. */
  readonly blocked: BlockedReading | null;
  /** The `blocked by` column: empty with no issue or no line. */
  readonly blockers: readonly BlockerCell[];
  /** The `has` column, in the order plan, branch, pull requests. */
  readonly has: readonly HasMark[];
  /** The `refs` column, or null when the issue has no saved copy or the copies could not be listed. */
  readonly refs: RefsCell | null;
}

/** One issue's saved copies, counted by what their references read: the `refs` column, as data. */
export interface RefsCell {
  /** How many saved copies of the issue were found. */
  readonly copies: number;
  /** References reading `suspect`, over every copy. */
  readonly suspect: number;
  /** References reading `dangling`, over every copy. */
  readonly dangling: number;
  /** References reading `unknown`, over every copy; carried, and not printed in the cell. */
  readonly unknown: number;
  /** Why each copy whose references could not be read failed; the cell is `?` when any did. */
  readonly errors: readonly string[];
}

/**
 * The `refs` column's reading: for each of `issues`, its saved copies
 * counted, and no entry for an issue with no saved copy. Rejects only
 * when the copies cannot be listed at all.
 */
export type RoadmapRefs = (issues: readonly number[]) => Promise<ReadonlyMap<number, RefsCell>>;

/** What {@link readRoadmapRows} answers. */
export interface RoadmapRows {
  /** The Roadmap issue the lines were read from. */
  readonly roadmap: number;
  /** One row per selected line, in the Roadmap's order. */
  readonly rows: readonly RoadmapRow[];
  /** A sentence per reading that failed; the caller prints each as a warning. */
  readonly warnings: readonly string[];
}

/** What {@link readLineRows} answers: {@link RoadmapRows} with no Roadmap, since the lines were handed in. */
export type LineRows = Omit<RoadmapRows, 'roadmap'>;

/** The file names in the plan dir; the seam the `plan` mark reads through. */
export type PlanNames = () => readonly string[];

/** What {@link readRoadmapRows} is made with. */
export interface RoadmapRowsOptions {
  /** `roadmap.issue` as the caller resolved it, or null for the labelled boards and then the title search. */
  readonly configured: number | null;
  /** The labelled boards, listed once. */
  readonly listBoards: BoardLister;
  /** The title search, asked as {@link resolveDefaultBoard} asks it. */
  readonly search: RoadmapSearch;
  /** Reads the Roadmap issue; asked once. */
  readonly issues: SpecIssueReader;
  /** The one board listing. */
  readonly board: BoardListing;
  /** The git the branch scan runs. */
  readonly git: GitRunner;
  /** The remote the branch scan asks; `origin` when left out. */
  readonly remote?: string;
  /** The open pull requests, asked once and only when the board answered. */
  readonly pullRequests: OpenPullRequestLister;
  /** The plan dir's file names. */
  readonly planNames: PlanNames;
  /** The saved copies' references, asked once for every selected line. */
  readonly refs: RoadmapRefs;
  /** When the refs column is read: `always` (left out), or `plain`, only for lines naming no epic; see the module note. */
  readonly refsWhen?: 'always' | 'plain';
  /** Keep the ticked lines too; `--all`. */
  readonly all?: boolean;
  /** The project root whose position file names the current place; left out, the default board is read. */
  readonly root?: string;
  /** The board's relationships, which read the `blocked by` column; `labels` mode when left out. See the module note. */
  readonly relations?: EpicRelations;
}

/** What {@link readLineRows} is made with: every seam of {@link RoadmapRowsOptions} but the five the Roadmap is found through. */
export type LineRowsOptions = Omit<RoadmapRowsOptions, 'configured' | 'listBoards' | 'search' | 'issues' | 'root'>;

/** What {@link readCurrentPlace} answers. */
export interface CurrentPlaceReading {
  /** The current place, or null with no position file or with the listing failed. */
  readonly place: Place | null;
  /** A sentence per notice to warn, in the order given; see the module note. */
  readonly notices: readonly string[];
}

/** The warning a failed listing gives while a position file is there. */
export function unweighedPositionNotice(defaultBoard: number): string {
  return `the board could not be listed, so the position file was not weighed and the default board #${String(defaultBoard)} is read`;
}

/**
 * The current place under `root`, read by `resolvePlace` over `board`'s
 * listing with `defaultBoard` as the fallback's board; a null place with
 * no notice when `root` holds no position file, and without asking
 * `board`. Never rejects: a failed listing is a null place and one
 * notice. See the module note's "Which board".
 */
export async function readCurrentPlace(root: string, board: BoardListing, defaultBoard: number): Promise<CurrentPlaceReading> {
  if (!existsSync(positionFilePath(root))) return Object.freeze({ place: null, notices: Object.freeze([]) });
  let listing: readonly BoardIssue[];
  try {
    listing = await board();
  } catch {
    return Object.freeze({ place: null, notices: Object.freeze([unweighedPositionNotice(defaultBoard)]) });
  }
  const resolved = await resolvePlace({ root, listing, defaultBoard: () => Promise.resolve(defaultBoard) });
  const notices = resolved.notices
    .filter((notice) => notice.kind === 'lost' || notice.reason !== 'absent')
    .map((notice) => notice.message);
  return Object.freeze({ place: resolved.current, notices: Object.freeze(notices) });
}

/** `read`, asked on the first call only; every call answers or rejects as the first did. */
function keptListing(read: BoardListing): BoardListing {
  let kept: ReturnType<BoardListing> | null = null;
  return () => {
    kept ??= read();
    return kept;
  };
}

/** True when `error` is Node's answer for a path that does not exist. */
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * The names in `dir`, read on each call. A dir that does not exist
 * answers no names — a project that has planned nothing yet — and any
 * other failure throws, for {@link readRoadmapRows} to warn about.
 */
export function createPlanDirNames(dir: string): PlanNames {
  return () => {
    try {
      return Object.freeze(readdirSync(dir));
    } catch (error) {
      if (isMissing(error)) return Object.freeze([]);
      throw error;
    }
  };
}

/** The `spec` column over one issue's labels and body; see the module note. */
export function readSpecColumn(labels: readonly string[], body: string): SpecReading {
  const gaps = findReadinessGaps(body);
  const labelled = hasSpecReadyLabel(labels);
  const missing = gaps.filter((gap) => gap.kind === 'missing-heading').length;
  const headings = TEMPLATE_HEADINGS.length - missing;
  const kind = specKind(labelled, gaps.length === 0, headings);
  return Object.freeze({ kind, labelled, gaps: Object.freeze([...gaps]), headings });
}

/** Which of the five the two checks and the heading count make. */
function specKind(labelled: boolean, complete: boolean, headings: number): SpecReadingKind {
  if (labelled) {
    return complete
      ? 'ready'
      : 'stale-label';
  }
  if (complete) return 'unlabelled';
  return headings < OUTLINE_HEADINGS
    ? 'outline'
    : 'gaps';
}

/** The `spec` cell as printed: `ready`, `gaps: Design, …`, `outline` or a disagreement. */
export function specText(reading: SpecReading | null): string {
  if (reading === null) return '';
  if (reading.kind === 'ready') return 'ready';
  if (reading.kind === 'outline') return 'outline';
  if (reading.kind === 'stale-label') return 'label: ready, gate: gaps';
  if (reading.kind === 'unlabelled') return 'label: none, gate: ready';
  const headings = [...new Set(reading.gaps.map((gap) => gap.heading))];
  return `gaps: ${headings.join(', ')}`;
}

/** A board state as a cell spells it. */
function stateWord(state: BoardIssueState | undefined): BlockerCell['state'] {
  if (state === undefined) return UNKNOWN_STATE;
  return state === 'OPEN'
    ? 'open'
    : 'closed';
}

/** The `blocked by` column for one reading, each blocker's state off `states`. */
export function readBlockersColumn(
  reading: BlockedReading,
  states: ReadonlyMap<number, BoardIssueState>,
): readonly BlockerCell[] {
  const local = reading.blockers.map((id): BlockerCell => ({
    reference: `#${String(id)}`,
    state: stateWord(states.get(id)),
  }));
  const foreign = reading.foreign.map((reference): BlockerCell => ({ reference, state: UNKNOWN_STATE }));
  return Object.freeze([...local, ...foreign]);
}

/** The `blocked by` column for one `native` reading: each node in `gh`'s order, its state off the node. */
export function readNativeBlockersColumn(reading: BlockersReading): readonly BlockerCell[] {
  if (reading.kind !== 'blocked') return Object.freeze([]);
  return Object.freeze(reading.blockers.map((blocker): BlockerCell => Object.freeze({
    reference: `${blocker.repository ?? ''}#${String(blocker.number)}`,
    state: stateWord(blocker.state ?? undefined),
  })));
}

/** The warning a `native` reading `gh` cut short is carried as, or null when it was read whole. */
export function truncatedBlockersWarning(reading: BlockersReading): string | null {
  if (reading.kind !== 'blocked' || reading.truncated === undefined) return null;
  return `#${String(reading.issue)} is blocked by ${String(reading.truncated.total)} issues, more than the board read answered,`
    + ` so its blocked by column names the first ${String(reading.blockers.length)}`;
}

/** The `blocked by` cell as printed: `#24 open, #26 closed`. */
export function blockersText(cells: readonly BlockerCell[]): string {
  return cells.map((cell) => `${cell.reference} ${cell.state}`).join(', ');
}

/** The `has` cell as printed: `plan, branch, pr #40`. */
export function hasText(marks: readonly HasMark[]): string {
  return marks.map((mark) => {
    if (mark.kind === 'pr') return `pr #${String(mark.number)}`;
    return mark.kind;
  }).join(', ');
}

/** The `refs` cell as printed: the suspect and dangling count, `?` when a copy was not read, empty with no copy. */
export function refsText(cell: RefsCell | null): string {
  if (cell === null) return '';
  if (cell.errors.length > 0) return '?';
  return String(cell.suspect + cell.dangling);
}

/** The warning each copy whose references could not be read is carried as. */
function refsWarnings(cells: ReadonlyMap<number, RefsCell>): readonly string[] {
  return [...cells].flatMap(([issue, cell]) => cell.errors.map((error) => (
    `the references of #${String(issue)}'s saved copy could not be read, so its refs cell is ?:`
    + ` ${error} — run ${issueCheckCommand(issue)}`
  )));
}

/** True when a plan file in `names` is issue `issue`'s. */
export function hasPlanFor(names: readonly string[], issue: number): boolean {
  const id = boardId(issue);
  return names.some((name) => {
    const stub = stubOfPlanFile(name);
    return stub !== null && (stub === id || stub.startsWith(`${id}-`));
  });
}

/** Everything the `has` column is read from, taken once for a whole listing. */
interface HasSources {
  readonly planNames: readonly string[];
  readonly refs: readonly string[];
  readonly pulls: readonly RoadmapPullRequest[];
}

/** The `has` column for one issue. */
function readHasColumn(issue: number, sources: HasSources): readonly HasMark[] {
  const plan: readonly HasMark[] = hasPlanFor(sources.planNames, issue)
    ? [{ kind: 'plan' }]
    : [];
  const ref = sources.refs.find((candidate) => branchClaims(candidate, issue));
  const branch: readonly HasMark[] = ref === undefined
    ? []
    : [{ kind: 'branch', ref }];
  const pulls = sources.pulls
    .filter((pull) => closedIssuesIn(pull.body).includes(issue))
    .map((pull): HasMark => ({ kind: 'pr', number: pull.number }));
  return Object.freeze([...plan, ...branch, ...pulls]);
}

/** The board listing, or null with the warning its failure is carried as. */
async function listBoard(board: BoardListing): Promise<{ issues: readonly BoardIssue[] | null; warning: string | null }> {
  try {
    return { issues: await board(), warning: null };
  } catch (error) {
    return {
      issues: null,
      warning: `the board could not be listed, so the spec and blocked by columns are empty: ${messageOf(error)}`,
    };
  }
}

/** What `read` answers, or `fallback` with the warning `what` failing is carried as. */
async function readOrWarn<T>(
  read: () => Promise<T> | T,
  fallback: T,
  what: string,
): Promise<{ value: T; warning: string | null }> {
  try {
    return { value: await read(), warning: null };
  } catch (error) {
    return { value: fallback, warning: `${what}: ${messageOf(error)}` };
  }
}

/** The listing indexed once for a whole listing: each issue and each state by number. */
interface BoardView {
  readonly byNumber: ReadonlyMap<number, BoardIssue>;
  readonly states: ReadonlyMap<number, BoardIssueState>;
  readonly known: ReadonlySet<number>;
  /** The port's `blockersOf` over the listing in `native` mode; null in `labels` mode, which reads the line. */
  readonly blockersOf: ((issue: BoardIssue) => BlockersReading) | null;
}

/** The listing indexed, or null when it failed; read through `relations` when they are `native`. */
function viewOf(issues: readonly BoardIssue[] | null, relations: EpicRelations | undefined): BoardView | null {
  if (issues === null) return null;
  return {
    byNumber: new Map(issues.map((issue) => [issue.number, issue])),
    states: new Map(issues.map((issue) => [issue.number, issue.state])),
    known: new Set(issues.map((issue) => issue.number)),
    blockersOf: relations === undefined || relations.mode === 'labels'
      ? null
      : relations.read(issues).blockersOf,
  };
}

/** One warning per issue on `rows` whose `native` reading was cut short, each issue once. */
function truncationWarnings(rows: readonly RoadmapRow[], board: BoardView | null): readonly string[] {
  const blockersOf = board?.blockersOf ?? null;
  if (blockersOf === null) return [];
  const issues = new Map(rows.flatMap((row) => row.issue === null
    ? []
    : [[row.issue.number, row.issue] as const]));
  return [...issues.values()]
    .map((issue) => truncatedBlockersWarning(blockersOf(issue)))
    .filter((warning): warning is string => warning !== null);
}

/** One row over the board, when there is one. */
function rowOf(line: RoadmapLine, board: BoardView | null, has: readonly HasMark[], refs: RefsCell | null): RoadmapRow {
  const issue = board?.byNumber.get(line.issue);
  if (board === null || issue === undefined) {
    return Object.freeze({ line, issue: null, spec: null, blocked: null, blockers: Object.freeze([]), has, refs });
  }
  if (board.blockersOf !== null) {
    return Object.freeze({
      line,
      issue,
      spec: readSpecColumn(issue.labels, issue.body),
      blocked: null,
      blockers: readNativeBlockersColumn(board.blockersOf(issue)),
      has,
      refs,
    });
  }
  const blocked = readBlockedBy(issue.number, issue.body, board.known);
  return Object.freeze({
    line,
    issue,
    spec: readSpecColumn(issue.labels, issue.body),
    blocked,
    blockers: readBlockersColumn(blocked, board.states),
    has,
    refs,
  });
}

/**
 * `lines` as rows, in their order: the unticked ones, or every one with
 * `all`. Never rejects on a failed reading: each is carried as a warning,
 * as the module note holds, which also holds the one `native` refusal. {@link readRoadmapRows} hands in the Roadmap's
 * lines, and `rafa epics` an epic's (`src/commands/epic/show.ts`).
 */
export async function readLineRows(lines: readonly RoadmapLine[], options: LineRowsOptions): Promise<LineRows> {
  const selected = lines.filter((line) => options.all === true || !line.ticked);
  const listed = await listBoard(options.board);
  const scan = scanClaimBranches(options.git, options.remote);
  const pulls = listed.issues === null
    ? { value: [], warning: null }
    : await readOrWarn(options.pullRequests, [], 'the open pull requests could not be listed, so no pr is shown');
  const plans = await readOrWarn(options.planNames, [], 'the plan dir could not be read, so no plan is shown');
  const board = viewOf(listed.issues, options.relations);
  const issues = [...new Set(selected.map((line) => line.issue))];
  const namesEpic = board !== null && issues.some((issue) => board.byNumber.get(issue)?.type === 'epic');
  const refs = options.refsWhen === 'plain' && namesEpic
    ? { value: new Map<number, RefsCell>(), warning: null }
    : await readOrWarn(
      () => options.refs(issues),
      new Map<number, RefsCell>(),
      'the saved copies could not be read, so the refs column is empty',
    );

  const sources: HasSources = { planNames: plans.value, refs: scan.refs, pulls: pulls.value };
  const rows = selected.map((line) => rowOf(line, board, readHasColumn(line.issue, sources), refs.value.get(line.issue) ?? null));

  const warnings = [
    listed.warning,
    ...truncationWarnings(rows, board),
    ...scan.problems,
    pulls.warning,
    plans.warning,
    refs.warning,
    ...refsWarnings(refs.value),
  ].filter((warning): warning is string => warning !== null);
  return Object.freeze({ rows: Object.freeze(rows), warnings: Object.freeze(warnings) });
}

/**
 * The current board's lines as rows, in its order: the unticked ones, or
 * every one with `all`. Rejects when the default board cannot be found
 * — {@link resolveDefaultBoard}'s refusals included — or the board read
 * cannot be, and otherwise answers {@link readLineRows} over its lines,
 * carrying each failed reading as a warning; the module note holds which
 * board is read and which reading degrades to what.
 */
export async function readRoadmapRows(options: RoadmapRowsOptions): Promise<RoadmapRows> {
  const { number: fallback } = await resolveDefaultBoard({
    configured: options.configured,
    listBoards: options.listBoards,
    search: options.search,
  });
  const board = keptListing(options.board);
  const current = options.root === undefined
    ? null
    : await readCurrentPlace(options.root, board, fallback);
  const roadmap = current?.place?.board ?? fallback;
  const lines = parseRoadmapBody((await options.issues(roadmap)).body);
  const { rows, warnings } = await readLineRows(lines, { ...options, board });
  return Object.freeze({ roadmap, rows, warnings: Object.freeze([...current?.notices ?? [], ...warnings]) });
}
