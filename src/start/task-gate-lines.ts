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
 *
 * ## Why the type-check line exists
 *
 * The runner's task step type-checks the `*.test.ts` files a task added
 * or edited (`type-step.ts`), which neither `bun test` nor a
 * `tsconfig.json` that excludes test files checks. A session that never
 * ran that check reports done, the step is red, and the run stops on a
 * repair that a check before the report would have made needless. So
 * when the checkout holds the `tsconfig.json` and the `tsc` the step
 * needs ({@link TypeCheckRecipe}), one line hands the session the step's own
 * scratch tsconfig and tsc argv, with {@link TYPE_CHECK_FILE} and
 * {@link TYPE_CHECK_SCRATCH} where the step puts its files and its
 * scratch path. With no recipe, no line.
 *
 * Which errors to fix is said so the session can act on one run at HEAD:
 * a test file holds many errors no gate reported (`type-step.ts`), and
 * the session has no run at the base to compare with. So the line asks
 * for every error in a file the task added, and in a file it edited for
 * the errors on the lines `git diff <base> -- <file>` names, against the
 * base the base line hands it.
 */
import type { TypeCheckRecipe } from './type-step.js';
import type { GitRunner } from '../pr/index.js';

import { activeOutput } from '../adapters/output/active.js';
import { gitSaid } from '../pr/index.js';

import { scratchTsconfigFields, TEST_FILE_SUFFIX, tscArgv } from './type-step.js';

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

/** `word` as one shell word: as it is when shell-safe, single-quoted otherwise. */
function shellWord(word: string): string {
  return SHELL_SAFE_PATH.test(word)
    ? word
    : `'${word.replaceAll('\'', '\'\\\'\'')}'`;
}

/** `path` as a `bun test` file argument: `./` first, single-quoted unless shell-safe. */
function testArgument(path: string): string {
  return shellWord(`./${path}`);
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

/**
 * Where the type-check line's scratch tsconfig lists a file, after the
 * checkout's path: the session puts each test file's path relative to
 * the checkout here, as `scratchTsconfigFields` joins it.
 */
export const TYPE_CHECK_FILE = '<test file>';

/** Where the type-check line's tsc run names the scratch tsconfig the session wrote. */
export const TYPE_CHECK_SCRATCH = '<that tsconfig.json>';

/**
 * The prompt line telling the session to type-check the test files its
 * change adds or edits as the runner's type step will, through `recipe`;
 * none for no recipe. The module note says why the line exists.
 */
export function typeCheckLines(recipe: TypeCheckRecipe | null): string[] {
  if (recipe === null) return [];
  const scratch = JSON.stringify(scratchTsconfigFields(recipe.checkout, [TYPE_CHECK_FILE], recipe.modules));
  const run = tscArgv(recipe.modules, TYPE_CHECK_SCRATCH)
    .map((word) => word === TYPE_CHECK_SCRATCH
      ? word
      : shellWord(word))
    .join(' ');
  return [
    `Before you report done, type-check the \`*${TEST_FILE_SUFFIX}\` files your change adds or edits, if any, as the runner's type step will:`
    + ` write \`${scratch}\` to \`tsconfig.json\` in a new directory outside the checkout,`
    + ` one \`files\` entry per such file with \`${TYPE_CHECK_FILE}\` replaced by its path relative to the checkout, such as \`src/x${TEST_FILE_SUFFIX}\``
    + ` (the entry already opens with the checkout's path), then run \`${run}\` in the checkout.`
    + ' In a test file your change adds, fix every error it reports.'
    + ` In one your change edits, fix the errors on the lines your change touches, which \`git diff <base> -- ${TYPE_CHECK_FILE}\` names`
    + ' with `<base>` the base commit above, and leave the others: the file held them before this task.',
  ];
}
