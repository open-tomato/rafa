/**
 * What the newest GitHub Actions run on a branch reads as: the reading's
 * shape, the verdict on a run, the exit code of each verdict, the
 * `--log-failed` text of a red run, and the lines text mode prints.
 *
 * This is the library half of `rafa ci status`; its command half,
 * `src/commands/ci/status.ts`, holds the line the command reads (its
 * flags and refusals), the `gh` seam, the json event and the command
 * itself. `src/stretch/pit-readings.ts` reads through this file too, so a
 * pit stop and `rafa ci status --branch` print one run the same way.
 * Nothing here imports a file under `src/commands/`.
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
 * 0 green, 1 red, 2 no run, 3 running. The exit code of a refusal and of
 * a `gh` failure belongs to the command half.
 *
 * Nothing here spawns a process: `gh` arrives as a {@link GhRunner}, the
 * seam a case replaces.
 */
import type { FailedCaseFile } from './failed-cases.js';
import type { BranchRun } from './runs.js';
import type { GhRunner } from '../adapters/tracker/github.js';

/** What a run reads as. */
export type CiVerdict = 'green' | 'red' | 'none' | 'running';

/** The exit code of each verdict; see the module note. */
export const CI_STATUS_EXIT: Readonly<Record<CiVerdict, number>> = Object.freeze({
  green: 0,
  red: 1,
  none: 2,
  running: 3,
});

/** How many characters of the commit the text prints, as `git` abbreviates by default. */
export const SHORT_COMMIT_LENGTH = 7;

/** The only conclusion that reads green. */
const GREEN_CONCLUSION = 'success';

/** Recorded in the stderr of `gh run view --log-failed` for a run whose log was dropped. */
const LOG_DROPPED = 'log not found';

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
