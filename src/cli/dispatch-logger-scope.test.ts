/**
 * Tests for the logger part of the async scope the dispatcher runs a
 * command in (`src/cli/dispatch.ts`, "The logger"): the active logger
 * (`src/adapters/logger/active.ts`) and the logger settings
 * (`src/adapters/logger/settings.ts`) each invocation carries, read from
 * inside a command's `run`, and what is left once invocations that
 * overlap have ended. The running command and the active output of that
 * scope are `dispatch-scope.test.ts`'s, and what one invocation alone
 * writes through its logger is `dispatch-logger.test.ts`'s.
 *
 * ## What overlaps, and in which order
 *
 * As in `dispatch-scope.test.ts`, every overlap is two or more `dispatch`
 * calls started together and awaited with `Promise.all`, ordered by
 * gates the case opens itself, never by a timer. Two things tell the
 * invocations apart:
 *
 *   - **The settings.** One project is planted, whose config sets
 *     `logger.level: error`. A command that loads it inside its `run`
 *     (`loadConfig`, `src/core/config/config-load.ts`) reads `error`
 *     from then on; a command that loads nothing stays at the default,
 *     `warn`.
 *   - **The logger.** The dispatcher makes each from the invocation's
 *     verbosity, so one run with `-v -v` has `debug` on and one run
 *     without has it off, whatever the settings say.
 *
 * Each command reads, after an await, the level of the active settings
 * and whether the active logger has `warn` and `debug` on. It then
 * writes its answer, one warning through its output, which the
 * dispatcher's gate passes or drops by the active logger, and one `warn`
 * entry through the active logger. Each invocation has streams of its
 * own, so what was written is read off the invocation it belongs to.
 *
 * ## Red first, and five mutations
 *
 * Run on 2026-10-11 against `dispatch.ts` as it set the module-level
 * logger and settings and put the previous ones back in a `finally`,
 * one run over this file: eight cases were red and four green, the two
 * nested cases and the two of a set, which a stack holds. In the first
 * case the command that had loaded `logger.level: error` read `warn`
 * through the other's logger, `debug` on, and the other read a logger
 * with `debug` off.
 *
 * Five mutations of the scoped code were driven the same day, one run
 * each over this file, `dispatch-logger.test.ts`,
 * `dispatch-scope.test.ts` and `dispatch.test.ts` with 129 pass before,
 * each restored sha256-identical: the command run in no settings scope
 * reddened 13 cases, in no logger scope 16, a settings scope starting
 * from the settings around it 2, `setActiveLogger` writing the
 * module-level logger inside a scope 1, and `setActiveLoggerSettings`
 * writing the module-level settings inside a scope 16.
 *
 * The settings left behind are compared with the defaults by value: the
 * stack put a frozen copy of them back, equal and not identical, and a
 * comparison by identity read that as a leak in the four green cases.
 *
 * The module-level logger and settings are reset before and after each
 * case, so a file bun ran earlier in the process leaves nothing a case
 * could read as left behind.
 */
import type { RafaCommand, RafaContext } from '../core/command/index.js';
import type { Logger } from '../ports/index.js';
import type { CapturedRun, PlantedProject } from '../tests/cli-capture.js';

import '../adapter-registry.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { activeLogger, setActiveLogger } from '../adapters/logger/active.js';
import { activeLoggerSettings, DEFAULT_LOGGER_SETTINGS, setActiveLoggerSettings } from '../adapters/logger/settings.js';
import { CommandExit } from '../core/command/index.js';
import { loadConfig } from '../core/config/load.js';
import { projectConfigText } from '../project/scaffold.js';
import { dispatchInProject, plantProject } from '../tests/cli-capture.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-dispatch-logger-scope-')));

/** The one project every case runs in; its config quiets everything but errors. */
const QUIET_PROJECT: PlantedProject = plantProject(tempBase, `${projectConfigText()}\nlogger:\n  level: error\n`);

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The subject every fixture command sits under. */
const SUBJECTS = [{ name: 'demo', summary: 'a fixture' }];

/** The flags that turn `debug` on for an invocation's logger. */
const VERBOSE = ['-v', '-v'] as const;

/** What a command read from inside its `run`. */
interface Reading {
  /** The level of the active settings. */
  readonly level: string;
  /** Whether the active logger has `warn` on. */
  readonly warn: boolean;
  /** Whether the active logger has `debug` on. */
  readonly debug: boolean;
}

/** What is read outside every invocation. */
interface Left {
  /** Whether the active settings read as the defaults do, by value. */
  readonly defaultSettings: boolean;
  /** Whether the active logger is the default. */
  readonly defaultLogger: boolean;
}

/** What a command that loaded the quiet config reads, run with no verbosity flag. */
const QUIETED: Reading = { level: 'error', warn: false, debug: false };

/** What a command that loaded no config reads, run with {@link VERBOSE}. */
const LOUD: Reading = { level: 'warn', warn: true, debug: true };

/** What a process that ran no command reads. */
const NOTHING: Left = { defaultSettings: true, defaultLogger: true };

/** The default active logger, read in `beforeEach` once the module-level one is reset. */
let defaultLogger: Logger = activeLogger();

/** The settings and the logger as a command reads them now. */
function readInside(): Reading {
  const logger = activeLogger();
  return { level: activeLoggerSettings().level, warn: logger.enabled('warn'), debug: logger.enabled('debug') };
}

/** The settings and the logger as a reader outside every invocation reads them now. */
function readOutside(): Left {
  return {
    defaultSettings: isDeepStrictEqual(activeLoggerSettings(), DEFAULT_LOGGER_SETTINGS),
    defaultLogger: activeLogger() === defaultLogger,
  };
}

/** Loads the config of `context`'s project, as a command does inside its `run`. */
async function loadOwnConfig(context: RafaContext): Promise<void> {
  if (context.project === null) throw new Error('the fixture runs inside a project');
  await loadConfig({ root: context.project.root, home: context.project.home }, {}, () => {});
}

/** Writes `name`'s answer, a warning through its output and a `warn` entry through the active logger. */
function speak(context: RafaContext, name: string): void {
  context.output.info(`${name} answer`);
  context.output.warn(`${name} careful`);
  activeLogger().child({ module: 'demo' })
    .log({ level: 'warn', message: `${name} entry` });
}

/** What {@link speak} writes in text mode when nothing is quieted. */
function spoken(name: string): string {
  return `${name} answer\nwarn: ${name} careful\nwarn: demo: ${name} entry\n`;
}

/** What {@link speak} writes in text mode under `logger.level: error`. */
function answerAlone(name: string): string {
  return `${name} answer\n`;
}

/** A promise and the function that settles it, so a case orders its own overlaps. */
function gate(): { readonly opened: Promise<void>; readonly open: () => void } {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** A command under `demo` running `run`. */
function probe(action: string, run: RafaCommand['run']): RafaCommand {
  return {
    name: `demo ${action}`,
    description: `Runs demo ${action}.`,
    subject: 'demo',
    action,
    summary: `demo ${action}`,
    args: [],
    flags: [{ name: 'tag', description: 'Which of several.', type: 'string' }],
    examples: [{ cmd: `rafa demo ${action}`, note: 'runs it' }],
    outputs: ['text', 'json'],
    run,
  };
}

/** Dispatches `demo <words>` over `commands` in the quiet project, with streams of its own. */
async function ran(commands: readonly RafaCommand[], words: readonly string[]): Promise<CapturedRun> {
  return dispatchInProject(['demo', ...words], SUBJECTS, commands, QUIET_PROJECT);
}

beforeEach(() => {
  setActiveLogger(null);
  setActiveLoggerSettings(null);
  defaultLogger = activeLogger();
});

afterEach(() => {
  setActiveLogger(null);
  setActiveLoggerSettings(null);
});

describe('two commands dispatched at once', () => {
  it('each read their own logger and settings when the first started ends first, and the defaults are left', async () => {
    const bothRunning = gate();
    const firstEnded = gate();
    const inside: Record<string, Reading> = {};
    const commands = [
      probe('quiet', async (context) => {
        await loadOwnConfig(context);
        await bothRunning.opened;
        inside['quiet'] = readInside();
        speak(context, 'quiet');
      }),
      probe('loud', async (context) => {
        bothRunning.open();
        await firstEnded.opened;
        inside['loud'] = readInside();
        speak(context, 'loud');
      }),
    ];

    const [quiet, loud] = await Promise.all([
      ran(commands, ['quiet']).then((run) => {
        firstEnded.open();
        return run;
      }),
      ran(commands, ['loud', ...VERBOSE]),
    ]);

    expect([quiet.exitCode, loud.exitCode]).toEqual([0, 0]);
    expect(inside).toEqual({ quiet: QUIETED, loud: LOUD });
    expect(quiet.stdout).toBe(answerAlone('quiet'));
    expect(loud.stdout).toBe(spoken('loud'));
    expect(readOutside()).toEqual(NOTHING);
  });

  it('each read their own when the first started ends last, a reader outside both reads the defaults between the endings, and the defaults are left', async () => {
    const bothRunning = gate();
    const secondEnded = gate();
    const mayEnd = gate();
    const inside: Record<string, Reading> = {};
    const commands = [
      probe('quiet', async (context) => {
        await loadOwnConfig(context);
        await mayEnd.opened;
        inside['quiet'] = readInside();
        speak(context, 'quiet');
      }),
      probe('loud', async (context) => {
        await bothRunning.opened;
        inside['loud'] = readInside();
        speak(context, 'loud');
      }),
    ];

    const quiet = ran(commands, ['quiet']);
    const loud = ran(commands, ['loud', ...VERBOSE]).then((run) => {
      secondEnded.open();
      return run;
    });
    bothRunning.open();
    await secondEnded.opened;
    const between = readOutside();
    mayEnd.open();
    const runs = await Promise.all([quiet, loud]);

    expect(between).toEqual(NOTHING);
    expect(inside).toEqual({ quiet: QUIETED, loud: LOUD });
    expect(runs[0].stdout).toBe(answerAlone('quiet'));
    expect(runs[1].stdout).toBe(spoken('loud'));
    expect(readOutside()).toEqual(NOTHING);
  });

  it('each read their own when the one loading its config starts second and loads while the first waits', async () => {
    const bothRunning = gate();
    const firstEnded = gate();
    const inside: Record<string, Reading> = {};
    const commands = [
      probe('loud', async (context) => {
        await bothRunning.opened;
        inside['loud'] = readInside();
        speak(context, 'loud');
      }),
      probe('quiet', async (context) => {
        await loadOwnConfig(context);
        bothRunning.open();
        await firstEnded.opened;
        inside['quiet'] = readInside();
        speak(context, 'quiet');
      }),
    ];

    const [loud, quiet] = await Promise.all([
      ran(commands, ['loud', ...VERBOSE]).then((run) => {
        firstEnded.open();
        return run;
      }),
      ran(commands, ['quiet']),
    ]);

    expect(inside).toEqual({ quiet: QUIETED, loud: LOUD });
    expect(loud.stdout).toBe(spoken('loud'));
    expect(quiet.stdout).toBe(answerAlone('quiet'));
    expect(readOutside()).toEqual(NOTHING);
  });

  it.each([
    ['throws', 1, async (): Promise<void> => {
      throw new Error('boom');
    }],
    ['refuses with an exit code', 3, async (): Promise<void> => {
      throw new CommandExit(3, 'plan is not ready');
    }],
    ['stops early', 0, async (): Promise<void> => {
      throw new CommandExit(0);
    }],
  ] as const)('leave the defaults when the first to end %s with its config loaded, and the one still running reads its own', async (_ending, exitCode, end) => {
    const bothRunning = gate();
    const firstEnded = gate();
    let inside: Reading | null = null;
    const commands = [
      probe('ending', async (context) => {
        await loadOwnConfig(context);
        await bothRunning.opened;
        await end();
      }),
      probe('steady', async (context) => {
        bothRunning.open();
        await firstEnded.opened;
        inside = readInside();
        speak(context, 'steady');
      }),
    ];

    const [ending, steady] = await Promise.all([
      ran(commands, ['ending']).then((run) => {
        firstEnded.open();
        return run;
      }),
      ran(commands, ['steady', ...VERBOSE]),
    ]);

    expect([ending.exitCode, steady.exitCode]).toEqual([exitCode, 0]);
    expect(inside as Reading | null).toEqual(LOUD);
    expect(steady.stdout).toBe(spoken('steady'));
    expect(readOutside()).toEqual(NOTHING);
  });
});

describe('a command that loads its config inside its run', () => {
  it('has its own warnings quieted by the level it loaded, in json mode too, and a command beside it that loaded none has not', async () => {
    const loaded = gate();
    const besideSpoke = gate();
    const commands = [
      probe('loads', async (context) => {
        speak(context, 'before');
        await loadOwnConfig(context);
        loaded.open();
        await besideSpoke.opened;
        speak(context, 'after');
      }),
      probe('beside', async (context) => {
        await loaded.opened;
        speak(context, 'beside');
        besideSpoke.open();
      }),
    ];

    const [loads, beside, json] = await Promise.all([
      ran(commands, ['loads']),
      ran(commands, ['beside']),
      ran(commands, ['beside', '--output=json']),
    ]);

    expect(loads.stdout).toBe(`${spoken('before')}${answerAlone('after')}`);
    expect(beside.stdout).toBe(spoken('beside'));
    expect(json.stdout.split('\n').filter((line) => line.includes('"level":"warn"'))).toHaveLength(2);
    expect(readOutside()).toEqual(NOTHING);
  });
});

describe('seven commands dispatched at once', () => {
  /** How many invocations overlap, the count #927 was measured at. */
  const COUNT = 7;

  /** How many `-v` the invocation tagged `tag` runs with: none, one or two. */
  const verbosityOf = (tag: number): number => tag % 3;

  /** Whether the invocation tagged `tag` loads the quiet config. */
  const loads = (tag: number): boolean => tag % 2 === 0;

  it('each read their own logger and settings, ending in the order started, and the defaults are left', async () => {
    const allRunning = gate();
    const ended = Array.from({ length: COUNT }, gate);
    const inside: Reading[] = [];
    let running = 0;
    const commands = [probe('tagged', async (context) => {
      const tag = Number(context.flags['tag']);
      if (loads(tag)) await loadOwnConfig(context);
      running += 1;
      if (running === COUNT) allRunning.open();
      await (tag === 0
        ? allRunning.opened
        : ended[tag - 1]?.opened);
      inside[tag] = readInside();
      speak(context, String(tag));
    })];

    const runs = await Promise.all(ended.map(async (own, tag) => {
      const flags = Array.from({ length: verbosityOf(tag) }, () => '-v');
      const run = await ran(commands, ['tagged', `--tag=${String(tag)}`, ...flags]);
      own.open();
      return run;
    }));

    expect(runs.map((run) => run.exitCode)).toEqual(Array.from({ length: COUNT }, () => 0));
    expect(inside).toEqual(Array.from({ length: COUNT }, (_, tag) => ({
      level: loads(tag)
        ? 'error'
        : 'warn',
      warn: !loads(tag),
      debug: verbosityOf(tag) === 2,
    })));
    expect(runs.map((run) => run.stdout)).toEqual(Array.from({ length: COUNT }, (_, tag) => (loads(tag)
      ? answerAlone(String(tag))
      : spoken(String(tag)))));
    expect(readOutside()).toEqual(NOTHING);
  });
});

describe('a command dispatched inside another', () => {
  it('starts from the defaults with its own logger, and the outer one reads its loaded settings and its logger again after it', async () => {
    const read: Reading[] = [];
    let inner: CapturedRun | null = null;
    const commands: RafaCommand[] = [
      probe('outer', async (context) => {
        await loadOwnConfig(context);
        read.push(readInside());
        inner = await ran(commands, ['inner', ...VERBOSE]);
        read.push(readInside());
        speak(context, 'outer');
      }),
      probe('inner', async (context) => {
        await Promise.resolve();
        read.push(readInside());
        speak(context, 'inner');
      }),
    ];

    const outer = await ran(commands, ['outer']);

    expect(outer.exitCode).toBe(0);
    expect(read).toEqual([QUIETED, LOUD, QUIETED]);
    expect((inner as CapturedRun | null)?.stdout).toBe(spoken('inner'));
    expect(outer.stdout).toBe(answerAlone('outer'));
    expect(readOutside()).toEqual(NOTHING);
  });

  it('leaves the outer one at the defaults when the inner one loads the quiet config', async () => {
    const read: Reading[] = [];
    const commands: RafaCommand[] = [
      probe('outer', async (context) => {
        await ran(commands, ['inner']);
        read.push(readInside());
        speak(context, 'outer');
      }),
      probe('inner', async (context) => {
        await loadOwnConfig(context);
        await Promise.resolve();
        read.push(readInside());
      }),
    ];

    const outer = await ran(commands, ['outer', ...VERBOSE]);

    expect(read).toEqual([QUIETED, LOUD]);
    expect(outer.stdout).toBe(spoken('outer'));
    expect(readOutside()).toEqual(NOTHING);
  });
});

describe('a set made inside a command', () => {
  /** A logger with every level off, told apart from any other by identity. */
  function silentLogger(): Logger {
    const logger: Logger = { log: () => {}, child: () => logger, enabled: () => false };
    return logger;
  }

  it('is what that command reads from then on, and nothing of it is left once the command ends', async () => {
    const silent = silentLogger();
    let own = false;
    let level = '';
    const commands = [probe('sets', async (context) => {
      setActiveLogger(silent);
      setActiveLoggerSettings({ ...DEFAULT_LOGGER_SETTINGS, level: 'debug' });
      await Promise.resolve();
      own = activeLogger() === silent;
      level = activeLoggerSettings().level;
      speak(context, 'sets');
    })];

    const run = await ran(commands, ['sets']);

    expect(run.exitCode).toBe(0);
    expect({ own, level }).toEqual({ own: true, level: 'debug' });
    expect(run.stdout).toBe(answerAlone('sets'));
    expect(readOutside()).toEqual(NOTHING);
  });

  it('leaves a logger and settings set at module level ahead of an invocation as they were, hidden while the command runs', async () => {
    const silent = silentLogger();
    const quiet = { ...DEFAULT_LOGGER_SETTINGS, level: 'error' } as const;
    let inside: Reading | null = null;
    const commands = [probe('reads', async (context) => {
      await Promise.resolve();
      inside = readInside();
      speak(context, 'reads');
    })];
    setActiveLogger(silent);
    setActiveLoggerSettings(quiet);

    const run = await ran(commands, ['reads', ...VERBOSE]);

    expect(inside as Reading | null).toEqual(LOUD);
    expect(run.stdout).toBe(spoken('reads'));
    expect(activeLogger()).toBe(silent);
    expect(activeLoggerSettings()).toEqual(quiet);
  });
});
