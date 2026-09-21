/**
 * Tests for `rafa plan list` (`list.ts`): what the plans directory
 * lists, each plan counted from its tracker when it has one and its
 * issues read from the plan itself, the rows a person reads, the json
 * result, the refusal of an argument, and the directory the registered
 * command reads.
 *
 * The plans are planted twice over: under the `.rafa/plans` default, and
 * under the `docs/plans` a config names on purpose, which is the
 * exemption `default-plan-dirs.test.ts` carves out for a test. The
 * configured case is what tells reading `plan.dir` apart from reading a
 * constant: the default directory holds nothing there.
 *
 * The in-process cases dispatch the command inside a planted project, so
 * no git runs and no real repository is read. The tracker planted for
 * `alpha` holds an issue its plan does not, and ticks its plan does not,
 * so a listing counting from the wrong file differs from the one held.
 *
 * The spawned case runs `bun src/rafa.ts plan list` from a subdirectory
 * of a scratch git repository whose plans sit under the default
 * directory at its root, with a HOME of its own. Listing that plan is
 * what reading the project root gives: the subdirectory holds no plans
 * directory, so a command reading the working directory lists nothing.
 */
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { parsePlan } from '../../plan/index.js';
import { dispatchInProject, eventsOf, plantProject, plantScratchRepo, runRafa } from '../../tests/cli-capture.js';

import planListCommand, { listPlans, renderPlanList } from './list.js';
import { plansDirAt } from './plan-files.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-plan-list-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long the spawned case may run. */
const SPAWN_TIMEOUT = 30_000;

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'plan', summary: 'plans' }];

/** A plan with one stage, every task open. */
const ALPHA_PLAN = ['# Plan: alpha', '', '# Stage: one', '', '- [ ] first', '- [ ] second', '- [ ] third', ''].join('\n');

/** Its tracker: one task ticked, one blocked, and a second plan context the parser reports. */
const ALPHA_TRACKER = [
  '# Plan: alpha',
  '',
  '```rafa:context',
  'once',
  '```',
  '',
  '```rafa:context',
  'twice',
  '```',
  '',
  '# Stage: one',
  '',
  '- [x] first',
  '- [BLOCKED] second',
  '- [ ] third',
  '',
].join('\n');

/** A plan with one ticked task, then a block never closed with an open task line inside it. */
const B_PLAN = ['# Plan: b', '', '- [x] loose', '', '```rafa:context', 'never closed', '- [ ] inside the block', ''].join('\n');

/** The plans directory a project whose config sets no `plan.dir` reads. */
const DEFAULT_DIR = join('.rafa', 'plans');

/** The plans directory the configured cases name, and the config naming it. */
const CONFIGURED_DIR = 'docs/plans';
const CONFIGURED_CONFIG = `plan:\n  dir: ${CONFIGURED_DIR}\n`;

/** What text mode writes for {@link plantPlans} under `dir`. */
function expectedRows(dir: string): string[] {
  return [
    `Plans in ${dir}/:`,
    '  alpha   1/3 done, 1 blocked, 1 open',
    '  b       1/1 done, 0 blocked, 0 open; no tracker; 2 issues',
  ];
}

/** A fresh root holding `files`, by path relative to it, and the directories `dirs` names. */
function plantFiles(root: string, files: Readonly<Record<string, string>>, dirs: readonly string[] = []): string {
  for (const dir of dirs) mkdirSync(join(root, dir), { recursive: true });
  for (const [relative, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, relative)), { recursive: true });
    writeFileSync(join(root, relative), text, 'utf8');
  }
  return root;
}

/** Two plans under `dir`, one tracked, beside every name the list skips. */
function plantPlans(root: string, dir: string): string {
  return plantFiles(root, {
    [`${dir}/PLAN-b.md`]: B_PLAN,
    [`${dir}/PLAN-alpha.md`]: ALPHA_PLAN,
    [`${dir}/PLAN_TRACKER-alpha.md`]: ALPHA_TRACKER,
    [`${dir}/PLAN_TRACKER-orphan.md`]: ALPHA_TRACKER,
    [`${dir}/PLAN.md`]: ALPHA_PLAN,
    [`${dir}/PLAN-no stub.md`]: ALPHA_PLAN,
    [`${dir}/notes.md`]: 'notes\n',
  }, [`${dir}/PLAN-folder.md`]);
}

/** A fresh directory of this file's own. */
function freshRoot(): string {
  return mkdtempSync(join(tempBase, 'root-'));
}

/** A project of this file's own, its config `text` unless it is left out. */
function freshProject(text?: string): PlantedProject {
  const scope = mkdtempSync(join(tempBase, 'scope-'));
  return text === undefined
    ? plantProject(scope)
    : plantProject(scope, text);
}

describe('what rafa plan list lists', () => {
  it('lists nothing where the plans directory does not exist', () => {
    const root = freshRoot();

    expect(listPlans(plansDirAt(root, DEFAULT_DIR))).toEqual({ dir: join(root, DEFAULT_DIR), plans: [] });
  });

  it.each([
    ['the default directory', DEFAULT_DIR],
    ['a configured directory', CONFIGURED_DIR],
  ])('lists each plan in %s in stub order, counting its tasks from its tracker when it has one and its issues from the plan', (_name, dir) => {
    const root = plantPlans(freshRoot(), dir);
    const plans = plansDirAt(root, dir);

    expect(parsePlan(ALPHA_TRACKER).issues.map((issue) => issue.reason)).toEqual(['duplicate-block']);
    expect(parsePlan(B_PLAN).issues.map((issue) => issue.reason)).toEqual(['unclosed-block', 'task-in-block']);
    expect(listPlans(plans)).toEqual({
      dir: plans.path,
      plans: [
        {
          stub: 'alpha',
          plan: join(plans.path, 'PLAN-alpha.md'),
          tracker: join(plans.path, 'PLAN_TRACKER-alpha.md'),
          tasks: { total: 3, done: 1, blocked: 1, open: 1 },
          issues: 0,
        },
        {
          stub: 'b',
          plan: join(plans.path, 'PLAN-b.md'),
          tracker: null,
          tasks: { total: 1, done: 1, blocked: 0, open: 0 },
          issues: 2,
        },
      ],
    });
    // The other directory is what a reader of a constant would have read.
    const other = dir === DEFAULT_DIR
      ? CONFIGURED_DIR
      : DEFAULT_DIR;
    expect(listPlans(plansDirAt(root, other)).plans).toEqual([]);
  });

  it('renders one row per plan with the stubs padded to one column, and one line for no plans', () => {
    const root = plantPlans(freshRoot(), DEFAULT_DIR);

    expect(renderPlanList(listPlans(plansDirAt(root, DEFAULT_DIR)), DEFAULT_DIR)).toEqual(expectedRows(DEFAULT_DIR));
    expect(renderPlanList({ dir: '/nowhere', plans: [] }, CONFIGURED_DIR)).toEqual([`No plans in ${CONFIGURED_DIR}/.`]);
  });
});

describe('rafa plan list, dispatched', () => {
  it('prints the rows of the default directory in text mode', async () => {
    const project = freshProject();
    plantPlans(project.root, DEFAULT_DIR);
    const run = await dispatchInProject(['plan', 'list'], SUBJECTS, [planListCommand], project);

    expect(run).toEqual({ exitCode: 0, stdout: `${expectedRows(DEFAULT_DIR).join('\n')}\n`, stderr: '' });
  });

  it('reads the directory plan.dir names, where the default directory holds nothing', async () => {
    const project = freshProject(CONFIGURED_CONFIG);
    plantPlans(project.root, CONFIGURED_DIR);
    const run = await dispatchInProject(['plan', 'list'], SUBJECTS, [planListCommand], project);

    expect(run).toEqual({ exitCode: 0, stdout: `${expectedRows(CONFIGURED_DIR).join('\n')}\n`, stderr: '' });
    expect(listPlans(plansDirAt(project.root, DEFAULT_DIR)).plans).toEqual([]);
  });

  it('gives the list as the data of the one result event in json mode', async () => {
    const project = freshProject(CONFIGURED_CONFIG);
    plantPlans(project.root, CONFIGURED_DIR);
    const run = await dispatchInProject(['plan', 'list', '--output=json'], SUBJECTS, [planListCommand], project);
    const events = eventsOf(run.stdout);
    const listed = listPlans(plansDirAt(project.root, CONFIGURED_DIR));

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(events[0]).toMatchObject({ type: 'start', command: 'plan list' });
    expect(events[1]).toMatchObject({ type: 'result', ok: true, data: JSON.parse(JSON.stringify(listed)) as unknown });
  });

  it('refuses an argument before the config is read, which this project\'s config would be refused for', async () => {
    const project = freshProject('plan:\n  dir: ""\n');
    const words = ['plan', 'list', 'alpha'];
    const run = await dispatchInProject(words, SUBJECTS, [planListCommand], project);

    expect(run).toEqual({ exitCode: 1, stdout: '', stderr: '❌ Expected no argument, got 1: alpha\nUsage: rafa plan list\n' });
    // The control: without the argument, that config is what refuses the line.
    const refused = await dispatchInProject(['plan', 'list'], SUBJECTS, [planListCommand], project);
    expect([refused.exitCode, refused.stderr.split('\n')[0]]).toEqual([1, '❌ rafa plan list: the config cannot be used:']);
  });
});

describe('rafa plan list, spawned', () => {
  it('reads the default plans directory at the project root when run from a subdirectory of the repository', () => {
    const scratch = plantScratchRepo(tempBase);
    mkdirSync(join(scratch.repo, DEFAULT_DIR), { recursive: true });
    writeFileSync(join(scratch.repo, DEFAULT_DIR, 'PLAN-alpha.md'), ALPHA_PLAN, 'utf8');
    mkdirSync(join(scratch.repo, 'sub'));

    const run = runRafa(scratch, join(scratch.repo, 'sub'), ['plan', 'list', '--output=json']);
    const events = eventsOf(run.stdout);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(events[1]).toMatchObject({
      type: 'result',
      ok: true,
      data: { dir: join(scratch.repo, DEFAULT_DIR), plans: [{ stub: 'alpha', tracker: null }] },
    });
  }, SPAWN_TIMEOUT);
});
