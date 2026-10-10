/**
 * Tests for the blocked tasks of a checklist (`loop/blocked-tasks.ts`).
 *
 * Every case hands `blockedTasks` a checklist built as
 * `readSessionChecklist` builds one: the tasks `parsePlan` reads off a
 * text, beside that text's lines. So no file is read and no session
 * record is planted; `rafa loop status` printing them is covered by
 * `commands/loop/status.test.ts`.
 *
 * Each reading sits beside its control: a blocked line with a comment
 * beside one without, a blank comment beside a written one, and a
 * checklist with no blocked line beside the ones that hold some.
 */
import type { SessionChecklist } from './session-readings.js';

import { describe, expect, it } from 'bun:test';

import { parsePlan } from '../plan/index.js';
import { blockerComment } from '../utils/tracker.js';

import { blockedTasks } from './blocked-tasks.js';

/** The checklist `readSessionChecklist` would build from a file holding `content`. */
function checklistOf(content: string): SessionChecklist {
  return { file: '/project/.plans/PLAN_TRACKER-demo.md', tasks: parsePlan(content).tasks, lines: content.split('\n') };
}

/** A tracker of four tasks, the first done, with `second` and `fourth` as its second and fourth task lines. */
function tracker(second: string, fourth: string): string {
  return [
    '# Plan: demo',
    '',
    '# Stage: one',
    '',
    '- [x] First task',
    second,
    '- [ ] Third task',
    fourth,
    '',
  ].join('\n');
}

describe('blockedTasks', () => {
  it('answers none for a session with no checklist', () => {
    expect(blockedTasks(null)).toEqual([]);
  });

  it('answers none for a checklist with no blocked line', () => {
    const checklist = checklistOf(tracker('- [ ] Second task', '- [ ] Fourth task'));

    expect(blockedTasks(checklist)).toEqual([]);
  });

  it('answers each blocked line in file order, its line counted from one, with the comment it trails or null', () => {
    const checklist = checklistOf(tracker(
      '- [BLOCKED] Second task  {effort=low}',
      `- [BLOCKED] Fourth task  ${blockerComment('the board is down')}`,
    ));

    expect(blockedTasks(checklist)).toEqual([
      { line: 6, text: 'Second task', blocker: null },
      { line: 8, text: 'Fourth task', blocker: 'the board is down' },
    ]);
  });

  it('unescapes a comment of several lines and keeps its spelling out of the task text', () => {
    const blocker = 'the check-types gate exited 2\nsee `tsc --noEmit`';
    const checklist = checklistOf(tracker(
      `- [BLOCKED] Second task  {effort=low}  ${blockerComment(blocker)}`,
      '- [ ] Fourth task',
    ));

    expect(blockedTasks(checklist)).toEqual([{ line: 6, text: 'Second task', blocker }]);
  });

  it('reads a blank comment as no blocker, beside a written one that is read', () => {
    const checklist = checklistOf(tracker(
      `- [BLOCKED] Second task  ${blockerComment('   ')}`,
      `- [BLOCKED] Fourth task  ${blockerComment('written')}`,
    ));

    expect(blockedTasks(checklist).map((task) => task.blocker)).toEqual([null, 'written']);
  });
});
