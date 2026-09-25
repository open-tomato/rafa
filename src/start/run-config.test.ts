/**
 * Tests for `start/run-config.ts`: the refusal of a detached run —
 * which words ask for one, the refusal they meet, and that `loop start`
 * meets it before it reads anything else — and the `--skills-resolver`
 * flag `loadRunConfig` reads over `task.skills`.
 *
 * `asksDetached` is read over each spelling that asks and beside each near
 * miss that does not: the flag negated, valued `false`, after a `--`, with
 * a longer name, and as the value of another flag.
 *
 * The spawned cases run `bun src/rafa.ts loop start` in a scratch git
 * repository that is a project, under a HOME and PATH of its own with a
 * stand-in `claude` first on it. Both name a plan that does not exist, so
 * the run without the flag, the control, ends on the missing plan: its
 * refusal is what the line meets once nothing refuses it earlier. The run
 * with `-d` ends on the detached refusal instead, and neither leaves a
 * session record or calls the stand-in.
 *
 * The `--skills-resolver` cases load a project with no config file under
 * a home with none, so the default answers wherever the flag is silent.
 * The flag named is `tag`, not the default `planner`, so a reading that
 * ignored the flag would answer `planner` and fail. `--inject` is read
 * beside it, holding the two flags apart: each answers its own setting.
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';
import { ConfigError } from '../config.js';
import { plantScratchRepo, plantStandInClaude, runRafa } from '../tests/cli-capture.js';

import { asksDetached, loadRunConfig, refuseDetachedRun } from './run-config.js';
import { NOTHING_DISPATCHED } from './session.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-run-config-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** How long a spawned case may run. */
const SPAWN_TIMEOUT = 30_000;

/** The first line of the refusal. */
const REFUSAL_HEAD = '❌ Refusing to start detached: `-d|--detached` arrives with phase 6';

describe('asksDetached', () => {
  it.each([
    [['--detached']],
    [['-d']],
    [['--detached=true']],
    [['-d=yes']],
    [['--plan=.plans/PLAN-a.md', '-d', '--no-ci-wait']],
  ])('answers true for %j', (words) => {
    expect(asksDetached(words)).toBe(true);
  });

  it.each([
    [[]],
    [['--no-detached']],
    [['--detached=false']],
    [['-d=false']],
    [['--', '--detached']],
    [['--detachedly']],
    [['-dx']],
    [['--plan=-d']],
  ])('answers false for %j', (words) => {
    expect(asksDetached(words)).toBe(false);
  });
});

describe('refuseDetachedRun', () => {
  it('throws exit code 1 with the whole refusal for a line asking for a detached run', () => {
    let thrown: unknown;
    try {
      refuseDetachedRun(['-d']);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CommandExit);
    const exit = thrown as CommandExit;
    expect(exit.exitCode).toBe(1);
    expect(exit.message.startsWith(REFUSAL_HEAD)).toBe(true);
    expect(exit.message.endsWith(NOTHING_DISPATCHED)).toBe(true);
  });

  it('returns for a line asking for none', () => {
    expect(refuseDetachedRun(['--no-detached', '--plan=.plans/PLAN-a.md'])).toBeUndefined();
  });
});

/** A project and a home, neither holding a config file. */
function bareRoots(): { root: string; home: string } {
  const root = mkdtempSync(join(tempBase, 'project-'));
  const home = mkdtempSync(join(tempBase, 'home-'));
  return { root, home };
}

/** A warning sink that must never be called: no file, so no unknown key. */
function noWarning(message: string): void {
  throw new Error(`unexpected config warning: ${message}`);
}

describe('loadRunConfig and --skills-resolver', () => {
  it('resolves task.skills from --skills-resolver=tag, naming the command line as its source', () => {
    const resolved = loadRunConfig(bareRoots(), ['--skills-resolver=tag'], noWarning);

    expect(resolved.config.taskSkills).toBe('tag');
    expect(resolved.sources.taskSkills).toBe('cli');
  });

  it('leaves task.skills at the default planner without the flag', () => {
    const resolved = loadRunConfig(bareRoots(), ['--plan=.plans/PLAN-a.md'], noWarning);

    expect(resolved.config.taskSkills).toBe('planner');
    expect(resolved.sources.taskSkills).toBe('default');
  });

  it('reads --inject and --skills-resolver each into its own setting', () => {
    const resolved = loadRunConfig(bareRoots(), ['--inject=task', '--skills-resolver=none'], noWarning);

    expect(resolved.config.inject).toBe('task');
    expect(resolved.config.taskSkills).toBe('none');
    expect(resolved.sources.inject).toBe('cli');
    expect(resolved.sources.taskSkills).toBe('cli');
  });

  it('refuses a bare --skills-resolver as an empty value, where the valued control resolves', () => {
    const roots = bareRoots();
    let thrown: unknown;
    try {
      loadRunConfig(roots, ['--skills-resolver'], noWarning);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigError);
    expect((thrown as ConfigError).problems).toEqual([
      'command line: taskSkills is "", expected one of: planner, tag, none',
    ]);
    expect(loadRunConfig(roots, ['--skills-resolver=planner'], noWarning).config.taskSkills).toBe('planner');
  });
});

/** Writes `.rafa/config.yaml` under `dir`. */
function plantConfig(dir: string, body: string): void {
  mkdirSync(join(dir, '.rafa'), { recursive: true });
  writeFileSync(join(dir, '.rafa', 'config.yaml'), body);
}

/** The problems a load refuses with, or fails if it loads. */
function refusal(roots: { root: string; home: string }, args: string[]): readonly string[] {
  try {
    loadRunConfig(roots, args, noWarning);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).problems;
  }
  throw new Error('expected a refusal');
}

describe('loadRunConfig refusals and layers for the task keys', () => {
  it('refuses task.skills: model in the project file, naming the file', () => {
    const roots = bareRoots();
    plantConfig(roots.root, 'task:\n  skills: model\n');

    const problems = refusal(roots, []);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('task.skills is "model", expected one of: planner, tag, none');
  });

  it('refuses --skills-resolver=bogus, naming the command line', () => {
    expect(refusal(bareRoots(), ['--skills-resolver=bogus'])).toEqual([
      'command line: taskSkills is "bogus", expected one of: planner, tag, none',
    ]);
  });

  it('holds --skills-resolver=tag over a project task.skills: none, and the user layer lessons: off under a silent project', () => {
    const roots = bareRoots();
    plantConfig(roots.root, 'task:\n  skills: none\n');
    const over = loadRunConfig(roots, ['--skills-resolver=tag'], noWarning);
    expect(over.config.taskSkills).toBe('tag');
    expect(over.sources.taskSkills).toBe('cli');
    expect(loadRunConfig(roots, [], noWarning).config.taskSkills).toBe('none');

    const silent = bareRoots();
    plantConfig(silent.root, '# nothing set\n');
    plantConfig(silent.home, 'task:\n  lessons: off\n');
    const layered = loadRunConfig(silent, ['--skills-resolver=tag'], noWarning);
    expect(layered.config.taskSkills).toBe('tag');
    expect(layered.config.taskLessons).toBe('off');
    expect(layered.sources.taskLessons).toBe('user');
  });
});

describe('rafa loop start -d, spawned', () => {
  it('refuses before the plan is looked for, where the same line without the flag meets the missing plan', () => {
    const scratch = plantScratchRepo(tempBase);
    plantStandInClaude(scratch);
    const plan = '--plan=.plans/PLAN-absent.md';

    const detached = runRafa(scratch, scratch.repo, ['loop', 'start', '-d', plan]);
    const control = runRafa(scratch, scratch.repo, ['loop', 'start', plan]);

    expect(detached.exitCode).toBe(1);
    expect(detached.stderr.startsWith(REFUSAL_HEAD)).toBe(true);
    expect(detached.stderr).not.toContain('Plan file not found');
    expect(control.exitCode).toBe(1);
    expect(control.stderr).toContain('Plan file not found');
    expect(control.stderr).not.toContain('detached');
    expect(existsSync(join(scratch.repo, '.rafa', 'runs'))).toBe(false);
    expect(existsSync(scratch.callLog)).toBe(false);
  }, SPAWN_TIMEOUT);
});
