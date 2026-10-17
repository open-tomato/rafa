/**
 * The verdict of `rafa bug recheck` (#953): what one run of a bug's test
 * reference showed, and what a sequence of runs says about the bug. Pure:
 * nothing here spawns or reads a file.
 *
 * ## One run
 *
 * {@link runOutcomeOf} reads one `SuiteResult` (`../suite/run.ts`) of a
 * reference into {@link RunOutcome}, in this order:
 *
 *   - a run killed at its deadline (`timedOut`) is `failed`;
 *   - a run that wrote no JUnit file (`junit: 'missing'`) or found no
 *     test file (`noTestFiles`) is `stale`;
 *   - the matched set is the cases of the referenced file whose outcome
 *     is not `skipped` when the reference has a pattern, and every case
 *     of the file when it has none; a failed case in it is `failed`;
 *   - a nonzero exit with no failed case is `failed` when an `unhandled`
 *     block names the file (it threw while it loaded), and `stale` when
 *     none does, since nothing of the reference was judged;
 *   - a run whose cases name no testcase of the file, or whose matched
 *     set is empty, is `stale`;
 *   - anything else is `passed`.
 *
 * The file is compared with a leading `./` and any `.` or doubled `/`
 * segment taken off both sides, so the `./<path>` the runner is handed
 * (`suitePathArgument`) and the `<path>` the JUnit file and Bun's
 * unhandled blocks name read as one file.
 *
 * ## A sequence of runs
 *
 * {@link verdictOf} reads the outcomes in the order they ran:
 *
 *   - the first `stale` is `stale`, and so is an empty sequence;
 *   - the first `failed` is `reproduces`;
 *   - the first `passed` and every later one `passed` is `gone`;
 *   - the first `passed` and a later `stale` is `stale`, whatever else
 *     ran: a reference that stops being judged says nothing of the bug;
 *   - the first `passed` and any later one `failed` is `flaky`, with
 *     `failedRuns` the count of failed runs.
 *
 * {@link RecheckVerdict} also holds `manual` (a reference recheck refuses
 * to run) and `skipped` (an untrusted author), which the command decides
 * before any run; the report reads the whole type from here.
 */
import type { RunnableReference } from './test-reference.js';
import type { SuiteResult } from '../suite/run.js';

import { posix } from 'node:path';

/** What one run of a reference showed; see the module note. */
export type RunOutcome = 'failed' | 'passed' | 'stale';

/** Every verdict a recheck reports for a bug. */
export type RecheckVerdict = 'reproduces' | 'gone' | 'flaky' | 'stale' | 'manual' | 'skipped';

/** What {@link verdictOf} answers: a verdict, and for `flaky` how many runs failed. */
export type SequenceVerdict =
  | { readonly verdict: 'reproduces' | 'gone' | 'stale' }
  | { readonly verdict: 'flaky'; readonly failedRuns: number };

/** The part of a reference a run is judged against: its file, relative to the run's directory, and its pattern. */
export type JudgedReference = Pick<RunnableReference, 'file' | 'pattern'>;

/** `path` with a leading `./` and any `.` or doubled `/` segment taken off. */
function samePath(path: string): string {
  return posix.normalize(path).replace(/^\.\//, '');
}

/** One run of `reference`, read from `result`; see the module note. */
export function runOutcomeOf(result: SuiteResult, reference: JudgedReference): RunOutcome {
  if (result.timedOut === true) return 'failed';
  if (result.junit === 'missing' || result.noTestFiles === true) return 'stale';
  const file = samePath(reference.file);
  const fileCases = (result.cases ?? []).filter((testCase) => samePath(testCase.file) === file);
  const matched = reference.pattern === null
    ? fileCases
    : fileCases.filter((testCase) => testCase.outcome !== 'skipped');
  if (matched.some((testCase) => testCase.outcome === 'failed')) return 'failed';
  if (result.exitCode !== 0) {
    const threw = result.unhandled.some((block) => block.file !== null && samePath(block.file) === file);
    return threw
      ? 'failed'
      : 'stale';
  }
  return matched.length === 0
    ? 'stale'
    : 'passed';
}

/** The verdict of `outcomes`, in the order they ran; see the module note. */
export function verdictOf(outcomes: readonly RunOutcome[]): SequenceVerdict {
  const [first, ...later] = outcomes;
  if (first === undefined || first === 'stale') return { verdict: 'stale' };
  if (first === 'failed') return { verdict: 'reproduces' };
  if (later.includes('stale')) return { verdict: 'stale' };
  const failedRuns = later.filter((outcome) => outcome === 'failed').length;
  return failedRuns === 0
    ? { verdict: 'gone' }
    : { verdict: 'flaky', failedRuns };
}
