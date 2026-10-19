/**
 * The baseline, a task step and the pre-wrap-up step over a planted run
 * that exits 1 with an empty JUnit file (#945), driven through the loop's
 * own `createRunSuiteSteps` and `runSuite`: only the spawn of `bun test`
 * is planted (`SuiteSpawner`), so the exit code, the JUnit file on disk,
 * the output tail, the reading, the recorded step, the baseline file and
 * the tracker are the real ones.
 *
 * The planted run is a checkout whose test files did not load: exit code
 * 1, a summary line, one error, an empty JUnit file and no failing case
 * listed. Every step reads it red as {@link OUTSIDE_CASE_REASON}, with
 * its tail on the record:
 *
 *   - the baseline halts the run before any dispatch, and its file is not
 *     written;
 *   - a task step, over a stored green baseline, is recorded red, and
 *     inserts one repair task whose blocker names the reason;
 *   - the pre-wrap-up step does the same, and the run does not go on to
 *     the wrap-up: it answers `repair`, then `stop` on the repair's
 *     second red.
 *
 * A step retaken on an excess of errors records both runs, so a task or
 * pre-wrap-up step holds two records here, each red the same way.
 *
 * The control is the same run listing one failing case: a baseline with
 * it is written and the run goes on, a task step names the file in its
 * blocker, and no record carries `outsideCase` or a tail.
 */
import type { GitResult, GitRunner } from '../pr/index.js';
import type { SuiteSpawner } from '../suite/run.js';
import type { SessionStep } from '@open-tomato/rafa/core/loop';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '@open-tomato/rafa/core/output';

import { baselineOf, baselinePathFor, readBaseline, writeBaseline } from '../suite/baseline.js';
import { runSuite } from '../suite/run.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { findNextTask } from '../utils/tracker.js';

import { OUTSIDE_CASE_REASON, storedOutsideCaseLine } from './suite-outside-case.js';
import { addToLedger } from './suite-step.js';
import { createRunSuiteSteps } from './suite-steps-run.js';

const BASE = 'base0000';
const HEAD = 'head1111';
const SESSION = 'session-1';

/** One stage with one task, open. */
const TRACKER = ['# Plan: fixture', '', '# Stage: One', '', '- [ ] only task', ''].join('\n');

/** Bun's stderr for a run whose test file did not load: a summary line, one error, no failing case. */
const LOAD_STDERR = [
  'src/a.test.ts:',
  '# Unhandled error between tests',
  'error: Cannot find package \'zod\' from \'/repo/src/a.test.ts\'',
  '',
  ' 0 pass',
  ' 1 fail',
  ' 1 error',
  'Ran 1 test across 1 file. [10.00ms]',
  '',
].join('\n');

/** The same tail as the record holds it: stderr's non-blank lines. */
const LOAD_TAIL = LOAD_STDERR.split('\n').filter((line) => line.trim() !== '');

/** Bun's JUnit file for a run that reached no test case. */
const EMPTY_JUNIT = '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test" tests="0" assertions="0" failures="0" skipped="0" time="0">\n</testsuites>\n';

/** The JUnit file of a run listing one failing case. */
const FAILED_JUNIT = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<testsuites name="bun test" tests="1" assertions="1" failures="1" skipped="0" time="0.01">',
  '  <testsuite name="src/a.test.ts" file="src/a.test.ts" tests="1" assertions="1" failures="1" skipped="0" time="0">',
  '    <testcase name="broke" classname="" time="0.001" file="src/a.test.ts" line="3" assertions="1">',
  '      <failure type="AssertionError" />',
  '    </testcase>',
  '  </testsuite>',
  '</testsuites>',
  '',
].join('\n');

const GREEN_STDERR = ' 1 pass\n 0 fail\nRan 1 test across 1 file. [10.00ms]\n';
const FAILED_STDERR = ' 0 pass\n 1 fail\nRan 1 test across 1 file. [10.00ms]\n';

/** What a planted run answers: its exit code, stderr and JUnit file text. */
interface Planted {
  readonly exitCode: number;
  readonly stderr: string;
  readonly junit: string;
}

const OUTSIDE: Planted = { exitCode: 1, stderr: LOAD_STDERR, junit: EMPTY_JUNIT };
const LISTED: Planted = { exitCode: 1, stderr: FAILED_STDERR, junit: FAILED_JUNIT };
const GREEN: Planted = { exitCode: 0, stderr: GREEN_STDERR, junit: EMPTY_JUNIT };
/** Bun's answer to a run that selects no test file: exit code 1, its own line and no summary. */
const NO_TEST_FILES: Planted = { exitCode: 1, stderr: 'error: 0 test files matching **{.test,.spec,_test_,_spec_}.{js,ts,jsx,tsx}\n', junit: EMPTY_JUNIT };

/** The one `tests.alwaysRun` file the always-run cases name, tracked in the checkout. */
const ALWAYS_RUN_FILE = 'src/x.sweep.test.ts';

let dir: string;
let trackerPath: string;
let lines: { level: string; message: string }[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'suite-step-outside-case-'));
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

/** A git at {@link HEAD} whose diff from {@link BASE} is `src/a.ts`. */
function gitAtHead(tracked: readonly string[] = []): GitRunner {
  const answers: Record<string, GitResult> = {
    'rev-parse --verify HEAD^{commit}': { ok: true, stdout: `${HEAD}\n`, stderr: '' },
    [`diff --name-only -z --no-renames ${BASE} HEAD`]: { ok: true, stdout: 'src/a.ts\0', stderr: '' },
    [`diff --name-only -z --no-renames ${HEAD} HEAD`]: { ok: true, stdout: '', stderr: '' },
    'ls-files -z': { ok: true, stdout: tracked.map((path) => `${path}\0`).join(''), stderr: '' },
  };
  return (args) => answers[args.join(' ')] ?? { ok: false, stdout: '', stderr: `unscripted: ${args.join(' ')}` };
}

/** The loop's steps over `runs`, answered in turn by a planted spawn under the real `runSuite`. */
function stepsOver(runs: readonly Planted[], alwaysRun: readonly string[] = []): { readonly steps: ReturnType<typeof createRunSuiteSteps>; readonly recorded: SessionStep[]; readonly spawned: () => number } {
  const queue = [...runs];
  let spawnedCount = 0;
  const recorded: SessionStep[] = [];
  const spawn: SuiteSpawner = (argv) => {
    const next = queue.shift();
    if (next === undefined) throw new Error('bun test spawned more times than planted');
    spawnedCount += 1;
    const outfile = argv.find((arg) => arg.startsWith('--reporter-outfile='))?.slice('--reporter-outfile='.length);
    if (outfile === undefined) throw new Error('no --reporter-outfile in the argv');
    writeFileSync(outfile, next.junit, 'utf8');
    return Promise.resolve({ exitCode: next.exitCode, stderr: next.stderr });
  };
  const steps = createRunSuiteSteps({
    repoRoot: dir,
    checkout: dir,
    trackerPath,
    sessionId: SESSION,
    settings: { testsFullSuiteTriggers: ['package.json'], testsIntegration: [], testsAlwaysRun: alwaysRun, testsRetakeRedAlone: false, testsContract: [], checksTask: ['affected'], checksStage: ['related', 'integration'], checksLoop: ['full'] },
    planContent: TRACKER,
    gh: () => Promise.reject(new Error('gh is not read by these cases')),
    seams: {
      runSuite: (options) => runSuite({ ...options, spawn }),
      appendStep: (step) => {
        recorded.push(step);
      },
      git: gitAtHead(alwaysRun),
      listTestFiles: () => ['src/a.test.ts'],
      readPreloadFiles: () => ({ state: 'read', files: [] }),
      now: () => new Date('2026-10-01T00:00:00Z'),
    },
  });
  return { steps, recorded, spawned: () => spawnedCount };
}

/** Stores a green baseline for stage One, as an earlier run would have left it. */
function storeGreenBaseline(): void {
  const green = baselineOf(
    { command: ['bun', 'test'], exitCode: 0, summary: 'Ran 1 test across 1 file. [1.00ms]', failures: [], errors: 0, junit: 'read', unhandled: [], outputTail: [] },
    new Date('2026-09-30T00:00:00Z'),
    BASE,
  );
  writeBaseline(baselinePathFor(trackerPath), green);
  addToLedger(trackerPath, [{ stage: 0, name: 'One', commit: BASE, via: 'baseline' }]);
}

/** Ticks the plan's only task, as its commit does. */
function tickTask(): void {
  writeFileSync(trackerPath, TRACKER.replace('- [ ] ', '- [x] '), 'utf8');
}

/** The repair lines of the tracker as it stands. */
function repairLines(): readonly string[] {
  return readFileSync(trackerPath, 'utf8').split('\n')
    .filter((line) => line.includes('Repair the red '));
}

describe('a run that exits 1 with an empty JUnit file and lists no failing case', () => {
  it('halts the baseline before any dispatch, records it with the tail and writes no baseline file', async () => {
    const { steps, recorded, spawned } = stepsOver([OUTSIDE]);

    expect(await steps.beforeSession(findNextTask(TRACKER))).toBe('stop');
    expect(await steps.beforeSession(null)).toBe('stop');

    expect(spawned()).toBe(1);
    expect(existsSync(baselinePathFor(trackerPath))).toBe(false);
    expect(readBaseline(baselinePathFor(trackerPath)).state).not.toBe('read');
    expect(recorded.map((step) => [step.kind, step.exitCode, step.outsideCase, step.outputTail])).toEqual([['baseline', 1, true, LOAD_TAIL]]);
    expect(linesAt('error')[0]).toContain(OUTSIDE_CASE_REASON);
    expect(linesAt('error').join('\n')).toContain('Cannot find package');
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
  });

  it('records a task step red as outside any case, and inserts one repair whose blocker names the reason', async () => {
    storeGreenBaseline();
    // The run is retaken once: the baseline counts no error and this run counts one.
    const { steps, recorded } = stepsOver([OUTSIDE, OUTSIDE]);

    expect(await steps.beforeSession(findNextTask(TRACKER))).toBe('go-on');
    tickTask();
    expect(await steps.afterTask({ task: 'only task', lineNum: 4, status: 'unchecked' }, BASE)).toBe(false);

    expect(recorded.map((step) => [step.kind, step.outsideCase, step.outputTail])).toEqual([['task', true, LOAD_TAIL], ['task', true, LOAD_TAIL]]);
    expect(recorded.at(-1)?.newFailures).toEqual([]);
    const repairs = repairLines();
    expect(repairs).toHaveLength(1);
    const repair = findNextTask(readFileSync(trackerPath, 'utf8'));
    expect(repair?.status).toBe('blocked');
    expect(repair?.blocker).toContain(OUTSIDE_CASE_REASON);
    expect(repair?.blocker).toContain('Cannot find package');
    expect(existsSync(baselinePathFor(trackerPath))).toBe(true);
  });

  it('records the pre-wrap-up step red the same way and halts before the wrap-up', async () => {
    storeGreenBaseline();
    tickTask();
    const { steps, recorded } = stepsOver([OUTSIDE, OUTSIDE, OUTSIDE, OUTSIDE]);

    expect(await steps.beforeSession(null)).toBe('repair');
    expect(recorded.map((step) => [step.kind, step.outsideCase, step.outputTail])).toEqual([['pre-wrap-up', true, LOAD_TAIL], ['pre-wrap-up', true, LOAD_TAIL]]);
    expect(steps.lastPreWrapUp()?.red).toBe(true);
    expect(repairLines()).toHaveLength(1);
    const repair = findNextTask(readFileSync(trackerPath, 'utf8'));
    expect(repair?.blocker).toContain(OUTSIDE_CASE_REASON);

    // The repair's commit ticks it; the step is red again and the run stops, never reaching the wrap-up.
    writeFileSync(trackerPath, readFileSync(trackerPath, 'utf8').replace('- [BLOCKED] ', '- [x] '), 'utf8');
    expect(await steps.beforeSession(null)).toBe('stop');
    expect(recorded.map((step) => step.kind)).toEqual(['pre-wrap-up', 'pre-wrap-up', 'pre-wrap-up', 'pre-wrap-up']);
    expect(repairLines()).toHaveLength(1);
  });
});

describe('the control: a run that exits 1 listing one failing case', () => {
  it('writes the baseline and goes on', async () => {
    const { steps, recorded } = stepsOver([LISTED]);

    expect(await steps.beforeSession(findNextTask(TRACKER))).toBe('go-on');

    expect(readBaseline(baselinePathFor(trackerPath)).state).toBe('read');
    expect(recorded.map((step) => [step.kind, step.outsideCase, step.outputTail])).toEqual([['baseline', undefined, undefined]]);
    expect(linesAt('error')).toEqual([]);
  });

  it('reads a task step red on the listed case, naming its file, with no outside-case mark', async () => {
    storeGreenBaseline();
    const { steps, recorded } = stepsOver([LISTED, LISTED]);

    expect(await steps.beforeSession(findNextTask(TRACKER))).toBe('go-on');
    tickTask();
    expect(await steps.afterTask({ task: 'only task', lineNum: 4, status: 'unchecked' }, BASE)).toBe(false);

    expect(recorded.map((step) => [step.kind, step.outsideCase, step.outputTail])).toEqual([['task', undefined, undefined]]);
    expect(recorded[0]?.newFailures.map((failure) => failure.file)).toEqual(['src/a.test.ts']);
    const repair = findNextTask(readFileSync(trackerPath, 'utf8'));
    expect(repair?.blocker).toContain('src/a.test.ts');
    expect(repair?.blocker).not.toContain(OUTSIDE_CASE_REASON);
  });

  it('keeps a green run green', async () => {
    storeGreenBaseline();
    const { steps } = stepsOver([GREEN]);

    expect(await steps.beforeSession(findNextTask(TRACKER))).toBe('go-on');
    tickTask();
    expect(await steps.afterTask({ task: 'only task', lineNum: 4, status: 'unchecked' }, BASE)).toBe(true);
    expect(repairLines()).toEqual([]);
  });
});

describe('a task step whose first run found no test file, beside a tests.alwaysRun run', () => {
  it('settles green with no outside-case mark and no repair task when the always-run run passes', async () => {
    storeGreenBaseline();
    const { steps, recorded, spawned } = stepsOver([NO_TEST_FILES, GREEN], [ALWAYS_RUN_FILE]);

    expect(await steps.beforeSession(findNextTask(TRACKER))).toBe('go-on');
    tickTask();
    expect(await steps.afterTask({ task: 'only task', lineNum: 4, status: 'unchecked' }, BASE)).toBe(true);

    expect(spawned()).toBe(2);
    expect(recorded.map((step) => [step.kind, step.exitCode, step.outsideCase])).toEqual([['task', 0, undefined]]);
    expect(recorded[0]?.newFailures).toEqual([]);
    expect(repairLines()).toEqual([]);
  });

  it('settles red on the failure the always-run run lists, with one repair task', async () => {
    storeGreenBaseline();
    const { steps, recorded, spawned } = stepsOver([NO_TEST_FILES, LISTED], [ALWAYS_RUN_FILE]);

    expect(await steps.beforeSession(findNextTask(TRACKER))).toBe('go-on');
    tickTask();
    expect(await steps.afterTask({ task: 'only task', lineNum: 4, status: 'unchecked' }, BASE)).toBe(false);

    expect(spawned()).toBe(2);
    expect(recorded.map((step) => [step.kind, step.exitCode, step.outsideCase])).toEqual([['task', 1, undefined]]);
    expect(recorded[0]?.newFailures.map((failure) => failure.file)).toEqual(['src/a.test.ts']);
    expect(repairLines()).toHaveLength(1);
    const repair = findNextTask(readFileSync(trackerPath, 'utf8'));
    expect(repair?.blocker).toContain('src/a.test.ts');
    expect(repair?.blocker).not.toContain(OUTSIDE_CASE_REASON);
  });
});

describe('a stored baseline of a run that found no test file', () => {
  /** A result of Bun's no-test-files run, marked or not, as the baseline file is written from it. */
  const noTestFilesResult = (marked: boolean) => ({
    command: ['bun', 'test'], exitCode: 1, summary: '', failures: [], errors: 0, junit: 'read' as const, unhandled: [], outputTail: [],
    ...(marked
      ? { noTestFiles: true }
      : {}),
  });

  /** Stores that baseline, as an earlier run would have left it. */
  function storeNoTestFilesBaseline(marked: boolean): string {
    const path = baselinePathFor(trackerPath);
    writeBaseline(path, baselineOf(noTestFilesResult(marked), new Date('2026-09-30T00:00:00Z'), BASE));
    return path;
  }

  it('reuses a file carrying the mark with no warning, no suite run and the file left as it was', async () => {
    const path = storeNoTestFilesBaseline(true);
    const before = readFileSync(path, 'utf8');
    expect(before).toContain('"noTestFiles": true');
    const { steps, spawned } = stepsOver([]);

    expect(await steps.beforeSession(findNextTask(TRACKER))).toBe('go-on');

    expect(spawned()).toBe(0);
    expect(linesAt('warn')).toEqual([]);
    expect(linesAt('info').join('\n')).toContain('Suite baseline reused from');
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('warns once on a file of the same shape with no key, records it again with the mark, then reuses it quietly', async () => {
    const path = storeNoTestFilesBaseline(false);
    const before = readFileSync(path, 'utf8');
    expect(before).not.toContain('noTestFiles');
    const first = stepsOver([NO_TEST_FILES]);

    expect(await first.steps.beforeSession(findNextTask(TRACKER))).toBe('go-on');

    const stored = readBaseline(path);
    if (stored.state !== 'read') throw new Error('the baseline was not written again');
    expect(first.spawned()).toBe(1);
    expect(linesAt('warn')).toEqual([storedOutsideCaseLine('SUITE_BASELINE-fixture.json', { exitCode: 1 })]);
    expect(stored.baseline.noTestFiles).toBe(true);
    expect(readFileSync(path, 'utf8')).toContain('"noTestFiles": true');

    lines = [];
    const written = readFileSync(path, 'utf8');
    const second = stepsOver([]);
    expect(await second.steps.beforeSession(findNextTask(TRACKER))).toBe('go-on');

    expect(second.spawned()).toBe(0);
    expect(linesAt('warn')).toEqual([]);
    expect(readFileSync(path, 'utf8')).toBe(written);
  });
});
