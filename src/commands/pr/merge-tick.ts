/**
 * The roadmap tick `rafa pr merge` writes once the provider has merged:
 * which issues the merged pull request closes, which boards list them,
 * and the one tick per board that writes their lines — and, before the
 * boards, the tick of each closed issue's line on its epic's checklist.
 *
 * The rule and the writes are `src/board/roadmap-tick.ts`'s; this
 * module is the half that decides whether there is anything to tick at
 * all, and on which boards, and turns everything that can go wrong on
 * the way into a warning.
 *
 * ## Which boards are ticked
 *
 * A board is an open issue labelled `type:roadmap`, and a project may
 * hold several (`.rafa/specs/rafa-245-boards-several-roadmaps-per.md`).
 * An issue closed on one board's checklist is closed on every other
 * board that lists it too, so the tick goes to EVERY open labelled board
 * whose checklist, as `parseRoadmapBody` reads the body the listing
 * answered, lists one of the closed issues — ticked already or not, so
 * a line somebody ticked by hand is still reported as ticked already.
 * The boards are found by ONE `gh issue list --label type:roadmap`
 * (`createGhBoardLister`, `src/board/boards.ts`), and a board whose
 * checklist lists none of them is neither read nor written.
 *
 * `roadmap.issue` is the project's word for its default board and is not
 * checked against the listing (`resolveDefaultBoard`'s own rule), so a
 * configured board the listing does not hold is ticked too, read and
 * all, since there is no listed body to filter it by. The configured
 * board comes first, then the rest lowest number first: the first
 * result is the default board's whenever the default board was ticked.
 *
 * While NO issue carries the label the tick falls back to the default
 * board exactly as before: `resolveDefaultBoard` over the listing already
 * read (so it is not listed twice), `roadmap.issue` first, else the one
 * open issue titled "Roadmap" by a `gh issue list --search`, and that
 * one board is ticked whether or not its checklist lists the issue, so a
 * project that never labelled a board sees the same calls and the same
 * line. Labelled boards none of which lists a closed issue answer an
 * empty list, and `pr merge` says so with {@link noBoardListsLine}.
 *
 * ## Nothing is spent on the ordinary merge
 *
 * A pull request whose body names no issue with a closing keyword ticks
 * nothing, and {@link tickRoadmapAfterMerge} answers null for it BEFORE
 * any board is listed. That matters for cost and for noise: listing the
 * boards, and failing a labelled board, searching for the title, after
 * every merge would spend calls on every repository that keeps no
 * roadmap and warn each of them that it found none.
 *
 * ## Why every failure is a warning
 *
 * The merge has already happened by the time this runs. A listing that
 * fails, a roadmap that cannot be resolved, a board that would not take
 * the edit, a `roadmap.issue` pointing at an issue that is gone — none
 * of them un-merge anything, and failing the command over one would
 * tell an operator their merge broke when what broke is a checkbox. So
 * the refusals `resolveDefaultBoard` raises (`CommandExit`, exit 2 for
 * no roadmap and for several) are caught here with everything else and
 * reported through `warn`, and `pr merge` keeps its exit code. A board
 * whose tick fails does not stop the ticks of the boards after it:
 * `tickRoadmapIssue` answers a failure rather than throwing it.
 *
 * The warning always names the tick, so a line in a merge's output is
 * never read as something the merge itself did.
 *
 * ## The epic tick
 *
 * A member of an epic is listed on its epic's checklist and not on the
 * roadmap, which lists the epic (`.rafa/specs/rafa-246-epic-lifecycle.md`),
 * so the tick also goes to the checklist of the epic each closed issue's
 * `epic:<slug>` label names: the OPEN issue labelled `type:epic` and
 * that same `epic:<slug>`. It runs BEFORE the boards, from the member's
 * own epic upwards, and it changes nothing about them: the boards are
 * found, ticked and answered exactly as above, and a board that fails
 * does not stop the epic tick, nor an epic the boards.
 *
 * Membership is the label, so the issues and the epics come from ONE
 * board listing (`createGhBoardListing`, `src/board/roadmap-board.ts`),
 * sent only for a pull request that closes an issue. A listing holding
 * no open `type:epic` issue ends the epic tick there, silently: a
 * project that never created an epic pays that one listing and prints
 * nothing it did not print before. An epic whose checklist, as the
 * listing answered it, lists none of its closed members is neither read
 * nor written, as a board is not; an issue carrying no `epic:` label, or
 * one naming no open epic, is not an epic's business. An issue carrying
 * two `epic:` labels, and a label two open epics carry, are warned about
 * ({@link epicTickProblemLine}) and tick nothing, since an issue belongs
 * to one epic at most and neither is picked.
 *
 * Each epic's lines are ticked by one checklist edit through
 * `src/board/epic-checklist.ts` — `tickLine` for every member it lists,
 * carried by `editChecklists` over the same `gh api` pair the boards use
 * — epics lowest number first. Each epic's result is handed to
 * {@link MergeTickOptions.epicTicked} as it lands, and `pr merge` prints
 * {@link epicTickSentence} for it: one sentence per epic, a warning for
 * one that failed. A listing that fails is one {@link epicTickProblemLine}
 * warning, and the boards are ticked all the same.
 *
 * The epic half is exported as {@link tickEpics}: the `labels`
 * relationships adapter (`src/board/relations/labels.ts`) runs it in its
 * `afterMerge`, since an epic's checklist is where that mode keeps its
 * order. The boards are not a relationship and stay here alone.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { ChecklistEditResult } from '../../board/epic-checklist.js';
import type { BoardIssue } from '../../board/roadmap-board.js';
import type { RoadmapTickResult } from '../../board/roadmap-tick.js';

import { createGhBoardLister, resolveDefaultBoard } from '../../board/boards.js';
import { editChecklists, tickLine } from '../../board/epic-checklist.js';
import { EPIC_TYPE_LABEL } from '../../board/epic-context.js';
import { EPIC_LABEL_PREFIX, epicSlugsOf } from '../../board/epics.js';
import { createGhBoardListing } from '../../board/roadmap-board.js';
import { createGhRoadmapBody, tickRoadmapIssue } from '../../board/roadmap-tick.js';
import { closedIssuesIn, createGhRoadmapSearch, parseRoadmapBody } from '../../board/roadmap.js';
import { ROADMAP_LABEL } from '../../board/setup.js';
import { messageOf } from '../../config-sections.js';

/** What {@link tickRoadmapAfterMerge} is asked. */
export interface MergeTickOptions {
  /** The merged pull request's body, which the closing keywords are read out of. */
  readonly body: string;
  /** `roadmap.issue` as config resolved it, or null for the default board `resolveDefaultBoard` ranks. */
  readonly configured: number | null;
  /** Runs every `gh` command the tick sends. */
  readonly gh: GhRunner;
  /** Where a tick that could not be written says so. */
  readonly warn: (message: string) => void;
  /** Handed each epic's tick as it lands, lowest epic first; see the module note. */
  readonly epicTicked: (result: EpicTickResult) => void;
}

/** What the tick of one epic's checklist came to. */
export interface EpicTickResult extends ChecklistEditResult {
  /** The closed members whose lines the epic's checklist lists, lowest first. */
  readonly members: readonly number[];
}

/** What a tick that could not be attempted at all says. */
export function tickProblemLine(problem: string): string {
  return `the roadmap was not ticked: ${problem}`;
}

/** What `pr merge` prints when labelled boards exist and none lists a closed issue. */
export function noBoardListsLine(issues: readonly number[]): string {
  const named = issues.map((issue) => `#${String(issue)}`).join(', ');
  return `no open ${ROADMAP_LABEL} board lists ${named}, so nothing was ticked.`;
}

/** `#20, #33`, the way a tick line names issues. */
function named(issues: readonly number[]): string {
  return issues.map((issue) => `#${String(issue)}`).join(', ');
}

/** What an epic tick that could not be made, for an issue or at all, says. */
export function epicTickProblemLine(problem: string): string {
  return `the epic checklists were not ticked: ${problem}`;
}

/** The one line `pr merge` prints for an epic's tick, whatever it came to. */
export function epicTickSentence(result: EpicTickResult): string {
  const epic = `epic #${String(result.issue)}`;
  if (result.status === 'failed') {
    return `${epic} was not ticked after ${String(result.attempts)} attempts: ${result.problem}`;
  }
  if (result.status === 'edited') return `Ticked ${named(result.members)} on ${epic}.`;
  return `${named(result.members)} needed no tick on ${epic}.`;
}

/** The open epic `issue`'s one `epic:` label names, or null; warns where the module note says. */
function epicOf(
  issue: BoardIssue,
  epics: readonly BoardIssue[],
  warn: (message: string) => void,
): BoardIssue | null {
  const slugs = epicSlugsOf(issue.labels);
  const labels = slugs.map((slug) => `"${EPIC_LABEL_PREFIX}${slug}"`);
  const [slug] = slugs;
  if (slug === undefined) return null;
  if (slugs.length > 1) {
    warn(epicTickProblemLine(`#${String(issue.number)} carries ${String(slugs.length)} epic labels`
      + ` (${labels.join(', ')}), so no epic was ticked for it`));
    return null;
  }
  const naming = epics.filter((epic) => epic.labels.includes(`${EPIC_LABEL_PREFIX}${slug}`));
  if (naming.length > 1) {
    warn(epicTickProblemLine(`${String(naming.length)} open ${EPIC_TYPE_LABEL} issues carry "${EPIC_LABEL_PREFIX}${slug}"`
      + ` (${named(naming.map((epic) => epic.number))}), so none was ticked for #${String(issue.number)}`));
    return null;
  }
  return naming[0] ?? null;
}

/** Each open epic whose checklist lists one of its closed `issues`, with those members, lowest first. */
function epicsListing(
  listing: readonly BoardIssue[],
  issues: readonly number[],
  warn: (message: string) => void,
): ReadonlyMap<number, readonly number[]> {
  const epics = listing.filter((row) => row.state === 'OPEN' && row.labels.includes(EPIC_TYPE_LABEL));
  const members = new Map<number, readonly number[]>();
  if (epics.length === 0) return members;
  for (const number of [...issues].sort((a, b) => a - b)) {
    const issue = listing.find((row) => row.number === number);
    if (issue === undefined || issue.labels.includes(EPIC_TYPE_LABEL)) continue;
    const epic = epicOf(issue, epics, warn);
    if (epic === null || !parseRoadmapBody(epic.body).some((line) => line.issue === number)) continue;
    members.set(epic.number, [...members.get(epic.number) ?? [], number]);
  }
  return new Map([...members].sort(([a], [b]) => a - b));
}

/** What {@link tickEpics} is asked: the three of {@link MergeTickOptions} the epic tick reads. */
export type EpicTickOptions = Pick<MergeTickOptions, 'gh' | 'warn' | 'epicTicked'>;

/**
 * Ticks each of `issues`' lines on its epic's checklist, handing each
 * epic's result to `epicTicked`; see the module note. Never throws.
 * `src/board/relations/labels.ts` runs it as the epic half of its
 * `afterMerge`, so the adapter and this tick read one rule.
 */
export async function tickEpics(options: EpicTickOptions, issues: readonly number[]): Promise<void> {
  const { gh, warn, epicTicked } = options;
  let members: ReadonlyMap<number, readonly number[]>;
  try {
    members = epicsListing(await createGhBoardListing({ gh })(), issues, warn);
  } catch (error) {
    warn(epicTickProblemLine(messageOf(error)));
    return;
  }

  const board = createGhRoadmapBody({ gh });
  for (const [epic, ticking] of members) {
    const edit = (body: string): string => ticking.reduce((edited, member) => tickLine(edited, member), body);
    const [result] = await editChecklists({ edits: [{ issue: epic, edit }], board });
    if (result !== undefined) epicTicked(Object.freeze({ ...result, members: ticking }));
  }
}

/** True when `board` is open, labelled, and its checklist lists one of `issues`. */
function listsAny(board: BoardIssue, issues: readonly number[]): boolean {
  if (board.state !== 'OPEN' || !board.labels.includes(ROADMAP_LABEL)) return false;
  return parseRoadmapBody(board.body).some((line) => issues.includes(line.issue));
}

/** The boards to tick while labelled boards exist, in the order the module note gives. */
function boardsListing(
  boards: readonly BoardIssue[],
  issues: readonly number[],
  configured: number | null,
): readonly number[] {
  const listed = boards
    .filter((board) => listsAny(board, issues))
    .map((board) => board.number)
    .sort((a, b) => a - b);
  if (configured === null) return listed;
  const unlisted = !boards.some((board) => board.number === configured);
  return unlisted || listed.includes(configured)
    ? [configured, ...listed.filter((number) => number !== configured)]
    : listed;
}

/** Every board the tick goes to; see the module note. Rejects when the listing or the fallback fails. */
async function boardsToTick(
  gh: GhRunner,
  issues: readonly number[],
  configured: number | null,
): Promise<readonly number[]> {
  const boards = await createGhBoardLister({ gh })();
  if (boards.length > 0) return boardsListing(boards, issues, configured);

  const { number } = await resolveDefaultBoard({
    configured,
    listBoards: () => Promise.resolve(boards),
    search: createGhRoadmapSearch({ gh }),
  });
  return [number];
}

/**
 * Ticks the lines of every issue the merged pull request closes on the
 * checklist of its epic, handing each epic's result to `epicTicked`, and
 * then on every board that lists one, answering one result per board in
 * the module note's order, or null when it closes none or the boards
 * could not be found. Never throws: see the module note.
 */
export async function tickRoadmapAfterMerge(
  options: MergeTickOptions,
): Promise<readonly RoadmapTickResult[] | null> {
  const { body, configured, gh, warn } = options;
  const issues = closedIssuesIn(body);
  if (issues.length === 0) return null;
  await tickEpics(options, issues);

  let roadmaps: readonly number[];
  try {
    roadmaps = await boardsToTick(gh, issues, configured);
  } catch (error) {
    warn(tickProblemLine(messageOf(error)));
    return null;
  }

  const board = createGhRoadmapBody({ gh });
  let results: readonly RoadmapTickResult[] = [];
  for (const roadmap of roadmaps) {
    results = [...results, await tickRoadmapIssue({ roadmap, issues, board })];
  }
  return Object.freeze(results);
}
