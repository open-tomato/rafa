/**
 * The task step's diff checks (`start/task-step-checks.ts`), driven over
 * seams: a scripted git whose diff names one file and a scripted lint
 * runner, in a temporary checkout holding an `eslint.config.mjs`.
 *
 * What the checks find through `runTaskStep` is covered in
 * `suite-step.test.ts`; these cases hold the module's own answer: the
 * lint runs after a test run that was not a stop, and nothing runs after
 * one that was. Each "nothing ran" case is paired with the same input,
 * changed in one thing, that runs the lint.
 */
import type { LintRunner } from './lint-step.js';
import type { SuiteStepContext, TaskStepInput } from './suite-step.js';
import type { GitResult, GitRunner } from '../pr/index.js';
import type { SuiteResult } from '../suite/run.js';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { seamsOf, SIGINT_EXIT_CODE } from './suite-step.js';
import { lintTask, taskDiffChecks } from './task-step-checks.js';

const BASE = 'base0000';
const DIFF_KEY = `diff --name-only -z --no-renames --diff-filter=d ${BASE} HEAD`;
const INPUT: TaskStepInput = { baseline: null, base: BASE, declared: 'affected', task: 'Add a file' };

let checkout: string;
let lintCalls: number;

beforeEach(() => {
  checkout = mkdtempSync(join(tmpdir(), 'task-step-checks-'));
  writeFileSync(join(checkout, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
  lintCalls = 0;
  setActiveOutput(sinkOutput({ info: () => {}, warn: () => {}, error: () => {} }));
});

afterEach(() => {
  setActiveOutput(null);
  rmSync(checkout, { recursive: true, force: true });
});

/** A git whose filtered diff from {@link BASE} is `src/a.ts`. */
const git: GitRunner = (args) => {
  const answer: GitResult = args.join(' ') === DIFF_KEY
    ? { ok: true, stdout: 'src/a.ts\0', stderr: '' }
    : { ok: false, stdout: '', stderr: 'fatal: bad revision' };
  return answer;
};

/** A lint runner answering `exitCode` with an empty report, counting its calls. */
function lintAnswering(exitCode: number): LintRunner {
  return () => {
    lintCalls += 1;
    return Promise.resolve({ exitCode, stdout: '[]', stderr: '' });
  };
}

/** A context over the scratch checkout, its lint answering `exitCode`. */
function contextWith(exitCode: number, interrupted = false): SuiteStepContext {
  return {
    repoRoot: checkout,
    checkout,
    trackerPath: join(checkout, 'TRACKER.md'),
    sessionId: 'session',
    settings: { testsAlwaysRun: [], testsFullSuiteTriggers: [], testsIntegration: [] },
    owns: () => Promise.resolve(null),
    isInterrupted: () => interrupted,
    seams: { git, runLint: lintAnswering(exitCode) },
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

describe('taskDiffChecks', () => {
  it('carries the lint after a test run that was not a stop', async () => {
    const context = contextWith(0);
    const checks = await taskDiffChecks(context, seamsOf(context), INPUT, testRun());
    expect(lintCalls).toBe(1);
    expect(checks.lint?.ran).toBe(true);
  });

  it('runs nothing after a test run that ended on SIGINT', async () => {
    const context = contextWith(0);
    const checks = await taskDiffChecks(context, seamsOf(context), INPUT, testRun(SIGINT_EXIT_CODE));
    expect(lintCalls).toBe(0);
    expect(checks).toEqual({});
  });

  it('runs nothing once the runner has received SIGINT', async () => {
    const context = contextWith(0, true);
    const checks = await taskDiffChecks(context, seamsOf(context), INPUT, testRun());
    expect(lintCalls).toBe(0);
    expect(checks).toEqual({});
  });
});
