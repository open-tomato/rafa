/**
 * Where the loop (`start.ts`) takes the runner's suite steps: the four
 * steps of `start/suite-step.ts`, placed around the sessions they check,
 * and the run stopped after a red one as it is after a blocked task.
 *
 * `start()` makes one {@link RunSuiteSteps} per run and calls it at two
 * places of each turn of its loop:
 *
 *   - {@link RunSuiteSteps.beforeSession}, once the loop guard has let
 *     the turn through and before `progress.txt` is rendered for the
 *     session. The first call of the run ensures the baseline
 *     (`ensureBaseline`: the stored one, or the full suite at HEAD), so
 *     the baseline is taken at the plan's first dispatch whether that is
 *     a task or, on a run with none left open, the wrap-up. Before a
 *     task every stage step due runs (`runDueStageSteps`: the step after
 *     a stage's last task, and the catch-up for a stage whose step never
 *     ran); before the wrap-up the pre-wrap-up step runs, the full suite.
 *   - {@link RunSuiteSteps.afterTask}, once a task is committed as
 *     `done` and its report stored: the task step (`runTaskStep`) over
 *     what the task changed since `base`, the commit it was dispatched
 *     on, scoped by its line's `tests=` value (`readTestScope`, the
 *     `affected` default for a line with none).
 *
 * Each answers true when the run goes on and false when it stops. A red
 * step has already written its blocker on the next open task, when one
 * is left (`suite-step.ts`), so the task that stop leaves `[BLOCKED]` is
 * retried first on the next run, handed the blocker text through
 * `BLOCKER_PROMPT_PREFIX` (`start/dispatch.ts`), exactly as a blocked
 * task's own is. A red pre-wrap-up step has no task to block: the run
 * stops before the wrap-up, and the next run takes that step again.
 *
 * ## A step stopped by SIGINT
 *
 * A step `suite-step.ts` reads as interrupted (its `bun test` ended on
 * SIGINT, or the runner received SIGINT while it ran, which
 * {@link RunSuiteStepsOptions.isInterrupted} hands on from `start.ts`'s
 * flag) answers false too, and is told apart from a red one: it has
 * written no blocker, so the run ends as `rafa loop stop` ends a run
 * between tasks, its record `stopped` (`start/session.ts`) and no task
 * marked. An interrupted baseline, which was not written, stops the run
 * the same way at the call that took it, and every later call of the
 * run answers false without running a step.
 *
 * ## A step that throws
 *
 * `suite-step.ts` answers a red suite as an outcome and warns about the
 * files it cannot write, so a throw is something else: a tracker whose
 * file name is neither a plan's nor a tracker's (`baselinePathFor`
 * refuses one, as `--plan=notes.md` makes), or a spawn that could not
 * start. A baseline that throws is warned about once and turns every
 * step of the run off, since a step split against no baseline would
 * read every inherited failure as new and block on it. Any other step
 * that throws is warned about and the run goes on without it. Neither
 * stops the run: a plan the loop ran before these steps existed runs as
 * it did.
 *
 * ## Seams
 *
 * The four steps arrive through {@link SuiteStepCalls} and `gh`, which
 * reads the plan's `Owns:` folders for `planOwnsReader`, through
 * {@link RunSuiteStepsOptions.gh}; each left out is the system's own.
 * Every line goes through the active output (`adapters/output/active.ts`).
 */
import type {
  BaselineOutcome,
  StepOutcome,
  SuiteStepContext,
  SuiteStepSeams,
  TaskStepInput,
} from './suite-step.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { SuiteBaseline } from '../suite/baseline.js';
import type { TaskInfo } from '../utils/tracker.js';

import { activeOutput } from '../adapters/output/active.js';
import { createGhRunner } from '../adapters/tracker/github.js';
import { messageOf } from '../config-sections.js';
import { parseTaskDeclaration, readTestScope } from '../utils/declaration.js';

import {
  ensureBaseline,
  planOwnsReader,
  runDueStageSteps,
  runPreWrapUpStep,
  runTaskStep,
} from './suite-step.js';

/** The four steps, as `suite-step.ts` exports them. */
export interface SuiteStepCalls {
  readonly ensureBaseline: (context: SuiteStepContext) => Promise<BaselineOutcome>;
  readonly runDueStageSteps: (context: SuiteStepContext, baseline: SuiteBaseline | null) => Promise<readonly StepOutcome[]>;
  readonly runTaskStep: (context: SuiteStepContext, input: TaskStepInput) => Promise<StepOutcome>;
  readonly runPreWrapUpStep: (context: SuiteStepContext, baseline: SuiteBaseline | null) => Promise<StepOutcome>;
}

/** What {@link createRunSuiteSteps} is handed, each as `start()` settled it. */
export interface RunSuiteStepsOptions {
  /** The project root, holding `.rafa/`: the run record and the JUnit files. */
  readonly repoRoot: string;
  /** The checkout `bun test` and git run in (`start/checkout.ts`). */
  readonly checkout: string;
  /** The plan's tracker; the baseline and the stage ledger sit beside it. */
  readonly trackerPath: string;
  /** The run's session id, naming its record. */
  readonly sessionId: string;
  /** The run's resolved config: its `tests.*` keys. */
  readonly settings: SuiteStepContext['settings'];
  /** The plan as the run read it: its header names the issue `Owns:` is read from. */
  readonly planContent: string;
  /** Runs `gh` for the `Owns:` reading; `createGhRunner` at the project root when left out. */
  readonly gh?: GhRunner;
  /** The steps; `suite-step.ts`'s own for each left out. */
  readonly calls?: Partial<SuiteStepCalls>;
  /** Handed on to every step (`SuiteStepContext.seams`). */
  readonly seams?: SuiteStepSeams;
  /** True once the runner has received SIGINT, handed on to every step; never, when left out. */
  readonly isInterrupted?: () => boolean;
}

/** The loop's two calls; see the module note. */
export interface RunSuiteSteps {
  /** Before the session for `taskInfo`, or for the wrap-up when null; false stops the run. */
  readonly beforeSession: (taskInfo: TaskInfo | null) => Promise<boolean>;
  /** After `taskInfo` committed `done` from `base`; false stops the run. */
  readonly afterTask: (taskInfo: TaskInfo, base: string) => Promise<boolean>;
}

/** The baseline, `off` when ensuring it threw, or `interrupted` when SIGINT stopped it. */
type BaselineHeld = SuiteBaseline | 'off' | 'interrupted';

/** Says the run stops on SIGINT as `rafa loop stop` stops it, with nothing marked. */
function announceInterrupted(): void {
  activeOutput().info('   Stopping here, as rafa loop stop does: no task is marked blocked. Run again to go on.');
}

/** Says why the run stops after the red step `outcome`. */
function announceStop(outcome: StepOutcome): void {
  const stop = outcome.blockedLine === null
    ? 'Stopping here: no task was left to mark, so the next run takes this step again.'
    : 'Stopping here. Run again to retry the blocked task, which is handed these failures.';
  activeOutput().error(`   ${stop}`);
}

/** Runs `step`, answering its outcome, or null with a warning when it throws. */
async function guarded<T>(label: string, step: () => Promise<T>): Promise<T | null> {
  try {
    return await step();
  } catch (error) {
    activeOutput().warn(`⚠️  The ${label} could not run (${messageOf(error)}); the run goes on without it.`);
    return null;
  }
}

/** True when `outcome` lets the run go on, saying why it stops when not. */
function goesOn(outcome: StepOutcome | null): boolean {
  if (outcome?.interrupted === true) {
    announceInterrupted();
    return false;
  }
  if (outcome === null || !outcome.red) return true;
  announceStop(outcome);
  return false;
}

/** The suite steps of one run; see the module note. */
export function createRunSuiteSteps(options: RunSuiteStepsOptions): RunSuiteSteps {
  const calls: SuiteStepCalls = {
    ensureBaseline: options.calls?.ensureBaseline ?? ensureBaseline,
    runDueStageSteps: options.calls?.runDueStageSteps ?? runDueStageSteps,
    runTaskStep: options.calls?.runTaskStep ?? runTaskStep,
    runPreWrapUpStep: options.calls?.runPreWrapUpStep ?? runPreWrapUpStep,
  };
  const context: SuiteStepContext = {
    repoRoot: options.repoRoot,
    checkout: options.checkout,
    trackerPath: options.trackerPath,
    sessionId: options.sessionId,
    settings: options.settings,
    owns: planOwnsReader({ planContent: options.planContent, gh: options.gh ?? createGhRunner({ cwd: options.repoRoot }) }),
    ...(options.seams === undefined
      ? {}
      : { seams: options.seams }),
    ...(options.isInterrupted === undefined
      ? {}
      : { isInterrupted: options.isInterrupted }),
  };

  let held: Promise<BaselineHeld> | null = null;
  const baseline = (): Promise<BaselineHeld> => {
    held ??= guarded('suite baseline', () => calls.ensureBaseline(context)).then((outcome) => {
      if (outcome?.interrupted === true) {
        announceInterrupted();
        return 'interrupted';
      }
      if (outcome !== null) return outcome.baseline;
      activeOutput().warn('⚠️  With no suite baseline, no suite step runs this run.');
      return 'off';
    });
    return held;
  };

  const beforeSession = async (taskInfo: TaskInfo | null): Promise<boolean> => {
    const known = await baseline();
    if (known === 'interrupted') return false;
    if (known === 'off') return true;
    if (taskInfo === null) return goesOn(await guarded('pre-wrap-up step', () => calls.runPreWrapUpStep(context, known)));
    const stages = await guarded('stage steps', () => calls.runDueStageSteps(context, known));
    return (stages ?? []).every((outcome) => goesOn(outcome));
  };

  const afterTask = async (taskInfo: TaskInfo, base: string): Promise<boolean> => {
    const known = await baseline();
    if (known === 'interrupted') return false;
    if (known === 'off') return true;
    const { text, declaration } = parseTaskDeclaration(taskInfo.task);
    const input: TaskStepInput = { baseline: known, base, declared: readTestScope(declaration), task: text };
    return goesOn(await guarded('task step', () => calls.runTaskStep(context, input)));
  };

  return { beforeSession, afterTask };
}
