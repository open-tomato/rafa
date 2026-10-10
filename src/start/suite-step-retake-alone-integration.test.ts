/**
 * A stage step driven over a real `bun test`, proving the retake of a
 * newly red file alone (`./suite-retake-alone.ts`) end to end: the spawn,
 * Bun's JUnit file and stderr, the reading, the recorded step and the
 * tracker.
 *
 * The scratch project holds two test files under `leak/`, the one
 * folder the plan owns. `a-sets.test.ts` sets a value on `globalThis`.
 * `b-reads.test.ts` throws when that value is set. Bun runs the files of
 * one selection in one process, in the order the path arguments name
 * them (`../suite/run.ts`, "The order the files ran in"), and a stage
 * step's paths are sorted, so `a-sets` runs first and `b-reads` is red in
 * the step and green alone: the shape issue 926 measured on
 * `src/utils/claude.test.ts`.
 *
 * Three cases share that project:
 *
 *   - the retake on: the step reads green, records `b-reads` under
 *     `stepOnly` with `a-sets` before it, and inserts no repair task;
 *   - the retake off (`tests.retakeRedAlone: false`), the control that
 *     the first case's green is the retake's doing: the same step is
 *     red, and inserts a repair task for `b-reads`;
 *   - `b-reads` broken on its own, the control that a retake can read
 *     red: the step is red, its repair task says the file was red again
 *     when run alone, and quotes the error Bun printed.
 *
 * Git is scripted (HEAD, and the stage's diff naming a file under
 * `leak/`), the record append is collected, and everything else is the
 * step's own: `runSuite`'s real spawner, the real test-file walk, a real
 * tracker file.
 */
import type { StepOutcome, SuiteStepContext } from './suite-step.js';
import type { SessionStep } from '../loop/sessions.js';
import type { GitResult, GitRunner } from '../pr/index.js';
import type { SuiteBaseline } from '../suite/baseline.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { parsePlan } from '../plan/parse.js';
import { baselineOf } from '../suite/baseline.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { findNextTask } from '../utils/tracker.js';

import { runStageStep } from './suite-step.js';

/** How long one case may take: up to three real `bun test` runs. */
const CASE_TIMEOUT_MS = 60_000;

const BASE = 'base0000';
const HEAD = 'head1111';
const SESSION = 'retake-alone-integration';

/** The file that leaves state behind. */
const SETS = 'leak/a-sets.test.ts';

/** The file that fails on the state {@link SETS} left. */
const READS = 'leak/b-reads.test.ts';

/** The full name of {@link READS}'s one case. */
const READS_CASE = 'reads > runs on a clean process';

/** One finished stage, and an open task for a repair to sit above. */
const TRACKER = [
  '# Plan: retake-alone',
  '',
  '# Stage: Leak',
  '',
  '- [x] first task',
  '',
  '# Stage: Next',
  '',
  '- [ ] second task',
  '',
].join('\n');

const SETS_SOURCE = [
  'import { expect, test } from \'bun:test\';',
  '',
  'test(\'sets a value another file reads\', () => {',
  '  (globalThis as { rafaRetakeLeak?: boolean }).rafaRetakeLeak = true;',
  '  expect(true).toBe(true);',
  '});',
  '',
].join('\n');

/** {@link READS}'s source: throws on the leaked value, or on every run when `broken`. */
function readsSource(broken: boolean): string {
  const guard = broken
    ? '    throw new Error(\'broken on its own\');'
    : '    if ((globalThis as { rafaRetakeLeak?: boolean }).rafaRetakeLeak === true) throw new Error(\'leaked state: another test file set the value\');';
  return [
    'import { describe, expect, test } from \'bun:test\';',
    '',
    'describe(\'reads\', () => {',
    '  test(\'runs on a clean process\', () => {',
    guard,
    '    expect(true).toBe(true);',
    '  });',
    '});',
    '',
  ].join('\n');
}

const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-suite-step-retake-alone-')));
afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

let lines: { level: string; message: string }[];

beforeEach(() => {
  lines = [];
  setActiveOutput(sinkOutput({
    info: (message) => lines.push({ level: 'info', message }),
    warn: (message) => lines.push({ level: 'warn', message }),
    error: (message) => lines.push({ level: 'error', message }),
  }));
});

afterEach(() => {
  setActiveOutput(null);
});

/** A baseline that holds no failure, recorded at {@link BASE}: every failure a step reads is new. */
const GREEN_BASELINE: SuiteBaseline = baselineOf(
  { command: ['bun', 'test'], exitCode: 0, summary: 'Ran 2 tests across 2 files. [1.00ms]', failures: [], errors: 0, junit: 'read', unhandled: [] },
  new Date('2026-10-10T00:00:00Z'),
  BASE,
);

/** A scripted git: HEAD, and a stage diff from {@link BASE} naming one file under `leak/`. */
const git: GitRunner = (args) => {
  const answers: Record<string, GitResult> = {
    'rev-parse --verify HEAD^{commit}': { ok: true, stdout: `${HEAD}\n`, stderr: '' },
    [`diff --name-only -z --no-renames ${BASE} HEAD`]: { ok: true, stdout: 'leak/value.ts\0', stderr: '' },
  };
  return answers[args.join(' ')] ?? { ok: false, stdout: '', stderr: `unscripted: ${args.join(' ')}` };
};

/** What one case ran and left. */
interface Driven {
  readonly repo: string;
  readonly trackerPath: string;
  readonly outcome: StepOutcome;
  readonly steps: readonly SessionStep[];
}

let scratches = 0;

/** Plants the scratch project and runs the stage step of `Leak` over it. */
async function drive(options: { readonly retake: boolean; readonly broken: boolean }): Promise<Driven> {
  scratches += 1;
  const repo = join(tempRoot, `scratch-${scratches}`);
  mkdirSync(join(repo, 'leak'), { recursive: true });
  mkdirSync(join(repo, '.rafa', 'plans'), { recursive: true });
  writeFileSync(join(repo, SETS), SETS_SOURCE, 'utf8');
  writeFileSync(join(repo, READS), readsSource(options.broken), 'utf8');
  const trackerPath = join(repo, '.rafa', 'plans', 'PLAN_TRACKER-retake-alone.md');
  writeFileSync(trackerPath, TRACKER, 'utf8');

  const steps: SessionStep[] = [];
  const context: SuiteStepContext = {
    repoRoot: repo,
    checkout: repo,
    trackerPath,
    sessionId: SESSION,
    settings: { testsFullSuiteTriggers: [], testsIntegration: [], testsAlwaysRun: [], testsRetakeRedAlone: options.retake },
    owns: () => Promise.resolve(['leak']),
    seams: { git, appendStep: (step) => steps.push(step) },
  };
  const outcome = await runStageStep(context, { stage: 0, name: 'Leak' }, GREEN_BASELINE);
  return { repo, trackerPath, outcome, steps };
}

/** The text of a file the step left under its run's `suite/` directory. */
function suiteFile(repo: string, name: string): string {
  return readFileSync(join(repo, '.rafa', 'runs', SESSION, 'suite', name), 'utf8');
}

describe('a stage step over a real bun test, one file failed by the file before it', () => {
  it('reads green, records the file as red only in the step with the file before it, and inserts no repair task', async () => {
    const { repo, trackerPath, outcome, steps } = await drive({ retake: true, broken: false });

    expect(outcome).toMatchObject({ kind: 'stage', red: false, interrupted: false, blocker: null, blockedLine: null, repairInserted: false });
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
    expect(steps).toHaveLength(1);
    // The step's own run named the two files in this order, and was red: exit 1 with the failure in `failures`.
    expect(steps[0]?.scope).toEqual([SETS, READS]);
    expect(steps[0]?.exitCode).toBe(1);
    expect(steps[0]?.failures).toEqual([{ file: READS, name: READS_CASE }]);
    expect(steps[0]?.newFailures).toEqual([]);
    expect(steps[0]?.stepOnly).toEqual([{
      file: READS,
      tests: [READS_CASE],
      errorLines: ['error: leaked state: another test file set the value'],
      position: 2,
      before: [SETS],
    }]);

    // The step's capture holds the failed case and its error; the retake's own holds a green run.
    expect(suiteFile(repo, 'stage.output.txt')).toContain(`${READS}:\n(fail) ${READS_CASE}\n  error: leaked state: another test file set the value\n`);
    expect(suiteFile(repo, 'stage-alone-1.output.txt')).toContain(' 1 pass\n 0 fail\n');
    expect(existsSync(join(repo, '.rafa', 'runs', SESSION, 'suite', 'stage-alone-1.junit.xml'))).toBe(true);

    const warnings = lines.filter((line) => line.level === 'warn').map((line) => line.message);
    expect(warnings).toEqual([
      `⚠️  Red only in the step: ${READS} read 1 test failing in the stage step for "Leak" and was green when run alone: `
      + `file 2 of its run, after ${SETS}. First error: "error: leaked state: another test file set the value". `
      + `Capture: .rafa/runs/${SESSION}/suite/stage.output.txt. It blocks nothing and gets no repair task.`,
    ]);
    expect(lines.filter((line) => line.level === 'error')).toEqual([]);
  }, CASE_TIMEOUT_MS);

  it('is red on the same project with the retake off, inserting a repair task for the file', async () => {
    const { trackerPath, outcome, steps } = await drive({ retake: false, broken: false });

    expect(outcome.red).toBe(true);
    expect(outcome.repairInserted).toBe(true);
    expect(steps[0]?.newFailures).toEqual([{ file: READS, name: READS_CASE, errorLines: ['error: leaked state: another test file set the value'] }]);
    expect(Object.keys(steps[0] ?? {})).not.toContain('stepOnly');
    expect(findNextTask(readFileSync(trackerPath, 'utf8'))?.task).toBe(`Repair the red stage step at commit ${HEAD}  {agent=build-error-resolver}`);
    expect(outcome.blocker).not.toContain('run alone');
  }, CASE_TIMEOUT_MS);

  it('stays red when the file is broken on its own, its repair task saying it was red again alone and quoting the error', async () => {
    const { repo, trackerPath, outcome, steps } = await drive({ retake: true, broken: true });

    expect(outcome.red).toBe(true);
    expect(outcome.repairInserted).toBe(true);
    expect(steps[0]?.newFailures).toEqual([{ file: READS, name: READS_CASE, errorLines: ['error: broken on its own'] }]);
    expect(Object.keys(steps[0] ?? {})).not.toContain('stepOnly');
    expect(outcome.blocker).toBe([
      'The runner\'s stage step for "Leak" found failures the suite baseline does not hold.',
      `New failing test files: ${READS} (1 test, red again when run alone).`,
      `Run bun test ./${READS} and make them pass.`,
      `What Bun printed for them: ${READS} "error: broken on its own" (1 test).`,
    ].join(' '));
    const tracker = readFileSync(trackerPath, 'utf8');
    const next = findNextTask(tracker);
    expect(next?.status).toBe('blocked');
    expect(next?.task).toBe(`Repair the red stage step at commit ${HEAD}  {agent=build-error-resolver}`);
    expect(next?.blocker).toBe(outcome.blocker ?? '');
    expect(parsePlan(tracker).tasks.filter((task) => task.text.startsWith('Repair the red'))).toHaveLength(1);
    // The retake ran, and read red: its own capture holds the same failure.
    expect(suiteFile(repo, 'stage-alone-1.output.txt')).toContain(`(fail) ${READS_CASE}\n  error: broken on its own\n`);
    expect(lines.filter((line) => line.level === 'warn')).toEqual([]);
  }, CASE_TIMEOUT_MS);
});
