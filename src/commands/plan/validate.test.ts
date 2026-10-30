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
 * line that named it. The one reporting a colliding skill sits beside a
 * control differing in the `tiers.skills` pin of the config alone. The one case with no project at all is run by
 * calling the command directly, since the dispatcher refuses a command
 * needing a project outside one and would never hand it null.
 *
 * ## The bundled items
 *
 * Each bundled case plants its own project under the temporary directory,
 * with its own `src/bundled/` and its own `.claude/` links, so none reads
 * this checkout's bundle or this machine's `~/.claude`. Each sits beside a
 * control differing in one thing: a plan naming no bundled item, the same
 * plan with no project, or the same edit with no parser issue beside it.
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
import type { CapturedRun } from '../../tests/cli-capture.js';
import type { CliEvent } from '@open-tomato/rafa/ports';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { createCommandRegistry } from '@open-tomato/rafa/cli/registry';
import { CommandExit } from '@open-tomato/rafa/core/command';
import { issueLine } from '@open-tomato/rafa/core/plan';
import { validatePlan } from '@open-tomato/rafa/plan/validate';
import { parsePrerequisites } from '@open-tomato/rafa/preflight/prerequisites-md';
import { sinkOutput } from '@open-tomato/rafa/tests/output-sinks';

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

import { createPlanValidateCommand } from './validate.js';

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

/** What `missingAgentLine` words after the lines for `tdd-guide` when no tier holds it. */
const UNHELD_TDD_GUIDE = 'cannot be dispatched: agent tdd-guide is held by no tier:'
  + ' no project, rafa or user definition carries it, and it is no built-in agent';

/** Writes `<root>/.claude/agents/<name>.md` carrying that name as its frontmatter, and answers its path. */
function plantAgent(root: string, name: string): string {
  const dir = join(root, '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.md`);
  writeFileSync(file, `---\nname: ${name}\n---\nThe agent body.\n`, 'utf8');
  return file;
}

/** Writes `<root>/.claude/skills/documentation/SKILL.md` ending in `body`, and answers its path. */
function plantSkill(root: string, body: string): string {
  const dir = join(root, '.claude', 'skills', 'documentation');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'SKILL.md');
  writeFileSync(file, `---\nname: documentation\ndescription: Planted.\n---\n${body}\n`, 'utf8');
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

    expect(validatePlan(file)).toEqual({
      file,
      stages: 1,
      tasks: { total: 3, done: 1, blocked: 1, open: 1 },
      issues: [],
      // Its tasks declare no agent and none `docs=repair`, so it is warned about on its last line.
      warnings: [expect.objectContaining({ reason: 'missing-doc-task', line: 7 })],
    });
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
        storeProblems: [],
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
  it('writes one error line per agent no loaded tier serves, with why, and exits 1', async () => {
    const project = plantRoutedProject();
    const vendorable = plantAgent(project.home, 'tdd-guide');

    const run = await validateIn(project);
    // The control differs only in the project's own definitions.
    for (const name of ['tdd-guide', 'no-such-agent']) plantAgent(project.root, name);
    const control = await validateIn(project);

    expect(run.exitCode).toBe(1);
    expect(run.stdout.split('\n')).toEqual([
      'error: plan.md: agent "tdd-guide" (line 5) cannot be dispatched: agent tdd-guide is held only by the user tier'
        + ` (${vendorable}), which loop.settingSources (project, local) leaves out:`
        + ' add user to loop.settingSources, or run `rafa agent vendor tdd-guide`',
      'error: plan.md: agent "no-such-agent" (line 7) cannot be dispatched: agent no-such-agent is held by no tier:'
        + ' no project, rafa or user definition carries it, and it is no built-in agent',
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
    expect(run.stdout).toContain(`error: plan.md: agent "tdd-guide" (line 6) ${UNHELD_TDD_GUIDE}`);
    expect(run.stderr).toBe('❌ plan.md: 2 issues, 1 unresolvable agent; the plan does not read as written\n');

    expect(control.exitCode).toBe(1);
    expect(control.stdout).toContain(`error: plan.md: agent "tdd-guide" (line 7) ${UNHELD_TDD_GUIDE}`);
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

  it('refuses a plan routing to an agent tiers.agents switches off with false, until the entry is dropped', async () => {
    const plan = '- [ ] Write the tests  {agent=tdd-guide}\n';
    const off = plantRoutedProject(plan, 'version: 1\ntiers:\n  agents: { tdd-guide: false }\n');
    const control = plantRoutedProject(plan);
    plantAgent(off.root, 'tdd-guide');
    plantAgent(control.root, 'tdd-guide');

    const refused = await validateIn(off);
    const passed = await validateIn(control);

    expect(refused.exitCode).toBe(1);
    expect(refused.stdout).toContain('error: plan.md: agent "tdd-guide" (line 1) cannot be dispatched:'
      + ' agent tdd-guide is switched off by tiers.agents: { tdd-guide: false }');
    expect(refused.stderr).toBe('❌ plan.md: 1 unresolvable agent; no session would be dispatched\n');
    // The control differs in the config's pin alone.
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
      `error:plan.md: agent "tdd-guide" (line 1) ${UNHELD_TDD_GUIDE}`,
      'result',
    ]);
    expect(eventsOf(passed.stdout).at(-1)).toMatchObject({
      type: 'result',
      ok: true,
      data: { missingAgents: [] },
    });
  });

  it('writes one error line per skills= name two loaded tiers hold with different contents, until a pin chooses', async () => {
    const plan = '- [ ] Write it  {skills=documentation}\n';
    const sources = 'version: 1\nloop:\n  settingSources: user,project,local\n';
    const collided = plantRoutedProject(plan, sources);
    const pinned = plantRoutedProject(plan, `${sources}tiers:\n  skills: { documentation: user }\n`);
    const paths = [collided, pinned].map((project) => ({
      project: plantSkill(project.root, 'The project body.'),
      user: plantSkill(project.home, 'The user body.'),
    }));

    const refused = await validateIn(collided);
    const json = await validateIn(collided, ['--output=json']);
    const passed = await validateIn(pinned, ['--output=json']);

    expect(refused.exitCode).toBe(1);
    expect(refused.stdout).toBe('error: plan.md: skill "documentation" (line 1) cannot be served: skill documentation is held'
      + ` by 2 loaded tiers with different contents: project ${paths[0]?.project} and user ${paths[0]?.user};`
      + ' pin the tier that serves it: tiers.skills: { documentation: user }\n');
    expect(refused.stderr).toBe('❌ plan.md: 1 skill collision; no session would be dispatched\n');
    expect(eventsOf(json.stdout).map(labelOf)).toEqual([
      'start',
      expect.stringContaining('error:plan.md: skill "documentation" (line 1) cannot be served:'),
      'result',
    ]);
    // The control differs in the pin alone.
    expect(passed.exitCode).toBe(0);
    expect(eventsOf(passed.stdout).at(-1)).toMatchObject({
      type: 'result',
      ok: true,
      data: { missingAgents: [], skillCollisions: [], unresolvedSkills: [] },
    });
  });

  it('writes one error line per skills= name no loaded tier resolves, naming the line, until the entry switching it off goes', async () => {
    const plan = '- [ ] Read it  {agent=general-purpose}\n- [ ] Write it  {skills=documentation}\n';
    const switchedOff = plantRoutedProject(plan, 'version: 1\ntiers:\n  skills: { documentation: false }\n');
    const served = plantRoutedProject(plan, 'version: 1\n');
    for (const project of [switchedOff, served]) plantSkill(project.root, 'The project body.');

    const refused = await validateIn(switchedOff);
    const json = await validateIn(switchedOff, ['--output=json']);
    const passed = await validateIn(served, ['--output=json']);

    expect(refused.exitCode).toBe(1);
    expect(refused.stdout).toBe('error: plan.md: skill "documentation" (line 2) cannot be served: skill documentation is'
      + ' switched off by tiers.skills: { documentation: false }; pin the tier that serves it instead:'
      + ' tiers.skills: { documentation: project }\n');
    expect(refused.stderr).toBe('❌ plan.md: 1 unresolvable skill; no session would be dispatched\n');
    expect(eventsOf(json.stdout).map(labelOf)).toEqual([
      'start',
      expect.stringContaining('error:plan.md: skill "documentation" (line 2) cannot be served:'),
      'result',
    ]);
    // The control differs in the tiers.skills entry alone.
    expect(passed.exitCode).toBe(0);
    expect(eventsOf(passed.stdout).at(-1)).toMatchObject({
      type: 'result',
      ok: true,
      data: { missingAgents: [], skillCollisions: [], unresolvedSkills: [] },
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
      'ℹ️  No project was found from the working directory, so no `agent=` or `skills=` was checked'
        + ' and no edit of a bundled agent or skill was read.',
      '✅ plan.md: no issues; 0 stages, tasks 0/1 done, 0 blocked, 1 open',
    ]);
    expect([inProject.exitCode, inProject.stdout.includes('"tdd-guide"')]).toEqual([1, true]);
  });
});

/** The plan file the bundled cases write at the root of their project, and the file its pins go to. */
const BUNDLED_PLAN = 'PLAN-demo.md';
const BUNDLED_PREREQUISITES = 'PREREQUISITES-demo.md';

/** A plan of one stage whose checklist is `lines`; its first task sits on line 5. */
function bundledPlanOf(...lines: string[]): string {
  return ['# Plan: bundled', '', '# Stage: one', '', ...lines, ''].join('\n');
}

/** What the note of one edit says, typed as `PLAN-demo.md`, before the tail saying what became of the pin. */
function editNote(line: number, kind: string, name: string, path: string, pin: string): string {
  return `ℹ️  ${BUNDLED_PLAN}:${line}: a task edits the bundled ${kind} \`${name}\` (\`${path}\`);`
    + ` each clone that merges it needs the pin \`${pin}\``;
}

/** The tail of a note whose pin went to the prerequisites file beside the plan. */
const WRITTEN_TAIL = `, written to ${BUNDLED_PREREQUISITES} as a [human] prerequisite.`;

/**
 * A fresh project holding `plan` as `PLAN-demo.md` and, of its own, two
 * bundled agents and two bundled skills under `src/bundled/`, with
 * `.claude/` links to `doc-updater.md` and to the `dev-planner` folder, so
 * no case reads this checkout's bundle or this machine's `~/.claude`.
 */
function plantBundledProject(plan: string): { root: string; home: string } {
  const scope = mkdtempSync(join(tempBase, 'bundled-'));
  const project = plantProject(scope);
  const agents = join(project.root, 'src', 'bundled', 'agents');
  const skills = join(project.root, 'src', 'bundled', 'skills');
  mkdirSync(agents, { recursive: true });
  for (const name of ['doc-updater', 'loop-implementer']) {
    writeFileSync(join(agents, `${name}.md`), `---\nname: ${name}\ndescription: The ${name} agent.\n---\n\nBody.\n`);
  }
  for (const name of ['dev-planner', 'git-workflow']) {
    mkdirSync(join(skills, name), { recursive: true });
    writeFileSync(join(skills, name, 'SKILL.md'), `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\nBody.\n`);
  }
  mkdirSync(join(project.root, '.claude', 'agents'), { recursive: true });
  mkdirSync(join(project.root, '.claude', 'skills'), { recursive: true });
  symlinkSync('../../src/bundled/agents/doc-updater.md', join(project.root, '.claude', 'agents', 'doc-updater.md'));
  symlinkSync('../../src/bundled/skills/dev-planner', join(project.root, '.claude', 'skills', 'dev-planner'));
  writeFileSync(join(project.root, BUNDLED_PLAN), plan, 'utf8');
  return project;
}

/** Dispatches `plan validate PLAN-demo.md` in `project`, with `words` added to the line. */
async function validateBundled(
  project: { root: string; home: string },
  words: readonly string[] = [],
): Promise<CapturedRun> {
  return dispatchInProject(
    ['plan', 'validate', BUNDLED_PLAN, ...words],
    SUBJECTS,
    [createPlanValidateCommand(() => project.root)],
    project,
  );
}

/** The prerequisites file the project holds beside its plan, or null when none was written. */
function prerequisitesOf(project: { root: string }): string | null {
  const path = join(project.root, BUNDLED_PREREQUISITES);
  return existsSync(path)
    ? readFileSync(path, 'utf8')
    : null;
}

/** The plan of the cases below: one task editing a bundled agent. */
const AGENT_EDIT_PLAN = bundledPlanOf('- [ ] Rewrite `src/bundled/agents/doc-updater.md` to read the changes fragment');

describe('the bundled agents and skills rafa plan validate notes', () => {
  it('prints a note with the tiers.agents pin for an agent a task edits, exits 0 and writes the pin as a [human] prerequisite', async () => {
    const project = plantBundledProject(AGENT_EDIT_PLAN);
    // The control names no bundled item, in a project holding the same bundle.
    const control = plantBundledProject(bundledPlanOf('- [ ] Rewrite `src/commands/plan/validate.ts` to read the bundle'));

    const run = await validateBundled(project);
    const controlRun = await validateBundled(control);

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.stdout.split('\n')).toEqual([
      editNote(5, 'agent', 'doc-updater', 'src/bundled/agents/doc-updater.md', 'tiers.agents: { doc-updater: project }')
        + WRITTEN_TAIL,
      '✅ PLAN-demo.md: no issues; 1 stage, tasks 0/1 done, 0 blocked, 1 open',
      '',
    ]);
    const items = parsePrerequisites(prerequisitesOf(project) ?? '');
    expect(items.map(({ tag, probe }) => ({ tag, probe }))).toEqual([{ tag: 'human', probe: null }]);
    expect(items[0]?.description).toContain('`tiers.agents: { doc-updater: project }`');
    expect(items[0]?.description).toContain(BUNDLED_PLAN);

    expect([controlRun.exitCode, controlRun.stdout.includes('bundled')]).toEqual([0, false]);
  });

  it('writes no second copy of the item on a second run, and says the file already holds it', async () => {
    const project = plantBundledProject(AGENT_EDIT_PLAN);

    await validateBundled(project);
    const before = prerequisitesOf(project);
    const second = await validateBundled(project);

    expect(before).not.toBeNull();
    expect(prerequisitesOf(project)).toBe(before);
    expect(second.exitCode).toBe(0);
    expect(second.stdout.split('\n')[0]).toEndWith(`, already held by ${BUNDLED_PREREQUISITES}.`);
  });

  it('carries one bundledEdits entry in the result of json mode, the note an info log event before it', async () => {
    const project = plantBundledProject(AGENT_EDIT_PLAN);

    const run = await validateBundled(project, ['--output=json']);
    const events = eventsOf(run.stdout);

    expect([run.exitCode, run.stderr]).toEqual([0, '']);
    expect(events.map(labelOf)).toEqual([
      'start',
      `info:${editNote(5, 'agent', 'doc-updater', 'src/bundled/agents/doc-updater.md', 'tiers.agents: { doc-updater: project }')
        + WRITTEN_TAIL}`,
      'result',
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'result',
      ok: true,
      data: {
        bundledEdits: [{
          kind: 'agent',
          name: 'doc-updater',
          path: 'src/bundled/agents/doc-updater.md',
          lines: [5],
          pinLine: 'tiers.agents: { doc-updater: project }',
        }],
      },
    });
    expect((events.at(-1) as { data: { bundledEdits: unknown[] } }).data.bundledEdits).toHaveLength(1);
  });

  it('prints the tiers.skills pin for a skill a task names through a planted .claude link', async () => {
    const project = plantBundledProject(bundledPlanOf('- [ ] Teach `.claude/skills/dev-planner` the bundled-item note'));

    const run = await validateBundled(project);

    expect(run.exitCode).toBe(0);
    expect(run.stdout.split('\n')[0]).toBe(
      editNote(5, 'skill', 'dev-planner', '.claude/skills/dev-planner', 'tiers.skills: { dev-planner: project }')
        + WRITTEN_TAIL,
    );
    expect(prerequisitesOf(project)).toContain('`tiers.skills: { dev-planner: project }`');
  });

  it('prints one note per planted agent for a plan naming src/bundled/agents/ whole, and none for a skill', async () => {
    const project = plantBundledProject(bundledPlanOf('- [ ] Sweep `src/bundled/agents/` for the old pin wording'));

    const run = await validateBundled(project);
    const notes = run.stdout.split('\n').filter((line) => line.includes('a task edits the bundled'));

    expect(run.exitCode).toBe(0);
    expect(notes).toEqual([
      editNote(5, 'agent', 'doc-updater', 'src/bundled/agents/', 'tiers.agents: { doc-updater: project }') + WRITTEN_TAIL,
      editNote(5, 'agent', 'loop-implementer', 'src/bundled/agents/', 'tiers.agents: { loop-implementer: project }')
        + WRITTEN_TAIL,
    ]);
    expect(parsePrerequisites(prerequisitesOf(project) ?? '')).toHaveLength(2);
  });

  it('prints no note and writes no file for a plan naming no bundled item, and says nothing of one', async () => {
    const project = plantBundledProject(bundledPlanOf(
      '- [ ] Add `src/commands/plan/bundled-check.ts` and run `bun test src/commands/plan/`',
      '- [ ] Read `~/.claude/agents/doc-updater.md` and `src/bundled/agents/missing.md` for the shape',
    ));

    const run = await validateBundled(project);

    expect(run).toEqual({
      exitCode: 0,
      stdout: '✅ PLAN-demo.md: no issues; 1 stage, tasks 0/2 done, 0 blocked, 2 open\n',
      stderr: '',
    });
    expect(prerequisitesOf(project)).toBeNull();
  });

  it('reads nothing when it is handed no project, where the same plan in the project is noted and written', async () => {
    const project = plantBundledProject(AGENT_EDIT_PLAN);
    const info: string[] = [];

    await createPlanValidateCommand(() => project.root).run({
      args: [BUNDLED_PLAN],
      argv: [BUNDLED_PLAN],
      flags: {},
      outputMode: 'text',
      verbosity: 1,
      output: sinkOutput({ info: (message) => { info.push(message); } }),
      signal: new AbortController().signal,
      env: {},
      registry: createCommandRegistry({ subjects: SUBJECTS, commands: [] }),
      project: null,
    });

    expect(info).toEqual([
      'ℹ️  No project was found from the working directory, so no `agent=` or `skills=` was checked'
        + ' and no edit of a bundled agent or skill was read.',
      '✅ PLAN-demo.md: no issues; 1 stage, tasks 0/1 done, 0 blocked, 1 open',
    ]);
    expect(prerequisitesOf(project)).toBeNull();

    const inProject = await validateBundled(project);

    expect(inProject.stdout).toContain('a task edits the bundled agent `doc-updater`');
    expect(prerequisitesOf(project)).not.toBeNull();
  });

  it('exits 1 and writes nothing for a plan with a parser issue beside an edit, where the plan without the issue writes it', async () => {
    const edit = '- [ ] Rewrite `src/bundled/agents/doc-updater.md` to read the changes fragment';
    const broken = BROKEN_PLAN.replace('- [ ] a task', edit);
    const refusedProject = plantBundledProject(broken);
    // The control holds the same edit with no issue beside it.
    const control = plantBundledProject(AGENT_EDIT_PLAN);

    const refused = await validateBundled(refusedProject);
    const passed = await validateBundled(control);

    expect(parsePlan(broken).issues.length).toBeGreaterThan(0);
    expect(refused.exitCode).toBe(1);
    expect(refused.stdout).toContain('error: PLAN-demo.md:3: unusable-field:');
    expect(refused.stdout).toContain('a task edits the bundled agent `doc-updater`');
    expect(refused.stdout).toContain(', not written while the plan is refused.');
    expect(refused.stderr).toMatch(/^❌ PLAN-demo\.md: \d+ issues?; the plan does not read as written\n$/u);
    expect(prerequisitesOf(refusedProject)).toBeNull();

    expect(passed.exitCode).toBe(0);
    expect(prerequisitesOf(control)).not.toBeNull();
  });
});

/** A plan carrying migration `plan-ci`, with the collect command its second task spells. */
function storePlan(collect: string): string {
  return [
    '# Stage: one',
    '',
    '- [ ] Add migration `plan-ci`, additive: a new `plan_ci` table',
    `- [ ] Collect over a copy: \`${collect}\``,
    '',
  ].join('\n');
}

/** A PREREQUISITES file holding the schema probe under `[auto]`. */
const PROBED_PREREQUISITES = '## Store [auto]\n'
  + '- [ ] The installed rafa can read and write the live store: `rafa effort schema --check`\n';

/** A fresh root holding `plans/PLAN-demo.md`, and `plans/PREREQUISITES-demo.md` when one is given. */
function plantStorePlan(plan: string, prerequisites: string | null): string {
  const root = mkdtempSync(join(tempBase, 'store-'));
  mkdirSync(join(root, 'plans'));
  writeFileSync(join(root, 'plans', 'PLAN-demo.md'), plan, 'utf8');
  if (prerequisites !== null) writeFileSync(join(root, 'plans', 'PREREQUISITES-demo.md'), prerequisites, 'utf8');
  return root;
}

/** Dispatches `plan validate plans/PLAN-demo.md` in `root`, with `words` added to the line. */
async function validateStorePlan(root: string, words: readonly string[] = []): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return dispatchCaptured(['plan', 'validate', 'plans/PLAN-demo.md', ...words], SUBJECTS, [createPlanValidateCommand(() => root)]);
}

describe('the effort-store rules rafa plan validate checks', () => {
  it('refuses a migration plan with an unprefixed bun src/rafa.ts effort collect, where the prefixed one passes', async () => {
    const bare = plantStorePlan(storePlan('bun src/rafa.ts effort collect'), PROBED_PREREQUISITES);
    const prefixed = plantStorePlan(storePlan('RAFA_EFFORT_DIR=/tmp/copy bun src/rafa.ts effort collect'), PROBED_PREREQUISITES);

    const refused = await validateStorePlan(bare);
    const passed = await validateStorePlan(prefixed, ['--output=json']);

    expect(refused.exitCode).toBe(1);
    expect(refused.stdout).toBe('error: plans/PLAN-demo.md:4: unprefixed-command: runs `bun src/rafa.ts effort collect`'
      + ' without a leading RAFA_EFFORT_DIR=, in a plan that carries a migration; copy the store first with'
      + ' `bun src/rafa.ts effort copy --to=.rafa/scratch/<stub>-effort` and write the command as'
      + ' RAFA_EFFORT_DIR=<absolute path of that dir> bun src/rafa.ts effort collect\n');
    expect(refused.stderr).toBe('❌ plans/PLAN-demo.md: 1 broken effort-store rule; no session would be dispatched\n');
    // The control differs in the prefix alone.
    expect(passed.exitCode).toBe(0);
    expect(eventsOf(passed.stdout).at(-1)).toMatchObject({ type: 'result', ok: true, data: { storeProblems: [] } });
  });

  it('refuses a migration plan whose PREREQUISITES carries no schema probe, naming the file beside the plan', async () => {
    const unprobed = plantStorePlan(storePlan('RAFA_EFFORT_DIR=/tmp/copy bun src/rafa.ts effort collect'), '## Tools [auto]\n');

    const refused = await validateStorePlan(unprobed);

    expect(refused.exitCode).toBe(1);
    expect(refused.stdout).toBe('error: plans/PLAN-demo.md:3: missing-probe: carries a migration, and PREREQUISITES-demo.md'
      + ' holds no [auto] item probing `rafa effort schema --check`; add - [ ] The installed rafa can read and write the'
      + ' live store: `rafa effort schema --check` under an [auto] heading\n');
  });

  it('refuses a plan pinning a store change by number, where one quoting it in a code span passes', async () => {
    const pinned = plantStorePlan('# Stage: one\n\n- [ ] Ship the column as migration 14\n', null);
    const quoted = plantStorePlan('# Stage: one\n\n- [ ] Refuse a spec saying `migration 14`\n', null);

    const refused = await validateStorePlan(pinned, ['--output=json']);
    const passed = await validateStorePlan(quoted);

    expect(refused.exitCode).toBe(1);
    expect(eventsOf(refused.stdout).map(labelOf)).toEqual([
      'start',
      expect.stringContaining('error:plans/PLAN-demo.md:3: pinned-migration: pins a store change by number ("migration 14");'),
      'result',
    ]);
    expect([passed.exitCode, passed.stderr]).toEqual([0, '']);
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
