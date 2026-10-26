/**
 * The pre-wrap-up step of `start/suite-step.ts` reading `checks.loop`,
 * and `ensureBaseline` reading the three check-point entries, driven
 * over seams: a scripted `runSuite` that records what it was handed, a
 * scripted git that records each call, a collected record append, and a
 * real tracker under a temporary directory.
 *
 * Nothing here spawns `bun test`, git or `gh`. What a step runs is read
 * off the options handed to the scripted `runSuite`. Each claim that an
 * empty entry runs, records or blocks nothing is paired with the same
 * call over a non-empty entry, which does. The cases over a `[full]`
 * entry's retakes and repairs are in `suite-step.test.ts` and
 * `suite-retake-alone.test.ts`.
 */

import type { SuiteStepContext } from './suite-step.js';
import type { CheckName } from '../config-schema-checks.js';
import type { GitResult, GitRunner } from '../pr/index.js';
import type { SuiteBaseline } from '../suite/baseline.js';
import type { SuiteFailure, SuiteResult, SuiteRunOptions } from '../suite/run.js';
import type { SessionStep } from '@open-tomato/rafa/core/loop';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { findNextTask } from '@open-tomato/rafa/utils/tracker';

import { baselineOf, baselinePathFor, writeBaseline } from '../suite/baseline.js';
import { sinkOutput } from '../tests/output-sinks.js';

import {
  alwaysRunJunitFileFor,
  ensureBaseline,
  junitFileFor,
  readStageLedger,
  runPreWrapUpStep,
  stageLedgerPathFor,
} from './suite-step.js';
import { createRunSuiteSteps } from './suite-steps-run.js';

const BASE = 'base0000';
const HEAD = 'head1111';
const SESSION = 'session-1';

/** A plan whose every task is ticked: the wrap-up is next. */
const TRACKER = '# Plan: fixture\n\n# Stage: One\n\n- [x] first task\n';

/** The project's test files, as the `listTestFiles` seam answers them. */
const TEST_FILES: readonly string[] = [
  'src/a.test.ts',
  'src/b/b-integration.test.ts',
  'src/b/b.test.ts',
  'src/c/c.contract.test.ts',
  'src/c/c.test.ts',
  'src/run-integration.test.ts',
];

/** The always-run sweep `tests.alwaysRun` names, tracked beside the test files. */
const SWEEP = 'src/tests/repo.sweep.test.ts';

/** The failure the fixture suite reports, which the baseline does not hold. */
const FRESH: SuiteFailure = { file: 'src/b/b.test.ts', name: 'b > broke' };

/** The line an empty `checks.loop` prints. */
const NO_CHECK_LINE = '🧪 pre-wrap-up step: no check configured (checks.loop is empty); nothing ran.';

/** The line `ensureBaseline` prints when no entry names a check. */
const NO_BASELINE_LINE = '📏 No check-point entry names a check; no suite baseline is taken.';

/** The `none` step an empty `checks.loop` records. */
const NONE_STEP: SessionStep = { kind: 'pre-wrap-up', scope: 'none', reason: 'no-check', command: [], exitCode: 0, summary: null, failures: [], newFailures: [] };

let dir: string;
let trackerPath: string;
let lines: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'suite-loop-entry-'));
  mkdirSync(join(dir, '.rafa', 'plans'), { recursive: true });
  trackerPath = join(dir, '.rafa', 'plans', 'PLAN_TRACKER-fixture.md');
  writeFileSync(trackerPath, TRACKER, 'utf8');
  lines = [];
  setActiveOutput(sinkOutput({
    info: (message) => lines.push(message),
    warn: (message) => lines.push(message),
    error: (message) => lines.push(message),
  }));
});

afterEach(() => {
  setActiveOutput(null);
  rmSync(dir, { recursive: true, force: true });
});

/** A suite result, red with {@link FRESH} when `failing`. */
function suiteResult(failing: boolean): SuiteResult {
  return {
    command: ['bun', 'test'],
    exitCode: failing
      ? 1
      : 0,
    summary: failing
      ? 'Ran 2 tests across 1 files. 1 pass 1 fail [1.00ms]'
      : 'Ran 2 tests across 1 files. [1.00ms]',
    failures: failing
      ? [FRESH]
      : [],
    errors: 0,
    junit: 'read',
    unhandled: [],
    outputTail: [],
  };
}

/** A green baseline recorded at {@link BASE}, the commit the plan's diff is taken from. */
function baseline(): SuiteBaseline {
  return baselineOf(suiteResult(false), new Date('2026-09-30T00:00:00Z'), BASE);
}

/** A git at {@link HEAD} whose diff from {@link BASE} is `diff`, tracking the test files and {@link SWEEP}; it records each call. */
function gitOver(diff: readonly string[], calls: string[]): GitRunner {
  const listed = (paths: readonly string[]): GitResult => ({ ok: true, stdout: paths.map((path) => `${path}\0`).join(''), stderr: '' });
  const answers: Readonly<Record<string, GitResult>> = {
    'rev-parse --verify HEAD^{commit}': { ok: true, stdout: `${HEAD}\n`, stderr: '' },
    [`diff --name-only -z --no-renames ${BASE} HEAD`]: listed(diff),
    'ls-files -z': listed([...TEST_FILES, SWEEP]),
  };
  return (args) => {
    const key = args.join(' ');
    calls.push(key);
    return answers[key] ?? { ok: false, stdout: '', stderr: `unscripted: ${key}` };
  };
}

/** What a context's seams saw. */
interface Seen {
  readonly runs: SuiteRunOptions[];
  readonly steps: SessionStep[];
  readonly git: string[];
}

/** The three check-point entries, the other `tests.*` keys a case sets, and the step's surroundings. */
interface Setup {
  readonly task?: readonly CheckName[];
  readonly stage?: readonly CheckName[];
  readonly loop?: readonly CheckName[];
  readonly diff?: readonly string[];
  readonly alwaysRun?: readonly string[];
  /** True when every run reports {@link FRESH}. */
  readonly failing?: boolean;
}

/** The settings a context holds for `setup`: the `escalation` template's globs, a contract glob, and the entries it names, each empty when left out. */
function settingsOf(setup: Setup): SuiteStepContext['settings'] {
  return {
    testsFullSuiteTriggers: ['bunfig.toml', 'tsconfig*.json', 'package.json'],
    testsIntegration: ['**/*-integration.test.ts'],
    testsContract: ['**/*.contract.test.ts'],
    testsAlwaysRun: setup.alwaysRun ?? [],
    testsRetakeRedAlone: false,
    checksTask: setup.task ?? [],
    checksStage: setup.stage ?? [],
    checksLoop: setup.loop ?? [],
  };
}

/** The seams every case runs over, filling `seen`. */
function seamsOf(setup: Setup, seen: Seen): NonNullable<SuiteStepContext['seams']> {
  return {
    runSuite: (options) => {
      seen.runs.push(options);
      return Promise.resolve(suiteResult(setup.failing === true));
    },
    appendStep: (step) => seen.steps.push(step),
    git: gitOver(setup.diff ?? ['src/b/x.ts'], seen.git),
    listTestFiles: () => TEST_FILES,
    readPreloadFiles: () => ({ state: 'read', files: [] }),
    now: () => new Date('2026-10-01T00:00:00Z'),
  };
}

/** A context over `setup`, its `Owns:` folders `src/b`. */
function contextWith(setup: Setup): { readonly context: SuiteStepContext; readonly seen: Seen } {
  const seen: Seen = { runs: [], steps: [], git: [] };
  const context: SuiteStepContext = {
    repoRoot: dir,
    checkout: dir,
    trackerPath,
    sessionId: SESSION,
    settings: settingsOf(setup),
    owns: () => Promise.resolve(['src/b']),
    seams: seamsOf(setup, seen),
  };
  return { context, seen };
}

describe('runPreWrapUpStep over an empty checks.loop', () => {
  it('runs nothing under a failing fixture suite, reads no diff, blocks nothing, and records a none step with reason no-check', async () => {
    const { context, seen } = contextWith({ failing: true });
    const outcome = await runPreWrapUpStep(context, baseline());

    expect(seen.runs).toEqual([]);
    expect(seen.git).not.toContain(`diff --name-only -z --no-renames ${BASE} HEAD`);
    expect(seen.steps).toEqual([NONE_STEP]);
    expect(outcome).toEqual({ kind: 'pre-wrap-up', step: NONE_STEP, red: false, interrupted: false, blocker: null, blockedLine: null, repairInserted: false });
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
    expect(lines).toContain(NO_CHECK_LINE);
    expect(lines.some((line) => line.includes('passed'))).toBe(false);
  });

  it('runs the same failing suite under [full] and inserts a [BLOCKED] repair, the control that the step could have blocked', async () => {
    const { context, seen } = contextWith({ loop: ['full'], failing: true });
    const outcome = await runPreWrapUpStep(context, baseline());

    expect(seen.runs).toHaveLength(1);
    expect(outcome).toMatchObject({ red: true, repairInserted: true });
    expect(findNextTask(readFileSync(trackerPath, 'utf8'))?.status).toBe('blocked');
    expect(lines).not.toContain(NO_CHECK_LINE);
  });

  it('lets beforeSession start the wrap-up on the none step, where [full] over the failing suite turns back for its repair', async () => {
    // A green stored baseline, so the failing fixture suite is new against it and no case runs the baseline.
    writeBaseline(baselinePathFor(trackerPath), baseline());
    const options = (loop: readonly CheckName[], seen: Seen): Parameters<typeof createRunSuiteSteps>[0] => ({
      repoRoot: dir,
      checkout: dir,
      trackerPath,
      sessionId: SESSION,
      settings: settingsOf({ task: ['affected'], loop }),
      planContent: TRACKER,
      gh: () => Promise.reject(new Error('gh is not read by these cases')),
      seams: seamsOf({ failing: true }, seen),
    });

    const empty: Seen = { runs: [], steps: [], git: [] };
    expect(await createRunSuiteSteps(options([], empty)).beforeSession(null)).toBe('go-on');
    expect(empty.runs).toEqual([]);
    expect(empty.steps).toEqual([NONE_STEP]);

    const full: Seen = { runs: [], steps: [], git: [] };
    expect(await createRunSuiteSteps(options(['full'], full)).beforeSession(null)).toBe('repair');
    expect(full.runs).toHaveLength(1);
    expect(full.steps.map((step) => [step.kind, step.scope])).toEqual([['pre-wrap-up', 'full']]);
  });
});

describe('runPreWrapUpStep over a non-empty checks.loop', () => {
  it('runs one path list under [related, contract, integration], each file once, from the plan\'s diff since the baseline\'s commit', async () => {
    const { context, seen } = contextWith({ loop: ['related', 'contract', 'integration'] });
    const outcome = await runPreWrapUpStep(context, baseline());

    const paths = ['src/b/b-integration.test.ts', 'src/b/b.test.ts', 'src/c/c.contract.test.ts', 'src/run-integration.test.ts'];
    expect(seen.git).toContain(`diff --name-only -z --no-renames ${BASE} HEAD`);
    expect(seen.runs).toEqual([{ cwd: dir, junitFile: junitFileFor(dir, SESSION, 'pre-wrap-up'), paths }]);
    expect(seen.steps).toHaveLength(1);
    expect(seen.steps[0]).toMatchObject({ kind: 'pre-wrap-up', scope: paths, reason: 'declared' });
    expect(outcome.red).toBe(false);
  });

  it('joins the tests.alwaysRun files to a path list [related] is in, and not to one it is out of', async () => {
    const related = contextWith({ loop: ['related'], alwaysRun: [SWEEP] });
    await runPreWrapUpStep(related.context, baseline());
    expect(related.seen.runs.map((run) => run.paths)).toEqual([['src/b/b-integration.test.ts', 'src/b/b.test.ts', SWEEP]]);

    const contract = contextWith({ loop: ['contract'], alwaysRun: [SWEEP] });
    await runPreWrapUpStep(contract.context, baseline());
    expect(contract.seen.runs.map((run) => run.paths)).toEqual([['src/c/c.contract.test.ts']]);
  });

  it('runs --changed from the baseline\'s commit under [affected], the tests.alwaysRun files as a second run', async () => {
    const { context, seen } = contextWith({ loop: ['affected'], alwaysRun: [SWEEP] });
    await runPreWrapUpStep(context, baseline());

    expect(seen.runs).toEqual([
      { cwd: dir, junitFile: junitFileFor(dir, SESSION, 'pre-wrap-up'), changedSince: BASE },
      { cwd: dir, junitFile: alwaysRunJunitFileFor(dir, SESSION, 'pre-wrap-up'), paths: [SWEEP] },
    ]);
    expect(seen.steps[0]).toMatchObject({ scope: 'affected', reason: 'declared' });
  });

  it('runs the full suite with reason trigger under [affected] over a bunfig.toml diff', async () => {
    const { context, seen } = contextWith({ loop: ['affected'], diff: ['bunfig.toml'] });
    await runPreWrapUpStep(context, baseline());

    expect(seen.runs).toEqual([{ cwd: dir, junitFile: junitFileFor(dir, SESSION, 'pre-wrap-up') }]);
    expect(seen.steps[0]).toMatchObject({ scope: 'full', reason: 'trigger' });
  });

  it('runs one path-less command under [full], reading no diff, reason declared', async () => {
    const { context, seen } = contextWith({ loop: ['full'] });
    await runPreWrapUpStep(context, baseline());

    expect(seen.runs).toEqual([{ cwd: dir, junitFile: junitFileFor(dir, SESSION, 'pre-wrap-up') }]);
    expect(seen.git).not.toContain(`diff --name-only -z --no-renames ${BASE} HEAD`);
    expect(seen.steps[0]).toMatchObject({ scope: 'full', reason: 'declared' });
  });

  it('prints the nothing-to-run line, records no step and blocks nothing for a path list empty of files', async () => {
    const { context, seen } = contextWith({ loop: ['related'], diff: ['docs/x.md'], failing: true });
    const outcome = await runPreWrapUpStep(context, baseline());

    expect(seen.runs).toEqual([]);
    expect(seen.steps).toEqual([]);
    expect(outcome).toMatchObject({ step: null, red: false });
    expect(lines).toContain('🧪 pre-wrap-up step: no test file in the paths checks.loop names; nothing to run.');
  });
});

describe('ensureBaseline over the three check-point entries', () => {
  it('takes no baseline when checks.task, checks.stage and checks.loop are all empty: no run, no record, no file, no ledger', async () => {
    const { context, seen } = contextWith({ failing: true });
    const outcome = await ensureBaseline(context);

    expect(outcome).toEqual({ baseline: null, step: null, interrupted: false, halted: false });
    expect(seen.runs).toEqual([]);
    expect(seen.steps).toEqual([]);
    expect(seen.git).toEqual([]);
    expect(existsSync(baselinePathFor(trackerPath))).toBe(false);
    expect(readStageLedger(stageLedgerPathFor(trackerPath))).toEqual([]);
    expect(lines).toEqual([NO_BASELINE_LINE]);
  });

  it.each([
    ['checks.task', { task: ['affected'] }],
    ['checks.stage', { stage: ['related'] }],
    ['checks.loop', { loop: ['full'] }],
  ] as const)('takes it when %s alone names a check', async (_key, entries: Setup) => {
    const { context, seen } = contextWith(entries);
    const outcome = await ensureBaseline(context);

    expect(seen.runs).toEqual([{ cwd: dir, junitFile: junitFileFor(dir, SESSION, 'baseline') }]);
    expect(seen.steps.map((step) => [step.kind, step.scope])).toEqual([['baseline', 'full']]);
    expect(outcome.baseline?.commit).toBe(HEAD);
    expect(existsSync(baselinePathFor(trackerPath))).toBe(true);
    expect(lines).not.toContain(NO_BASELINE_LINE);
  });
});
