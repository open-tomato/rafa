/**
 * Tests for the dispatcher's part in logging: the logger a command runs
 * with, made from the invocation's verbosity and colour, and the gate
 * that lets `warn`, `error` and `debug` through the command's output
 * only when the logger's level allows it. `info` and the result are a
 * command's own answer and are held to pass untouched.
 *
 * Each case dispatches one fixture command over a planted project, so
 * the config the command loads is the file the case wrote.
 */
import type { RafaCommand } from './command.js';
import type { CapturedRun, PlantedProject } from '../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import { activeLogger } from '../adapters/logger/active.js';
import { activeLoggerSettings, DEFAULT_LOGGER_SETTINGS, setActiveLoggerSettings } from '../adapters/logger/settings.js';
import { requireProject, resolveProjectConfig } from '../commands/plan/plan-files.js';
import { projectConfigText } from '../project/scaffold.js';
import { dispatchInProject, eventsOf, plantProject } from '../tests/cli-capture.js';

import { dispatch } from './dispatch.js';
import { createCommandRegistry } from './registry.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-dispatch-logger-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

afterEach(() => {
  setActiveLoggerSettings(null);
});

/** The subject the fixture command sits under. */
const SUBJECTS = [{ name: 'demo', summary: 'a fixture' }];

/** The command's spelling, as its refusals name it. */
const COMMAND_NAME = 'rafa demo run';

/**
 * Loads its project's config, then writes its answer, one warning through
 * its output, and three entries through child loggers.
 */
const DEMO: RafaCommand = Object.freeze({
  name: 'demo run',
  subject: 'demo',
  action: 'run',
  summary: 'a fixture',
  description: 'A fixture.',
  args: [],
  flags: [],
  examples: [{ cmd: 'rafa demo run', note: 'Runs the fixture.' }],
  outputs: ['text', 'json'] as const,
  run: async (context) => {
    resolveProjectConfig(requireProject(context, COMMAND_NAME), COMMAND_NAME, (message) => {
      context.output.warn(message);
    });
    context.output.info('answer');
    context.output.warn('careful');
    activeLogger().child({ module: 'demo' })
      .log({ level: 'debug', message: 'demo-debug' });
    activeLogger().child({ module: 'plan' })
      .log({ level: 'debug', message: 'plan-debug' });
    activeLogger().child({ module: 'demo' })
      .log({ level: 'warn', message: 'demo-warn' });
    if (context.outputMode === 'json') context.output.result({ ok: 1 });
    await Promise.resolve();
  },
});

/** A fresh project whose config ends with `extra`. */
function projectWith(extra = ''): PlantedProject {
  return plantProject(mkdtempSync(join(tempBase, 'case-')), `${projectConfigText()}\n${extra}`);
}

/** `rafa demo run <words>` over `project`. */
async function ran(words: readonly string[], project: PlantedProject, env: Record<string, string> = {}): Promise<CapturedRun> {
  return dispatchInProject(['demo', 'run', ...words], SUBJECTS, [DEMO], project, env);
}

/** `rafa demo run` over `project`, writing to a stream that says it is a terminal. */
async function ranOnTerminal(project: PlantedProject, env: Record<string, string>): Promise<string> {
  const chunks: string[] = [];
  await dispatch(['demo', 'run'], {
    registry: createCommandRegistry({ subjects: SUBJECTS, commands: [DEMO] }),
    env,
    stdout: { isTTY: true, write: (chunk: string) => chunks.push(chunk) },
    stderr: { write: () => true },
    cwd: project.root,
    home: project.home,
  });
  return chunks.join('');
}

describe('a command under the dispatcher, in text mode', () => {
  it('writes its answer, its warning, and a warn entry of its logger, at the defaults', async () => {
    const run = await ran([], projectWith());

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe('answer\nwarn: careful\nwarn: demo: demo-warn\n');
  });

  it('writes its answer alone at logger.level error', async () => {
    const run = await ran([], projectWith('logger:\n  level: error\n'));

    expect(run.stdout).toBe('answer\n');
  });

  it('writes one module\'s debug entries when that module\'s level is debug', async () => {
    const run = await ran([], projectWith('logger:\n  modules:\n    demo: { level: debug }\n'));

    expect(run.stdout).toBe('answer\nwarn: careful\ndebug: demo: demo-debug\nwarn: demo: demo-warn\n');
  });

  it('writes every module\'s debug entries at verbosity 2', async () => {
    const run = await ran(['-v', '-v'], projectWith());

    expect(run.stdout).toBe('answer\nwarn: careful\ndebug: demo: demo-debug\ndebug: plan: plan-debug\nwarn: demo: demo-warn\n');
  });

  it('starts from the default settings, whatever an earlier run left', async () => {
    setActiveLoggerSettings({ ...DEFAULT_LOGGER_SETTINGS, level: 'error' });

    const run = await ran([], projectWith());

    expect(run.stdout).toContain('warn: careful\n');
  });

  it('puts back the settings that were active before it ran', async () => {
    await ran([], projectWith('logger:\n  level: error\n'));

    expect(activeLoggerSettings()).toEqual(DEFAULT_LOGGER_SETTINGS);
  });
});

describe('a command under the dispatcher, in json mode', () => {
  it('emits no warn event at logger.level error, and its result unchanged', async () => {
    const run = await ran(['--output=json'], projectWith('logger:\n  level: error\n'));
    const events = eventsOf(run.stdout);

    expect(events.filter((event) => event.type === 'log' && event.level !== 'info')).toEqual([]);
    expect(events.filter((event) => event.type === 'log')).toMatchObject([{ level: 'info', message: 'answer' }]);
    expect(events.at(-1)).toMatchObject({ type: 'result', ok: true, data: { ok: 1 } });
  });

  it('emits both warnings as log events at the defaults, the logger\'s with its module under fields', async () => {
    const run = await ran(['--output=json'], projectWith());
    const logs = eventsOf(run.stdout).filter((event) => event.type === 'log' && event.level === 'warn');

    expect(logs).toMatchObject([
      { level: 'warn', message: 'careful' },
      { level: 'warn', message: 'demo: demo-warn', fields: { module: 'demo' } },
    ]);
  });
});

describe('colour under the dispatcher', () => {
  it('colours the logger\'s level prefix on a terminal, and nothing else', async () => {
    const out = await ranOnTerminal(projectWith(), {});

    expect(out).toBe('answer\nwarn: careful\n\u001b[33mwarn:\u001b[0m demo: demo-warn\n');
  });

  it('writes no escape code under NO_COLOR, or to a stream that is no terminal', async () => {
    const quiet = await ranOnTerminal(projectWith(), { NO_COLOR: '1' });
    const piped = await ran([], projectWith());

    expect(quiet).not.toContain('\u001b');
    expect(piped.stdout).not.toContain('\u001b');
  });

  it('colours a stream that is no terminal under FORCE_COLOR', async () => {
    const run = await ran([], projectWith(), { FORCE_COLOR: '1' });

    expect(run.stdout).toContain('\u001b[33mwarn:\u001b[0m demo: demo-warn\n');
  });
});
