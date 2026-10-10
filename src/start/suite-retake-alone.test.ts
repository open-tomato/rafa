/**
 * The retake of a step's newly red files alone
 * (`start/suite-retake-alone.ts`), driven through the three steps that
 * take it, `runTaskStep`, `runStageStep` and `runPreWrapUpStep`, over a
 * scripted `runSuite`, a scripted git, a collected record append and a
 * real tracker file under a temporary directory.
 *
 * Nothing here spawns `bun test`: the step's own run and each retake are
 * answered in turn from a list, and the options every one was asked with
 * are read back. `suite-step-retake-alone-integration.test.ts` drives the
 * same steps over a real `bun test`. Each claim that a file blocked
 * nothing sits beside a case where the same step, with the retake off or
 * the file red alone, does block.
 *
 * The diff a step is taken over, scripted through git, decides one more
 * reading: a file green alone that ran after a test file that diff
 * names stays a new failure. Each of those cases sits beside the same
 * step over a diff naming no file run before it, where the file is red
 * only in the step.
 */
import type { AloneSaid } from './suite-blocker.js';
import type { SuiteStepContext } from './suite-step.js';
import type { SessionStep } from '../loop/sessions.js';
import type { GitResult, GitRunner } from '../pr/index.js';
import type { SuiteBaseline } from '../suite/baseline.js';
import type { SuiteFailure, SuiteResult, SuiteRunOptions } from '../suite/run.js';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { parsePlan } from '../plan/parse.js';
import { baselineOf } from '../suite/baseline.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { findNextTask } from '../utils/tracker.js';

import { blockerText, TOUCHED_BEFORE_NAMED } from './suite-blocker.js';
import { aloneJunitFileFor, RETAKE_ALONE_MAX_FILES, STEP_ONLY_BEFORE } from './suite-retake-alone.js';
import {
  junitFileFor,
  readStageLedger,
  runPreWrapUpStep,
  runStageStep,
  runTaskStep,
  SIGINT_EXIT_CODE,
  stageLedgerPathFor,
} from './suite-step.js';

const BASE = 'base0000';
const HEAD = 'head1111';
const SESSION = 'session-1';

/** Two stages: the first finished, the second with its tasks open. */
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

/** The file issue 926 measured: red in the step, green alone. */
const LEAKY = 'src/utils/claude.test.ts';

/** A file red on its own. */
const BROKEN = 'src/new.test.ts';

/** The error every stand-in case of {@link LEAKY} threw. */
const SPEND = 'UndeclaredSpendError: rafa loop start spends through claude and declared none';

const KNOWN: SuiteFailure = { file: 'src/old.test.ts', name: 'old > still red' };
const LEAKED: SuiteFailure = { file: LEAKY, name: 'claude > first', errorLines: [SPEND, 'second line'] };
const LEAKED_TWO: SuiteFailure = { file: LEAKY, name: 'claude > second', errorLines: [SPEND, 'second line'] };
const BROKE: SuiteFailure = { file: BROKEN, name: 'new > broke', errorLines: ['error: boom'] };

/** The order the step's one process ran its files in. */
const ORDER = ['src/a.test.ts', 'src/b.test.ts', 'src/cli/running.test.ts', BROKEN, LEAKY, 'src/z.test.ts'];

let dir: string;
let trackerPath: string;
let lines: { level: string; message: string }[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'suite-retake-alone-'));
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
    ...overrides,
  };
}

/** A red result naming `failures`, its files run in {@link ORDER}. */
function red(failures: readonly SuiteFailure[], overrides: Partial<SuiteResult> = {}): SuiteResult {
  return result({ exitCode: 1, failures, fileOrder: [ORDER], ...overrides });
}

/** A baseline holding {@link KNOWN}, recorded at {@link BASE}. */
function baseline(): SuiteBaseline {
  return baselineOf(result({ exitCode: 1, failures: [KNOWN] }), new Date('2026-09-30T00:00:00Z'), BASE);
}

/** A git at {@link HEAD} whose diff from {@link BASE} is `paths`. */
function gitAt(paths: readonly string[] = ['src/a.ts']): GitRunner {
  const answers: Record<string, GitResult> = {
    'rev-parse --verify HEAD^{commit}': { ok: true, stdout: `${HEAD}\n`, stderr: '' },
    [`diff --name-only -z --no-renames ${BASE} HEAD`]: { ok: true, stdout: paths.map((path) => `${path}\0`).join(''), stderr: '' },
  };
  return (args) => answers[args.join(' ')] ?? { ok: false, stdout: '', stderr: `unscripted: ${args.join(' ')}` };
}

/** A git at {@link HEAD} whose diff does not answer. */
const unreadDiff: GitRunner = (args) => args[0] === 'rev-parse'
  ? { ok: true, stdout: `${HEAD}\n`, stderr: '' }
  : { ok: false, stdout: '', stderr: 'fatal: bad object' };

/** One scripted answer: a result, or an error the run throws. */
type Answer = SuiteResult | Error;

/** What a context's scripted seams saw. */
interface Seen {
  readonly runs: SuiteRunOptions[];
  readonly steps: SessionStep[];
}

/** A context over the temporary tracker, its runs answered in turn from `answers`, the retake on unless `retake` is false. */
function contextWith(answers: readonly Answer[], options: { readonly retake?: boolean; readonly owns?: readonly string[] | null; readonly onRun?: (nth: number) => void; readonly diff?: readonly string[] | null } = {}): { readonly context: SuiteStepContext; readonly seen: Seen } {
  const seen: Seen = { runs: [], steps: [] };
  const queue = [...answers];
  const context: SuiteStepContext = {
    repoRoot: dir,
    checkout: dir,
    trackerPath,
    sessionId: SESSION,
    settings: {
      testsFullSuiteTriggers: ['package.json'],
      testsIntegration: [],
      testsAlwaysRun: [],
      testsRetakeRedAlone: options.retake ?? true,
    },
    owns: () => Promise.resolve(options.owns ?? null),
    seams: {
      runSuite: (runOptions) => {
        seen.runs.push(runOptions);
        options.onRun?.(seen.runs.length);
        const next = queue.shift();
        if (next === undefined) throw new Error('runSuite called more times than scripted');
        return next instanceof Error
          ? Promise.reject(next)
          : Promise.resolve(next);
      },
      appendStep: (step) => {
        seen.steps.push(step);
      },
      git: options.diff === null
        ? unreadDiff
        : gitAt(options.diff),
      listTestFiles: () => ['src/b/b.test.ts'],
      readPreloadFiles: () => ({ state: 'read', files: [] }),
      now: () => new Date('2026-10-01T00:00:00Z'),
    },
  };
  return { context, seen };
}

/** The lines of one level. */
function linesAt(level: string): readonly string[] {
  return lines.filter((line) => line.level === level).map((line) => line.message);
}

/** The task step's input over {@link baseline}. */
const input = { baseline: baseline(), base: BASE, declared: 'affected' as const, task: 'second task' };

/** The label {@link input}'s step is printed and blocked under. */
const LABEL = 'task step after "second task"';

describe('a task step whose new failures are green alone', () => {
  it('reads green, runs the file alone once through the step\'s own seam, and inserts no repair task', async () => {
    const { context, seen } = contextWith([red([KNOWN, LEAKED, LEAKED_TWO]), result()]);
    const outcome = await runTaskStep(context, input);

    expect(outcome).toMatchObject({ kind: 'task', red: false, interrupted: false, blocker: null, blockedLine: null, repairInserted: false });
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
    expect(seen.runs).toHaveLength(2);
    expect(seen.runs[1]).toEqual({ cwd: dir, paths: [LEAKY], junitFile: aloneJunitFileFor(dir, SESSION, 'task', 1) });
    expect(seen.runs[1]?.junitFile).toBe(join(dir, '.rafa', 'runs', SESSION, 'suite', 'task-alone-1.junit.xml'));
    // The step's own files are another pair: the retake writes over neither.
    expect(seen.runs[1]?.junitFile).not.toBe(junitFileFor(dir, SESSION, 'task'));
    expect(linesAt('error')).toEqual([]);
  });

  it('records the file under stepOnly with its tests, its error lines, its place and the files before it, and out of the new failures', async () => {
    const { context, seen } = contextWith([red([KNOWN, LEAKED, LEAKED_TWO]), result()]);
    await runTaskStep(context, input);

    expect(seen.steps).toHaveLength(1);
    expect(seen.steps[0]?.newFailures).toEqual([]);
    expect(seen.steps[0]?.failures).toEqual([KNOWN, LEAKED, LEAKED_TWO].map(({ file, name }) => ({ file, name })));
    expect(seen.steps[0]?.stepOnly).toEqual([{
      file: LEAKY,
      tests: ['claude > first', 'claude > second'],
      errorLines: [SPEND, 'second line'],
      position: 5,
      before: ['src/a.test.ts', 'src/b.test.ts', 'src/cli/running.test.ts', BROKEN],
    }]);
  });

  it('prints one warning naming the file, its count, its first error line, its place and the capture', async () => {
    const { context } = contextWith([red([LEAKED, LEAKED_TWO]), result()]);
    await runTaskStep(context, input);

    expect(linesAt('warn')).toEqual([
      `⚠️  Red only in the step: ${LEAKY} read 2 tests failing in the ${LABEL} and was green when run alone: `
      + `file 5 of its run, after src/a.test.ts, src/b.test.ts, src/cli/running.test.ts, ${BROKEN}. `
      + `First error: "${SPEND}". Capture: .rafa/runs/${SESSION}/suite/task.output.txt. It blocks nothing and gets no repair task.`,
    ]);
  });

  it('blocks on the same failures with the retake off, running nothing a second time', async () => {
    const { context, seen } = contextWith([red([KNOWN, LEAKED, LEAKED_TWO])], { retake: false });
    const outcome = await runTaskStep(context, input);

    expect(outcome.red).toBe(true);
    expect(outcome.repairInserted).toBe(true);
    expect(seen.runs).toHaveLength(1);
    expect(seen.steps[0]?.newFailures).toEqual([LEAKED, LEAKED_TWO]);
    expect(Object.keys(seen.steps[0] ?? {})).not.toContain('stepOnly');
    expect(outcome.blocker).toBe([
      `The runner's ${LABEL} found failures the suite baseline does not hold.`,
      `New failing test files: ${LEAKY} (2 tests).`,
      `Run bun test ./${LEAKY} and make them pass.`,
      `What Bun printed for them: ${LEAKY} "${SPEND}" (2 tests).`,
    ].join(' '));
  });

  it('reads a file green alone when its retake holds only the failure the baseline holds', async () => {
    const inherited: SuiteFailure = { file: KNOWN.file, name: 'old > newly red' };
    const { context, seen } = contextWith([red([KNOWN, inherited]), result({ exitCode: 1, failures: [KNOWN] })]);
    const outcome = await runTaskStep(context, input);

    expect(outcome.red).toBe(false);
    expect(seen.runs[1]?.paths).toEqual([KNOWN.file]);
    expect(seen.steps[0]?.stepOnly?.map((entry) => [entry.file, entry.tests])).toEqual([[KNOWN.file, ['old > newly red']]]);
  });

  it('retakes no file whose failures the baseline all holds', async () => {
    const { context, seen } = contextWith([red([KNOWN])]);
    const outcome = await runTaskStep(context, input);

    expect(outcome.red).toBe(false);
    expect(seen.runs).toHaveLength(1);
    expect(Object.keys(seen.steps[0] ?? {})).not.toContain('stepOnly');
    expect(linesAt('warn')).toEqual([]);
  });
});

describe('a task step whose new failures are red alone', () => {
  it('stays red, keeps them as new failures, and says on the repair task that the file was red again alone', async () => {
    const { context, seen } = contextWith([red([KNOWN, BROKE]), red([BROKE])]);
    const outcome = await runTaskStep(context, input);

    expect(outcome.red).toBe(true);
    expect(outcome.repairInserted).toBe(true);
    expect(seen.runs[1]?.paths).toEqual([BROKEN]);
    expect(seen.steps[0]?.newFailures).toEqual([BROKE]);
    expect(Object.keys(seen.steps[0] ?? {})).not.toContain('stepOnly');
    expect(outcome.blocker).toBe([
      `The runner's ${LABEL} found failures the suite baseline does not hold.`,
      `New failing test files: ${BROKEN} (1 test, red again when run alone).`,
      `Run bun test ./${BROKEN} and make them pass.`,
      `What Bun printed for them: ${BROKEN} "error: boom" (1 test).`,
    ].join(' '));
    const next = findNextTask(readFileSync(trackerPath, 'utf8'));
    expect(next?.task).toBe(`Repair the red task step at commit ${HEAD}  {agent=build-error-resolver}`);
    expect(next?.blocker).toBe(outcome.blocker ?? '');
    expect(linesAt('warn')).toEqual([]);
  });

  it('reads a file red alone when it throws while it loads, with no failure named', async () => {
    const { context } = contextWith([red([BROKE]), result({ exitCode: 1, errors: 1 })]);
    const outcome = await runTaskStep(context, input);

    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toContain(`${BROKEN} (1 test, red again when run alone)`);
  });

  it('inserts the repair for the files red alone only, and lists a file green alone apart as not the repair\'s to fix', async () => {
    const { context, seen } = contextWith([red([KNOWN, BROKE, LEAKED, LEAKED_TWO]), red([BROKE]), result()]);
    const outcome = await runTaskStep(context, input);

    expect(seen.runs.slice(1).map((run) => run.paths)).toEqual([[BROKEN], [LEAKY]]);
    expect(seen.runs.slice(1).map((run) => run.junitFile)).toEqual([aloneJunitFileFor(dir, SESSION, 'task', 1), aloneJunitFileFor(dir, SESSION, 'task', 2)]);
    expect(outcome.red).toBe(true);
    expect(seen.steps[0]?.newFailures).toEqual([BROKE]);
    expect(seen.steps[0]?.stepOnly?.map((entry) => entry.file)).toEqual([LEAKY]);
    expect(outcome.blocker).toBe([
      `The runner's ${LABEL} found failures the suite baseline does not hold.`,
      `New failing test files: ${BROKEN} (1 test, red again when run alone).`,
      `Run bun test ./${BROKEN} and make them pass.`,
      `What Bun printed for them: ${BROKEN} "error: boom" (1 test).`,
      `Red only in the step, green alone: not yours to fix: ${LEAKY} (2 tests).`,
    ].join(' '));
    expect(parsePlan(readFileSync(trackerPath, 'utf8')).tasks.filter((task) => task.text.startsWith('Repair the red'))).toHaveLength(1);
    expect(linesAt('warn').filter((line) => line.includes('Red only in the step'))).toHaveLength(1);
    expect(linesAt('info')).toContain(`🔁 The ${LABEL} read new failures in 2 test file(s); running 2 alone, once each, to tell a file red on its own from one red only in the step's file order.`);
    expect(linesAt('info')).toContain('   Run alone: 1 green (red only in the step), 1 red again, 0 not read.');
  });
});

describe('a file green alone that ran after files the step\'s diff names', () => {
  /** The blocker of a step whose one new failing file, {@link LEAKY}, ran after `touched`. */
  const leakBlocker = (label: string, touched: readonly string[]): string => [
    `The runner's ${label} found failures the suite baseline does not hold.`,
    `New failing test files: ${LEAKY} (2 tests, green when run alone).`,
    `What Bun printed for them: ${LEAKY} "${SPEND}" (2 tests).`,
    `Green when run alone, red after files this change touches: ${LEAKY} after ${touched.join(', ')}.`,
    `Run bun test ${[...touched, LEAKY].map((file) => `./${file}`).join(' ')} to see it fail: a file run before it leaves the state it meets.`,
  ].join(' ');

  it('keeps a task step red when the task changed a file run before it, naming that file on the repair', async () => {
    const { context, seen } = contextWith([red([KNOWN, LEAKED, LEAKED_TWO]), result()], { diff: ['src/b.test.ts', 'src/a.ts'] });
    const outcome = await runTaskStep(context, input);

    expect(outcome.red).toBe(true);
    expect(outcome.repairInserted).toBe(true);
    expect(seen.runs).toHaveLength(2);
    expect(seen.steps[0]?.newFailures).toEqual([LEAKED, LEAKED_TWO]);
    expect(Object.keys(seen.steps[0] ?? {})).not.toContain('stepOnly');
    expect(outcome.blocker).toBe(leakBlocker(LABEL, ['src/b.test.ts']));
    expect(findNextTask(readFileSync(trackerPath, 'utf8'))?.blocker).toBe(outcome.blocker ?? '');
    expect(linesAt('warn')).toEqual([]);
    expect(linesAt('info')).toContain('   Run alone: 0 green (red only in the step), 0 red again, 0 not read.');
    expect(linesAt('info')).toContain('   1 file(s) green alone ran after files this change touches; they stay new failures.');
  });

  it('reads the same file red only in the step when the task changed only a file run after it, or the file itself', async () => {
    const { context, seen } = contextWith([red([KNOWN, LEAKED, LEAKED_TWO]), result()], { diff: ['src/z.test.ts', LEAKY] });
    const outcome = await runTaskStep(context, input);

    expect(outcome.red).toBe(false);
    expect(seen.steps[0]?.stepOnly?.map((entry) => entry.file)).toEqual([LEAKY]);
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
  });

  it('reads the whole of the file\'s process order, past the files a stepOnly entry would name', async () => {
    const order = ['src/first.test.ts', ...Array.from({ length: STEP_ONLY_BEFORE + 3 }, (_, index) => `src/p${index}.test.ts`), LEAKY];
    const { context } = contextWith([red([LEAKED, LEAKED_TWO], { fileOrder: [order] }), result()], { diff: ['src/first.test.ts'] });
    const outcome = await runTaskStep(context, input);

    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toBe(leakBlocker(LABEL, ['src/first.test.ts']));
  });

  it('reads only the process that ran the file: a changed file of the step\'s other run does not count', async () => {
    const sweep: SuiteFailure = { file: 'src/x.sweep.test.ts', name: 'sweep > leaked' };
    const folded = red([sweep], { fileOrder: [ORDER, ['src/w.sweep.test.ts', sweep.file]] });
    const other = contextWith([folded, result()], { diff: ['src/a.test.ts'] });
    expect((await runTaskStep(other.context, input)).red).toBe(false);

    writeFileSync(trackerPath, TRACKER, 'utf8');
    const own = contextWith([folded, result()], { diff: ['src/w.sweep.test.ts'] });
    const outcome = await runTaskStep(own.context, input);
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toContain(`${sweep.file} after src/w.sweep.test.ts.`);
  });

  it('names the nearest changed files up to the cap, counts the rest, and runs the named ones in its command', async () => {
    const changed = Array.from({ length: TOUCHED_BEFORE_NAMED + 2 }, (_, index) => `src/t${index}.test.ts`);
    const { context } = contextWith([red([LEAKED], { fileOrder: [[...changed, LEAKY]] }), result()], { diff: changed });
    const outcome = await runTaskStep(context, input);

    const named = changed.slice(2);
    expect(named).toHaveLength(TOUCHED_BEFORE_NAMED);
    expect(outcome.blocker).toContain(`red after files this change touches: ${LEAKY} after ${named.join(', ')} and 2 more.`);
    expect(outcome.blocker).toContain(`Run bun test ${[...named, LEAKY].map((file) => `./${file}`).join(' ')} to see it fail`);
    expect(outcome.blocker).not.toContain('src/t1.test.ts');
  });

  it('gives a file red alone its own command, and the files green alone after a changed file theirs', async () => {
    const { context, seen } = contextWith([red([KNOWN, BROKE, LEAKED, LEAKED_TWO]), red([BROKE]), result()], { diff: ['src/a.test.ts'] });
    const outcome = await runTaskStep(context, input);

    expect(seen.steps[0]?.newFailures).toEqual([BROKE, LEAKED, LEAKED_TWO]);
    expect(outcome.blocker).toBe([
      `The runner's ${LABEL} found failures the suite baseline does not hold.`,
      `New failing test files: ${BROKEN} (1 test, red again when run alone), ${LEAKY} (2 tests, green when run alone).`,
      `Run bun test ./${BROKEN} and make them pass.`,
      `What Bun printed for them: ${BROKEN} "error: boom" (1 test); ${LEAKY} "${SPEND}" (2 tests).`,
      `Green when run alone, red after files this change touches: ${LEAKY} after src/a.test.ts.`,
      `Run bun test ./src/a.test.ts ./${LEAKY} to see it fail: a file run before it leaves the state it meets.`,
    ].join(' '));
  });

  it('reads a repair task\'s step against the plan\'s diff, so a repair that changed nothing leaves the file a new failure', async () => {
    const REPAIR_BASE = 'repair00';
    const diffs: Record<string, readonly string[]> = { [REPAIR_BASE]: [], [BASE]: ['src/a.test.ts'] };
    const git: GitRunner = (args) => {
      const from = args[0] === 'diff'
        ? diffs[args.at(-2) ?? '']
        : undefined;
      return from === undefined
        ? gitAt()(args)
        : { ok: true, stdout: from.map((path) => `${path}\0`).join(''), stderr: '' };
    };
    const repair = contextWith([red([LEAKED, LEAKED_TWO]), result()]);
    const repairInput = { ...input, base: REPAIR_BASE, task: 'Repair the red task step at commit head1111' };
    const outcome = await runTaskStep({ ...repair.context, seams: { ...repair.context.seams, git } }, repairInput);

    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toContain(`Green when run alone, red after files this change touches: ${LEAKY} after src/a.test.ts.`);

    // The control: any other task over the same empty diff reads the file red only in the step.
    writeFileSync(trackerPath, TRACKER, 'utf8');
    const plain = contextWith([red([LEAKED, LEAKED_TWO]), result()]);
    const other = await runTaskStep({ ...plain.context, seams: { ...plain.context.seams, git } }, { ...input, base: REPAIR_BASE });
    expect(other.red).toBe(false);
    expect(plain.seen.steps[0]?.stepOnly?.map((entry) => entry.file)).toEqual([LEAKY]);
  });

  it('keeps a stage step red when the stage changed a file run before it', async () => {
    const { context } = contextWith([red([LEAKED, LEAKED_TWO]), result()], { diff: ['src/cli/running.test.ts'] });
    const outcome = await runStageStep(context, { stage: 0, name: 'One' }, baseline());

    expect(outcome.red).toBe(true);
    expect(outcome.repairInserted).toBe(true);
    expect(outcome.blocker).toBe(leakBlocker('stage step for "One"', ['src/cli/running.test.ts']));
  });

  it('keeps a pre-wrap-up step red when the plan changed a file run before it, read against the baseline\'s commit', async () => {
    const { context } = contextWith([red([KNOWN, LEAKED, LEAKED_TWO]), result()], { diff: ['src/a.test.ts', BROKEN] });
    const outcome = await runPreWrapUpStep(context, baseline());

    expect(outcome.red).toBe(true);
    expect(outcome.repairInserted).toBe(true);
    expect(outcome.blocker).toBe(leakBlocker('pre-wrap-up step', ['src/a.test.ts', BROKEN]));
    expect(findNextTask(readFileSync(trackerPath, 'utf8'))?.task).toBe(`Repair the red pre-wrap-up step at commit ${HEAD}  {agent=build-error-resolver}`);
  });

  it('reads a file red only in the step when the step\'s diff did not read, a pre-wrap-up step warning that it could not check', async () => {
    const task = contextWith([red([LEAKED]), result()], { diff: null });
    expect((await runTaskStep(task.context, input)).red).toBe(false);
    expect(task.seen.steps[0]?.stepOnly?.map((entry) => entry.file)).toEqual([LEAKY]);

    lines = [];
    const last = contextWith([red([LEAKED]), result()], { diff: null });
    expect((await runPreWrapUpStep(last.context, baseline())).red).toBe(false);
    expect(linesAt('warn')[0]).toBe(`⚠️  git diff from ${BASE} did not answer (fatal: bad object); no file green alone is checked against the files the plan changed.`);
  });

  it('reads no diff for a pre-wrap-up step with no file green alone', async () => {
    const asked: string[] = [];
    const { context } = contextWith([red([BROKE]), red([BROKE])]);
    const git: GitRunner = (args) => {
      asked.push(args[0] ?? '');
      return gitAt()(args);
    };
    await runPreWrapUpStep({ ...context, seams: { ...context.seams, git } }, baseline());

    expect(asked).not.toContain('diff');
  });
});

describe('a retake that answers nothing', () => {
  it('reads a retake ended by SIGINT as a stop: no blocker, no stepOnly, and no file retaken after it', async () => {
    const killed = result({ exitCode: SIGINT_EXIT_CODE, summary: null, errors: null, junit: 'missing' });
    const { context, seen } = contextWith([red([BROKE, LEAKED]), killed]);
    const outcome = await runTaskStep(context, input);

    expect(outcome).toMatchObject({ red: false, interrupted: true, blocker: null, blockedLine: null, repairInserted: false });
    expect(seen.runs).toHaveLength(2);
    expect(seen.steps[0]).toMatchObject({ newFailures: [], interrupted: true });
    expect(Object.keys(seen.steps[0] ?? {})).not.toContain('stepOnly');
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
  });

  it('reads a retake the runner was signalled during as a stop, even when it came back green', async () => {
    let signalled = false;
    const { context, seen } = contextWith([red([LEAKED]), result()], { onRun: (nth) => {
      signalled = nth === 2;
    } });
    const outcome = await runTaskStep({ ...context, isInterrupted: () => signalled }, input);

    expect(outcome).toMatchObject({ red: false, interrupted: true, blocker: null });
    expect(seen.steps[0]?.interrupted).toBe(true);
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
  });

  it('leaves a file whose retake could not be spawned a new failure, warning once and claiming nothing of how it ran alone', async () => {
    const { context, seen } = contextWith([red([LEAKED]), new Error('spawn bun ENOENT')]);
    const outcome = await runTaskStep(context, input);

    expect(outcome.red).toBe(true);
    expect(outcome.repairInserted).toBe(true);
    expect(seen.steps[0]?.newFailures).toEqual([LEAKED]);
    expect(outcome.blocker).toContain(`New failing test files: ${LEAKY} (1 test).`);
    expect(outcome.blocker).not.toContain('red again when run alone');
    expect(outcome.blocker).not.toContain('Red only in the step');
    expect(linesAt('warn')).toEqual([`⚠️  Could not run ${LEAKY} alone (spawn bun ENOENT); it stays a new failure.`]);
  });

  it('leaves a file whose retake printed no summary a new failure, as one whose JUnit file did not read', async () => {
    for (const unread of [result({ exitCode: 1, summary: null, errors: null, junit: 'missing' }), result({ junit: 'unreadable' })]) {
      writeFileSync(trackerPath, TRACKER, 'utf8');
      const { context, seen } = contextWith([red([LEAKED]), unread]);
      const outcome = await runTaskStep(context, input);

      expect(outcome.red).toBe(true);
      expect(seen.steps[0]?.newFailures).toEqual([LEAKED]);
      expect(outcome.blocker).not.toContain('red again when run alone');
    }
  });
});

describe('the files a step retakes', () => {
  it('runs each newly red file alone once, however many of its tests failed', async () => {
    const { context, seen } = contextWith([red([LEAKED, BROKE, LEAKED_TWO]), result(), red([BROKE])]);
    await runTaskStep(context, input);

    expect(seen.runs.slice(1).map((run) => run.paths)).toEqual([[LEAKY], [BROKEN]]);
  });

  it('retakes the first files up to the cap and leaves the rest new failures, saying how many', async () => {
    const files = Array.from({ length: RETAKE_ALONE_MAX_FILES + 2 }, (_, index): SuiteFailure => ({ file: `src/f${index}.test.ts`, name: 't' }));
    const { context, seen } = contextWith([red(files, { fileOrder: [files.map((failure) => failure.file)] }), ...files.slice(0, RETAKE_ALONE_MAX_FILES).map(() => result())]);
    const outcome = await runTaskStep(context, input);

    expect(seen.runs).toHaveLength(1 + RETAKE_ALONE_MAX_FILES);
    expect(seen.steps[0]?.stepOnly).toHaveLength(RETAKE_ALONE_MAX_FILES);
    expect(seen.steps[0]?.newFailures).toEqual(files.slice(RETAKE_ALONE_MAX_FILES));
    expect(outcome.red).toBe(true);
    expect(linesAt('info').some((line) => line.includes(`2 more newly red file(s) were not run alone (the cap is ${RETAKE_ALONE_MAX_FILES})`))).toBe(true);
  });

  it('says on the repair that the files past the cap were not run alone, and where to start when every file run alone was green', async () => {
    const files = Array.from({ length: RETAKE_ALONE_MAX_FILES + 2 }, (_, index): SuiteFailure => ({ file: `src/f${index}.test.ts`, name: 't' }));
    const order = ['src/early.test.ts', ...files.map((failure) => failure.file)];
    const { context } = contextWith([red(files, { fileOrder: [order] }), ...files.slice(0, RETAKE_ALONE_MAX_FILES).map(() => result())]);
    const outcome = await runTaskStep(context, input);

    const [first, second] = files.slice(RETAKE_ALONE_MAX_FILES).map((failure) => failure.file);
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toContain(`New failing test files: ${first} (1 test, not run alone), ${second} (1 test, not run alone).`);
    expect(outcome.blocker).toContain(`Run bun test ./${first} ./${second} and make them pass.`);
    expect(outcome.blocker).toContain(
      `2 files were not run alone, past the ${RETAKE_ALONE_MAX_FILES} the step runs alone, and may be order-dependent too: one green alone is not yours to fix. `
      + `Every one of the ${RETAKE_ALONE_MAX_FILES} run alone was green alone, so these likely share one cause: src/f0.test.ts was the first to go red, after src/early.test.ts.`,
    );
  });

  it('names no shared cause when a file run alone was red alone, or was not read', async () => {
    const files = Array.from({ length: RETAKE_ALONE_MAX_FILES + 1 }, (_, index): SuiteFailure => ({ file: `src/f${index}.test.ts`, name: 't' }));
    const answers = files.slice(0, RETAKE_ALONE_MAX_FILES).map(() => result());
    const [broken] = files;
    if (broken === undefined) throw new Error('no file');

    const redAlone = contextWith([red(files, { fileOrder: [files.map((failure) => failure.file)] }), red([broken]), ...answers.slice(1)]);
    const blocked = await runTaskStep(redAlone.context, input);
    expect(blocked.blocker).toContain(`1 file was not run alone, past the ${RETAKE_ALONE_MAX_FILES} the step runs alone, and may be order-dependent too: one green alone is not yours to fix.`);
    expect(blocked.blocker).not.toContain('share one cause');

    writeFileSync(trackerPath, TRACKER, 'utf8');
    const unread = contextWith([red(files, { fileOrder: [files.map((failure) => failure.file)] }), result({ junit: 'unreadable' }), ...answers.slice(1)]);
    const other = await runTaskStep(unread.context, input);
    expect(other.blocker).toContain('1 file was not run alone');
    expect(other.blocker).not.toContain('share one cause');
  });

  it('says nothing of files not run alone on a step that ran every newly red file alone', async () => {
    const { context } = contextWith([red([KNOWN, BROKE]), red([BROKE])]);
    const outcome = await runTaskStep(context, input);

    expect(outcome.blocker).not.toContain('not run alone');
  });

  it('names at most the cap of files before a file, the nearest ones, in run order', async () => {
    const order = [...Array.from({ length: STEP_ONLY_BEFORE + 3 }, (_, index) => `src/p${index}.test.ts`), LEAKY];
    const { context, seen } = contextWith([red([LEAKED], { fileOrder: [order] }), result()]);
    await runTaskStep(context, input);

    const [entry] = seen.steps[0]?.stepOnly ?? [];
    expect(entry?.position).toBe(STEP_ONLY_BEFORE + 4);
    expect(entry?.before).toEqual(order.slice(3, STEP_ONLY_BEFORE + 3));
    expect(entry?.before).toHaveLength(STEP_ONLY_BEFORE);
  });

  it('places a file within the process that ran it, and names that process\'s capture', async () => {
    const sweep: SuiteFailure = { file: 'src/x.sweep.test.ts', name: 'sweep > leaked' };
    const folded = red([sweep], { fileOrder: [ORDER, ['src/w.sweep.test.ts', sweep.file]] });
    const { context, seen } = contextWith([folded, result()]);
    await runTaskStep(context, input);

    expect(seen.steps[0]?.stepOnly).toEqual([{ file: sweep.file, tests: ['sweep > leaked'], errorLines: [], position: 2, before: ['src/w.sweep.test.ts'] }]);
    const [warning] = linesAt('warn');
    expect(warning).toContain('file 2 of its run, after src/w.sweep.test.ts. Bun printed no error line for it.');
    expect(warning).toContain(`Capture: .rafa/runs/${SESSION}/suite/task-always-run.output.txt.`);
  });

  it('says so when the step\'s file order does not hold the file, or it ran first', async () => {
    const unplaced = contextWith([red([LEAKED], { fileOrder: [[]] }), result()]);
    await runTaskStep(unplaced.context, input);
    expect(unplaced.seen.steps[0]?.stepOnly?.[0]).toMatchObject({ position: null, before: [] });
    expect(linesAt('warn')[0]).toContain('green when run alone: its place in the step\'s file order was not read.');

    lines = [];
    const first = contextWith([red([LEAKED], { fileOrder: [[LEAKY, 'src/z.test.ts']] }), result()]);
    await runTaskStep(first.context, input);
    expect(first.seen.steps[0]?.stepOnly?.[0]).toMatchObject({ position: 1, before: [] });
    expect(linesAt('warn')[0]).toContain('green when run alone: the first file of its run.');
  });

  it('takes no file alone after a step whose only red is errors outside any test', async () => {
    const thrown = { file: 'src/boom.test.ts', firstLine: 'error: boom' };
    const { context, seen } = contextWith([result({ exitCode: 1, errors: 1, unhandled: [thrown] }), result({ exitCode: 1, errors: 1, unhandled: [thrown] })]);
    const outcome = await runTaskStep(context, input);

    // Two runs: the step's, and its one retake over the same run (`retakeOnErrors`). No file is run alone.
    expect(seen.runs).toHaveLength(2);
    expect(seen.runs[1]?.paths).toBeUndefined();
    expect(outcome.red).toBe(true);
  });
});

describe('a step red on a file green alone and on an error outside any test', () => {
  const thrown = { file: 'src/boom.test.ts', firstLine: 'error: boom' };

  /** The step's own run: {@link LEAKY} red, and one error outside any test over the baseline's count. */
  const both = (): SuiteResult => red([KNOWN, LEAKED, LEAKED_TWO], { errors: 1, unhandled: [thrown] });

  it('takes the run once more after the file read green alone, and is green when the retake counts no error', async () => {
    const { context, seen } = contextWith([both(), result(), red([KNOWN, LEAKED, LEAKED_TWO])]);
    const outcome = await runTaskStep(context, input);

    expect(outcome).toMatchObject({ red: false, interrupted: false, blocker: null, repairInserted: false });
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
    // The step's run, the file alone, then the step's run again: over no path list, as the first was.
    expect(seen.runs.map((run) => run.paths)).toEqual([undefined, [LEAKY], undefined]);
    expect(seen.runs[2]?.junitFile).toBe(junitFileFor(dir, SESSION, 'task'));
    // Both runs are recorded, each with the file red only in the step and no new failure.
    expect(seen.steps.map((step) => [step.newFailures, step.stepOnly?.map((entry) => entry.file)])).toEqual([[[], [LEAKY]], [[], [LEAKY]]]);
    expect(linesAt('warn').some((line) => line.startsWith(`🔁 The ${LABEL} counted 1 more error(s) outside any test than the baseline and nothing else red`))).toBe(true);
    expect(linesAt('warn').some((line) => line.startsWith(`⚠️  Intermittent: the retake of the ${LABEL} counted no more errors`))).toBe(true);
    expect(linesAt('error')).toEqual([]);
  });

  it('stays red on the error when the retake counts it again, the file listed as not the repair\'s to fix', async () => {
    const { context, seen } = contextWith([both(), result(), both()]);
    const outcome = await runTaskStep(context, input);

    expect(seen.runs).toHaveLength(3);
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toBe([
      `The runner's ${LABEL} found failures the suite baseline does not hold.`,
      '1 more error(s) outside any test than the baseline; Bun\'s stderr named them as src/boom.test.ts threw "error: boom".',
      'Run bun test ./src/boom.test.ts and make each load.',
      `Red only in the step, green alone: not yours to fix: ${LEAKY} (2 tests).`,
    ].join(' '));
  });

  it('takes the run no second time when the file is red alone: the failure blocks, and the error is named beside it', async () => {
    const { context, seen } = contextWith([red([BROKE], { errors: 1, unhandled: [thrown] }), red([BROKE])]);
    const outcome = await runTaskStep(context, input);

    expect(seen.runs).toHaveLength(2);
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toContain(`${BROKEN} (1 test, red again when run alone)`);
    expect(outcome.blocker).toContain('1 more error(s) outside any test than the baseline');
  });

  it('takes the run once more at most: a step first red on errors alone is not taken a third time', async () => {
    const errorsOnly = result({ exitCode: 1, errors: 1, unhandled: [thrown] });
    const { context, seen } = contextWith([errorsOnly, both(), result()]);
    const outcome = await runTaskStep(context, input);

    // The step's run, its retake on the errors, and the file alone. No third run of the step.
    expect(seen.runs.map((run) => run.paths)).toEqual([undefined, undefined, [LEAKY]]);
    expect(outcome.red).toBe(true);
    expect(outcome.blocker).toContain('1 more error(s) outside any test than the baseline');
  });

  it('lists under stepOnly only the files still red in the retake', async () => {
    const { context, seen } = contextWith([both(), result(), result()]);
    const outcome = await runTaskStep(context, input);

    expect(outcome.red).toBe(false);
    expect(seen.steps).toHaveLength(2);
    expect(seen.steps[0]?.stepOnly?.map((entry) => entry.file)).toEqual([LEAKY]);
    expect(Object.keys(seen.steps[1] ?? {})).not.toContain('stepOnly');
    expect(linesAt('warn').filter((line) => line.includes('Red only in the step'))).toEqual([]);
  });

  it('does the same for a stage step and a pre-wrap-up step', async () => {
    const stage = contextWith([both(), result(), red([KNOWN, LEAKED, LEAKED_TWO])]);
    expect((await runStageStep(stage.context, { stage: 0, name: 'One' }, baseline())).red).toBe(false);
    expect(stage.seen.runs).toHaveLength(3);

    const last = contextWith([both(), result(), red([KNOWN, LEAKED, LEAKED_TWO])]);
    expect((await runPreWrapUpStep(last.context, baseline())).red).toBe(false);
    expect(last.seen.runs.map((run) => run.paths)).toEqual([undefined, [LEAKY], undefined]);
  });
});

describe('a stage step and a pre-wrap-up step', () => {
  const stage = { stage: 0, name: 'One' };

  it('reads a stage step green on a file green alone, entering the stage in the ledger', async () => {
    const { context, seen } = contextWith([red([LEAKED]), result()]);
    const outcome = await runStageStep(context, stage, baseline());

    expect(outcome).toMatchObject({ kind: 'stage', red: false, blocker: null, repairInserted: false });
    expect(seen.runs[1]).toEqual({ cwd: dir, paths: [LEAKY], junitFile: aloneJunitFileFor(dir, SESSION, 'stage', 1) });
    expect(seen.steps[0]?.stepOnly?.[0]?.file).toBe(LEAKY);
    expect(readStageLedger(stageLedgerPathFor(trackerPath))).toEqual([{ ...stage, commit: HEAD, via: 'step' }]);
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
    expect(linesAt('warn')[0]).toContain(`Capture: .rafa/runs/${SESSION}/suite/stage.output.txt.`);
  });

  it('keeps a stage step red on a file red alone, its repair saying so', async () => {
    const { context } = contextWith([red([BROKE]), red([BROKE])]);
    const outcome = await runStageStep(context, stage, baseline());

    expect(outcome.red).toBe(true);
    expect(outcome.repairInserted).toBe(true);
    expect(outcome.blocker).toContain(`${BROKEN} (1 test, red again when run alone)`);
  });

  it('reads a pre-wrap-up step green on a file green alone, inserting no repair', async () => {
    const { context, seen } = contextWith([red([KNOWN, LEAKED, LEAKED_TWO]), result()]);
    const outcome = await runPreWrapUpStep(context, baseline());

    expect(outcome).toMatchObject({ kind: 'pre-wrap-up', red: false, blocker: null, blockedLine: null, repairInserted: false });
    expect(seen.runs[1]).toEqual({ cwd: dir, paths: [LEAKY], junitFile: aloneJunitFileFor(dir, SESSION, 'pre-wrap-up', 1) });
    expect(seen.steps[0]?.newFailures).toEqual([]);
    expect(readFileSync(trackerPath, 'utf8')).toBe(TRACKER);
  });

  it('keeps a pre-wrap-up step red on a file red alone, inserting its repair', async () => {
    const { context } = contextWith([red([BROKE]), red([BROKE])]);
    const outcome = await runPreWrapUpStep(context, baseline());

    expect(outcome.red).toBe(true);
    expect(outcome.repairInserted).toBe(true);
    expect(outcome.blocker).toContain(`${BROKEN} (1 test, red again when run alone)`);
    expect(findNextTask(readFileSync(trackerPath, 'utf8'))?.task).toBe(`Repair the red pre-wrap-up step at commit ${HEAD}  {agent=build-error-resolver}`);
  });
});

describe('blockerText and the files run alone', () => {
  const verdict = (fresh: readonly SuiteFailure[], newErrors = 0) => ({ fresh, known: [], newErrors, unreported: false });
  const stepOnly = [{ file: LEAKY, tests: ['claude > first', 'claude > second'], errorLines: [SPEND], position: 5, before: [BROKEN] }];

  /** What a step's retakes said, nothing unless `part` holds it. */
  const said = (part: Partial<AloneSaid>): AloneSaid => ({ stepOnly: [], redAlone: [], afterTouched: [], notRun: [], taken: 0, ...part });

  it('marks only the files red again alone, and leaves a file not run alone as it was', () => {
    const other: SuiteFailure = { file: 'src/other.test.ts', name: 'x' };
    const text = blockerText('task step', { exitCode: 1, unhandled: [] }, verdict([BROKE, other]), said({ redAlone: [BROKEN], taken: 1 }));
    expect(text).toContain(`New failing test files: ${BROKEN} (1 test, red again when run alone), src/other.test.ts (1 test).`);
    expect(text).not.toContain('Red only in the step');
  });

  it('lists the files green alone apart, after what Bun printed, each with its count', () => {
    const second = { file: 'src/b.test.ts', tests: ['b > only'], errorLines: [], position: null, before: [] };
    const text = blockerText('stage step', { exitCode: 1, unhandled: [] }, verdict([BROKE]), said({ stepOnly: [...stepOnly, second], redAlone: [BROKEN], taken: 3 }));
    expect(text.endsWith(`Red only in the step, green alone: not yours to fix: ${LEAKY} (2 tests), src/b.test.ts (1 test).`)).toBe(true);
  });

  it('lists them too when the step is red on errors outside any test alone', () => {
    const unhandled = [{ file: 'src/boom.test.ts', firstLine: 'error: boom' }];
    const text = blockerText('pre-wrap-up step', { exitCode: 1, unhandled }, verdict([], 1), said({ stepOnly, taken: 1 }));
    expect(text).not.toContain('New failing test files');
    expect(text).toContain('1 more error(s) outside any test than the baseline');
    expect(text).toContain(`Red only in the step, green alone: not yours to fix: ${LEAKY} (2 tests).`);
  });

  it('names a file past the cap as not run alone, and the first file red only in the step when every file run alone was', () => {
    const past: SuiteFailure = { file: 'src/past.test.ts', name: 'x' };
    const all = blockerText('task step', { exitCode: 1, unhandled: [] }, verdict([past]), said({ stepOnly, notRun: [past.file], taken: 1 }));
    expect(all).toContain('New failing test files: src/past.test.ts (1 test, not run alone).');
    expect(all).toContain(`Every one of the 1 run alone was green alone, so these likely share one cause: ${LEAKY} was the first to go red, after ${BROKEN}.`);

    // The control: one more file run alone, which was not red only in the step, and no cause is named.
    const some = blockerText('task step', { exitCode: 1, unhandled: [] }, verdict([past]), said({ stepOnly, notRun: [past.file], taken: 2 }));
    expect(some).toContain('1 file was not run alone, past the 2 the step runs alone, and may be order-dependent too');
    expect(some).not.toContain('share one cause');
  });

  it('says a first file that ran first went red with no file before it', () => {
    const past: SuiteFailure = { file: 'src/past.test.ts', name: 'x' };
    const first = [{ file: LEAKY, tests: ['claude > first'], errorLines: [], position: 1, before: [] }];
    const text = blockerText('task step', { exitCode: 1, unhandled: [] }, verdict([past]), said({ stepOnly: first, notRun: [past.file], taken: 1 }));
    expect(text).toContain(`so these likely share one cause: ${LEAKY} was the first to go red.`);
  });

  it('writes the blocker of a step with no retake as it was before', () => {
    const before = blockerText('task step', { exitCode: 1, unhandled: [] }, verdict([BROKE]));
    expect(blockerText('task step', { exitCode: 1, unhandled: [] }, verdict([BROKE]), said({}))).toBe(before);
    expect(before).toContain(`New failing test files: ${BROKEN} (1 test).`);
  });
});
