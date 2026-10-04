/**
 * The task prompt's gate lines: the words that hand a session its task's
 * base commit and the `bun test --changed=<base>` it runs as its scoped
 * test gate, then the `bun test` over the `tests.alwaysRun` files it runs
 * beside it. `buildTaskPrompt` (`dispatch.ts`) places them after the
 * blocker line and ahead of the sections.
 *
 * ## Why the always-run line exists
 *
 * `bun test --changed=<base>` follows the import graph from the changed
 * files. A content sweep imports no project file and reads the tree at
 * run time, so no changed file ever selects one, and a task can break a
 * sweep with a green scoped run. The line names the sweeps by path, so
 * the session runs them too.
 *
 * {@link readAlwaysRunFiles} resolves the globs against `git ls-files`
 * with `Bun.Glob`, which keeps an untracked scratch file out of the
 * line. A list that resolves to no file, `[]` or a glob matching
 * nothing, gives no line and says nothing: a sweep the setting names may
 * not have been written yet. Each path opens with `./`, because
 * `bun test` reads an argument without a path prefix as a filter
 * matched against every test file's path (on bun 1.4.2,
 * `bun test start/task-gate-lines` ran this module's test file), and
 * the prefix makes it the one file.
 */
import type { GitRunner } from '../pr/index.js';

import { activeOutput } from '../adapters/output/active.js';
import { gitSaid } from '../pr/index.js';

/**
 * What opens the prompt line handing a session its task's base commit.
 * The loop's words open it, as they open the blocker line.
 */
export const BASE_PROMPT_PREFIX = 'The base commit of this task is ';

/** A full or abbreviated git object name, the only shape a base may take. */
const COMMIT_NAME = /^[0-9a-f]{7,64}$/;

/**
 * The prompt line naming `base` and the `bun test --changed=<base>` the
 * session runs, or none for no base. Throws on a base that is not a
 * commit name: it is pasted into a shell command the session runs, and
 * the loop only ever hands it the HEAD git answered.
 */
export function baseLines(base: string | null): string[] {
  if (base === null) return [];
  if (!COMMIT_NAME.test(base)) {
    throw new Error(`The task's base \`${base}\` is not a commit name; the prompt pastes it into \`bun test --changed=\`.`);
  }
  return [`${BASE_PROMPT_PREFIX}${base}: run \`bun test --changed=${base}\` for the tests your changes reach.`];
}

/** A path `bun test` takes pasted bare into a shell command. */
const SHELL_SAFE_PATH = /^[\w./@+-]+$/;

/**
 * The tracked files any of `globs` matches, sorted, from the paths `git
 * ls-files` answered. Empty for no glob, or for globs matching nothing.
 */
export function alwaysRunFiles(globs: readonly string[], tracked: readonly string[]): readonly string[] {
  const matchers = globs.map((pattern) => new Bun.Glob(pattern));
  const matched = tracked.filter((path) => matchers.some((glob) => glob.match(path)));
  return [...new Set(matched)].sort();
}

/**
 * The `tests.alwaysRun` files tracked in the checkout `git` runs in,
 * through {@link alwaysRunFiles}. When git does not answer, it warns and
 * answers none: the prompt then lacks the line, which the runner's own
 * task step does not depend on.
 */
export function readAlwaysRunFiles(git: GitRunner, globs: readonly string[]): readonly string[] {
  if (globs.length === 0) return [];
  const result = git(['ls-files', '-z']);
  if (!result.ok) {
    activeOutput().warn(`⚠️  git ls-files did not answer (${gitSaid(result) || 'nothing said'}); the task prompt names no tests.alwaysRun file.`);
    return [];
  }
  return alwaysRunFiles(globs, result.stdout.split('\0').filter((path) => path !== ''));
}

/** `path` as a `bun test` file argument: `./` first, single-quoted unless shell-safe. */
function testArgument(path: string): string {
  const prefixed = `./${path}`;
  return SHELL_SAFE_PATH.test(prefixed)
    ? prefixed
    : `'${prefixed.replaceAll('\'', '\'\\\'\'')}'`;
}

/**
 * The prompt line telling the session to also run `bun test` over
 * `files`, the resolved `tests.alwaysRun` files, each prefixed `./`; none
 * when `files` is empty. The module note says why the line exists.
 */
export function alwaysRunLines(files: readonly string[]): string[] {
  if (files.length === 0) return [];
  const args = files.map(testArgument).join(' ');
  return [`Also run \`bun test ${args}\`: these are the \`tests.alwaysRun\` files, content sweeps no changed file selects.`];
}
