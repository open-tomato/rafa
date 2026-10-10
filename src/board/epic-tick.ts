/**
 * The epic tick: once a pull request has merged, the tick of each issue
 * it closes on the checklist of that issue's epic, and the sentences
 * that say what each tick came to.
 *
 * This is the library half of `src/commands/pr/merge-tick.ts`. The
 * command half holds what `rafa pr merge` decides about the roadmap
 * boards — which issues the merged pull request closes, which boards
 * list them, and the one tick per board — and runs {@link tickEpics}
 * before them. The `labels` relationships adapter
 * (`./relations/labels.ts`) runs {@link tickEpics} in its `afterMerge`
 * without the command half, since an epic's checklist is where that
 * mode keeps its order, so the adapter and `pr merge` read one rule.
 * Nothing here reads a command line, and nothing here imports a file
 * under `src/commands/`.
 *
 * ## Which epics are ticked
 *
 * A member of an epic is listed on its epic's checklist and not on the
 * roadmap, which lists the epic (`.rafa/specs/rafa-246-epic-lifecycle.md`),
 * so the tick goes to the checklist of the epic each closed issue's
 * `epic:<slug>` label names: the OPEN issue labelled `type:epic` and
 * that same `epic:<slug>`.
 *
 * Membership is the label, so the issues and the epics come from ONE
 * board listing (`createGhBoardListing`, `./roadmap-board.ts`). A
 * listing holding no open `type:epic` issue ends the epic tick there,
 * silently: a project that never created an epic pays that one listing
 * and prints nothing. An epic whose checklist, as the listing answered
 * it, lists none of its closed members is neither read nor written; an
 * issue carrying no `epic:` label, or one naming no open epic, is not
 * an epic's business. An issue carrying two `epic:` labels, and a label
 * two open epics carry, are warned about ({@link epicTickProblemLine})
 * and tick nothing, since an issue belongs to one epic at most and
 * neither is picked.
 *
 * Each epic's lines are ticked by one checklist edit through
 * `./epic-checklist.ts` — `tickLine` for every member it lists, carried
 * by `editChecklists` over the same `gh api` pair the boards use —
 * epics lowest number first. Each epic's result is handed to
 * {@link EpicTickOptions.epicTicked} as it lands, and the caller prints
 * {@link epicTickSentence} for it: one sentence per epic, a warning for
 * one that failed.
 *
 * ## Why every failure is a warning
 *
 * The merge has already happened by the time this runs, and a checkbox
 * that was not ticked un-merges nothing. A listing that fails is one
 * {@link epicTickProblemLine} warning, an epic whose edit fails is a
 * result with the status `failed` and does not stop the epics after
 * it, and {@link tickEpics} never throws. The warning always names the
 * tick, so a line in a merge's output is never read as something the
 * merge itself did.
 */
import type { ChecklistEditResult } from './epic-checklist.js';
import type { BoardIssue } from './roadmap-board.js';
import type { GhRunner } from '../adapters/tracker/github.js';

import { messageOf } from '../config-sections.js';

import { editChecklists, tickLine } from './epic-checklist.js';
import { EPIC_TYPE_LABEL } from './epic-context.js';
import { EPIC_LABEL_PREFIX, epicSlugsOf } from './epics.js';
import { createGhBoardListing } from './roadmap-board.js';
import { createGhRoadmapBody } from './roadmap-tick.js';
import { parseRoadmapBody } from './roadmap.js';

/** What the tick of one epic's checklist came to. */
export interface EpicTickResult extends ChecklistEditResult {
  /** The closed members whose lines the epic's checklist lists, lowest first. */
  readonly members: readonly number[];
}

/** What {@link tickEpics} is asked. */
export interface EpicTickOptions {
  /** Runs every `gh` command the tick sends. */
  readonly gh: GhRunner;
  /** Where a tick that could not be written says so. */
  readonly warn: (message: string) => void;
  /** Handed each epic's tick as it lands, lowest epic first; see the module note. */
  readonly epicTicked: (result: EpicTickResult) => void;
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

/**
 * Ticks each of `issues`' lines on its epic's checklist, handing each
 * epic's result to `epicTicked`; see the module note. Never throws.
 * `./relations/labels.ts` runs it as the epic half of its `afterMerge`,
 * so the adapter and `pr merge`'s tick read one rule.
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
