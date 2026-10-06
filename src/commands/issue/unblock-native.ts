/**
 * `rafa issue unblock` under `board.relationships: native`: the one line
 * it prints instead of reading the board, and the reading of the mode
 * that decides it.
 *
 * In native mode a blocker is GitHub's own blocked-by link, and GitHub
 * clears it by itself when the blocking issue closes. There is no
 * `spec:blocked` label to take off and no `Blocked by:` line to read, so
 * the command reads no board, asks no question, writes no label and
 * exits 0 with {@link NATIVE_UNBLOCK_LINE}; its only `gh` calls are the
 * project refresh below, sent only with `board.project.number` set. The line opens with the mode,
 * `board.relationships is native`, as every native-mode no-op line does.
 *
 * ## Reading the mode
 *
 * {@link unblockRelationshipsMode} loads the project's config through
 * `./issue-tracker.ts`'s {@link issueSubjectConfig}, so a config
 * `loadConfig` refuses is refused with that module's exit code 1 and one
 * line per problem: which mode applies is not guessed.
 *
 * The config's warnings are DROPPED here rather than written. Before the
 * native mode existed this command loaded no config and wrote none of
 * them, and in labels mode, the default, its output stays byte-identical
 * to what it was; a deprecated key is still named by every command that
 * already loaded the config, `rafa doctor` among them.
 *
 * ## The project refresh
 *
 * GitHub clearing the blocker changes the issue's Blocked by and maybe
 * its Stage, and native mode writes no label through the refreshing
 * `IssueBoard`, so {@link refreshNativeUnblock} refreshes the issue the
 * line named on the project itself
 * (`../../board/project/issue-board-refresh.ts` for the label writes).
 * With `board.project.number` unset it opens no `gh` runner and sends no
 * call, so the native line stays all a repository that never opted in
 * sees. `--all` names no issue and refreshes none: which issues GitHub
 * unblocked is not read here, and `rafa board sync` catches them up.
 * Every line the refresh answers goes to `warn`, and a refresh that
 * rejects is answered by `refreshFailedWarning`, so the command keeps
 * its exit code 0. The refresh and that line are handed in by
 * `./unblock.ts` rather than imported here: a new import of
 * `src/board/project/` from this subject enters that directory's import
 * cycle at a module that reads a binding before it is initialized.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { ProjectWarn } from '../../board/project/issue-board-refresh.js';
import type { ProjectRefresh, RefreshConfig, RefreshOptions } from '../../board/project/refresh.js';
import type { BoardRelationshipMode } from '../../config-sections.js';
import type { ProjectFound } from '../../project/scope.js';

import { issueSubjectConfig } from './issue-tracker.js';

/** What `rafa issue unblock` prints in native mode, and all it does there. */
export const NATIVE_UNBLOCK_LINE = 'board.relationships is native: GitHub clears a blocker by itself when the'
  + ' blocking issue closes, so rafa issue unblock has nothing to write';

/**
 * The json-mode result of a native-mode run. It keeps the three fields a
 * labels-mode report carries, answered empty, so a reader of `issues`
 * reads no outcome rather than a missing field.
 */
export interface NativeUnblockReport {
  readonly relationships: 'native';
  readonly issues: readonly [];
  readonly problem: null;
  readonly unchecked: null;
  readonly message: string;
}

/** The json-mode result of a native-mode run; see {@link NativeUnblockReport}. */
export function nativeUnblockReport(): NativeUnblockReport {
  return Object.freeze({
    relationships: 'native',
    issues: Object.freeze([]) as readonly [],
    problem: null,
    unchecked: null,
    message: NATIVE_UNBLOCK_LINE,
  });
}

/**
 * The `board.relationships` mode of `project`'s config, its warnings
 * dropped; a refusal with exit code 1 for a config `loadConfig` refuses.
 * See the module note.
 */
export function unblockRelationshipsMode(project: ProjectFound): BoardRelationshipMode {
  return issueSubjectConfig(project, () => undefined).boardRelationships;
}

/** What {@link refreshNativeUnblock} reads and writes through. */
export interface NativeUnblockRefreshOptions {
  /** The config keys the refresh reads. */
  readonly config: RefreshConfig;
  /** Opens the runner the refresh sends through; called only with `board.project.number` set. */
  readonly openGh: () => GhRunner;
  /** Takes each warning line. */
  readonly warn: ProjectWarn;
  /** The refresh, `refreshIssueItems` in the command. */
  readonly refresh: (options: RefreshOptions, issues: readonly number[]) => Promise<ProjectRefresh>;
  /** The line a refresh that rejected for `issue` is answered as, `refreshFailedWarning` in the command. */
  readonly failedLine: (issue: number, error: unknown) => string;
}

/**
 * Refreshes the issues a native-mode line named on the project, handing
 * every line to `warn`; never rejects. `null` (`--all`) and an unset
 * `board.project.number` send nothing. See the module note.
 */
export async function refreshNativeUnblock(
  issues: readonly number[] | null,
  options: NativeUnblockRefreshOptions,
): Promise<void> {
  if (issues === null || issues.length === 0 || options.config.boardProjectNumber === null) return;
  let lines: readonly string[];
  try {
    lines = (await options.refresh({ config: options.config, gh: options.openGh() }, issues)).warnings;
  } catch (error) {
    lines = issues.map((issue) => options.failedLine(issue, error));
  }
  for (const line of lines) options.warn(line);
}
