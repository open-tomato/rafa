/**
 * The workspace `rafa pr triage --resolve` runs a pinned plan in: the
 * worktree under `~/.rafa/worktrees/pr-<n>`, the pull requests this
 * module refuses to make one for, and the push that carries the
 * resolution back.
 *
 * A resolve run edits files, installs dependencies and commits. Doing
 * that in the operator checkout would mean switching its branch out from
 * under whatever is uncommitted there, so the spec gives the run a
 * worktree of its own and removes it on success
 * (`.rafa/specs/rafa-20-pr-commands.md`). Three things follow, and they are
 * the whole of this module:
 *
 *   - **Where the worktree goes.** {@link resolveWorktreePath} is the
 *     one place that path is spelled, so the command that makes it, the
 *     command that removes it and any message naming it agree.
 *   - **When there must be none.** A cross-repository pull request has
 *     no branch in this repository to check out and no branch here to
 *     push to, so {@link crossRepositoryRefusal} refuses before any
 *     directory is made.
 *   - **A push that is never forced.** {@link pushResolvedStep} builds
 *     one fixed argv, and {@link forcedPushRefusal} is run over it
 *     before it is spawned.
 *
 * ## The steps are data, and the runners are thin
 *
 * `./merge.ts` draws the same line for the merge clean-up and for the
 * same reason: a step is an argv that can be read in a test without a
 * repository, and a failure prints the step the operator would paste.
 * Every runner here answers a {@link WorktreeStepOutcome} rather than
 * throwing, because {@link GitRunner} does not throw either and each of
 * these steps fails for ordinary reasons — a directory left behind by a
 * previous attempt, a branch checked out somewhere else, a remote that
 * moved under the run.
 *
 * Nothing here resets, reverts, prunes or deletes a branch. The only
 * things it removes are the worktree it made and the record git keeps
 * of it.
 *
 * ## Why the push guard is not decoration
 *
 * `git push origin <branch>` looks unforceable, and it is not. Measured
 * on git 2.50.1 (Apple Git-155) under macOS, 2026-09-19: `+weird` is a
 * branch name `git check-ref-format --branch` accepts and `git branch`
 * creates, and `git push origin +weird` from a worktree holding it is
 * read as the REFSPEC `+weird`, whose leading `+` is the force marker —
 * git answered `error: src refspec weird does not match any`, having
 * stripped the `+` and looked for a branch called `weird`. So a branch
 * name that reaches this module from GitHub can turn an argv that names
 * no force flag into a forced push of another branch.
 *
 * {@link forcedPushRefusal} therefore reads the argv that is about to be
 * spawned, not the flags the caller passed, and {@link pushResolved}
 * refuses rather than spawning when it fires. `--force`,
 * `--force-with-lease`, `--force-if-includes` with or without a value,
 * `-f` and `--mirror` are the flag spellings; a leading `+` on any word
 * is the refspec one.
 *
 * ## What git does about the directory, measured
 *
 * All measured on the same git and day, in scratch repositories:
 *
 *   - `git worktree add` CREATES the leading directories: adding at
 *     `<base>/deep/a/b/c` where only `<base>` existed exited 0. So
 *     nothing here calls `mkdir` for `~/.rafa/worktrees`.
 *   - `git worktree add <path> <branch>` where the branch exists only as
 *     `origin/<branch>` takes git DWIM branch: it printed
 *     `Preparing worktree (new branch 'feat/y')` and
 *     `branch 'feat/y' set up to track 'origin/feat/y'`. A resolve run
 *     over a pull request whose head was never checked out locally
 *     therefore needs no separate fetch-and-branch step.
 *   - A path that already holds something is refused:
 *     `fatal: '<path>' already exists`, exit 128. A branch already
 *     checked out elsewhere is refused too:
 *     `fatal: '<branch>' is already used by worktree at '<path>'`.
 *   - `git worktree remove` exits 0 over a worktree holding only
 *     IGNORED files, which is what matters here: the resolve plans run
 *     an install and leave `node_modules/` behind. It refuses over an
 *     untracked non-ignored file or a modified tracked one, both with
 *     `fatal: '<path>' contains modified or untracked files, use --force
 *     to delete it`, exit 128. That refusal is reported and never
 *     answered with `--force`: the files it is protecting are work the
 *     resolve run made and did not commit, and deleting them would throw
 *     away the only evidence of what it did.
 *
 * ## Paths as git spells them
 *
 * `git worktree list --porcelain` prints a path with every symlink
 * resolved: on macOS, where `/tmp` links to `/private/tmp`, a worktree
 * added at `/tmp/x/pr-7` is listed as `/private/tmp/x/pr-7`. A path
 * built here from a home directory has not been through that, so
 * {@link worktreeAt} matches on the path as given AND on its resolved
 * form when it exists on disk. `./merge.ts` records the same reading for
 * `worktreesHolding`, which leaves the resolving to its caller; this one
 * does it, because the caller builds the path rather than reading it
 * back out of git.
 *
 * ## The command line is rebuilt here
 *
 * {@link worktreeCommandLine} joins `shellQuote`d words the way the
 * `commandLine` of `./merge.ts` does, and calls the same quoter, which
 * is the piece that could disagree if it were copied. The join is not
 * shared because `commandLine` is typed to a `MergeStep`, whose `id` is
 * a closed set of merge step names; widening it to fit this module would
 * be a change to the merge command in a commit that is about worktrees.
 */
import type { GitRunner } from './git.js';
import type { WorktreeEntry } from './merge.js';

import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { gitSaid } from './git.js';
import { parseWorktrees } from './merge.js';
import { shellQuote } from './preflight-items.js';

/** Where under a home directory the resolve worktrees are made. */
export const WORKTREES_SUBDIR = join('.rafa', 'worktrees');

/** What a resolve worktree directory is named before its PR number. */
const WORKTREE_PREFIX = 'pr-';

/** The remote a resolution is pushed to when the caller names none. */
const DEFAULT_REMOTE = 'origin';

/** How every refusal in this module opens. */
const REFUSAL_PREFIX = 'rafa pr triage --resolve refuses';

/** The flag spellings that make a push overwrite what is on the remote. */
const FORCING_FLAG = /^(?:-f|--force(?:-with-lease|-if-includes)?(?:=.*)?|--mirror)$/;

/** The leading character that makes a refspec a forced one. */
const FORCING_REFSPEC_MARK = '+';

/**
 * The worktree a resolve run for pull request `number` is made in, under
 * `home`: `<home>/.rafa/worktrees/pr-<number>`.
 *
 * The number is the only part that varies and it never carries a path
 * separator, since it reaches a caller as a JSON number off `gh`
 * (`./gh.ts`), so the answer is always inside `<home>/.rafa/worktrees`.
 */
export function resolveWorktreePath(home: string, number: number): string {
  return join(home, WORKTREES_SUBDIR, `${WORKTREE_PREFIX}${number}`);
}

/** What the cross-repository refusal is read from. */
export interface ResolveTarget {
  readonly number: number;
  /** The branch the pull request is FROM, which a worktree would hold. */
  readonly headRefName: string;
  /** True when that branch is on a fork; see the module note. */
  readonly isCrossRepository: boolean;
}

/**
 * Why a resolve run cannot be given a worktree for `pr`, or null when it
 * can. The one reason is a head on a fork: there is no branch here to
 * check out and no branch here to push back to.
 */
export function crossRepositoryRefusal(pr: ResolveTarget): string | null {
  if (!pr.isCrossRepository) return null;
  return `${REFUSAL_PREFIX} #${pr.number}: its head branch \`${pr.headRefName}\` is on a fork.`
    + ' There is no branch in this repository to check a worktree out of, and the resolution'
    + ' would have to be pushed to a repository this checkout does not own.'
    + ` Assess it with \`rafa pr triage ${pr.number}\`, which needs no worktree, and resolve it`
    + ' where the fork is.';
}

/** Which of the three steps a step is. */
export type WorktreeStepId = 'add' | 'remove' | 'push';

/** One step: what it is called, and exactly what it runs. */
export interface WorktreeStep {
  readonly id: WorktreeStepId;
  /** What is reported as the step runs, lower case, no full stop. */
  readonly label: string;
  /** The whole command, `git` included, ready to spawn or to print. */
  readonly argv: readonly string[];
}

/** How one step ended. Never a throw; see the module note. */
export interface WorktreeStepOutcome {
  readonly id: WorktreeStepId;
  /** True when git exited 0, and false when it was not run at all. */
  readonly ok: boolean;
  /** The step as one line the operator can paste. */
  readonly command: string;
  /** What git said, standard error first, or why it was not run. */
  readonly said: string;
}

/** Freezes a step and the argv inside it. */
function frozenStep(step: WorktreeStep): WorktreeStep {
  return Object.freeze({ ...step, argv: Object.freeze(step.argv) });
}

/** The step that adds the worktree at `path` holding `branch`. */
export function addWorktreeStep(path: string, branch: string): WorktreeStep {
  return frozenStep({
    id: 'add',
    label: `add a worktree for ${branch} at ${path}`,
    argv: ['git', 'worktree', 'add', path, branch],
  });
}

/** The step that removes the worktree at `path`. Never `--force`. */
export function removeWorktreeStep(path: string): WorktreeStep {
  return frozenStep({
    id: 'remove',
    label: `remove the worktree at ${path}`,
    argv: ['git', 'worktree', 'remove', path],
  });
}

/**
 * The step that pushes `branch` to `remote`. One fixed argv, carrying no
 * flag at all, so the only way it can force is the refspec the branch
 * name itself spells; see the module note and {@link forcedPushRefusal}.
 */
export function pushResolvedStep(branch: string, remote: string = DEFAULT_REMOTE): WorktreeStep {
  return frozenStep({
    id: 'push',
    label: `push ${branch} to ${remote}`,
    argv: ['git', 'push', remote, branch],
  });
}

/** `step` as one line the operator can paste; see the module note. */
export function worktreeCommandLine(step: WorktreeStep): string {
  return step.argv.map((word) => shellQuote(word)).join(' ');
}

/** Whether `argv` would make git force a push; see the module note. */
export function forcesPush(argv: readonly string[]): boolean {
  return forcingWords(argv).length > 0;
}

/** The words of `argv` that make it a forced push, in order. */
function forcingWords(argv: readonly string[]): readonly string[] {
  return argv.filter((word) => FORCING_FLAG.test(word) || word.startsWith(FORCING_REFSPEC_MARK));
}

/**
 * Why `argv` must not be spawned, or null when it forces nothing. The
 * refusal names every word that made it forced, so a branch beginning
 * with `+` is reported as itself rather than as a missing branch.
 */
export function forcedPushRefusal(argv: readonly string[]): string | null {
  const forcing = forcingWords(argv);
  if (forcing.length === 0) return null;
  const words = forcing.map((word) => `\`${word}\``).join(', ');
  return `${REFUSAL_PREFIX} a push that git would force: ${words}.`
    + ' A resolve run never overwrites what is on the remote, so nothing was pushed.';
}

/** Runs `step` through `git` and answers how it went. */
function runStep(git: GitRunner, step: WorktreeStep): WorktreeStepOutcome {
  const result = git(step.argv.slice(1));
  return {
    id: step.id,
    ok: result.ok,
    command: worktreeCommandLine(step),
    said: gitSaid(result),
  };
}

/**
 * Adds the worktree for a resolve run at `path`, holding `branch`.
 *
 * `git` is a runner made for the operator checkout, not for `path`: the
 * worktree does not exist yet. A branch that is only a remote-tracking
 * ref is taken by git DWIM branch; a path that is already there and a
 * branch already checked out elsewhere are both refused by git, and its
 * words are what comes back. See the module note for all three.
 */
export function addResolveWorktree(
  git: GitRunner,
  path: string,
  branch: string,
): WorktreeStepOutcome {
  return runStep(git, addWorktreeStep(path, branch));
}

/**
 * Removes the worktree at `path`, which is what a resolve run does when
 * it succeeded and what the attempt guard does when it gives up.
 *
 * Never `--force`, so a worktree still holding uncommitted or untracked
 * work is reported and left alone; ignored files such as `node_modules/`
 * do not hold it back. See the module note for both readings.
 */
export function removeResolveWorktree(git: GitRunner, path: string): WorktreeStepOutcome {
  return runStep(git, removeWorktreeStep(path));
}

/**
 * Pushes `branch` to `remote` from the worktree `git` was made for,
 * refusing without spawning anything when the argv would force.
 */
export function pushResolved(
  git: GitRunner,
  branch: string,
  remote: string = DEFAULT_REMOTE,
): WorktreeStepOutcome {
  const step = pushResolvedStep(branch, remote);
  const refusal = forcedPushRefusal(step.argv);
  if (refusal === null) return runStep(git, step);
  return { id: step.id, ok: false, command: worktreeCommandLine(step), said: refusal };
}

/** The paths `path` is matched against: as given, and as resolved on disk. */
function pathForms(path: string): readonly string[] {
  if (!existsSync(path)) return [path];
  return [path, realpathSync(path)];
}

/**
 * The worktree git lists at `path`, or null when it lists none there —
 * which is what a removed worktree, and a path that never held one,
 * both answer.
 *
 * Matched on the path as given and on its resolved form; see the module
 * note. A listing git refused answers null too, since a repository that
 * cannot be listed holds no worktree this run may act on.
 */
export function worktreeAt(git: GitRunner, path: string): WorktreeEntry | null {
  const listed = git(['worktree', 'list', '--porcelain']);
  if (!listed.ok) return null;
  const forms = pathForms(path);
  return parseWorktrees(listed.stdout).find((entry) => forms.includes(entry.path)) ?? null;
}
