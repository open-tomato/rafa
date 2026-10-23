/**
 * Tests for the long-run reading.
 *
 * Each "not flagged" case stands beside one the same reader flags: the
 * phrase in a `rafa:context` block beside the same phrase on an open
 * task line of the same plan, a ticked line beside the same line open,
 * `bun test src/plan/` beside a bare `bun test`.
 */

import { describe, expect, it } from 'bun:test';

import { parsePlan } from '@open-tomato/rafa/core/plan';
import { LONG_RUN_FIX, longRunOf, readLongRuns } from '@open-tomato/rafa-inventory/plan/risk/long-runs';

import { openTasks } from '../../../../plan/risk.js';

/** The fence marker, spelled once so no line below nests one. */
const FENCE = '```';

/** A plan holding `lines` under one stage. */
function planOf(lines: readonly string[]): string {
  return ['# Plan: planted', '', '# Stage: one', '', ...lines, ''].join('\n');
}

/** The open tasks of `text`, as `assessPlanRisk` hands them over. */
function openOf(text: string): ReturnType<typeof openTasks> {
  const model = parsePlan(text);
  return openTasks(model.tasks, model.hiddenTasks);
}

/** The 1-based line `needle` first sits on in `text`. */
function lineOf(text: string, needle: string): number {
  const index = text.split('\n').findIndex((line) => line.includes(needle));
  if (index === -1) throw new Error(`not planted: ${needle}`);
  return index + 1;
}

describe('readLongRuns: what is not read', () => {
  it('does not flag a quoted phrase inside a rafa:context block, and flags it on an open task line', () => {
    const text = planOf([
      `${FENCE}rafa:context`,
      'The close-out says "Run the full suite" and `bun test`: the runner does that.',
      FENCE,
      '',
      '- [ ] Run the full suite before the merge',
    ]);

    const findings = readLongRuns(openOf(text));

    expect(findings.map((finding) => finding.line)).toEqual([lineOf(text, '- [ ] Run the full suite')]);
  });

  it('does not flag a ticked line, and flags the same line open', () => {
    const ticked = planOf(['- [x] Run the full suite']);
    const open = planOf(['- [ ] Run the full suite']);

    expect(readLongRuns(openOf(ticked))).toEqual([]);
    expect(readLongRuns(openOf(open))).toHaveLength(1);
  });

  it('flags a blocked line, which a run resumes first', () => {
    expect(readLongRuns(openOf(planOf(['- [BLOCKED] Run the whole suite'])))).toHaveLength(1);
  });

  it('does not read a task\'s declaration', () => {
    expect(readLongRuns(openOf(planOf(['- [ ] Move the preload  {tests=full}'])))).toEqual([]);
  });
});

describe('longRunOf: what is not a whole-suite run', () => {
  it.each([
    'Check `bun test src/plan/` is green',
    'Run `bun test --changed=<base>` and read its summary',
    'Run `bun test --changed` over the diff',
    'Run `bun test ./src/plan/risk.test.ts --reporter=junit`',
    'Run `bun test --reporter=junit src/plan/`',
    'Run `bun test src/plan/ > out.txt 2>&1`',
    'Run `bunx tsc --noEmit` and `bunx eslint src/plan/`',
    'Run `bun run build` and `bun install`',
    'Say that bun test alone runs every file',
    'Fill the suite in full',
  ])('answers null for %s', (text) => {
    expect(longRunOf(text)).toBeNull();
  });
});

describe('longRunOf: what is one', () => {
  it.each([
    ['Run the full suite, `tsc` and `eslint`', '"full suite"'],
    ['Run the Full Suite once', '"Full Suite"'],
    ['Run the WHOLE  suite once', '"WHOLE  suite"'],
    ['Check `bun test` is green', '`bun test`'],
    ['Run `bun test --reporter=junit` once', '`bun test --reporter=junit`'],
    ['Run `bun test > out.txt 2>&1` and read the file', '`bun test > out.txt 2>&1`'],
    ['Run `bunx tsc --noEmit && bun test`', '`bunx tsc --noEmit && bun test`'],
    ['Run `CI=1 time bun test --bail`', '`CI=1 time bun test --bail`'],
    ['Run `bun test | tail -5`', '`bun test | tail -5`'],
  ])('reads %s as %s', (text, subject) => {
    expect(longRunOf(text)).toBe(subject);
  });

  it('names the span rather than the phrase when a line holds both', () => {
    expect(longRunOf('Run `bun test --reporter=junit` once over the full suite')).toBe('`bun test --reporter=junit`');
  });
});

describe('readLongRuns: the finding', () => {
  it('carries the kind, the level, the task, its 1-based line and the fix', () => {
    const text = planOf(['- [ ] Add the rule', '- [ ] Run the full suite, `tsc` and `eslint`  {tools=Read}']);

    expect(readLongRuns(openOf(text))).toEqual([{
      level: 'note',
      kind: 'long-run',
      text: `"full suite" — ${LONG_RUN_FIX}`,
      subject: '"full suite"',
      task: 'Run the full suite, `tsc` and `eslint`',
      line: lineOf(text, 'Run the full suite'),
    }]);
    expect(LONG_RUN_FIX).toContain('tests=full');
  });

  it('answers one finding for a task line holding several runs', () => {
    const text = planOf(['- [ ] Run `bun test`, then `bun test --bail`, then the full suite and the whole suite']);

    expect(readLongRuns(openOf(text)).map((finding) => finding.subject)).toEqual(['`bun test`']);
  });

  it('answers one finding per flagged line, in source order', () => {
    const text = planOf(['- [ ] Run `bun test`', '- [ ] Edit `src/a.ts`', '- [ ] Run the whole suite']);

    expect(readLongRuns(openOf(text)).map((finding) => finding.subject)).toEqual(['`bun test`', '"whole suite"']);
  });
});
