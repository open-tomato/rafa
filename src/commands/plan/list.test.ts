/**
 * Tests for `rafa plan list` (`list.ts`): what a `.plans/` directory
 * lists, each plan counted from its tracker when it has one and its
 * issues read from the plan itself, the rows a person reads, the json
 * result, the refusal of an argument, and the git root the registered
 * command reads.
 *
 * The in-process cases dispatch the command made over a planted root, so
 * no git runs and no real repository is read. The tracker planted for
 * `alpha` holds an issue its plan does not, and ticks its plan does not,
 * so a listing counting from the wrong file differs from the one held.
 *
 * The spawned case runs `bun src/rafa.ts plan list` from a subdirectory
 * of a scratch git repository whose `.plans/` sits at its root, with a
 * HOME of its own. Listing that plan is what reading the git root gives:
 * the subdirectory holds no `.plans/`, so a command reading the working
 * directory lists nothing.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { parsePlan } from '../../plan/index.js';
import { dispatchCaptured, eventsOf, plantScratchRepo, runRafa } from '../../tests/cli-capture.js';

import { createPlanListCommand, listPlans, renderPlanList } from './list.js';

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

/** What text mode writes for {@link plantPlans}. */
const EXPECTED_ROWS = [
  'Plans in .plans/:',
  '  alpha   1/3 done, 1 blocked, 1 open',
  '  b       1/1 done, 0 blocked, 0 open; no tracker; 2 issues',
];

/** A fresh root holding `files`, by path relative to it, and the directories `dirs` names. */
function plantRoot(files: Readonly<Record<string, string>>, dirs: readonly string[] = []): string {
  const root = mkdtempSync(join(tempBase, 'root-'));
  for (const dir of dirs) mkdirSync(join(root, dir), { recursive: true });
  for (const [relative, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, relative)), { recursive: true });
    writeFileSync(join(root, relative), text, 'utf8');
  }
  return root;
}

/** Two plans, one tracked, beside every name the list skips. */
function plantPlans(): string {
  return plantRoot({
    '.plans/PLAN-b.md': B_PLAN,
    '.plans/PLAN-alpha.md': ALPHA_PLAN,
    '.plans/PLAN_TRACKER-alpha.md': ALPHA_TRACKER,
    '.plans/PLAN_TRACKER-orphan.md': ALPHA_TRACKER,
    '.plans/PLAN.md': ALPHA_PLAN,
    '.plans/PLAN-no stub.md': ALPHA_PLAN,
    '.plans/notes.md': 'notes\n',
  }, ['.plans/PLAN-folder.md']);
}

describe('what rafa plan list lists', () => {
  it('lists nothing where there is no .plans directory', () => {
    const root = plantRoot({});

    expect(listPlans(root)).toEqual({ dir: join(root, '.plans'), plans: [] });
  });

  it('lists each plan in stub order, counting its tasks from its tracker when it has one and its issues from the plan', () => {
    const root = plantPlans();
    const dir = join(root, '.plans');

    expect(parsePlan(ALPHA_TRACKER).issues.map((issue) => issue.reason)).toEqual(['duplicate-block']);
    expect(parsePlan(B_PLAN).issues.map((issue) => issue.reason)).toEqual(['unclosed-block', 'task-in-block']);
    expect(listPlans(root)).toEqual({
      dir,
      plans: [
        {
          stub: 'alpha',
          plan: join(dir, 'PLAN-alpha.md'),
          tracker: join(dir, 'PLAN_TRACKER-alpha.md'),
          tasks: { total: 3, done: 1, blocked: 1, open: 1 },
          issues: 0,
        },
        {
          stub: 'b',
          plan: join(dir, 'PLAN-b.md'),
          tracker: null,
          tasks: { total: 1, done: 1, blocked: 0, open: 0 },
          issues: 2,
        },
      ],
    });
  });

  it('renders one row per plan with the stubs padded to one column, and one line for no plans', () => {
    expect(renderPlanList(listPlans(plantPlans()))).toEqual(EXPECTED_ROWS);
    expect(renderPlanList({ dir: '/nowhere/.plans', plans: [] })).toEqual(['No plans in .plans/.']);
  });
});

describe('rafa plan list, dispatched', () => {
  it('prints the rows in text mode', async () => {
    const root = plantPlans();
    const run = await dispatchCaptured(['plan', 'list'], SUBJECTS, [createPlanListCommand(() => root)]);

    expect(run).toEqual({ exitCode: 0, stdout: `${EXPECTED_ROWS.join('\n')}\n`, stderr: '' });
  });

  it('gives the list as the data of the one result event in json mode', async () => {
    const root = plantPlans();
    const run = await dispatchCaptured(['plan', 'list', '--output=json'], SUBJECTS, [createPlanListCommand(() => root)]);
    const events = eventsOf(run.stdout);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(events[0]).toMatchObject({ type: 'start', command: 'plan list' });
    expect(events[1]).toMatchObject({ type: 'result', ok: true, data: JSON.parse(JSON.stringify(listPlans(root))) as unknown });
  });

  it('refuses an argument before looking for a repository', async () => {
    let looked = 0;
    const findRoot = (): string => {
      looked += 1;
      return plantPlans();
    };
    const run = await dispatchCaptured(['plan', 'list', 'alpha'], SUBJECTS, [createPlanListCommand(findRoot)]);

    expect(run).toEqual({ exitCode: 1, stdout: '', stderr: '❌ Expected no argument, got 1: alpha\nUsage: rafa plan list\n' });
    expect(looked).toBe(0);
  });
});

describe('rafa plan list, spawned', () => {
  it('reads .plans at the git root when run from a subdirectory of the repository', () => {
    const scratch = plantScratchRepo(tempBase);
    mkdirSync(join(scratch.repo, '.plans'));
    writeFileSync(join(scratch.repo, '.plans', 'PLAN-alpha.md'), ALPHA_PLAN, 'utf8');
    mkdirSync(join(scratch.repo, 'sub'));

    const run = runRafa(scratch, join(scratch.repo, 'sub'), ['plan', 'list', '--output=json']);
    const events = eventsOf(run.stdout);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(events[1]).toMatchObject({
      type: 'result',
      ok: true,
      data: { dir: join(scratch.repo, '.plans'), plans: [{ stub: 'alpha', tracker: null }] },
    });
  }, SPAWN_TIMEOUT);
});
