/**
 * `rafa ci status --branch=<branch> [--workflow=<name>]`: the newest
 * GitHub Actions run on a branch, its state, its short commit and, when
 * it is red, the bun cases it failed by file and case. Starts no Claude
 * session and declares no `spends`.
 *
 * ## What it reads, in order
 *
 * The line first: no word, `--branch` required and not blank, and
 * `--workflow` not blank when given. So a line refused for its words
 * spawns no `gh`. Then the newest run through `readNewestRun`
 * (`src/ci/runs.ts`), and, only for a finished run that is not green,
 * `gh run view <id> --log-failed`, read by `readFailedCases`
 * (`src/ci/failed-cases.ts`). Both go through one {@link GhRunner} made
 * for the project root, the seam a case replaces.
 *
 * ## The verdict
 *
 * - `none`: the branch has no run (of that workflow, when one is named).
 * - `running`: the newest run's status is any of the five that are not
 *   `completed` (`queued`, `in_progress`, `requested`, `waiting`,
 *   `pending`).
 * - `green`: it completed with the conclusion `success`.
 * - `red`: it completed with any other conclusion, `skipped`, `neutral`
 *   and `cancelled` included: only `success` says the branch passed.
 *
 * A red run whose log `gh` no longer holds (`log not found` on stderr,
 * the reading `src/pr/gh.ts` keeps for an old run) is still red; its
 * failed cases read as null and the text says the log is gone. A red run
 * with no bun `(fail)` line, a set-up step that failed, reads an empty
 * list and says so.
 *
 * ## Exit codes
 *
 * 0 green, 1 red, 2 no run, 3 running. Every refusal and every `gh`
 * failure (a workflow `gh` does not know, a run list it would not
 * answer, a log it would not give for another reason) is exit code 4,
 * so no failure to read is mistaken for a red run. With `--output=json`
 * the {@link CiStatusReading} is written as a named `ci-status` event on
 * every verdict, since the dispatcher drops a result's payload on a
 * non-zero exit, and is the terminal result's data when the run is green.
 */
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { FailedCaseFile } from '../../ci/failed-cases.js';
import type { BranchRun } from '../../ci/runs.js';
import type { RafaCommand, RafaContext } from '../../cli/command.js';

import { createGhRunner } from '../../adapters/tracker/github.js';
import { readFailedCases } from '../../ci/failed-cases.js';
import { readNewestRun } from '../../ci/runs.js';
import { CommandExit } from '../../cli/command.js';
import { messageOf } from '../../config-sections.js';
import { readNonBlankFlag, readRequiredFlag } from '../issue/issue-tracker.js';
import { requireProject } from '../plan/plan-files.js';

/** The usage line every refusal names. */
export const CI_STATUS_USAGE = 'rafa ci status --branch=<branch> [--workflow=<name>]';

/** The name of the json event every reading is written as. */
export const CI_STATUS_EVENT = 'ci-status';

/** What a run reads as. */
export type CiVerdict = 'green' | 'red' | 'none' | 'running';

/** The exit code of each verdict; see the module note. */
export const CI_STATUS_EXIT: Readonly<Record<CiVerdict, number>> = Object.freeze({
  green: 0,
  red: 1,
  none: 2,
  running: 3,
});

/** The exit code of a refusal and of a `gh` failure: apart from every verdict. */
export const CI_STATUS_FAILED_EXIT = 4;

/** How many characters of the commit the text prints, as `git` abbreviates by default. */
export const SHORT_COMMIT_LENGTH = 7;

/** The only conclusion that reads green. */
const GREEN_CONCLUSION = 'success';

/** Recorded in the stderr of `gh run view --log-failed` for a run whose log was dropped. */
const LOG_DROPPED = 'log not found';

/** How the command reaches `gh`. */
export interface CiStatusSeams {
  /** The runner `gh` is spawned through, made for the project root. */
  readonly gh: (root: string) => GhRunner;
}

/** The seams the command ships with: the real `gh`, run at the project root. */
export const DEFAULT_CI_STATUS_SEAMS: CiStatusSeams = Object.freeze({
  gh: (root: string): GhRunner => createGhRunner({ cwd: root }),
});

/** What one line read; json mode's data. */
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

/** A refusal of the line, with the usage. */
function refusal(problem: string): CommandExit {
  return new CommandExit(CI_STATUS_FAILED_EXIT, `❌ rafa ci status: ${problem}\nUsage: ${CI_STATUS_USAGE}`);
}

/** The verdict on `run`; see the module note. */
export function verdictOf(run: BranchRun | null): CiVerdict {
  if (run === null) return 'none';
  if (run.state !== 'completed') return 'running';
  return run.conclusion === GREEN_CONCLUSION
    ? 'green'
    : 'red';
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

/** The line's branch and workflow, refusing a stray word and a missing or blank flag. */
function readLine(context: RafaContext): { branch: string; workflow: string | undefined } {
  if (context.args.length > 0) refuseWords(context.args);
  try {
    const branch = readRequiredFlag(context.flags, 'branch', CI_STATUS_USAGE);
    const workflow = readNonBlankFlag(context.flags, 'workflow', CI_STATUS_USAGE);
    return { branch, workflow };
  } catch (error) {
    if (error instanceof CommandExit) throw new CommandExit(CI_STATUS_FAILED_EXIT, error.message);
    throw error;
  }
}

/** Refuses words the line should not hold. */
function refuseWords(args: readonly string[]): never {
  throw refusal(`expected no argument, got ${String(args.length)}: ${args.join(' ')}`);
}

/** Reads the newest run on the line's branch and, when it is red, its failed cases; see the module note. */
export async function readCiStatus(context: RafaContext, seams: CiStatusSeams): Promise<CiStatusReading> {
  const { branch, workflow } = readLine(context);
  const project = requireProject(context, 'rafa ci status');
  const gh = seams.gh(project.root);
  try {
    const run = await readNewestRun(gh, workflow === undefined
      ? { branch }
      : { branch, workflow });
    const verdict = verdictOf(run);
    const log = run !== null && verdict === 'red'
      ? await readFailedLog(gh, run.id)
      : null;
    return {
      branch,
      workflow: workflow ?? null,
      verdict,
      run,
      failed: log === null
        ? null
        : readFailedCases(log),
      exitCode: CI_STATUS_EXIT[verdict],
    };
  } catch (error) {
    throw new CommandExit(CI_STATUS_FAILED_EXIT, `❌ rafa ci status: ${messageOf(error)}`);
  }
}

/** The run's state as one word: its conclusion once finished, its status before. */
function stateWord(run: BranchRun): string {
  return run.state === 'completed'
    ? run.conclusion ?? 'completed'
    : run.state;
}

/** The headline of a reading. */
function headline(reading: CiStatusReading): string {
  const { run } = reading;
  const where = reading.workflow === null
    ? reading.branch
    : `${reading.branch} (${reading.workflow})`;
  if (run === null) return `⚪ No run on ${where}.`;
  const mark = { green: '✅', red: '❌', running: '⏳', none: '⚪' }[reading.verdict];
  const commit = run.commit.slice(0, SHORT_COMMIT_LENGTH);
  return `${mark} ${where}: ${run.workflow} run ${String(run.id)} is ${stateWord(run)} on ${commit}.`;
}

/** The lines naming a red run's failed cases. */
function failedLines(failed: readonly FailedCaseFile[] | null): string[] {
  if (failed === null) return ['   The run\'s log is no longer on GitHub, so its failed cases cannot be read.'];
  if (failed.length === 0) return ['   No bun test case failed: the run went red outside the tests.'];
  return failed.flatMap((file) => [
    `   ${file.file ?? '(no file named)'}`,
    ...file.cases.map((name) => `     - ${name}`),
  ]);
}

/** Every line text mode prints for a reading. */
export function renderCiStatus(reading: CiStatusReading): string[] {
  const head = headline(reading);
  return reading.verdict === 'red'
    ? [head, ...failedLines(reading.failed)]
    : [head];
}

/** The command, reaching `gh` through `seams`; see the module note. */
export function createCiStatusCommand(seams: CiStatusSeams = DEFAULT_CI_STATUS_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'ci status',
    subject: 'ci',
    action: 'status',
    summary: 'the newest CI run on a branch: its state, its commit and the cases it failed',
    description: 'Reads the newest GitHub Actions run on `--branch`, of the workflow `--workflow` when'
      + ' one is named, and prints its state and its short commit; for a red run it also reads the run\'s'
      + ' failed log and prints the bun cases that failed, by file and case, each once. Only the'
      + ' conclusion `success` is green. Exit code 0 when the run is green, 1 when it is red, 2 when the'
      + ' branch has no run and 3 while the run is not finished; 4 for a line it refuses and for any `gh`'
      + ' failure, a workflow `gh` does not know included. With `--output=json` the branch, the workflow,'
      + ' the verdict, the run, the failed cases and the exit code are written as a `ci-status` event on'
      + ' every verdict, and are the data of the terminal result when the run is green. Starts no session.',
    args: [],
    flags: [
      { name: 'branch', description: 'The branch whose newest run is read.', type: 'string' },
      { name: 'workflow', description: 'Read only runs of this workflow, named as `gh run list --workflow` takes it.', type: 'string' },
    ],
    examples: [
      {
        cmd: 'rafa ci status --branch=stretch/9',
        note: 'Prints the newest run on stretch/9 and, when it is red, the cases it failed.',
      },
      {
        cmd: 'rafa ci status --branch=main --workflow=verify.yml --output=json',
        note: 'Writes the newest verify run on main as a ci-status event.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const reading = await readCiStatus(context, seams);
      const lines = renderCiStatus(reading);
      if (context.outputMode === 'json') {
        context.output.emit({
          type: 'event',
          name: CI_STATUS_EVENT,
          summary: lines[0] ?? '',
          data: reading as unknown as Readonly<Record<string, unknown>>,
          ts: new Date().toISOString(),
        });
        if (reading.exitCode === 0) context.output.result(reading);
        else throw new CommandExit(reading.exitCode, lines.join('\n'));
        return;
      }
      for (const line of lines) context.output.info(line);
      if (reading.exitCode !== 0) throw new CommandExit(reading.exitCode);
    },
  };
  return Object.freeze(command);
}

export default createCiStatusCommand();
