/**
 * The project refresh `rafa pr merge` runs once its board reading is done:
 * the issues the merged pull request closes, and the issues those were
 * blocking, refreshed on the repository's project
 * (`.rafa/specs/rafa-791-github-project-each-repository.md`, "Who calls
 * it": "`rafa pr merge` — the issues it closes, and the issues those were
 * blocking").
 *
 * A closed issue's Stage moves on to In review or Done, and an issue it
 * was blocking loses it from its Blocked by field, and in `labels` mode
 * maybe its `spec:blocked` label and so its Blocked Stage. None of those
 * writes goes through the refreshing `IssueBoard`
 * (`src/board/project/issue-board-refresh.ts`): GitHub closes the issue,
 * and the unblock reading (`src/board/unblock-after-merge.ts`) takes its
 * label off through a plain board. So this module refreshes them itself, in one
 * refresh, after that reading has written what it writes.
 *
 * ## Which issues it refreshes
 *
 *  - The closed ones: every issue the body names with a closing keyword
 *    ({@link closedIssuesIn}), each once, in the order written.
 *  - The ones they were blocking: every row of ONE board listing, read in
 *    the `board.relationships` mode, whose blockers as the relations
 *    port reads them (`blockersOf`) name a closed issue on this board. A
 *    blocker of the same number on another repository is not one of
 *    them. In `labels` mode a blocker counts only while its row carries
 *    `spec:blocked`, and the unblock reading may just have taken that
 *    label off, so the issues that reading considered are added from its
 *    report; GitHub keeps a `native` blocked-by link once its blocker
 *    closes, so the listing alone holds them there.
 *
 * Those are refreshed together, the closed issues first, through
 * `refreshProjectItems`, which writes only the values that differ.
 *
 * ## What it sends
 *
 * Nothing with `board.project.number` unset or a body closing no issue:
 * it answers null and opens no `gh` runner, so a repository that never
 * opted in sees the merge's calls alone. Otherwise the listing, after
 * `gh repo view` in `native` mode (that adapter tells a foreign blocker
 * apart by the repository; `labels` reads it off the token), and then
 * the refresh's own calls, all through the runner opened retrying
 * (`../../board/project/project-runner.ts`): a call that failed on a
 * network error is sent again, each retry reported to `retry.onRetry`
 * before its wait.
 *
 * ## Never a failure of the merge
 *
 * The pull request is merged by then and the project is a mirror, so
 * nothing here rejects and the merge keeps its exit code. Every line goes
 * to `warn`: the refresh's own warnings as it answers them; a listing
 * that could not be read, by {@link blockingProblemLine}, while the
 * closed issues are still refreshed; a refresh that rejected, by
 * {@link refreshProblemLine}. Both name `rafa board sync`, which catches
 * the project up.
 *
 * ## Where `./merge.ts` calls it
 *
 * After the board reading of the clean-up (the unblock reading, or the
 * freed issues in `native` mode) and before the follow-ups, so
 * `rafa release settle` stays the last line the merge prints. A clean-up
 * step that failed ends the command before the board reading, and so
 * before this; `rafa board sync` catches that project up as
 * `rafa issue unblock` catches up the labels.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { RefreshItems } from '../../board/project/add-issue.js';
import type { ProjectRunnerSeams } from '../../board/project/project-runner.js';
import type { RefreshConfig } from '../../board/project/refresh.js';
import type { BlockersReading } from '../../board/relations/port.js';
import type { BoardIssue } from '../../board/roadmap-board.js';
import type { UnblockReport } from '../../board/unblock.js';

import { refreshIssueItems } from '../../board/project/issue-board-refresh.js';
import { openProjectRunner } from '../../board/project/project-runner.js';
import { BOARD_SYNC_FIX } from '../../board/project/refresh-warnings.js';
import { selectBoardRelations } from '../../board/relations/select.js';
import { readBoardRepository } from '../../board/repository.js';
import { createGhBoardListing } from '../../board/roadmap-board.js';
import { closedIssuesIn } from '../../board/roadmap.js';
import { messageOf } from '../../config-sections.js';

/** What {@link refreshProjectAfterMerge} is made with. */
export interface MergeProjectOptions {
  /** The merged pull request's body, which the closing keywords are read out of. */
  readonly body: string;
  /** The config keys the refresh and the listing read. */
  readonly config: RefreshConfig;
  /** Opens the runner every call goes through; called only when there is something to refresh. */
  readonly openGh: () => GhRunner;
  /** What the unblock reading came to in `labels` mode, or null; see the module note. */
  readonly unblocked: UnblockReport | null;
  /** Takes each warning line. */
  readonly warn: (line: string) => void;
  /** The refresh; `refreshProjectItems` when left out. */
  readonly refresh?: RefreshItems;
  /** How a retried call waits and is reported; `Bun.sleep` and the active output when left out. */
  readonly retry?: ProjectRunnerSeams;
}

/** What one refresh after a merge asked for. */
export interface MergeProjectRefresh {
  /** The issues the pull request closes, in the order the body names them, each once. */
  readonly closed: readonly number[];
  /** The issues those were blocking, lowest number first; empty when the listing could not be read. */
  readonly blocking: readonly number[];
  /** Every line handed to `warn`, in order. */
  readonly warnings: readonly string[];
}

/** `#20, #21`. */
function named(issues: readonly number[]): string {
  return issues.map((issue) => `#${String(issue)}`).join(', ');
}

/** The line of a listing that could not be read: the closed issues' dependents were not refreshed. */
export function blockingProblemLine(closed: readonly number[], problem: string): string {
  return `The project was not updated for the issues ${named(closed)} were blocking: ${problem}.`
    + ` Run \`${BOARD_SYNC_FIX}\` to catch up.`;
}

/** The line of a refresh that rejected for `issues`. */
export function refreshProblemLine(issues: readonly number[], problem: string): string {
  return `The project was not updated for ${named(issues)}: ${problem}. Run \`${BOARD_SYNC_FIX}\` to catch up.`;
}

/** True when `blockers`, as `blockersOf` read a row's, name one of `closed` on this board. */
function waitsOnOneOf(blockers: BlockersReading, closed: ReadonlySet<number>): boolean {
  return blockers.kind === 'blocked'
    && blockers.blockers.some((blocker) => blocker.repository === null && closed.has(blocker.number));
}

/** The rows of one listing in the configured mode that a closed issue was blocking. */
async function readBlocking(config: RefreshConfig, gh: GhRunner, closed: ReadonlySet<number>): Promise<readonly number[]> {
  const repository = config.boardRelationships === 'native'
    ? await readBoardRepository(gh)
    : '';
  const relations = selectBoardRelations(config, { gh, repository });
  const listing: readonly BoardIssue[] = await createGhBoardListing({ gh, mode: relations.mode })();
  const reading = relations.read(listing);
  return listing.filter((row) => waitsOnOneOf(reading.blockersOf(row), closed)).map((row) => row.number);
}

/** The issues the unblock reading considered whose `Blocked by:` line names one of `closed`. */
function consideredBlocking(unblocked: UnblockReport | null, closed: ReadonlySet<number>): readonly number[] {
  return (unblocked?.issues ?? [])
    .filter((outcome) => outcome.blockers.some((blocker) => closed.has(blocker)))
    .map((outcome) => outcome.issue);
}

/**
 * Refreshes on the project the issues the merged pull request closes and
 * the issues those were blocking, handing every line to `warn`; never
 * rejects. Null, having opened no runner, with `board.project.number`
 * unset or a body closing no issue. See the module note.
 */
export async function refreshProjectAfterMerge(options: MergeProjectOptions): Promise<MergeProjectRefresh | null> {
  const { config, warn, refresh = refreshIssueItems } = options;
  const closed: readonly number[] = [...new Set(closedIssuesIn(options.body))];
  if (config.boardProjectNumber === null || closed.length === 0) return null;

  const gh = openProjectRunner(options.openGh(), config, options.retry);
  const wanted = new Set(closed);
  const warnings: string[] = [];
  let listed: readonly number[] = [];
  try {
    listed = await readBlocking(config, gh, wanted);
  } catch (error) {
    warnings.push(blockingProblemLine(closed, messageOf(error)));
  }
  const blocking = [...new Set([...listed, ...consideredBlocking(options.unblocked, wanted)])]
    .filter((issue) => !wanted.has(issue))
    .sort((a, b) => a - b);
  const issues = [...closed, ...blocking];
  try {
    warnings.push(...(await refresh({ config, gh }, issues)).warnings);
  } catch (error) {
    warnings.push(refreshProblemLine(issues, messageOf(error)));
  }
  for (const line of warnings) warn(line);
  return { closed, blocking, warnings };
}
