/**
 * The list of the test files a run's suite steps read red only in the
 * step (`start/step-only-report.ts`): gathered from the recorded steps,
 * read off a real run record under a temporary project, rendered as the
 * wrap-up prompt's section, and printed at the run's end.
 *
 * Each claim that something is listed sits beside the same reading over
 * steps holding no such file, where nothing is: no section, no heading
 * and no line printed.
 */
import type { SessionStep, SessionStepOnly } from '../loop/sessions.js';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { beginSession, sessionFilePath, updateSession } from '../loop/sessions.js';
import { sinkOutput } from '../tests/output-sinks.js';

import {
  announceRunStepOnly,
  readRunStepOnly,
  runStepOnlyOf,
  STEP_ONLY_HEADING,
  STEP_ONLY_TESTS_NAMED,
  stepOnlyLines,
  stepOnlySection,
} from './step-only-report.js';

const SESSION = '11111111-2222-4333-8444-555555555555';
const LEAKY = 'src/utils/claude.test.ts';
const SPEND = 'UndeclaredSpendError: rafa loop start spends through claude and declared none';

/** A `stepOnly` entry of {@link LEAKY}: two tests, after two files. */
const LEAKED: SessionStepOnly = {
  file: LEAKY,
  tests: ['claude > first', 'claude > second'],
  errorLines: [SPEND, 'second line'],
  position: 3,
  before: ['src/a.test.ts', 'src/b.test.ts'],
};

/** A recorded step of `kind`, green unless it holds `stepOnly` entries, whose tests it then lists as failures. */
function step(kind: SessionStep['kind'], stepOnly: readonly SessionStepOnly[] = []): SessionStep {
  const failures = stepOnly.flatMap((entry) => entry.tests.map((name) => ({ file: entry.file, name })));
  return {
    kind,
    scope: 'full',
    command: ['bun', 'test'],
    exitCode: failures.length === 0
      ? 0
      : 1,
    summary: 'Ran 3 tests across 2 files. [1.00ms]',
    failures,
    newFailures: [],
    ...(stepOnly.length === 0
      ? {}
      : { stepOnly }),
  };
}

let dir: string;
let lines: { level: string; message: string }[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'step-only-report-'));
  mkdirSync(join(dir, '.rafa'), { recursive: true });
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

/** Opens the record of {@link SESSION} under the temporary project and appends `steps` to it. */
function recordWith(steps: readonly SessionStep[]): void {
  beginSession(dir, { sessionId: SESSION, planStub: 'fixture', plan: '.rafa/plans/PLAN-fixture.md', branch: 'feat/fixture', pid: process.pid, startedAt: '2026-10-10T00:00:00.000Z' });
  for (const appendStep of steps) updateSession(dir, SESSION, { appendStep });
}

describe('runStepOnlyOf', () => {
  it('answers one item per file with its tests, first error line, the files before it and the step that read it', () => {
    expect(runStepOnlyOf([step('baseline'), step('task', [LEAKED])])).toEqual([{
      file: LEAKY,
      steps: ['task'],
      tests: ['claude > first', 'claude > second'],
      firstError: SPEND,
      position: 3,
      before: ['src/a.test.ts', 'src/b.test.ts'],
    }]);
  });

  it('answers none for steps that hold no such file', () => {
    expect(runStepOnlyOf([])).toEqual([]);
    expect(runStepOnlyOf([step('baseline'), step('task'), step('pre-wrap-up')])).toEqual([]);
  });

  it('lists a file several steps read so once, with every step, keeping what the first of them read', () => {
    const later: SessionStepOnly = { ...LEAKED, tests: ['claude > third'], errorLines: [], position: 9, before: ['src/z.test.ts'] };
    const other: SessionStepOnly = { file: 'src/b.test.ts', tests: ['b > only'], errorLines: [], position: null, before: [] };
    const items = runStepOnlyOf([step('task', [LEAKED]), step('stage', [other, later]), step('pre-wrap-up', [later])]);

    expect(items.map((item) => [item.file, item.steps])).toEqual([[LEAKY, ['task', 'stage', 'pre-wrap-up']], ['src/b.test.ts', ['stage']]]);
    expect(items[0]).toMatchObject({ tests: LEAKED.tests, firstError: SPEND, position: 3, before: LEAKED.before });
    expect(items[1]).toMatchObject({ firstError: null, position: null, before: [] });
  });
});

describe('stepOnlyLines', () => {
  it('writes one line per file: its tests, the steps, the first error and the files run before it', () => {
    expect(stepOnlyLines(runStepOnlyOf([step('task', [LEAKED]), step('task', [LEAKED]), step('stage', [LEAKED])]))).toEqual([
      `- \`${LEAKY}\`: 2 tests (\`claude > first\`, \`claude > second\`) red in 3 steps (task, stage) and green when run alone; first error: "${SPEND}"; run after src/a.test.ts, src/b.test.ts.`,
    ]);
  });

  it('names the first tests up to the cap and counts the rest', () => {
    const tests = Array.from({ length: STEP_ONLY_TESTS_NAMED + 18 }, (_, index) => `claude > case ${index}`);
    const [line] = stepOnlyLines(runStepOnlyOf([step('pre-wrap-up', [{ ...LEAKED, tests }])]));

    expect(line).toContain(`${tests.length} tests (${tests.slice(0, STEP_ONLY_TESTS_NAMED).map((name) => `\`${name}\``)
      .join(', ')} and 18 more) red in 1 step (pre-wrap-up)`);
    expect(line).not.toContain(`claude > case ${STEP_ONLY_TESTS_NAMED}\``);
  });

  it('says so when Bun printed no error line, when the file ran first, and when its place was not read', () => {
    const first = stepOnlyLines(runStepOnlyOf([step('task', [{ ...LEAKED, tests: ['claude > first'], errorLines: [], position: 1, before: [] }])]));
    expect(first).toEqual([`- \`${LEAKY}\`: 1 test (\`claude > first\`) red in 1 step (task) and green when run alone; Bun printed no error line for it; the first file of its run.`]);

    const unplaced = stepOnlyLines(runStepOnlyOf([step('task', [{ ...LEAKED, position: null, before: [] }])]));
    expect(unplaced[0]?.endsWith('; its place in the step\'s file order was not read.')).toBe(true);
  });
});

describe('stepOnlySection', () => {
  it('writes the heading, what the session is asked for and the lines, when the run holds such a file', () => {
    const items = runStepOnlyOf([step('task', [LEAKED])]);
    const section = stepOnlySection(items);

    expect(section[0]).toBe('');
    expect(section[1]).toBe(`## ${STEP_ONLY_HEADING}`);
    expect(section.join('\n')).toContain(`Put the list in the pull request body under the heading \`### ${STEP_ONLY_HEADING}\``);
    expect(section.slice(-1)).toEqual([...stepOnlyLines(items)]);
  });

  it('writes nothing at all, not even the heading, when it holds none', () => {
    expect(stepOnlySection([])).toEqual([]);
  });
});

describe('readRunStepOnly', () => {
  it('reads the items off the run\'s record', () => {
    recordWith([step('baseline'), step('task', [LEAKED]), step('pre-wrap-up', [LEAKED])]);

    expect(readRunStepOnly(dir, SESSION)).toEqual(runStepOnlyOf([step('task', [LEAKED]), step('pre-wrap-up', [LEAKED])]));
  });

  it('reads none off a record whose steps hold no such file', () => {
    recordWith([step('baseline'), step('task')]);

    expect(readRunStepOnly(dir, SESSION)).toEqual([]);
  });

  it('answers none, throwing nothing, for a record that is not there or does not read', () => {
    expect(readRunStepOnly(dir, SESSION)).toEqual([]);

    recordWith([step('task', [LEAKED])]);
    writeFileSync(sessionFilePath(dir, SESSION), '{ not json', 'utf8');
    expect(readRunStepOnly(dir, SESSION)).toEqual([]);
    expect(readRunStepOnly(dir, 'no such id')).toEqual([]);
  });
});

describe('announceRunStepOnly', () => {
  it('prints the list once, as warnings, under one line saying what it is', () => {
    const items = runStepOnlyOf([step('task', [LEAKED]), step('stage', [LEAKED])]);
    announceRunStepOnly(items);

    expect(lines).toEqual([
      { level: 'warn', message: '\n⚠️  1 test file(s) read red only in a suite step of this run, green when run alone. Nothing blocked on them and nothing fixed them:' },
      ...stepOnlyLines(items).map((line) => ({ level: 'warn', message: `   ${line}` })),
    ]);
  });

  it('prints nothing for a run that holds none', () => {
    announceRunStepOnly([]);

    expect(lines).toEqual([]);
  });
});

describe('the list as start() and runWrapUp wire it', () => {
  const start = readFileSync(new URL('../start.ts', import.meta.url), 'utf8');
  const wrapUpRun = readFileSync(new URL('./wrap-up-run.ts', import.meta.url), 'utf8');

  /** The text of the last `finally` block of `source`, or the empty string when it has none. */
  const lastFinally = (source: string): string => {
    const at = source.lastIndexOf('} finally {');
    return at < 0
      ? ''
      : source.slice(at);
  };

  it('is printed at the run\'s end, before the record is written its end', () => {
    const ending = lastFinally(start);

    expect(ending).toContain('announceRunStepOnly(readRunStepOnly(repoRoot, session.id));');
    expect(ending.indexOf('announceRunStepOnly(')).toBeLessThan(ending.indexOf('session.end();'));
    // The control: the reader answers the block and not the whole file, which calls it nowhere else.
    expect(start.split('announceRunStepOnly(')).toHaveLength(2);
    expect(lastFinally('try { a(); } catch { b(); }')).toBe('');
  });

  it('is read off the run\'s record by runWrapUp, and handed on to its session and its retries', () => {
    expect(wrapUpRun).toContain('  const stepOnly = readRunStepOnly(repoRoot, session.id);\n');
    expect(wrapUpRun).toContain('await preserveProgress(planContent, settingSources, release, serving, wrapUpLearning, base, checkout, { stepOnly });');
    expect(wrapUpRun).toContain('deliverySeamsIn({ ...input, base, fragment: finish.fragment, stepOnly })');
    expect(wrapUpRun).toContain('      stepOnly: context.stepOnly,\n');
  });
});
