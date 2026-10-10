/**
 * Tests for the async scope the dispatcher runs a command in
 * (`src/cli/dispatch.ts`, step 5): the running command (`running.ts`)
 * and the active output (`src/adapters/output/active.ts`) each
 * invocation carries, read from inside a command's `run`, and what is
 * left once invocations that overlap have ended. The rest of the
 * dispatcher is `dispatch.test.ts`'s, where no two invocations overlap
 * but the four of its start-event case.
 *
 * ## What overlaps, and in which order
 *
 * Every overlap here is two or more `dispatch` calls started together
 * and awaited with `Promise.all`, ordered by gates the case opens
 * itself, never by a timer: a command waits on a gate another command
 * or an ended invocation opens, so "the first started ends first" is
 * what ran and not what a delay made likely. Each command reads from
 * inside its `run`, after an await, the name of the command recorded as
 * running, whether the active output is its own context's, and the mode.
 * Each invocation has streams of its own, so a line written through the
 * active output is read off the invocation it belongs to.
 *
 * The first started ending FIRST is the order that leaked (#927): with
 * the record set and put back in a `finally`, the first to end put back
 * null under the second, and the second put back the first's record for
 * the rest of the process. The first started ending LAST is the order a
 * stack holds for the two commands, so its case also reads from outside
 * both, between the two endings, where a stack answered the first's.
 * The nested case is the control that an invocation started inside
 * another still reads the inner record inside and the outer one after.
 *
 * ## Red first, and five mutations
 *
 * Run on 2026-10-10 against `dispatch.ts` as it set the module-level
 * values and put the previous ones back in a `finally`, one run over
 * this file: seven cases were red, and two green, the nested case and
 * the one reading values set ahead of an invocation, the two a stack
 * holds. In the first case the first command read the second's record
 * and the second read none.
 *
 * Five mutations of the scoped `dispatch.ts` were driven the same day,
 * one run each over this file, `dispatch.test.ts`,
 * `dispatch-hook.test.ts` and `src/tests/spend-guard-dispatch.test.ts`
 * with 132 pass before, each restored sha256-identical: the command run
 * in no running-command scope reddened 13 cases, in no active-output
 * scope 11, in `text` mode whatever the invocation's 8, recorded with no
 * flags 3, and with the unguarded output as the active one 10.
 *
 * Every command here declares `needsProject: false`, so no case plants a
 * project and none walks up from the suite's working directory. The
 * module-level record and output are reset before each case, so a file
 * bun ran earlier in the process leaves nothing a case could read as
 * left behind, and after each, for the two cases that set them.
 */
import type { RafaCommand, RafaContext, RafaFlagSpec } from './command.js';
import type { DispatchOutcome } from './dispatch.js';
import type { CommandRegistry } from './registry.js';
import type { OutputStream } from '../adapters/output/stream.js';
import type { CliEvent, Output } from '../ports/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { activeOutput, activeOutputMode, setActiveOutput } from '../adapters/output/active.js';
import { createJsonOutput } from '../adapters/output/json.js';

import { CommandExit } from './command.js';
import { dispatch } from './dispatch.js';
import { createCommandRegistry } from './registry.js';
import { restoreRunningCommand, runningCommand, setRunningCommand } from './running.js';

/** What a command read from inside its `run`. */
interface Reading {
  /** The name of the command recorded as running, null when none is. */
  readonly running: string | null;
  /** Whether the active output is the reading command's own context output. */
  readonly own: boolean;
  /** The mode the active output renders in. */
  readonly mode: string;
}

/** What is read outside every invocation. */
interface Left {
  /** The name of the command recorded as running, null when none is. */
  readonly running: string | null;
  /** Whether the active output is the default. */
  readonly defaultOutput: boolean;
  /** The mode the active output renders in. */
  readonly mode: string;
}

/** What a process that ran no command reads. */
const NOTHING: Left = { running: null, defaultOutput: true, mode: 'text' };

/** The default active output, read in `beforeEach` once the module-level one is reset. */
let defaultOutput: Output = activeOutput();

/** The record and the active output as `context`'s command reads them now. */
function readInside(context: RafaContext): Reading {
  return {
    running: runningCommand()?.command.name ?? null,
    own: activeOutput() === context.output,
    mode: activeOutputMode(),
  };
}

/** The record and the active output as a reader outside every invocation reads them now. */
function readOutside(): Left {
  return {
    running: runningCommand()?.command.name ?? null,
    defaultOutput: activeOutput() === defaultOutput,
    mode: activeOutputMode(),
  };
}

/** A promise and the function that settles it, so a case orders its own overlaps. */
function gate(): { readonly opened: Promise<void>; readonly open: () => void } {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** A command under `loop` needing no project, running `run`. */
function probe(action: string, run: RafaCommand['run'], flags: RafaFlagSpec[] = []): RafaCommand {
  return {
    name: `loop ${action}`,
    description: `Runs loop ${action}.`,
    subject: 'loop',
    action,
    summary: `loop ${action}`,
    args: [],
    flags,
    examples: [{ cmd: `rafa loop ${action}`, note: 'runs it' }],
    outputs: ['text', 'json'],
    needsProject: false,
    run,
  };
}

/** A registry of `commands` under the one subject `loop`. */
function registryOf(...commands: RafaCommand[]): CommandRegistry {
  return createCommandRegistry({ subjects: [{ name: 'loop', summary: 'the loop' }], commands });
}

/** A stream of its own, and the text written to it. */
function memoryStream(): { stream: OutputStream; text: () => string } {
  const chunks: string[] = [];
  return {
    stream: {
      write: (chunk) => {
        chunks.push(chunk);
        return true;
      },
    },
    text: () => chunks.join(''),
  };
}

/** One invocation, and what it wrote. */
interface Run {
  readonly outcome: DispatchOutcome;
  readonly stdout: string;
  readonly stderr: string;
}

/** Dispatches `argv` over `registry` with streams of its own and an empty environment. */
async function run(registry: CommandRegistry, argv: readonly string[]): Promise<Run> {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const outcome = await dispatch(argv, { registry, env: {}, stdout: stdout.stream, stderr: stderr.stream });
  return { outcome, stdout: stdout.text(), stderr: stderr.text() };
}

/** The message of every `log` event a json invocation wrote, in order. */
function logLines(stdout: string): string[] {
  return stdout
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as CliEvent)
    .flatMap((event) => (event.type === 'log'
      ? [event.message]
      : []));
}

beforeEach(() => {
  setActiveOutput(null);
  restoreRunningCommand(null);
  defaultOutput = activeOutput();
});

afterEach(() => {
  setActiveOutput(null);
  restoreRunningCommand(null);
});

describe('two commands dispatched at once', () => {
  it('each read their own record and output when the first started ends first, and none is left', async () => {
    const bothRunning = gate();
    const firstEnded = gate();
    const inside: Record<string, Reading> = {};
    const registry = registryOf(
      probe('first', async (context) => {
        await bothRunning.opened;
        inside['first'] = readInside(context);
        activeOutput().info('first line');
      }),
      probe('second', async (context) => {
        bothRunning.open();
        await firstEnded.opened;
        inside['second'] = readInside(context);
        activeOutput().info('second line');
      }),
    );

    const [first, second] = await Promise.all([
      run(registry, ['loop', 'first']).then((ran) => {
        firstEnded.open();
        return ran;
      }),
      run(registry, ['--output=json', 'loop', 'second']),
    ]);

    expect([first.outcome.exitCode, second.outcome.exitCode]).toEqual([0, 0]);
    expect(inside).toEqual({
      first: { running: 'loop first', own: true, mode: 'text' },
      second: { running: 'loop second', own: true, mode: 'json' },
    });
    expect(first.stdout).toBe('first line\n');
    expect(logLines(second.stdout)).toEqual(['second line']);
    expect(readOutside()).toEqual(NOTHING);
  });

  it('each read their own when the first started ends last, a reader outside both reads none between the endings, and none is left', async () => {
    const bothRunning = gate();
    const secondEnded = gate();
    const mayEnd = gate();
    const inside: Record<string, Reading> = {};
    const registry = registryOf(
      probe('first', async (context) => {
        await mayEnd.opened;
        inside['first'] = readInside(context);
        activeOutput().info('first line');
      }),
      probe('second', async (context) => {
        await bothRunning.opened;
        inside['second'] = readInside(context);
        activeOutput().info('second line');
      }),
    );

    const first = run(registry, ['--output=json', 'loop', 'first']);
    const second = run(registry, ['loop', 'second']).then((ran) => {
      secondEnded.open();
      return ran;
    });
    bothRunning.open();
    await secondEnded.opened;
    const between = readOutside();
    mayEnd.open();
    const ran = await Promise.all([first, second]);

    expect(between).toEqual(NOTHING);
    expect(inside).toEqual({
      first: { running: 'loop first', own: true, mode: 'json' },
      second: { running: 'loop second', own: true, mode: 'text' },
    });
    expect(logLines(ran[0].stdout)).toEqual(['first line']);
    expect(ran[1].stdout).toBe('second line\n');
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
  ] as const)('leave none when the first to end %s, and the one still running reads its own', async (_ending, exitCode, end) => {
    const bothRunning = gate();
    const firstEnded = gate();
    let inside: Reading | null = null;
    const registry = registryOf(
      probe('ending', async () => {
        await bothRunning.opened;
        await end();
      }),
      probe('steady', async (context) => {
        bothRunning.open();
        await firstEnded.opened;
        inside = readInside(context);
      }),
    );

    const [ending, steady] = await Promise.all([
      run(registry, ['loop', 'ending']).then((ran) => {
        firstEnded.open();
        return ran;
      }),
      run(registry, ['--output=json', 'loop', 'steady']),
    ]);

    expect([ending.outcome.exitCode, steady.outcome.exitCode]).toEqual([exitCode, 0]);
    expect(inside as Reading | null).toEqual({ running: 'loop steady', own: true, mode: 'json' });
    expect(readOutside()).toEqual(NOTHING);
  });
});

describe('seven commands dispatched at once', () => {
  /** How many invocations overlap, the count the leak was measured at. */
  const COUNT = 7;

  it('each read their own record with its own flags, ending in the order started, and none is left', async () => {
    const allRunning = gate();
    const ended = Array.from({ length: COUNT }, gate);
    const inside: (Reading & { readonly tag: unknown })[] = [];
    let running = 0;
    const registry = registryOf(probe('tagged', async (context) => {
      const tag = Number(context.flags['tag']);
      running += 1;
      if (running === COUNT) allRunning.open();
      await (tag === 0
        ? allRunning.opened
        : ended[tag - 1]?.opened);
      inside[tag] = { ...readInside(context), tag: runningCommand()?.flags['tag'] };
    }, [{ name: 'tag', description: 'Which of the seven.', type: 'string' }]));

    const runs = await Promise.all(ended.map(async (own, tag) => {
      const ran = await run(registry, ['--output=json', 'loop', 'tagged', `--tag=${String(tag)}`]);
      own.open();
      return ran;
    }));

    expect(runs.map((ran) => ran.outcome.exitCode)).toEqual(Array.from({ length: COUNT }, () => 0));
    expect(inside).toEqual(Array.from({ length: COUNT }, (_, tag) => ({
      running: 'loop tagged',
      own: true,
      mode: 'json',
      tag: String(tag),
    })));
    expect(readOutside()).toEqual(NOTHING);
  });
});

describe('a command dispatched inside another', () => {
  it('reads the inner record and output inside, the outer ones after it, and none is left', async () => {
    const read: Reading[] = [];
    let inner: Run | null = null;
    const registry: CommandRegistry = registryOf(
      probe('outer', async (context) => {
        read.push(readInside(context));
        inner = await run(registry, ['--output=json', 'loop', 'inner']);
        read.push(readInside(context));
      }),
      probe('inner', async (context) => {
        await Promise.resolve();
        read.push(readInside(context));
      }),
    );

    const outer = await run(registry, ['loop', 'outer']);

    expect(outer.outcome.exitCode).toBe(0);
    expect((inner as Run | null)?.outcome.exitCode).toBe(0);
    expect(read).toEqual([
      { running: 'loop outer', own: true, mode: 'text' },
      { running: 'loop inner', own: true, mode: 'json' },
      { running: 'loop outer', own: true, mode: 'text' },
    ]);
    expect(readOutside()).toEqual(NOTHING);
  });
});

describe('a set made inside a command', () => {
  it('writes the module-level values: the command still reads its own record and output, and the set ones are read after it', async () => {
    const sentinel = createJsonOutput({ stream: memoryStream().stream });
    const other = probe('other', async () => {});
    let inside: Reading | null = null;
    const registry = registryOf(probe('sets', async (context) => {
      setActiveOutput(sentinel, 'json');
      setRunningCommand(other, {});
      await Promise.resolve();
      inside = readInside(context);
    }));

    const { outcome } = await run(registry, ['loop', 'sets']);

    expect(outcome.exitCode).toBe(0);
    expect(inside as Reading | null).toEqual({ running: 'loop sets', own: true, mode: 'text' });
    expect(activeOutput()).toBe(sentinel);
    expect(activeOutputMode()).toBe('json');
    expect(runningCommand()?.command).toBe(other);
  });

  it('leaves a record and an output set at module level ahead of an invocation as they were, hidden while the command runs', async () => {
    const sentinel = createJsonOutput({ stream: memoryStream().stream });
    const other = probe('other', async () => {});
    let inside: Reading | null = null;
    const registry = registryOf(probe('reads', async (context) => {
      await Promise.resolve();
      inside = readInside(context);
    }));
    setActiveOutput(sentinel, 'json');
    setRunningCommand(other, {});

    const { outcome } = await run(registry, ['loop', 'reads']);

    expect(outcome.exitCode).toBe(0);
    expect(inside as Reading | null).toEqual({ running: 'loop reads', own: true, mode: 'text' });
    expect(activeOutput()).toBe(sentinel);
    expect(activeOutputMode()).toBe('json');
    expect(runningCommand()?.command).toBe(other);
  });
});
