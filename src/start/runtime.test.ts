/**
 * Tests for `--runtime=<path|version>` (`start/runtime.ts`): the flag
 * read off a line, the runtime a value resolves to, the refusals, the
 * json-mode forwarding of a runtime's events, and a runtime run from
 * another.
 *
 * Every path is under a temporary directory of this file's own: its
 * `home/` stands in for the home a version is looked for under, and its
 * `project/` for the working directory and the project root. A runtime
 * run is a planted `cli.js` that marks itself started, waits as long as
 * the case says, writes the words, working directory and `RAFA_OUTPUT` it
 * was run with to a file beside it, and exits with the code the case
 * names, so a case reads exactly what the runtime was handed. No case
 * runs a real build.
 *
 * The spawned cases run `bun src/rafa.ts loop start` in a scratch git
 * repository that is a project, under a HOME and PATH of its own with a
 * stand-in `claude` first on it. The refusals name a plan that does not
 * exist, so a run that stays in the checkout ends on the missing plan,
 * which is the control showing the refusal came first. One case sends
 * SIGINT to the run once its runtime has started, and reads that the run
 * waited for the runtime and ended with its exit code.
 */
import type { CliEvent, Output } from '../ports/index.js';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { plantScratchRepo, plantStandInClaude, runRafa } from '../tests/cli-capture.js';

import {
  forwardLine,
  isInside,
  refuseMisplacedRuntime,
  resolveRuntime,
  runFromSelectedRuntime,
  runtimeFlagValue,
  throwFailure,
  withoutRuntimeFlag,
} from './runtime.js';
import { NOTHING_DISPATCHED } from './session.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-runtime-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

afterEach(() => {
  setActiveOutput(null);
});

/** How long a spawned case may run. */
const SPAWN_TIMEOUT = 30_000;

/** The CLI entry the spawned cases run. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** A fresh world: a home, and a project directory holding `src/`, each under its own directory. */
function plantWorld(): { scope: string; home: string; project: string } {
  const scope = realpathSync(mkdtempSync(join(tempBase, 'world-')));
  const home = join(scope, 'home');
  const project = join(scope, 'project');
  mkdirSync(join(project, 'src'), { recursive: true });
  mkdirSync(home);
  return { scope, home, project };
}

/**
 * A `cli.js` in `dir` writing `started` beside it, waiting `waitMs`, then
 * recording what it was run with to `record.json` beside it and writing
 * `stdout` before exiting `exitCode`.
 */
function plantRuntime(dir: string, exitCode = 0, stdout: readonly string[] = [], waitMs = 0): string {
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, 'cli.js');
  writeFileSync(entry, [
    'import { writeFileSync } from \'node:fs\';',
    'writeFileSync(new URL(\'./started\', import.meta.url), \'\');',
    `await Bun.sleep(${waitMs});`,
    'writeFileSync(new URL(\'./record.json\', import.meta.url), JSON.stringify({',
    '  argv: process.argv.slice(2), cwd: process.cwd(), output: process.env.RAFA_OUTPUT ?? null,',
    '}));',
    ...stdout.map((line) => `process.stdout.write(${JSON.stringify(`${line}\n`)});`),
    `process.exit(${exitCode});`,
    '',
  ].join('\n'), 'utf8');
  return entry;
}

/** What a planted runtime recorded, or null when it never ran. */
function recordOf(dir: string): { argv: string[]; cwd: string; output: string | null } | null {
  const file = join(dir, 'record.json');
  return existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8')) as { argv: string[]; cwd: string; output: string | null }
    : null;
}

/** The `CommandExit` `run` throws, failing the case when it throws none. */
function exitOf(run: () => unknown): CommandExit {
  try {
    run();
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('threw no CommandExit');
}

/** The `CommandExit` `run` rejects with, failing the case when it rejects with none. */
async function rejectionOf(run: () => Promise<unknown>): Promise<CommandExit> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CommandExit) return error;
    throw error;
  }
  throw new Error('rejected with no CommandExit');
}

/** An output recording what reaches it. */
function recordingOutput(): { output: Output; seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    output: {
      info: (message) => seen.push(`info ${message}`),
      warn: (message) => seen.push(`warn ${message}`),
      error: (message) => seen.push(`error ${message}`),
      debug: (message) => seen.push(`debug ${message}`),
      emit: (event) => seen.push(`emit ${JSON.stringify(event)}`),
      result: (payload) => seen.push(`result ${JSON.stringify(payload)}`),
    },
  };
}

describe('runtimeFlagValue', () => {
  it('answers undefined with no flag, the value of --runtime=, and the empty string for a bare --runtime', () => {
    expect(runtimeFlagValue(['--plan=a.md', '--runtimes=1'])).toBeUndefined();
    expect(runtimeFlagValue(['--plan=a.md', '--runtime=0.2.0'])).toBe('0.2.0');
    expect(runtimeFlagValue(['--runtime', '0.2.0'])).toBe('');
    expect(runtimeFlagValue(['--runtime='])).toBe('');
  });
});

describe('withoutRuntimeFlag', () => {
  it('drops every --runtime word, bare or valued, and keeps the rest in order', () => {
    const args = ['--plan=a.md', '--runtime=0.2.0', '--no-ci-wait', '--runtime', '--runtimes=x'];

    expect(withoutRuntimeFlag(args)).toEqual(['--plan=a.md', '--no-ci-wait', '--runtimes=x']);
    expect(args).toHaveLength(5);
  });
});

describe('refuseMisplacedRuntime', () => {
  it('refuses a runtime flag the words start reads do not carry', () => {
    const exit = exitOf(() => refuseMisplacedRuntime({ runtime: '0.2.0' }, ['--plan=a.md']));

    expect(exit.exitCode).toBe(1);
    expect(exit.message).toContain('only typed after `loop start`');
    expect(exit.message.endsWith(NOTHING_DISPATCHED)).toBe(true);
    expect(exitOf(() => refuseMisplacedRuntime({ runtime: '0.2.0' }, ['-runtime=0.2.0'])).exitCode).toBe(1);
  });

  it('lets through a line with no runtime flag, and one carrying it as start reads it', () => {
    expect(refuseMisplacedRuntime({}, ['--plan=a.md'])).toBeUndefined();
    expect(refuseMisplacedRuntime({ runtime: '0.2.0' }, ['--runtime=0.2.0'])).toBeUndefined();
    expect(refuseMisplacedRuntime({ runtime: true }, ['--runtime'])).toBeUndefined();
  });
});

describe('isInside', () => {
  it('answers true for the directory and anything under it, and false for a sibling sharing its prefix or its parent', () => {
    expect(isInside('/a/src', '/a/src')).toBe(true);
    expect(isInside('/a/src/x/cli.js', '/a/src')).toBe(true);
    expect(isInside('/a/srcx/cli.js', '/a/src')).toBe(false);
    expect(isInside('/a/src/../cli.js', '/a/src')).toBe(false);
    expect(isInside('/a', '/a/src')).toBe(false);
    expect(isInside('/a/src/..x/cli.js', '/a/src')).toBe(true);
  });
});

describe('resolveRuntime', () => {
  it('resolves a version to the cli.js under the home, with its links resolved', () => {
    const { home, project } = plantWorld();
    const entry = plantRuntime(join(home, '.rafa', 'runtime', '0.2.0'));

    const resolved = resolveRuntime('0.2.0', { cwd: project, root: project, home });

    expect(resolved).toBe(realpathSync(entry));
    expect(isInside(resolved, home)).toBe(true);
  });

  it('refuses a version not installed, naming its path and the versions that are', () => {
    const { home, project } = plantWorld();
    plantRuntime(join(home, '.rafa', 'runtime', '0.1.0'));
    mkdirSync(join(home, '.rafa', 'runtime', '0.3.0'));

    const exit = exitOf(() => resolveRuntime('0.2.0', { cwd: project, root: project, home }));

    expect(exit.exitCode).toBe(1);
    expect(exit.message).toContain(join(home, '.rafa', 'runtime', '0.2.0', 'cli.js'));
    expect(exit.message).toContain('holds 0.1.0.');
    expect(exit.message.endsWith(NOTHING_DISPATCHED)).toBe(true);
    expect(exitOf(() => resolveRuntime('0.2.0', { cwd: project, root: project, home: project })).message)
      .toContain('holds no version.');
  });

  it('resolves a path against the working directory: a directory to its cli.js, a file to itself', () => {
    const { scope, home, project } = plantWorld();
    const entry = plantRuntime(join(scope, 'build'));

    expect(resolveRuntime('../build', { cwd: project, root: project, home })).toBe(entry);
    expect(resolveRuntime('../build/cli.js', { cwd: project, root: project, home })).toBe(entry);
    expect(resolveRuntime(join(scope, 'build'), { cwd: home, root: project, home })).toBe(entry);
  });

  it('refuses a path that is no file and no directory holding cli.js, and a value that is empty', () => {
    const { scope, home, project } = plantWorld();
    mkdirSync(join(scope, 'empty'));

    for (const value of ['../absent', '../empty']) {
      const exit = exitOf(() => resolveRuntime(value, { cwd: project, root: project, home }));
      expect(exit.exitCode).toBe(1);
      expect(exit.message).toContain('is neither a file nor a directory holding `cli.js`');
    }
    expect(exitOf(() => resolveRuntime(' ', { cwd: project, root: project, home })).message)
      .toContain('names no runtime');
  });

  it('refuses a runtime inside the working directory src, existing or not, where a sibling directory is let through', () => {
    const { home, project } = plantWorld();
    plantRuntime(join(project, 'src'));
    const sibling = plantRuntime(join(project, 'srcx'));

    for (const value of ['src', 'src/cli.js', './src/../src/absent/cli.js', join(project, 'src', 'rafa.ts')]) {
      const exit = exitOf(() => resolveRuntime(value, { cwd: project, root: project, home }));
      expect(exit.exitCode).toBe(1);
      expect(exit.message).toContain(`inside ${join(project, 'src')}`);
      expect(exit.message.endsWith(NOTHING_DISPATCHED)).toBe(true);
    }
    expect(resolveRuntime('srcx', { cwd: project, root: project, home })).toBe(sibling);
  });

  it('refuses a link outside src resolving into it, and a version whose directory links into it', () => {
    const { scope, home, project } = plantWorld();
    plantRuntime(join(project, 'src', 'dist'));
    symlinkSync(join(project, 'src', 'dist'), join(scope, 'linked'));
    mkdirSync(join(home, '.rafa', 'runtime'), { recursive: true });
    symlinkSync(join(project, 'src', 'dist'), join(home, '.rafa', 'runtime', '0.2.0'));

    expect(exitOf(() => resolveRuntime('../linked', { cwd: project, root: project, home })).message)
      .toContain(`inside ${join(project, 'src')}`);
    expect(exitOf(() => resolveRuntime('0.2.0', { cwd: project, root: project, home })).message)
      .toContain(`inside ${join(project, 'src')}`);
  });

  it('refuses a path outside src naming the directory a linked src resolves to', () => {
    const { scope, home } = plantWorld();
    const project = join(scope, 'linked-project');
    mkdirSync(project);
    plantRuntime(join(scope, 'real-src'));
    symlinkSync(join(scope, 'real-src'), join(project, 'src'));

    const exit = exitOf(() => resolveRuntime('../real-src', { cwd: project, root: project, home }));

    expect(exit.message).toContain(`inside ${join(scope, 'real-src')}`);
  });

  it('refuses the project root src from a working directory beneath it', () => {
    const { home, project } = plantWorld();
    plantRuntime(join(project, 'src'));
    const docs = join(project, 'docs');
    mkdirSync(docs);

    const exit = exitOf(() => resolveRuntime('../src', { cwd: docs, root: project, home }));

    expect(exit.message).toContain(`inside ${join(project, 'src')}`);
  });
});

describe('forwardLine', () => {
  it('emits step and log events, drops start events and blank lines, answers a result, and writes any other line at info', () => {
    const { output, seen } = recordingOutput();
    const ts = '2026-09-15T12:00:00.000Z';
    const log: CliEvent = { type: 'log', level: 'warn', message: 'careful', ts };
    const step: CliEvent = { type: 'step', name: 'task one', ts };
    const result: CliEvent = { type: 'result', ok: false, error: { code: 'command_exit', message: 'no plan' }, ts };

    const answers = [
      forwardLine(JSON.stringify({ type: 'start', command: 'loop start', ts }), output),
      forwardLine(JSON.stringify(log), output),
      forwardLine(JSON.stringify(step), output),
      forwardLine('', output),
      forwardLine('plain text', output),
      forwardLine('{"type":"log","level":"loud","message":"x","ts":"t"}', output),
      forwardLine(JSON.stringify(result), output),
    ];

    expect(answers).toEqual([null, null, null, null, null, null, result]);
    expect(seen).toEqual([
      `emit ${JSON.stringify(log)}`,
      `emit ${JSON.stringify(step)}`,
      'info plain text',
      'info {"type":"log","level":"loud","message":"x","ts":"t"}',
    ]);
  });
});

describe('throwFailure', () => {
  it('returns for exit code 0 with no failed result', () => {
    expect(throwFailure('/r/cli.js', 0, 'text', null)).toBeUndefined();
    expect(throwFailure('/r/cli.js', 0, 'json', { type: 'result', ok: true, ts: 't' })).toBeUndefined();
  });

  it('throws the exit code with no message in text mode, and the result message or the exit in json mode', () => {
    const failed = { type: 'result', ok: false, error: { code: 'command_exit', message: 'no plan' }, ts: 't' } as const;

    expect([exitOf(() => throwFailure('/r/cli.js', 3, 'text', null))].map((e) => [e.exitCode, e.message])).toEqual([[3, '']]);
    expect([exitOf(() => throwFailure('/r/cli.js', 1, 'json', failed))].map((e) => [e.exitCode, e.message])).toEqual([[1, 'no plan']]);
    expect([exitOf(() => throwFailure('/r/cli.js', 0, 'json', failed))].map((e) => e.exitCode)).toEqual([1]);
    expect(exitOf(() => throwFailure('/r/cli.js', 2, 'json', null)).message).toBe('the loop run from /r/cli.js exited 2');
  });
});

describe('runFromSelectedRuntime', () => {
  it('answers false and runs nothing with no flag, and when this process is already the runtime named', async () => {
    const { home, project } = plantWorld();
    const dir = join(home, '.rafa', 'runtime', '0.2.0');
    const entry = plantRuntime(dir);

    expect(await runFromSelectedRuntime({ args: ['--plan=a.md'], root: project, cwd: project, home, currentEntry: entry })).toBe(false);
    expect(await runFromSelectedRuntime({ args: ['--runtime=0.2.0'], root: project, cwd: project, home, currentEntry: entry })).toBe(false);
    expect(recordOf(dir)).toBeNull();
  });

  it('runs another runtime with start and the words but --runtime, in the working directory, and answers true on its success', async () => {
    const { home, project } = plantWorld();
    const dir = join(home, '.rafa', 'runtime', '0.2.0');
    plantRuntime(dir);
    const { output, seen } = recordingOutput();
    setActiveOutput(output, 'text');

    const ran = await runFromSelectedRuntime({
      args: ['--plan=a.md', '--runtime=0.2.0', '--no-ci-wait'],
      root: project,
      cwd: project,
      home,
      currentEntry: join(project, 'src', 'rafa.ts'),
      env: {},
    });

    expect(ran).toBe(true);
    expect(recordOf(dir)).toEqual({ argv: ['start', '--plan=a.md', '--no-ci-wait'], cwd: project, output: 'text' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(`Running the loop from ${realpathSync(join(dir, 'cli.js'))}`);
  });

  it('throws the exit code of a runtime failing in text mode', async () => {
    const { scope, home, project } = plantWorld();
    plantRuntime(join(scope, 'failing'), 3);
    setActiveOutput(recordingOutput().output, 'text');

    const exit = await rejectionOf(() => runFromSelectedRuntime({
      args: ['--runtime=../failing'],
      root: project,
      cwd: project,
      home,
      env: {},
    }));

    expect([exit.exitCode, exit.message]).toEqual([3, '']);
  });

  it('forwards a json-mode runtime events and throws its failed result', async () => {
    const { scope, home, project } = plantWorld();
    const ts = '2026-09-15T12:00:00.000Z';
    const log = { type: 'log', level: 'info', message: 'resuming', ts };
    plantRuntime(join(scope, 'json'), 1, [
      JSON.stringify({ type: 'start', command: 'loop start', ts }),
      JSON.stringify(log),
      JSON.stringify({ type: 'result', ok: false, error: { code: 'command_exit', message: 'Plan file not found' }, ts }),
    ]);
    const { output, seen } = recordingOutput();
    setActiveOutput(output, 'json');

    const exit = await rejectionOf(() => runFromSelectedRuntime({
      args: ['--runtime=../json'],
      root: project,
      cwd: project,
      home,
      env: {},
    }));

    expect([exit.exitCode, exit.message]).toEqual([1, 'Plan file not found']);
    expect(recordOf(join(scope, 'json'))?.output).toBe('json');
    expect(seen.slice(1)).toEqual([`emit ${JSON.stringify(log)}`]);
  });
});

describe('rafa loop start --runtime, spawned', () => {
  it('refuses the scratch checkout src before the plan is looked for, where the same line without the flag meets the missing plan', () => {
    const scratch = plantScratchRepo(tempBase);
    plantStandInClaude(scratch);
    plantRuntime(join(scratch.repo, 'src'));
    const plan = '--plan=.plans/PLAN-absent.md';

    const refused = runRafa(scratch, scratch.repo, ['loop', 'start', '--runtime=src', plan]);
    const control = runRafa(scratch, scratch.repo, ['loop', 'start', plan]);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain(`inside ${join(scratch.repo, 'src')}`);
    expect(refused.stderr).not.toContain('Plan file not found');
    expect(control.exitCode).toBe(1);
    expect(control.stderr).toContain('Plan file not found');
    expect(recordOf(join(scratch.repo, 'src'))).toBeNull();
    expect(existsSync(join(scratch.repo, '.rafa', 'runs'))).toBe(false);
    expect(existsSync(scratch.callLog)).toBe(false);
  }, SPAWN_TIMEOUT);

  it('runs a version under the scratch HOME with the words, passing its exit code on', () => {
    const scratch = plantScratchRepo(tempBase);
    plantStandInClaude(scratch);
    const dir = join(scratch.home, '.rafa', 'runtime', '9.9.9');
    plantRuntime(dir, 4);

    const run = runRafa(scratch, scratch.repo, ['loop', 'start', '--runtime=9.9.9', '--plan=.plans/PLAN-absent.md']);

    expect(run.exitCode).toBe(4);
    expect(recordOf(dir)).toEqual({ argv: ['start', '--plan=.plans/PLAN-absent.md'], cwd: scratch.repo, output: 'text' });
    expect(run.stdout).toContain(`Running the loop from ${join(dir, 'cli.js')}`);
    expect(existsSync(join(scratch.repo, '.rafa', 'runs'))).toBe(false);
  }, SPAWN_TIMEOUT);

  it('holds through a SIGINT sent to it while the runtime runs, ending with the runtime exit code', async () => {
    const scratch = plantScratchRepo(tempBase);
    plantStandInClaude(scratch);
    const dir = join(scratch.home, '.rafa', 'runtime', '9.9.9');
    plantRuntime(dir, 5, [], 1_500);

    const parent = Bun.spawn([process.execPath, RAFA_ENTRY, 'loop', 'start', '--runtime=9.9.9'], {
      cwd: scratch.repo,
      env: { PATH: scratch.path, HOME: scratch.home },
      stdout: 'ignore',
      stderr: 'ignore',
    });
    const deadline = Date.now() + 10_000;
    while (!existsSync(join(dir, 'started')) && Date.now() < deadline) await Bun.sleep(20);
    const startedBeforeSignal = existsSync(join(dir, 'started'));
    parent.kill('SIGINT');
    const exitCode = await parent.exited;

    expect(startedBeforeSignal).toBe(true);
    expect([exitCode, parent.signalCode]).toEqual([5, null]);
    expect(recordOf(dir)?.argv).toEqual(['start']);
  }, SPAWN_TIMEOUT);

  it('refuses a runtime typed ahead of the subject, which the words start reads would not carry', () => {
    const scratch = plantScratchRepo(tempBase);
    plantStandInClaude(scratch);
    const dir = join(scratch.home, '.rafa', 'runtime', '9.9.9');
    plantRuntime(dir);

    const run = runRafa(scratch, scratch.repo, ['--runtime=9.9.9', 'loop', 'start', '--plan=.plans/PLAN-absent.md']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('only typed after `loop start`');
    expect(run.stderr).not.toContain('Plan file not found');
    expect(recordOf(dir)).toBeNull();
  }, SPAWN_TIMEOUT);
});
