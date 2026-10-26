/**
 * One runnable bug of `rafa bug recheck` (#953), rechecked: its test
 * reference is run through the suite runner and the runs are judged by
 * `../../bugs/recheck-verdict.ts`.
 *
 * {@link recheckBug} runs the reference once. A first run that is
 * `failed` or `stale` stops there: the verdict is `reproduces` or
 * `stale`, with one run. A first run that passed is followed by `runs`
 * more, every one of them made, so a passing reference runs 1 + `runs`
 * times; the sequence is then `gone`, `flaky` with the count of failed
 * runs, or `stale` when a later run was.
 *
 * Each run is `runSuite({ cwd: checkout, paths: [path], testNamePattern,
 * junitFile, env, spawn })`, where:
 *
 *   - `path` is the file `resolveTestReference` answered, relative to the
 *     checkout; the runner hands it on as `./<path>` (`suitePathArgument`),
 *     and the pattern, when there is one, as its own argv word after `-t`.
 *     No shell is involved.
 *   - `junitFile` is `<junitDir>/run-<k>.junit.xml`, `k` counting from 1,
 *     so no run reads another's report.
 *   - `spawn` is one `createDeadlineSpawner(timeoutMs)` shared by the
 *     runs: a run past its deadline has its process group killed and
 *     reads `failed` (`runOutcomeOf`), and {@link RecheckRun.timedOutRuns}
 *     counts it so the report can say it timed out.
 *   - `env` is used as handed in. The caller has already made it
 *     `suiteEnv(process.env)` with the named secrets removed; nothing is
 *     removed here.
 *
 * The runner is a seam ({@link RecheckBugOptions.runSuite}), so the unit
 * tests plant one; left out it is `runSuite` (`../../suite/run.ts`).
 */
import type { RunOutcome } from '../../bugs/recheck-verdict.js';
import type { SpawnEnv } from '@open-tomato/rafa/core/loop';
import type { SuiteResult, SuiteRunOptions } from '@open-tomato/rafa-run';

import { join } from 'node:path';

import { createDeadlineSpawner, runSuite } from '@open-tomato/rafa-run';

import { runOutcomeOf, verdictOf } from '../../bugs/recheck-verdict.js';

/** The runner {@link recheckBug} drives: `runSuite`'s shape. */
export type RecheckSuiteRunner = (options: SuiteRunOptions) => Promise<SuiteResult>;

/** What {@link recheckBug} takes. */
export interface RecheckBugOptions {
  /** The test file, relative to `checkout`, as `resolveTestReference` answered it. */
  readonly path: string;
  /** The `-t` value as one argv word, or null for none. */
  readonly pattern: string | null;
  /** The directory every run runs in. */
  readonly checkout: string;
  /** The child's environment, used as it is. */
  readonly env: Readonly<SpawnEnv>;
  /** The further runs after a first pass; a whole number from 0. */
  readonly runs: number;
  /** One run's deadline, in milliseconds. */
  readonly timeoutMs: number;
  /** The directory the per-run JUnit files are written in. */
  readonly junitDir: string;
  /** `runSuite` when left out. */
  readonly runSuite?: RecheckSuiteRunner;
}

/** What {@link recheckBug} answers. */
export interface RecheckRun {
  readonly verdict: 'reproduces' | 'gone' | 'flaky' | 'stale';
  /** How many runs ran. */
  readonly runs: number;
  /** How many runs failed, on `flaky` only, else null. */
  readonly failedRuns: number | null;
  /** How many runs were killed at their deadline. */
  readonly timedOutRuns: number;
}

/** The JUnit file of run `index` (from 1) under `junitDir`. */
export function recheckJunitFile(junitDir: string, index: number): string {
  return join(junitDir, `run-${index}.junit.xml`);
}

/**
 * Rechecks one runnable bug; see the module note. Throws a `RangeError`
 * for a `runs` that is not a whole number from 0, and, through
 * `createDeadlineSpawner`, for a `timeoutMs` that is not a positive number.
 */
export async function recheckBug(options: RecheckBugOptions): Promise<RecheckRun> {
  if (!Number.isInteger(options.runs) || options.runs < 0) {
    throw new RangeError(`recheckBug: runs must be a whole number from 0, got ${options.runs}`);
  }
  const run = options.runSuite ?? runSuite;
  const spawn = createDeadlineSpawner(options.timeoutMs);
  const reference = { file: options.path, pattern: options.pattern };
  const outcomes: RunOutcome[] = [];
  let timedOutRuns = 0;

  const runOnce = async (): Promise<RunOutcome> => {
    const result = await run({
      cwd: options.checkout,
      paths: [options.path],
      ...(options.pattern === null
        ? {}
        : { testNamePattern: options.pattern }),
      junitFile: recheckJunitFile(options.junitDir, outcomes.length + 1),
      env: options.env,
      spawn,
    });
    if (result.timedOut === true) timedOutRuns += 1;
    const outcome = runOutcomeOf(result, reference);
    outcomes.push(outcome);
    return outcome;
  };

  const first = await runOnce();
  if (first === 'passed') {
    for (let index = 0; index < options.runs; index += 1) await runOnce();
  }

  const sequence = verdictOf(outcomes);
  return {
    verdict: sequence.verdict,
    runs: outcomes.length,
    failedRuns: sequence.verdict === 'flaky'
      ? sequence.failedRuns
      : null,
    timedOutRuns,
  };
}
