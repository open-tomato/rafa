/**
 * Tests for the budget exit (`start/budget.ts`): the rule telling a task
 * session that ran out of its budget from any other failed session, and
 * the mark it leaves on the task's tracker line.
 *
 * The rule's fixture is the measured exit: on Claude Code 2.1.268,
 * `claude -p --max-budget-usd 0.01` exited 1 with stdout `Error: Exceeded
 * USD budget (0.01)` and no newline after it. Each refusal varies that
 * fixture along one axis and holds the rest, and the fixture itself reads
 * as a budget exit beside them, so a rule answering false for everything
 * reddens.
 *
 * The mark is read back through `findNextTask`, the reader the task's next
 * dispatch goes through, over a tracker in this file's temporary
 * directory. The lines the operator is told are read through a sink output
 * set for each case and unset after it.
 */
import type { TaskDispatch } from './dispatch.js';

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { sinkOutput } from '../tests/output-sinks.js';
import { findNextTask } from '../utils/tracker.js';

import {
  BUDGET_EXCEEDED,
  BUDGET_EXIT_CODE,
  isBudgetExit,
  markBudgetExit,
} from './budget.js';

/** What a session handed `--max-budget-usd 0.01` wrote to stdout, as measured. */
const MEASURED_STDOUT = 'Error: Exceeded USD budget (0.01)';

/** The flags a task declaring an agent and that budget is spawned with. */
const BUDGET_FLAGS = ['--agent', 'loop-implementer', '--max-budget-usd', '0.01'];

/** The part of a dispatch the rule reads. */
type Exit = Pick<TaskDispatch, 'flags' | 'exitCode' | 'output'>;

/** The measured exit, as the loop's dispatch holds it. */
const MEASURED: Exit = { flags: BUDGET_FLAGS, exitCode: 1, output: MEASURED_STDOUT };

describe('isBudgetExit', () => {
  it('reads the measured exit as a budget exit', () => {
    expect(BUDGET_EXIT_CODE).toBe(1);
    expect(isBudgetExit(MEASURED)).toBe(true);
  });

  it('reads the line as the last of several, with a line ending, and naming another amount', () => {
    expect(isBudgetExit({ ...MEASURED, output: `${MEASURED_STDOUT}\n` })).toBe(true);
    expect(isBudgetExit({ ...MEASURED, output: 'Error: Exceeded USD budget (2.5)\r\n' })).toBe(true);
    expect(isBudgetExit({ ...MEASURED, output: `Working on it.\n${MEASURED_STDOUT}` })).toBe(true);
  });

  it('reads no budget exit from a session spawned with no budget', () => {
    expect(isBudgetExit({ ...MEASURED, flags: ['--agent', 'loop-implementer'] })).toBe(false);
    expect(isBudgetExit({ ...MEASURED, flags: [] })).toBe(false);
  });

  it('reads no budget exit from any other exit code', () => {
    for (const exitCode of [0, 2, 3, 130]) {
      expect(isBudgetExit({ ...MEASURED, exitCode })).toBe(false);
    }
  });

  it('reads no budget exit from an output whose last line is not the measured one', () => {
    const outputs = [
      `${MEASURED_STDOUT}\nand a line after it`,
      `Quoting it: ${MEASURED_STDOUT}`,
      'Error: Exceeded USD budget',
      '',
    ];
    for (const output of outputs) {
      expect(isBudgetExit({ ...MEASURED, output })).toBe(false);
    }
  });
});

const tempRoot = mkdtempSync(join(tmpdir(), 'rafa-start-budget-'));
let planted = 0;

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** A tracker file under {@link tempRoot} holding `lines`. */
function plantTracker(lines: readonly string[]): string {
  planted += 1;
  const path = join(tempRoot, `PLAN_TRACKER-${planted}.md`);
  writeFileSync(path, lines.join('\n'), 'utf8');
  return path;
}

/** The tracker's line at `lineNum`. */
function lineOf(path: string, lineNum: number): string | undefined {
  return readFileSync(path, 'utf8').split('\n')[lineNum];
}

describe('markBudgetExit', () => {
  let seen: string[] = [];

  beforeEach(() => {
    seen = [];
    setActiveOutput(sinkOutput({
      info: (message) => seen.push(`info:${message}`),
      warn: (message) => seen.push(`warn:${message}`),
      error: (message) => seen.push(`error:${message}`),
    }));
  });

  afterEach(() => {
    setActiveOutput(null);
  });

  it('marks the line [BLOCKED] with budget exceeded, which the next read hands back', () => {
    const path = plantTracker([
      '# Plan: demo',
      '',
      '- [x] First task',
      '- [ ] Second task  {agent=loop-implementer budget=0.01}',
      '- [ ] Third task',
      '',
    ]);

    markBudgetExit({ trackerPath: path, taskInfo: { lineNum: 3 }, dispatch: { flags: BUDGET_FLAGS } });

    expect(BUDGET_EXCEEDED).toBe('budget exceeded');
    expect(lineOf(path, 3)).toBe('- [BLOCKED] Second task  {agent=loop-implementer budget=0.01}  <!-- blocked: budget exceeded -->');
    expect(lineOf(path, 4)).toBe('- [ ] Third task');
    expect(findNextTask(readFileSync(path, 'utf8'))).toEqual({
      task: 'Second task  {agent=loop-implementer budget=0.01}',
      lineNum: 3,
      status: 'blocked',
      blocker: 'budget exceeded',
    });
    expect(seen).toEqual([
      'error:\n⛔ Task stopped on its budget (--max-budget-usd 0.01): budget exceeded. Marked as blocked.',
      'error:   Raise its budget= or split it, then run again to retry.',
    ]);
  });

  it('replaces the blocker text an earlier run left, rather than adding a second', () => {
    const path = plantTracker([
      '- [BLOCKED] Second task  {budget=2}  <!-- blocked: an earlier reason -->',
      '',
    ]);

    markBudgetExit({ trackerPath: path, taskInfo: { lineNum: 0 }, dispatch: { flags: ['--max-budget-usd', '2'] } });

    expect(lineOf(path, 0)).toBe('- [BLOCKED] Second task  {budget=2}  <!-- blocked: budget exceeded -->');
    expect(seen[0]).toBe('error:\n⛔ Task stopped on its budget (--max-budget-usd 2): budget exceeded. Marked as blocked.');
  });

  it('marks a line no comment can go on as a failed task is marked, naming no amount it was not handed', () => {
    const path = plantTracker(['- [ ] ', '']);

    markBudgetExit({ trackerPath: path, taskInfo: { lineNum: 0 }, dispatch: { flags: ['--agent', 'loop-implementer'] } });

    expect(lineOf(path, 0)).toBe('- [BLOCKED] ');
    expect(seen[0]).toBe('error:\n⛔ Task stopped on its budget (--max-budget-usd its declared amount): budget exceeded. Marked as blocked.');
  });
});
