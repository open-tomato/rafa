/**
 * What the GitHub Actions runs on a branch read as: the verdict on a run,
 * the verdict on a branch (the worst of its workflows), the exit code of
 * each verdict, the `--log-failed` text of a red run, the reading's
 * shape, and the lines text mode prints.
 *
 * This is the library half of `rafa ci status`; its command half,
 * `src/commands/ci/status.ts`, holds the line the command reads (its
 * flags and refusals), the `gh` seam, the json event and the command
 * itself. `src/stretch/pit-readings.ts` reads through this file too, so a
 * pit stop and `rafa ci status --branch` print one reading the same way.
 * Nothing here imports a file under `src/commands/`.
 *
 * ## The reading, one line per workflow
 *
 * A {@link CiBranchReading} holds one {@link CiWorkflowReading} per
 * workflow: the newest run of that workflow among the runs it is built
 * from, picked by {@link newestPerWorkflow}. Built from every run of the
 * head commit (`readHeadRuns`, `./runs.ts`), it holds every workflow that
 * ran on that commit; built from one workflow's newest run, it holds that
 * one line. One workflow can hold two runs of one commit (a `push` and a
 * `pull_request` run of `verify`); its line is the newer.
 *
 * The planted case, the `90471b00` runs of `stretch/111`: the fragment
 * workflow's run 41456634201 `skipped`, newest, above the `verify` runs
 * 41456633215 and 41456159309, both `failure`. The reading holds two
 * lines, the fragment green and `verify` red on its newer run, and reads
 * red; the newest run of the commit alone read the skip and passed.
 *
 * ## The verdict
 *
 * On one run ({@link verdictOf}):
 *
 * - `running`: its status is any of the five that are not `completed`
 *   (`queued`, `in_progress`, `requested`, `waiting`, `pending`).
 * - `green`: it completed with a passing conclusion, `success`,
 *   `skipped` or `neutral`: a workflow that ran nothing failed nothing.
 * - `red`: it completed with any other conclusion (`failure`,
 *   `cancelled`, `timed_out`, `action_required`, `startup_failure`,
 *   `stale`), or with none.
 * - `none`: there is no run.
 *
 * On a branch ({@link worstVerdict}), the worst of its workflows', worst
 * first: `red`, `running`, `green`, `none`. So one red workflow makes the
 * branch red whatever ran beside it, a workflow still running holds a
 * branch that is otherwise green, and a branch with no workflow reads
 * `none`.
 *
 * A red run whose log `gh` no longer holds (`log not found` on stderr,
 * the reading `packages/rafa-pr/src/pr/gh.ts` keeps for an old run) is still red; its
 * failed cases read as null and the text says the log is gone. A red run
 * with no bun `(fail)` line, a set-up step that failed, reads an empty
 * list and says so.
 *
 * ## Exit codes
 *
 * 0 green, 1 red, 2 no run, 3 running. The exit code of a refusal and of
 * a `gh` failure belongs to the command half.
 *
 * ## The single-run reading
 *
 * {@link CiStatusReading} and {@link renderCiStatus} read the newest run
 * alone, under the same pass rule; `rafa ci status` and the pit stop
 * still print through them, and leave them once they read per workflow.
 *
 * Nothing here spawns a process: `gh` arrives as a {@link GhRunner}, the
 * seam a case replaces.
 */
import type { FailedCaseFile } from './failed-cases.js';
import type { BranchRun } from './runs.js';
import type { GhRunner } from '@open-tomato/rafa-board';

import { readFailedCases } from './failed-cases.js';

/** What a run, a workflow or a branch reads as. */
export type CiVerdict = 'green' | 'red' | 'none' | 'running';

/** The exit code of each verdict; see the module note. */
export const CI_STATUS_EXIT: Readonly<Record<CiVerdict, number>> = Object.freeze({
  green: 0,
  red: 1,
  none: 2,
  running: 3,
});

/** The verdicts, worst first: the order {@link worstVerdict} reads. */
export const VERDICTS_WORST_FIRST: readonly CiVerdict[] = Object.freeze(['red', 'running', 'green', 'none']);

/** The conclusions that read green; every other conclusion of a finished run is red. */
export const PASSING_CONCLUSIONS: readonly string[] = Object.freeze(['success', 'skipped', 'neutral']);

/** How many characters of the commit the text prints, as `git` abbreviates by default. */
export const SHORT_COMMIT_LENGTH = 7;

/** Recorded in the stderr of `gh run view --log-failed` for a run whose log was dropped. */
const LOG_DROPPED = 'log not found';

/** The mark each verdict's line opens with. */
const MARK: Readonly<Record<CiVerdict, string>> = Object.freeze({ green: '✅', red: '❌', running: '⏳', none: '⚪' });

/** How far a workflow's line is indented under the headline. */
const WORKFLOW_INDENT = '   ';

/** How far a red workflow's failed-case lines are indented under its line. */
const CASE_INDENT = '     ';

/** One workflow's line: its newest run and, when that run is red, its failed cases. */
export interface CiWorkflowReading {
  /** The workflow's name, as the run carries it. */
  readonly workflow: string;
  /** The verdict on {@link CiWorkflowReading.run}. */
  readonly verdict: CiVerdict;
  /** The workflow's newest run. */
  readonly run: BranchRun;
  /**
   * The failed cases of a red run by file; null for a run that is not
   * red and for a red run whose log `gh` no longer holds.
   */
  readonly failed: readonly FailedCaseFile[] | null;
}

/** What a branch reads as, one line per workflow; json mode's data. */
export interface CiBranchReading {
  readonly branch: string;
  /** The workflow the line named, or null for every workflow. */
  readonly workflow: string | null;
  /** The full sha every line's run ran on, or null when there is no line. */
  readonly commit: string | null;
  /** The worst of the lines' verdicts, `none` when there is no line. */
  readonly verdict: CiVerdict;
  /** One line per workflow, in the order of their newest runs, newest first. */
  readonly workflows: readonly CiWorkflowReading[];
  /** The exit code the verdict ends with. */
  readonly exitCode: number;
}

/** What one line read through the newest run alone; see the module note. */
export interface CiStatusReading {
  readonly branch: string;
  /** The workflow the line named, or null for any. */
  readonly workflow: string | null;
  readonly verdict: CiVerdict;
  /** The newest run, or null when the branch has none. */
  readonly run: BranchRun | null;
  /**
   * The failed cases of a red run by file; null for a run that is not
   * red and for a red run whose log `gh` no longer holds.
   */
  readonly failed: readonly FailedCaseFile[] | null;
  /** The exit code the verdict ends with. */
  readonly exitCode: number;
}

/** The verdict on `run`; see the module note. */
export function verdictOf(run: BranchRun | null): CiVerdict {
  if (run === null) return 'none';
  if (run.state !== 'completed') return 'running';
  return run.conclusion !== null && PASSING_CONCLUSIONS.includes(run.conclusion)
    ? 'green'
    : 'red';
}

/** The worst of `verdicts` in {@link VERDICTS_WORST_FIRST}, `none` for an empty list. */
export function worstVerdict(verdicts: readonly CiVerdict[]): CiVerdict {
  return VERDICTS_WORST_FIRST.find((verdict) => verdicts.includes(verdict)) ?? 'none';
}

/**
 * The newest run of each workflow among `runs`, which come newest first
 * as `gh run list` answers them: the first run of each workflow name, in
 * the order those runs come.
 */
export function newestPerWorkflow(runs: readonly BranchRun[]): BranchRun[] {
  return runs.filter((run, index) => runs.findIndex((other) => other.workflow === run.workflow) === index);
}

/** The `--log-failed` text of run `id`, or null when `gh` no longer holds it. */
export async function readFailedLog(gh: GhRunner, id: number): Promise<string | null> {
  const args = ['run', 'view', String(id), '--log-failed'];
  const result = await gh(args);
  if (result.ok) return result.stdout;
  if (result.stderr.includes(LOG_DROPPED)) return null;
  const detail = result.stderr.trim() || result.stdout.trim() || 'it exited non-zero and wrote nothing';
  throw new Error(`gh ${args.join(' ')} failed: ${detail}`);
}

/**
 * One line per workflow among `runs` (newest first), each the newest
 * run of its workflow; the failed log of each red one is read through
 * `gh`, one after another in the lines' order, and of no other. Throws
 * as {@link readFailedLog} does.
 */
export async function readWorkflowReadings(gh: GhRunner, runs: readonly BranchRun[]): Promise<CiWorkflowReading[]> {
  const readings: CiWorkflowReading[] = [];
  for (const run of newestPerWorkflow(runs)) {
    const verdict = verdictOf(run);
    const log = verdict === 'red'
      ? await readFailedLog(gh, run.id)
      : null;
    const failed = log === null
      ? null
      : readFailedCases(log);
    readings.push({ workflow: run.workflow, verdict, run, failed });
  }
  return readings;
}

/**
 * The reading of `branch` from its `workflows` lines, its verdict the
 * worst of theirs. Throws a `TypeError` on two lines of one workflow and
 * on lines whose runs ran on two commits: neither is one commit's
 * reading.
 */
export function branchReading(branch: string, workflow: string | null, workflows: readonly CiWorkflowReading[]): CiBranchReading {
  const names = workflows.map((line) => line.workflow);
  const twice = names.find((name, index) => names.indexOf(name) !== index);
  if (twice !== undefined) throw new TypeError(`ci status: two lines of the workflow ${twice}, expected one per workflow`);
  const commits = [...new Set(workflows.map((line) => line.run.commit))];
  if (commits.length > 1) throw new TypeError(`ci status: lines of the commits ${commits.join(', ')}, expected one commit`);
  const verdict = worstVerdict(workflows.map((line) => line.verdict));
  return { branch, workflow, commit: commits[0] ?? null, verdict, workflows, exitCode: CI_STATUS_EXIT[verdict] };
}

/** The run's state as one word: its conclusion once finished, its status before. */
function stateWord(run: BranchRun): string {
  return run.state === 'completed'
    ? run.conclusion ?? 'completed'
    : run.state;
}

/** Where a reading looked: the branch, and the workflow when one was named. */
function whereOf(branch: string, workflow: string | null): string {
  return workflow === null
    ? branch
    : `${branch} (${workflow})`;
}

/** The lines naming a red run's failed cases, each opening with `indent`. */
function failedLines(failed: readonly FailedCaseFile[] | null, indent: string): string[] {
  if (failed === null) return [`${indent}The run's log is no longer on GitHub, so its failed cases cannot be read.`];
  if (failed.length === 0) return [`${indent}No bun test case failed: the run went red outside the tests.`];
  return failed.flatMap((file) => [
    `${indent}${file.file ?? '(no file named)'}`,
    ...file.cases.map((name) => `${indent}  - ${name}`),
  ]);
}

/** One workflow's line and, when it is red, its failed cases under it. */
function workflowLines(line: CiWorkflowReading): string[] {
  const { run } = line;
  const head = `${WORKFLOW_INDENT}${MARK[line.verdict]} ${line.workflow} run ${String(run.id)} is ${stateWord(run)}.`;
  return line.verdict === 'red'
    ? [head, ...failedLines(line.failed, CASE_INDENT)]
    : [head];
}

/**
 * Every line text mode prints for a branch reading: a headline with the
 * verdict and the short commit, then one line per workflow, each red
 * one followed by its failed cases.
 */
export function renderCiBranch(reading: CiBranchReading): string[] {
  const where = whereOf(reading.branch, reading.workflow);
  if (reading.commit === null) return [`${MARK.none} No run on ${where}.`];
  const count = reading.workflows.length;
  const commit = reading.commit.slice(0, SHORT_COMMIT_LENGTH);
  const noun = count === 1
    ? 'workflow'
    : 'workflows';
  const headline = `${MARK[reading.verdict]} ${where}: ${reading.verdict} on ${commit}, ${String(count)} ${noun}.`;
  return [headline, ...reading.workflows.flatMap(workflowLines)];
}

/** The headline of a single-run reading. */
function headline(reading: CiStatusReading): string {
  const { run } = reading;
  const where = whereOf(reading.branch, reading.workflow);
  if (run === null) return `${MARK.none} No run on ${where}.`;
  const commit = run.commit.slice(0, SHORT_COMMIT_LENGTH);
  return `${MARK[reading.verdict]} ${where}: ${run.workflow} run ${String(run.id)} is ${stateWord(run)} on ${commit}.`;
}

/** Every line text mode prints for a single-run reading. */
export function renderCiStatus(reading: CiStatusReading): string[] {
  const head = headline(reading);
  return reading.verdict === 'red'
    ? [head, ...failedLines(reading.failed, WORKFLOW_INDENT)]
    : [head];
}
