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
 * changed in one thing, that runs the check.
 */
import type { LintRunner } from './lint-step.js';
import type { SuiteStepContext, TaskStepInput } from './suite-step.js';
import type { TypeRunner } from './type-step.js';
import type { GitResult, GitRunner } from '../pr/index.js';
import type { SuiteResult } from '../suite/run.js';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { seamsOf, SIGINT_EXIT_CODE } from './suite-step.js';
import { lintTask, taskDiffChecks, typeCheckTask } from './task-step-checks.js';

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
    settings: { testsAlwaysRun: [], testsFullSuiteTriggers: [], testsIntegration: [], testsRetakeRedAlone: false },
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
    expect(outcome).toEqual({ ran: true, red: false, interrupted: false, blocker: null });
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
