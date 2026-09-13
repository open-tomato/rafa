/**
 * Tests for the ralph start loop (scripts/ralph/start.ts).
 *
 * Mocks:
 *  - 'fs'                     — no real disk I/O
 *  - './utils/claude.js'      — no real Claude subprocess
 *  - './utils/git.js'         — no real git invocations
 *  - './utils/tracker.js'     — tracker helpers (findNextTask, updateTrackerLine)
 *
 * findNextTask is tested as a pure function without mocking.
 */

import type { TaskInfo } from '../utils/tracker.js';

import { describe, expect, it } from 'bun:test';

// ── Pure unit tests for tracker helpers ──────────────────────────────────────
 
import { findNextTask } from '../utils/tracker.js';

describe('findNextTask', () => {
  it('returns null when tracker has no tasks', () => {
    expect(findNextTask('# Plan\n\nSome text\n')).toBeNull();
  });

  it('returns the first unchecked task', () => {
    const content = '# Plan\n- [x] Done\n- [ ] Task A\n- [ ] Task B\n';
    const result = findNextTask(content);
    expect(result).toMatchObject({ task: 'Task A', status: 'unchecked', lineNum: 2 });
  });

  it('prefers a BLOCKED task over an unchecked one', () => {
    const content = '# Plan\n- [ ] Task A\n- [BLOCKED] Task B\n';
    const result = findNextTask(content);
    expect(result).toMatchObject({ task: 'Task B', status: 'blocked', lineNum: 2 });
  });

  it('returns the first BLOCKED task when multiple exist', () => {
    const content = '- [BLOCKED] First blocked\n- [BLOCKED] Second blocked\n- [ ] Unchecked\n';
    const result = findNextTask(content);
    expect(result).toMatchObject({ task: 'First blocked', lineNum: 0 });
  });

  it('returns null when all tasks are completed', () => {
    const content = '- [x] Done A\n- [x] Done B\n';
    expect(findNextTask(content)).toBeNull();
  });

  it('trims whitespace from task names', () => {
    const content = '- [ ]   Padded task   \n';
    expect(findNextTask(content)?.task).toBe('Padded task');
  });
});

/** Joins lines into a document ending in a newline, as an editor saves one. */
function doc(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

describe('findNextTask over a plan carrying rafa blocks', () => {
  /** A blocked and an open line in the plan context, one in a stage's. */
  const QUOTED = [
    '# Plan: quoted',
    '```rafa:context',
    '- [BLOCKED] Blocked inside the context',
    '- [ ] Open inside the context',
    '```',
    '# Stage: one',
    '```rafa:stage-context',
    '- [ ] Open inside the stage context',
    '```',
    '- [ ] The planned task  {agent=loop-implementer}',
  ];

  const PLANNED: TaskInfo = {
    task: 'The planned task  {agent=loop-implementer}',
    lineNum: 9,
    status: 'unchecked',
  };

  it('dispatches the task after the blocks, never a line inside one', () => {
    expect(findNextTask(doc(...QUOTED))).toEqual(PLANNED);
  });

  it('dispatches those lines once no fence opens a rafa block, the near miss', () => {
    const plain = QUOTED.map((line) => line.replace('```rafa:', '```text-'));
    expect(findNextTask(doc(...plain))).toEqual({
      task: 'Blocked inside the context',
      lineNum: 2,
      status: 'blocked',
    });

    const unblocked = plain.map((line) => line.replace('- [BLOCKED] ', '- [x] '));
    expect(findNextTask(doc(...unblocked))).toMatchObject({ task: 'Open inside the context', lineNum: 3 });
  });

  it('keeps every line number when the document is CRLF', () => {
    expect(findNextTask(doc(...QUOTED).replaceAll('\n', '\r\n'))).toEqual(PLANNED);
  });

  it('skips a line inside a block of a kind no phase reads yet', () => {
    const later = doc('```rafa:future-thing', '- [ ] Inside', '```', '- [ ] Outside');
    expect(findNextTask(later)).toMatchObject({ task: 'Outside', lineNum: 3 });
  });

  it('answers null when the only open line sits inside a block', () => {
    expect(findNextTask(doc('```rafa:context', '- [ ] Inside', '```'))).toBeNull();
    // Near miss: the same line after the closing fence.
    expect(findNextTask(doc('```rafa:context', '```', '- [ ] Inside'))).toMatchObject({ task: 'Inside', lineNum: 2 });
  });

  it('dispatches a line in a rafa fence an illustration holds, which is no block', () => {
    const illustration = doc('````markdown', '```rafa:context', '- [ ] Illustrated', '```', '````', '- [ ] Planned');
    expect(findNextTask(illustration)).toMatchObject({ task: 'Illustrated', lineNum: 2 });
  });

  it('dispatches the lines after a block never closed, as it always did', () => {
    const unclosed = doc('- [x] Done', '```rafa:context', '- [ ] After the fence');
    expect(findNextTask(unclosed)).toMatchObject({ task: 'After the fence', lineNum: 2 });
    // Near miss: closed, the same line is block body.
    expect(findNextTask(doc('- [x] Done', '```rafa:context', '- [ ] After the fence', '```'))).toBeNull();
  });
});
