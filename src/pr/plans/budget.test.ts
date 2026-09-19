/**
 * Tests for the resolve budget written into a pinned plan
 * (`src/pr/plans/budget.ts`).
 *
 * Every case is a pure call over literals: the module reads no file,
 * spawns nothing and takes no clock.
 *
 * ## What the cases are FOR
 *
 * Three ways this can be wrong quietly, each with the control that
 * would have caught it:
 *
 *  - A SECOND block. `- [ ] Do it {agent=x} {budget=2}` looks filled
 *    and routes nowhere, because `parseTaskDeclaration` reads the last
 *    block alone and leaves `{agent=x}` inside the task text. So the
 *    joining case does not assert the text it expects and stop there:
 *    it hands the rewritten line to `parseTaskDeclaration` and asserts
 *    the agent AND the budget come back off one declaration.
 *  - A budget that never reaches the CLI. `String(1e-7)` is `1e-7`,
 *    which the declaration reader drops as an unusable value, leaving a
 *    session uncapped — a silent pass. The refusal case drives that
 *    amount, and its control is the same amount written as a decimal
 *    the grammar accepts, which comes through.
 *  - Rewriting a line that is no task. The untouched case asserts a
 *    whole plan of headings, prose and a fenced block comes back byte
 *    for byte, so a loosened line pattern reddens here.
 *
 * The end-to-end case runs over the plan that actually ships: the
 * lockfile plan, filled and budgeted, is handed to `parsePlan` and held
 * to no issues and to a budget on every task it answers.
 */
import type { TriageBlock } from '../triage/comment.js';

import { describe, expect, test } from 'bun:test';

import { parsePlan } from '../../plan/parse.js';
import { parseTaskDeclaration } from '../../utils/declaration.js';

import { budgetEntry, BUDGET_KEY, withTaskBudget } from './budget.js';
import { loadPinnedPlan } from './load.js';

/** A triage block as a lockfile conflict stores one. */
const BLOCK: TriageBlock = {
  head: 'a'.repeat(40),
  at: '2026-09-19T09:00:00Z',
  class: 'conflict-lockfile',
  simple: true,
  attempts: 0,
  files: ['bun.lock'],
};

describe('budgetEntry', () => {
  test('writes the entry the loop reads a session budget from', () => {
    expect(budgetEntry(2)).toBe('budget=2');
    expect(budgetEntry(1.25)).toBe('budget=1.25');
  });

  test('refuses an amount String would write with an exponent, where a decimal comes through', () => {
    expect(() => budgetEntry(1e-7)).toThrow('refused an amount of 1e-7');

    expect(budgetEntry(0.000001)).toBe('budget=0.000001');
  });

  test('refuses zero and a negative amount, which no session could run under', () => {
    expect(() => budgetEntry(0)).toThrow('expected US dollars above zero');
    expect(() => budgetEntry(-2)).toThrow('refused an amount of -2');
  });
});

describe('withTaskBudget', () => {
  test('joins the budget onto a declaration already there, as one block', () => {
    const line = withTaskBudget('- [ ] Repair the install {agent=build-error-resolver}', 2);

    expect(line).toBe('- [ ] Repair the install {agent=build-error-resolver budget=2}');
    const parsed = parseTaskDeclaration(line.slice('- [ ] '.length));
    expect(parsed.text).toBe('Repair the install');
    expect(parsed.declaration?.agent).toBe('build-error-resolver');
    expect(parsed.declaration?.budget).toBe(2);
  });

  test('gives a task line carrying no declaration one', () => {
    expect(withTaskBudget('- [ ] Merge the base', 2)).toBe('- [ ] Merge the base {budget=2}');
  });

  test('leaves a task line that declares its own budget alone', () => {
    const line = '- [ ] Repair the install {agent=build-error-resolver budget=0.5}';

    expect(withTaskBudget(line, 2)).toBe(line);
  });

  test('rewrites a blocked and a done task line as it rewrites an open one', () => {
    expect(withTaskBudget('- [BLOCKED] Retry it\n- [x] Done it', 2)).toBe(
      '- [BLOCKED] Retry it {budget=2}\n- [x] Done it {budget=2}',
    );
  });

  test('leaves every line that is no task line byte-identical', () => {
    const plan = [
      '# Plan: Resolve',
      '',
      '```rafa:plan',
      'stub: resolve-conflict-lockfile',
      '```',
      '',
      'Prose about - [ ] a task, indented next:',
      '  - [ ] an indented line, which is no flat task',
      '',
      '# Stage: Resolve',
    ].join('\n');

    expect(withTaskBudget(plan, 2)).toBe(plan);
  });

  test('refuses the whole plan when the amount is one the loop could not pass on', () => {
    expect(() => withTaskBudget('- [ ] Merge the base', 1e-7)).toThrow(BUDGET_KEY);
  });
});

describe('the plan that ships', () => {
  test('parses with no issue and carries the budget on every task it answers', () => {
    const filled = withTaskBudget(loadPinnedPlan('conflict-lockfile', { block: BLOCK }), 1.5);

    const plan = parsePlan(filled);
    expect(plan.issues).toEqual([]);
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(plan.tasks.map((task) => task.declaration?.budget)).toEqual(plan.tasks.map(() => 1.5));
  });
});
