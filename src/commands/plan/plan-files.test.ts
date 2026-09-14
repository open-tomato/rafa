/**
 * Tests for what the plan commands share (`plan-files.ts`): the task
 * counts and their phrase, the file a stub names and the stub a file name
 * carries, what is read as a file, one issue as a line, and the refusal of
 * a line handing a command the wrong number of arguments.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../../cli/command.js';

import {
  checkbox,
  countTasks,
  expectNoArgument,
  expectOneArgument,
  formatCounts,
  isFile,
  issueLine,
  planFileName,
  PLANS_DIR,
  plural,
  stubOfPlanFile,
} from './plan-files.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-plan-files-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** What `run` threw, as its exit code and message for a `CommandExit`, or undefined when it returned. */
function exitOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error instanceof CommandExit
      ? { exitCode: error.exitCode, message: error.message }
      : error;
  }
  return undefined;
}

describe('the task counts', () => {
  it('counts each checkbox, the open tasks being the rest', () => {
    const statuses = ['done', 'unchecked', 'blocked', 'done', 'unchecked', 'unchecked'] as const;

    expect(countTasks(statuses.map((status) => ({ status })))).toEqual({ total: 6, done: 2, blocked: 1, open: 3 });
    expect(countTasks([])).toEqual({ total: 0, done: 0, blocked: 0, open: 0 });
  });

  it('phrases the counts as done out of the total, then blocked and open', () => {
    expect(formatCounts({ total: 6, done: 2, blocked: 1, open: 3 })).toBe('2/6 done, 1 blocked, 3 open');
  });

  it('writes each checkbox as the checklist does', () => {
    expect([checkbox('unchecked'), checkbox('blocked'), checkbox('done')]).toEqual(['[ ]', '[BLOCKED]', '[x]']);
  });
});

describe('the plan files', () => {
  it('reads plans from .plans, naming the plan and the tracker of a stub', () => {
    expect([PLANS_DIR, planFileName('my-plan', false), planFileName('my-plan', true)])
      .toEqual(['.plans', 'PLAN-my-plan.md', 'PLAN_TRACKER-my-plan.md']);
  });

  it.each([
    ['PLAN-my-plan.md', 'my-plan'],
    ['PLAN-phase-1.v2_b.md', 'phase-1.v2_b'],
    ['PLAN_TRACKER-my-plan.md', null],
    ['PLAN.md', null],
    ['PLAN-.md', null],
    ['PLAN-my plan.md', null],
    ['PLAN-my-plan.md.bak', null],
    ['notes.md', null],
  ])('reads the stub of %s as %j', (name, stub) => {
    expect(stubOfPlanFile(name)).toBe(stub);
  });

  it('reads a file and a link to one as files, and a directory, a link to one and a missing path as none', () => {
    const dir = mkdtempSync(join(tempBase, 'files-'));
    writeFileSync(join(dir, 'plan.md'), '- [ ] a\n', 'utf8');
    mkdirSync(join(dir, 'folder.md'));
    symlinkSync(join(dir, 'plan.md'), join(dir, 'link.md'));
    symlinkSync(join(dir, 'folder.md'), join(dir, 'folder-link.md'));

    expect(['plan.md', 'link.md', 'folder.md', 'folder-link.md', 'missing.md'].map((name) => isFile(join(dir, name))))
      .toEqual([true, true, false, false, false]);
  });
});

describe('issues and counts in prose', () => {
  it('writes an issue as the file, the line, the reason and the text', () => {
    expect(issueLine('.plans/PLAN-a.md', { reason: 'unclosed-block', line: 9, text: 'never closed' }))
      .toBe('.plans/PLAN-a.md:9: unclosed-block: never closed');
  });

  it('adds an s to the noun unless the count is one', () => {
    expect([plural(0, 'issue'), plural(1, 'issue'), plural(2, 'issue')]).toEqual(['0 issues', '1 issue', '2 issues']);
  });
});

describe('the argument refusals', () => {
  it('passes a command reading no argument a line handing none, and refuses one handing any', () => {
    expect(exitOf(() => expectNoArgument([], 'rafa plan list'))).toBeUndefined();
    expect(exitOf(() => expectNoArgument(['a', 'b'], 'rafa plan list'))).toEqual({
      exitCode: 1,
      message: '❌ Expected no argument, got 2: a b\nUsage: rafa plan list',
    });
  });

  it('answers the one argument of a line handing exactly one, and refuses a line handing none or two', () => {
    expect(expectOneArgument(['my-plan'], 'rafa plan show <stub>')).toBe('my-plan');
    expect(exitOf(() => expectOneArgument([], 'rafa plan show <stub>'))).toEqual({
      exitCode: 1,
      message: '❌ Expected one argument, got none\nUsage: rafa plan show <stub>',
    });
    expect(exitOf(() => expectOneArgument(['a', 'b'], 'rafa plan show <stub>'))).toEqual({
      exitCode: 1,
      message: '❌ Expected one argument, got 2: a b\nUsage: rafa plan show <stub>',
    });
  });
});
