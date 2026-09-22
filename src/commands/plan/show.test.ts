/**
 * Tests for `rafa plan show` (`show.ts`): the plan a stub names and its
 * tracker, read as the plan parser reads them, the refusals of a stub,
 * the reading of `--tracker` on either side of the stub, the text a
 * person reads, the json result, and the directory the registered
 * command reads.
 *
 * The plan is planted twice over: under the `.rafa/plans` default, and
 * under the `docs/plans` a config names on purpose, which is the
 * exemption `default-plan-dirs.test.ts` carves out for a test. The
 * configured case is what tells reading `plan.dir` apart from reading a
 * constant: the default directory holds no plan there, so a reader of a
 * constant would refuse the stub.
 *
 * The in-process cases dispatch the command inside a planted project, so
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
 * of a scratch git repository whose plans sit under the default
 * directory at its root, with a HOME of its own. The subdirectory holds
 * no plans directory, so a command reading the working directory refuses
 * the stub.
 */
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../../cli/command.js';
import { parsePlan } from '../../plan/index.js';
import { dispatchInProject, eventsOf, plantProject, plantScratchRepo, runRafa } from '../../tests/cli-capture.js';

import { plansDirAt } from './plan-files.js';
import planShowCommand, { readTrackerFlag, renderShownPlan, showPlan } from './show.js';

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
  'spec: .rafa/specs/feature.md',
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

/** The plans directory a project whose config sets no `plan.dir` reads. */
const DEFAULT_DIR = join('.rafa', 'plans');

/** The plans directory the configured cases name, and the config naming it. */
const CONFIGURED_DIR = 'docs/plans';
const CONFIGURED_CONFIG = `plan:\n  dir: ${CONFIGURED_DIR}\n`;

/** What text mode writes for the plan read from `dir`. */
function planText(dir: string): string[] {
  return [
    'Plan: feature',
    `File: ${dir}/PLAN-feature.md`,
    'Issue: OPT-7',
    'Spec: .rafa/specs/feature.md',
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
}

/** What text mode writes for the tracker read from `dir`. */
function trackerText(dir: string): string[] {
  return [
    'Plan: feature',
    `Tracker: ${dir}/PLAN_TRACKER-feature.md`,
    'Issue: OPT-7',
    'Spec: .rafa/specs/feature.md',
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
    `  ${dir}/PLAN_TRACKER-feature.md:${DUPLICATE_LINE}: duplicate-block: rafa:context block repeats the one at line 10,`
      + ' which is the one read',
  ];
}

/** `root` holding `files`, by path relative to it. */
function plantFiles(root: string, files: Readonly<Record<string, string>>): string {
  for (const [relative, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, relative)), { recursive: true });
    writeFileSync(join(root, relative), text, 'utf8');
  }
  return root;
}

/** The feature plan and its tracker under `dir`, a plan with no tracker, and a checklist outside it. */
function plantFeature(root: string, dir: string): string {
  return plantFiles(root, {
    [`${dir}/PLAN-feature.md`]: FEATURE_PLAN,
    [`${dir}/PLAN_TRACKER-feature.md`]: FEATURE_TRACKER,
    [`${dir}/PLAN-bare.md`]: '- [ ] bare\n',
    'secret.md': '- [ ] not a plan\n',
  });
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
  it.each([
    ['the default directory', DEFAULT_DIR],
    ['a configured directory', CONFIGURED_DIR],
  ])('reads the plan a stub names in %s as the plan parser reads it, each header extra by its key', (_name, dir) => {
    const root = plantFeature(freshRoot(), dir);
    const plans = plansDirAt(root, dir);
    const model = parsePlan(FEATURE_PLAN);

    expect([model.context, model.stages.map((stage) => stage.name), model.tasks.map((task) => task.text)]).toEqual([
      'Prose for every task.',
      ['schema', 'docs'],
      ['Read the spec', 'Add the schema', 'Wire it', 'Write the docs'],
    ]);
    expect(showPlan(plans, 'feature', false)).toEqual({
      stub: 'feature',
      file: join(plans.path, 'PLAN-feature.md'),
      tracker: false,
      header: { stub: 'feature', issue: 'OPT-7', spec: '.rafa/specs/feature.md', extras: ['owner'] },
      context: model.context,
      stages: model.stages,
      tasks: model.tasks,
      counts: { total: 4, done: 0, blocked: 0, open: 4 },
      issues: [],
    });
    // The other directory is what a reader of a constant would have read: it holds no plan.
    const otherDir = dir === DEFAULT_DIR
      ? CONFIGURED_DIR
      : DEFAULT_DIR;
    const other = plansDirAt(root, otherDir);
    expect(exitOf(() => showPlan(other, 'feature', false))).toMatchObject({ exitCode: 1 });
  });

  it('reads the tracker with --tracker, its ticks and its issues included', () => {
    const root = plantFeature(freshRoot(), DEFAULT_DIR);
    const plans = plansDirAt(root, DEFAULT_DIR);
    const shown = showPlan(plans, 'feature', true);

    expect([shown.tracker, shown.file, shown.counts]).toEqual([
      true,
      join(plans.path, 'PLAN_TRACKER-feature.md'),
      { total: 4, done: 2, blocked: 1, open: 1 },
    ]);
    expect(shown.issues.map((issue) => [issue.line, issue.reason])).toEqual([[DUPLICATE_LINE, 'duplicate-block']]);
  });

  it.each([
    ['x/../../secret', false, '❌ "x/../../secret" is no plan stub: a stub is letters, digits, ".", "_" and "-"'],
    [
      'nope',
      false,
      `❌ No plan "nope": ${join(DEFAULT_DIR, 'PLAN-nope.md')} does not exist. rafa plan list names the plans there are.`,
    ],
    [
      'bare',
      true,
      `❌ No tracker for plan "bare": ${join(DEFAULT_DIR, 'PLAN_TRACKER-bare.md')} does not exist until rafa loop start`
        + ' first runs the plan.',
    ],
  ])('refuses the stub %s with exit code 1', (stub, tracker, message) => {
    const plans = plansDirAt(plantFeature(freshRoot(), DEFAULT_DIR), DEFAULT_DIR);

    expect(exitOf(() => showPlan(plans, stub, tracker))).toEqual({ exitCode: 1, message });
  });

  it('names the configured directory in the refusal of a stub naming no file', () => {
    const plans = plansDirAt(plantFeature(freshRoot(), CONFIGURED_DIR), CONFIGURED_DIR);

    expect(exitOf(() => showPlan(plans, 'nope', false))).toEqual({
      exitCode: 1,
      message: `❌ No plan "nope": ${CONFIGURED_DIR}/PLAN-nope.md does not exist. rafa plan list names the plans there are.`,
    });
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

  it('renders the plan and the tracker stage by stage, the tracker with its issues, under the directory read', () => {
    const plans = plansDirAt(plantFeature(freshRoot(), CONFIGURED_DIR), CONFIGURED_DIR);

    expect(renderShownPlan(showPlan(plans, 'feature', false), plans.label)).toEqual(planText(CONFIGURED_DIR));
    expect(renderShownPlan(showPlan(plans, 'feature', true), plans.label)).toEqual(trackerText(CONFIGURED_DIR));
  });
});

describe('rafa plan show, dispatched', () => {
  it('prints the plan of the default directory in text mode, and the tracker with --tracker typed after the stub', async () => {
    const project = freshProject();
    plantFeature(project.root, DEFAULT_DIR);

    expect(await dispatchInProject(['plan', 'show', 'feature'], SUBJECTS, [planShowCommand], project))
      .toEqual({ exitCode: 0, stdout: `${planText(DEFAULT_DIR).join('\n')}\n`, stderr: '' });
    expect(await dispatchInProject(['plan', 'show', 'feature', '--tracker'], SUBJECTS, [planShowCommand], project))
      .toEqual({ exitCode: 0, stdout: `${trackerText(DEFAULT_DIR).join('\n')}\n`, stderr: '' });
  });

  it('reads the directory plan.dir names, where the default directory holds no plan of that stub', async () => {
    const project = freshProject(CONFIGURED_CONFIG);
    plantFeature(project.root, CONFIGURED_DIR);
    const run = await dispatchInProject(['plan', 'show', 'feature'], SUBJECTS, [planShowCommand], project);

    expect(run).toEqual({ exitCode: 0, stdout: `${planText(CONFIGURED_DIR).join('\n')}\n`, stderr: '' });
    expect(exitOf(() => showPlan(plansDirAt(project.root, DEFAULT_DIR), 'feature', false))).toMatchObject({ exitCode: 1 });
  });

  it('refuses --tracker typed before the stub, which takes the stub as its value, before the config is read', async () => {
    const project = freshProject('plan:\n  dir: ""\n');
    const run = await dispatchInProject(['plan', 'show', '--tracker', 'feature'], SUBJECTS, [planShowCommand], project);

    expect(run).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: '❌ --tracker takes no value, and read "feature" as one. Type the stub first: rafa plan show <stub> --tracker\n',
    });
    // The control: typed after the stub, that config is what refuses the line.
    const refused = await dispatchInProject(['plan', 'show', 'feature', '--tracker'], SUBJECTS, [planShowCommand], project);
    expect([refused.exitCode, refused.stderr.split('\n')[0]]).toEqual([1, '❌ rafa plan show: the config cannot be used:']);
  });

  it('gives the tracker as the data of the one result event in json mode', async () => {
    const project = freshProject(CONFIGURED_CONFIG);
    plantFeature(project.root, CONFIGURED_DIR);
    const words = ['plan', 'show', 'feature', '--tracker', '--output=json'];
    const run = await dispatchInProject(words, SUBJECTS, [planShowCommand], project);
    const events = eventsOf(run.stdout);
    const shown = showPlan(plansDirAt(project.root, CONFIGURED_DIR), 'feature', true);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(events.map((event) => event.type)).toEqual(['start', 'result']);
    expect(events[1]).toMatchObject({
      type: 'result',
      ok: true,
      data: JSON.parse(JSON.stringify(shown)) as unknown,
    });
  });

  it.each([
    [['plan', 'show'], '❌ Expected one argument, got none\nUsage: rafa plan show <stub> [--tracker]\n'],
    [['plan', 'show', 'feature', 'bare'], '❌ Expected one argument, got 2: feature bare\nUsage: rafa plan show <stub> [--tracker]\n'],
  ])('refuses the line %j with exit code 1', async (words, stderr) => {
    const project = freshProject();
    plantFeature(project.root, DEFAULT_DIR);

    expect(await dispatchInProject(words, SUBJECTS, [planShowCommand], project))
      .toEqual({ exitCode: 1, stdout: '', stderr });
  });
});

describe('rafa plan show, spawned', () => {
  it('reads the plan under the default directory at the project root when run from a subdirectory', () => {
    const scratch = plantScratchRepo(tempBase);
    mkdirSync(join(scratch.repo, DEFAULT_DIR), { recursive: true });
    writeFileSync(join(scratch.repo, DEFAULT_DIR, 'PLAN-feature.md'), FEATURE_PLAN, 'utf8');
    mkdirSync(join(scratch.repo, 'sub'));

    const run = runRafa(scratch, join(scratch.repo, 'sub'), ['plan', 'show', 'feature']);

    expect(run).toEqual({ exitCode: 0, stdout: `${planText(DEFAULT_DIR).join('\n')}\n`, stderr: '' });
  }, SPAWN_TIMEOUT);
});
