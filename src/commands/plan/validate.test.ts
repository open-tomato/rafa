/**
 * Tests for `rafa plan validate` (`validate.ts`): a clean plan and a plan
 * with issues in both modes, the agents of its still-to-run tasks, the
 * path resolved against the working directory, the refusals, and that
 * the command starts no session.
 *
 * The broken plan carries three issues of three reasons, a header field
 * YAML reads as a comment, a block never closed and an open task line
 * inside it, so a command writing fewer than every issue, or writing them
 * out of line order, differs from what is held.
 *
 * ## The agent roster
 *
 * Each roster case plants its definitions under the project and the home
 * of the temporary project it dispatches in, never under this machine's,
 * and the first asserts both paths resolve under this file's own
 * directory. Every reading that reports a missing agent sits beside a
 * control differing in one thing only: the project's definitions, the
 * `loop.settingSources` of the project's config, or the checkbox of the
 * line that named it. The one case with no project at all is run by
 * calling the command directly, since the dispatcher refuses a command
 * needing a project outside one and would never hand it null.
 *
 * ## No session
 *
 * The spawned case runs `bun src/rafa.ts plan validate` in a scratch git
 * repository with a HOME of its own and a stand-in `claude` first on its
 * PATH, which logs each call to a file beside the repository. After
 * validating, the log does not exist. The control runs
 * `rafa plan create --spec=` in the same planting, which starts a
 * session: the log then exists, so the stand-in is what a session in that
 * planting reaches, and its absence after `validate` is a reading.
 */
import type { CliEvent } from '../../ports/index.js';

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../../cli/command.js';
import { createCommandRegistry } from '../../cli/registry.js';
import { parsePlan } from '../../plan/index.js';
import {
  dispatchCaptured,
  dispatchInProject,
  eventsOf,
  plantProject,
  plantScratchRepo,
  plantStandInClaude,
  runRafa,
} from '../../tests/cli-capture.js';
import { sinkOutput } from '../../tests/output-sinks.js';

import { issueLine } from './plan-files.js';
import { createPlanValidateCommand, validatePlan } from './validate.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-plan-validate-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long the spawned case may run: two runs, one of them starting a session. */
const SPAWN_TIMEOUT = 60_000;

/** The subject the dispatched cases route under. */
const SUBJECTS = [{ name: 'plan', summary: 'plans' }];

/** A plan the parser reads as written: one stage, one task of each checkbox. */
const CLEAN_PLAN = ['# Plan: clean', '', '# Stage: one', '', '- [x] done one', '- [BLOCKED] blocked one', '- [ ] open one', ''].join('\n');

/** A plan with three issues; see the module note. */
const BROKEN_PLAN = [
  '# Plan: broken',
  '',
  '```rafa:plan',
  'issue: #42',
  '```',
  '',
  '- [ ] a task',
  '',
  '```rafa:context',
  'never closed',
  '- [ ] inside the block',
  '',
].join('\n');

/** The error lines the broken plan gives, typed as `plans/broken.md`. */
const BROKEN_LINES = parsePlan(BROKEN_PLAN).issues.map((issue) => issueLine('plans/broken.md', issue));

/** The refusal the broken plan ends with, typed as `plans/broken.md`. */
const BROKEN_REFUSAL = '❌ plans/broken.md: 3 issues; the plan does not read as written';

/** A plan whose open and blocked tasks name agents, and whose ticked one names another. */
const PLAN_NAMING_AGENTS = [
  '# Plan: routed',
  '',
  '# Stage: one',
  '',
  '- [ ] Write the tests  {agent=tdd-guide}',
  '- [x] Already ran  {agent=ticked-only}',
  '- [BLOCKED] Ask the void  {agent=no-such-agent}',
  '',
].join('\n');

/** Writes `<root>/.claude/agents/<name>.md` carrying that name as its frontmatter, and answers its path. */
function plantAgent(root: string, name: string): string {
  const dir = join(root, '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.md`);
  writeFileSync(file, `---\nname: ${name}\n---\nThe agent body.\n`, 'utf8');
  return file;
}

/** A fresh temporary project of this file's own, its plan written at `plan.md`. */
function plantRoutedProject(plan: string = PLAN_NAMING_AGENTS, config?: string): { root: string; home: string } {
  const scope = mkdtempSync(join(tempBase, 'scope-'));
  const project = config === undefined
    ? plantProject(scope)
    : plantProject(scope, config);
  writeFileSync(join(project.root, 'plan.md'), plan, 'utf8');
  return project;
}

/**
 * Runs the command over `plan.md` in `root` with a context carrying no
 * project, which the dispatcher never builds for a command needing one,
 * each `info` line handed to `onInfo`.
 */
async function runWithoutProject(root: string, onInfo: (message: string) => void): Promise<void> {
  return createPlanValidateCommand(() => root).run({
    args: ['plan.md'],
    argv: ['plan.md'],
    flags: {},
    outputMode: 'text',
    verbosity: 1,
    output: sinkOutput({ info: onInfo }),
    signal: new AbortController().signal,
    env: {},
    registry: createCommandRegistry({ subjects: SUBJECTS, commands: [] }),
    project: null,
  });
}

/** Dispatches `plan validate plan.md` in `project`, with `words` added to the line. */
async function validateIn(
  project: { root: string; home: string },
  words: readonly string[] = [],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return dispatchInProject(
    ['plan', 'validate', 'plan.md', ...words],
    SUBJECTS,
    [createPlanValidateCommand(() => project.root)],
    project,
  );
}

/** A fresh root holding the clean plan and the broken one under `plans/`. */
function plantPlans(): string {
  const root = mkdtempSync(join(tempBase, 'root-'));
  mkdirSync(join(root, 'plans'));
  writeFileSync(join(root, 'plans', 'clean.md'), CLEAN_PLAN, 'utf8');
  writeFileSync(join(root, 'plans', 'broken.md'), BROKEN_PLAN, 'utf8');
  return root;
}

/** An event as one string: `<level>:<message>` for a log, and its type for the rest. */
function labelOf(event: CliEvent): string {
  return event.type === 'log'
    ? `${event.level}:${event.message}`
    : event.type;
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

describe('what rafa plan validate reads', () => {
  it('reads a plan into its stages, its task counts and its issues', () => {
    const root = plantPlans();
    const file = join(root, 'plans', 'clean.md');

    expect(validatePlan(file)).toEqual({ file, stages: 1, tasks: { total: 3, done: 1, blocked: 1, open: 1 }, issues: [] });
  });

  it('holds the broken plan to three issues of three reasons, in line order', () => {
    expect(parsePlan(BROKEN_PLAN).issues.map((issue) => [issue.line, issue.reason])).toEqual([
      [3, 'unusable-field'],
      [9, 'unclosed-block'],
      [11, 'task-in-block'],
    ]);
  });

  it('refuses a path that does not exist and a directory with exit code 1', () => {
    const root = plantPlans();

    expect(exitOf(() => validatePlan(join(root, 'plans', 'missing.md'))))
      .toEqual({ exitCode: 1, message: `❌ Plan file not found: ${join(root, 'plans', 'missing.md')}` });
    expect(exitOf(() => validatePlan(join(root, 'plans'))))
      .toEqual({ exitCode: 1, message: `❌ Plan file not found: ${join(root, 'plans')}` });
  });
});

describe('rafa plan validate, dispatched', () => {
  it('prints one line for a clean plan in text mode, and exits 0', async () => {
    const root = plantPlans();
    const run = await dispatchCaptured(['plan', 'validate', 'plans/clean.md'], SUBJECTS, [createPlanValidateCommand(() => root)]);

    expect(run).toEqual({
      exitCode: 0,
      stdout: '✅ plans/clean.md: no issues; 1 stage, tasks 1/3 done, 1 blocked, 1 open\n',
      stderr: '',
    });
  });

  it('gives a clean plan as the data of the one result event in json mode', async () => {
    const root = plantPlans();
    const words = ['plan', 'validate', 'plans/clean.md', '--output=json'];
    const run = await dispatchCaptured(words, SUBJECTS, [createPlanValidateCommand(() => root)]);
    const events = eventsOf(run.stdout);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(events.map(labelOf)).toEqual(['start', 'result']);
    expect(events[1]).toMatchObject({
      type: 'result',
      ok: true,
      data: {
        file: join(root, 'plans', 'clean.md'),
        stages: 1,
        tasks: { total: 3, done: 1, blocked: 1, open: 1 },
        issues: [],
      },
    });
  });

  it('writes every issue as an error line and the count to stderr in text mode, and exits 1', async () => {
    const root = plantPlans();
    const run = await dispatchCaptured(['plan', 'validate', 'plans/broken.md'], SUBJECTS, [createPlanValidateCommand(() => root)]);

    expect(BROKEN_LINES).toHaveLength(3);
    expect(run).toEqual({
      exitCode: 1,
      stdout: `${BROKEN_LINES.map((line) => `error: ${line}`).join('\n')}\n`,
      stderr: `${BROKEN_REFUSAL}\n`,
    });
  });

  it('writes every issue as an error log event and the count in the failed result in json mode, and exits 1', async () => {
    const root = plantPlans();
    const words = ['plan', 'validate', '--output=json', 'plans/broken.md'];
    const run = await dispatchCaptured(words, SUBJECTS, [createPlanValidateCommand(() => root)]);
    const events = eventsOf(run.stdout);

    expect([run.exitCode, run.stderr]).toEqual([1, '']);
    expect(events.map(labelOf)).toEqual(['start', ...BROKEN_LINES.map((line) => `error:${line}`), 'result']);
    expect(events.at(-1)).toMatchObject({ type: 'result', ok: false, error: { code: 'command_exit', message: BROKEN_REFUSAL } });
  });

  it('resolves the path against the working directory it is handed', async () => {
    const root = plantPlans();
    const inPlans = await dispatchCaptured(['plan', 'validate', 'clean.md'], SUBJECTS, [
      createPlanValidateCommand(() => join(root, 'plans')),
    ]);
    const atRoot = await dispatchCaptured(['plan', 'validate', 'clean.md'], SUBJECTS, [createPlanValidateCommand(() => root)]);

    expect([inPlans.exitCode, inPlans.stdout]).toEqual([0, '✅ clean.md: no issues; 1 stage, tasks 1/3 done, 1 blocked, 1 open\n']);
    expect(atRoot).toEqual({ exitCode: 1, stdout: '', stderr: `❌ Plan file not found: ${resolve(root, 'clean.md')}\n` });
  });

  it.each([
    [['plan', 'validate'], '❌ Expected one argument, got none\nUsage: rafa plan validate <file>\n'],
    [['plan', 'validate', 'a.md', 'b.md'], '❌ Expected one argument, got 2: a.md b.md\nUsage: rafa plan validate <file>\n'],
  ])('refuses the line %j with exit code 1', async (words, stderr) => {
    const root = plantPlans();

    expect(await dispatchCaptured(words, SUBJECTS, [createPlanValidateCommand(() => root)]))
      .toEqual({ exitCode: 1, stdout: '', stderr });
  });
});

describe('the agents rafa plan validate checks', () => {
  it('writes one error line per agent no loaded scope defines, with its fix, and exits 1', async () => {
    const project = plantRoutedProject();
    const vendorable = plantAgent(project.home, 'tdd-guide');

    const run = await validateIn(project);
    // The control differs only in the project's own definitions.
    for (const name of ['tdd-guide', 'no-such-agent']) plantAgent(project.root, name);
    const control = await validateIn(project);

    expect(run.exitCode).toBe(1);
    expect(run.stdout.split('\n')).toEqual([
      'error: plan.md: agent "tdd-guide" (line 5) resolves under no loaded scope:'
        + ' run `rafa agent vendor tdd-guide`',
      'error: plan.md: agent "no-such-agent" (line 7) resolves under no loaded scope:'
        + ' no definition under ~/.claude/agents to vendor',
      '',
    ]);
    expect(run.stderr).toBe('❌ plan.md: 2 unresolvable agents; no session would be dispatched\n');
    // The ticked line names `ticked-only`, whose dispatch is behind any run.
    expect(run.stdout).not.toContain('ticked-only');
    expect([vendorable, project.root].every((path) => path.startsWith(tempBase))).toBe(true);

    expect(control).toEqual({
      exitCode: 0,
      stdout: '✅ plan.md: no issues; 1 stage, tasks 1/3 done, 1 blocked, 1 open\n',
      stderr: '',
    });
  });

  it('checks the agent of a task line a never-closed fence hides, which the dispatcher would run anyway', async () => {
    const hidden = [
      '# Plan: hidden',
      '',
      '```rafa:context',
      'Context the fence never closes.',
      '',
      '- [ ] Write the tests  {agent=tdd-guide}',
      '',
    ].join('\n');
    // The control differs in the closing fence alone, which puts the same line outside every block.
    const closedFence = hidden.replace('Context the fence never closes.', 'Context the fence closes.\n```');

    const run = await validateIn(plantRoutedProject(hidden));
    const control = await validateIn(plantRoutedProject(closedFence));

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toContain(
      'error: plan.md: agent "tdd-guide" (line 6) resolves under no loaded scope:'
        + ' no definition under ~/.claude/agents to vendor',
    );
    expect(run.stderr).toBe('❌ plan.md: 2 issues, 1 unresolvable agent; the plan does not read as written\n');

    expect(control.exitCode).toBe(1);
    expect(control.stdout).toContain(
      'error: plan.md: agent "tdd-guide" (line 7) resolves under no loaded scope:'
        + ' no definition under ~/.claude/agents to vendor',
    );
    expect(control.stderr).toBe('❌ plan.md: 1 unresolvable agent; no session would be dispatched\n');
  });

  it('reads the loop.settingSources of the project config, which can bring the home into reach', async () => {
    const withoutUser = plantRoutedProject('- [ ] Write the tests  {agent=tdd-guide}\n');
    const withUser = plantRoutedProject(
      '- [ ] Write the tests  {agent=tdd-guide}\n',
      'version: 1\nloop:\n  settingSources: user,project,local\n',
    );
    for (const project of [withoutUser, withUser]) plantAgent(project.home, 'tdd-guide');

    const refused = await validateIn(withoutUser);
    const passed = await validateIn(withUser);

    expect([refused.exitCode, refused.stdout.includes('"tdd-guide"')]).toEqual([1, true]);
    expect([passed.exitCode, passed.stderr]).toEqual([0, '']);
  });

  it('counts the issues and the agents together in the refusal of a plan carrying both', async () => {
    const routed = BROKEN_PLAN.replace('- [ ] a task', '- [ ] a task  {agent=no-such-agent}');
    const project = plantRoutedProject(routed);

    expect(parsePlan(routed).issues).toHaveLength(3);

    const run = await validateIn(project);

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toContain('error: plan.md:3: unusable-field:');
    expect(run.stdout).toContain('error: plan.md: agent "no-such-agent"');
    expect(run.stderr).toBe('❌ plan.md: 3 issues, 1 unresolvable agent; the plan does not read as written\n');
  });

  it('gives each missing agent as an error log event in json mode, and an empty list for a plan with none', async () => {
    const project = plantRoutedProject('- [ ] Write the tests  {agent=tdd-guide}\n');
    const clean = plantRoutedProject('- [ ] Write the tests  {agent=Explore}\n');

    const refused = await validateIn(project, ['--output=json']);
    const passed = await validateIn(clean, ['--output=json']);

    expect([refused.exitCode, refused.stderr]).toEqual([1, '']);
    expect(eventsOf(refused.stdout).map(labelOf)).toEqual([
      'start',
      'error:plan.md: agent "tdd-guide" (line 1) resolves under no loaded scope:'
        + ' no definition under ~/.claude/agents to vendor',
      'result',
    ]);
    expect(eventsOf(passed.stdout).at(-1)).toMatchObject({
      type: 'result',
      ok: true,
      data: { missingAgents: [] },
    });
  });

  it('refuses a config the loader refuses with exit code 1, where the same plan passes under a usable one', async () => {
    const refusedConfig = plantRoutedProject(CLEAN_PLAN, 'version: 1\nloop:\n  settingSources: nowhere\n');
    const usable = plantRoutedProject(CLEAN_PLAN);

    const refused = await validateIn(refusedConfig);
    const passed = await validateIn(usable);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr.split('\n')[0]).toBe('❌ rafa plan validate: the config cannot be used:');
    expect(refused.stderr).toContain('settingSources');
    expect([passed.exitCode, passed.stderr]).toEqual([0, '']);
  });

  it('checks no agent and says so when it is handed no project, where the same plan is refused in one', async () => {
    const project = plantRoutedProject('- [ ] Write the tests  {agent=tdd-guide}\n');
    const info: string[] = [];

    const ran = await runWithoutProject(project.root, (message) => {
      info.push(message);
    });
    const inProject = await validateIn(project);

    expect(ran).toBeUndefined();
    expect(info).toEqual([
      'ℹ️  No project was found from the working directory, so no `agent=` was checked.',
      '✅ plan.md: no issues; 0 stages, tasks 0/1 done, 0 blocked, 1 open',
    ]);
    expect([inProject.exitCode, inProject.stdout.includes('"tdd-guide"')]).toEqual([1, true]);
  });
});

describe('rafa plan validate, spawned', () => {
  it('starts no session, where plan create under the same planting starts one', () => {
    const scratch = plantScratchRepo(tempBase);
    plantStandInClaude(scratch);
    mkdirSync(join(scratch.repo, '.plans'));
    writeFileSync(join(scratch.repo, '.plans', 'PLAN-broken.md'), BROKEN_PLAN, 'utf8');
    writeFileSync(join(scratch.repo, 'spec.md'), '# A spec\n', 'utf8');

    const validated = runRafa(scratch, scratch.repo, ['plan', 'validate', '.plans/PLAN-broken.md', '--output=json']);
    const events = eventsOf(validated.stdout);

    expect([validated.exitCode, validated.stderr]).toEqual([1, '']);
    expect(events.map((event) => event.type)).toEqual(['start', 'log', 'log', 'log', 'result']);
    expect(existsSync(scratch.callLog)).toBe(false);

    const created = runRafa(scratch, scratch.repo, ['plan', 'create', '--spec=spec.md']);

    expect(created.exitCode).not.toBe(0);
    expect(existsSync(scratch.callLog)).toBe(true);
  }, SPAWN_TIMEOUT);
});
