/**
 * The task step the runner takes after each task commits:
 * {@link runTaskStep}, and {@link TaskStepInput}, what it is handed about
 * the task.
 *
 * The behaviour is described in `suite-step.ts`'s module note (the task
 * step, its recorded reason, red and SIGINT), which stays the one
 * account of all four steps; this module only holds the task step's
 * code, and `suite-step.ts` re-exports both names so callers keep
 * importing them from there. The run, record, settle and retake helpers
 * it shares with the other steps live in `suite-step.ts`, imported back
 * here, as `suite-stage-step.ts` imports them: the cycle is safe because
 * neither module reads the other's bindings at load, only inside the
 * functions.
 */

import type { Settling, StepOutcome, StepRuns, SuiteStepContext, SuiteStepSeams } from './suite-step.js';
import type { SuiteBaseline } from '../suite/baseline.js';
import type { CheckRun } from '../suite/checks.js';
import type { SessionStepReason } from '@open-tomato/rafa/core/loop';
import type { TestScope } from '@open-tomato/rafa/core/plan';

import { activeOutput } from '@open-tomato/rafa/core/output';

import { resolveChecks } from '../suite/checks.js';

import { isRepairTask } from './suite-blocker.js';
import { takeRetakes } from './suite-retake-alone.js';
import {
  alwaysRunJunitFileFor,
  junitFileFor,
  planDiffReader,
  readDiff,
  runWithAlwaysRun,
  seamsOf,
  settleStep,
} from './suite-step.js';
import { reportSlowSweeps } from './sweep-timing.js';
import { readTaskAlwaysRun, withAlwaysRun } from './task-always-run.js';
import { taskDiffChecks } from './task-step-checks.js';

/** What {@link runTaskStep} is handed about the task just committed. */
export interface TaskStepInput {
  readonly baseline: SuiteBaseline | null;
  /** The commit the task started from, which its diff and `--changed` are taken against. */
  readonly base: string;
  /** The task line's `tests=` value, or its default. */
  readonly declared: TestScope;
  /** The task's sentence, for the blocker text. */
  readonly task: string;
}

/** The entry a task step resolves, today's `affected`; the line's `tests=` value narrows or widens it. */
const TASK_ENTRY = ['affected'] as const;

/** The runs a task's check run asks for, with the `tests.alwaysRun` files `alwaysRun` added; see the module note. */
function taskNarrowing(run: CheckRun, base: string, alwaysRun: readonly string[]): StepRuns {
  if (run.kind === 'paths') return { narrowing: { paths: withAlwaysRun(run.paths, alwaysRun) }, alwaysRun: [], timed: alwaysRun };
  if (run.kind === 'affected') return { narrowing: { changedSince: base }, alwaysRun, timed: alwaysRun };
  return { narrowing: {}, alwaysRun: [], timed: [] };
}

/** The scope the run record holds for a task's check run: `module` for its path list, which only a `tests=module` line reaches. */
function taskRecordedScope(run: CheckRun | null): TestScope {
  if (run === null || run.kind === 'full' || run.kind === 'none') return 'full';
  return run.kind === 'paths'
    ? 'module'
    : 'affected';
}

/**
 * The reason the run record holds for a task's check run: the run's own,
 * or `declared` for a path list, which only a `tests=module` line
 * reaches; none for a diff that did not read. See the module note.
 */
function taskStepReason(run: CheckRun | null): SessionStepReason | undefined {
  if (run === null || run.kind === 'none') return undefined;
  return run.kind === 'paths'
    ? 'declared'
    : run.reason;
}

/** The preload files, with a warning when `bunfig.toml` does not read. */
function preloadOf(context: SuiteStepContext, seams: Required<SuiteStepSeams>): readonly string[] {
  const reading = seams.readPreloadFiles(context.checkout);
  if (reading.state === 'unreadable') activeOutput().warn(`⚠️  bunfig.toml does not read (${reading.reason}); no preload file is a full-suite trigger.`);
  return reading.files;
}

/** The task step's check run over `diff`, the task's own, or null when that did not read. */
async function taskScopeOf(context: SuiteStepContext, seams: Required<SuiteStepSeams>, input: TaskStepInput, diff: readonly string[] | null): Promise<CheckRun | null> {
  if (diff === null) return null;
  const moduleLine = input.declared === 'module';
  return resolveChecks({
    names: TASK_ENTRY,
    declared: input.declared,
    diff,
    owns: moduleLine
      ? await context.owns()
      : null,
    testFiles: moduleLine
      ? seams.listTestFiles(context.checkout)
      : [],
    preload: preloadOf(context, seams),
    fullSuiteTriggers: context.settings.testsFullSuiteTriggers,
    contract: [],
    integration: [],
  });
}

/** Runs the task step after a task commits; see `suite-step.ts`'s module note. */
export async function runTaskStep(context: SuiteStepContext, input: TaskStepInput): Promise<StepOutcome> {
  const seams = seamsOf(context);
  const diff = readDiff(seams.git, input.base);
  const scope = await taskScopeOf(context, seams, input, diff);
  const runs = scope === null || scope.kind === 'full' || scope.kind === 'none'
    ? { narrowing: {}, alwaysRun: [], timed: [] }
    : taskNarrowing(scope, input.base, readTaskAlwaysRun(seams.git, context.settings.testsAlwaysRun));
  const recorded = taskRecordedScope(scope);
  const result = await runWithAlwaysRun(context, seams, 'task', runs);
  const label = `task step after "${input.task}"`;
  const checks = await taskDiffChecks(context, seams, input, result);
  const settling: Settling = { kind: 'task', scope: recorded, reason: taskStepReason(scope), label, result, baseline: input.baseline, repair: { kind: 'task', task: input.task }, ...checks };
  const touched = isRepairTask(input.task)
    ? planDiffReader(seams, input.baseline, diff)
    : () => diff;
  const outcome = settleStep(context, seams, await takeRetakes(context, seams, settling, () => runWithAlwaysRun(context, seams, 'task', runs), touched));
  const timedIn = runs.alwaysRun.length > 0
    ? alwaysRunJunitFileFor(context.repoRoot, context.sessionId)
    : junitFileFor(context.repoRoot, context.sessionId, 'task');
  if (!outcome.interrupted) reportSlowSweeps(timedIn, runs.timed);
  return outcome;
}
