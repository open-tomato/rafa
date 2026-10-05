/**
 * The checks the runner's task step (`runTaskStep`, `suite-step.ts`)
 * takes over the task's diff once its test run is done: today the lint
 * ({@link lintTask}, `lint-step.ts`). {@link taskDiffChecks} runs them in
 * order and answers what {@link Settling} carries of them, which
 * `settleStep` reads into the step's verdict and blocker.
 *
 * The behaviour is described in `suite-step.ts`'s module note (a task
 * step, red, and SIGINT), which stays the one account of the steps; this
 * module only holds the checks' code. A test run read as a stop
 * (`isStepInterrupted`) runs no check, and the answer then carries none.
 * The seams, the context and {@link SIGINT_EXIT_CODE} live in
 * `suite-step.ts`, imported back here: the cycle is safe because neither
 * module reads the other's bindings at load, only inside the functions,
 * as with `suite-stage-step.ts`.
 */

import type { LintOutcome } from './lint-step.js';
import type { Settling, SuiteStepContext, SuiteStepSeams, TaskStepInput } from './suite-step.js';
import type { SuiteResult } from '../suite/run.js';

import { runLintStep } from './lint-step.js';
import { isStepInterrupted, SIGINT_EXIT_CODE } from './suite-step.js';

/** Lints the task's diff (`lint-step.ts`). */
export function lintTask(context: SuiteStepContext, seams: Required<SuiteStepSeams>, input: TaskStepInput): Promise<LintOutcome> {
  const isInterrupted = context.isInterrupted ?? (() => false);
  return runLintStep({ checkout: context.checkout, base: input.base, task: input.task, git: seams.git, runLint: seams.runLint, stopCode: SIGINT_EXIT_CODE, isInterrupted });
}

/** The task step's checks over its diff after the test run `result`: none when that run was a stop. See the module note. */
export async function taskDiffChecks(context: SuiteStepContext, seams: Required<SuiteStepSeams>, input: TaskStepInput, result: SuiteResult): Promise<Pick<Settling, 'lint'>> {
  if (isStepInterrupted(context, result)) return {};
  return { lint: await lintTask(context, seams, input) };
}
