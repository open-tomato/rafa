/**
 * The task step of `start/suite-task-step.ts` reading `checks.task`,
 * driven over seams: a scripted `runSuite` that counts its calls, a
 * scripted git, a collected record append, and a real tracker under a
 * temporary directory.
 *
 * Nothing here spawns `bun test`, git or ESLint. What the step runs is
 * read off the options handed to the scripted `runSuite`; each claim that
 * a step ran nothing is paired with the same step over a non-empty entry,
 * which runs. The cases over a fixed `[affected]` entry are in
 * `suite-task-step.test.ts`.
 */

import type { SuiteStepContext, SuiteStepSeams, TaskStepInput } from './suite-step.js';
import type { CheckName } from '@open-tomato/rafa/config-schema-checks';
import type { SessionStep } from '@open-tomato/rafa/core/loop';
import type { SuiteResult, SuiteRunOptions } from '@open-tomato/rafa/suite/run';
import type { GitResult, GitRunner } from '@open-tomato/rafa-pr/pr/index';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { findNextTask } from '@open-tomato/rafa/utils/tracker';

import { runTaskStep } from './suite-step.js';

const BASE = 'base0000';
const HEAD = 'head1111';

const TRACKER = '# Plan: fixture\n\n# Stage: One\n\n- [x] first task\n- [ ] second task\n';

/** The project's test files, as the `listTestFiles` seam answers them. */
const TEST_FILES: readonly string[] = ['src/a.test.ts', 'src/b/b.test.ts', 'src/c/c.test.ts', 'src/run-integration.test.ts', 'src/x.sweep.test.ts'];

/** The ESLint report of one error, its file filled in by {@link linting}. */
const LINT_RED = { exitCode: 1, stdout: JSON.stringify([{ filePath: 'x', messages: [], errorCount: 1 }]), stderr: '' };

let dir: string;
let trackerPath: string;
let lines: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'suite-task-entry-'));
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

/** A green suite result. */
function green(): SuiteResult {
  return {
    command: ['bun', 'test'],
    exitCode: 0,
    summary: 'Ran 1 tests across 1 files. [1.00ms]',
    failures: [],
    errors: 0,
    junit: 'read',
    unhandled: [],
    outputTail: [],
  };
}

/** A git at {@link HEAD} whose task diff, and the lint step's, from {@link BASE} is `diff`, tracking {@link TEST_FILES}; it records each call. */
function gitOver(diff: readonly string[], calls: string[] = []): GitRunner {
  const listed = (paths: readonly string[]): GitResult => ({ ok: true, stdout: paths.map((path) => `${path}\0`).join(''), stderr: '' });
  const answers: Readonly<Record<string, GitResult>> = {
    'rev-parse --verify HEAD^{commit}': { ok: true, stdout: `${HEAD}\n`, stderr: '' },
    [`diff --name-only -z --no-renames ${BASE} HEAD`]: listed(diff),
    [`diff --name-only -z --no-renames --diff-filter=d ${BASE} HEAD`]: listed(diff),
    'ls-files -z': listed(TEST_FILES),
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
  readonly lints: (readonly string[])[];
  readonly git: string[];
  ownsReads: number;
  testFileReads: number;
}

/** What {@link contextWith} builds a context over. */
interface Setup {
  readonly entry: readonly CheckName[];
  readonly diff?: readonly string[];
  readonly owns?: readonly string[] | null;
  readonly alwaysRun?: readonly string[];
  /** `tests.fullSuiteTriggers`; the `escalation` template's first three when left out. */
  readonly triggers?: readonly string[];
  readonly lint?: { readonly exitCode: number; readonly stdout: string; readonly stderr: string };
}

/** A context whose `checks.task` is `setup.entry`, every run green; it lints only when `setup.lint` answers. */
function contextWith(setup: Setup): { readonly context: SuiteStepContext; readonly seen: Seen } {
  const seen: Seen = { runs: [], steps: [], lints: [], git: [], ownsReads: 0, testFileReads: 0 };
  const lint = setup.lint;
  const seams: SuiteStepSeams = {
    runSuite: (options) => {
      seen.runs.push(options);
      return Promise.resolve(green());
    },
    appendStep: (step) => seen.steps.push(step),
    git: gitOver(setup.diff ?? ['src/b/x.ts'], seen.git),
    listTestFiles: () => {
      seen.testFileReads += 1;
      return TEST_FILES;
    },
    readPreloadFiles: () => ({ state: 'read', files: [] }),
    now: () => new Date('2026-10-01T00:00:00Z'),
    ...(lint === undefined
      ? {}
      : {
        runLint: (options) => {
          seen.lints.push(options.argv);
          return Promise.resolve({ ...lint, stdout: lint.stdout.replace('"x"', JSON.stringify(join(dir, 'src/b/x.ts'))) });
        },
      }),
  };
  if (lint !== undefined) writeFileSync(join(dir, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
  const context: SuiteStepContext = {
    repoRoot: dir,
    checkout: dir,
    trackerPath,
    sessionId: 'session-1',
    settings: {
      testsFullSuiteTriggers: setup.triggers ?? ['bunfig.toml', 'tsconfig*.json', 'package.json'],
      testsIntegration: ['**/*-integration.test.ts'],
      testsContract: [],
      testsAlwaysRun: setup.alwaysRun ?? [],
      testsRetakeRedAlone: false,
      checksTask: setup.entry,
      checksStage: [],
      checksLoop: [],
    },
    owns: () => {
      seen.ownsReads += 1;
      return Promise.resolve(setup.owns ?? null);
    },
    seams,
  };
  return { context, seen };
}

/** The input of a task whose line declares `declared`, or none. */
function inputOf(declared: TaskStepInput['declared'] = null): TaskStepInput {
  return { baseline: null, base: BASE, declared, task: 'second task' };
}

/** The line an empty `checks.task` prints. */
const NO_CHECK_LINE = '🧪 task step: no check configured (checks.task is empty); nothing ran.';

describe('runTaskStep over an empty checks.task', () => {
  it('spawns nothing, reads no diff, and records a none step with reason no-check', async () => {
    const { context, seen } = contextWith({ entry: [] });
    const outcome = await runTaskStep(context, inputOf());

    expect(seen.runs).toEqual([]);
    expect(seen.git.filter((call) => call === `diff --name-only -z --no-renames ${BASE} HEAD`)).toEqual([]);
    const none: SessionStep = { kind: 'task', scope: 'none', reason: 'no-check', command: [], exitCode: 0, summary: null, failures: [], newFailures: [] };
    expect(seen.steps).toEqual([none]);
    expect(outcome).toMatchObject({ kind: 'task', step: none, red: false, interrupted: false, blocker: null });
    expect(lines).toContain(NO_CHECK_LINE);
    expect(lines.some((line) => line.includes('passed'))).toBe(false);
  });

  it('runs one suite for the same task under [affected], the control that the step could have run', async () => {
    const { context, seen } = contextWith({ entry: ['affected'] });
    await runTaskStep(context, inputOf());
    expect(seen.runs).toHaveLength(1);
    expect(seen.steps.map((step) => step.scope)).toEqual(['affected']);
    expect(lines).not.toContain(NO_CHECK_LINE);
  });

  it('names the tests= value it set aside, on the line and under declared', async () => {
    const { context, seen } = contextWith({ entry: [] });
    await runTaskStep(context, inputOf('full'));

    expect(seen.runs).toEqual([]);
    expect(seen.steps[0]).toMatchObject({ scope: 'none', reason: 'no-check', declared: 'full' });
    expect(Object.keys(seen.steps[0] ?? {}).slice(0, 5)).toEqual(['kind', 'scope', 'reason', 'declared', 'command']);
    expect(lines).toContain(`${NO_CHECK_LINE} (tests=full set aside)`);
  });

  it('still lints the task\'s diff after the none step, staying green on a green lint', async () => {
    const { context, seen } = contextWith({ entry: [], lint: { exitCode: 0, stdout: '[]', stderr: '' } });
    const outcome = await runTaskStep(context, inputOf());

    expect(seen.lints).toEqual([['bunx', 'eslint', '--no-warn-ignored', '--format', 'json', 'src/b/x.ts']]);
    expect(outcome.red).toBe(false);
    // The none step is printed before the lint and type steps run.
    expect(lines.indexOf(NO_CHECK_LINE)).toBe(0);
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
  });

  it('is red on a red lint after the none step, inserting a repair task blocked on the lint\'s text alone', async () => {
    const { context, seen } = contextWith({ entry: [], lint: LINT_RED });
    const outcome = await runTaskStep(context, inputOf());

    expect(seen.runs).toEqual([]);
    expect(seen.steps.map((step) => step.scope)).toEqual(['none']);
    expect(outcome).toMatchObject({ red: true, interrupted: false, repairInserted: true, step: seen.steps[0] });
    expect(outcome.blocker?.startsWith('The runner\'s lint step after "second task" found ESLint errors')).toBe(true);
    const next = findNextTask(readFileSync(trackerPath, 'utf8'));
    expect(next?.status).toBe('blocked');
    expect(next?.blocker).toBe(outcome.blocker ?? '');
  });

  it('reads a SIGINT the runner received as a stop, recording the none step once', async () => {
    const { context, seen } = contextWith({ entry: [], lint: LINT_RED });
    const outcome = await runTaskStep({ ...context, isInterrupted: () => true }, inputOf());

    expect(outcome).toMatchObject({ red: false, interrupted: true, blocker: null });
    expect(seen.steps).toHaveLength(1);
    expect(seen.lints).toEqual([]);
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
  });
});

describe('runTaskStep resolving checks.task', () => {
  it('runs bun test --changed=<base> for [affected], reason declared', async () => {
    const { context, seen } = contextWith({ entry: ['affected'] });
    await runTaskStep(context, inputOf());

    expect(seen.runs).toHaveLength(1);
    expect(seen.runs[0]?.changedSince).toBe(BASE);
    expect(seen.runs[0]?.paths).toBeUndefined();
    expect(seen.steps[0]).toMatchObject({ scope: 'affected', reason: 'declared' });
    expect(seen.ownsReads).toBe(0);
    expect(seen.testFileReads).toBe(0);
  });

  it('runs the full suite for [affected] under a bunfig.toml diff, reason trigger', async () => {
    const { context, seen } = contextWith({ entry: ['affected'], diff: ['bunfig.toml', 'src/b/x.ts'] });
    await runTaskStep(context, inputOf());

    expect(seen.runs).toHaveLength(1);
    expect(seen.runs[0]?.changedSince).toBeUndefined();
    expect(seen.runs[0]?.paths).toBeUndefined();
    expect(seen.steps[0]).toMatchObject({ scope: 'full', reason: 'trigger' });
  });

  it('runs --changed for the same diff when no trigger names bunfig.toml, the control that the trigger widened it', async () => {
    const { context, seen } = contextWith({ entry: ['affected'], diff: ['bunfig.toml', 'src/b/x.ts'], triggers: [] });
    await runTaskStep(context, inputOf());
    expect(seen.runs[0]?.changedSince).toBe(BASE);
    expect(seen.steps[0]).toMatchObject({ scope: 'affected', reason: 'declared' });
  });

  it('runs --changed for [related] without Owns: folders, reason fallback', async () => {
    const { context, seen } = contextWith({ entry: ['related'], owns: null });
    await runTaskStep(context, inputOf());

    expect(seen.ownsReads).toBe(1);
    expect(seen.runs).toHaveLength(1);
    expect(seen.runs[0]?.changedSince).toBe(BASE);
    expect(seen.steps[0]).toMatchObject({ scope: 'affected', reason: 'fallback' });
  });

  it('runs the touched folders\' files for [related] with Owns: folders, the path list recorded', async () => {
    const { context, seen } = contextWith({ entry: ['related'], owns: ['src/b', 'src/c'] });
    await runTaskStep(context, inputOf());

    expect(seen.runs[0]?.paths).toEqual(['src/b/b.test.ts']);
    expect(seen.runs[0]?.changedSince).toBeUndefined();
    expect(seen.steps[0]).toMatchObject({ scope: ['src/b/b.test.ts'], reason: 'declared' });
  });

  it('runs the touched folders\' files for a tests=module line over [affected], recorded as module', async () => {
    const { context, seen } = contextWith({ entry: ['affected'], owns: ['src/b', 'src/c'] });
    await runTaskStep(context, inputOf('module'));

    expect(seen.runs).toHaveLength(1);
    expect(seen.runs[0]?.paths).toEqual(['src/b/b.test.ts']);
    expect(seen.runs[0]?.changedSince).toBeUndefined();
    expect(seen.steps[0]).toMatchObject({ scope: 'module', reason: 'declared' });
  });

  it('runs --changed for the same diff under a tests=affected line, the control that tests=module narrowed it', async () => {
    const { context, seen } = contextWith({ entry: ['affected'], owns: ['src/b', 'src/c'] });
    await runTaskStep(context, inputOf('affected'));
    expect(seen.runs[0]?.changedSince).toBe(BASE);
    expect(seen.ownsReads).toBe(0);
  });
});

describe('runTaskStep joining the tests.alwaysRun files to a path list', () => {
  const alwaysRun = ['src/**/*.sweep.test.ts'];

  it('joins them in the one path run when related is in play', async () => {
    const { context, seen } = contextWith({ entry: ['related'], owns: ['src/b'], alwaysRun });
    await runTaskStep(context, inputOf());
    expect(seen.runs).toHaveLength(1);
    expect(seen.runs[0]?.paths).toEqual(['src/b/b.test.ts', 'src/x.sweep.test.ts']);
  });

  it('joins them in the one path run when affected stands beside a path check, taking no --changed run', async () => {
    const { context, seen } = contextWith({ entry: ['affected', 'integration'], alwaysRun });
    await runTaskStep(context, inputOf());
    expect(seen.runs).toHaveLength(1);
    expect(seen.runs[0]?.paths).toEqual(['src/run-integration.test.ts', 'src/x.sweep.test.ts']);
  });

  it('joins none for [integration] alone, against the entry above', async () => {
    const { context, seen } = contextWith({ entry: ['integration'], alwaysRun });
    await runTaskStep(context, inputOf());
    expect(seen.runs[0]?.paths).toEqual(['src/run-integration.test.ts']);
  });

  it('records reason unit for a path list the entry\'s unit check chose', async () => {
    const { context, seen } = contextWith({ entry: ['unit'] });
    await runTaskStep(context, inputOf());
    expect(seen.runs[0]?.paths).toEqual(['src/a.test.ts', 'src/b/b.test.ts', 'src/c/c.test.ts', 'src/x.sweep.test.ts']);
    expect(seen.steps[0]?.reason).toBe('unit');
  });

  it('runs nothing and records no step for a path list that comes out empty, saying so', async () => {
    const { context, seen } = contextWith({ entry: ['related'], owns: ['src/c'] });
    const outcome = await runTaskStep(context, inputOf());

    expect(seen.runs).toEqual([]);
    expect(seen.steps).toEqual([]);
    expect(outcome).toMatchObject({ step: null, red: false, interrupted: false });
    expect(lines).toContain('🧪 task step after "second task": no test file in the paths checks.task names; nothing to run.');
  });
});
