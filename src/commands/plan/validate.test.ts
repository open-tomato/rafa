/**
 * Tests for `rafa plan validate` (`validate.ts`): a clean plan and a plan
 * with issues in both modes, the path resolved against the working
 * directory, the refusals, and that the command starts no session.
 *
 * The broken plan carries three issues of three reasons, a header field
 * YAML reads as a comment, a block never closed and an open task line
 * inside it, so a command writing fewer than every issue, or writing them
 * out of line order, differs from what is held.
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
import { parsePlan } from '../../plan/index.js';
import { dispatchCaptured, eventsOf, plantScratchRepo, plantStandInClaude, runRafa } from '../../tests/cli-capture.js';

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
