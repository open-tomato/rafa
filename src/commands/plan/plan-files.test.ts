/**
 * Tests for what the plan commands share (`plan-files.ts`): where plans
 * sit, the task counts and their phrase, the file a stub names and the
 * stub a file name carries, what is read as a file, one issue as a line,
 * and the refusal of a line handing a command the wrong number of
 * arguments.
 *
 * The directory cases plant a project of their own and read `plan.dir`
 * back off it: one whose config sets none, which is the `.rafa/plans`
 * default, and one whose config names `docs/plans` on purpose, which is
 * the exemption `default-plan-dirs.test.ts` carves out for a test. The
 * refusal case plants a config the loader cannot use at all.
 */
import type { ProjectFound } from '../../project/scope.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../../cli/command.js';
import { CONFIG_DEFAULTS } from '../../config.js';
import { scopeAt } from '../../project/scope.js';
import { plantProjectConfig } from '../../tests/cli-capture.js';

import {
  checkbox,
  countTasks,
  expectNoArgument,
  expectOneArgument,
  formatCounts,
  isFile,
  issueLine,
  planFileName,
  plansDirAt,
  plural,
  resolvePlansDir,
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

/** A project rooted at a fresh directory under `tempBase`, its config `text` unless it is left out. */
function plantProject(text?: string): ProjectFound {
  const root = mkdtempSync(join(tempBase, 'project-'));
  const home = mkdtempSync(join(tempBase, 'home-'));
  if (text === undefined) plantProjectConfig(root);
  else plantProjectConfig(root, text);
  return { found: true, root, home, project: scopeAt(root), user: scopeAt(home) };
}

/** What a resolution warned about, collected. */
function warningsOf(): { warn: (message: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { warn: (message: string) => lines.push(message), lines };
}

describe('where plans sit', () => {
  it('resolves the default directory for a project whose config sets no plan.dir', () => {
    const project = plantProject();
    const warnings = warningsOf();

    expect(CONFIG_DEFAULTS.planDir).toBe(join('.rafa', 'plans'));
    expect(resolvePlansDir(project, 'rafa plan list', warnings.warn)).toEqual({
      label: join('.rafa', 'plans'),
      path: join(project.root, '.rafa', 'plans'),
    });
    expect(warnings.lines).toEqual([]);
  });

  it('resolves the directory a config names, which is where the default case would have read none', () => {
    const project = plantProject('plan:\n  dir: docs/plans\n');
    const warnings = warningsOf();

    expect(resolvePlansDir(project, 'rafa plan list', warnings.warn)).toEqual({
      label: 'docs/plans',
      path: join(project.root, 'docs', 'plans'),
    });
    expect(warnings.lines).toEqual([]);
  });

  it('resolves an absolute plan.dir as itself, the project root unread', () => {
    const project = plantProject('plan:\n  dir: /tmp/rafa-plans-elsewhere\n');

    expect(resolvePlansDir(project, 'rafa plan list', () => undefined))
      .toEqual({ label: '/tmp/rafa-plans-elsewhere', path: '/tmp/rafa-plans-elsewhere' });
  });

  it('refuses a config the loader will not give with exit code 1, naming the command and the problem', () => {
    const project = plantProject('plan:\n  dir: ""\n');

    expect(exitOf(() => resolvePlansDir(project, 'rafa plan show', () => undefined))).toEqual({
      exitCode: 1,
      message: [
        '❌ rafa plan show: the config cannot be used:',
        `   ${join(project.root, '.rafa', 'config.yaml')}: plan.dir is "", expected a directory path`,
      ].join('\n'),
    });
  });

  it('carries both spellings of a directory, the path resolved against the project root', () => {
    expect(plansDirAt('/project', 'plans')).toEqual({ label: 'plans', path: '/project/plans' });
  });
});

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
  it('names the plan and the tracker of a stub', () => {
    expect([planFileName('my-plan', false), planFileName('my-plan', true)])
      .toEqual(['PLAN-my-plan.md', 'PLAN_TRACKER-my-plan.md']);
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
    expect(issueLine('.rafa/plans/PLAN-a.md', { reason: 'unclosed-block', line: 9, text: 'never closed' }))
      .toBe('.rafa/plans/PLAN-a.md:9: unclosed-block: never closed');
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
