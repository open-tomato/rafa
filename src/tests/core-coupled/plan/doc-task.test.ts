/**
 * Tests for the closing doc task check (`doc-task.ts`) and its wiring
 * into `validatePlan` (`validate.ts`).
 *
 * The fixtures are one plan of three code tasks with the fourth, the
 * closing `agent=doc-updater docs=repair` task, the same plan without
 * it, and a plan of prose tasks only. The warning read on the second
 * stands beside the first, which differs from it in the fourth line
 * alone, so a check that warned about every plan would fail there; the
 * prose-only plan has no `docs=repair` line either, so a check that
 * warned on any plan lacking one would fail on it.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { docTaskWarnings, isProseOnly } from '@open-tomato/rafa/plan/doc-task';
import { validatePlan } from '@open-tomato/rafa/plan/validate';

import { parsePlan } from '../../../plan/index.js';

/** A temporary directory of this file's own. */
const tempBase = mkdtempSync(join(tmpdir(), 'rafa-doc-task-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The three code tasks, from line 5 to line 7. */
const CODE_TASKS = [
  '# Plan: three code tasks',
  '',
  '# Stage: code',
  '',
  '- [x] Add the reader  {agent=loop-implementer effort=medium}',
  '- [ ] Wire the reader  {agent=loop-implementer}',
  '- [ ] Test the reader end to end  {agent=tdd-guide tests=full}',
];

/** The closing doc task, at line 8. */
const DOC_TASK = '- [ ] Repair the docs of what the plan changed  {agent=doc-updater docs=repair}';

/** A document of `lines`, ending in a newline. */
function documentOf(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}

/** Three code tasks and the closing doc task. */
const WITH_DOC_TASK = documentOf([...CODE_TASKS, DOC_TASK]);

/** The same three code tasks, with no closing doc task. */
const WITHOUT_DOC_TASK = documentOf(CODE_TASKS);

/** Prose tasks only, none declaring `docs=repair`. */
const PROSE_ONLY = documentOf([
  '# Plan: prose',
  '',
  '# Stage: pages',
  '',
  '- [ ] Rewrite the triage page  {agent=doc-updater}',
  '- [ ] Rewrite the workflow page  {agent=doc-updater effort=low}',
]);

describe('docTaskWarnings', () => {
  it('is silent for three code tasks closed by a docs=repair task', () => {
    expect(docTaskWarnings(parsePlan(WITH_DOC_TASK))).toEqual([]);
  });

  it('warns missing-doc-task on the last task line of the same plan without it', () => {
    const warnings = docTaskWarnings(parsePlan(WITHOUT_DOC_TASK));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ reason: 'missing-doc-task', line: 7 });
    expect(warnings[0]?.text).toContain('`agent=doc-updater docs=repair`');
  });

  it('is silent for a plan of prose tasks only, which carries no docs=repair line', () => {
    expect(docTaskWarnings(parsePlan(PROSE_ONLY))).toEqual([]);
  });

  it('warns when the last line is a doc-updater task without docs=repair after code tasks', () => {
    const plan = documentOf([...CODE_TASKS, '- [ ] Touch up a page  {agent=doc-updater}']);

    expect(docTaskWarnings(parsePlan(plan))).toMatchObject([{ reason: 'missing-doc-task', line: 8 }]);
  });

  it('warns when docs=repair sits on a task other than the last', () => {
    const plan = documentOf([...CODE_TASKS.slice(0, 5), DOC_TASK, ...CODE_TASKS.slice(5)]);

    expect(docTaskWarnings(parsePlan(plan))).toMatchObject([{ reason: 'missing-doc-task', line: 8 }]);
  });

  it('counts a task with no declaration as a code task', () => {
    const plan = documentOf(['# Plan: bare', '', '- [ ] Do a thing']);

    expect(docTaskWarnings(parsePlan(plan))).toMatchObject([{ reason: 'missing-doc-task', line: 3 }]);
  });

  it('is silent for a plan with no task line', () => {
    expect(docTaskWarnings(parsePlan(documentOf(['# Plan: empty', ''])))).toEqual([]);
  });
});

describe('isProseOnly', () => {
  it('holds for prose tasks only and fails once one code task is among them', () => {
    expect(isProseOnly(parsePlan(PROSE_ONLY).tasks)).toBe(true);
    expect(isProseOnly(parsePlan(WITH_DOC_TASK).tasks)).toBe(false);
  });
});

describe('validatePlan, warnings', () => {
  it('answers the warning beside no issue, and none for the plan with its doc task', () => {
    const without = join(tempBase, 'without.md');
    const withTask = join(tempBase, 'with.md');
    const prose = join(tempBase, 'prose.md');
    writeFileSync(without, WITHOUT_DOC_TASK, 'utf8');
    writeFileSync(withTask, WITH_DOC_TASK, 'utf8');
    writeFileSync(prose, PROSE_ONLY, 'utf8');

    const warned = validatePlan(without);

    expect(warned.issues).toEqual([]);
    expect(warned.warnings).toMatchObject([{ reason: 'missing-doc-task', line: 7 }]);
    expect(validatePlan(withTask).warnings).toEqual([]);
    expect(validatePlan(prose).warnings).toEqual([]);
  });
});
