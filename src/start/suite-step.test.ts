/**
 * The suite steps of `start/suite-step.ts`, driven over seams: a scripted
 * `runSuite`, a scripted git, a collected record append, and real
 * tracker, baseline and ledger files under a temporary directory.
 *
 * Nothing here spawns `bun test` or git. The run each step asks for is
 * read off the options handed to the scripted `runSuite`, and every
 * claim that a step did NOT block, run or record is paired with a case
 * where the same step, handed a new failure or a due stage, does.
 */
import type { SuiteStepContext, SuiteStepSeams } from './suite-step.js';
import type { GhResult } from '../adapters/tracker/github.js';
import type { SessionStep } from '../loop/sessions.js';
import type { GitResult, GitRunner } from '../pr/index.js';
import type { SuiteBaseline } from '../suite/baseline.js';
import type { SuiteFailure, SuiteResult, SuiteRunOptions } from '../suite/run.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { parsePlan } from '../plan/parse.js';
import { baselineOf, baselinePathFor, readBaseline, writeBaseline } from '../suite/baseline.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { findNextTask } from '../utils/tracker.js';

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
  runTaskStep,
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

describe('ensureBaseline', () => {
  it('runs the full suite once, writes the file and records a baseline step with no new failure', async () => {
    const { context, seen } = contextWith([red([KNOWN])]);
    const outcome = await ensureBaseline(context);

    expect(seen.runs).toHaveLength(1);
    expect(seen.runs[0]?.paths).toBeUndefined();
    expect(seen.runs[0]?.changedSince).toBeUndefined();
    expect(seen.runs[0]?.junitFile).toBe(junitFileFor(dir, SESSION, 'baseline'));
    expect(outcome.baseline.commit).toBe(HEAD);
    expect(outcome.baseline.failures).toEqual([KNOWN]);
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
    expect(outcome).toEqual({ baseline: baselineWith(), step: null, interrupted: false });
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
    expect(next?.blocker).toContain('bun test src/new.test.ts');
    expect(next?.blocker).not.toContain(KNOWN.file);
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

  it('is red on more errors outside any test than the baseline counted, and not on as many', async () => {
    const atBaseline = contextWith([result({ exitCode: 1, errors: 1 })]);
    const same = await runTaskStep(atBaseline.context, { ...input, baseline: { ...baselineWith(), errors: 1 } });
    expect(same.red).toBe(false);

    const more = contextWith([result({ exitCode: 1, errors: 2 })]);
    const outcome = await runTaskStep(more.context, { ...input, baseline: { ...baselineWith(), errors: 1 } });
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toContain('1 more error(s) outside any test');
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

describe('a red step\'s repair task', () => {
  const input = { baseline: baselineWith(), base: BASE, declared: 'affected' as const, task: 'second task' };
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

  it('is inserted above the first open task by a red task step, naming the commit, declared for the repair agent', async () => {
    const { context } = contextWith([red([FRESH])]);
    const outcome = await runTaskStep(context, input);

    expect(outcome.blockedLine).toBe(9);
    const after = readFileSync(trackerPath, 'utf8');
    expect(without(after, 9)).toBe(TRACKER);
    const next = findNextTask(after);
    expect(next).toMatchObject({ lineNum: 9, status: 'blocked', task: `Repair the red task step at commit ${HEAD}  {agent=build-error-resolver}` });
    expect(next?.blocker).toBe(outcome.blocker ?? '');
    expect(parsePlan(after).tasks.find((task) => task.lineNum === 9)).toMatchObject({ stage: 1, declaration: { agent: 'build-error-resolver' } });
  });

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
    expect(outcome.blocker).toContain('bun test src/new.test.ts');
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

describe('dueStages', () => {
  it('answers a finished stage while a task is open, and nothing once the ledger names it', () => {
    expect(dueStages(TRACKER, [])).toEqual([{ stage: 0, name: 'One' }]);
    expect(dueStages(TRACKER, [{ stage: 0, name: 'One', commit: HEAD, via: 'step' }])).toEqual([]);
  });

  it('does not answer a stage holding a blocked task', () => {
    expect(dueStages(TRACKER.replace('- [x] second task', '- [BLOCKED] second task'), [])).toEqual([]);
  });

  it('answers no stage once no task is open: the pre-wrap-up step stands in for the last one', () => {
    expect(dueStages(TRACKER.replaceAll('- [ ]', '- [x]'), [])).toEqual([]);
  });

  it('takes an entry for a moved or renamed stage as another stage', () => {
    expect(dueStages(TRACKER, [{ stage: 0, name: 'Renamed', commit: HEAD, via: 'step' }])).toHaveLength(1);
  });
});

describe('runStageStep', () => {
  const stage = { stage: 0, name: 'One' };

  it('runs the full suite without Owns: folders, over the diff since the baseline, and enters the stage', async () => {
    const calls: string[] = [];
    const { context, seen } = contextWith([result()], { git: gitAt({ [BASE]: ['src/a.ts'] }, calls) });
    const outcome = await runStageStep(context, stage, baselineWith());
    expect(calls).toContain(`diff --name-only -z --no-renames ${BASE} HEAD`);
    expect(seen.runs[0]?.paths).toBeUndefined();
    expect(outcome.step?.scope).toBe('full');
    expect(readStageLedger(stageLedgerPathFor(trackerPath))).toEqual([{ stage: 0, name: 'One', commit: HEAD, via: 'step' }]);
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
    const { context } = contextWith([result()], { git: gitAt({ stage1: ['src/a.ts'] }, calls) });
    await runStageStep(context, { stage: 1, name: 'Two' }, baselineWith());
    expect(calls).toContain('diff --name-only -z --no-renames stage1 HEAD');
    expect(calls).not.toContain(`diff --name-only -z --no-renames ${BASE} HEAD`);
  });

  it('runs and records nothing for an empty path list, and still enters the stage', async () => {
    const { context, seen } = contextWith([], {
      owns: ['src/b', 'src/c'],
      git: gitAt({ [BASE]: ['docs/x.md'] }),
      seams: { listTestFiles: () => ['src/b/b.test.ts'] },
    });
    const outcome = await runStageStep(context, stage, baselineWith());
    expect(outcome).toEqual({ kind: 'stage', step: null, red: false, interrupted: false, blocker: null, blockedLine: null });
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

describe('runPreWrapUpStep', () => {
  it('runs the full suite and, red, writes no blocker', async () => {
    const { context, seen } = contextWith([red([FRESH])]);
    const outcome = await runPreWrapUpStep(context, baselineWith());
    expect(seen.runs[0]?.paths).toBeUndefined();
    expect(seen.runs[0]?.changedSince).toBeUndefined();
    expect(outcome).toMatchObject({ kind: 'pre-wrap-up', red: true, blockedLine: null });
    expect(seen.steps[0]?.scope).toBe('full');
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
  });
});

describe('blockerText', () => {
  it('names each new file once with its count and the command running them', () => {
    const text = blockerText('task step', { exitCode: 1 }, { fresh: [FRESH, KNOWN, FRESH_TWO], known: [], newErrors: 0, unreported: false });
    expect(text).toContain('src/new.test.ts (2 tests), src/old.test.ts (1 test)');
    expect(text).toContain('Run bun test src/new.test.ts src/old.test.ts');
    expect(text).not.toContain('\n');
  });
});

describe('stageLedgerPathFor', () => {
  it('sits beside the tracker, named from its stub', () => {
    expect(stageLedgerPathFor('/p/PLAN_TRACKER-foo.md')).toBe('/p/SUITE_STAGES-foo.json');
    expect(stageLedgerPathFor('/p/PLAN.md')).toBe('/p/SUITE_STAGES.json');
    expect(existsSync(stageLedgerPathFor(trackerPath))).toBe(false);
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
    expect(linesAt('info').filter((line) => line.startsWith('🗂'))).toHaveLength(2);
  });
});

describe('a step stopped by SIGINT', () => {
  const input = { baseline: baselineWith(), base: BASE, declared: 'affected' as const, task: 'second task' };

  it('reads exit 130 as SIGINT, and neither SIGTERM\'s 143 nor a red exit 1 as it', () => {
    expect(SIGINT_EXIT_CODE).toBe(130);
    expect(isStepInterrupted({}, { exitCode: 130 })).toBe(true);
    expect(isStepInterrupted({}, { exitCode: 143 })).toBe(false);
    expect(isStepInterrupted({}, { exitCode: 1 })).toBe(false);
    expect(isStepInterrupted({ isInterrupted: () => true }, { exitCode: 0 })).toBe(true);
    expect(isStepInterrupted({ isInterrupted: () => false }, { exitCode: 0 })).toBe(false);
  });

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
