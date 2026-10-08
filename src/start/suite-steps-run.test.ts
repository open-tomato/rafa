/**
 * The loop's suite steps of `start/suite-steps-run.ts`, driven over
 * seams.
 *
 * The first cases script the four steps themselves and read what each
 * was handed and whether the run goes on. Every claim that a call runs
 * nothing, or lets the run go on, is paired with a case where the same
 * call, handed a red outcome or a due step, does not. The last cases
 * leave the steps as `suite-step.ts`'s own, over a scripted `bun test`
 * and git and a real tracker, so the default wiring is read writing a
 * real blocker, not assumed to.
 *
 * Nothing here spawns `bun test`, git or `gh`.
 */
import type {
  BaselineOutcome,
  StepOutcome,
  SuiteStepContext,
  TaskStepInput,
} from './suite-step.js';
import type { SuiteStepCalls } from './suite-steps-run.js';
import type { SessionStep } from '../loop/sessions.js';
import type { GitResult, GitRunner } from '../pr/index.js';
import type { SuiteBaseline } from '../suite/baseline.js';
import type { SuiteResult, SuiteRunOptions } from '../suite/run.js';
import type { TaskInfo } from '../utils/tracker.js';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { baselineOf } from '../suite/baseline.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { findNextTask } from '../utils/tracker.js';

import { createRunSuiteSteps } from './suite-steps-run.js';

const BASE = 'base0000';
const HEAD = 'head1111';
const SESSION = 'session-1';

/** Two stages: the first finished, the second with its tasks open. */
const TRACKER = [
  '# Plan: fixture',
  '',
  '# Stage: One',
  '',
  '- [x] first task',
  '',
  '# Stage: Two',
  '',
  '- [ ] second task',
  '- [ ] third task',
  '',
].join('\n');

const BASELINE: SuiteBaseline = baselineOf(
  { command: ['bun', 'test'], exitCode: 0, summary: 'Ran 1 test across 1 file. [1.00ms]', failures: [], errors: 0, junit: 'read', unhandled: [] },
  new Date('2026-10-01T00:00:00Z'),
  BASE,
);

let dir: string;
let trackerPath: string;
let lines: { level: string; message: string }[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'suite-steps-run-'));
  mkdirSync(join(dir, '.rafa', 'plans'), { recursive: true });
  trackerPath = join(dir, '.rafa', 'plans', 'PLAN_TRACKER-fixture.md');
  writeFileSync(trackerPath, TRACKER, 'utf8');
  lines = [];
  setActiveOutput(sinkOutput({
    info: (message) => lines.push({ level: 'info', message }),
    warn: (message) => lines.push({ level: 'warn', message }),
    error: (message) => lines.push({ level: 'error', message }),
  }));
});

afterEach(() => {
  setActiveOutput(null);
  rmSync(dir, { recursive: true, force: true });
});

/** The lines of one level. */
function linesAt(level: string): readonly string[] {
  return lines.filter((line) => line.level === level).map((line) => line.message);
}

/** A step outcome: green unless `red`, then blocking `blockedLine`. */
function outcome(kind: StepOutcome['kind'], red = false, blockedLine: number | null = null): StepOutcome {
  return {
    kind,
    step: null,
    red,
    interrupted: false,
    blocker: red
      ? 'New failing test files: src/x.test.ts (1 test).'
      : null,
    blockedLine,
    repairInserted: blockedLine !== null,
  };
}

/** What the scripted steps were called with, in order. */
interface Calls {
  readonly names: string[];
  readonly baselines: (SuiteBaseline | null)[];
  readonly taskInputs: TaskStepInput[];
  readonly contexts: SuiteStepContext[];
}

/** The steps, each scripted to answer as `answers` says, green when left out. */
function scripted(answers: Partial<SuiteStepCalls> = {}): { readonly calls: SuiteStepCalls; readonly seen: Calls } {
  const seen: Calls = { names: [], baselines: [], taskInputs: [], contexts: [] };
  const calls: SuiteStepCalls = {
    ensureBaseline: (context) => {
      seen.names.push('ensureBaseline');
      seen.contexts.push(context);
      return answers.ensureBaseline?.(context) ?? Promise.resolve<BaselineOutcome>({ baseline: BASELINE, step: null, interrupted: false });
    },
    runDueStageSteps: (context, baseline) => {
      seen.names.push('runDueStageSteps');
      seen.baselines.push(baseline);
      return answers.runDueStageSteps?.(context, baseline) ?? Promise.resolve([]);
    },
    runTaskStep: (context, input) => {
      seen.names.push('runTaskStep');
      seen.taskInputs.push(input);
      return answers.runTaskStep?.(context, input) ?? Promise.resolve(outcome('task'));
    },
    runPreWrapUpStep: (context, baseline) => {
      seen.names.push('runPreWrapUpStep');
      seen.baselines.push(baseline);
      return answers.runPreWrapUpStep?.(context, baseline) ?? Promise.resolve(outcome('pre-wrap-up'));
    },
  };
  return { calls, seen };
}

/** An outcome read as a stop on SIGINT: never red, blocking nothing. */
function stopped(kind: StepOutcome['kind']): StepOutcome {
  return { ...outcome(kind), interrupted: true };
}

/** The loop's steps over the temporary tracker, with `calls` as its steps. */
function stepsWith(
  calls: Partial<SuiteStepCalls>,
  extra: { readonly seams?: SuiteStepContext['seams']; readonly isInterrupted?: () => boolean } = {},
): ReturnType<typeof createRunSuiteSteps> {
  return createRunSuiteSteps({
    repoRoot: dir,
    checkout: dir,
    trackerPath,
    sessionId: SESSION,
    settings: { testsFullSuiteTriggers: ['package.json'], testsIntegration: [], testsAlwaysRun: [] },
    planContent: TRACKER,
    gh: () => Promise.reject(new Error('gh is not read by these cases')),
    calls,
    ...extra,
  });
}

/** The tracker's open task at `task`'s line, as `findNextTask` hands it. */
function taskAt(text: string, lineNum: number): TaskInfo {
  return { task: text, lineNum, status: 'unchecked' };
}

describe('beforeSession', () => {
  it('ensures the baseline once for the whole run, at the first call', async () => {
    const { calls, seen } = scripted();
    const steps = stepsWith(calls);

    expect(seen.names).toEqual([]);
    await steps.beforeSession(taskAt('second task', 8));
    await steps.beforeSession(taskAt('third task', 9));
    await steps.beforeSession(null);

    expect(seen.names.filter((name) => name === 'ensureBaseline')).toHaveLength(1);
    expect(seen.names[0]).toBe('ensureBaseline');
  });

  it('hands the baseline the run\'s root, checkout, tracker and session', async () => {
    const { calls, seen } = scripted();
    await stepsWith(calls).beforeSession(taskAt('second task', 8));

    const [context] = seen.contexts;
    expect(context?.repoRoot).toBe(dir);
    expect(context?.checkout).toBe(dir);
    expect(context?.trackerPath).toBe(trackerPath);
    expect(context?.sessionId).toBe(SESSION);
  });

  it('runs the due stage steps before a task, split against the baseline, and not the pre-wrap-up step', async () => {
    const { calls, seen } = scripted();
    const answer = await stepsWith(calls).beforeSession(taskAt('second task', 8));

    expect(answer).toBe('go-on');
    expect(seen.names).toEqual(['ensureBaseline', 'runDueStageSteps']);
    expect(seen.baselines).toEqual([BASELINE]);
  });

  it('runs no stage step before a blocked task, and runs the due one before the open task after it', async () => {
    // A due stage step, red if it ran: before the blocked repair it must not.
    const { calls, seen } = scripted({ runDueStageSteps: () => Promise.resolve([outcome('stage', true, 9)]) });
    const steps = stepsWith(calls);
    const blocked: TaskInfo = { task: 'repair the suite', lineNum: 8, status: 'blocked', blocker: 'New failing test files.' };

    expect(await steps.beforeSession(blocked)).toBe('go-on');
    expect(seen.names).toEqual(['ensureBaseline']);
    expect(linesAt('error')).toEqual([]);

    expect(await steps.beforeSession(taskAt('third task', 9))).toBe('stop');
    expect(seen.names).toEqual(['ensureBaseline', 'runDueStageSteps']);
  });

  it('runs an open task\'s due stage steps before its session', async () => {
    // The control for the case above: the same due step, an open task.
    const { calls, seen } = scripted({ runDueStageSteps: () => Promise.resolve([outcome('stage')]) });

    expect(await stepsWith(calls).beforeSession(taskAt('second task', 8))).toBe('go-on');
    expect(seen.names).toEqual(['ensureBaseline', 'runDueStageSteps']);
  });

  it('runs the pre-wrap-up step before the wrap-up, and no stage step', async () => {
    const { calls, seen } = scripted();
    const answer = await stepsWith(calls).beforeSession(null);

    expect(answer).toBe('go-on');
    expect(seen.names).toEqual(['ensureBaseline', 'runPreWrapUpStep']);
    expect(seen.baselines).toEqual([BASELINE]);
  });

  it('lets the run go on after green stage steps', async () => {
    const { calls } = scripted({ runDueStageSteps: () => Promise.resolve([outcome('stage'), outcome('stage')]) });

    expect(await stepsWith(calls).beforeSession(taskAt('second task', 8))).toBe('go-on');
    expect(linesAt('error')).toEqual([]);
  });

  it('stops the run after a red stage step, saying the blocked task is retried next', async () => {
    // The control for the case above: the same call over a red outcome.
    const { calls } = scripted({ runDueStageSteps: () => Promise.resolve([outcome('stage'), outcome('stage', true, 8)]) });

    expect(await stepsWith(calls).beforeSession(taskAt('second task', 8))).toBe('stop');
    expect(linesAt('error')).toEqual(['   Stopping here. Run again to retry the blocked task, which is handed these failures.']);
  });

  it('stops the run before the wrap-up after a red pre-wrap-up step that wrote no line, saying the next run takes it again', async () => {
    const { calls } = scripted({ runPreWrapUpStep: () => Promise.resolve(outcome('pre-wrap-up', true)) });

    expect(await stepsWith(calls).beforeSession(null)).toBe('stop');
    expect(linesAt('error')).toEqual(['   Stopping here: no task was left to mark, so the next run takes this step again.']);
  });
});

describe('beforeSession on a red pre-wrap-up step', () => {
  const REPAIR_LINE = '   Dispatching that repair task now; the pre-wrap-up step runs again once it is done.';
  const RED_AGAIN_LINE = '   Stopping here: the pre-wrap-up step is red again after its repair. Run again to retry that repair, which is handed these failures.';

  /** A red pre-wrap-up outcome that wrote its blocker on the existing repair at `line`. */
  const blockedAgain = (line: number): StepOutcome => ({ ...outcome('pre-wrap-up', true, line), repairInserted: false });

  /** The pre-wrap-up step scripted to answer `outcomes` in turn. */
  const inTurn = (outcomes: readonly StepOutcome[]): Partial<SuiteStepCalls> => {
    const queue = [...outcomes];
    return { runPreWrapUpStep: () => Promise.resolve(queue.shift() ?? outcome('pre-wrap-up')) };
  };

  it('answers repair when the step inserted a repair task, so the loop dispatches it in this run', async () => {
    const { calls } = scripted(inTurn([outcome('pre-wrap-up', true, 10)]));

    expect(await stepsWith(calls).beforeSession(null)).toBe('repair');
    expect(linesAt('info')).toContain(REPAIR_LINE);
    expect(linesAt('error')).toEqual([]);
  });

  it('answers go-on when the step is green again after its repair', async () => {
    const { calls, seen } = scripted(inTurn([outcome('pre-wrap-up', true, 10), outcome('pre-wrap-up')]));
    const steps = stepsWith(calls);

    expect(await steps.beforeSession(null)).toBe('repair');
    expect(await steps.beforeSession({ task: 'Repair the red pre-wrap-up step at commit head1111', lineNum: 10, status: 'blocked' })).toBe('go-on');
    expect(await steps.beforeSession(null)).toBe('go-on');
    expect(seen.names).toEqual(['ensureBaseline', 'runPreWrapUpStep', 'runPreWrapUpStep']);
  });

  it('answers stop when the step is red again and blocked the ticked repair again', async () => {
    // The control for the case above: the same run, its second step red.
    const { calls } = scripted(inTurn([outcome('pre-wrap-up', true, 10), blockedAgain(10)]));
    const steps = stepsWith(calls);

    expect(await steps.beforeSession(null)).toBe('repair');
    expect(await steps.beforeSession(null)).toBe('stop');
    expect(linesAt('error')).toEqual([RED_AGAIN_LINE]);
  });

  it('answers stop on a run\'s first call when the step blocked a repair an earlier run ticked', async () => {
    const { calls } = scripted(inTurn([blockedAgain(10)]));

    expect(await stepsWith(calls).beforeSession(null)).toBe('stop');
    expect(linesAt('info')).not.toContain(REPAIR_LINE);
    expect(linesAt('error')).toEqual([RED_AGAIN_LINE]);
  });

  it('answers stop when the step inserts a second repair in the same run, leaving it for the next run', async () => {
    const { calls } = scripted(inTurn([outcome('pre-wrap-up', true, 10), outcome('pre-wrap-up', true, 11)]));
    const steps = stepsWith(calls);

    expect(await steps.beforeSession(null)).toBe('repair');
    expect(await steps.beforeSession(null)).toBe('stop');
    expect(linesAt('info').filter((line) => line === REPAIR_LINE)).toHaveLength(1);
    expect(linesAt('error')).toEqual(['   Stopping here. Run again to retry the blocked task, which is handed these failures.']);
  });

  it('answers stop, not repair, on an interrupted step and go-on on one that throws', async () => {
    const interrupted = scripted({ runPreWrapUpStep: () => Promise.resolve(stopped('pre-wrap-up')) });
    const thrown = scripted({ runPreWrapUpStep: () => Promise.reject(new Error('spawn failed')) });

    expect(await stepsWith(interrupted.calls).beforeSession(null)).toBe('stop');
    expect(await stepsWith(thrown.calls).beforeSession(null)).toBe('go-on');
    expect(linesAt('info')).not.toContain(REPAIR_LINE);
  });
});

describe('lastPreWrapUp', () => {
  it('answers none before a pre-wrap-up step ran, and the last one\'s outcome after', async () => {
    const red = { ...outcome('pre-wrap-up', true, 10), repairInserted: false };
    const { calls } = scripted({ runPreWrapUpStep: () => Promise.resolve(red) });
    const steps = stepsWith(calls);

    await steps.beforeSession(taskAt('A task', 3));
    expect(steps.lastPreWrapUp()).toBeNull();
    await steps.beforeSession(null);
    expect(steps.lastPreWrapUp()).toBe(red);
  });

  it('answers none for a pre-wrap-up step that threw', async () => {
    const { calls } = scripted({ runPreWrapUpStep: () => Promise.reject(new Error('spawn failed')) });
    const steps = stepsWith(calls);

    await steps.beforeSession(null);
    expect(steps.lastPreWrapUp()).toBeNull();
  });
});

describe('afterTask', () => {
  it('runs the task step from the task\'s base, with its sentence and the affected default', async () => {
    const { calls, seen } = scripted();
    const steps = stepsWith(calls);
    await steps.beforeSession(taskAt('second task', 8));

    expect(await steps.afterTask(taskAt('second task', 8), BASE)).toBe(true);
    expect(seen.taskInputs).toEqual([{ baseline: BASELINE, base: BASE, declared: 'affected', task: 'second task' }]);
  });

  it('reads the line\'s tests= value and hands the sentence without its declaration', async () => {
    const { calls, seen } = scripted();
    await stepsWith(calls).afterTask(taskAt('second task  {tests=full}', 8), BASE);

    expect(seen.taskInputs.map((input) => [input.declared, input.task])).toEqual([['full', 'second task']]);
  });

  it('stops the run after a red task step', async () => {
    const { calls } = scripted({ runTaskStep: () => Promise.resolve(outcome('task', true, 9)) });

    expect(await stepsWith(calls).afterTask(taskAt('second task', 8), BASE)).toBe(false);
    expect(linesAt('error')).toHaveLength(1);
  });
});

describe('a step stopped by SIGINT', () => {
  const STOP_LINE = '   Stopping here, as rafa loop stop does: no task is marked blocked. Run again to go on.';

  it('hands the runner\'s SIGINT flag on to every step, and none when left out', async () => {
    let flag = false;
    const { calls, seen } = scripted();
    const steps = stepsWith(calls, { isInterrupted: () => flag });
    await steps.beforeSession(taskAt('second task', 8));
    flag = true;

    expect(seen.contexts[0]?.isInterrupted?.()).toBe(true);
    const bare = scripted();
    await stepsWith(bare.calls).beforeSession(taskAt('second task', 8));
    expect(bare.seen.contexts[0]?.isInterrupted).toBeUndefined();
  });

  it('stops the run after an interrupted stage step, as loop stop does, with no blocked-task line', async () => {
    const { calls } = scripted({ runDueStageSteps: () => Promise.resolve([outcome('stage'), stopped('stage')]) });

    expect(await stepsWith(calls).beforeSession(taskAt('second task', 8))).toBe('stop');
    expect(linesAt('error')).toEqual([]);
    expect(linesAt('info')).toContain(STOP_LINE);
  });

  it('stops the run after an interrupted task step and an interrupted pre-wrap-up step', async () => {
    const { calls } = scripted({
      runTaskStep: () => Promise.resolve(stopped('task')),
      runPreWrapUpStep: () => Promise.resolve(stopped('pre-wrap-up')),
    });
    const steps = stepsWith(calls);

    expect(await steps.afterTask(taskAt('second task', 8), BASE)).toBe(false);
    expect(await steps.beforeSession(null)).toBe('stop');
    expect(linesAt('error')).toEqual([]);
    expect(linesAt('info').filter((line) => line === STOP_LINE)).toHaveLength(2);
  });

  it('stops the run on an interrupted baseline, and runs no step at any later call', async () => {
    const { calls, seen } = scripted({ ensureBaseline: () => Promise.resolve({ baseline: BASELINE, step: null, interrupted: true }) });
    const steps = stepsWith(calls);

    expect(await steps.beforeSession(taskAt('second task', 8))).toBe('stop');
    expect(await steps.afterTask(taskAt('second task', 8), BASE)).toBe(false);
    expect(await steps.beforeSession(null)).toBe('stop');

    expect(seen.names).toEqual(['ensureBaseline']);
    expect(linesAt('info').filter((line) => line === STOP_LINE)).toHaveLength(1);
    expect(linesAt('warn')).toEqual([]);
  });
});

describe('stoppedOnSignal', () => {
  // What `start.ts` reads before it retries a suite stop: a stop SIGINT
  // made is never retried (`start/retry-budget.ts`), a red one may be.
  it('answers false for a fresh run and after a red step, whose stop a retry may follow', async () => {
    const { calls } = scripted({ runDueStageSteps: () => Promise.resolve([outcome('stage', true, 9)]) });
    const steps = stepsWith(calls);

    expect(steps.stoppedOnSignal()).toBe(false);
    expect(await steps.beforeSession(taskAt('second task', 8))).toBe('stop');
    expect(steps.stoppedOnSignal()).toBe(false);
  });

  it('answers true once an interrupted stage step or task step has stopped the run', async () => {
    const stage = stepsWith(scripted({ runDueStageSteps: () => Promise.resolve([stopped('stage')]) }).calls);
    const task = stepsWith(scripted({ runTaskStep: () => Promise.resolve(stopped('task')) }).calls);

    expect(await stage.beforeSession(taskAt('second task', 8))).toBe('stop');
    expect(await task.afterTask(taskAt('second task', 8), BASE)).toBe(false);
    expect([stage.stoppedOnSignal(), task.stoppedOnSignal()]).toEqual([true, true]);
  });

  it('answers true after an interrupted pre-wrap-up step and an interrupted baseline', async () => {
    const preWrapUp = stepsWith(scripted({ runPreWrapUpStep: () => Promise.resolve(stopped('pre-wrap-up')) }).calls);
    const baseline = stepsWith(scripted({ ensureBaseline: () => Promise.resolve({ baseline: BASELINE, step: null, interrupted: true }) }).calls);

    expect(await preWrapUp.beforeSession(null)).toBe('stop');
    expect(await baseline.beforeSession(taskAt('second task', 8))).toBe('stop');
    expect([preWrapUp.stoppedOnSignal(), baseline.stoppedOnSignal()]).toEqual([true, true]);
  });
});

describe('a step that throws', () => {
  it('turns every step of the run off when the baseline throws, warning once', async () => {
    const { calls, seen } = scripted({ ensureBaseline: () => Promise.reject(new RangeError('not a PLAN or PLAN_TRACKER file')) });
    const steps = stepsWith(calls);

    expect(await steps.beforeSession(taskAt('second task', 8))).toBe('go-on');
    expect(await steps.afterTask(taskAt('second task', 8), BASE)).toBe(true);
    expect(await steps.beforeSession(null)).toBe('go-on');

    expect(seen.names).toEqual(['ensureBaseline']);
    expect(linesAt('warn')).toEqual([
      '⚠️  The suite baseline could not run (not a PLAN or PLAN_TRACKER file); the run goes on without it.',
      '⚠️  With no suite baseline, no suite step runs this run.',
    ]);
  });

  it('warns and goes on when another step throws, and still runs the next one', async () => {
    const { calls, seen } = scripted({ runDueStageSteps: () => Promise.reject(new Error('spawn failed')) });
    const steps = stepsWith(calls);

    expect(await steps.beforeSession(taskAt('second task', 8))).toBe('go-on');
    expect(await steps.afterTask(taskAt('second task', 8), BASE)).toBe(true);

    expect(seen.names).toEqual(['ensureBaseline', 'runDueStageSteps', 'runTaskStep']);
    expect(linesAt('warn')).toEqual(['⚠️  The stage steps could not run (spawn failed); the run goes on without it.']);
  });
});

/** A git at {@link HEAD} whose diff from {@link BASE} is `src/a.ts`. */
function gitAtHead(): GitRunner {
  const answers: Record<string, GitResult> = {
    'rev-parse --verify HEAD^{commit}': { ok: true, stdout: `${HEAD}\n`, stderr: '' },
    [`diff --name-only -z --no-renames ${BASE} HEAD`]: { ok: true, stdout: 'src/a.ts\0', stderr: '' },
    [`diff --name-only -z --no-renames ${HEAD} HEAD`]: { ok: true, stdout: '', stderr: '' },
  };
  return (args) => answers[args.join(' ')] ?? { ok: false, stdout: '', stderr: `unscripted: ${args.join(' ')}` };
}

/** Ticks the second task, as its commit does before the task step runs. */
function tickSecondTask(): void {
  writeFileSync(trackerPath, TRACKER.replace('- [ ] second task', '- [x] second task'), 'utf8');
}

/** A suite result, green unless it names failures. */
function suiteResult(failures: SuiteResult['failures'] = []): SuiteResult {
  return {
    command: ['bun', 'test'],
    exitCode: failures.length === 0
      ? 0
      : 1,
    summary: 'Ran 2 tests across 2 files. [1.00ms]',
    failures,
    errors: 0,
    junit: 'read',
    unhandled: [],
  };
}

describe('with suite-step.ts\'s own steps', () => {
  /** The steps over a scripted `bun test` answering `results` in turn. */
  const realSteps = (results: readonly SuiteResult[]): { readonly steps: ReturnType<typeof createRunSuiteSteps>; readonly runs: SuiteRunOptions[]; readonly recorded: SessionStep[] } => {
    const queue = [...results];
    const runs: SuiteRunOptions[] = [];
    const recorded: SessionStep[] = [];
    const steps = stepsWith({}, {
      seams: {
        runSuite: (options) => {
          runs.push(options);
          const next = queue.shift();
          if (next === undefined) throw new Error('runSuite called more times than scripted');
          return Promise.resolve(next);
        },
        appendStep: (step) => {
          recorded.push(step);
        },
        git: gitAtHead(),
        listTestFiles: () => ['src/a.test.ts'],
        readPreloadFiles: () => ({ state: 'read', files: [] }),
        now: () => new Date('2026-10-01T00:00:00Z'),
      },
    });
    return { steps, runs, recorded };
  };

  it('records the baseline, then a green task step over the task\'s --changed selection, and goes on', async () => {
    const { steps, runs, recorded } = realSteps([suiteResult(), suiteResult()]);

    expect(await steps.beforeSession(findNextTask(TRACKER))).toBe('go-on');
    tickSecondTask();
    expect(await steps.afterTask(taskAt('second task', 8), BASE)).toBe(true);

    expect(recorded.map((step) => step.kind)).toEqual(['baseline', 'task']);
    expect(runs[1]?.changedSince).toBe(BASE);
    expect(findNextTask(readFileSync(trackerPath, 'utf8'))?.status).toBe('unchecked');
  });

  it('stops the run on a task step whose bun test ended on SIGINT, writing no blocker line', async () => {
    const sigint: SuiteResult = { ...suiteResult(), exitCode: 130, summary: null, errors: null, junit: 'missing' };
    const { steps, recorded } = realSteps([suiteResult(), sigint]);

    expect(await steps.beforeSession(findNextTask(TRACKER))).toBe('go-on');
    tickSecondTask();
    const ticked = readFileSync(trackerPath, 'utf8');
    expect(await steps.afterTask(taskAt('second task', 8), BASE)).toBe(false);

    expect(recorded.map((step) => [step.kind, step.interrupted])).toEqual([['baseline', undefined], ['task', true]]);
    expect(readFileSync(trackerPath, 'utf8')).toBe(ticked);
    expect(findNextTask(ticked)?.status).toBe('unchecked');
  });

  it('writes a red task step\'s blocker on the next open task and stops the run', async () => {
    // The control for the case above: the same run, its task step red.
    const broken = { file: 'src/a.test.ts', name: 'a > broke' };
    const { steps, recorded } = realSteps([suiteResult(), suiteResult([broken])]);

    expect(await steps.beforeSession(findNextTask(TRACKER))).toBe('go-on');
    tickSecondTask();
    expect(await steps.afterTask(taskAt('second task', 8), BASE)).toBe(false);

    expect(recorded.map((step) => [step.kind, step.newFailures])).toEqual([['baseline', []], ['task', [broken]]]);
    const next = findNextTask(readFileSync(trackerPath, 'utf8'));
    expect(next?.lineNum).toBe(9);
    expect(next?.status).toBe('blocked');
    expect(next?.blocker).toContain('src/a.test.ts (1 test)');
  });

  it('answers repair on a red pre-wrap-up step over a real tracker, then stop with the blocker on that repair\'s line', async () => {
    const broken = { file: 'src/a.test.ts', name: 'a > broke' };
    writeFileSync(trackerPath, TRACKER.replaceAll('- [ ] ', '- [x] '), 'utf8');
    const { steps, recorded } = realSteps([suiteResult(), suiteResult([broken]), suiteResult([broken])]);

    expect(await steps.beforeSession(null)).toBe('repair');
    const repair = findNextTask(readFileSync(trackerPath, 'utf8'));
    expect(repair?.status).toBe('blocked');
    expect(repair?.task).toStartWith(`Repair the red pre-wrap-up step at commit ${HEAD}`);
    expect(repair?.blocker).toContain('src/a.test.ts (1 test)');

    // The repair session's commit ticks it; the step then runs red again.
    if (repair === undefined || repair === null) throw new Error('no repair task was inserted');
    const blocked = readFileSync(trackerPath, 'utf8').split('\n');
    const ticked = blocked.map((line, index) => index === repair.lineNum
      ? line.replace('- [BLOCKED] ', '- [x] ')
      : line);
    writeFileSync(trackerPath, ticked.join('\n'), 'utf8');
    expect(await steps.beforeSession(null)).toBe('stop');

    const after = readFileSync(trackerPath, 'utf8');
    expect(findNextTask(after)?.lineNum).toBe(repair.lineNum);
    expect(findNextTask(after)?.status).toBe('blocked');
    expect(after.match(/Repair the red pre-wrap-up step/g)).toHaveLength(1);
    expect(recorded.map((step) => step.kind)).toEqual(['baseline', 'pre-wrap-up', 'pre-wrap-up']);
  });
});
