/**
 * A new issue onto the project: {@link addAndRefreshIssue} adds an issue
 * `rafa issue create` has just filed to the repository's project, then
 * refreshes it, so its five fields are filled from the start, and says so
 * when they were not
 * (`.rafa/specs/rafa-791-github-project-each-repository.md`, "Who calls
 * it": "`rafa issue create` — the new issue, added to the project
 * first").
 *
 * ## Why the add comes first
 *
 * {@link refreshProjectItems} writes nothing for an issue with no item on
 * the project: it answers the issue as missing, since adding an item is
 * its caller's step. A new issue has no item yet, so the add is made
 * here, through {@link ProjectPort.addItem}, before the refresh is asked
 * for it. GitHub's `addProjectV2ItemById` answers the item already there
 * for content already on the project, so an add over an issue the
 * project already holds adds nothing twice.
 *
 * ## The added item, handed to the refresh
 *
 * The add answers the item's id, and it is kept: the refresh is handed
 * that item as a known item (`knownItem`, `./refresh.ts`, "Known items,
 * for issues just added"), built from the repository and number the add
 * sent. The refresh therefore fills the new issue whether or not the
 * project's item listing shows its item yet, rather than answering it as
 * missing and writing nothing
 * (`.rafa/specs/rafa-947-board-project-follow-ups.md`).
 *
 * When the refresh answers the issue in its `notFilled`, one line follows
 * the refresh's own, `#<n> added but not filled: <reason>`
 * (`addedNotFilledWarning`), the reason the refresh's. Two reasons reach
 * this caller: the issue's facts were refused, or a rate-limit refusal
 * left one of its writes unsent. The other two do not, since the known
 * item is built from what the add sent and the refresh is asked for that
 * issue alone. An issue whose facts were refused is named twice with one
 * reason, by the refresh's `#<n> not refreshed: <reason>` and by this
 * line: the first says nothing was written for it, the second that it
 * sits on the project unfilled, for `rafa board sync` to fill. A refresh
 * that read no project (`skipped`, `not-found`, `refused`) answers no
 * `notFilled`, so its own line stands alone.
 *
 * ## What it sends
 *
 * Nothing with `board.project.number` unset: it answers no line and
 * opens no runner, so a repository that never opted in sees the create
 * alone. Otherwise, through the one `GhRunner`: the repository
 * (`gh repo view`), whose owner holds the project; the project at that
 * owner and number; the content id of the issue and the add; then the
 * refresh, handed the added item, which reads the repository and the
 * project again on its own.
 *
 * ## Never a failure of the create
 *
 * The issue is filed before this runs and the project is a mirror, so
 * every failure becomes a warning line and the promise resolves:
 *
 *  - a token without the `project` scope, read off the refusal of the
 *    find or the add, answers `./refresh-warnings.ts`'s scope line, and
 *    no refresh is asked for;
 *  - a `board.project.number` naming no project answers its not-found
 *    line, and nothing is added;
 *  - the refresh's own lines are answered as it answers them, the
 *    `added but not filled` line after them;
 *  - anything else that rejects, the repository read or an add `gh`
 *    refused, answers `refreshFailedWarning`'s line naming the issue and
 *    `rafa board sync`, which adds any open issue missing from the
 *    project.
 */
import type { ProjectPort, ProjectRef } from './port.js';
import type {
  KnownItem,
  ProjectRefresh,
  RefreshOptions,
  RefreshWidening,
} from './refresh.js';
import type { GhRunner } from '../../adapters/tracker/github.js';

import { readBoardRepository } from '../../commands/epic/move-native.js';

import { createGhProjectPort } from './gh.js';
import { refreshFailedWarning } from './issue-board-refresh.js';
import {
  addedNotFilledWarning,
  isMissingProjectScope,
  notFoundWarning,
  scopeWarning,
} from './refresh-warnings.js';
import { knownItem, refreshProjectItems } from './refresh.js';

/** Refreshes `issues`; {@link refreshProjectItems} unless a test plants another. */
export type RefreshItems = (options: RefreshOptions, issues: readonly number[]) => Promise<ProjectRefresh>;

/**
 * Refreshes `issues` beside the `known` items of those just added;
 * {@link refreshProjectItems} unless a test plants another.
 */
export type RefreshAddedItems = (
  options: RefreshOptions,
  issues: readonly number[],
  widening: RefreshWidening,
  known: readonly KnownItem[],
) => Promise<ProjectRefresh>;

/** What {@link addAndRefreshIssue} is made with. */
export interface AddIssueOptions extends Omit<RefreshOptions, 'gh'> {
  /** Opens the runner every call goes through; called only with `board.project.number` set. */
  readonly openGh: () => GhRunner;
  /** The refresh asked for once the issue is on the project; {@link refreshProjectItems} when left out. */
  readonly refresh?: RefreshAddedItems;
}

/** The add, answering the refusal's line, or the known item of the add once the issue is on the project. */
async function addItem(gh: GhRunner, number: number, issue: number): Promise<string | KnownItem> {
  const repository = await readBoardRepository(gh);
  const ref: ProjectRef = { owner: repository.split('/')[0] ?? '', number };
  const port: ProjectPort = createGhProjectPort(gh);
  const project = await port.find(ref);
  if (project === null) return notFoundWarning(ref);
  const content = { repository, number: issue };
  return knownItem(await port.addItem(project.id, content), content);
}

/** The refresh's own lines, then the line of each added issue it answered as not filled. */
function linesOf(refreshed: ProjectRefresh): readonly string[] {
  return refreshed.kind === 'refreshed'
    ? [...refreshed.warnings, ...refreshed.notFilled.map(addedNotFilledWarning)]
    : refreshed.warnings;
}

/**
 * Adds `issue` to the project at `board.project.number`, then refreshes
 * it, handing the refresh the item the add answered, and answers every
 * warning line for the caller to print after its own output, the
 * `added but not filled` line last when the refresh did not fill the
 * issue; never rejects, and sends nothing with the number unset. See the
 * module note.
 */
export async function addAndRefreshIssue(options: AddIssueOptions, issue: number): Promise<readonly string[]> {
  const { config, openGh, refresh = refreshProjectItems } = options;
  if (config.boardProjectNumber === null) return [];
  const gh = openGh();
  try {
    const added = await addItem(gh, config.boardProjectNumber, issue);
    if (typeof added === 'string') return [added];
    const refreshOptions: RefreshOptions = options.sleep === undefined
      ? { config, gh }
      : { config, gh, sleep: options.sleep };
    return linesOf(await refresh(refreshOptions, [issue], {}, [added]));
  } catch (error) {
    return isMissingProjectScope(error)
      ? [scopeWarning()]
      : [refreshFailedWarning(issue, error)];
  }
}
