/**
 * Unit cases for the `bun test` paths {@link blockerText} writes: a
 * relative path gains `./` so bun reads it as a path, not a substring
 * filter, and an absolute one is written as it is. Then the error lines
 * it quotes for the new failures, by file, and the caps that keep that
 * quote short on the tracker line. Then the pre-wrap-up
 * repair {@link writeRepairTask} writes, over a real tracker file under a
 * temporary directory: inserted after the last task, or the ticked one
 * blocked again on a second red, each claim paired with its control.
 */
import type { SuiteFailure } from '../suite/run.js';

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { parsePlan } from '../plan/parse.js';
import { findNextTask } from '../utils/tracker.js';

import {
  blockerText,
  ERROR_FILES_QUOTED,
  ERROR_LINE_QUOTED_LENGTH,
  ERROR_LINES_QUOTED,
  isRepairTask,
  quotedErrors,
  repairTaskText,
  runnablePath,
  writeRepairTask,
} from './suite-blocker.js';

const verdict = (fresh: readonly SuiteFailure[], newErrors = 0) => ({ fresh, known: [], newErrors, unreported: false });

describe('runnablePath', () => {
  it('prefixes a relative path with ./ and leaves an absolute or ./-led one as it is', () => {
    expect(runnablePath('x.sweep.test.ts')).toBe('./x.sweep.test.ts');
    expect(runnablePath('src/a/x.test.ts')).toBe('./src/a/x.test.ts');
    expect(runnablePath('/abs/x.test.ts')).toBe('/abs/x.test.ts');
    expect(runnablePath('./x.test.ts')).toBe('./x.test.ts');
  });
});

describe('blockerText paths', () => {
  it('writes a nested failing file with ./ before it', () => {
    const text = blockerText('task step', { exitCode: 1, unhandled: [] }, verdict([{ file: 'src/a/b/x.sweep.test.ts', name: 'x > y' }]));
    expect(text).toContain('Run bun test ./src/a/b/x.sweep.test.ts and make them pass.');
  });

  it('writes an absolute failing file as it is', () => {
    const text = blockerText('task step', { exitCode: 1, unhandled: [] }, verdict([{ file: '/repo/src/x.test.ts', name: 'x > y' }]));
    expect(text).toContain('Run bun test /repo/src/x.test.ts and make them pass.');
    expect(text).not.toContain('./repo');
  });

  it('writes the files of errors outside any test the same way', () => {
    const unhandled = [{ file: 'src/a/boom.test.ts', firstLine: 'Error: x' }, { file: '/abs/boom.test.ts', firstLine: null }];
    const text = blockerText('stage step', { exitCode: 1, unhandled }, verdict([], 2));
    expect(text).toContain('Run bun test ./src/a/boom.test.ts /abs/boom.test.ts and make each load.');
  });
});

describe('blockerText error lines', () => {
  const SPEND = 'UndeclaredSpendError: rafa loop start spends through claude and declared none';
  const thrown = (name: string): SuiteFailure => ({ file: 'src/utils/claude.test.ts', name, errorLines: [SPEND, 'second line'] });

  it('quotes the first error line of a file\'s new failures once, with how many tests printed it', () => {
    const text = blockerText('task step', { exitCode: 1, unhandled: [] }, verdict([thrown('a'), thrown('b'), thrown('c')]));
    expect(text).toBe([
      'The runner\'s task step found failures the suite baseline does not hold.',
      'New failing test files: src/utils/claude.test.ts (3 tests).',
      'Run bun test ./src/utils/claude.test.ts and make them pass.',
      `What Bun printed for them: src/utils/claude.test.ts "${SPEND}" (3 tests).`,
    ].join(' '));
    // Control: only the first line of an error is quoted.
    expect(text).not.toContain('second line');
  });

  it('quotes the first distinct line of each file, in first-seen order, and counts the file\'s other lines', () => {
    const fresh: readonly SuiteFailure[] = [
      { file: 'sub/two.test.ts', name: 'two > first', errorLines: ['error: first boom'] },
      { file: 'a.test.ts', name: 'times out', errorLines: ['this test timed out after 50ms.'] },
      { file: 'sub/two.test.ts', name: 'two > third', errorLines: ['TypeError: third boom'] },
      { file: 'sub/two.test.ts', name: 'two > fourth', errorLines: ['error: first boom'] },
    ];
    expect(ERROR_LINES_QUOTED).toBe(1);
    expect(blockerText('stage step', { exitCode: 1, unhandled: [] }, verdict(fresh))).toContain(
      'What Bun printed for them: sub/two.test.ts "error: first boom" (2 tests), and 1 more line; a.test.ts "this test timed out after 50ms." (1 test).',
    );
  });

  it('counts the lines of one file past the cap, and the files past theirs', () => {
    const lines = ['one', 'two', 'three', 'four', 'five'].map((word, index): SuiteFailure => ({ file: 'a.test.ts', name: `t${index}`, errorLines: [`error: ${word}`] }));
    expect(blockerText('task step', { exitCode: 1, unhandled: [] }, verdict(lines))).toContain(
      'What Bun printed for them: a.test.ts "error: one" (1 test), and 4 more lines.',
    );
    const files = Array.from({ length: ERROR_FILES_QUOTED + 2 }, (_, index): SuiteFailure => ({ file: `f${index}.test.ts`, name: 't', errorLines: ['error: x'] }));
    const text = blockerText('task step', { exitCode: 1, unhandled: [] }, verdict(files));
    expect(text).toContain(`f${ERROR_FILES_QUOTED - 1}.test.ts "error: x" (1 test); and 2 more files.`);
    expect(text).not.toContain(`f${ERROR_FILES_QUOTED}.test.ts "error: x"`);
  });

  it('cuts a quoted line at the cap, marking the cut, and leaves a line at the cap whole', () => {
    const at = 'x'.repeat(ERROR_LINE_QUOTED_LENGTH);
    const whole = blockerText('task step', { exitCode: 1, unhandled: [] }, verdict([{ file: 'a.test.ts', name: 't', errorLines: [at] }]));
    expect(whole).toContain(`a.test.ts "${at}" (1 test).`);

    const cut = blockerText('task step', { exitCode: 1, unhandled: [] }, verdict([{ file: 'a.test.ts', name: 't', errorLines: [`${at}yz`] }]));
    expect(cut).toContain(`a.test.ts "${at}..." (1 test).`);
    expect(cut).not.toContain('xy');
  });

  /** What the quote of twelve files of 52-character names, five lines each, may run to. */
  const A_FEW_HUNDRED = 600;

  it('keeps the sentence to a few hundred characters whatever the step read, saying what it left out', () => {
    // The widest a step can read: every line at the length the reading itself cuts one at, 300 characters.
    const wide = (file: number, line: number): string => `error: file ${file} line ${line} ${'w'.repeat(300)}`.slice(0, 300);
    const fresh = Array.from({ length: 12 }, (_, file) => Array.from({ length: 5 }, (_unused, line): SuiteFailure => ({
      file: `src/start/a-long-enough-name-of-a-test-file-${file}.test.ts`,
      name: `case ${line}`,
      errorLines: [wide(file, line), 'second line'],
    }))).flat();
    const quoted = quotedErrors(fresh) ?? '';

    expect(quoted.length).toBeLessThanOrEqual(A_FEW_HUNDRED);
    expect(quoted.split('; ')).toHaveLength(ERROR_FILES_QUOTED + 1);
    expect(quoted).toContain(', and 4 more lines; ');
    expect(quoted.endsWith(`; and ${12 - ERROR_FILES_QUOTED} more files`)).toBe(true);
    // The control: the same failures quoted whole run to thousands of characters.
    expect(fresh.map((failure) => failure.errorLines?.[0] ?? '').join('').length).toBeGreaterThan(10 * A_FEW_HUNDRED);
  });

  it('says nothing of what Bun printed when no new failure carries a line, and leaves out a file without one', () => {
    const bare: SuiteFailure = { file: 'src/bare.test.ts', name: 'x > y' };
    expect(blockerText('task step', { exitCode: 1, unhandled: [] }, verdict([bare]))).not.toContain('What Bun printed');
    const mixed = blockerText('task step', { exitCode: 1, unhandled: [] }, verdict([bare, thrown('a')]));
    expect(mixed).toContain(`What Bun printed for them: src/utils/claude.test.ts "${SPEND}" (1 test).`);
    expect(mixed).toContain('New failing test files: src/bare.test.ts (1 test), src/utils/claude.test.ts (1 test).');
  });
});

const COMMIT = '0123456789abcdef0123';
const PRE_WRAP_UP_REPAIR = 'Repair the red pre-wrap-up step at commit 0123456789ab';

/** A tracker with every task ticked, and `extra` task lines after the last one. */
function finished(extra: readonly string[] = []): string {
  return ['# Plan: fixture', '', '# Stage: One', '', '- [x] first task', '- [x] second task', ...extra, '', 'Trailing prose.', ''].join('\n');
}

describe('writeRepairTask for a pre-wrap-up step', () => {
  let dir: string;
  let trackerPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'suite-blocker-'));
    trackerPath = join(dir, 'PLAN_TRACKER-fixture.md');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the pre-wrap-up repair\'s text as a repair task\'s', () => {
    expect(repairTaskText('pre-wrap-up', COMMIT)).toBe(PRE_WRAP_UP_REPAIR);
    expect(isRepairTask(PRE_WRAP_UP_REPAIR)).toBe(true);
    expect(isRepairTask('Repair the red wrap-up step at commit 0123456789ab')).toBe(false);
  });

  it('inserts a blocked repair after the last task when the tracker holds no pre-wrap-up repair', () => {
    writeFileSync(trackerPath, finished(), 'utf8');
    const written = writeRepairTask(trackerPath, 'the blocker', { kind: 'pre-wrap-up', commit: COMMIT });

    expect(written).toEqual({ line: 6, inserted: true });
    const content = readFileSync(trackerPath, 'utf8');
    expect(content.split('\n')[6]?.startsWith(`- [BLOCKED] ${PRE_WRAP_UP_REPAIR}  {agent=build-error-resolver}`)).toBe(true);
    expect(content.endsWith('\nTrailing prose.\n')).toBe(true);
    const next = findNextTask(content);
    expect(next?.status).toBe('blocked');
    expect(next?.blocker).toBe('the blocker');
  });

  it('blocks the ticked pre-wrap-up repair again on a second red, inserting nothing', () => {
    const before = finished([`- [x] ${PRE_WRAP_UP_REPAIR}  {agent=build-error-resolver}`]);
    writeFileSync(trackerPath, before, 'utf8');
    const written = writeRepairTask(trackerPath, 'red again', { kind: 'pre-wrap-up', commit: 'fedcba9876543210' });

    expect(written).toEqual({ line: 6, inserted: false });
    const content = readFileSync(trackerPath, 'utf8');
    expect(parsePlan(content).tasks).toHaveLength(parsePlan(before).tasks.length);
    const next = findNextTask(content);
    expect(next?.status).toBe('blocked');
    expect(next?.task).toBe(`${PRE_WRAP_UP_REPAIR}  {agent=build-error-resolver}`);
    expect(next?.blocker).toBe('red again');
    expect(content).not.toContain('fedcba987654');
  });

  it('blocks the last of two ticked pre-wrap-up repairs again', () => {
    const older = 'Repair the red pre-wrap-up step at commit aaaaaaaaaaaa';
    writeFileSync(trackerPath, finished([`- [x] ${older}  {agent=build-error-resolver}`, `- [x] ${PRE_WRAP_UP_REPAIR}  {agent=build-error-resolver}`]), 'utf8');
    expect(writeRepairTask(trackerPath, 'red again', { kind: 'pre-wrap-up', commit: COMMIT })).toEqual({ line: 7, inserted: false });
    expect(readFileSync(trackerPath, 'utf8').split('\n')[6]).toBe(`- [x] ${older}  {agent=build-error-resolver}`);
  });

  it('inserts a pre-wrap-up repair over a ticked task or stage repair, which it does not take for its own', () => {
    const taskRepair = 'Repair the red task step at commit 0123456789ab';
    const stageRepair = 'Repair the red stage step at commit 0123456789ab';
    writeFileSync(trackerPath, finished([`- [x] ${taskRepair}  {agent=build-error-resolver}`, `- [x] ${stageRepair}  {agent=build-error-resolver}`]), 'utf8');
    const written = writeRepairTask(trackerPath, 'the blocker', { kind: 'pre-wrap-up', commit: COMMIT });

    expect(written).toEqual({ line: 8, inserted: true });
    expect(findNextTask(readFileSync(trackerPath, 'utf8'))?.task).toBe(`${PRE_WRAP_UP_REPAIR}  {agent=build-error-resolver}`);
  });

  it('takes no blocked or open pre-wrap-up repair for the ticked one', () => {
    writeFileSync(trackerPath, finished([`- [ ] ${PRE_WRAP_UP_REPAIR}  {agent=build-error-resolver}`]), 'utf8');
    expect(writeRepairTask(trackerPath, 'the blocker', { kind: 'pre-wrap-up', commit: COMMIT })).toEqual({ line: 6, inserted: true });
  });
});
