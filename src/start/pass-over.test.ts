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
  seedFrom,
  skippedLines,
  taskIdentity,
  taskRefIn,
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
      { task: { lineNum: 3, task: 'Gate on .env.local', ordinal: 1 }, strategy: 'jump', reason: 'A person writes .env.local.' },
    ]);
  });

  it('adds a defer naming the open task at the line it waits on, counted from one', () => {
    const list = addDecision(EMPTY_PASS_OVER, USER, { strategy: 'defer', reason: 'Needs the helper.', after: 5 }, TRACKER);

    expect(list).toEqual([
      {
        task: { lineNum: 5, task: 'Use the helper', ordinal: 1 },
        strategy: 'defer',
        reason: 'Needs the helper.',
        after: { lineNum: 4, task: 'Write the helper', ordinal: 1 },
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

    expect(jumped).toEqual([{ task: { lineNum: 5, task: 'Use the helper', ordinal: 1 }, strategy: 'jump', reason: 'second' }]);
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

  it('names the copy of a repeated text by its place among the tracker\'s lines holding it', () => {
    const twice = '- [ ] Same\n- [ ] Other\n- [ ] Same\n';
    const list = addDecision(EMPTY_PASS_OVER, { task: 'Same', lineNum: 2, status: 'unchecked' }, JUMP, twice);

    expect([...skippedLines(list, twice)]).toEqual([2]);
    // A line of another text inserted above moves both copies, and the second is still the one skipped.
    expect([...skippedLines(list, `- [ ] Repair the suite\n${twice}`)]).toEqual([3]);
  });

  it('keeps following the second copy once a person ticks the first, which a count of open lines would lose', () => {
    const twice = '- [BLOCKED] Run the suite\n- [ ] Other\n- [BLOCKED] Run the suite\n';
    const second = { task: 'Run the suite', lineNum: 2, status: 'blocked' as const };
    const list = addDecision(EMPTY_PASS_OVER, second, JUMP, twice);
    const firstTicked = twice.replace('- [BLOCKED] Run the suite\n- [ ] Other', '- [x] Run the suite\n- [ ] Other');

    expect([...skippedLines(list, twice)]).toEqual([2]);
    expect([...skippedLines(list, firstTicked)]).toEqual([2]);
    expect(findNextTask(firstTicked, { skipLines: skippedLines(list, firstTicked) })?.task).toBe('Other');
  });

  it('reads an entry saved with no ordinal, as a record from before the field holds, as the first copy', () => {
    const twice = '- [BLOCKED] Run the suite\n- [BLOCKED] Run the suite\n';
    const saved = [{ task: { lineNum: 1, task: 'Run the suite' }, strategy: 'jump' as const, reason: 'x' }];

    expect([...skippedLines(saved, twice)]).toEqual([0]);
  });
});

describe('taskRefIn', () => {
  it('counts the copy from 1 over every task line holding the text, done ones included', () => {
    const tracker = '- [x] Run the suite  {model=haiku}\n- [ ] Other\n- [BLOCKED] Run the suite  <!-- blocked: red -->\n';

    expect(taskRefIn({ task: 'Run the suite', lineNum: 2 }, tracker)).toEqual({ lineNum: 2, task: 'Run the suite', ordinal: 2 });
    expect(taskRefIn({ task: 'Other', lineNum: 1 }, tracker)).toEqual({ lineNum: 1, task: 'Other', ordinal: 1 });
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

    const done = markDone(list, HELPER, TRACKER);

    expect(done).toEqual([list[0]]);
    expect(list).toHaveLength(2);
  });

  it('drops an entry for the done task itself', () => {
    const list = addDecision(EMPTY_PASS_OVER, GATE, JUMP, TRACKER);

    expect(markDone(list, GATE, TRACKER)).toEqual([]);
  });

  it('answers the same list when nothing waits on the task', () => {
    const list = addDecision(EMPTY_PASS_OVER, GATE, JUMP, TRACKER);

    expect(markDone(list, HELPER, TRACKER)).toEqual(list);
  });

  it('drops only the copy done when two tasks share a text, and keeps the decision on the other', () => {
    const twice = '- [BLOCKED] Run the suite\n- [ ] Other\n- [BLOCKED] Run the suite\n';
    const first = { task: 'Run the suite', lineNum: 0, status: 'blocked' as const };
    const second = { task: 'Run the suite', lineNum: 2, status: 'blocked' as const };
    const both = addDecision(addDecision(EMPTY_PASS_OVER, first, JUMP, twice), second, { strategy: 'jump', reason: 'second' }, twice);

    expect(both.map((entry) => entry.reason)).toEqual(['A person writes .env.local.', 'second']);
    expect(markDone(both, first, twice).map((entry) => entry.reason)).toEqual(['second']);
  });
});

describe('remaining', () => {
  it('answers each entry still passed over, at its current line', () => {
    const list = addDecision(addDecision(EMPTY_PASS_OVER, GATE, JUMP, TRACKER), USER, { strategy: 'defer', reason: 'x', after: 5 }, TRACKER);
    const moved = inserted(TRACKER, 0);

    expect(remaining(list, moved)).toEqual([
      { task: { lineNum: 4, task: 'Gate on .env.local', ordinal: 1 }, strategy: 'jump', reason: 'A person writes .env.local.' },
      {
        task: { lineNum: 6, task: 'Use the helper', ordinal: 1 },
        strategy: 'defer',
        reason: 'x',
        after: { lineNum: 5, task: 'Write the helper', ordinal: 1 },
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

describe('seedFrom', () => {
  /** The list a stopped run left: the gate jumped, and the helper's user deferred until the helper is done. */
  const SAVED = addDecision(addDecision(EMPTY_PASS_OVER, GATE, JUMP, TRACKER), { ...USER, status: 'blocked' }, { strategy: 'defer', reason: 'x', after: 5 }, TRACKER);
  /** The tracker that run left, the deferred task blocked as its stop left it. */
  const LEFT = TRACKER.replace('- [ ] Use the helper', '- [BLOCKED] Use the helper');

  it('keeps every entry whose task still reads [BLOCKED], at its current line', () => {
    expect(seedFrom(SAVED, LEFT)).toEqual(remaining(SAVED, LEFT));
    expect(seedFrom(SAVED, LEFT)).toHaveLength(2);
  });

  it('drops an entry a person put back with - [ ], the person\'s "try again"', () => {
    const putBack = LEFT.replace('- [BLOCKED] Gate on .env.local', '- [ ] Gate on .env.local');

    expect(seedFrom(SAVED, putBack).map((entry) => entry.task.task)).toEqual(['Use the helper']);
    // The control: the same list over the tracker as the run left it keeps the gate.
    expect(seedFrom(SAVED, LEFT).map((entry) => entry.task.task)).toEqual(['Gate on .env.local', 'Use the helper']);
  });

  it('drops an entry whose task was ticked, edited or removed', () => {
    const ticked = LEFT.replace('- [BLOCKED] Gate on .env.local', '- [x] Gate on .env.local');
    const edited = LEFT.replace('- [BLOCKED] Gate on .env.local', '- [BLOCKED] Gate on .env.local, written by the setup task');
    const removed = LEFT.replace('- [BLOCKED] Gate on .env.local  <!-- blocked: needs a person -->\n', '');

    for (const tracker of [ticked, edited, removed]) {
      expect(seedFrom(SAVED, tracker).map((entry) => entry.task.task)).toEqual(['Use the helper']);
    }
  });

  it('drops a defer whose task it waits on is done', () => {
    expect(seedFrom(SAVED, ticked(LEFT, 4)).map((entry) => entry.task.task)).toEqual(['Gate on .env.local']);
  });
});
