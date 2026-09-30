/**
 * `rafa issue unblock` under `board.relationships: native`: the one line
 * it prints instead of reading the board, and the reading of the mode
 * that decides it.
 *
 * In native mode a blocker is GitHub's own blocked-by link, and GitHub
 * clears it by itself when the blocking issue closes. There is no
 * `spec:blocked` label to take off and no `Blocked by:` line to read, so
 * the command sends no `gh` call, asks no question, writes nothing and
 * exits 0 with {@link NATIVE_UNBLOCK_LINE}. The line opens with the mode,
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
 */
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
