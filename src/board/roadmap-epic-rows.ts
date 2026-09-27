/**
 * The epic rows `rafa roadmap` prints: the Roadmap's lines that name an
 * epic, each joined to what `readEpics` (`./epics.ts`) computed for it
 * and grouped by horizon, beside the lines that name a spec, kept as the
 * rows `readRoadmapRows` (`./roadmap-rows.ts`) answers for them today
 * (`.rafa/specs/rafa-244-epics-group-issues-features.md`).
 *
 * Nothing is read twice and nothing is respelled. {@link readRoadmapEpicRows}
 * hands `readRoadmapRows` its own seams back, each wrapped so that its
 * first answer is kept ({@link onceSeams}), and then asks the same seams
 * again for what the epics need: the board listing for `readEpics` and
 * `readEpicProblems` (`./epic-problems.ts`), and the plan dir's names,
 * the branch scan and the open pull requests for the claims. Every
 * second ask is answered from the kept first one, so the command still
 * spends one board listing, one pull request list, one plan dir read and
 * one branch scan, as the spec's "one board read per command" asks.
 *
 * ## Which lines are epic lines
 *
 * A line is an EPIC LINE when the issue it names is on the listing with
 * type `epic`, read by `typeOfLabels` as the listing reads every type.
 * Every other line is a SPEC LINE and keeps its {@link RoadmapRow} in
 * roadmap order, so a roadmap with no epic line answers exactly the rows
 * and warnings `readRoadmapRows` answers, and a table printed from them
 * is byte-identical to today's.
 *
 * A line whose issue the listing does not hold, and every line when the
 * listing FAILED, is a spec line: its type was not read, and reading each
 * line's issue one by one to learn it is what the spec rules out. A
 * failed listing therefore prints today's rows and today's warning, and
 * {@link RoadmapEpicRows.unknown} carries the listing's reason, so a
 * caller can print the epics as `unknown` rather than leave them out
 * silently.
 *
 * The lines taken are `readRoadmapRows`' own selection: the unticked
 * ones, every one with `all`. A line naming an epic twice is kept twice,
 * as `parseRoadmapBody` keeps it.
 *
 * ## The horizon groups
 *
 * An epic's horizon is its one `horizon:` label when that label is
 * `horizon:now`, `horizon:next` or `horizon:later`. An epic with none,
 * with two or more, or with another value groups under `later`; the
 * label problem is reported by `./epic-problems.ts` either way, so the
 * row is placed and the fault is named. Groups come in the order
 * {@link HORIZONS} gives, each holding its rows in roadmap order, and a
 * group with no row is left out.
 *
 * Only the `now` group is SHOWN unless `all` is set; `all` widens to
 * every horizon, as it already widens to the ticked lines.
 * {@link RoadmapEpicRows.hidden} counts the epic rows left out by
 * horizon, so a caller can tell a roadmap whose epics are all `next` or
 * `later` from one with no epic line at all ({@link hasEpicLines}).
 *
 * ## Claims
 *
 * A member is CLAIMED, for `readEpics`, when the plan dir holds its plan
 * ({@link hasPlanFor}), a scanned branch claims it ({@link branchClaims})
 * or an open pull request closes it ({@link closedIssuesIn}): the three
 * readings the roadmap's `has` column makes, asked for every issue on
 * the listing instead of each roadmap line. A reading that failed has
 * already been warned by `readRoadmapRows` and adds no claim here, and
 * no second warning.
 *
 * ## Warnings
 *
 * `readRoadmapRows`' warnings come first, unchanged. When at least one
 * epic line was found, shown or hidden, each label problem on the listing
 * follows as the sentence `epicProblemMessage` spells, in the order
 * `readEpicProblems` answers them; {@link RoadmapEpicRows.problems}
 * carries them as data for json mode. A roadmap with no epic line
 * carries no problem, so its output stays today's; `rafa doctor` is the
 * reader that reports problems on a board whose roadmap names no epic.
 *
 * ## What is carried for other readers
 *
 * {@link RoadmapEpicRows.epics} is `readEpics`' whole answer, every
 * `type:epic` issue on the listing and not only those the roadmap names,
 * for `--check`, which weighs every epic's stored state against its
 * computed one.
 */
import type { EpicProblem } from './epic-problems.js';
import type { Epic, Epics } from './epics.js';
import type { BoardIssue, BoardListing } from './roadmap-board.js';
import type { LineRowsOptions, RoadmapRow, RoadmapRowsOptions } from './roadmap-rows.js';
import type { RoadmapLine, RoadmapPullRequest } from './roadmap.js';
import type { GitResult, GitRunner } from '../pr/git.js';

import { messageOf } from '../config-sections.js';

import { epicProblemMessage, HORIZON_LABEL_PREFIX, readEpicProblems } from './epic-problems.js';
import { readEpics } from './epics.js';
import { hasPlanFor, readRoadmapRows } from './roadmap-rows.js';
import { branchClaims, closedIssuesIn, scanClaimBranches } from './roadmap.js';

/** The three horizons, in the order their groups are printed. */
export const HORIZONS = Object.freeze(['now', 'next', 'later'] as const);

/** When an epic is planned. */
export type Horizon = typeof HORIZONS[number];

/** The horizon an epic with no single known `horizon:` label groups under. */
export const FALLBACK_HORIZON: Horizon = 'later';

/** One epic line, joined to its computed epic. */
export interface EpicRow {
  /** The roadmap line naming the epic, as `parseRoadmapBody` read it. */
  readonly line: RoadmapLine;
  /** The epic as `readEpics` computed it. */
  readonly epic: Epic;
  /** The group the row sits in. */
  readonly horizon: Horizon;
}

/** One horizon's epic rows, in roadmap order. */
export interface EpicHorizonGroup {
  /** The horizon. */
  readonly horizon: Horizon;
  /** Its rows; never empty. */
  readonly rows: readonly EpicRow[];
}

/** What {@link readRoadmapEpicRows} answers. */
export interface RoadmapEpicRows {
  /** The Roadmap issue the lines were read from. */
  readonly roadmap: number;
  /** The shown horizon groups, in {@link HORIZONS} order: `now` only, every one with `all`. */
  readonly groups: readonly EpicHorizonGroup[];
  /** How many epic rows were left out because their horizon is not shown. */
  readonly hidden: number;
  /** The spec lines' rows, in roadmap order, as `readRoadmapRows` answered them. */
  readonly specs: readonly RoadmapRow[];
  /** Every `type:epic` issue on the listing, read; `--check`'s reading. */
  readonly epics: Epics;
  /** Why the listing failed, so no epic could be read; null when it was read. */
  readonly unknown: string | null;
  /** Every label problem on the listing; empty when the roadmap names no epic. */
  readonly problems: readonly EpicProblem[];
  /** `readRoadmapRows`' warnings, then one sentence per problem. */
  readonly warnings: readonly string[];
}

/** What {@link readRoadmapEpicRows} is made with: the rows' own options, and today. */
export interface RoadmapEpicRowsOptions extends RoadmapRowsOptions {
  /** Today, read as a local calendar day for lateness; the clock when left out. */
  readonly today?: Date;
}

/** True when `rows` holds an epic line, shown or hidden by horizon. */
export function hasEpicLines(rows: Pick<RoadmapEpicRows, 'groups' | 'hidden'>): boolean {
  return rows.groups.length > 0 || rows.hidden > 0;
}

/** The horizon `labels` place an epic under; the module note holds the fallback. */
export function horizonOf(labels: readonly string[]): Horizon {
  const found = labels.filter((label) => label.startsWith(HORIZON_LABEL_PREFIX));
  if (found.length !== 1) return FALLBACK_HORIZON;
  const value = (found[0] ?? '').slice(HORIZON_LABEL_PREFIX.length);
  return HORIZONS.find((horizon) => horizon === value) ?? FALLBACK_HORIZON;
}

/** A settled read: its value, or what it threw. */
type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

/** `read`, asked on the first call only; every call answers or rejects as the first did. */
function asyncOnce<T>(read: () => Promise<T>): () => Promise<T> {
  let kept: Promise<T> | null = null;
  return () => {
    kept = kept ?? read();
    return kept;
  };
}

/** `read`, asked on the first call only; every call answers or throws as the first did. */
function syncOnce<T>(read: () => T): () => T {
  let kept: Settled<T> | null = null;
  return () => {
    if (kept === null) {
      try {
        kept = { ok: true, value: read() };
      } catch (error) {
        kept = { ok: false, error };
      }
    }
    if (kept.ok) return kept.value;
    throw kept.error;
  };
}

/** `git`, each distinct command run once and its result kept. */
function gitOnce(git: GitRunner): GitRunner {
  const kept = new Map<string, GitResult>();
  return (args) => {
    const key = JSON.stringify(args);
    const known = kept.get(key);
    if (known !== undefined) return known;
    const result = git(args);
    kept.set(key, result);
    return result;
  };
}

/**
 * `options` with every seam `readLineRows` reads through asked at most
 * once, every later ask answered as the first was; see the module note.
 * `rafa epics` reads its epic and its rows through it too.
 */
export function onceSeams<T extends LineRowsOptions>(options: T): T {
  return {
    ...options,
    board: asyncOnce(options.board),
    pullRequests: asyncOnce(options.pullRequests),
    planNames: syncOnce(options.planNames),
    git: gitOnce(options.git),
  };
}

/** The kept listing, or null with its reason. */
async function listingOf(board: BoardListing): Promise<{ issues: readonly BoardIssue[] | null; reason: string }> {
  try {
    return { issues: await board(), reason: '' };
  } catch (error) {
    return { issues: null, reason: messageOf(error) };
  }
}

/** What `read` answers, or `fallback` when it fails; the failure was warned already. */
async function orEmpty<T>(read: () => Promise<T> | T, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

/** The seams {@link claimsOf} reads through. */
export type ClaimSeams = Pick<LineRowsOptions, 'planNames' | 'git' | 'remote' | 'pullRequests'>;

/**
 * Every issue on `issues` a plan, a branch or an open pull request
 * claims; a reading that fails adds no claim, since the rows' reading
 * over the same seams has warned it already. See the module note.
 */
export async function claimsOf(issues: readonly BoardIssue[], seams: ClaimSeams): Promise<ReadonlySet<number>> {
  const names = await orEmpty(seams.planNames, []);
  const refs = scanClaimBranches(seams.git, seams.remote).refs;
  const pulls = await orEmpty<readonly RoadmapPullRequest[]>(seams.pullRequests, []);
  const closing = new Set(pulls.flatMap((pull) => closedIssuesIn(pull.body)));
  const claimed = issues
    .map((issue) => issue.number)
    .filter((number) => hasPlanFor(names, number)
      || closing.has(number)
      || refs.some((ref) => branchClaims(ref, number)));
  return new Set(claimed);
}

/** The epic row `row` is, or null when its line is a spec line. */
function epicRowOf(row: RoadmapRow, byNumber: ReadonlyMap<number, Epic>): EpicRow | null {
  if (row.issue?.type !== 'epic') return null;
  const epic = byNumber.get(row.issue.number);
  return epic === undefined
    ? null
    : Object.freeze({ line: row.line, epic, horizon: horizonOf(row.issue.labels) });
}

/** `rows` split into epic rows and spec rows, each in roadmap order. */
function splitRows(
  rows: readonly RoadmapRow[],
  epics: Epics,
): { readonly epicRows: readonly EpicRow[]; readonly specs: readonly RoadmapRow[] } {
  const byNumber = new Map(epics.epics.map((epic) => [epic.number, epic]));
  const joined = rows.map((row) => ({ row, epicRow: epicRowOf(row, byNumber) }));
  return {
    epicRows: joined.flatMap(({ epicRow }) => epicRow === null
      ? []
      : [epicRow]),
    specs: joined.filter(({ epicRow }) => epicRow === null).map(({ row }) => row),
  };
}

/** `rows` grouped by horizon, in {@link HORIZONS} order, empty groups left out. */
export function groupByHorizon(rows: readonly EpicRow[]): readonly EpicHorizonGroup[] {
  return Object.freeze(HORIZONS
    .map((horizon) => ({ horizon, rows: Object.freeze(rows.filter((row) => row.horizon === horizon)) }))
    .filter((group) => group.rows.length > 0)
    .map((group) => Object.freeze(group)));
}

/**
 * The Roadmap's lines as epic rows grouped by horizon and spec rows in
 * roadmap order, with the label problems carried as warnings. Rejects
 * where `readRoadmapRows` rejects — a Roadmap that cannot be found or
 * read — and otherwise answers; the module note holds which line is an
 * epic line, which groups are shown, and what a failed listing gives.
 */
export async function readRoadmapEpicRows(options: RoadmapEpicRowsOptions): Promise<RoadmapEpicRows> {
  const seams = onceSeams(options);
  const read = await readRoadmapRows(seams);
  const listed = await listingOf(seams.board);
  const epics = listed.issues === null
    ? readEpics({ issues: null, reason: listed.reason, claims: new Set(), today: options.today ?? new Date() })
    : readEpics({
      issues: listed.issues,
      claims: await claimsOf(listed.issues, seams),
      today: options.today ?? new Date(),
    });

  const { epicRows, specs } = splitRows(read.rows, epics);
  const shown = epicRows.filter((row) => options.all === true || row.horizon === 'now');
  const problems = epicRows.length === 0 || listed.issues === null
    ? []
    : readEpicProblems(listed.issues);

  return Object.freeze({
    roadmap: read.roadmap,
    groups: groupByHorizon(shown),
    hidden: epicRows.length - shown.length,
    specs: Object.freeze([...specs]),
    epics,
    unknown: epics.unknown,
    problems: Object.freeze([...problems]),
    warnings: Object.freeze([...read.warnings, ...problems.map(epicProblemMessage)]),
  });
}
