/**
 * Tests for `lazyCommand` (`lazy.ts`): the lazy command passes the shape
 * check without loading anything, delegates its run to the loaded
 * command with the context it was given, and refuses a rejected load, a
 * default export that is no command and one spelled as another command,
 * each with the message naming the feature and the declared command.
 *
 * Each refusal is held to its whole message, and each case's control is
 * the delegating case, where the same declaration over a well-formed
 * module refuses nothing.
 */
import type { RafaCommand, RafaContext } from './command.js';
import type { CommandDeclaration } from './lazy.js';

import { describe, expect, it } from 'bun:test';

import { CommandExit, commandProblem } from './command.js';
import { lazyCommand } from './lazy.js';

/** The declared command, `loop start`. */
const DECLARATION: CommandDeclaration = {
  name: 'loop start',
  description: 'Starts the loop.',
  subject: 'loop',
  action: 'start',
  summary: 'start the loop',
  args: [],
  flags: [{ name: 'plan', description: 'The plan.', type: 'string' }],
  examples: [{ cmd: 'rafa loop start', note: 'starts the loop' }],
  outputs: ['text', 'json'],
};

/** What every refusal of the declared command opens with. */
const PREFIX = 'feature "loop": command "loop start" failed to load: ';

/** A context the delegated run is held to receive as the same object. */
const CONTEXT = { argv: ['--plan=PLAN-x.md'] } as unknown as RafaContext;

/**
 * The loaded command: the declaration with a run recording each context it is handed.
 *
 * @param overrides - Fields replacing the declaration's.
 * @returns The command and the contexts its run received.
 */
function loadedCommand(overrides: Partial<RafaCommand> = {}): { command: RafaCommand; received: RafaContext[] } {
  const received: RafaContext[] = [];
  const command: RafaCommand = {
    ...DECLARATION,
    run: async (context) => {
      received.push(context);
    },
    ...overrides,
  };
  return { command, received };
}

/**
 * The error a run rejects with, or undefined when it resolves.
 *
 * @param command - The command to run with {@link CONTEXT}.
 * @returns What the run threw.
 */
async function failureOf(command: RafaCommand): Promise<unknown> {
  try {
    await command.run(CONTEXT);
    return undefined;
  } catch (error) {
    return error;
  }
}

/**
 * The exit code and message of a refusal, or what was thrown when it is no `CommandExit`.
 *
 * @param error - What a run threw.
 * @returns The code and message.
 */
function refusalOf(error: unknown): { exitCode: number; message: string } | unknown {
  return error instanceof CommandExit
    ? { exitCode: error.exitCode, message: error.message }
    : error;
}

describe('lazyCommand', () => {
  it('passes the shape check with the declaration\'s fields, loading nothing to build', () => {
    let loads = 0;
    const lazy = lazyCommand(DECLARATION, async () => {
      loads += 1;
      return { default: loadedCommand().command };
    }, 'loop');

    expect(commandProblem(lazy)).toBeNull();
    expect(commandProblem(DECLARATION)).toBe('command "loop start": run is undefined, expected a function');
    const { run, ...declared } = lazy;
    expect(typeof run).toBe('function');
    expect(declared).toEqual(DECLARATION);
    expect(loads).toBe(0);
  });

  it('delegates its run to the loaded command, handing it the context it received', async () => {
    const { command, received } = loadedCommand();
    let loads = 0;
    const lazy = lazyCommand(DECLARATION, async () => {
      loads += 1;
      return { default: command };
    }, 'loop');

    expect(await failureOf(lazy)).toBeUndefined();
    expect(loads).toBe(1);
    expect(received).toHaveLength(1);
    expect(received[0]).toBe(CONTEXT);
  });

  it('lets a refusal of the loaded command through as it was thrown', async () => {
    const thrown = new CommandExit(3, 'deadline passed');
    const { command } = loadedCommand({
      run: async () => {
        throw thrown;
      },
    });

    expect(await failureOf(lazyCommand(DECLARATION, async () => ({ default: command }), 'loop'))).toBe(thrown);
  });

  it('refuses a load that rejects, naming the feature, the command and the rejection', async () => {
    const lazy = lazyCommand(DECLARATION, async () => {
      throw new Error('Cannot find module "./start.js"');
    }, 'loop');

    expect(refusalOf(await failureOf(lazy))).toEqual({
      exitCode: 1,
      message: `${PREFIX}the import rejected: Cannot find module "./start.js"`,
    });
  });

  it('refuses a load that rejects with no Error, quoting what was thrown', async () => {
    const lazy = lazyCommand(DECLARATION, () => Promise.reject('gone'), 'loop');

    expect(refusalOf(await failureOf(lazy))).toEqual({
      exitCode: 1,
      message: `${PREFIX}the import rejected: gone`,
    });
  });

  it('refuses a default export that is no command, with the shape check\'s sentence', async () => {
    const { command, received } = loadedCommand();
    const broken = { ...command, run: 'not a function' };
    const lazy = lazyCommand(DECLARATION, async () => ({ default: broken }), 'loop');

    expect(refusalOf(await failureOf(lazy))).toEqual({
      exitCode: 1,
      message: `${PREFIX}the default export is no command: command "loop start": run is "not a function", expected a function`,
    });
    expect(received).toEqual([]);
  });

  it('refuses a module with no default export', async () => {
    const lazy = lazyCommand(DECLARATION, async () => ({}), 'loop');

    expect(refusalOf(await failureOf(lazy))).toEqual({
      exitCode: 1,
      message: `${PREFIX}the default export is no command: a command is undefined, expected a mapping`,
    });
  });

  it('refuses a default export spelled as another command, running neither', async () => {
    const { command, received } = loadedCommand({ action: 'stop', name: 'loop stop' });
    const lazy = lazyCommand(DECLARATION, async () => ({ default: command }), 'loop');

    expect(refusalOf(await failureOf(lazy))).toEqual({
      exitCode: 1,
      message: `${PREFIX}the default export is command "loop stop", expected "loop start"`,
    });
    expect(received).toEqual([]);
  });

  it('spells a top-level command by its one word in a refusal', async () => {
    const status: CommandDeclaration = { ...DECLARATION, name: 'status', subject: 'status', action: 'status' };
    const { command } = loadedCommand();
    const lazy = lazyCommand(status, async () => ({ default: command }), 'status');

    expect(refusalOf(await failureOf(lazy))).toEqual({
      exitCode: 1,
      message: 'feature "status": command "status" failed to load: '
        + 'the default export is command "loop start", expected "status"',
    });
  });
});
