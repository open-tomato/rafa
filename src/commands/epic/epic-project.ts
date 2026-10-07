/**
 * The project refresh every `rafa epic` action that writes runs once its
 * own writes and lines are done: the epic, its members, and every item
 * whose Rank shifted, refreshed on the repository's project
 * (`.rafa/specs/rafa-791-github-project-each-repository.md`, "Who calls
 * it": "`rafa epic new`, `promote`, `defer`, `move`, `cancel`, `close` —
 * the epic, its members, and every item whose Rank shifted").
 *
 * The epic actions build their own plain issue boards, so none of their
 * writes goes through the refreshing `IssueBoard`
 * (`src/board/project/issue-board-refresh.ts`). They are refreshed here
 * instead, in ONE refresh per run, after every write of the run.
 *
 * ## What each action names
 *
 * Each action hands an {@link EpicProjectTarget}, made from its own
 * result by the function of its name, or null when the run changed
 * nothing (no reason given, nobody to ask, an input that ended), which
 * sends nothing:
 *
 * | Action | Epics | Other issues | Added first |
 * |---|---|---|---|
 * | `new` ({@link newEpicTarget}) | the new epic | none | the new epic |
 * | `promote`, `defer` ({@link horizonTarget}) | the epic | none | none |
 * | `move` ({@link moveTarget}) | the epic it left and the one it joined | the issue moved | none |
 * | `cancel` ({@link cancelTarget}) | the epic, and each epic a dependent moved from or to | every dependent answered | none |
 * | `close` ({@link closeTarget}) | the epic | none | none |
 *
 * A new epic has no item on the project yet, and the refresh writes
 * nothing for an issue with no item, so `new` adds it first through
 * `addAndRefreshIssue` (`src/board/project/add-issue.ts`), the step
 * `rafa issue create` takes. A cancel's dependents are named although
 * the spec's row does not list them: a moved, unblocked or cancelled
 * dependent changed its labels or close state through the cancel's own
 * board, which no other caller refreshes.
 *
 * ## The members and the shifted Ranks
 *
 * Neither is read here. The refresh is handed a `RefreshWidening`
 * (`src/board/project/refresh.ts`): `membersOf` the epics named, whose
 * members it adds as its own board reading reads them, after the
 * action's writes; and `shiftedRanks`, which adds every item whose Rank
 * on the project is not the one the home board's order now gives. So the
 * board and the project's items are read once, by the refresh, and a
 * line added to the board, a member moved between epics, or an epic
 * closed reaches every item it renumbered.
 *
 * ## What it sends
 *
 * The config is read again with its warnings dropped, since the action
 * already wrote them for the same file; `epic cancel` reads none of its
 * own. With `board.project.number` unset it answers null and opens no
 * `gh` runner, so a repository that never opted in sees the action's
 * calls alone. Otherwise every call goes through the action's own `gh`
 * seam, or a runner in the project root.
 *
 * ## Never a failure of the action
 *
 * The action's writes have landed by then and the project is a mirror,
 * so nothing here rejects and the action keeps its exit code. Every line
 * goes to the command's `warn`, after the action's own lines and before
 * a json run's result: the refresh's own warnings as it answers them,
 * and a config that cannot be read or a refresh that rejected as
 * {@link epicProjectProblemLine}, naming `rafa board sync`.
 */
import type { EpicCancelResult } from './cancel.js';
import type { EpicCloseResult } from './close.js';
import type { EpicHorizonResult } from './horizon-change.js';
import type { EpicMoveResult } from './move.js';
import type { EpicNewResult } from './new.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { ProjectRefresh, RefreshConfig, RefreshOptions, RefreshWidening } from '../../board/project/refresh.js';
import type { RafaContext } from '../../cli/command.js';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { addAndRefreshIssue } from '../../board/project/add-issue.js';
import { refreshIssueItems } from '../../board/project/issue-board-refresh.js';
import { BOARD_SYNC_FIX } from '../../board/project/refresh-warnings.js';
import { messageOf } from '../../config-sections.js';
import { issueProject, issueSubjectConfig } from '../issue/issue-tracker.js';

/** Refreshes `issues`, widened by `widening`; `refreshProjectItems` unless a test plants another. */
export type RefreshEpicItems = (options: RefreshOptions, issues: readonly number[], widening: RefreshWidening) => Promise<ProjectRefresh>;

/** How the refresh reaches `gh`; each epic action's seams carry these. */
export interface EpicProjectSeams {
  /** Runs every call; a runner in the project root when left out. */
  readonly gh?: GhRunner;
  /** The refresh; `refreshProjectItems` when left out. */
  readonly projectRefresh?: RefreshEpicItems;
}

/** What one action asks the refresh for; see the module note. */
export interface EpicProjectTarget {
  /** The epics the action wrote on or moved an issue between, each refreshed with its members. */
  readonly epics: readonly number[];
  /** The other issues the action wrote on. */
  readonly issues: readonly number[];
  /** The issue the action created, added to the project before the refresh; null for none. */
  readonly added: number | null;
}

/** What one refresh after an epic action asked for. */
export interface EpicProjectRefresh {
  /** The issues named, the epics first, each once. */
  readonly issues: readonly number[];
  /** The epics whose members were asked for too. */
  readonly membersOf: readonly number[];
  /** The issue added to the project first, or null. */
  readonly added: number | null;
  /** Every line handed to `warn`, in order. */
  readonly warnings: readonly string[];
}

/** A refusal's message on one line, its mark left off. */
function oneLine(message: string): string {
  return message
    .replace(/^❌\s*/u, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ');
}

/** The line of a config that could not be read or a refresh that rejected, for `issues`. */
export function epicProjectProblemLine(issues: readonly number[], problem: string): string {
  const named = issues.map((issue) => `#${String(issue)}`).join(', ');
  return `The project was not updated for ${named}: ${oneLine(problem)}. Run \`${BOARD_SYNC_FIX}\` to catch up.`;
}

/** `epic new`'s target: the epic created, added first. */
export function newEpicTarget(result: EpicNewResult): EpicProjectTarget {
  return { epics: [result.epic.number], issues: [], added: result.epic.number };
}

/** `epic promote` and `epic defer`'s target: the epic, once its label moved; null when nothing changed. */
export function horizonTarget(result: EpicHorizonResult): EpicProjectTarget | null {
  return result.status === 'moved'
    ? { epics: [result.epic], issues: [], added: null }
    : null;
}

/** `epic move`'s target: both epics and the issue, once the move landed; null when nothing changed. */
export function moveTarget(result: EpicMoveResult): EpicProjectTarget | null {
  return result.outcome === null
    ? null
    : { epics: [result.from, result.to], issues: [result.issue], added: null };
}

/** `epic cancel`'s target: the epic, the epics dependents moved from and to, and every dependent answered; null when nothing changed. */
export function cancelTarget(result: EpicCancelResult): EpicProjectTarget | null {
  if (result.status !== 'cancelled') return null;
  const moves = result.applied.flatMap(({ answer }) => (answer.kind === 'moved'
    ? [answer.from, answer.to]
    : []));
  return { epics: [result.epic, ...moves], issues: result.applied.map(({ issue }) => issue), added: null };
}

/** `epic close`'s target: the epic closed. */
export function closeTarget(result: EpicCloseResult): EpicProjectTarget {
  return { epics: [result.epic], issues: [], added: null };
}

/** The lines of the refresh, or of the add and the refresh; never rejects. */
async function refreshLines(
  config: RefreshConfig,
  openGh: () => GhRunner,
  refresh: RefreshEpicItems,
  target: EpicProjectTarget,
  named: readonly number[],
): Promise<readonly string[]> {
  const widening: RefreshWidening = { membersOf: target.epics, shiftedRanks: true };
  if (target.added !== null) {
    return addAndRefreshIssue({ config, openGh, refresh: (options, issues) => refresh(options, [...new Set([...issues, ...named])], widening) }, target.added);
  }
  try {
    return (await refresh({ config, gh: openGh() }, named, widening)).warnings;
  } catch (error) {
    return [epicProjectProblemLine(named, messageOf(error))];
  }
}

/**
 * Refreshes on the project what `target` names, with the epics' members
 * and every item whose Rank shifted, writing every line at the command's
 * `warn`; never rejects. Null, having opened no runner, for a null
 * target and with `board.project.number` unset. See the module note.
 */
export async function refreshProjectAfterEpic(
  context: RafaContext,
  seams: EpicProjectSeams,
  target: EpicProjectTarget | null,
): Promise<EpicProjectRefresh | null> {
  if (target === null) return null;
  const project = issueProject(context);
  const named = [...new Set([...target.epics, ...target.issues])];
  let warnings: readonly string[];
  try {
    // Its warnings dropped: the action wrote them for the same file, or reads no config of its own.
    const config = issueSubjectConfig(project, () => undefined);
    if (config.boardProjectNumber === null) return null;
    const openGh = (): GhRunner => seams.gh ?? createGhRunner({ cwd: project.root });
    warnings = await refreshLines(config, openGh, seams.projectRefresh ?? refreshIssueItems, target, named);
  } catch (error) {
    warnings = [epicProjectProblemLine(named, messageOf(error))];
  }
  for (const line of warnings) context.output.warn(line);
  return { issues: named, membersOf: target.epics, added: target.added, warnings };
}
