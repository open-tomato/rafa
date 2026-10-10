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
 *     a task or, on a run with none left open, the wrap-up. Before an
 *     open task every stage step due runs (`runDueStageSteps`: the step
 *     after a stage's last task, and the catch-up for a stage whose step
 *     never ran); before the wrap-up the pre-wrap-up step runs, the full
 *     suite. Before a `[BLOCKED]` task no stage step runs: the blocked
 *     line is the repair (or retry) a red step left, and a due stage
 *     step run first would only meet the same failures again and stop
 *     the run before the repair gets its session. The ledger is read
 *     from the tracker on every call, so the steps still due are taken
 *     before the first open task after the repair.
 *   - {@link RunSuiteSteps.afterTask}, once a task is committed as
 *     `done` and its report stored: the task step (`runTaskStep`) over
 *     what the task changed since `base`, the commit it was dispatched
 *     on, scoped by its line's `tests=` value (`readTestScope`, the
 *     `affected` default for a line with none).
 *
 * `afterTask` answers true when the run goes on and false when it
 * stops; `beforeSession` answers `go-on` and `stop` for the same, and
 * `repair` for the pre-wrap-up repair below ({@link BeforeSessionAnswer}).
 * A red task or stage step has already inserted a `[BLOCKED]` repair
 * task carrying its blocker, or written it on the repair it followed
 * (`suite-blocker.ts`), so the run stops and that repair is dispatched
 * first on the next run, handed the blocker text through
 * `BLOCKER_PROMPT_PREFIX` (`start/dispatch.ts`), exactly as a blocked
 * task's own is. A step whose new failures were all green when their
 * files were run alone (`start/suite-retake-alone.ts`) answers as a
 * green one: it has warned, written nothing on the tracker, and the run
 * goes on.
 *
 * ## A red pre-wrap-up step
 *
 * The pre-wrap-up step stays a full suite run. Red with failures the
 * baseline does not hold, it inserts a `[BLOCKED]` repair task after the
 * checklist's last task (`suite-blocker.ts`), and `beforeSession(null)`
 * answers `repair`: `start.ts` goes back to `findNextTask` instead of
 * starting the wrap-up, which answers that repair first, so it is
 * dispatched in the same run, handed its blocker through
 * `BLOCKER_PROMPT_PREFIX` as any blocked task is, and its task step
 * runs after it. With no open task left once it is done, the next
 * `beforeSession(null)` runs the pre-wrap-up step again: green, the
 * wrap-up starts; red a second time, the step finds the ticked
 * pre-wrap-up repair on the tracker, writes its blocker on that line
 * instead of inserting another, and `beforeSession` answers `stop`, so
 * the run halts before the wrap-up and the next run dispatches that
 * repair first. One repair session is thus the most a pre-wrap-up step
 * adds to a run. Should the step insert a second repair in the same run
 * all the same (the first one's text no longer reading as a pre-wrap-up
 * repair), the answer is `stop` too, and the new repair waits for the
 * next run. A red step that wrote no line at all stops the run, and the
 * next run takes the step again.
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
 * run answers false without running a step. Either way
 * {@link RunSuiteSteps.stoppedOnSignal} answers true from then on, so
 * `start.ts` never retries such a stop as it may a red one
 * (`start/retry-budget.ts`).
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

/**
 * What {@link RunSuiteSteps.beforeSession} answers: `go-on` lets the
 * session start, `stop` ends the run, and `repair`, answered only before
 * the wrap-up, sends the loop back to `findNextTask` for the pre-wrap-up
 * repair a red pre-wrap-up step has just inserted. See the module note.
 */
export type BeforeSessionAnswer = 'go-on' | 'stop' | 'repair';

/** The loop's two calls; see the module note. */
export interface RunSuiteSteps {
  /** Before the session for `taskInfo`, or for the wrap-up when null; see {@link BeforeSessionAnswer}. */
  readonly beforeSession: (taskInfo: TaskInfo | null) => Promise<BeforeSessionAnswer>;
  /** After `taskInfo` committed `done` from `base`; false stops the run. */
  readonly afterTask: (taskInfo: TaskInfo, base: string) => Promise<boolean>;
  /**
   * True once a step or the baseline of this run was read as stopped by
   * SIGINT, so the stop the loop is acting on is an interrupt and never a
   * red step; see "A step stopped by SIGINT" in the module note.
   */
  readonly stoppedOnSignal: () => boolean;
  /**
   * The outcome of the run's last pre-wrap-up step, or null while none
   * has answered one (a step that threw answers none). A forced wrap-up
   * counts its new failures (`start/continue-run.ts`).
   */
  readonly lastPreWrapUp: () => StepOutcome | null;
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

/** `beforeSession`'s answer for a step that either lets the run go on or stops it. */
function answerOf(goingOn: boolean): BeforeSessionAnswer {
  return goingOn
    ? 'go-on'
    : 'stop';
}

/** True when the pre-wrap-up `outcome` is red and inserted a repair task now. */
function insertedRepair(outcome: StepOutcome | null): outcome is StepOutcome {
  return outcome !== null && outcome.red && !outcome.interrupted && outcome.repairInserted;
}

/** True when the pre-wrap-up `outcome` is red and wrote its blocker on an existing repair. */
function blockedRepairAgain(outcome: StepOutcome | null): outcome is StepOutcome {
  return outcome !== null && outcome.red && !outcome.interrupted && !outcome.repairInserted && outcome.blockedLine !== null;
}

/** Says the loop goes back to dispatch the pre-wrap-up repair task now. */
function announceRepair(): void {
  activeOutput().info('   Dispatching that repair task now; the pre-wrap-up step runs again once it is done.');
}

/** Says the run stops on a pre-wrap-up step red again after its repair. */
function announceRedAgain(): void {
  activeOutput().error('   Stopping here: the pre-wrap-up step is red again after its repair. Run again to retry that repair, which is handed these failures.');
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

  // Set once a step or the baseline is read as stopped by SIGINT.
  let signalled = false;
  const goesOnNoting = (outcome: StepOutcome | null): boolean => {
    if (outcome?.interrupted === true) signalled = true;
    return goesOn(outcome);
  };

  let held: Promise<BaselineHeld> | null = null;
  const baseline = (): Promise<BaselineHeld> => {
    held ??= guarded('suite baseline', () => calls.ensureBaseline(context)).then((outcome) => {
      if (outcome?.interrupted === true) {
        signalled = true;
        announceInterrupted();
        return 'interrupted';
      }
      if (outcome !== null) return outcome.baseline;
      activeOutput().warn('⚠️  With no suite baseline, no suite step runs this run.');
      return 'off';
    });
    return held;
  };

  // Set once this run has gone back to dispatch a pre-wrap-up repair.
  let repairSent = false;
  let lastPreWrapUp: StepOutcome | null = null;
  const preWrapUp = async (known: SuiteBaseline): Promise<BeforeSessionAnswer> => {
    const outcome = await guarded('pre-wrap-up step', () => calls.runPreWrapUpStep(context, known));
    lastPreWrapUp = outcome;
    if (insertedRepair(outcome) && !repairSent) {
      repairSent = true;
      announceRepair();
      return 'repair';
    }
    if (blockedRepairAgain(outcome)) {
      announceRedAgain();
      return 'stop';
    }
    return answerOf(goesOnNoting(outcome));
  };

  const beforeSession = async (taskInfo: TaskInfo | null): Promise<BeforeSessionAnswer> => {
    const known = await baseline();
    if (known === 'interrupted') return 'stop';
    if (known === 'off') return 'go-on';
    if (taskInfo === null) return preWrapUp(known);
    if (taskInfo.status === 'blocked') return 'go-on';
    const stages = await guarded('stage steps', () => calls.runDueStageSteps(context, known));
    return answerOf((stages ?? []).every((outcome) => goesOnNoting(outcome)));
  };

  const afterTask = async (taskInfo: TaskInfo, base: string): Promise<boolean> => {
    const known = await baseline();
    if (known === 'interrupted') return false;
    if (known === 'off') return true;
    const { text, declaration } = parseTaskDeclaration(taskInfo.task);
    const input: TaskStepInput = { baseline: known, base, declared: readTestScope(declaration), task: text };
    return goesOnNoting(await guarded('task step', () => calls.runTaskStep(context, input)));
  };

  return { beforeSession, afterTask, stoppedOnSignal: () => signalled, lastPreWrapUp: () => lastPreWrapUp };
}
