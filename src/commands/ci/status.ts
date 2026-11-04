/**
 * `rafa ci status --branch=<branch> [--workflow=<name>]`: every
 * workflow that ran on a branch's head commit, one line each with its
 * newest run's state, the verdict the worst of theirs, and for each red
 * one the bun cases it failed by file and case. Starts no Claude session
 * and declares no `spends`.
 *
 * This is the command half: the line it reads, the `gh` seam, the json
 * event and the command. Its library half, `src/ci/status-reading.ts`,
 * holds the reading's shape, the verdict, the exit code of each verdict,
 * the failed-log reader and the text lines.
 *
 * ## What it reads, in order
 *
 * The line first: no word, `--branch` required and not blank, and
 * `--workflow` not blank when given. So a line refused for its words
 * spawns no `gh`. Then the runs:
 *
 * - Without `--workflow`, every run of the head commit through
 *   `readHeadRuns` (`src/ci/runs.ts`), the head commit being the
 *   `headSha` of the branch's newest run. Each workflow's line is its
 *   newest run on that commit, so a skipped run of one workflow, newer
 *   than a failed run of another, no longer hides the failure.
 * - With `--workflow`, that workflow's newest run on the branch through
 *   `readNewestRun`, one line or none.
 *
 * Then, only for each red line, `gh run view <id> --log-failed`, read by
 * `readFailedCases` (`src/ci/failed-cases.ts`). Every call goes through
 * one {@link GhRunner} made for the project root, the seam a case
 * replaces.
 *
 * ## The verdict
 *
 * On each line, as `verdictOf` reads its run: `running` before it
 * completes, `green` on `success`, `skipped` or `neutral`, `red` on any
 * other conclusion or none. The command's verdict is the worst of its
 * lines, `red` before `running` before `green`, and `none` when there
 * is no line (no run on the branch, or none of that workflow).
 *
 * A red run whose log `gh` no longer holds (`log not found` on stderr,
 * the reading `packages/rafa-pr/src/pr/gh.ts` keeps for an old run) is still red; its
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
 * the {@link CiBranchReading} is written as a named `ci-status` event on
 * every verdict, since the dispatcher drops a result's payload on a
 * non-zero exit, and is the terminal result's data when it is green.
 */
import type { BranchRun } from '../../ci/runs.js';
import type { CiBranchReading } from '../../ci/status-reading.js';
import type { RafaCommand, RafaContext } from '@open-tomato/rafa/core/command';
import type { GhRunner } from '@open-tomato/rafa-board';

import { createGhRunner, readNonBlankFlag, readRequiredFlag } from '@open-tomato/rafa-board';

import { requireProject } from '@open-tomato/rafa/commands/plan/plan-files';
import { CommandExit } from '@open-tomato/rafa/core/command';
import { messageOf } from '@open-tomato/rafa/core/config/sections';

import { readHeadRuns, readNewestRun } from '../../ci/runs.js';
import { branchReading, readWorkflowReadings, renderCiBranch } from '../../ci/status-reading.js';

/** The usage line every refusal names. */
export const CI_STATUS_USAGE = 'rafa ci status --branch=<branch> [--workflow=<name>]';

/** The name of the json event every reading is written as. */
export const CI_STATUS_EVENT = 'ci-status';

/** The exit code of a refusal and of a `gh` failure: apart from every verdict. */
export const CI_STATUS_FAILED_EXIT = 4;

/** How the command reaches `gh`. */
export interface CiStatusSeams {
  /** The runner `gh` is spawned through, made for the project root. */
  readonly gh: (root: string) => GhRunner;
}

/** The seams the command ships with: the real `gh`, run at the project root. */
export const DEFAULT_CI_STATUS_SEAMS: CiStatusSeams = Object.freeze({
  gh: (root: string): GhRunner => createGhRunner({ cwd: root }),
});

/** A refusal of the line, with the usage. */
function refusal(problem: string): CommandExit {
  return new CommandExit(CI_STATUS_FAILED_EXIT, `❌ rafa ci status: ${problem}\nUsage: ${CI_STATUS_USAGE}`);
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

/** The runs the line's lines are read from, newest first: the head commit's, or one workflow's newest. */
async function readLineRuns(gh: GhRunner, branch: string, workflow: string | undefined): Promise<readonly BranchRun[]> {
  if (workflow === undefined) return (await readHeadRuns(gh, branch))?.runs ?? [];
  const run = await readNewestRun(gh, { branch, workflow });
  return run === null
    ? []
    : [run];
}

/** Reads every workflow on the line's branch and the failed cases of each red one; see the module note. */
export async function readCiStatus(context: RafaContext, seams: CiStatusSeams): Promise<CiBranchReading> {
  const { branch, workflow } = readLine(context);
  const project = requireProject(context, 'rafa ci status');
  const gh = seams.gh(project.root);
  try {
    const runs = await readLineRuns(gh, branch, workflow);
    const lines = await readWorkflowReadings(gh, runs);
    return branchReading(branch, workflow ?? null, lines);
  } catch (error) {
    throw new CommandExit(CI_STATUS_FAILED_EXIT, `❌ rafa ci status: ${messageOf(error)}`);
  }
}

/** The command, reaching `gh` through `seams`; see the module note. */
export function createCiStatusCommand(seams: CiStatusSeams = DEFAULT_CI_STATUS_SEAMS): RafaCommand {
  const command: RafaCommand = {
    name: 'ci status',
    subject: 'ci',
    action: 'status',
    summary: 'every CI workflow on a branch\'s head commit: its state, the commit and the cases it failed',
    description: 'Reads every GitHub Actions run of the head commit of `--branch` (the commit of its newest'
      + ' run) and prints one line per workflow, its newest run on that commit and its state, under a headline'
      + ' with the verdict and the short commit; with `--workflow` it reads only that workflow\'s newest run on'
      + ' the branch. For each red line it also reads the run\'s failed log and prints the bun cases that failed,'
      + ' by file and case, each once. Success, skipped and neutral are green, and the verdict is the worst of'
      + ' the lines: one red workflow makes the branch red. Exit code 0 when it is green, 1 when it is red, 2'
      + ' when there is no run and 3 while a run is not finished; 4 for a line it refuses and for any `gh`'
      + ' failure, a workflow `gh` does not know included. With `--output=json` the branch, the workflow, the'
      + ' commit, the verdict, the lines with their runs and failed cases, and the exit code are written as a'
      + ' `ci-status` event on every verdict, and are the data of the terminal result when it is green.'
      + ' Starts no session.',
    args: [],
    flags: [
      { name: 'branch', description: 'The branch whose head commit\'s runs are read.', type: 'string' },
      { name: 'workflow', description: 'Read only this workflow\'s newest run, named as `gh run list --workflow` takes it.', type: 'string' },
    ],
    examples: [
      {
        cmd: 'rafa ci status --branch=stretch/9',
        note: 'Prints every workflow on the head commit of stretch/9 and the cases each red one failed.',
      },
      {
        cmd: 'rafa ci status --branch=main --workflow=verify.yml --output=json',
        note: 'Writes the newest verify run on main as a ci-status event.',
      },
    ],
    outputs: ['text', 'json'],
    run: async (context) => {
      const reading = await readCiStatus(context, seams);
      const lines = renderCiBranch(reading);
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

const command: RafaCommand = createCiStatusCommand();
export default command;
