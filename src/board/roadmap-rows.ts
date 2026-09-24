/**
 * The rows `rafa issue list --roadmap` prints: the Roadmap issue's
 * lines, in its order, each joined to its issue on the board listing
 * and carrying the three readings the plain list has not got — `spec`,
 * `blocked by` and `has` (`.rafa/specs/rafa-123-rafa-issue-list-roadmap.md`).
 *
 * Every reading here is one another module already makes, called and
 * never respelled:
 *
 *  - the order: {@link resolveRoadmapIssue} and {@link parseRoadmapBody}
 *    (`./roadmap.ts`), so `roadmap.issue` or the title search names the
 *    issue exactly as `plan create --next` finds it;
 *  - `spec`: {@link findReadinessGaps} and {@link hasSpecReadyLabel}
 *    (`./readiness.ts`), the two functions `issue ready` calls;
 *  - `blocked by`: {@link readBlockedBy} (`./blocked.ts`), with each
 *    blocker's state taken off the board listing rather than asked for;
 *  - `has`: {@link stubOfPlanFile} over the plan dir's file names, the
 *    branch scan {@link scanClaimBranches} with {@link branchClaims}, and
 *    the open pull request list with {@link closedIssuesIn}.
 *
 * Nothing here spawns or opens a file on its own account: `gh` arrives
 * through {@link BoardListing}, {@link RoadmapSearch},
 * {@link SpecIssueReader} and {@link OpenPullRequestLister}, git through
 * {@link GitRunner}, and the plan dir through {@link PlanNames}.
 * {@link createPlanDirNames} is the one filesystem read, made for the
 * caller that resolved the dir as `resolvePlansDir`
 * (`src/commands/plan/plan-files.ts`) resolves it: `issue list
 * --roadmap` takes `plan.dir` off the config it already loaded and
 * hands it to `plansDirAt`. This module never loads a config.
 *
 * ## What is read, and how often
 *
 * One Roadmap read (`gh issue view`, after a title search only when
 * `roadmap.issue` names nothing), one board listing, one branch scan and
 * at most one open pull request list, whatever the number of lines. The
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
 * The first `Blocked by:` line, read with the board's numbers as
 * `known`. Each local blocker is `#n open` or `#n closed` by the
 * listing's own state, and `#n unknown` when the listing has no such
 * issue; each `owner/repo#n` is printed as written with state
 * `unknown`, since this board cannot answer for another. The line is
 * read whatever the labels say and whatever kind the reading is: the
 * column shows what the line NAMES, and {@link RoadmapRow.blocked}
 * carries the reading itself for a caller that reports faults.
 *
 * ## The has column
 *
 * `plan` when the plan dir holds a `PLAN-<stub>.md` whose stub is
 * `rafa-<n>` or opens `rafa-<n>-`, the name `plan create` writes; a
 * tracker copy alone is not a plan. `branch` when a scanned ref claims
 * the issue. `pr #n` for each open pull request whose body closes it,
 * in the list's order. The three are printed in that order.
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
 *    `plan create --next` warns them (`./spec-source.ts`).
 *  - The pull request list or the plan dir failing: one warning each,
 *    and no `pr` or `plan` marks.
 */
import type { BlockedReading } from './blocked.js';
import type { SpecIssueReader } from './issue.js';
import type { ReadinessGap } from './readiness.js';
import type { BoardIssue, BoardIssueState, BoardListing } from './roadmap-board.js';
import type { OpenPullRequestLister, RoadmapLine, RoadmapPullRequest, RoadmapSearch } from './roadmap.js';
import type { GitRunner } from '../pr/git.js';

import { readdirSync } from 'node:fs';

import { stubOfPlanFile } from '../commands/plan/plan-files.js';
import { messageOf } from '../config-sections.js';

import { readBlockedBy } from './blocked.js';
import { boardId } from './naming.js';
import { findReadinessGaps, hasSpecReadyLabel, TEMPLATE_HEADINGS } from './readiness.js';
import {
  branchClaims,
  closedIssuesIn,
  parseRoadmapBody,
  resolveRoadmapIssue,
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
  /** The `Blocked by:` reading, or null with no issue to read. */
  readonly blocked: BlockedReading | null;
  /** The `blocked by` column: empty with no issue or no line. */
  readonly blockers: readonly BlockerCell[];
  /** The `has` column, in the order plan, branch, pull requests. */
  readonly has: readonly HasMark[];
}

/** What {@link readRoadmapRows} answers. */
export interface RoadmapRows {
  /** The Roadmap issue the lines were read from. */
  readonly roadmap: number;
  /** One row per selected line, in the Roadmap's order. */
  readonly rows: readonly RoadmapRow[];
  /** A sentence per reading that failed; the caller prints each as a warning. */
  readonly warnings: readonly string[];
}

/** The file names in the plan dir; the seam the `plan` mark reads through. */
export type PlanNames = () => readonly string[];

/** What {@link readRoadmapRows} is made with. */
export interface RoadmapRowsOptions {
  /** `roadmap.issue` as the caller resolved it, or null for the title search. */
  readonly configured: number | null;
  /** The title search, asked only when `configured` is null. */
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
  /** Keep the ticked lines too; `--all`. */
  readonly all?: boolean;
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
}

/** The listing indexed, or null when it failed. */
function viewOf(issues: readonly BoardIssue[] | null): BoardView | null {
  if (issues === null) return null;
  return {
    byNumber: new Map(issues.map((issue) => [issue.number, issue])),
    states: new Map(issues.map((issue) => [issue.number, issue.state])),
    known: new Set(issues.map((issue) => issue.number)),
  };
}

/** One row over the board, when there is one. */
function rowOf(line: RoadmapLine, board: BoardView | null, has: readonly HasMark[]): RoadmapRow {
  const issue = board?.byNumber.get(line.issue);
  if (board === null || issue === undefined) {
    return Object.freeze({ line, issue: null, spec: null, blocked: null, blockers: Object.freeze([]), has });
  }
  const blocked = readBlockedBy(issue.number, issue.body, board.known);
  return Object.freeze({
    line,
    issue,
    spec: readSpecColumn(issue.labels, issue.body),
    blocked,
    blockers: readBlockersColumn(blocked, board.states),
    has,
  });
}

/**
 * The Roadmap's lines as rows, in its order: the unticked ones, or every
 * one with `all`. Rejects when the Roadmap cannot be found or read —
 * {@link resolveRoadmapIssue}'s refusals included — and otherwise
 * answers, carrying each failed reading as a warning; the module note
 * holds which reading degrades to what.
 */
export async function readRoadmapRows(options: RoadmapRowsOptions): Promise<RoadmapRows> {
  const roadmap = await resolveRoadmapIssue({ configured: options.configured, search: options.search });
  const lines = parseRoadmapBody((await options.issues(roadmap)).body)
    .filter((line) => options.all === true || !line.ticked);

  const listed = await listBoard(options.board);
  const scan = scanClaimBranches(options.git, options.remote);
  const pulls = listed.issues === null
    ? { value: [], warning: null }
    : await readOrWarn(options.pullRequests, [], 'the open pull requests could not be listed, so no pr is shown');
  const plans = await readOrWarn(options.planNames, [], 'the plan dir could not be read, so no plan is shown');

  const board = viewOf(listed.issues);
  const sources: HasSources = { planNames: plans.value, refs: scan.refs, pulls: pulls.value };
  const rows = lines.map((line) => rowOf(line, board, readHasColumn(line.issue, sources)));

  const warnings = [listed.warning, ...scan.problems, pulls.warning, plans.warning]
    .filter((warning): warning is string => warning !== null);
  return Object.freeze({ roadmap, rows: Object.freeze(rows), warnings: Object.freeze(warnings) });
}
