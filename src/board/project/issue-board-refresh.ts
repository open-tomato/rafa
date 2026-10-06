/**
 * The refreshing issue board: an {@link IssueBoard} whose three label
 * writes, `swapLabels`, `addLabel` and `removeLabel`, refresh the issue
 * they labelled on the project once the write has landed
 * (`.rafa/specs/rafa-791-github-project-each-repository.md`, "Who calls
 * it": "any label write through `IssueBoard`, the issue labelled").
 *
 * It is applied where a `gh` issue board is built for a label write, so
 * every caller of those writes is covered without editing each. The
 * refresh's lines go to the `warn` the build site hands, or to the active
 * output's (`src/adapters/output/active.ts`) where it hands none, read at
 * each line:
 *
 * | Built in | Covers |
 * |---|---|
 * | `src/start/preflight-claim.ts` | the claim stages of `loop start` and of `rafa claim take`, `hand`, `accept` and `release` |
 * | `src/commands/plan/claim-route.ts` | the `rafa:claimed` label `plan create` puts on |
 * | `src/board/plan-spec.ts` | the readiness gate's swap and the `issue ready` offer of `plan create` |
 * | `src/commands/issue/ready.ts` | `rafa issue ready` |
 * | `src/commands/issue/unblock.ts` | labels-mode `rafa issue unblock` |
 *
 * The `epic` actions build their own boards and are refreshed through
 * their own helper, and native-mode `issue unblock` writes no label
 * through a board and refreshes through `refreshNativeUnblock`
 * (`src/commands/issue/unblock-native.ts`), so neither is built here.
 *
 * ## The write first, then the refresh
 *
 * The label write is the command's own and is made exactly as the inner
 * board makes it: a write that rejects rejects unchanged and sends no
 * refresh, since the issue did not change. A write that lands is followed
 * by {@link refreshProjectItems} over that one issue, awaited, so its
 * lines come out before the caller's next line and a process that exits
 * after the write has sent the refresh.
 *
 * ## A refresh never fails the write
 *
 * The project is a mirror and the issues stay the source of truth, so the
 * refresh's lines, the four of `./refresh-warnings.ts`, are each handed
 * to `warn` and the write resolves. A refresh that rejects for anything
 * else, a repository `gh repo view` cannot read or a board with no
 * default, is answered by {@link refreshFailedWarning}, one line naming
 * the issue and `rafa board sync`, and the write still resolves. With no
 * `board.project.number` the refresh sends no call and answers no line,
 * so a repository that never opted in sees the write alone.
 *
 * Every other member is the inner board's own, untouched: a close or a
 * created issue is refreshed by its own caller where the spec names one.
 *
 * ## Cost
 *
 * One refresh per write, never batched across writes: the stage removal
 * of `src/claims/labels.ts` sends two `removeLabel`s and so two
 * refreshes of the same issue, the first of which may write a value the
 * second changes again. Each refresh reads the repository, the project,
 * its items and the board; that cost was not measured here.
 */
import type { ProjectRefresh, RefreshConfig, RefreshOptions } from './refresh.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { IssueBoard } from '../issue-board.js';

import { activeOutput } from '../../adapters/output/active.js';
import { messageOf } from '../../config-sections.js';
import { createGhIssueBoard } from '../issue-board.js';

import { BOARD_SYNC_FIX } from './refresh-warnings.js';
import { refreshProjectItems } from './refresh.js';

/** Refreshes `issues` on the project; {@link refreshProjectItems} with its options bound. */
export type RefreshIssues = (issues: readonly number[]) => Promise<ProjectRefresh>;

/** Takes one warning line, for the caller to print. */
export type ProjectWarn = (line: string) => void;

/** What {@link withProjectRefresh} refreshes through and warns to. */
export interface ProjectRefreshSeams {
  readonly refresh: RefreshIssues;
  readonly warn: ProjectWarn;
}

/** What {@link createRefreshingGhIssueBoard} is made with. */
export interface RefreshingGhIssueBoardOptions {
  /** Runs every `gh` command, the label writes and the refresh alike. */
  readonly gh: GhRunner;
  /** The config keys the refresh reads. */
  readonly config: RefreshConfig;
  /** Takes each warning line the refresh answers; the active output's `warn` when left out. */
  readonly warn?: ProjectWarn;
  /** The pause between two write requests; `Bun.sleep` when left out. */
  readonly sleep?: RefreshOptions['sleep'];
}

/**
 * {@link refreshProjectItems}, for a caller that refreshes with no board
 * write (native-mode `rafa issue unblock`). Reached through this module
 * so the caller adds no import of `./refresh.ts`: imported from a module
 * this directory's import cycle loads, that import reads `./port.ts`'s
 * bindings before they are initialized.
 */
export function refreshIssueItems(options: RefreshOptions, issues: readonly number[]): Promise<ProjectRefresh> {
  return refreshProjectItems(options, issues);
}

/** The line a refresh that rejected after `issue` was labelled is answered as. */
export function refreshFailedWarning(issue: number, error: unknown): string {
  return `The project was not updated for #${String(issue)}: ${messageOf(error)}. Run \`${BOARD_SYNC_FIX}\` to catch up.`;
}

/** Refreshes `issue`, handing every line to `warn`; never rejects. */
async function refreshAfter(seams: ProjectRefreshSeams, issue: number): Promise<void> {
  let lines: readonly string[];
  try {
    lines = (await seams.refresh([issue])).warnings;
  } catch (error) {
    lines = [refreshFailedWarning(issue, error)];
  }
  for (const line of lines) seams.warn(line);
}

/** `board` with its three label writes followed by the refresh of the issue labelled; see the module note. */
export function withProjectRefresh(board: IssueBoard, seams: ProjectRefreshSeams): IssueBoard {
  const wrapped: IssueBoard = {
    ...board,
    swapLabels: async (issue: number, removed: string, added: string): Promise<void> => {
      await board.swapLabels(issue, removed, added);
      await refreshAfter(seams, issue);
    },
    addLabel: async (issue: number, label: string): Promise<void> => {
      await board.addLabel(issue, label);
      await refreshAfter(seams, issue);
    },
    removeLabel: async (issue: number, label: string): Promise<void> => {
      await board.removeLabel(issue, label);
      await refreshAfter(seams, issue);
    },
  };
  return Object.freeze(wrapped);
}

/** The `gh` issue board over `options.gh`, its label writes refreshing the project; see the module note. */
export function createRefreshingGhIssueBoard(options: RefreshingGhIssueBoardOptions): IssueBoard {
  const { gh, config, sleep } = options;
  // Read at each line, not at the build: a board built before the dispatcher sets the command's output still warns there.
  const warn = options.warn ?? ((line: string): void => {
    activeOutput().warn(line);
  });
  const refreshOptions: RefreshOptions = sleep === undefined
    ? { config, gh }
    : { config, gh, sleep };
  return withProjectRefresh(createGhIssueBoard({ gh }), {
    refresh: (issues) => refreshProjectItems(refreshOptions, issues),
    warn,
  });
}
