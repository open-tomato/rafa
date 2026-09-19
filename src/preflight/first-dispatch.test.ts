/**
 * Tests for the first-dispatch reading (`src/preflight/first-dispatch.ts`).
 *
 * {@link hasTickedTask} is read off text; {@link isFirstDispatch} is read
 * off a real tracker written beside a real plan under the case's own
 * temporary directory, and each of its cases asserts the path it names
 * resolves under that directory.
 *
 * A reading that could pass on a function answering a constant sits
 * beside a control proving the fixture could have failed it: the
 * tick-less tracker beside the same tracker with one box ticked; the
 * absent tracker beside the ticked one at the path the plan derives; the
 * ticked line inside a closed `rafa:report` block beside the same block
 * left unclosed, and beside the same lines with no block around them at
 * all; each rejected spelling of a box beside the accepted one.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { hasTickedTask, isFirstDispatch } from './first-dispatch.js';

/** A checklist of two open tasks, as a fresh tracker holds one. */
const OPEN_TRACKER = [
  '# Stage: start-tag',
  '',
  '- [ ] the first task',
  '- [ ] the second task',
  '',
].join('\n');

/** The same checklist with its first task ticked, as the loop leaves one. */
const TICKED_TRACKER = OPEN_TRACKER.replace('- [ ] the first task', '- [x] the first task');

describe('hasTickedTask', () => {
  it('answers false for a tracker whose every box is open', () => {
    expect(hasTickedTask(OPEN_TRACKER)).toBe(false);
  });

  it('answers true for a tracker holding one ticked task', () => {
    expect(hasTickedTask(TICKED_TRACKER)).toBe(true);
  });

  it('answers false for a tracker holding only blocked tasks', () => {
    const blocked = OPEN_TRACKER.replace('- [ ] the first task', '- [BLOCKED] the first task');

    expect(hasTickedTask(blocked)).toBe(false);
  });

  it('answers false for text holding no checklist at all', () => {
    expect(hasTickedTask('# Stage: start-tag\n\nprose and nothing else\n')).toBe(false);
  });

  it('answers false for the empty document', () => {
    expect(hasTickedTask('')).toBe(false);
  });

  it('reads an uppercase box as a tick, as it reads a lowercase one', () => {
    expect(hasTickedTask('- [X] ticked by hand\n')).toBe(true);
    expect(hasTickedTask('- [x] ticked by hand\n')).toBe(true);
  });

  it('reads an indented ticked line as no tick, where the same line at column 0 is one', () => {
    expect(hasTickedTask('  - [x] an example in prose\n')).toBe(false);
    expect(hasTickedTask('- [x] an example in prose\n')).toBe(true);
  });

  it('reads a box with nothing after it as no tick, where the same box with text is one', () => {
    expect(hasTickedTask('- [x]\n')).toBe(false);
    expect(hasTickedTask('- [x] a task\n')).toBe(true);
  });

  it('reads a ticked line inside a closed rafa block as body, not as a tick', () => {
    const body = [
      'feedback: |',
      '  the checklist I read said:',
      '- [x] an earlier task',
      '',
    ].join('\n');
    const quoted = `- [ ] the only task\n\n\`\`\`rafa:report\n${body}\`\`\`\n`;

    expect(hasTickedTask(quoted)).toBe(false);
    expect(hasTickedTask(`- [ ] the only task\n\n${body}`)).toBe(true);
  });

  it('reads a ticked line under an unclosed rafa fence as a tick', () => {
    const unclosed = [
      '```rafa:report',
      'feedback: |',
      '  a session that never closed its block',
      '',
      '- [x] the first task',
      '- [ ] the second task',
      '',
    ].join('\n');

    expect(hasTickedTask(unclosed)).toBe(true);
  });
});

describe('isFirstDispatch', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rafa-first-dispatch-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** The plan path this case's tracker is derived from. */
  function planPath(): string {
    const path = join(dir, '.plans', 'PLAN-demo.md');
    const outside = isAbsolute(path) && relative(dir, path).startsWith('..');
    expect(outside).toBe(false);
    mkdirSync(join(dir, '.plans'), { recursive: true });
    writeFileSync(path, OPEN_TRACKER, 'utf8');
    return path;
  }

  /** Writes `content` to the tracker beside `plan`, and answers its path. */
  function writeTracker(plan: string, content: string): string {
    const path = join(dir, '.plans', 'PLAN_TRACKER-demo.md');
    expect(plan.endsWith('PLAN-demo.md')).toBe(true);
    writeFileSync(path, content, 'utf8');
    return path;
  }

  it('answers true when no tracker sits beside the plan', () => {
    const plan = planPath();

    expect(isFirstDispatch(plan)).toBe(true);
  });

  it('answers true when the tracker beside the plan holds no ticked task', () => {
    const plan = planPath();
    writeTracker(plan, OPEN_TRACKER);

    expect(isFirstDispatch(plan)).toBe(true);
  });

  it('answers false when the tracker beside the plan holds a ticked task', () => {
    const plan = planPath();
    const tracker = writeTracker(plan, TICKED_TRACKER);

    expect(relative(dir, tracker).startsWith('..')).toBe(false);
    expect(isFirstDispatch(plan)).toBe(false);
  });

  it('reads the tracker and not the plan, a ticked plan beside a tick-less tracker', () => {
    const plan = planPath();
    writeFileSync(plan, TICKED_TRACKER, 'utf8');
    writeTracker(plan, OPEN_TRACKER);

    expect(isFirstDispatch(plan)).toBe(true);
  });

  it('answers true when the tracker path is a directory and cannot be read', () => {
    const plan = planPath();
    mkdirSync(join(dir, '.plans', 'PLAN_TRACKER-demo.md'));

    expect(isFirstDispatch(plan)).toBe(true);
  });
});
