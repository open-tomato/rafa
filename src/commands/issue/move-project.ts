/**
 * The project refresh `rafa issue move` runs once a GitHub issue has moved:
 * the one issue the move named, refreshed on the repository's project
 * (`.rafa/specs/rafa-791-github-project-each-repository.md`, "Who calls
 * it": "any label write through `IssueBoard`, one wrapper, so claims, the
 * gate, `issue move` and `issue unblock` are all covered"). The move closes
 * or reopens the issue, which the project mirrors as Stage and Done, and no
 * label write goes through the refreshing `IssueBoard` for it, so the move
 * refreshes the issue itself.
 *
 * ## What it refreshes
 *
 * Only the issue the move named, and only on the `github` tracker: the
 * `local` tracker's issues are files, not project items, and a degraded
 * chain landing on `local` names no issue of the repository. Nothing with
 * `board.project.number` unset, and no `gh` runner is opened for it.
 *
 * ## Never a failure of the move
 *
 * The move is the tracker's own write and has landed by then, and the
 * project is a mirror, so the refresh's lines come back as warning lines
 * for the caller to print after its own output, keeping exit code 0. A
 * refresh that rejects is answered as {@link refreshFailedWarning}, one
 * line naming the issue and `rafa board sync`.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { RefreshItems } from '../../board/project/add-issue.js';
import type { RefreshConfig } from '../../board/project/refresh.js';
import type { TrackerKind } from '../../ports/index.js';

import { refreshFailedWarning, refreshIssueItems } from '../../board/project/issue-board-refresh.js';

/** What {@link refreshMovedIssue} reads and writes through. */
export interface MoveProjectOptions {
  /** The config keys the refresh reads. */
  readonly config: RefreshConfig;
  /** Opens the runner the refresh sends through; called only with `board.project.number` set on the `github` tracker. */
  readonly openGh: () => GhRunner;
  /** The refresh; `refreshIssueItems` when left out. */
  readonly refresh?: RefreshItems;
}

/** The issue number an id names on the `github` tracker, or null when it names none. */
function issueNumberOf(externalId: string): number | null {
  const number = Number(externalId);
  return Number.isSafeInteger(number) && number >= 1
    ? number
    : null;
}

/**
 * The warning lines of the refresh of the issue `externalId` names, when
 * `tracker` is `github` and `board.project.number` is set; none otherwise.
 * Never rejects. See the module note.
 */
export async function refreshMovedIssue(
  tracker: TrackerKind,
  externalId: string,
  options: MoveProjectOptions,
): Promise<readonly string[]> {
  const issue = issueNumberOf(externalId);
  if (tracker !== 'github' || issue === null || options.config.boardProjectNumber === null) return [];
  const refresh = options.refresh ?? refreshIssueItems;
  try {
    return (await refresh({ config: options.config, gh: options.openGh() }, [issue])).warnings;
  } catch (error) {
    return [refreshFailedWarning(issue, error)];
  }
}
