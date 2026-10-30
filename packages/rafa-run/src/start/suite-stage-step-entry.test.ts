/**
 * The stage step of `start/suite-stage-step.ts` reading `checks.stage`,
 * driven over seams: a scripted `runSuite` that counts its calls, a
 * scripted git, a collected record append, and a real tracker and stage
 * ledger under a temporary directory.
 *
 * Nothing here spawns `bun test` or git. What the step runs is read off
 * the options handed to the scripted `runSuite`; the claim that an empty
 * entry runs and blocks nothing is paired with the same stage over a
 * non-empty entry, which runs the same failing suite and blocks. The
 * cases over the fixed `[related, integration]` entry are in
 * `suite-step.test.ts`.
 */

import type { SuiteStepContext } from './suite-step.js';
import type { SuiteBaseline } from '../suite/baseline.js';
import type { CheckName } from '@open-tomato/rafa/config-schema-checks';
import type { SessionStep } from '@open-tomato/rafa/core/loop';
import type { SuiteFailure, SuiteResult, SuiteRunOptions } from '@open-tomato/rafa/suite/run';
import type { GitResult, GitRunner } from '@open-tomato/rafa-pr/pr/index';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { findNextTask } from '@open-tomato/rafa/utils/tracker';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { baselineOf } from '../suite/baseline.js';

import { junitFileFor, readStageLedger, runStageStep, stageLedgerPathFor } from './suite-step.js';

const BASE = 'base0000';
const HEAD = 'head1111';

const TRACKER = '# Plan: fixture\n\n# Stage: One\n\n- [x] first task\n\n# Stage: Two\n\n- [ ] second task\n';

/** The stage whose step every case takes. */
const STAGE = { stage: 0, name: 'One' };

/** The project's test files, as the `listTestFiles` seam answers them; `src/b/b-integration.test.ts` is both under `src/b` and an integration file. */
const TEST_FILES: readonly string[] = [
  'src/a.test.ts',
  'src/b/b-integration.test.ts',
  'src/b/b.test.ts',
  'src/c/c.test.ts',
  'src/run-integration.test.ts',
];

/** The failure the fixture suite reports, which the baseline does not hold. */
const FRESH: SuiteFailure = { file: 'src/b/b.test.ts', name: 'b > broke' };

/** The line an empty `checks.stage` prints. */
const NO_CHECK_LINE = '🧪 stage step for "One": no check configured (checks.stage is empty); nothing ran.';

let dir: string;
let trackerPath: string;
let lines: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'suite-stage-entry-'));
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

/** A green baseline recorded at {@link BASE}, the commit the stage's diff is taken from. */
function baseline(): SuiteBaseline {
  return baselineOf(suiteResult(false), new Date('2026-09-30T00:00:00Z'), BASE);
}

/** A git at {@link HEAD} whose diff from {@link BASE} is `diff`, tracking {@link TEST_FILES}; it records each call. */
function gitOver(diff: readonly string[], calls: string[]): GitRunner {
  const listed = (paths: readonly string[]): GitResult => ({ ok: true, stdout: paths.map((path) => `${path}\0`).join(''), stderr: '' });
  const answers: Readonly<Record<string, GitResult>> = {
    'rev-parse --verify HEAD^{commit}': { ok: true, stdout: `${HEAD}\n`, stderr: '' },
    [`diff --name-only -z --no-renames ${BASE} HEAD`]: listed(diff),
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
  readonly git: string[];
  ownsReads: number;
}

/** What {@link contextWith} builds a context over. */
interface Setup {
  readonly entry: readonly CheckName[];
  readonly diff?: readonly string[];
  readonly owns?: readonly string[] | null;
  /** True when every run reports {@link FRESH}. */
  readonly failing?: boolean;
}

/** A context whose `checks.stage` is `setup.entry`, the `escalation` template's globs set. */
function contextWith(setup: Setup): { readonly context: SuiteStepContext; readonly seen: Seen } {
  const seen: Seen = { runs: [], steps: [], git: [], ownsReads: 0 };
  const context: SuiteStepContext = {
    repoRoot: dir,
    checkout: dir,
    trackerPath,
    sessionId: 'session-1',
    settings: {
      testsFullSuiteTriggers: ['bunfig.toml', 'tsconfig*.json', 'package.json'],
      testsIntegration: ['**/*-integration.test.ts'],
      testsContract: [],
      testsAlwaysRun: [],
      testsRetakeRedAlone: false,
      checksTask: [],
      checksStage: setup.entry,
      checksLoop: [],
    },
    owns: () => {
      seen.ownsReads += 1;
      return Promise.resolve(setup.owns === undefined
        ? ['src/b', 'src/c']
        : setup.owns);
    },
    seams: {
      runSuite: (options) => {
        seen.runs.push(options);
        return Promise.resolve(suiteResult(setup.failing === true));
      },
      appendStep: (step) => seen.steps.push(step),
      git: gitOver(setup.diff ?? ['src/b/x.ts'], seen.git),
      listTestFiles: () => TEST_FILES,
      readPreloadFiles: () => ({ state: 'read', files: [] }),
      now: () => new Date('2026-10-01T00:00:00Z'),
    },
  };
  return { context, seen };
}

describe('runStageStep over an empty checks.stage', () => {
  it('runs nothing under a failing fixture suite, blocks nothing, and records a none step with reason no-check', async () => {
    const { context, seen } = contextWith({ entry: [], failing: true });
    const outcome = await runStageStep(context, STAGE, baseline());

    expect(seen.runs).toEqual([]);
    expect(seen.git).not.toContain(`diff --name-only -z --no-renames ${BASE} HEAD`);
    const none: SessionStep = { kind: 'stage', scope: 'none', reason: 'no-check', command: [], exitCode: 0, summary: null, failures: [], newFailures: [] };
    expect(seen.steps).toEqual([none]);
    expect(outcome).toEqual({ kind: 'stage', step: none, red: false, interrupted: false, blocker: null, blockedLine: null, repairInserted: false });
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
    expect(lines).toContain(NO_CHECK_LINE);
    expect(lines.some((line) => line.includes('passed'))).toBe(false);
  });

  it('enters the stage in the ledger, so the step is not due again', async () => {
    const { context } = contextWith({ entry: [] });
    await runStageStep(context, STAGE, baseline());
    expect(readStageLedger(stageLedgerPathFor(trackerPath))).toEqual([{ stage: 0, name: 'One', commit: HEAD, via: 'step' }]);
  });

  it('runs the same failing suite under [related, integration] and inserts a [BLOCKED] repair, the control that the step could have blocked', async () => {
    const { context, seen } = contextWith({ entry: ['related', 'integration'], failing: true });
    const outcome = await runStageStep(context, STAGE, baseline());

    expect(seen.runs).toHaveLength(1);
    expect(outcome).toMatchObject({ red: true, repairInserted: true });
    expect(findNextTask(readFileSync(trackerPath, 'utf8'))?.status).toBe('blocked');
    expect(lines).not.toContain(NO_CHECK_LINE);
  });
});

describe('runStageStep over a non-empty checks.stage', () => {
  it('runs the touched folders\' files alone under [related], no integration file among them', async () => {
    const { context, seen } = contextWith({ entry: ['related'] });
    await runStageStep(context, STAGE, baseline());

    expect(seen.runs.map((run) => run.paths)).toEqual([['src/b/b-integration.test.ts', 'src/b/b.test.ts']]);
    expect(seen.steps[0]).toMatchObject({ scope: ['src/b/b-integration.test.ts', 'src/b/b.test.ts'], reason: 'stage' });
  });

  it('runs both lists under [related, integration] in one run, a file in both listed once', async () => {
    const { context, seen } = contextWith({ entry: ['related', 'integration'] });
    await runStageStep(context, STAGE, baseline());

    expect(seen.runs).toHaveLength(1);
    expect(seen.runs[0]?.paths).toEqual(['src/b/b-integration.test.ts', 'src/b/b.test.ts', 'src/run-integration.test.ts']);
  });

  it('runs one path-less command under [full], reason declared', async () => {
    const { context, seen } = contextWith({ entry: ['full'] });
    await runStageStep(context, STAGE, baseline());

    expect(seen.runs).toEqual([{ cwd: dir, junitFile: junitFileFor(dir, 'session-1', 'stage') }]);
    expect(seen.ownsReads).toBe(0);
    expect(seen.steps[0]).toMatchObject({ scope: 'full', reason: 'declared' });
  });

  it('runs --changed from the stage\'s base under [affected], reason declared, and the full suite with reason trigger under a bunfig.toml diff', async () => {
    const affected = contextWith({ entry: ['affected'] });
    await runStageStep(affected.context, STAGE, baseline());
    expect(affected.seen.runs.map((run) => run.changedSince)).toEqual([BASE]);
    expect(affected.seen.steps[0]).toMatchObject({ scope: 'affected', reason: 'declared' });

    rmSync(stageLedgerPathFor(trackerPath), { force: true });
    const triggered = contextWith({ entry: ['affected'], diff: ['bunfig.toml'] });
    await runStageStep(triggered.context, STAGE, baseline());
    expect(triggered.seen.runs[0]?.changedSince).toBeUndefined();
    expect(triggered.seen.runs[0]?.paths).toBeUndefined();
    expect(triggered.seen.steps[0]).toMatchObject({ scope: 'full', reason: 'trigger' });
  });

  it('prints the nothing-to-run line and records no step for a path list empty of files', async () => {
    const { context, seen } = contextWith({ entry: ['related'], diff: ['docs/x.md'] });
    const outcome = await runStageStep(context, STAGE, baseline());

    expect(seen.runs).toEqual([]);
    expect(seen.steps).toEqual([]);
    expect(outcome.step).toBeNull();
    expect(lines).toContain('🧪 stage step for "One": no test file under the Owns: folders it changed and no integration file; nothing to run.');
  });
});
