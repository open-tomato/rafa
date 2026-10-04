/**
 * The `tests.alwaysRun` files in the runner's task step (`runTaskStep`,
 * `suite-step.ts`): which tracked files the setting names, and how the
 * run over them joins the step's own run, so that one settling reads the
 * failures of both.
 *
 * ## Why the step runs them
 *
 * `bun test --changed=<base>` follows the import graph from the changed
 * files. A content sweep imports no project file and reads the tree at
 * run time, so no changed file ever selects one, and a task can break a
 * sweep under a green `affected` step. The task prompt names the sweeps
 * to the session (`task-gate-lines.ts`); the step runs them itself, so a
 * session that skipped them is still caught.
 *
 * ## How each scope takes them
 *
 * | Scope | What the step runs |
 * |---|---|
 * | `full` | the whole project, which already holds the sweeps: nothing added |
 * | `module` | one run over its test files and the always-run files, each path once |
 * | `affected` | `bun test --changed=<base>`, then a second run over the always-run files |
 *
 * `affected` takes two runs because Bun filters one selection by the
 * other. Measured on bun 1.4.2 in a scratch repository holding `a.ts`, its
 * test `a.test.ts`, and `x.sweep.test.ts` importing nothing, with `a.ts`
 * changed since the base: `bun test --changed=<base> ./x.sweep.test.ts`
 * printed `1 changed file, but no test files are affected` and ran no
 * file, and with nothing changed it printed `no changed files, nothing
 * to run`. `bun test --changed=<base> ./x.sweep.test.ts ./a.test.ts` ran
 * `1/2 test files`, the one the graph reaches. The control, `bun test
 * --changed=<base> ./a.test.ts`, ran `a.test.ts`, so the path was read;
 * the sweep was filtered out by `--changed`.
 *
 * ## The fold
 *
 * {@link foldResults} makes the two runs one `SuiteResult`, which the step
 * settles as it settles any run: one recorded step, one verdict, one
 * blocker on its repair task. The folded result holds both commands,
 * joined by `;`, the failures of both with each test file and name pair
 * once (a changed sweep can run in both), the errors of both summed, and
 * both summary lines. Its exit code is the stop code when either run
 * ended on it, so a SIGINT during either run still reads as a stop; else
 * the exit code of a run that exited nonzero with no summary line and
 * held test files, with the summary dropped, so the step reads that run
 * as unreported; else the first nonzero exit code; else 0.
 *
 * A list that resolves to no file, `[]` or a glob matching nothing, adds
 * nothing to either scope and says nothing. When `git ls-files` does not
 * answer, {@link readTaskAlwaysRun} warns and answers no file: the step
 * then runs what it ran before the setting existed.
 */
import type { GitRunner } from '../pr/index.js';
import type { JunitReading, SuiteFailure, SuiteResult } from '../suite/run.js';

import { activeOutput } from '../adapters/output/active.js';
import { gitSaid } from '../pr/index.js';
import { suitePathArgument } from '../suite/run.js';

import { alwaysRunFiles } from './task-gate-lines.js';

/** The word the folded command joins the two runs' commands with. */
export const FOLDED_COMMAND_JOINER = ';';

/**
 * The `tests.alwaysRun` files tracked in the checkout `git` runs in. None
 * for no glob, without asking git; none with a warning when git does not
 * answer. See the module note.
 */
export function readTaskAlwaysRun(git: GitRunner, globs: readonly string[]): readonly string[] {
  if (globs.length === 0) return [];
  const result = git(['ls-files', '-z']);
  if (!result.ok) {
    activeOutput().warn(`⚠️  git ls-files did not answer (${gitSaid(result) || 'nothing said'}); the task step runs no tests.alwaysRun file.`);
    return [];
  }
  return alwaysRunFiles(globs, result.stdout.split('\0').filter((path) => path !== ''));
}

/** `paths` followed by each of `added` it does not already name, compared as `bun test` reads them. */
export function withAlwaysRun(paths: readonly string[], added: readonly string[]): readonly string[] {
  const named = new Set(paths.map(suitePathArgument));
  return [...paths, ...added.filter((path) => !named.has(suitePathArgument(path)))];
}

/** True when `result` exited nonzero with no summary line and held test files. */
function unreported(result: SuiteResult): boolean {
  return result.exitCode !== 0 && result.summary === null && result.noTestFiles !== true;
}

/** The folded exit code; see the module note. */
function foldedExit(first: SuiteResult, second: SuiteResult, stopCode: number): number {
  if (first.exitCode === stopCode || second.exitCode === stopCode) return stopCode;
  const silent = [first, second].find(unreported);
  if (silent !== undefined) return silent.exitCode;
  return first.exitCode !== 0
    ? first.exitCode
    : second.exitCode;
}

/** The failures of both runs, each file and name pair once, in the order first read. */
function foldedFailures(first: SuiteResult, second: SuiteResult): readonly SuiteFailure[] {
  const held = new Set(first.failures.map((failure) => JSON.stringify([failure.file, failure.name])));
  return [...first.failures, ...second.failures.filter((failure) => !held.has(JSON.stringify([failure.file, failure.name])))];
}

/** The errors of both runs summed; null when neither printed a summary to read them from. */
function foldedErrors(first: SuiteResult, second: SuiteResult): number | null {
  if (first.errors === null && second.errors === null) return null;
  return (first.errors ?? 0) + (second.errors ?? 0);
}

/** Both summary lines, or null when a run is unreported or neither printed one. */
function foldedSummary(first: SuiteResult, second: SuiteResult): string | null {
  if (unreported(first) || unreported(second)) return null;
  const lines = [first.summary, second.summary].filter((line) => line !== null);
  return lines.length === 0
    ? null
    : lines.join(` ${FOLDED_COMMAND_JOINER} `);
}

/** `unreadable` when either JUnit file was, else `read` when either was, else `missing`. */
function foldedJunit(first: SuiteResult, second: SuiteResult): JunitReading {
  const readings = [first.junit, second.junit];
  if (readings.includes('unreadable')) return 'unreadable';
  return readings.includes('read')
    ? 'read'
    : 'missing';
}

/**
 * The task step's run and its always-run run as one result, which the
 * step settles once. `stopCode` is the exit code read as SIGINT. See the
 * module note for each field.
 */
export function foldResults(first: SuiteResult, second: SuiteResult, stopCode: number): SuiteResult {
  const folded: SuiteResult = {
    command: [...first.command, FOLDED_COMMAND_JOINER, ...second.command],
    exitCode: foldedExit(first, second, stopCode),
    summary: foldedSummary(first, second),
    failures: foldedFailures(first, second),
    errors: foldedErrors(first, second),
    junit: foldedJunit(first, second),
  };
  return first.noTestFiles === true && second.noTestFiles === true
    ? { ...folded, noTestFiles: true }
    : folded;
}
