/**
 * Tests for `listOpenTasks` and the lines `findNextTask` is told to
 * skip, which a `--continue` run passes over without writing a byte of
 * the tracker. Each skip case sits beside the same tracker read with no
 * skip, the control that the line skipped was the one answered before.
 */
import { describe, expect, it } from 'bun:test';

import { findNextTask, listOpenTasks } from './tracker.js';

/** A tracker with a done task, a blocked one, two open ones and a block body. */
const TRACKER = [
  '# Plan: skip probe',
  '',
  '- [x] Done already',
  '- [BLOCKED] Gate on .env.local  <!-- blocked: needs a person -->',
  '- [ ] Write the helper',
  '',
  '```rafa:context',
  '- [ ] Not a task, a block body',
  '```',
  '- [ ] Use the helper',
  '',
].join('\n');

describe('listOpenTasks', () => {
  it('answers every blocked and unchecked line in tracker order, block bodies and done lines left out', () => {
    expect(listOpenTasks(TRACKER)).toEqual([
      { task: 'Gate on .env.local', lineNum: 3, status: 'blocked', blocker: 'needs a person' },
      { task: 'Write the helper', lineNum: 4, status: 'unchecked' },
      { task: 'Use the helper', lineNum: 9, status: 'unchecked' },
    ]);
  });

  it('answers nothing for a tracker with no open line', () => {
    expect(listOpenTasks('- [x] One\n- [x] Two\n')).toEqual([]);
  });
});

describe('findNextTask with lines to skip', () => {
  it('answers the blocked line first with nothing skipped', () => {
    expect(findNextTask(TRACKER)?.lineNum).toBe(3);
    expect(findNextTask(TRACKER, { skipLines: new Set() })?.lineNum).toBe(3);
  });

  it('passes over a skipped blocked line and answers the next open task', () => {
    expect(findNextTask(TRACKER, { skipLines: new Set([3]) })).toEqual({
      task: 'Write the helper',
      lineNum: 4,
      status: 'unchecked',
    });
  });

  it('passes over a skipped unchecked line too', () => {
    expect(findNextTask(TRACKER, { skipLines: new Set([3, 4]) })?.task).toBe('Use the helper');
  });

  it('answers a later blocked line before an unchecked one, the skipped one aside', () => {
    const tracker = '- [BLOCKED] First\n- [ ] Second\n- [BLOCKED] Third\n';

    expect(findNextTask(tracker, { skipLines: new Set([0]) })?.task).toBe('Third');
  });

  it('answers null when every open line is skipped', () => {
    expect(findNextTask(TRACKER, { skipLines: new Set([3, 4, 9]) })).toBeNull();
  });

  it('ignores a skipped line that holds no open task', () => {
    expect(findNextTask(TRACKER, { skipLines: new Set([0, 2, 7]) })?.lineNum).toBe(3);
  });
});
