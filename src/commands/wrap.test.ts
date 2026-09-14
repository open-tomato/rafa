/**
 * Tests for `wrapPhaseZeroCommand` (`src/commands/wrap.ts`): what a
 * wrapped phase 0 command is handed, how it ends, and what the wrapper
 * keeps of its declaration.
 *
 * Each case dispatches a line over a registry holding one wrapped
 * stand-in that records the words it is handed, with streams, an
 * environment and a clock of the case's own. So the handoff is read
 * through the dispatcher that runs it behind `src/rafa.ts`, and no phase
 * 0 command runs.
 *
 * Two cases carry a control run over a command of the same declaration
 * that reads its context directly: the default the declaration fills is
 * in the context the wrapper does not hand on, and pushing onto the
 * context's own `argv` throws, which is what the copy the wrapper hands
 * over prevents.
 *
 * Four mutations of `wrap.ts` were driven on 2026-09-14, one run each
 * over this file, with 8 pass before and after and the module restored
 * byte-identical (sha256). Handing `context.argv` uncopied reddened the
 * copy case, and handing `context.args` in its place reddened four.
 * Dropping the command's promise reddened the two cases on how a command
 * ends and none on what it is handed: the stand-in records its words one
 * microtask after it is called, which is still before `dispatch` answers.
 * Leaving the command unfrozen reddened the case on what the wrapper
 * keeps.
 */
import type { CommandDeclaration, PhaseZeroCommand } from './wrap.js';
import type { OutputStream } from '../adapters/output/stream.js';
import type { RafaCommand } from '../cli/command.js';
import type { DispatchOutcome } from '../cli/dispatch.js';

import { describe, expect, it } from 'bun:test';

import { CommandExit, commandProblem } from '../cli/command.js';
import { dispatch } from '../cli/dispatch.js';
import { createCommandRegistry } from '../cli/registry.js';

import { wrapPhaseZeroCommand } from './wrap.js';

/** The declaration every case wraps: a flag with an alias and a default, and a command alias. */
const DECLARATION: CommandDeclaration = {
  name: 'loop start',
  subject: 'loop',
  action: 'start',
  summary: 'runs the loop',
  description: 'Runs the loop.',
  args: [],
  flags: [{ name: 'plan', description: 'The plan.', type: 'string', aliases: ['p'], default: 'PLAN.md' }],
  examples: [{ cmd: 'rafa loop start', note: 'runs it' }],
  aliases: ['start'],
  outputs: ['text'],
};

/** A stand-in phase 0 command, and every argument list it was handed. */
interface StandIn {
  readonly command: PhaseZeroCommand;
  readonly calls: string[][];
}

/** A stand-in that yields once, then records its words and runs `then`. */
function standIn(then: (args: string[]) => void = () => undefined): StandIn {
  const calls: string[][] = [];
  const command: PhaseZeroCommand = async (args) => {
    await Promise.resolve();
    calls.push(args);
    then(args);
  };
  return { command, calls };
}

/** One invocation, and what it wrote. */
interface Run {
  readonly outcome: DispatchOutcome;
  readonly stdout: string;
  readonly stderr: string;
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

/** Dispatches a line over a registry holding `command` alone. */
async function dispatchOver(command: RafaCommand, argv: readonly string[]): Promise<Run> {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const outcome = await dispatch(argv, {
    registry: createCommandRegistry({ subjects: [{ name: 'loop', summary: 'the loop' }], commands: [command] }),
    env: {},
    stdout: stdout.stream,
    stderr: stderr.stream,
    now: () => new Date('2026-09-14T12:00:00.000Z'),
  });
  return { outcome, stdout: stdout.text(), stderr: stderr.text() };
}

describe('what a wrapped command is handed', () => {
  it('hands the words after its action as typed, and nothing of the line before them', async () => {
    const { command, calls } = standIn();

    const run = await dispatchOver(wrapPhaseZeroCommand(DECLARATION, command), [
      '-v',
      'loop',
      'start',
      '--plan=.plans/PLAN-a.md',
      '--no-ci-wait',
      'extra',
    ]);

    expect(calls).toEqual([['--plan=.plans/PLAN-a.md', '--no-ci-wait', 'extra']]);
    expect(run.outcome.exitCode).toBe(0);
    expect(run.stderr).toBe('');
  });

  it('hands the same words through an alias, after one deprecation line', async () => {
    const { command, calls } = standIn();

    const run = await dispatchOver(wrapPhaseZeroCommand(DECLARATION, command), ['start', '--plan=.plans/PLAN-a.md']);

    expect(calls).toEqual([['--plan=.plans/PLAN-a.md']]);
    expect(run.stderr).toBe('rafa: "rafa start" is deprecated; use "rafa loop start"\n');
    expect(run.outcome.exitCode).toBe(0);
  });

  it('hands a flag spelled as a declared alias as typed, not as the name it declares', async () => {
    const { command, calls } = standIn();

    await dispatchOver(wrapPhaseZeroCommand(DECLARATION, command), ['loop', 'start', '-p', 'PLAN-b.md']);

    expect(calls).toEqual([['-p', 'PLAN-b.md']]);
  });

  it('hands no default the declaration fills, which the context holds', async () => {
    const { command, calls } = standIn();
    let flags: unknown = null;
    const reader: RafaCommand = {
      ...DECLARATION,
      run: async (context) => {
        flags = context.flags;
      },
    };

    await dispatchOver(wrapPhaseZeroCommand(DECLARATION, command), ['loop', 'start']);
    await dispatchOver(reader, ['loop', 'start']);

    expect(calls).toEqual([[]]);
    expect(flags).toEqual({ plan: 'PLAN.md' });
  });

  it('hands a copy of argv the command may change, where the context argv refuses a change', async () => {
    const { command, calls } = standIn((args) => {
      args.push('--pushed');
    });
    const pusher: RafaCommand = {
      ...DECLARATION,
      run: async (context) => {
        (context.argv as string[]).push('--pushed');
      },
    };

    const wrapped = await dispatchOver(wrapPhaseZeroCommand(DECLARATION, command), ['loop', 'start', '--plan=a.md']);
    const control = await dispatchOver(pusher, ['loop', 'start', '--plan=a.md']);

    expect(calls).toEqual([['--plan=a.md', '--pushed']]);
    expect(wrapped.outcome.exitCode).toBe(0);
    expect(control.outcome.exitCode).toBe(1);
    expect(control.outcome.result).toMatchObject({ ok: false, error: { code: 'command_error' } });
  });
});

describe('how a wrapped command ends', () => {
  it('ends with the exit code of a CommandExit the command throws, adding no stderr line for an empty message', async () => {
    const { command } = standIn(() => {
      throw new CommandExit(1);
    });

    const run = await dispatchOver(wrapPhaseZeroCommand(DECLARATION, command), ['loop', 'start']);

    expect(run.outcome.exitCode).toBe(1);
    expect(run.outcome.result).toMatchObject({ ok: false, error: { code: 'command_exit', message: 'exit code 1' } });
    expect(run.stderr).toBe('');
    expect(run.stdout).toBe('');
  });

  it('ends a fault the command throws as command_error', async () => {
    const { command } = standIn(() => {
      throw new Error('boom');
    });

    const run = await dispatchOver(wrapPhaseZeroCommand(DECLARATION, command), ['loop', 'start']);

    expect(run.outcome.exitCode).toBe(1);
    expect(run.outcome.result).toMatchObject({ ok: false, error: { code: 'command_error', message: 'boom' } });
    expect(run.stderr).toBe('rafa: boom\n');
  });
});

describe('what the wrapper keeps', () => {
  it('keeps every field of the declaration, adds run, and freezes the command', () => {
    const wrapped = wrapPhaseZeroCommand(DECLARATION, standIn().command);
    const declared = Object.fromEntries(Object.entries(wrapped).filter(([key]) => key !== 'run'));

    expect(declared).toEqual(DECLARATION);
    expect(typeof wrapped.run).toBe('function');
    expect(Object.isFrozen(wrapped)).toBe(true);
    expect(commandProblem(wrapped)).toBeNull();
    expect(Object.keys(DECLARATION)).not.toContain('run');
  });
});
