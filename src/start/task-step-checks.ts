/**
 * The checks the runner's task step (`runTaskStep`, `suite-step.ts`)
 * takes over the task's diff once its test run is done: the lint
 * ({@link lintTask}, `lint-step.ts`), then the type step
 * ({@link typeCheckTask}, `type-step.ts`). {@link taskDiffChecks} runs
 * them in that order and answers what {@link Settling} carries of them,
 * which `settleStep` reads into the step's verdict and blocker.
 *
 * The behaviour is described in `suite-step.ts`'s module note (a task
 * step, red, and SIGINT), which stays the one account of the steps; this
 * module only holds the checks' code. A test run read as a stop
 * (`isStepInterrupted`) runs no check, and the answer then carries none;
 * a lint read as a stop runs no type step, and the answer carries the
 * lint alone. The seams, the context and {@link SIGINT_EXIT_CODE} live in
 * `suite-step.ts`, imported back here: the cycle is safe because neither
 * module reads the other's bindings at load, only inside the functions,
 * as with `suite-stage-step.ts`.
 */

import type { LintOutcome } from './lint-step.js';
import type { Settling, SuiteStepContext, SuiteStepSeams, TaskStepInput } from './suite-step.js';
import type { TypeOutcome } from './type-step.js';
import type { SuiteResult } from '../suite/run.js';

import { runLintStep } from './lint-step.js';
import { isStepInterrupted, SIGINT_EXIT_CODE } from './suite-step.js';
import { runTypeStep } from './type-step.js';

/** Lints the task's diff (`lint-step.ts`). */
export function lintTask(context: SuiteStepContext, seams: Required<SuiteStepSeams>, input: TaskStepInput): Promise<LintOutcome> {
  const isInterrupted = context.isInterrupted ?? (() => false);
  return runLintStep({ checkout: context.checkout, base: input.base, task: input.task, git: seams.git, runLint: seams.runLint, stopCode: SIGINT_EXIT_CODE, isInterrupted });
}

/** Type-checks the test files of the task's diff against its base (`type-step.ts`). */
export function typeCheckTask(context: SuiteStepContext, seams: Required<SuiteStepSeams>, input: TaskStepInput): Promise<TypeOutcome> {
  const isInterrupted = context.isInterrupted ?? (() => false);
  return runTypeStep({ checkout: context.checkout, base: input.base, task: input.task, git: seams.git, runTypes: seams.runTypes, stopCode: SIGINT_EXIT_CODE, isInterrupted });
}

/** The task step's checks over its diff after the test run `result`: none when that run was a stop. See the module note. */
export async function taskDiffChecks(context: SuiteStepContext, seams: Required<SuiteStepSeams>, input: TaskStepInput, result: SuiteResult): Promise<Pick<Settling, 'lint' | 'types'>> {
  if (isStepInterrupted(context, result)) return {};
  const lint = await lintTask(context, seams, input);
  if (lint.interrupted) return { lint };
  return { lint, types: await typeCheckTask(context, seams, input) };
}
