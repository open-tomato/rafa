/**
 * Tests for the pass-over list a `--continue` run keeps: the tasks it
 * jumped or deferred, the lines `findNextTask` skips for them, and what
 * is left at the end of the run.
 *
 * Every tracker is a string; nothing is written. Each skip reading sits
 * beside the same tracker read with an empty list, the control that the
 * line skipped is the one answered without it.
 */
import type { ContinueDecision } from './decision-parse.js';

import { describe, expect, it } from 'bun:test';

import { findNextTask } from '../utils/tracker.js';

import {
  EMPTY_PASS_OVER,
  addDecision,
  markDone,
  remaining,
  skippedLines,
  taskIdentity,
} from './pass-over.js';

/** A tracker with a blocked gate, a helper task and a task using it. */
const TRACKER = [
  '# Plan: pass-over probe',
  '',
  '- [x] Done already',
  '- [BLOCKED] Gate on .env.local  <!-- blocked: needs a person -->',
  '- [ ] Write the helper',
  '- [ ] Use the helper  {model=sonnet}',
  '',
].join('\n');

/** The tracker's open tasks, as `findNextTask` answers them. */
const GATE = { task: 'Gate on .env.local', lineNum: 3, status: 'blocked' as const, blocker: 'needs a person' };
const HELPER = { task: 'Write the helper', lineNum: 4, status: 'unchecked' as const };
const USER = { task: 'Use the helper  {model=sonnet}', lineNum: 5, status: 'unchecked' as const };

const JUMP: ContinueDecision = { strategy: 'jump', reason: 'A person writes .env.local.' };

/** `TRACKER` with the line at `lineNum` ticked. */
function ticked(tracker: string, lineNum: number): string {
  return tracker.split('\n').map((line, index) => index === lineNum
    ? line.replace(/^- \[(?: |BLOCKED)\]/, '- [x]')
    : line)
    .join('\n');
}

/** `TRACKER` with a repair task inserted above the line at `lineNum`. */
function inserted(tracker: string, lineNum: number): string {
  const lines = tracker.split('\n');
  return [...lines.slice(0, lineNum), '- [ ] Repair the suite', ...lines.slice(lineNum)].join('\n');
}

describe('taskIdentity', () => {
  it('takes the blocker comment and the declaration off, and trims', () => {
    expect(taskIdentity('  Gate on .env.local  <!-- blocked: x -->')).toBe('Gate on .env.local');
    expect(taskIdentity(USER.task)).toBe('Use the helper');
  });

  it('keeps text that only looks like a declaration mid-line', () => {
    expect(taskIdentity('Quote {a} here and go on')).toBe('Quote {a} here and go on');
  });
});

describe('addDecision', () => {
  it('adds a jump without changing the list it is handed', () => {
    const list = addDecision(EMPTY_PASS_OVER, GATE, JUMP, TRACKER);

    expect(EMPTY_PASS_OVER).toEqual([]);
    expect(list).toEqual([
      { task: { lineNum: 3, task: 'Gate on .env.local' }, strategy: 'jump', reason: 'A person writes .env.local.' },
    ]);
  });

  it('adds a defer naming the open task at the line it waits on, counted from one', () => {
    const list = addDecision(EMPTY_PASS_OVER, USER, { strategy: 'defer', reason: 'Needs the helper.', after: 5 }, TRACKER);

    expect(list).toEqual([
      {
        task: { lineNum: 5, task: 'Use the helper' },
        strategy: 'defer',
        reason: 'Needs the helper.',
        after: { lineNum: 4, task: 'Write the helper' },
      },
    ]);
  });

  it.each([
    ['a done line', 3],
    ['a heading', 1],
    ['a line past the end', 40],
    ['the task itself', 6],
  ])('adds nothing for a defer after %s, so the task is eligible at once', (_name, after) => {
    expect(addDecision(EMPTY_PASS_OVER, USER, { strategy: 'defer', reason: 'x', after }, TRACKER)).toEqual([]);
  });

  it.each([['retry'], ['stop']] as const)('adds nothing for %s', (strategy) => {
    const decision: ContinueDecision = strategy === 'retry'
      ? { strategy, reason: 'x', approach: 'y' }
      : { strategy, reason: 'x' };

    expect(addDecision(EMPTY_PASS_OVER, GATE, decision, TRACKER)).toEqual([]);
  });

  it('replaces an earlier entry for the same task', () => {
    const deferred = addDecision(EMPTY_PASS_OVER, USER, { strategy: 'defer', reason: 'first', after: 5 }, TRACKER);
    const jumped = addDecision(deferred, USER, { strategy: 'jump', reason: 'second' }, TRACKER);

    expect(jumped).toEqual([{ task: { lineNum: 5, task: 'Use the helper' }, strategy: 'jump', reason: 'second' }]);
    expect(deferred).toHaveLength(1);
    expect(deferred[0]?.strategy).toBe('defer');
  });
});

describe('skippedLines', () => {
  it('skips a jumped blocked line, so findNextTask answers the next open task', () => {
    const list = addDecision(EMPTY_PASS_OVER, GATE, JUMP, TRACKER);

    expect(findNextTask(TRACKER, { skipLines: skippedLines(EMPTY_PASS_OVER, TRACKER) })).toEqual(GATE);
    expect([...skippedLines(list, TRACKER)]).toEqual([3]);
    expect(findNextTask(TRACKER, { skipLines: skippedLines(list, TRACKER) })).toEqual(HELPER);
  });

  it('skips a deferred line while the task it waits on is open, and releases it once that is ticked', () => {
    const list = addDecision(EMPTY_PASS_OVER, USER, { strategy: 'defer', reason: 'x', after: 5 }, TRACKER);
    const after = ticked(TRACKER, 4);

    expect([...skippedLines(list, TRACKER)]).toEqual([5]);
    expect([...skippedLines(list, after)]).toEqual([]);
  });

  it('follows a task by its text when an inserted line moves it', () => {
    const list = addDecision(addDecision(EMPTY_PASS_OVER, GATE, JUMP, TRACKER), USER, { strategy: 'defer', reason: 'x', after: 5 }, TRACKER);
    const moved = inserted(TRACKER, 3);

    expect([...skippedLines(list, moved)].sort((a, b) => a - b)).toEqual([4, 6]);
    expect(findNextTask(moved, { skipLines: skippedLines(list, moved) })?.task).toBe('Repair the suite');
  });

  it('skips nothing for a jumped task no longer open', () => {
    const list = addDecision(EMPTY_PASS_OVER, GATE, JUMP, TRACKER);

    expect([...skippedLines(list, ticked(TRACKER, 3))]).toEqual([]);
  });

  it('matches the nearer of two lines holding the same text', () => {
    const twice = '- [ ] Same\n- [ ] Other\n- [ ] Same\n';
    const list = addDecision(EMPTY_PASS_OVER, { task: 'Same', lineNum: 2, status: 'unchecked' }, JUMP, twice);

    expect([...skippedLines(list, twice)]).toEqual([2]);
  });
});

describe('markDone', () => {
  it('releases the defers waiting on the task, and leaves the rest', () => {
    const list = addDecision(
      addDecision(EMPTY_PASS_OVER, GATE, JUMP, TRACKER),
      USER,
      { strategy: 'defer', reason: 'x', after: 5 },
      TRACKER,
    );

    const done = markDone(list, HELPER);

    expect(done).toEqual([list[0]]);
    expect(list).toHaveLength(2);
  });

  it('drops an entry for the done task itself', () => {
    const list = addDecision(EMPTY_PASS_OVER, GATE, JUMP, TRACKER);

    expect(markDone(list, GATE)).toEqual([]);
  });

  it('answers the same list when nothing waits on the task', () => {
    const list = addDecision(EMPTY_PASS_OVER, GATE, JUMP, TRACKER);

    expect(markDone(list, HELPER)).toEqual(list);
  });
});

describe('remaining', () => {
  it('answers each entry still passed over, at its current line', () => {
    const list = addDecision(addDecision(EMPTY_PASS_OVER, GATE, JUMP, TRACKER), USER, { strategy: 'defer', reason: 'x', after: 5 }, TRACKER);
    const moved = inserted(TRACKER, 0);

    expect(remaining(list, moved)).toEqual([
      { task: { lineNum: 4, task: 'Gate on .env.local' }, strategy: 'jump', reason: 'A person writes .env.local.' },
      {
        task: { lineNum: 6, task: 'Use the helper' },
        strategy: 'defer',
        reason: 'x',
        after: { lineNum: 5, task: 'Write the helper' },
      },
    ]);
  });

  it('leaves out a defer whose task it waits on is done, and a task no longer open', () => {
    const list = addDecision(addDecision(EMPTY_PASS_OVER, GATE, JUMP, TRACKER), USER, { strategy: 'defer', reason: 'x', after: 5 }, TRACKER);

    expect(remaining(list, ticked(ticked(TRACKER, 4), 3))).toEqual([]);
  });

  it('answers nothing for an empty list', () => {
    expect(remaining(EMPTY_PASS_OVER, TRACKER)).toEqual([]);
  });
});
