/**
 * The task step's diff checks (`start/task-step-checks.ts`), driven over
 * seams: a scripted git whose diffs name one file and one test file, a
 * scripted lint runner and a scripted tsc runner, in a temporary checkout
 * holding an `eslint.config.mjs` and a `tsconfig.json`.
 *
 * What the checks find through `runTaskStep` is covered in
 * `suite-step.test.ts`; these cases hold the module's own answer: the
 * lint, then the type step, run after a test run that was not a stop,
 * nothing runs after one that was, and no type step runs after a lint
 * that was. Each "nothing ran" case is paired with the same input,
 * changed in one thing, that runs the check. `isCheckUnstartable` is
 * held on its own and through `settleStep` over a tracker on disk: a
 * check that could not start leaves the tracker as it was, and the same
 * step with a red type step in its place inserts the repair.
 */
import type { LintRunner } from './lint-step.js';
import type { Settling, SuiteStepContext, TaskStepInput } from './suite-step.js';
import type { TypeOutcome, TypeRunner } from './type-step.js';
import type { SuiteResult } from '@open-tomato/rafa/suite/run';
import type { GitResult, GitRunner } from '@open-tomato/rafa-pr/pr/index';

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { seamsOf, settleStep, SIGINT_EXIT_CODE } from './suite-step.js';
import { isCheckUnstartable, lintTask, taskDiffChecks, typeCheckTask } from './task-step-checks.js';

const BASE = 'base0000';
const DIFF_KEY = `diff --name-only -z --no-renames --diff-filter=d ${BASE} HEAD`;
const TYPE_DIFF_KEY = `diff --name-status -z --find-renames --diff-filter=d ${BASE} HEAD`;
const INPUT: TaskStepInput = { baseline: null, base: BASE, declared: 'affected', task: 'Add a file' };

let checkout: string;
let lintCalls: number;
let typeCalls: number;

beforeEach(() => {
  checkout = mkdtempSync(join(tmpdir(), 'task-step-checks-'));
  writeFileSync(join(checkout, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
  writeFileSync(join(checkout, 'tsconfig.json'), '{}\n', 'utf8');
  lintCalls = 0;
  typeCalls = 0;
  setActiveOutput(sinkOutput({ info: () => {}, warn: () => {}, error: () => {} }));
});

afterEach(() => {
  setActiveOutput(null);
  rmSync(checkout, { recursive: true, force: true });
});

/** The answers of {@link git}: the lint's diff and the type step's, each from {@link BASE}. */
const GIT_ANSWERS: Readonly<Record<string, string>> = {
  [DIFF_KEY]: 'src/a.ts\0src/a.test.ts\0',
  [TYPE_DIFF_KEY]: 'M\0src/a.ts\0A\0src/a.test.ts\0',
  'rev-parse --verify HEAD^{commit}': 'head1111\n',
};

/** A git whose filtered diffs from {@link BASE} name `src/a.ts` and `src/a.test.ts`, the test file added. */
const git: GitRunner = (args) => {
  const stdout = GIT_ANSWERS[args.join(' ')];
  const answer: GitResult = stdout === undefined
    ? { ok: false, stdout: '', stderr: 'fatal: bad revision' }
    : { ok: true, stdout, stderr: '' };
  return answer;
};

/** A lint runner answering `exitCode` with an empty report, counting its calls. */
function lintAnswering(exitCode: number): LintRunner {
  return () => {
    lintCalls += 1;
    return Promise.resolve({ exitCode, stdout: '[]', stderr: '' });
  };
}

/** A tsc runner answering `exitCode` with no error printed, counting its calls. */
function typesAnswering(exitCode: number): TypeRunner {
  return () => {
    typeCalls += 1;
    return Promise.resolve({ exitCode, stdout: '', stderr: '' });
  };
}

/** A context over the scratch checkout, its lint answering `exitCode` and its tsc `typeExitCode`. */
function contextWith(exitCode: number, interrupted = false, typeExitCode = 0): SuiteStepContext {
  return {
    repoRoot: checkout,
    checkout,
    trackerPath: join(checkout, 'TRACKER.md'),
    sessionId: 'session',
    settings: { testsAlwaysRun: [], testsFullSuiteTriggers: [], testsIntegration: [], testsRetakeRedAlone: false, testsContract: [], checksTask: ['affected'], checksStage: ['related', 'integration'], checksLoop: ['full'] },
    owns: () => Promise.resolve(null),
    isInterrupted: () => interrupted,
    seams: { git, runLint: lintAnswering(exitCode), runTypes: typesAnswering(typeExitCode) },
  };
}

/** A green test run, or one that ended on SIGINT. */
function testRun(exitCode = 0): SuiteResult {
  return {
    command: ['bun', 'test'],
    exitCode,
    summary: exitCode === 0
      ? 'Ran 1 test across 1 file. [5.00ms]'
      : null,
    failures: [],
    errors: exitCode === 0
      ? 0
      : null,
    junit: 'read',
    unhandled: [],
    outputTail: [],
  };
}

describe('lintTask', () => {
  it('lints the task\'s diff through the lint seam', async () => {
    const context = contextWith(0);
    const outcome = await lintTask(context, seamsOf(context), INPUT);
    expect(lintCalls).toBe(1);
    expect(outcome).toEqual({ ran: true, red: false, interrupted: false, blocker: null });
  });

  it('reads a lint ended by SIGINT as a stop, not red', async () => {
    const context = contextWith(SIGINT_EXIT_CODE);
    const outcome = await lintTask(context, seamsOf(context), INPUT);
    expect(outcome.interrupted).toBe(true);
    expect(outcome.red).toBe(false);
  });
});

describe('typeCheckTask', () => {
  it('type-checks the task\'s test files through the tsc seam', async () => {
    const context = contextWith(0);
    const outcome = await typeCheckTask(context, seamsOf(context), INPUT);
    expect(typeCalls).toBe(1);
    expect(outcome).toEqual({ ran: true, red: false, interrupted: false, cannotStart: false, blocker: null });
  });

  it('reads a tsc run ended by SIGINT as a stop, not red', async () => {
    const context = contextWith(0, false, SIGINT_EXIT_CODE);
    const outcome = await typeCheckTask(context, seamsOf(context), INPUT);
    expect(outcome.interrupted).toBe(true);
    expect(outcome.red).toBe(false);
  });
});

describe('taskDiffChecks', () => {
  it('carries the lint and the type step after a test run that was not a stop', async () => {
    const context = contextWith(0);
    const checks = await taskDiffChecks(context, seamsOf(context), INPUT, testRun());
    expect(lintCalls).toBe(1);
    expect(typeCalls).toBe(1);
    expect(checks.lint?.ran).toBe(true);
    expect(checks.types?.ran).toBe(true);
  });

  it('runs no type step after a lint ended by SIGINT, carrying the lint alone', async () => {
    const context = contextWith(SIGINT_EXIT_CODE);
    const checks = await taskDiffChecks(context, seamsOf(context), INPUT, testRun());
    expect(lintCalls).toBe(1);
    expect(typeCalls).toBe(0);
    expect(checks.lint?.interrupted).toBe(true);
    expect(checks.types).toBeUndefined();
  });

  it('runs nothing after a test run that ended on SIGINT', async () => {
    const context = contextWith(0);
    const checks = await taskDiffChecks(context, seamsOf(context), INPUT, testRun(SIGINT_EXIT_CODE));
    expect(lintCalls).toBe(0);
    expect(typeCalls).toBe(0);
    expect(checks).toEqual({});
  });

  it('runs nothing once the runner has received SIGINT', async () => {
    const context = contextWith(0, true);
    const checks = await taskDiffChecks(context, seamsOf(context), INPUT, testRun());
    expect(lintCalls).toBe(0);
    expect(typeCalls).toBe(0);
    expect(checks).toEqual({});
  });
});

/** A type step that could not start: tsc exited 127, its blocker naming node. */
const CANNOT_START: TypeOutcome = { ran: false, red: false, interrupted: false, cannotStart: true, blocker: 'The type step could not start tsc: put node on the PATH the loop runs under.' };

/** A red type step: a type error the task added. */
const RED_TYPES: TypeOutcome = { ran: true, red: true, interrupted: false, cannotStart: false, blocker: 'The type step found 1 new type error.' };

/** The tracker {@link settled} plants: one open task the repair would go above. */
const TRACKER = '# Plan\n\n- [ ] Add a file\n';

/** A green task step that recorded no run, carrying `types` as its type step. */
function settlingWith(types: TypeOutcome): Settling {
  return {
    kind: 'task',
    scope: 'none',
    label: 'task step for "Add a file"',
    result: testRun(),
    baseline: null,
    repair: { kind: 'task', task: INPUT.task },
    recorded: null,
    lint: { ran: true, red: false, interrupted: false, blocker: null },
    types,
  };
}

describe('isCheckUnstartable', () => {
  it('answers true for a type step that could not start', () => {
    expect(isCheckUnstartable({ types: CANNOT_START })).toBe(true);
  });

  it('answers false for a red type step, a green one, a lint alone and no check', () => {
    expect(isCheckUnstartable({ types: RED_TYPES })).toBe(false);
    expect(isCheckUnstartable({ types: { ...RED_TYPES, red: false, blocker: null } })).toBe(false);
    expect(isCheckUnstartable({ lint: { ran: true, red: true, interrupted: false, blocker: 'lint' } })).toBe(false);
    expect(isCheckUnstartable({})).toBe(false);
  });
});

describe('settleStep on a check that could not start', () => {
  /** Settles `types` over a planted tracker, answering the outcome and the tracker after it. */
  function settled(types: TypeOutcome): { outcome: ReturnType<typeof settleStep>; tracker: string } {
    const context = contextWith(0);
    writeFileSync(context.trackerPath, TRACKER, 'utf8');
    const outcome = settleStep(context, seamsOf(context), settlingWith(types));
    return { outcome, tracker: readFileSync(context.trackerPath, 'utf8') };
  }

  it('is red on the blocker naming node and writes no repair task', () => {
    const { outcome, tracker } = settled(CANNOT_START);
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toContain('node');
    expect(outcome.blockedLine).toBeNull();
    expect(outcome.repairInserted).toBe(false);
    expect(tracker).toBe(TRACKER);
  });

  it('inserts the repair for the same step with a red type step in its place', () => {
    const { outcome, tracker } = settled(RED_TYPES);
    expect(outcome.red).toBe(true);
    expect(outcome.repairInserted).toBe(true);
    expect(outcome.blockedLine).not.toBeNull();
    expect(tracker).not.toBe(TRACKER);
    expect(tracker).toContain('The type step found 1 new type error.');
  });
});
