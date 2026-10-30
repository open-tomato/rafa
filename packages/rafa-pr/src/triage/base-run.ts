/**
 * One named test, run on one commit: the half of the kind check that
 * reads the plan's base ({@link runNamedTestAt}). The check
 * (`./own-check.ts`) asks it whether the case a bug names was green or
 * red before the plan's commits, and it answers `green`, `red` or
 * `unrunnable`, never a throw.
 *
 * ## What a run costs and does
 *
 * One test file, never the suite. The commit is checked out in a
 * detached temporary worktree (`git worktree add --detach`) under a
 * fresh folder of the system's temp directory; the run checkout's
 * `node_modules` is linked into it, so the base runs on the head's
 * dependencies and installs nothing; `bun test` runs that file alone
 * through `runSuite` (`../suite/run.ts`), so its environment, its JUnit
 * report and its naming of a case are the suite step's own. The named
 * case is then found in the report by its full name, as
 * `testFailureOf` (`./test-failure.ts`) reads it from a bug:
 *
 *   - **`red`**: the report holds the case, failed.
 *   - **`green`**: the report holds the case, passed.
 *   - **`unrunnable`**, with a `problem` sentence: anything else. A
 *     blank commit or name; a file under `node_modules` or outside the
 *     run checkout, which is never run; a worktree git would not add; no
 *     `node_modules` to link, or a link that failed; a file the commit
 *     does not hold; a run that wrote no readable report, as a file that
 *     throws while it loads does; and a case the report does not hold or
 *     holds as skipped. The check reads every one of them as a base it
 *     cannot run on, which makes the entry a `bug`.
 *
 * The worktree and its folder are removed in a `finally`, after a failed
 * run too: `git worktree remove --force`, then the folder, then
 * `git worktree prune` when the remove failed, so git keeps no record of
 * a worktree whose folder is gone. A failed clean-up is not an answer
 * and changes none.
 *
 * ## The cache
 *
 * A run is cached per commit and file in a {@link BaseRunCache} the
 * caller makes once for the run ({@link createBaseRunCache}) and hands
 * to every call, so two bugs naming two cases of one file at one commit
 * cost one run, and a commit git would not check out is tried once.
 * What is cached is the run's report, and each call answers its own case
 * from it. The cache holds the run's promise, so two calls made before
 * the first run ends share it too. There is no module-level cache: a
 * test file running after another would read the other's runs.
 *
 * ## Seams
 *
 * Git is reached through a `GitRunner` (`../core/git/git.ts`) run in the
 * checkout, and `bun test` through a `SuiteSpawner`, so a unit test
 * stubs both and spawns nothing; the temp directory is a seam too.
 *
 * ## What was measured
 *
 * On git 2.53.0 and bun 1.3.14 under Linux (2026-10-14):
 * `git worktree add --detach <dir> deadbeef` exited 128 with
 * `fatal: invalid reference: deadbeef`, creating no folder; a worktree
 * holding the untracked `node_modules` link was refused by
 * `git worktree remove` without `--force` (`contains modified or
 * untracked files`) and removed with it, the link's target left whole;
 * and `rmSync(<folder>, { recursive: true })` over a folder holding a
 * link to a directory removed the link and left the directory it named
 * whole.
 */
import type { GitRunner } from '@open-tomato/rafa/core/git';
import type { SpawnEnv } from '@open-tomato/rafa/core/loop';
import type { JunitCase, SuiteSpawner } from '@open-tomato/rafa/suite/run';

import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, normalize, relative, sep } from 'node:path';

import { messageOf } from '@open-tomato/rafa/core/config/sections';
import { createGitRunner, gitSaid } from '@open-tomato/rafa/core/git';
import { parseJunitCases, runSuite } from '@open-tomato/rafa/suite/run';

/** The folder name no named test file may sit under. */
const NODE_MODULES = 'node_modules';

/** The prefix of the temporary folder each run makes. */
const SCRATCH_PREFIX = 'rafa-base-run-';

/** How many characters of a commit a problem sentence names. */
const SHORT_COMMIT = 12;

/** The test a bug names: its file and its full case name. */
export interface NamedTest {
  /** The test file, relative to the run checkout or absolute inside it. */
  readonly file: string;
  /** Its describe names, outermost first, and its own, joined by ` > `. */
  readonly name: string;
}

/** What {@link runNamedTestAt} answers for the named case. */
export type BaseRunAnswer =
  /** The run held the case, and it passed. */
  | { readonly answer: 'green' }
  /** The run held the case, and it failed. */
  | { readonly answer: 'red' }
  /** No reading of the case was had; `problem` is one sentence saying why. */
  | { readonly answer: 'unrunnable'; readonly problem: string };

/** What one run of a file at a commit read: its report's cases, or why there is none. */
export type BaseFileRun =
  | { readonly ok: true; readonly cases: readonly JunitCase[] }
  | { readonly ok: false; readonly problem: string };

/** The runs of one rafa run, keyed by commit and file; see the module note. */
export type BaseRunCache = Map<string, Promise<BaseFileRun>>;

/** What a run needs beside the commit and the test. Everything past `cache` is a seam. */
export interface BaseRunOptions {
  /** The run checkout: git runs here, and its `node_modules` is linked into the worktree. */
  readonly checkout: string;
  /** The run's cache, from {@link createBaseRunCache}. */
  readonly cache: BaseRunCache;
  /** Git run in `checkout`; `createGitRunner(checkout)` when left out. */
  readonly git?: GitRunner;
  /** Spawns `bun test`; `runSuite`'s own spawner when left out. */
  readonly spawn?: SuiteSpawner;
  /** The environment `bun test` starts from; `process.env` when left out. */
  readonly env?: Readonly<SpawnEnv>;
  /** Where the temporary folder is made; the system's temp directory when left out. */
  readonly tempRoot?: string;
}

/** A new, empty cache, made once per rafa run. */
export function createBaseRunCache(): BaseRunCache {
  return new Map();
}

/** An `unrunnable` answer saying `problem`. */
function unrunnable(problem: string): BaseRunAnswer {
  return { answer: 'unrunnable', problem };
}

/** A failed run saying `problem`. */
function failedRun(problem: string): BaseFileRun {
  return { ok: false, problem };
}

/** `commit` as a problem sentence names it. */
function shortCommit(commit: string): string {
  return commit.slice(0, SHORT_COMMIT);
}

/**
 * `file` as a path relative to `checkout`, or a problem sentence when it
 * is blank, outside the checkout or under `node_modules`.
 */
function checkoutPath(checkout: string, file: string): { readonly path: string } | { readonly problem: string } {
  if (file.trim() === '') return { problem: 'No test file was named to run.' };
  const path = normalize(isAbsolute(file)
    ? relative(checkout, file)
    : file);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    return { problem: `${file} is outside the run checkout, so it is not run.` };
  }
  if (path.split(sep).includes(NODE_MODULES)) return { problem: `${file} is under ${NODE_MODULES}, so it is not run.` };
  return { path };
}

/** The run of `file` in the worktree at `tree`, its report read from `junitFile`. */
async function runInTree(tree: string, file: string, junitFile: string, commit: string, options: BaseRunOptions): Promise<BaseFileRun> {
  const result = await runSuite({ cwd: tree, paths: [file], junitFile, env: options.env, spawn: options.spawn });
  const cases = result.junit === 'read'
    ? parseJunitCases(readFileSync(junitFile, 'utf8'))
    : null;
  if (cases === null) {
    return failedRun(`bun test wrote no readable report for ${file} at ${shortCommit(commit)} (exit code ${result.exitCode}).`);
  }
  return { ok: true, cases };
}

/** Checks `commit` out at `tree`, links the checkout's `node_modules` in and runs `file`. */
async function checkOutAndRun(tree: string, file: string, junitFile: string, commit: string, options: BaseRunOptions): Promise<BaseFileRun> {
  const short = shortCommit(commit);
  const modules = join(options.checkout, NODE_MODULES);
  if (!existsSync(modules)) return failedRun(`The run checkout holds no ${NODE_MODULES} to link into the worktree at ${short}.`);
  if (!existsSync(join(tree, file))) return failedRun(`${file} does not exist at ${short}.`);
  try {
    symlinkSync(modules, join(tree, NODE_MODULES), 'dir');
  } catch (error) {
    return failedRun(`Could not link ${NODE_MODULES} into the worktree at ${short}: ${messageOf(error)}`);
  }
  return runInTree(tree, file, junitFile, commit, options);
}

/** Removes the worktree at `tree` and the folder `scratch` holding it; see the module note. */
function cleanUp(git: GitRunner, scratch: string, tree: string, added: boolean): void {
  const removed = !added || git(['worktree', 'remove', '--force', tree]).ok;
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    // A folder left in the temp directory changes no answer.
  }
  if (!removed) git(['worktree', 'prune']);
}

/** One run of `file` at `commit` in a temporary worktree, which it removes. Never throws. */
async function runFileAt(commit: string, file: string, options: BaseRunOptions): Promise<BaseFileRun> {
  const git = options.git ?? createGitRunner(options.checkout);
  let scratch: string;
  try {
    scratch = mkdtempSync(join(options.tempRoot ?? tmpdir(), SCRATCH_PREFIX));
  } catch (error) {
    return failedRun(`Could not make a temporary folder for the worktree: ${messageOf(error)}`);
  }
  const tree = join(scratch, 'worktree');
  let added = false;
  try {
    const add = git(['worktree', 'add', '--detach', '--quiet', tree, commit]);
    if (!add.ok) return failedRun(`Could not check out ${shortCommit(commit)} in a temporary worktree: ${gitSaid(add) || 'git said nothing'}`);
    added = true;
    return await checkOutAndRun(tree, file, join(scratch, 'base.junit.xml'), commit, options);
  } catch (error) {
    return failedRun(`Could not run ${file} at ${shortCommit(commit)}: ${messageOf(error)}`);
  } finally {
    cleanUp(git, scratch, tree, added);
  }
}

/** The answer for the case named `name` in `run`. */
function answerFrom(run: BaseFileRun, test: NamedTest, commit: string): BaseRunAnswer {
  if (!run.ok) return unrunnable(run.problem);
  const found = run.cases.find((testCase) => testCase.name === test.name);
  if (found === undefined) return unrunnable(`The run of ${test.file} at ${shortCommit(commit)} held no case named ${test.name}.`);
  if (found.outcome === 'skipped') return unrunnable(`The case ${test.name} of ${test.file} was skipped at ${shortCommit(commit)}.`);
  return found.outcome === 'failed'
    ? { answer: 'red' }
    : { answer: 'green' };
}

/**
 * Runs the file of `test` at `commit` in a detached temporary worktree
 * and answers whether its named case was `green` or `red` there, or
 * `unrunnable` with a problem sentence. One run per commit and file is
 * made for each `options.cache`. Never throws; see the module note.
 */
export async function runNamedTestAt(commit: string, test: NamedTest, options: BaseRunOptions): Promise<BaseRunAnswer> {
  if (commit.trim() === '') return unrunnable('No commit was given to run the test at.');
  if (test.name.trim() === '') return unrunnable(`No case of ${test.file} was named to read.`);
  const located = checkoutPath(options.checkout, test.file);
  if ('problem' in located) return unrunnable(located.problem);
  const key = `${commit}\0${located.path}`;
  const run = options.cache.get(key) ?? runFileAt(commit, located.path, options);
  options.cache.set(key, run);
  return answerFrom(await run, test, commit);
}
