/**
 * The task step of `start/suite-task-step.ts`, re-exported by
 * `start/suite-step.ts`, driven over seams: a scripted `runSuite`, a
 * scripted git, a collected record append, and a real tracker under a
 * temporary directory.
 *
 * Nothing here spawns `bun test` or git. The run the step asks for is
 * read off the options handed to the scripted `runSuite`, and every
 * claim that the step did NOT block, run or record is paired with a case
 * where the same step, handed a new failure, does. The other steps' cases
 * are in `suite-step.test.ts`.
 */

import type { SuiteStepContext, SuiteStepSeams } from './suite-step.js';
import type { SuiteBaseline } from '../suite/baseline.js';
import type { SessionStep } from '@open-tomato/rafa/core/loop';
import type { SuiteFailure, SuiteResult, SuiteRunOptions } from '@open-tomato/rafa/suite/run';
import type { GitResult, GitRunner } from '@open-tomato/rafa-pr/pr/index';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { parsePlan } from '@open-tomato/rafa/core/plan';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { findNextTask } from '@open-tomato/rafa/utils/tracker';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { baselineOf } from '../suite/baseline.js';

import { OUTSIDE_CASE_REASON } from './suite-outside-case.js';
import {
  alwaysRunJunitFileFor,
  junitFileFor,
  runPreWrapUpStep,
  runStageStep,
  runTaskStep,
  SIGINT_EXIT_CODE,
} from './suite-step.js';
import * as taskStep from './suite-task-step.js';
import { FOLDED_COMMAND_JOINER } from './task-always-run.js';

const BASE = 'base0000';
const HEAD = 'head1111';
const SESSION = 'session-1';

/** Two stages: the first finished, the second with its task open. */
const TRACKER = [
  '# Plan: fixture',
  '',
  '# Stage: One',
  '',
  '- [x] first task',
  '- [x] second task',
  '',
  '# Stage: Two',
  '',
  '- [ ] third task',
  '- [ ] fourth task',
  '',
].join('\n');

const KNOWN: SuiteFailure = { file: 'src/old.test.ts', name: 'old > still red' };
const FRESH: SuiteFailure = { file: 'src/new.test.ts', name: 'new > broke' };
const FRESH_TWO: SuiteFailure = { file: 'src/new.test.ts', name: 'new > broke too' };

let dir: string;
let trackerPath: string;
let lines: { level: string; message: string }[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'suite-step-'));
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

/** A suite result: green and empty unless told otherwise. */
function result(overrides: Partial<SuiteResult> = {}): SuiteResult {
  return {
    command: ['bun', 'test', '--reporter=junit', '--reporter-outfile=/x.xml'],
    exitCode: 0,
    summary: 'Ran 3 tests across 2 files. [1.00ms]',
    failures: [],
    errors: 0,
    junit: 'read',
    unhandled: [],
    outputTail: [],
    ...overrides,
  };
}

/** A red result naming `failures`. */
function red(failures: readonly SuiteFailure[], overrides: Partial<SuiteResult> = {}): SuiteResult {
  return result({ exitCode: 1, failures, ...overrides });
}

/** A baseline holding `failures`, recorded at {@link BASE}. */
function baselineWith(failures: readonly SuiteFailure[] = [KNOWN]): SuiteBaseline {
  return baselineOf(red(failures), new Date('2026-09-30T00:00:00Z'), BASE);
}

/** A git answering each command from `answers`, by its words joined, and recording the calls. */
function scriptedGit(answers: Readonly<Record<string, GitResult>>, calls: string[] = []): GitRunner {
  return (args) => {
    const key = args.join(' ');
    calls.push(key);
    return answers[key] ?? { ok: false, stdout: '', stderr: `unscripted: ${key}` };
  };
}

/** The git answers of a checkout at {@link HEAD} whose diff from `from` is `paths`, tracking `tracked` when handed. */
function gitAt(diffs: Readonly<Record<string, readonly string[]>>, calls: string[] = [], tracked?: readonly string[]): GitRunner {
  const answers: Record<string, GitResult> = {
    'rev-parse --verify HEAD^{commit}': { ok: true, stdout: `${HEAD}\n`, stderr: '' },
  };
  if (tracked !== undefined) answers['ls-files -z'] = { ok: true, stdout: tracked.map((path) => `${path}\0`).join(''), stderr: '' };
  for (const [from, paths] of Object.entries(diffs)) {
    answers[`diff --name-only -z --no-renames ${from} HEAD`] = { ok: true, stdout: paths.map((path) => `${path}\0`).join(''), stderr: '' };
  }
  return scriptedGit(answers, calls);
}

/** What a context's scripted seams saw. */
interface Seen {
  readonly runs: SuiteRunOptions[];
  readonly steps: SessionStep[];
  /** The tracker's text at each step's append, so a case reads what came first. */
  readonly trackerAtAppend: string[];
  ownsReads: number;
}

/** A context over the temporary tracker, its runs answered in turn from `results`. */
function contextWith(
  results: readonly SuiteResult[],
  options: {
    readonly git?: GitRunner;
    readonly owns?: readonly string[] | null;
    readonly alwaysRun?: readonly string[];
    readonly seams?: SuiteStepSeams;
  } = {},
): { readonly context: SuiteStepContext; readonly seen: Seen } {
  const seen: Seen = { runs: [], steps: [], trackerAtAppend: [], ownsReads: 0 };
  const queue = [...results];
  const context: SuiteStepContext = {
    repoRoot: dir,
    checkout: dir,
    trackerPath,
    sessionId: SESSION,
    settings: {
      testsFullSuiteTriggers: ['bunfig.toml', 'tsconfig*.json', 'package.json'],
      testsIntegration: ['**/*-integration.test.ts'],
      testsAlwaysRun: options.alwaysRun ?? [],
      testsRetakeRedAlone: false,
      testsContract: [],
      checksTask: ['affected'],
      checksStage: ['related', 'integration'],
      checksLoop: ['full'],
    },
    owns: () => {
      seen.ownsReads += 1;
      return Promise.resolve(options.owns ?? null);
    },
    seams: {
      runSuite: (runOptions) => {
        seen.runs.push(runOptions);
        const next = queue.shift();
        if (next === undefined) throw new Error('runSuite called more times than scripted');
        return Promise.resolve(next);
      },
      appendStep: (step) => {
        seen.steps.push(step);
        seen.trackerAtAppend.push(readFileSync(trackerPath, 'utf8'));
      },
      git: options.git ?? gitAt({ [BASE]: ['src/a.ts'] }),
      listTestFiles: () => ['src/a.test.ts', 'src/b/b.test.ts', 'src/c/c.test.ts', 'src/run-integration.test.ts'],
      readPreloadFiles: () => ({ state: 'read', files: ['test/setup.ts'] }),
      now: () => new Date('2026-10-01T00:00:00Z'),
      ...options.seams,
    },
  };
  return { context, seen };
}

/** The lines of one level. */
function linesAt(level: string): readonly string[] {
  return lines.filter((line) => line.level === level).map((line) => line.message);
}

/** What a `bun test` ended by SIGINT midway answers: exit 130, no summary, no JUnit file. */
function killed(overrides: Partial<SuiteResult> = {}): SuiteResult {
  return result({ exitCode: SIGINT_EXIT_CODE, summary: null, errors: null, junit: 'missing', ...overrides });
}

/** `context` with the runner's SIGINT flag reading `flag`. */
function interruptedBy(context: SuiteStepContext, flag: boolean): SuiteStepContext {
  return { ...context, isInterrupted: () => flag };
}

describe('suite-task-step', () => {
  it('is the function suite-step.ts re-exports', () => {
    expect(runTaskStep).toBe(taskStep.runTaskStep);
  });

  it('is not some other suite-step function, so the identity above could fail', () => {
    expect(typeof taskStep.runTaskStep).toBe('function');
    expect(taskStep.runTaskStep).not.toBe(runStageStep);
    expect(taskStep.runTaskStep).not.toBe(runPreWrapUpStep);
  });

  it('keeps its helpers private: only runTaskStep and checkRunsOf, shared with the pre-wrap-up step, are exported', () => {
    expect(Object.keys(taskStep).sort()).toEqual(['checkRunsOf', 'runTaskStep']);
  });
});

describe('runTaskStep', () => {
  const input = { baseline: baselineWith(), base: BASE, declared: 'affected' as const, task: 'second task' };

  it('runs bun test --changed=<base> for an affected line and blocks nothing on a known failure', async () => {
    const { context, seen } = contextWith([red([KNOWN])]);
    const outcome = await runTaskStep(context, input);
    expect(seen.runs[0]).toMatchObject({ changedSince: BASE, cwd: dir });
    expect(seen.runs[0]?.paths).toBeUndefined();
    expect(outcome).toMatchObject({ kind: 'task', red: false, blocker: null, blockedLine: null });
    expect(seen.steps[0]?.scope).toBe('affected');
    expect(seen.steps[0]?.newFailures).toEqual([]);
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
  });

  it('inserts a blocked repair task on a new failure, naming its file, after the step is recorded', async () => {
    const { context, seen } = contextWith([red([KNOWN, FRESH, FRESH_TWO])]);
    const outcome = await runTaskStep(context, input);

    expect(outcome.red).toBe(true);
    expect(outcome.blockedLine).toBe(9);
    expect(seen.steps[0]?.newFailures).toEqual([FRESH, FRESH_TWO]);
    // The record was appended while the tracker still read as before.
    expect(seen.trackerAtAppend[0]).toBe(TRACKER);
    const next = findNextTask(readFileSync(trackerPath, 'utf8'));
    expect(next?.status).toBe('blocked');
    expect(next?.task).toBe(`Repair the red task step at commit ${HEAD}  {agent=build-error-resolver}`);
    expect(next?.blocker).toBe(outcome.blocker ?? '');
    expect(next?.blocker).toContain('src/new.test.ts (2 tests)');
    expect(next?.blocker).toContain('bun test ./src/new.test.ts');
    expect(next?.blocker).not.toContain(KNOWN.file);
  });

  it('records each new failure\'s error lines on the step, and quotes them on the repair task', async () => {
    const thrown = { ...FRESH, errorLines: ['UndeclaredSpendError: spends through claude and declared none', 'second line'] };
    const known = { ...KNOWN, errorLines: ['error: old'] };
    const { context, seen } = contextWith([red([known, thrown, FRESH_TWO])]);
    const outcome = await runTaskStep(context, input);

    expect(seen.steps[0]?.newFailures).toEqual([thrown, FRESH_TWO]);
    // The failures list stays the pairs alone: the lines are kept where a reader acts on them.
    expect(seen.steps[0]?.failures).toEqual([KNOWN, FRESH, FRESH_TWO]);
    expect(findNextTask(readFileSync(trackerPath, 'utf8'))?.blocker).toBe(outcome.blocker ?? '');
    expect(outcome.blocker).toContain('What Bun printed for them: src/new.test.ts "UndeclaredSpendError: spends through claude and declared none" (1 test).');
    expect(outcome.blocker).not.toContain('error: old');
  });

  it('runs the full suite for a tests=full line', async () => {
    const { context, seen } = contextWith([result()]);
    await runTaskStep(context, { ...input, declared: 'full' });
    expect(seen.runs[0]?.paths).toBeUndefined();
    expect(seen.runs[0]?.changedSince).toBeUndefined();
    expect(seen.steps[0]?.scope).toBe('full');
  });

  it('runs the full suite for a diff touching a trigger or a preload file', async () => {
    for (const touched of ['bunfig.toml', 'test/setup.ts']) {
      const { context, seen } = contextWith([result()], { git: gitAt({ [BASE]: ['src/a.ts', touched] }) });
      await runTaskStep(context, input);
      expect(seen.runs[0]?.changedSince).toBeUndefined();
      expect(seen.steps[0]?.scope).toBe('full');
    }
  });

  it('runs a module line over the test files under the Owns: folders its diff touched, reading Owns only then', async () => {
    const affected = contextWith([result()], { owns: ['src/b', 'src/c'] });
    await runTaskStep(affected.context, input);
    expect(affected.seen.ownsReads).toBe(0);

    const module = contextWith([result()], { owns: ['src/b', 'src/c'], git: gitAt({ [BASE]: ['src/b/x.ts'] }) });
    await runTaskStep(module.context, { ...input, declared: 'module' });
    expect(module.seen.ownsReads).toBe(1);
    expect(module.seen.runs[0]?.paths).toEqual(['src/b/b.test.ts']);
    expect(module.seen.steps[0]?.scope).toBe('module');
  });

  it('runs the full suite, with a warning, when git will not answer the diff', async () => {
    const { context, seen } = contextWith([result()], { git: scriptedGit({}) });
    await runTaskStep(context, input);
    expect(seen.steps[0]?.scope).toBe('full');
    expect(seen.runs[0]?.changedSince).toBeUndefined();
    expect(linesAt('warn').some((line) => line.includes('runs the full suite'))).toBe(true);
  });

  it('is red on more errors outside any test than the baseline counted, and not on as many beside a known failure', async () => {
    const atBaseline = contextWith([red([KNOWN], { errors: 1 })]);
    const same = await runTaskStep(atBaseline.context, { ...input, baseline: { ...baselineWith(), errors: 1 } });
    expect(same.red).toBe(false);
    // As many as the baseline is no excess, so the step is not retaken.
    expect(atBaseline.seen.runs).toHaveLength(1);

    const more = contextWith([result({ exitCode: 1, errors: 2 }), result({ exitCode: 1, errors: 2 })]);
    const outcome = await runTaskStep(more.context, { ...input, baseline: { ...baselineWith(), errors: 1 } });
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toContain('1 more error(s) outside any test');
  });

  it('is red on a nonzero exit listing no failing case, though the baseline counts as many errors (#945)', async () => {
    const tail = ['error: Cannot find package \'zod\' from \'/repo/src/a.test.ts\'', ' 0 pass', ' 1 fail', ' 1 error', 'Ran 1 test across 1 file. [1.00ms]'];
    const { context, seen } = contextWith([result({ exitCode: 1, errors: 1, outputTail: tail })]);
    const outcome = await runTaskStep(context, { ...input, baseline: { ...baselineWith(), errors: 1 } });

    expect(outcome.red).toBe(true);
    // No excess of errors over the baseline's, so the step is not retaken.
    expect(seen.runs).toHaveLength(1);
    expect(seen.steps).toEqual([{ ...seen.steps[0]!, exitCode: 1, failures: [], newFailures: [], outsideCase: true, outputTail: tail }]);
    expect(outcome.blocker).toContain(`bun test exited 1 and listed no failing test: ${OUTSIDE_CASE_REASON}.`);
    expect(outcome.blocker).toContain('Cannot find package \'zod\'');
    expect(outcome.blocker).not.toContain('more error(s) outside any test');
    const next = findNextTask(readFileSync(trackerPath, 'utf8'));
    expect(next?.task).toBe(`Repair the red task step at commit ${HEAD}  {agent=build-error-resolver}`);
    expect(next?.blocker).toBe(outcome.blocker ?? '');
  });

  it('is green on the same exit and error count once the run lists a known failing case, recording no outsideCase key', async () => {
    const { context, seen } = contextWith([red([KNOWN], { errors: 1, outputTail: [' 1 fail', ' 1 error'] })]);
    const outcome = await runTaskStep(context, { ...input, baseline: { ...baselineWith(), errors: 1 } });

    expect(outcome.red).toBe(false);
    expect(Object.keys(seen.steps[0] ?? {})).toEqual(['kind', 'scope', 'reason', 'command', 'exitCode', 'summary', 'failures', 'newFailures']);
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
  });

  it('records a step stopped by the runner\'s SIGINT as interrupted and never as failed outside any case', async () => {
    const { context, seen } = contextWith([result({ exitCode: 1, errors: 1, outputTail: [' 1 error'] })]);
    const outcome = await runTaskStep(interruptedBy(context, true), { ...input, baseline: { ...baselineWith(), errors: 1 } });

    expect(outcome).toMatchObject({ red: false, interrupted: true, blocker: null });
    expect(seen.steps[0]?.interrupted).toBe(true);
    expect(seen.steps[0]?.outsideCase).toBeUndefined();
    expect(seen.steps[0]?.outputTail).toBeUndefined();
  });

  it('is red on a nonzero exit with no summary line', async () => {
    const { context } = contextWith([result({ exitCode: 1, summary: null, errors: null, junit: 'missing' })]);
    const outcome = await runTaskStep(context, input);
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toContain('exited 1 and printed no summary line');
  });

  it('is green on a project holding no test file, which Bun answers with exit 1 and no summary line', async () => {
    const { context } = contextWith([result({ exitCode: 1, summary: null, errors: null, junit: 'missing', noTestFiles: true })]);
    const outcome = await runTaskStep(context, input);
    expect(outcome.red).toBe(false);
  });

  it('treats every failure as new without a baseline', async () => {
    const { context, seen } = contextWith([red([KNOWN])]);
    const outcome = await runTaskStep(context, { ...input, baseline: null });
    expect(outcome.red).toBe(true);
    expect(seen.steps[0]?.newFailures).toEqual([KNOWN]);
  });

  it('inserts its repair task after the checklist\'s last task when no open task is left', async () => {
    const done = TRACKER.replaceAll('- [ ]', '- [x]');
    writeFileSync(trackerPath, done, 'utf8');
    const { context } = contextWith([red([FRESH])]);
    const outcome = await runTaskStep(context, input);
    expect(outcome).toMatchObject({ red: true, blockedLine: 11 });
    expect(outcome.blocker).toContain('src/new.test.ts');
    const after = readFileSync(trackerPath, 'utf8').split('\n');
    expect(after[11]?.startsWith(`- [BLOCKED] Repair the red task step at commit ${HEAD}  {agent=build-error-resolver}  `)).toBe(true);
    expect([...after.slice(0, 11), ...after.slice(12)].join('\n')).toBe(done);
  });
});

describe('a task step with errors outside any test', () => {
  const input = { baseline: baselineWith(), base: BASE, declared: 'affected' as const, task: 'second task' };
  const thrown = { file: 'src/boom.test.ts', firstLine: 'TypeError: undefined is not an object (evaluating \'x.foo\')' };
  /** A run whose only red is one error outside any test, which the baseline (0 errors) does not hold. */
  const excess = (): SuiteResult => result({ exitCode: 1, errors: 1, unhandled: [thrown] });

  it('names the throwing file and its first error line in the blocker, retaking nothing when a failure is red too', async () => {
    const { context, seen } = contextWith([red([FRESH], { errors: 1, unhandled: [thrown] })]);
    const outcome = await runTaskStep(context, input);
    expect(outcome.red).toBe(true);
    expect(seen.runs).toHaveLength(1);
    expect(outcome.blocker).toContain('1 more error(s) outside any test');
    expect(outcome.blocker).toContain(`src/boom.test.ts threw "${thrown.firstLine}"`);
    expect(findNextTask(readFileSync(trackerPath, 'utf8'))?.blocker).toContain('src/boom.test.ts');
  });

  it('retakes a step whose only red is the excess and, the retake under the baseline count, prints the intermittent line and stops nothing', async () => {
    const { context, seen } = contextWith([excess(), result()]);
    const outcome = await runTaskStep(context, input);

    expect(seen.runs).toHaveLength(2);
    expect(seen.runs[0]).toBeDefined();
    expect(seen.runs[1]).toEqual(seen.runs[0]!);
    expect(outcome).toMatchObject({ kind: 'task', red: false, interrupted: false, blocker: null, blockedLine: null });
    expect(seen.steps).toHaveLength(2);
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
    const intermittent = linesAt('warn').filter((line) => line.includes('Intermittent'));
    expect(intermittent).toHaveLength(1);
    expect(intermittent[0]).toContain(`src/boom.test.ts threw "${thrown.firstLine}"`);
    expect(linesAt('error')).toEqual([]);
  });

  it('halts on a retake red again, naming the file in the blocker of the repair task it inserts', async () => {
    const { context, seen } = contextWith([excess(), excess()]);
    const outcome = await runTaskStep(context, input);

    expect(seen.runs).toHaveLength(2);
    expect(seen.steps).toHaveLength(2);
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toContain(`src/boom.test.ts threw "${thrown.firstLine}"`);
    expect(findNextTask(readFileSync(trackerPath, 'utf8'))?.blocker).toBe(outcome.blocker ?? '');
    expect(linesAt('warn').some((line) => line.includes('Intermittent'))).toBe(false);
  });

  it('halts on a retake at the baseline\'s count that still lists no failing case, printing no intermittent line', async () => {
    const baseline = { ...baselineWith(), errors: 1 };
    const more = result({ exitCode: 1, errors: 2, unhandled: [thrown] });
    const { context, seen } = contextWith([more, result({ exitCode: 1, errors: 1, outputTail: [' 1 error'] })]);
    const outcome = await runTaskStep(context, { ...input, baseline });

    expect(seen.runs).toHaveLength(2);
    expect(seen.steps.map((step) => step.outsideCase)).toEqual([true, true]);
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toContain(OUTSIDE_CASE_REASON);
    expect(outcome.blocker).not.toContain('more error(s) outside any test');
    expect(linesAt('warn').some((line) => line.includes('Intermittent'))).toBe(false);
  });
});

describe('a red task step\'s repair task', () => {
  const input = { baseline: baselineWith(), base: BASE, declared: 'affected' as const, task: 'second task' };

  /** The task lines of `text` that are repair tasks; a blocker quoting one is no line of its own. */
  function repairLines(text: string): readonly string[] {
    return text.split('\n').filter((line) => /^- \[(?: |x|BLOCKED)\] Repair the red /.test(line));
  }

  /** The tracker's lines with line `at` taken out. */
  function without(text: string, at: number): string {
    const all = text.split('\n');
    return [...all.slice(0, at), ...all.slice(at + 1)].join('\n');
  }

  it('is inserted above the first open task by a red task step, naming the commit, declared for the repair agent', async () => {
    const { context } = contextWith([red([FRESH])]);
    const outcome = await runTaskStep(context, input);

    expect(outcome.blockedLine).toBe(9);
    const after = readFileSync(trackerPath, 'utf8');
    expect(without(after, 9)).toBe(TRACKER);
    const next = findNextTask(after);
    expect(next).toMatchObject({ lineNum: 9, status: 'blocked', task: `Repair the red task step at commit ${HEAD}  {agent=build-error-resolver}` });
    expect(next?.blocker).toBe(outcome.blocker ?? '');
    // The repair names the task whose step was red.
    expect(next?.repairs).toBe(input.task);
    expect(parsePlan(after).tasks.find((task) => task.lineNum === 9)).toMatchObject({ stage: 1, declaration: { agent: 'build-error-resolver' } });
  });

  it('takes the blocker of its own red task step on its line, inserting no second line', async () => {
    const repair = 'Repair the red task step at commit base0000';
    const ticked = TRACKER.replace('- [ ] third task', `- [x] ${repair}  {agent=build-error-resolver}\n- [ ] third task`);
    writeFileSync(trackerPath, ticked, 'utf8');
    const { context } = contextWith([red([FRESH])]);
    const outcome = await runTaskStep(context, { ...input, task: repair });

    expect(outcome).toMatchObject({ red: true, blockedLine: 9 });
    const after = readFileSync(trackerPath, 'utf8');
    expect(after.split('\n')).toHaveLength(ticked.split('\n').length);
    expect(repairLines(after)).toHaveLength(1);
    expect(after.split('\n')[10]).toBe('- [ ] third task');
    const next = findNextTask(after);
    expect(next).toMatchObject({ lineNum: 9, status: 'blocked', task: `${repair}  {agent=build-error-resolver}` });
    expect(next?.blocker).toBe(outcome.blocker ?? '');
  });
});

describe('runTaskStep with tests.alwaysRun', () => {
  const input = { baseline: baselineWith(), base: BASE, declared: 'affected' as const, task: 'second task' };
  const glob = ['src/**/*.sweep.test.ts'];
  const sweep = 'src/tests/leak.sweep.test.ts';
  const tracked = ['src/a.ts', 'src/a.test.ts', 'src/b/x.ts', 'src/b/b.test.ts', sweep];
  const swept: SuiteFailure = { file: sweep, name: 'leak > names a plan path' };
  const lsFiles = 'ls-files -z';

  it('runs an affected step\'s always-run files as a second run, settled as one step', async () => {
    const { context, seen } = contextWith([result(), result()], { alwaysRun: glob, git: gitAt({ [BASE]: ['src/a.ts'] }, [], tracked) });
    const outcome = await runTaskStep(context, input);

    expect(seen.runs).toHaveLength(2);
    expect(seen.runs[0]).toMatchObject({ changedSince: BASE, junitFile: junitFileFor(dir, SESSION, 'task') });
    expect(seen.runs[0]?.paths).toBeUndefined();
    expect(seen.runs[1]).toMatchObject({ paths: [sweep], junitFile: alwaysRunJunitFileFor(dir, SESSION) });
    expect(seen.runs[1]?.changedSince).toBeUndefined();
    expect(seen.steps).toHaveLength(1);
    expect(seen.steps[0]?.scope).toBe('affected');
    expect(seen.steps[0]?.command).toContain(FOLDED_COMMAND_JOINER);
    expect(outcome).toMatchObject({ red: false, blocker: null });
  });

  it('inserts a blocked repair task on a failure only the always-run run found, naming the sweep', async () => {
    const { context, seen } = contextWith([result(), red([swept])], { alwaysRun: glob, git: gitAt({ [BASE]: ['src/a.ts'] }, [], tracked) });
    const outcome = await runTaskStep(context, input);

    expect(outcome.red).toBe(true);
    expect(outcome.blockedLine).toBe(9);
    expect(seen.steps[0]?.newFailures).toEqual([swept]);
    expect(outcome.blocker).toContain(`${sweep} (1 test)`);
    expect(findNextTask(readFileSync(trackerPath, 'utf8'))?.status).toBe('blocked');
  });

  it('runs a module step\'s always-run files in its own path list, in one run', async () => {
    const calls: string[] = [];
    const { context, seen } = contextWith([result()], {
      alwaysRun: glob,
      owns: ['src/b', 'src/c'],
      git: gitAt({ [BASE]: ['src/b/x.ts'] }, calls, tracked),
    });
    await runTaskStep(context, { ...input, declared: 'module' });

    expect(calls).toContain(lsFiles);
    expect(seen.runs).toHaveLength(1);
    expect(seen.runs[0]?.paths).toEqual(['src/b/b.test.ts', sweep]);
    expect(seen.steps[0]?.scope).toBe('module');
  });

  it('adds nothing to a full step, which already runs every file, and does not ask git for them', async () => {
    const calls: string[] = [];
    const { context, seen } = contextWith([result()], { alwaysRun: glob, git: gitAt({ [BASE]: ['src/a.ts'] }, calls, tracked) });
    await runTaskStep(context, { ...input, declared: 'full' });

    expect(seen.runs).toHaveLength(1);
    expect(seen.runs[0]?.paths).toBeUndefined();
    expect(calls).not.toContain(lsFiles);
  });

  it('adds nothing to the full suite a diff git will not answer runs', async () => {
    const calls: string[] = [];
    const { context, seen } = contextWith([result()], { alwaysRun: glob, git: gitAt({}, calls, tracked) });
    await runTaskStep(context, input);

    expect(seen.steps[0]?.scope).toBe('full');
    expect(seen.runs).toHaveLength(1);
    expect(calls).not.toContain(lsFiles);
  });

  it('runs one run and asks git nothing for [], where the same checkout with the default glob runs two', async () => {
    const calls: string[] = [];
    const { context, seen } = contextWith([result()], { alwaysRun: [], git: gitAt({ [BASE]: ['src/a.ts'] }, calls, tracked) });
    await runTaskStep(context, input);
    expect(seen.runs).toHaveLength(1);
    expect(seen.runs[0]?.changedSince).toBe(BASE);
    expect(calls).not.toContain(lsFiles);

    const module = contextWith([result()], { alwaysRun: [], owns: ['src/b'], git: gitAt({ [BASE]: ['src/b/x.ts'] }, [], tracked) });
    await runTaskStep(module.context, { ...input, declared: 'module' });
    expect(module.seen.runs[0]?.paths).toEqual(['src/b/b.test.ts']);
  });

  it('runs one run for a glob matching no tracked file, saying nothing', async () => {
    const { context, seen } = contextWith([result()], { alwaysRun: ['e2e/*.sweep.test.ts'], git: gitAt({ [BASE]: ['src/a.ts'] }, [], tracked) });
    await runTaskStep(context, input);
    expect(seen.runs).toHaveLength(1);
    expect(linesAt('warn')).toEqual([]);
  });

  it('takes no second run after a first run ended on SIGINT, and reads a SIGINT in the second as a stop', async () => {
    const first = contextWith([killed()], { alwaysRun: glob, git: gitAt({ [BASE]: ['src/a.ts'] }, [], tracked) });
    const stoppedFirst = await runTaskStep(first.context, input);
    expect(first.seen.runs).toHaveLength(1);
    expect(stoppedFirst).toMatchObject({ red: false, interrupted: true, blocker: null });

    const second = contextWith([red([FRESH]), killed()], { alwaysRun: glob, git: gitAt({ [BASE]: ['src/a.ts'] }, [], tracked) });
    const stoppedSecond = await runTaskStep(second.context, input);
    expect(second.seen.runs).toHaveLength(2);
    expect(stoppedSecond).toMatchObject({ red: false, interrupted: true, blocker: null });
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
  });
});

describe('runTaskStep timing the always-run files', () => {
  const input = { baseline: baselineWith(), base: BASE, declared: 'affected' as const, task: 'second task' };
  const sweep = 'src/tests/leak.sweep.test.ts';
  const tracked = ['src/a.ts', 'src/a.test.ts', 'src/b/x.ts', 'src/b/b.test.ts', sweep];

  /** A `runSuite` writing a JUnit file timing {@link sweep} at `seconds`, in each run, and recording the files written. */
  function timedRuns(seconds: number, written: string[] = []): SuiteStepSeams {
    return {
      runSuite: (runOptions) => {
        mkdirSync(join(runOptions.junitFile, '..'), { recursive: true });
        writeFileSync(runOptions.junitFile, `<testsuites>\n  <testsuite name="${sweep}" file="${sweep}" time="${seconds}">\n  </testsuite>\n</testsuites>\n`, 'utf8');
        written.push(runOptions.junitFile);
        return Promise.resolve(result());
      },
    };
  }

  /** The slow-sweep lines printed. */
  function slowLines(): readonly string[] {
    return linesAt('info').filter((line) => line.startsWith('🐢'));
  }

  it('names an affected step\'s sweep over the limit, read off the second run\'s JUnit file', async () => {
    const written: string[] = [];
    const { context } = contextWith([], { alwaysRun: ['src/**/*.sweep.test.ts'], git: gitAt({ [BASE]: ['src/a.ts'] }, [], tracked), seams: timedRuns(12, written) });
    await runTaskStep(context, input);

    expect(written).toEqual([junitFileFor(dir, SESSION, 'task'), alwaysRunJunitFileFor(dir, SESSION)]);
    expect(slowLines()).toEqual([`🐢 1 tests.alwaysRun file(s) took over 10s in the task step: ${sweep} (12.0s).`]);
  });

  it('prints no line for the same step with its sweep under the limit', async () => {
    const { context } = contextWith([], { alwaysRun: ['src/**/*.sweep.test.ts'], git: gitAt({ [BASE]: ['src/a.ts'] }, [], tracked), seams: timedRuns(3) });
    await runTaskStep(context, input);
    expect(linesAt('info').some((line) => line.startsWith('🧪'))).toBe(true);
    expect(slowLines()).toEqual([]);
  });

  it('names a module step\'s sweep over the limit, read off the step\'s own JUnit file', async () => {
    const written: string[] = [];
    const { context } = contextWith([], {
      alwaysRun: ['src/**/*.sweep.test.ts'],
      owns: ['src/b'],
      git: gitAt({ [BASE]: ['src/b/x.ts'] }, [], tracked),
      seams: timedRuns(12, written),
    });
    await runTaskStep(context, { ...input, declared: 'module' });

    expect(written).toEqual([junitFileFor(dir, SESSION, 'task')]);
    expect(slowLines()).toHaveLength(1);
  });

  it('times nothing for [], where the same slow report under the default glob prints a line', async () => {
    const { context } = contextWith([], { alwaysRun: [], git: gitAt({ [BASE]: ['src/a.ts'] }, [], tracked), seams: timedRuns(12) });
    await runTaskStep(context, input);
    expect(slowLines()).toEqual([]);

    const control = contextWith([], { alwaysRun: ['src/**/*.sweep.test.ts'], git: gitAt({ [BASE]: ['src/a.ts'] }, [], tracked), seams: timedRuns(12) });
    await runTaskStep(control.context, input);
    expect(slowLines()).toHaveLength(1);
  });
});

describe('runTaskStep linting the task\'s diff', () => {
  const input = { baseline: baselineWith(), base: BASE, declared: 'affected' as const, task: 'second task' };
  const lintKey = `diff --name-only -z --no-renames --diff-filter=d ${BASE} HEAD`;
  const lintRed = { exitCode: 1, stdout: JSON.stringify([{ filePath: 'x', messages: [], errorCount: 1 }]), stderr: '' };

  /** A git answering the task step's diff and the lint step's filtered one, each `paths`. */
  function gitLinting(paths: readonly string[]): GitRunner {
    const tests = gitAt({ [BASE]: paths });
    return (args) => args.join(' ') === lintKey
      ? { ok: true, stdout: paths.map((path) => `${path}\0`).join(''), stderr: '' }
      : tests(args);
  }

  /** Seams linting with `answer`, recording each argv. */
  function linting(answer: { exitCode: number; stdout: string; stderr: string }, argvs: (readonly string[])[] = []): SuiteStepSeams {
    return {
      git: gitLinting(['src/a.ts', 'a.json']),
      runLint: (options) => {
        argvs.push(options.argv);
        return Promise.resolve({ ...answer, stdout: answer.stdout.replace('"x"', JSON.stringify(join(dir, 'a.json'))) });
      },
    };
  }

  beforeEach(() => {
    writeFileSync(join(dir, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
  });

  it('lints the task\'s diff after a green test run and stays green on a green lint', async () => {
    const argvs: (readonly string[])[] = [];
    const { context } = contextWith([result()], { seams: linting({ exitCode: 0, stdout: '[]', stderr: '' }, argvs) });
    const outcome = await runTaskStep(context, input);
    expect(argvs).toEqual([['bunx', 'eslint', '--no-warn-ignored', '--format', 'json', 'src/a.ts', 'a.json']]);
    expect(outcome).toMatchObject({ red: false, blocker: null, blockedLine: null });
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
  });

  it('is red on a red lint under green tests, inserting a repair task blocked on the lint\'s text', async () => {
    const { context, seen } = contextWith([result()], { seams: linting(lintRed) });
    const outcome = await runTaskStep(context, input);
    expect(outcome).toMatchObject({ red: true, interrupted: false, blockedLine: 9 });
    expect(seen.steps[0]?.newFailures).toEqual([]);
    const next = findNextTask(readFileSync(trackerPath, 'utf8'));
    expect(next?.status).toBe('blocked');
    expect(next?.blocker).toBe(outcome.blocker ?? '');
    expect(next?.blocker).toBe('The runner\'s lint step after "second task" found ESLint errors in the task\'s diff. Files with errors: a.json (1 error). Run bunx eslint --no-warn-ignored a.json and make them pass.');
  });

  it('writes one blocker holding both texts, the tests\' first, when both are red', async () => {
    const { context } = contextWith([red([FRESH])], { seams: linting(lintRed) });
    const outcome = await runTaskStep(context, input);
    const next = findNextTask(readFileSync(trackerPath, 'utf8'));
    expect(next?.task).toBe(`Repair the red task step at commit ${HEAD}  {agent=build-error-resolver}`);
    expect(next?.blocker).toBe(outcome.blocker ?? '');
    expect(outcome.blocker?.startsWith('The runner\'s task step after "second task" found failures')).toBe(true);
    expect(outcome.blocker).toContain('bun test ./src/new.test.ts');
    expect(outcome.blocker).toContain('Run bunx eslint --no-warn-ignored a.json');
  });

  it('reads a lint ended by SIGINT as a stop, blocking nothing', async () => {
    const { context, seen } = contextWith([result()], { seams: linting({ ...lintRed, exitCode: SIGINT_EXIT_CODE }) });
    const outcome = await runTaskStep(context, input);
    expect(outcome).toMatchObject({ red: false, interrupted: true, blocker: null });
    expect(seen.steps[0]?.interrupted).toBe(true);
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
  });

  it('does not lint after a test run read as a stop', async () => {
    const argvs: (readonly string[])[] = [];
    const { context } = contextWith([killed()], { seams: linting(lintRed, argvs) });
    const outcome = await runTaskStep(context, input);
    expect(outcome.interrupted).toBe(true);
    expect(argvs).toEqual([]);
  });

  it('runs no lint in a checkout with no eslint.config file, where the same red lint blocks with one', async () => {
    rmSync(join(dir, 'eslint.config.mjs'));
    const argvs: (readonly string[])[] = [];
    const { context } = contextWith([result()], { seams: linting(lintRed, argvs) });
    expect((await runTaskStep(context, input)).red).toBe(false);
    expect(argvs).toEqual([]);
  });
});

describe('runTaskStep type-checking the task\'s test files', () => {
  const input = { baseline: baselineWith(), base: BASE, declared: 'affected' as const, task: 'second task' };
  const lintKey = `diff --name-only -z --no-renames --diff-filter=d ${BASE} HEAD`;
  const typeKey = `diff --name-status -z --find-renames --diff-filter=d ${BASE} HEAD`;
  const typeError = 'src/a.test.ts(3,7): error TS2322: Type \'string\' is not assignable to type \'number\'.';
  const typeRed = { exitCode: 2, stdout: `${typeError}\n`, stderr: '' };
  const typeGreen = { exitCode: 0, stdout: '', stderr: '' };
  const typeBlocker = 'The runner\'s type step after "second task" found type errors in the task\'s test files that base0000 did not hold. '
    + 'New errors: src/a.test.ts:3:7 TS2322 Type \'string\' is not assignable to type \'number\'. '
    + 'Fix them, then check src/a.test.ts with tsc --noEmit --pretty false -p over a tsconfig outside the checkout '
    + 'that extends its tsconfig.json by absolute path and lists them under files.';

  /** A git answering the task step's diff, the lint step's and the type step's, the test file added since {@link BASE}. */
  function gitTyping(): GitRunner {
    const paths = ['src/a.ts', 'src/a.test.ts'];
    const tests = gitAt({ [BASE]: paths });
    return (args) => {
      const key = args.join(' ');
      if (key === lintKey) return { ok: true, stdout: paths.map((path) => `${path}\0`).join(''), stderr: '' };
      if (key === typeKey) return { ok: true, stdout: 'M\0src/a.ts\0A\0src/a.test.ts\0', stderr: '' };
      return tests(args);
    };
  }

  /** Seams type-checking with `answer`, recording each tsc spawn; `during` runs inside the spawn. */
  function typing(answer: { exitCode: number; stdout: string; stderr: string }, spawns: { cwd: string; argv: readonly string[] }[] = [], during: () => void = () => {}): SuiteStepSeams {
    return {
      git: gitTyping(),
      runLint: () => Promise.resolve({ exitCode: 0, stdout: '[]', stderr: '' }),
      runTypes: (options) => {
        spawns.push({ cwd: options.cwd, argv: options.argv });
        during();
        return Promise.resolve(answer);
      },
    };
  }

  beforeEach(() => {
    writeFileSync(join(dir, 'tsconfig.json'), '{}\n', 'utf8');
  });

  it('type-checks the task\'s test file after a green test run and stays green on no type error', async () => {
    const spawns: { cwd: string; argv: readonly string[] }[] = [];
    const { context } = contextWith([result()], { seams: typing(typeGreen, spawns) });
    const outcome = await runTaskStep(context, input);
    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.cwd).toBe(dir);
    expect(spawns[0]?.argv[0]).toBe(join(dir, 'node_modules', '.bin', 'tsc'));
    expect(spawns[0]?.argv.slice(3)).toEqual(['--noEmit', '--pretty', 'false']);
    expect(outcome).toMatchObject({ red: false, interrupted: false, blocker: null, blockedLine: null });
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
  });

  it('is red on a new type error under green tests and a green lint, inserting a repair task blocked on the type step\'s text', async () => {
    const { context, seen } = contextWith([result()], { seams: typing(typeRed) });
    const outcome = await runTaskStep(context, input);
    expect(outcome).toMatchObject({ red: true, interrupted: false, blockedLine: 9, blocker: typeBlocker });
    expect(seen.steps[0]?.newFailures).toEqual([]);
    const next = findNextTask(readFileSync(trackerPath, 'utf8'));
    expect(next?.status).toBe('blocked');
    expect(next?.blocker).toBe(typeBlocker);
  });

  it('runs no type step in a checkout with no tsconfig.json, where the same new error blocks with one', async () => {
    rmSync(join(dir, 'tsconfig.json'));
    const spawns: { cwd: string; argv: readonly string[] }[] = [];
    const { context } = contextWith([result()], { seams: typing(typeRed, spawns) });
    expect(await runTaskStep(context, input)).toMatchObject({ red: false, blocker: null });
    expect(spawns).toEqual([]);
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
  });

  it('writes one blocker holding the tests\' text, then the lint\'s, then the type step\'s, when all three are red', async () => {
    writeFileSync(join(dir, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
    const lintReport = JSON.stringify([{ filePath: join(dir, 'src/a.ts'), messages: [], errorCount: 1 }]);
    const seams: SuiteStepSeams = { ...typing(typeRed), runLint: () => Promise.resolve({ exitCode: 1, stdout: lintReport, stderr: '' }) };
    const { context } = contextWith([red([FRESH])], { seams });
    const outcome = await runTaskStep(context, input);
    const blocker = outcome.blocker ?? '';
    const tested = blocker.indexOf('The runner\'s task step after "second task" found failures');
    const linted = blocker.indexOf('The runner\'s lint step after "second task" found ESLint errors');
    const typed = blocker.indexOf(typeBlocker);
    expect(tested).toBe(0);
    expect(linted).toBeGreaterThan(tested);
    expect(typed).toBeGreaterThan(linted);
    expect(blocker.endsWith(typeBlocker)).toBe(true);
    expect(findNextTask(readFileSync(trackerPath, 'utf8'))?.blocker).toBe(blocker);
  });

  it('retakes nothing when the type step is red beside an excess of errors outside any test', async () => {
    const excess = result({ exitCode: 1, errors: 1, unhandled: [{ file: 'src/boom.test.ts', firstLine: 'TypeError: boom' }] });
    const { context, seen } = contextWith([excess, result()], { seams: typing(typeRed) });
    const outcome = await runTaskStep(context, input);
    expect(seen.runs).toHaveLength(1);
    expect(outcome.red).toBe(true);
    expect(outcome.blocker?.endsWith(typeBlocker)).toBe(true);
  });

  it('reads a type step ended on the stop code as a stop, blocking nothing', async () => {
    const { context, seen } = contextWith([result()], { seams: typing({ ...typeRed, exitCode: SIGINT_EXIT_CODE }) });
    const outcome = await runTaskStep(context, input);
    expect(outcome).toMatchObject({ red: false, interrupted: true, blocker: null, blockedLine: null });
    expect(seen.steps).toHaveLength(1);
    expect(seen.steps[0]?.interrupted).toBe(true);
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
  });

  it('reads a SIGINT the runner received while tsc ran as a stop, though tsc printed a new error', async () => {
    let sigint = false;
    const spawns: { cwd: string; argv: readonly string[] }[] = [];
    const { context, seen } = contextWith([result()], { seams: typing(typeRed, spawns, () => {
      sigint = true;
    }) });
    const outcome = await runTaskStep({ ...context, isInterrupted: () => sigint }, input);
    expect(spawns).toHaveLength(1);
    expect(outcome).toMatchObject({ red: false, interrupted: true, blocker: null });
    expect(seen.steps[0]?.interrupted).toBe(true);
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
  });

  it('runs no type step after a lint read as a stop', async () => {
    writeFileSync(join(dir, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
    const spawns: { cwd: string; argv: readonly string[] }[] = [];
    const seams: SuiteStepSeams = { ...typing(typeRed, spawns), runLint: () => Promise.resolve({ exitCode: SIGINT_EXIT_CODE, stdout: '', stderr: '' }) };
    const { context } = contextWith([result()], { seams });
    expect((await runTaskStep(context, input)).interrupted).toBe(true);
    expect(spawns).toEqual([]);
  });

  it('runs no type step after a test run read as a stop', async () => {
    const spawns: { cwd: string; argv: readonly string[] }[] = [];
    const { context } = contextWith([killed()], { seams: typing(typeRed, spawns) });
    expect((await runTaskStep(context, input)).interrupted).toBe(true);
    expect(spawns).toEqual([]);
  });
});

describe('the recorded task step\'s reason', () => {
  const task = { baseline: baselineWith(), base: BASE, task: 'second task' };

  it('records declared for a tests=affected line, right after the scope', async () => {
    const { context, seen } = contextWith([result()]);
    await runTaskStep(context, { ...task, declared: 'affected' });
    expect(seen.steps[0]).toMatchObject({ scope: 'affected', reason: 'declared' });
    expect(Object.keys(seen.steps[0] ?? {}).slice(0, 3)).toEqual(['kind', 'scope', 'reason']);
  });

  it('records declared for a tests=full line', async () => {
    const { context, seen } = contextWith([result()]);
    await runTaskStep(context, { ...task, declared: 'full' });
    expect(seen.steps[0]).toMatchObject({ scope: 'full', reason: 'declared' });
  });

  it('records trigger for a diff touching a full-suite trigger, against declared for the same line without it', async () => {
    const triggered = contextWith([result()], { git: gitAt({ [BASE]: ['package.json'] }) });
    await runTaskStep(triggered.context, { ...task, declared: 'affected' });
    expect(triggered.seen.steps[0]).toMatchObject({ scope: 'full', reason: 'trigger' });
    const plain = contextWith([result()]);
    await runTaskStep(plain.context, { ...task, declared: 'affected' });
    expect(plain.seen.steps[0]?.reason).toBe('declared');
  });

  it('records fallback for a tests=module line with no Owns: folder', async () => {
    const { context, seen } = contextWith([result()], { owns: null });
    await runTaskStep(context, { ...task, declared: 'module' });
    expect(seen.steps[0]).toMatchObject({ scope: 'affected', reason: 'fallback' });
  });

  it('records no-module-tests for a tests=module line whose touched folder holds no test file', async () => {
    const { context, seen } = contextWith([result()], { owns: ['src/d'], git: gitAt({ [BASE]: ['src/d/x.ts'] }) });
    await runTaskStep(context, { ...task, declared: 'module' });
    expect(seen.steps[0]).toMatchObject({ scope: 'affected', reason: 'no-module-tests' });
  });

  it('records declared for a tests=module line run over its module\'s test files', async () => {
    const { context, seen } = contextWith([result()], { owns: ['src/b'], git: gitAt({ [BASE]: ['src/b/x.ts'] }) });
    await runTaskStep(context, { ...task, declared: 'module' });
    expect(seen.steps[0]).toMatchObject({ scope: 'module', reason: 'declared' });
  });

  it('records no reason for a task step whose diff git will not answer', async () => {
    const { context, seen } = contextWith([result()], { git: gitAt({}) });
    await runTaskStep(context, { ...task, declared: 'affected' });
    expect(seen.steps[0]?.scope).toBe('full');
    expect(Object.keys(seen.steps[0] ?? {})).not.toContain('reason');
  });

  it('keeps the reason on a step stopped by SIGINT and on both runs of a retaken step', async () => {
    const stopped = contextWith([killed()]);
    await runTaskStep(stopped.context, { ...task, declared: 'affected' });
    expect(stopped.seen.steps[0]).toMatchObject({ interrupted: true, reason: 'declared' });
    const retaken = contextWith([result({ errors: 1 }), result()]);
    await runTaskStep(retaken.context, { ...task, declared: 'affected' });
    expect(retaken.seen.steps.map((step) => step.reason)).toEqual(['declared', 'declared']);
  });
});

describe('a task step stopped by SIGINT', () => {
  const input = { baseline: baselineWith(), base: BASE, declared: 'affected' as const, task: 'second task' };

  it('records a task step whose bun test ended on SIGINT as interrupted, writing no blocker', async () => {
    const { context, seen } = contextWith([killed()]);
    const outcome = await runTaskStep(context, input);

    expect(outcome).toMatchObject({ kind: 'task', red: false, interrupted: true, blocker: null, blockedLine: null });
    expect(seen.steps).toHaveLength(1);
    expect(seen.steps[0]).toMatchObject({ kind: 'task', exitCode: 130, summary: null, newFailures: [], interrupted: true });
    expect(outcome.step).toEqual(seen.steps[0] ?? null);
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
    expect(linesAt('error')).toEqual([]);
    expect(linesAt('info').some((line) => line.includes('interrupted by SIGINT'))).toBe(true);
  });

  it('inserts a blocked repair task on the same run ended by exit 1, the control that the step could have written', async () => {
    const { context, seen } = contextWith([killed({ exitCode: 1 })]);
    const outcome = await runTaskStep(context, input);

    expect(outcome).toMatchObject({ red: true, interrupted: false, blockedLine: 9 });
    expect(Object.keys(seen.steps[0] ?? {})).not.toContain('interrupted');
    expect(findNextTask(readFileSync(trackerPath, 'utf8'))?.status).toBe('blocked');
  });

  it('reads a step as interrupted when the runner received SIGINT, whatever bun test answered', async () => {
    const { context, seen } = contextWith([red([FRESH])]);
    const outcome = await runTaskStep(interruptedBy(context, true), input);

    expect(outcome).toMatchObject({ red: false, interrupted: true, blocker: null, blockedLine: null });
    expect(seen.steps[0]).toMatchObject({ failures: [FRESH], newFailures: [], interrupted: true });
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);

    // Control: the same new failure with the flag down blocks the next task.
    const control = contextWith([red([FRESH])]);
    expect((await runTaskStep(interruptedBy(control.context, false), input)).red).toBe(true);
  });
});
