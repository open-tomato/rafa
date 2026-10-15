/**
 * The barrel over git: every name `git.ts`, `commit.ts` and
 * `gh-runner.ts` export but one, and nothing else.
 *
 * A file outside `packages/rafa/src/core/` imports this file and never the two behind
 * it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `packages/rafa/src/core/` imports the two directly and never this file.
 * None does today.
 *
 * ## What sits behind it
 *
 *   - `git.ts`: the runner that spawns `git` in a directory and answers
 *     what git said instead of throwing, with the reader of that answer;
 *   - `commit.ts`: staging and committing one task's work on the loop's
 *     behalf, the subject derived from the task text, and the argv of
 *     each step;
 *   - `gh-runner.ts`: the type of the runner every `gh` command goes
 *     through and what one command answers, types alone, imported by
 *     nothing.
 *
 * ## The one name the two files share
 *
 * Both files export a type named `GitRunner`, and they are two types.
 * `git.ts` declares `(args: readonly string[]) => GitResult`, the seam
 * the callers of this barrel stub. `commit.ts` declares
 * `(args: string[]) => GitRunResult`, the runner `CommitOptions.runGit`
 * takes, which carries an exit status where the first carries `ok`.
 *
 * One barrel exports one binding under a name, so `GitRunner` here is
 * the one `git.ts` declares, and the one of `commit.ts` is not exported
 * from this file. The move changed paths and no logic, so neither type
 * was renamed, and the barrel coins no second name for the one it
 * leaves out.
 *
 * Measured when the two moved: 138 files under `src/` imported
 * `git.ts`, and 107 of them took its `GitRunner`. Eleven imported
 * `commit.ts`, and one of those took its `GitRunner`:
 * `commit.test.ts`, which moved with it and imports it directly. A
 * caller outside `packages/rafa/src/core/` that stubs the commit runner types it
 * through `CommitOptions['runGit']`, and `GitRunResult` is exported for
 * what it answers.
 *
 * ## Why one barrel can hold both
 *
 * A barrel that groups a file with a file outside `packages/rafa/src/core/` that
 * imports the barrel back by value is a runtime cycle. `commit.ts`
 * imports `node:child_process` and no file. `git.ts` imports one file by
 * value: `packages/rafa/src/core/config/config-sections.ts`, for `messageOf`. That
 * file imports one file outside `packages/rafa/src/core/` by value,
 * `packages/rafa/src/schema/tiers.ts`, and it does not reach this barrel.
 *
 * `src/pr/index.ts`, the `pr` subject's barrel, re-exports the four
 * names of `git.ts` from this file, as it re-exported them from
 * `git.ts` before the move. `config-sections.ts` imports
 * `src/pr/types.ts` directly and not that barrel, which is why the edge
 * closes nothing.
 *
 * Measured when the two moved: the value imports of the non-test files
 * under `src/` and `packages/` held six cycles before the move and the
 * same six after it, none through a file of this folder. The control,
 * the same tree with `src/pr/types.ts` taking one value (`gitSaid`) from
 * this barrel, held a seventh: that file, `config-sections.ts`, `git.ts`
 * and this one. No load order of the control was run.
 *
 * `docs/survey/cluster-map.json` places `git.ts` and `commit.ts` in two
 * clusters, and this file, which it does not name, lands by its folder
 * in the cluster of `git.ts`. `src/tests/import-cycle.sweep.test.ts`
 * reads cycles and this file is in none.
 *
 * ## What it exports
 *
 * Each name is spelled, types apart from values, as the other core
 * barrels spell theirs. No name here is part of the published surface:
 * `src/index.ts` re-exports nothing from this file.
 *
 * `index.test.ts` holds the list to the two files: every name either
 * exports is here once, as the same binding, `GitRunner` as the type
 * `git.ts` declares, and no other name is here.
 */
export type { GhResult, GhRunner } from './gh-runner.js';
export type { GitResult, GitRunner } from './git.js';
export type {
  CommitAttempt,
  CommitMessage,
  CommitOptions,
  CommitOutcome,
  CommitStep,
  CommitType,
  CommitTypeRule,
  DerivedSubject,
  GitRunResult,
  SubjectOptions,
} from './commit.js';

export { createGitRunner, gitSaid } from './git.js';
export {
  buildCommitMessage,
  COMMIT_TYPE_RULES,
  commitArgs,
  commitTaskWork,
  DEFAULT_COMMIT_TYPE,
  deriveCommitSubject,
  FALLBACK_DESCRIPTION,
  firstClause,
  headShaArgs,
  inferCommitType,
  MAX_MESSAGE_CHARS,
  MAX_SUBJECT_LENGTH,
  normaliseTaskText,
  spawnGit,
  stageAllArgs,
  stagedChangesArgs,
} from './commit.js';
