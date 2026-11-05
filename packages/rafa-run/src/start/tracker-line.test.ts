/**
 * Tests for the task prompt's tracker line (`tracker-line.ts`): no line
 * for no path, a relative path refused as a programming error, and an
 * absolute path named in full on one line with where the close-out
 * notes go. Where `buildTaskPrompt` places the line, and `dispatchTask`
 * handing it to the runner, are driven in `dispatch.test.ts`.
 */

import { describe, expect, it } from 'bun:test';

import { TRACKER_PROMPT_PREFIX, trackerLines } from './tracker-line.js';

describe('trackerLines, naming the tracker that holds the task\'s line', () => {
  const TRACKER = '/home/dev/project/.rafa/plans/PLAN_TRACKER-widget.md';

  it('answers no line for no path', () => {
    expect(trackerLines(null)).toEqual([]);
  });

  it('refuses a relative path as a programming error, against the absolute one it takes', () => {
    expect(() => trackerLines('.rafa/plans/PLAN_TRACKER-widget.md')).toThrow('is not absolute');
    expect(() => trackerLines('PLAN_TRACKER.md')).toThrow('is not absolute');
    expect(() => trackerLines(TRACKER)).not.toThrow();
  });

  it('names an absolute path in full on one line, with where the notes go', () => {
    const lines = trackerLines(TRACKER);
    const line = lines[0] ?? '';

    expect(lines).toHaveLength(1);
    expect(line).not.toContain('\n');
    expect(line.startsWith(TRACKER_PROMPT_PREFIX)).toBe(true);
    expect(line).toContain(`\`${TRACKER}\``);
    expect(line).toContain('indented below this task\'s line');
    expect(line).toContain('never as a `- [ ]` line');
    expect(line).toContain('never above this task\'s line');
  });

  it('opens with the loop\'s words, never a stamp or a task line', () => {
    const line = trackerLines(TRACKER)[0] ?? '';

    expect(line).not.toMatch(/^- \[/);
    expect(line).not.toContain('<!-- ralph:plan=');
  });
});
