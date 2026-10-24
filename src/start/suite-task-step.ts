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
 * functions. {@link checkRunsOf} is exported for the pre-wrap-up step
 * (`suite-step.ts`), which runs a path list or `affected` as this step does.
 */

import type { Settling, StepOutcome, StepRuns, SuiteStepContext, SuiteStepSeams } from './suite-step.js';
import type { SuiteBaseline } from '../suite/baseline.js';
import type { CheckRun } from '../suite/checks.js';
import type { SuiteResult } from '../suite/run.js';
import type { CheckName } from '@open-tomato/rafa/config-schema-checks';
import type { SessionStep, SessionStepReason } from '@open-tomato/rafa/core/loop';
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
  recordStep,
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
  /** The task line's `tests=` value, or null when the line declares none. */
  readonly declared: TestScope | null;
  /** The task's sentence, for the blocker text. */
  readonly task: string;
}

/** The checks whose answer is a path list, read off the project's test files. */
const PATH_CHECKS: ReadonlySet<CheckName> = new Set(['related', 'unit', 'contract', 'integration']);

/** What a step that ran no suite settles with: no command, exit code 0, nothing failed. */
const NOTHING_RAN: SuiteResult = Object.freeze({
  command: [],
  exitCode: 0,
  summary: null,
  failures: [],
  errors: 0,
  junit: 'missing',
  unhandled: [],
  outputTail: [],
});

/** How the task's entry reads: its names, and whether `related` is in play, named or read from `affected` by a `tests=module` line. */
interface TaskEntry {
  readonly names: readonly CheckName[];
  readonly moduleRead: boolean;
  readonly related: boolean;
}

/** `checks.task` as the line's `tests=` value reads it; see the module note. */
function taskEntryOf(context: SuiteStepContext, input: TaskStepInput): TaskEntry {
  const names = context.settings.checksTask;
  const moduleRead = input.declared === 'module' && names.includes('affected');
  return { names, moduleRead, related: moduleRead || names.includes('related') };
}

/**
 * The runs a check run asks for from `base`, with the `tests.alwaysRun`
 * files `alwaysRun` reads added where the module note says; `related`
 * is true when the entry's `related` is in play. The task step's, and
 * the pre-wrap-up step's (`suite-step.ts`).
 */
export function checkRunsOf(run: CheckRun, related: boolean, base: string, alwaysRun: () => readonly string[]): StepRuns {
  if (run.kind === 'paths') {
    const joined = run.affectedToo || related
      ? alwaysRun()
      : [];
    return { narrowing: { paths: withAlwaysRun(run.paths, joined) }, alwaysRun: [], timed: joined };
  }
  if (run.kind === 'affected') {
    const joined = alwaysRun();
    return { narrowing: { changedSince: base }, alwaysRun: joined, timed: joined };
  }
  return { narrowing: {}, alwaysRun: [], timed: [] };
}

/** The scope the run record holds for a task's check run: `module` for the path list a `tests=module` line reads, else the list run. */
function taskRecordedScope(run: CheckRun | null, entry: TaskEntry, runs: StepRuns): SessionStep['scope'] {
  if (run === null || run.kind === 'full' || run.kind === 'none') return 'full';
  if (run.kind === 'affected') return 'affected';
  return entry.moduleRead
    ? 'module'
    : runs.narrowing.paths ?? run.paths;
}

/**
 * The reason the run record holds for a task's check run: the run's own,
 * or for a path list `unit` when the entry names it and `declared`
 * otherwise; none for a diff that did not read. See the module note.
 */
function taskStepReason(run: CheckRun | null, entry: TaskEntry): SessionStepReason | undefined {
  if (run === null) return undefined;
  if (run.kind !== 'paths') return run.reason;
  return entry.names.includes('unit') && !entry.moduleRead
    ? 'unit'
    : 'declared';
}

/** The preload files, with a warning when `bunfig.toml` does not read. */
function preloadOf(context: SuiteStepContext, seams: Required<SuiteStepSeams>): readonly string[] {
  const reading = seams.readPreloadFiles(context.checkout);
  if (reading.state === 'unreadable') activeOutput().warn(`⚠️  bunfig.toml does not read (${reading.reason}); no preload file is a full-suite trigger.`);
  return reading.files;
}

/** The task step's check run over `diff`, the task's own, or null when that did not read; `Owns:` and the test files are read only when the entry needs them. */
async function taskScopeOf(context: SuiteStepContext, seams: Required<SuiteStepSeams>, input: TaskStepInput, entry: TaskEntry, diff: readonly string[] | null): Promise<CheckRun | null> {
  if (diff === null) return null;
  const listsFiles = entry.related || entry.names.some((name) => PATH_CHECKS.has(name));
  return resolveChecks({
    names: entry.names,
    declared: input.declared,
    diff,
    owns: entry.related
      ? await context.owns()
      : null,
    testFiles: listsFiles
      ? seams.listTestFiles(context.checkout)
      : [],
    preload: preloadOf(context, seams),
    fullSuiteTriggers: context.settings.testsFullSuiteTriggers,
    contract: context.settings.testsContract,
    integration: context.settings.testsIntegration,
  });
}

/** The line a `none` task step prints, with the `tests=` value it set aside when the line had one. */
function noCheckLine(declared: TestScope | null): string {
  const setAside = declared === null
    ? ''
    : ` (tests=${declared} set aside)`;
  return `🧪 task step: no check configured (checks.task is empty); nothing ran.${setAside}`;
}

/** The `none` step the run record holds for an empty `checks.task`; see the module note. */
function noCheckStep(declared: TestScope | null): SessionStep {
  return {
    kind: 'task',
    scope: 'none',
    reason: 'no-check',
    ...(declared === null
      ? {}
      : { declared }),
    command: [],
    exitCode: 0,
    summary: null,
    failures: [],
    newFailures: [],
  };
}

/**
 * Settles a task step that ran no suite: `step`, when there is one, is
 * recorded and `line` printed before the lint and the type step run, and
 * those two settle the step as they would a green run's. See the module note.
 */
async function settleNothingRan(context: SuiteStepContext, seams: Required<SuiteStepSeams>, input: TaskStepInput, step: SessionStep | null, line: string): Promise<StepOutcome> {
  if (step !== null) recordStep(seams, step);
  activeOutput().info(line);
  const checks = await taskDiffChecks(context, seams, input, NOTHING_RAN);
  const label = `task step after "${input.task}"`;
  return settleStep(context, seams, { kind: 'task', scope: step?.scope ?? 'none', label, result: NOTHING_RAN, baseline: input.baseline, repair: { kind: 'task', task: input.task }, recorded: step, ...checks });
}

/** Runs the task step after a task commits; see `suite-step.ts`'s module note. */
export async function runTaskStep(context: SuiteStepContext, input: TaskStepInput): Promise<StepOutcome> {
  const seams = seamsOf(context);
  const entry = taskEntryOf(context, input);
  if (entry.names.length === 0) return settleNothingRan(context, seams, input, noCheckStep(input.declared), noCheckLine(input.declared));
  const diff = readDiff(seams.git, input.base);
  const scope = await taskScopeOf(context, seams, input, entry, diff);
  const runs = scope === null
    ? { narrowing: {}, alwaysRun: [], timed: [] }
    : checkRunsOf(scope, entry.related, input.base, () => readTaskAlwaysRun(seams.git, context.settings.testsAlwaysRun));
  const label = `task step after "${input.task}"`;
  if (runs.narrowing.paths?.length === 0) return settleNothingRan(context, seams, input, null, `🧪 ${label}: no test file in the paths checks.task names; nothing to run.`);
  const result = await runWithAlwaysRun(context, seams, 'task', runs);
  const checks = await taskDiffChecks(context, seams, input, result);
  const settling: Settling = { kind: 'task', scope: taskRecordedScope(scope, entry, runs), reason: taskStepReason(scope, entry), label, result, baseline: input.baseline, repair: { kind: 'task', task: input.task }, ...checks };
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
