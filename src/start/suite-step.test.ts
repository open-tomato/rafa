/**
 * The suite steps of `start/suite-step.ts`, driven over seams: a scripted
 * `runSuite`, a scripted git, a collected record append, and real
 * tracker, baseline and ledger files under a temporary directory.
 *
 * Nothing here spawns `bun test` or git. The run each step asks for is
 * read off the options handed to the scripted `runSuite`, and every
 * claim that a step did NOT block, run or record is paired with a case
 * where the same step, handed a new failure or a due stage, does. The
 * task step's cases are in `suite-task-step.test.ts`, the stage ledger's
 * own in `suite-stage-ledger.test.ts`.
 */
import type { SuiteStepContext, SuiteStepSeams } from './suite-step.js';
import type { GitResult, GitRunner } from '../pr/index.js';
import type { SuiteBaseline } from '../suite/baseline.js';
import type { SessionStep } from '@open-tomato/rafa/core/loop';
import type { SuiteFailure, SuiteResult, SuiteRunOptions } from '@open-tomato/rafa/suite/run';
import type { GhResult } from '@open-tomato/rafa-board/adapters/tracker/github';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '@open-tomato/rafa/core/output';
import { parsePlan } from '@open-tomato/rafa/core/plan';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';
import { findNextTask } from '@open-tomato/rafa/utils/tracker';

import { baselineOf, baselinePathFor, readBaseline, writeBaseline } from '../suite/baseline.js';

import {
  alwaysRunJunitFileFor,
  blockerText,
  dueStages,
  ensureBaseline,
  isStepInterrupted,
  junitFileFor,
  planOwnsReader,
  readStageLedger,
  runDueStageSteps,
  runPreWrapUpStep,
  runStageStep,
  SIGINT_EXIT_CODE,
  stageLedgerPathFor,
} from './suite-step.js';
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

describe('ensureBaseline', () => {
  it('runs the full suite once, writes the file and records a baseline step with no new failure', async () => {
    const { context, seen } = contextWith([red([KNOWN])]);
    const outcome = await ensureBaseline(context);

    expect(seen.runs).toHaveLength(1);
    expect(seen.runs[0]?.paths).toBeUndefined();
    expect(seen.runs[0]?.changedSince).toBeUndefined();
    expect(seen.runs[0]?.junitFile).toBe(junitFileFor(dir, SESSION, 'baseline'));
    expect(outcome.baseline?.commit).toBe(HEAD);
    expect(outcome.baseline?.failures).toEqual([KNOWN]);
    expect(seen.steps).toEqual([{ ...outcome.step!, kind: 'baseline', scope: 'full', failures: [KNOWN], newFailures: [] }]);
    const stored = readBaseline(baselinePathFor(trackerPath));
    expect(stored.state === 'read' && stored.baseline.recordedAt).toBe('2026-10-01T00:00:00.000Z');
    expect(linesAt('info').some((line) => line.includes(`known: ${KNOWN.file} > ${KNOWN.name}`))).toBe(true);
  });

  it('blocks nothing on a red baseline: the tracker is left as it was', async () => {
    const { context } = contextWith([red([KNOWN, FRESH])]);
    await ensureBaseline(context);
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
  });

  it('reuses a stored baseline, running and recording nothing', async () => {
    writeBaseline(baselinePathFor(trackerPath), baselineWith());
    const { context, seen } = contextWith([]);
    const outcome = await ensureBaseline(context);
    expect(outcome).toEqual({ baseline: baselineWith(), step: null, interrupted: false, halted: false });
    expect(seen.runs).toHaveLength(0);
    expect(seen.steps).toHaveLength(0);
  });

  it('records the baseline again over a file that does not read, and says so', async () => {
    writeFileSync(baselinePathFor(trackerPath), '{ not json', 'utf8');
    const { context, seen } = contextWith([result()]);
    const outcome = await ensureBaseline(context);
    expect(seen.runs).toHaveLength(1);
    expect(outcome.step?.kind).toBe('baseline');
    expect(linesAt('warn').some((line) => line.includes('recording the baseline again'))).toBe(true);
  });

  it('enters every stage already complete in the ledger, so none of them is due', async () => {
    // Control: without the baseline's entry, stage One is due.
    expect(dueStages(TRACKER, [])).toEqual([{ stage: 0, name: 'One' }]);
    const { context } = contextWith([result()]);
    await ensureBaseline(context);
    const ledger = readStageLedger(stageLedgerPathFor(trackerPath));
    expect(ledger).toEqual([{ stage: 0, name: 'One', commit: HEAD, via: 'baseline' }]);
    expect(dueStages(TRACKER, ledger)).toEqual([]);
  });

  it('warns and goes on when the run record cannot be written', async () => {
    const { context } = contextWith([result()], { seams: { appendStep: () => {
      throw new Error('record gone');
    } } });
    const outcome = await ensureBaseline(context);
    expect(outcome.step?.kind).toBe('baseline');
    expect(linesAt('warn').some((line) => line.includes('record gone'))).toBe(true);
  });
});

describe('a step with errors outside any test', () => {
  const thrown = { file: 'src/boom.test.ts', firstLine: 'TypeError: undefined is not an object (evaluating \'x.foo\')' };
  /** A run whose only red is one error outside any test, which the baseline (0 errors) does not hold. */
  const excess = (): SuiteResult => result({ exitCode: 1, errors: 1, unhandled: [thrown] });

  it('retakes a stage step over the same paths', async () => {
    const { context, seen } = contextWith([excess(), result()], { owns: ['src/b', 'src/c'], git: gitAt({ [BASE]: ['src/b/x.ts'] }) });
    const outcome = await runStageStep(context, { stage: 0, name: 'One' }, baselineWith());
    expect(outcome.red).toBe(false);
    expect(seen.runs.map((run) => run.paths)).toEqual([
      ['src/b/b.test.ts', 'src/run-integration.test.ts'],
      ['src/b/b.test.ts', 'src/run-integration.test.ts'],
    ]);
  });
});

describe('a red step\'s repair task', () => {
  const stage = { stage: 0, name: 'One' };

  /** The task lines of `text` that are repair tasks; a blocker quoting one is no line of its own. */
  function repairLines(text: string): readonly string[] {
    return text.split('\n').filter((line) => /^- \[(?: |x|BLOCKED)\] Repair the red /.test(line));
  }

  /** The tracker's lines with line `at` taken out. */
  function without(text: string, at: number): string {
    const all = text.split('\n');
    return [...all.slice(0, at), ...all.slice(at + 1)].join('\n');
  }

  it('is inserted above the first open task by a red stage step, which leaves that task untouched', async () => {
    const { context } = contextWith([red([FRESH])]);
    const outcome = await runStageStep(context, stage, baselineWith());

    expect(outcome).toMatchObject({ red: true, blockedLine: 9 });
    const after = readFileSync(trackerPath, 'utf8');
    expect(after.split('\n')[10]).toBe('- [ ] third task');
    expect(without(after, 9)).toBe(TRACKER);
    expect(repairLines(after)).toHaveLength(1);
    const next = findNextTask(after);
    expect(next?.task).toBe(`Repair the red stage step at commit ${HEAD}  {agent=build-error-resolver}`);
    expect(next?.blocker).toContain('stage step for "One"');
    // The repair names the last task of the stage the step was taken for;
    // a stage step told no stage names nothing (`suite-blocker.test.ts`).
    expect(next?.repairs).toBe('second task');
  });
});

describe('runStageStep', () => {
  const stage = { stage: 0, name: 'One' };

  it('falls back to bun test --changed=<since> without Owns: folders, since the baseline, and enters the stage', async () => {
    const calls: string[] = [];
    const { context, seen } = contextWith([result()], { git: gitAt({ [BASE]: ['src/a.ts'] }, calls) });
    const outcome = await runStageStep(context, stage, baselineWith());
    expect(calls).toContain(`diff --name-only -z --no-renames ${BASE} HEAD`);
    expect(seen.runs).toEqual([{ cwd: dir, junitFile: junitFileFor(dir, SESSION, 'stage'), changedSince: BASE }]);
    expect(outcome.step?.scope).toBe('affected');
    expect(seen.steps).toHaveLength(1);
    expect(readStageLedger(stageLedgerPathFor(trackerPath))).toEqual([{ stage: 0, name: 'One', commit: HEAD, via: 'step' }]);
  });

  it('runs the full suite, with a warning, when git will not answer the stage\'s diff', async () => {
    const { context, seen } = contextWith([result()], { git: gitAt({}) });
    const outcome = await runStageStep(context, stage, baselineWith());
    expect(seen.runs[0]?.paths).toBeUndefined();
    expect(seen.runs[0]?.changedSince).toBeUndefined();
    expect(outcome.step?.scope).toBe('full');
    expect(linesAt('warn').some((line) => line.includes('runs the full suite'))).toBe(true);
  });

  it('runs the touched folder\'s tests and the integration tier, not the other folder\'s', async () => {
    const { context, seen } = contextWith([result()], { owns: ['src/b', 'src/c'], git: gitAt({ [BASE]: ['src/b/x.ts'] }) });
    await runStageStep(context, stage, baselineWith());
    expect(seen.runs[0]?.paths).toEqual(['src/b/b.test.ts', 'src/run-integration.test.ts']);
    expect(seen.steps[0]?.scope).toEqual(['src/b/b.test.ts', 'src/run-integration.test.ts']);
  });

  it('takes the next stage\'s diff from the commit the last stage step was taken at', async () => {
    writeFileSync(stageLedgerPathFor(trackerPath), `${JSON.stringify({ version: 1, stages: [{ stage: 0, name: 'One', commit: 'stage1', via: 'step' }] })}\n`);
    const calls: string[] = [];
    const { context, seen } = contextWith([result()], { git: gitAt({ stage1: ['src/a.ts'] }, calls) });
    await runStageStep(context, { stage: 1, name: 'Two' }, baselineWith());
    expect(calls).toContain('diff --name-only -z --no-renames stage1 HEAD');
    expect(calls).not.toContain(`diff --name-only -z --no-renames ${BASE} HEAD`);
    expect(seen.runs[0]?.changedSince).toBe('stage1');
  });

  it('runs and records nothing for an empty path list, and still enters the stage', async () => {
    const { context, seen } = contextWith([], {
      owns: ['src/b', 'src/c'],
      git: gitAt({ [BASE]: ['docs/x.md'] }),
      seams: { listTestFiles: () => ['src/b/b.test.ts'] },
    });
    const outcome = await runStageStep(context, stage, baselineWith());
    expect(outcome).toEqual({ kind: 'stage', step: null, red: false, interrupted: false, blocker: null, blockedLine: null, repairInserted: false });
    expect(seen.runs).toHaveLength(0);
    expect(seen.steps).toHaveLength(0);
    expect(readStageLedger(stageLedgerPathFor(trackerPath))).toHaveLength(1);
  });

  it('inserts a blocked repair task on a new failure and still enters the stage as taken', async () => {
    const { context } = contextWith([red([FRESH])]);
    const outcome = await runStageStep(context, stage, baselineWith());
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toContain('stage step for "One"');
    expect(findNextTask(readFileSync(trackerPath, 'utf8'))?.blocker).toContain('src/new.test.ts');
    expect(readStageLedger(stageLedgerPathFor(trackerPath))).toHaveLength(1);
  });
});

describe('runStageStep with tests.alwaysRun', () => {
  const stage = { stage: 0, name: 'One' };
  const glob = ['src/**/*.sweep.test.ts'];
  const sweep = 'src/tests/leak.sweep.test.ts';
  const tracked = ['src/a.ts', 'src/a.test.ts', 'src/b/x.ts', 'src/b/b.test.ts', sweep];
  const swept: SuiteFailure = { file: sweep, name: 'leak > names a plan path' };

  it('joins the always-run files to the fallback as a second run, settled as one affected step', async () => {
    const { context, seen } = contextWith([result(), result()], { alwaysRun: glob, git: gitAt({ [BASE]: ['src/a.ts'] }, [], tracked) });
    const outcome = await runStageStep(context, stage, baselineWith());

    expect(seen.runs).toEqual([
      { cwd: dir, junitFile: junitFileFor(dir, SESSION, 'stage'), changedSince: BASE },
      { cwd: dir, junitFile: alwaysRunJunitFileFor(dir, SESSION, 'stage'), paths: [sweep] },
    ]);
    expect(alwaysRunJunitFileFor(dir, SESSION, 'stage')).not.toBe(alwaysRunJunitFileFor(dir, SESSION));
    expect(seen.steps).toHaveLength(1);
    expect(seen.steps[0]?.scope).toBe('affected');
    expect(seen.steps[0]?.command).toContain(FOLDED_COMMAND_JOINER);
    expect(outcome).toMatchObject({ kind: 'stage', red: false, blocker: null });
  });

  it('inserts a blocked repair task on a failure only the fallback\'s always-run run found', async () => {
    const { context, seen } = contextWith([result(), red([swept])], { alwaysRun: glob, git: gitAt({ [BASE]: ['src/a.ts'] }, [], tracked) });
    const outcome = await runStageStep(context, stage, baselineWith());

    expect(outcome.red).toBe(true);
    expect(seen.steps[0]?.newFailures).toEqual([swept]);
    expect(outcome.blocker).toContain(`${sweep} (1 test)`);
    expect(findNextTask(readFileSync(trackerPath, 'utf8'))?.task).toStartWith('Repair the red stage step');
  });

  it('retakes both runs of the fallback when its only red is errors outside any test', async () => {
    const excess = result({ errors: 1 });
    const { context, seen } = contextWith([excess, result(), result(), result()], { alwaysRun: glob, git: gitAt({ [BASE]: ['src/a.ts'] }, [], tracked) });
    const outcome = await runStageStep(context, stage, baselineWith());

    expect(outcome.red).toBe(false);
    expect(seen.runs.map((run) => run.paths ?? run.changedSince)).toEqual([BASE, [sweep], BASE, [sweep]]);
  });

  it('adds no always-run run to a stage narrowed by Owns: folders', async () => {
    const { context, seen } = contextWith([result()], { owns: ['src/b'], alwaysRun: glob, git: gitAt({ [BASE]: ['src/b/x.ts'] }, [], tracked) });
    await runStageStep(context, stage, baselineWith());

    expect(seen.runs).toHaveLength(1);
    expect(seen.runs[0]?.paths).toEqual(['src/b/b.test.ts', 'src/run-integration.test.ts']);
  });
});

describe('runDueStageSteps', () => {
  it('catches up a finished stage whose step never ran, once', async () => {
    const { context, seen } = contextWith([result()]);
    const first = await runDueStageSteps(context, baselineWith());
    expect(first.map((outcome) => outcome.kind)).toEqual(['stage']);
    const again = await runDueStageSteps(context, baselineWith());
    expect(again).toEqual([]);
    expect(seen.runs).toHaveLength(1);
  });

  it('stops after the first red step, leaving a later due stage for the next run', async () => {
    const twoDone = TRACKER.replace('- [ ] third task\n- [ ] fourth task', '- [x] third task\n- [x] fourth task\n\n# Stage: Three\n\n- [ ] fifth task');
    writeFileSync(trackerPath, twoDone, 'utf8');
    // Control: both finished stages are due.
    expect(dueStages(twoDone, [])).toHaveLength(2);
    const { context, seen } = contextWith([red([FRESH]), result()]);
    const outcomes = await runDueStageSteps(context, baselineWith());
    expect(outcomes).toHaveLength(1);
    expect(seen.runs).toHaveLength(1);
  });

  it('reads an unreadable ledger as empty, with a warning, so the step runs again', async () => {
    writeFileSync(stageLedgerPathFor(trackerPath), 'nope', 'utf8');
    const { context, seen } = contextWith([result()]);
    await runDueStageSteps(context, baselineWith());
    expect(seen.runs).toHaveLength(1);
    expect(linesAt('warn').some((line) => line.includes('SUITE_STAGES-fixture.json does not read'))).toBe(true);
  });
});

describe('the recorded step\'s reason', () => {
  const stage = { stage: 0, name: 'One' };

  it('records fallback for a stage step without Owns: folders', async () => {
    const { context, seen } = contextWith([result()]);
    await runStageStep(context, stage, baselineWith());
    expect(seen.steps[0]).toMatchObject({ scope: 'affected', reason: 'fallback' });
  });

  it('records stage for a stage step over its Owns: folders\' test files', async () => {
    const { context, seen } = contextWith([result()], { owns: ['src/b'], git: gitAt({ [BASE]: ['src/b/x.ts'] }) });
    await runStageStep(context, stage, baselineWith());
    expect(seen.steps[0]).toMatchObject({ scope: ['src/b/b.test.ts', 'src/run-integration.test.ts'], reason: 'stage' });
  });

  it('records no reason for a stage step whose diff git will not answer', async () => {
    const { context, seen } = contextWith([result()], { git: gitAt({}) });
    await runStageStep(context, stage, baselineWith());
    expect(seen.steps[0]?.scope).toBe('full');
    expect(Object.keys(seen.steps[0] ?? {})).not.toContain('reason');
  });

  it('records no reason for the baseline, and declared for a pre-wrap-up step over [full]', async () => {
    const { context, seen } = contextWith([result(), result()]);
    await ensureBaseline(context);
    await runPreWrapUpStep(context, baselineWith());
    expect(seen.steps.map((step) => step.kind)).toEqual(['baseline', 'pre-wrap-up']);
    expect(Object.keys(seen.steps[0] ?? {})).not.toContain('reason');
    expect(seen.steps[1]).toMatchObject({ scope: 'full', reason: 'declared' });
  });
});

describe('runPreWrapUpStep', () => {
  /** {@link TRACKER} with every task ticked, and `extra` task lines after the last one. */
  const finished = (extra: readonly string[] = []): string => TRACKER
    .replace('- [ ] third task\n- [ ] fourth task', ['- [x] third task', '- [x] fourth task', ...extra].join('\n'));
  const repairText = `Repair the red pre-wrap-up step at commit ${HEAD}`;

  it('runs the full suite and, green, writes nothing', async () => {
    writeFileSync(trackerPath, finished(), 'utf8');
    const { context, seen } = contextWith([red([KNOWN])]);
    const outcome = await runPreWrapUpStep(context, baselineWith());
    expect(seen.runs[0]?.paths).toBeUndefined();
    expect(seen.runs[0]?.changedSince).toBeUndefined();
    expect(outcome).toMatchObject({ kind: 'pre-wrap-up', red: false, blockedLine: null, repairInserted: false });
    expect(seen.steps[0]?.scope).toBe('full');
    expect(readFileSync(trackerPath, 'utf8')).toBe(finished());
  });

  it('inserts a blocked pre-wrap-up repair after the last task on a red step, after the step is recorded', async () => {
    writeFileSync(trackerPath, finished(), 'utf8');
    const { context, seen } = contextWith([red([FRESH])]);
    const outcome = await runPreWrapUpStep(context, baselineWith());

    expect(outcome).toMatchObject({ kind: 'pre-wrap-up', red: true, blockedLine: 11, repairInserted: true });
    expect(seen.trackerAtAppend[0]).toBe(finished());
    const next = findNextTask(readFileSync(trackerPath, 'utf8'));
    expect(next).toMatchObject({ status: 'blocked', lineNum: 11, task: `${repairText}  {agent=build-error-resolver}` });
    expect(next?.blocker).toBe(outcome.blocker ?? '');
    expect(next?.blocker).toContain('The runner\'s pre-wrap-up step found failures');
    expect(next?.blocker).toContain('bun test ./src/new.test.ts');
    expect(linesAt('error').some((line) => line.includes('A repair task (line 12) is inserted'))).toBe(true);
  });

  it('blocks the ticked pre-wrap-up repair again on a second red, inserting nothing', async () => {
    const repaired = finished([`- [x] ${repairText}  {agent=build-error-resolver}`]);
    writeFileSync(trackerPath, repaired, 'utf8');
    const { context } = contextWith([red([FRESH])]);
    const outcome = await runPreWrapUpStep(context, baselineWith());

    expect(outcome).toMatchObject({ kind: 'pre-wrap-up', red: true, blockedLine: 11, repairInserted: false });
    const content = readFileSync(trackerPath, 'utf8');
    expect(parsePlan(content).tasks).toHaveLength(parsePlan(repaired).tasks.length);
    expect(findNextTask(content)).toMatchObject({ status: 'blocked', lineNum: 11, blocker: outcome.blocker ?? '' });
    expect(linesAt('error').some((line) => line.includes('The repair task (line 12) is marked blocked on it again'))).toBe(true);
  });
});

describe('blockerText', () => {
  it('names each new file once with its count and the command running them', () => {
    const text = blockerText('task step', { exitCode: 1, unhandled: [], outputTail: [] }, { fresh: [FRESH, KNOWN, FRESH_TWO], known: [], newErrors: 0, unreported: false, outsideCase: false });
    expect(text).toContain('src/new.test.ts (2 tests), src/old.test.ts (1 test)');
    expect(text).toContain('Run bun test ./src/new.test.ts ./src/old.test.ts');
    expect(text).not.toContain('\n');
  });
});

describe('planOwnsReader', () => {
  it('reads the folders at most once and reads none without an issue, sending no gh command', async () => {
    let calls = 0;
    const gh = (): Promise<GhResult> => {
      calls += 1;
      return Promise.resolve({ ok: false, stdout: '', stderr: 'no' });
    };
    const withoutIssue = planOwnsReader({ planContent: '# Plan\n', gh });
    expect(await withoutIssue()).toBeNull();
    expect(calls).toBe(0);

    const withIssue = planOwnsReader({ planContent: '```rafa:plan\nissue: "7"\n```\n', gh });
    expect(await withIssue()).toBeNull();
    expect(await withIssue()).toBeNull();
    expect(calls).toBe(1);
    const said = linesAt('info').filter((line) => line.startsWith('🗂'));
    expect(said).toHaveLength(2);
    expect(said.every((line) => line.includes('bun test --changed=<since>'))).toBe(true);
    expect(said.some((line) => line.includes('full suite'))).toBe(false);
  });
});

describe('a step stopped by SIGINT', () => {

  it('reads exit 130 as SIGINT, and neither SIGTERM\'s 143 nor a red exit 1 as it', () => {
    expect(SIGINT_EXIT_CODE).toBe(130);
    expect(isStepInterrupted({}, { exitCode: 130 })).toBe(true);
    expect(isStepInterrupted({}, { exitCode: 143 })).toBe(false);
    expect(isStepInterrupted({}, { exitCode: 1 })).toBe(false);
    expect(isStepInterrupted({ isInterrupted: () => true }, { exitCode: 0 })).toBe(true);
    expect(isStepInterrupted({ isInterrupted: () => false }, { exitCode: 0 })).toBe(false);
  });

  it('writes no baseline and enters no stage in the ledger for an interrupted baseline', async () => {
    const { context, seen } = contextWith([killed()]);
    const outcome = await ensureBaseline(context);

    expect(outcome.interrupted).toBe(true);
    expect(outcome.step).toMatchObject({ kind: 'baseline', interrupted: true });
    expect(seen.steps).toHaveLength(1);
    expect(existsSync(baselinePathFor(trackerPath))).toBe(false);
    expect(existsSync(stageLedgerPathFor(trackerPath))).toBe(false);

    // Control: the same baseline, not interrupted, is written and covers stage One.
    const control = contextWith([result()]);
    expect((await ensureBaseline(control.context)).interrupted).toBe(false);
    expect(existsSync(baselinePathFor(trackerPath))).toBe(true);
    expect(readStageLedger(stageLedgerPathFor(trackerPath))).toHaveLength(1);
  });

  it('leaves an interrupted stage step out of the ledger, so the stage stays due, and blocks nothing', async () => {
    const { context } = contextWith([killed()]);
    const outcome = await runStageStep(context, { stage: 0, name: 'One' }, baselineWith());

    expect(outcome).toMatchObject({ kind: 'stage', red: false, interrupted: true, blockedLine: null });
    expect(readStageLedger(stageLedgerPathFor(trackerPath))).toEqual([]);
    expect(dueStages(readFileSync(trackerPath, 'utf8'), [])).toEqual([{ stage: 0, name: 'One' }]);
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
  });

  it('stops the due stage steps after an interrupted one', async () => {
    const twoDone = TRACKER.replace('- [ ] third task\n- [ ] fourth task', '- [x] third task\n- [x] fourth task\n\n# Stage: Three\n\n- [ ] fifth task');
    writeFileSync(trackerPath, twoDone, 'utf8');
    expect(dueStages(twoDone, [])).toHaveLength(2);
    const { context, seen } = contextWith([killed(), result()]);
    const outcomes = await runDueStageSteps(context, baselineWith());

    expect(outcomes.map((outcome) => outcome.interrupted)).toEqual([true]);
    expect(seen.runs).toHaveLength(1);
  });

  it('answers an interrupted pre-wrap-up step as interrupted and not red', async () => {
    const { context, seen } = contextWith([killed()]);
    const outcome = await runPreWrapUpStep(context, baselineWith());

    expect(outcome).toMatchObject({ kind: 'pre-wrap-up', red: false, interrupted: true, blocker: null });
    expect(seen.steps[0]?.interrupted).toBe(true);
  });
});
