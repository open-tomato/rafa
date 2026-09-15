/**
 * Tests for `rafa plan show` (`show.ts`): the plan a stub names and its
 * tracker, read as the plan parser reads them, the refusals of a stub,
 * the reading of `--tracker` on either side of the stub, the text a
 * person reads, the json result, and the git root the registered command
 * reads.
 *
 * The in-process cases dispatch the command made over a planted root, so
 * no git runs and no real repository is read. The tracker planted holds
 * ticks and an issue its plan does not, so reading the wrong file differs
 * from what is held. The stub `x/../../secret` names `secret.md` at the
 * root once joined, and the root holds one: the stub refusal is what
 * keeps the command from reading it.
 *
 * `--tracker` typed before the stub is refused with the order that works,
 * and its control is the same line with the flag after the stub, which
 * prints the tracker: the refusal comes from where the flag was typed,
 * not from the flag.
 *
 * The spawned case runs `bun src/rafa.ts plan show` from a subdirectory
 * of a scratch git repository whose `.plans/` sits at its root, with a
 * HOME of its own. The subdirectory holds no `.plans/`, so a command
 * reading the working directory refuses the stub.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../../cli/command.js';
import { parsePlan } from '../../plan/index.js';
import { dispatchCaptured, eventsOf, plantScratchRepo, runRafa } from '../../tests/cli-capture.js';

import { createPlanShowCommand, readTrackerFlag, renderShownPlan, showPlan } from './show.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-plan-show-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long the spawned case may run. */
const SPAWN_TIMEOUT = 30_000;

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'plan', summary: 'plans' }];

/** A plan with a header, a context, a task above every stage, two stages and a declaration. */
const FEATURE_PLAN = [
  '# Plan: feature',
  '',
  '```rafa:plan',
  'stub: feature',
  'issue: OPT-7',
  'spec: .specs/feature.md',
  'owner: marcos',
  '```',
  '',
  '```rafa:context',
  'Prose for every task.',
  '```',
  '',
  '- [ ] Read the spec',
  '',
  '# Stage: schema',
  '',
  '```rafa:stage-context',
  'Schema prose.',
  '```',
  '',
  '- [ ] Add the schema  {agent=loop-implementer}',
  '- [ ] Wire it',
  '',
  '# Stage: docs',
  '',
  '- [ ] Write the docs',
  '',
].join('\n');

/** Its tracker: two tasks ticked, one blocked, and a second plan context after the last task. */
const FEATURE_TRACKER = `${FEATURE_PLAN
  .replace('- [ ] Read the spec', '- [x] Read the spec')
  .replace('- [ ] Add the schema', '- [x] Add the schema')
  .replace('- [ ] Wire it', '- [BLOCKED] Wire it')}${['```rafa:context', 'Again.', '```', ''].join('\n')}`;

/** The line the tracker's second plan context opens on, counting from one. */
const DUPLICATE_LINE = FEATURE_PLAN.split('\n').length;

/** What text mode writes for the plan. */
const PLAN_TEXT = [
  'Plan: feature',
  'File: .plans/PLAN-feature.md',
  'Issue: OPT-7',
  'Spec: .specs/feature.md',
  'Tasks: 0/4 done, 0 blocked, 4 open',
  '',
  '  [ ] Read the spec',
  '',
  'Stage: schema',
  '  [ ] Add the schema',
  '  [ ] Wire it',
  '',
  'Stage: docs',
  '  [ ] Write the docs',
];

/** What text mode writes for the tracker. */
const TRACKER_TEXT = [
  'Plan: feature',
  'Tracker: .plans/PLAN_TRACKER-feature.md',
  'Issue: OPT-7',
  'Spec: .specs/feature.md',
  'Tasks: 2/4 done, 1 blocked, 1 open',
  '',
  '  [x] Read the spec',
  '',
  'Stage: schema',
  '  [x] Add the schema',
  '  [BLOCKED] Wire it',
  '',
  'Stage: docs',
  '  [ ] Write the docs',
  '',
  'Issues:',
  `  .plans/PLAN_TRACKER-feature.md:${DUPLICATE_LINE}: duplicate-block: rafa:context block repeats the one at line 10, which is the one read`,
];

/** A fresh root holding `files`, by path relative to it. */
function plantRoot(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tempBase, 'root-'));
  for (const [relative, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, relative)), { recursive: true });
    writeFileSync(join(root, relative), text, 'utf8');
  }
  return root;
}

/** The feature plan and its tracker, a plan with no tracker, and a checklist outside `.plans/`. */
function plantFeature(): string {
  return plantRoot({
    '.plans/PLAN-feature.md': FEATURE_PLAN,
    '.plans/PLAN_TRACKER-feature.md': FEATURE_TRACKER,
    '.plans/PLAN-bare.md': '- [ ] bare\n',
    'secret.md': '- [ ] not a plan\n',
  });
}

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

describe('what rafa plan show reads', () => {
  it('reads the plan a stub names as the plan parser reads it, each header extra by its key', () => {
    const root = plantFeature();
    const model = parsePlan(FEATURE_PLAN);

    expect([model.context, model.stages.map((stage) => stage.name), model.tasks.map((task) => task.text)]).toEqual([
      'Prose for every task.',
      ['schema', 'docs'],
      ['Read the spec', 'Add the schema', 'Wire it', 'Write the docs'],
    ]);
    expect(showPlan(root, 'feature', false)).toEqual({
      stub: 'feature',
      file: join(root, '.plans', 'PLAN-feature.md'),
      tracker: false,
      header: { stub: 'feature', issue: 'OPT-7', spec: '.specs/feature.md', extras: ['owner'] },
      context: model.context,
      stages: model.stages,
      tasks: model.tasks,
      counts: { total: 4, done: 0, blocked: 0, open: 4 },
      issues: [],
    });
  });

  it('reads the tracker with --tracker, its ticks and its issues included', () => {
    const root = plantFeature();
    const shown = showPlan(root, 'feature', true);

    expect([shown.tracker, shown.file, shown.counts]).toEqual([
      true,
      join(root, '.plans', 'PLAN_TRACKER-feature.md'),
      { total: 4, done: 2, blocked: 1, open: 1 },
    ]);
    expect(shown.issues.map((issue) => [issue.line, issue.reason])).toEqual([[DUPLICATE_LINE, 'duplicate-block']]);
  });

  it.each([
    ['x/../../secret', false, '❌ "x/../../secret" is no plan stub: a stub is letters, digits, ".", "_" and "-"'],
    ['nope', false, '❌ No plan "nope": .plans/PLAN-nope.md does not exist. rafa plan list names the plans there are.'],
    [
      'bare',
      true,
      '❌ No tracker for plan "bare": .plans/PLAN_TRACKER-bare.md does not exist until rafa loop start first runs the plan.',
    ],
  ])('refuses the stub %s with exit code 1', (stub, tracker, message) => {
    const root = plantFeature();

    expect(exitOf(() => showPlan(root, stub, tracker))).toEqual({ exitCode: 1, message });
  });

  it('reads --tracker as true or false, and refuses any other value naming the order that works', () => {
    expect([undefined, false, 'false', true, 'true'].map((value) => readTrackerFlag(value))).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(exitOf(() => readTrackerFlag('feature'))).toEqual({
      exitCode: 1,
      message: '❌ --tracker takes no value, and read "feature" as one. Type the stub first: rafa plan show <stub> --tracker',
    });
  });

  it('renders the plan and the tracker stage by stage, the tracker with its issues', () => {
    const root = plantFeature();

    expect(renderShownPlan(showPlan(root, 'feature', false))).toEqual(PLAN_TEXT);
    expect(renderShownPlan(showPlan(root, 'feature', true))).toEqual(TRACKER_TEXT);
  });
});

describe('rafa plan show, dispatched', () => {
  it('prints the plan in text mode, and the tracker with --tracker typed after the stub', async () => {
    const root = plantFeature();
    const commands = [createPlanShowCommand(() => root)];

    expect(await dispatchCaptured(['plan', 'show', 'feature'], SUBJECTS, commands))
      .toEqual({ exitCode: 0, stdout: `${PLAN_TEXT.join('\n')}\n`, stderr: '' });
    expect(await dispatchCaptured(['plan', 'show', 'feature', '--tracker'], SUBJECTS, commands))
      .toEqual({ exitCode: 0, stdout: `${TRACKER_TEXT.join('\n')}\n`, stderr: '' });
  });

  it('refuses --tracker typed before the stub, which takes the stub as its value, before looking for a repository', async () => {
    let looked = 0;
    const findRoot = (): string => {
      looked += 1;
      return plantFeature();
    };
    const run = await dispatchCaptured(['plan', 'show', '--tracker', 'feature'], SUBJECTS, [createPlanShowCommand(findRoot)]);

    expect(run).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: '❌ --tracker takes no value, and read "feature" as one. Type the stub first: rafa plan show <stub> --tracker\n',
    });
    expect(looked).toBe(0);
  });

  it('gives the tracker as the data of the one result event in json mode', async () => {
    const root = plantFeature();
    const words = ['plan', 'show', 'feature', '--tracker', '--output=json'];
    const run = await dispatchCaptured(words, SUBJECTS, [createPlanShowCommand(() => root)]);
    const events = eventsOf(run.stdout);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(events[1]).toMatchObject({
      type: 'result',
      ok: true,
      data: JSON.parse(JSON.stringify(showPlan(root, 'feature', true))) as unknown,
    });
  });

  it.each([
    [['plan', 'show'], '❌ Expected one argument, got none\nUsage: rafa plan show <stub> [--tracker]\n'],
    [['plan', 'show', 'feature', 'bare'], '❌ Expected one argument, got 2: feature bare\nUsage: rafa plan show <stub> [--tracker]\n'],
  ])('refuses the line %j with exit code 1', async (words, stderr) => {
    const root = plantFeature();

    expect(await dispatchCaptured(words, SUBJECTS, [createPlanShowCommand(() => root)]))
      .toEqual({ exitCode: 1, stdout: '', stderr });
  });
});

describe('rafa plan show, spawned', () => {
  it('reads the plan under .plans at the git root when run from a subdirectory of the repository', () => {
    const scratch = plantScratchRepo(tempBase);
    mkdirSync(join(scratch.repo, '.plans'));
    writeFileSync(join(scratch.repo, '.plans', 'PLAN-feature.md'), FEATURE_PLAN, 'utf8');
    mkdirSync(join(scratch.repo, 'sub'));

    const run = runRafa(scratch, join(scratch.repo, 'sub'), ['plan', 'show', 'feature']);

    expect(run).toEqual({ exitCode: 0, stdout: `${PLAN_TEXT.join('\n')}\n`, stderr: '' });
  }, SPAWN_TIMEOUT);
});
