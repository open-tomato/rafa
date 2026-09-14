/**
 * Tests for the dispatcher (`src/cli/dispatch.ts`): one invocation from
 * its words to its exit code, the events it writes, what a command runs
 * with, and what reaches stderr.
 *
 * Every invocation writes to streams the case hands in, with an empty
 * environment and a fixed clock, so `RAFA_OUTPUT` in the environment
 * running the suite reaches no case, and each start and result event is
 * held to its bytes. The json cases put `--output=json` ahead of the
 * subject, so each also holds that a flag typed there reaches the
 * context.
 *
 * The one-start-one-result case runs every way an invocation can end
 * over NDJSON and parses every line it wrote, and the text cases read
 * the same lines back with no event among them: the control that the
 * events are written in json mode only, and not that nothing is. The
 * deprecation cases read stderr whole, so a line written twice fails,
 * beside the canonical spelling and the help request writing none.
 *
 * The active output is module state, and bun runs every test file in one
 * process, so each case puts the default back after it.
 *
 * No case sets `process.exitCode` in this process. Measured on bun 1.3.14
 * on 2026-09-14: `process.exitCode = 1` followed by `= undefined` leaves
 * it at 1, where Node resets it, and a test file doing that makes
 * `bun test` exit 1 with no failing case. The first draft of the
 * exit-code case restored it that way, and the suites under `src/cli/`
 * read 326 pass, 0 fail, exit 1. That case runs its command in a child
 * process instead, and reads the outcome the child prints and its exit
 * code.
 *
 * Thirteen mutations of `dispatch.ts` were driven on 2026-09-14, one run
 * each over the eight suites under `src/cli/`, with 326 pass and 0 fail
 * before and after and the module restored byte-identical (sha256), and
 * each reddened at least one case. No start event reddened 27, the result
 * event written in text mode 11, no failure line on stderr 5, no
 * deprecation line 4, and the context read without the command spec 3.
 * Two each for a command allowed to emit a result, `CommandExit` 0 read
 * as a failure, the module warnings never written, and the fallback
 * result never written. One each for a second result accepted, the
 * default output put back in place of the previous one, and `argv`
 * handed the whole line. One more for a process exit code a command set
 * read as a failure, run against the child-process case with the suites
 * at exit 0 before and after.
 *
 * The output mode case came after that grid. Two more mutations were
 * driven on 2026-09-15, each restored sha256-identical: the context's
 * output set with no mode, and the invocation's mode put back in place of
 * the previous one. Each reddened that case, and it alone in this file.
 */
import type { RafaCommand, RafaContext } from './command.js';
import type { DispatchOptions, DispatchOutcome } from './dispatch.js';
import type { ModuleImporter } from './modules.js';
import type { OutputStream } from '../adapters/output/stream.js';
import type { CliEvent, Output } from '../ports/index.js';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { activeOutput, activeOutputMode, setActiveOutput } from '../adapters/output/active.js';
import { createJsonOutput } from '../adapters/output/json.js';

import { CommandExit } from './command.js';
import { deprecationLine, dispatch, renderUsage } from './dispatch.js';
import { createCommandRegistry } from './registry.js';
import { routeLine } from './route.js';

/** The directory the dispatcher sits in, which the child probe imports from. */
const CLI_DIR = fileURLToPath(new URL('./', import.meta.url));

/** A temporary directory of this file's own, outside the repository. */
const tempBase = mkdtempSync(join(tmpdir(), 'rafa-dispatch-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The clock every event is stamped from. */
const NOW = new Date('2026-09-14T12:00:00.000Z');

/** What the last command run saw. */
let seen: { context: RafaContext; active: Output } | null = null;

/** A command with every field filled, under a subject and action. */
function command(subject: string, action: string, overrides: Partial<RafaCommand> = {}): RafaCommand {
  return {
    name: `${subject} ${action}`,
    description: `Runs ${subject} ${action}.`,
    subject,
    action,
    summary: `${subject} ${action}`,
    args: [],
    flags: [],
    examples: [{ cmd: `rafa ${subject} ${action}`, note: 'runs it' }],
    outputs: ['text', 'json'],
    run: async (context) => {
      seen = { context, active: activeOutput() };
    },
    ...overrides,
  };
}

const REGISTRY = createCommandRegistry({
  subjects: [
    { name: 'loop', summary: 'the loop' },
    { name: 'plan', summary: 'plans' },
    { name: 'module', summary: 'modules' },
  ],
  commands: [
    command('loop', 'start', {
      aliases: ['start'],
      run: async (context) => {
        seen = { context, active: activeOutput() };
        context.output.info('starting');
        context.output.emit({ type: 'step', name: 'load', ts: NOW.toISOString() });
      },
    }),
    command('loop', 'status', {
      run: async (context) => {
        context.output.result({ tasks: 2 });
      },
    }),
    command('loop', 'refuse', {
      run: async () => {
        throw new CommandExit(3, 'plan is not ready');
      },
    }),
    command('loop', 'quiet', {
      run: async () => {
        throw new CommandExit(2);
      },
    }),
    command('loop', 'early', {
      run: async (context) => {
        context.output.result('stopped');
        throw new CommandExit(0, 'nothing to do');
      },
    }),
    command('loop', 'crash', {
      run: async () => {
        throw new Error('boom');
      },
    }),
    command('loop', 'emit-start', {
      run: async (context) => {
        context.output.emit({ type: 'start', command: 'loop emit-start', ts: NOW.toISOString() });
      },
    }),
    command('loop', 'emit-result', {
      run: async (context) => {
        context.output.emit({ type: 'result', ok: true, ts: NOW.toISOString() });
      },
    }),
    command('loop', 'twice', {
      run: async (context) => {
        context.output.result(1);
        context.output.result(2);
      },
    }),
    command('loop', 'bigint', {
      run: async (context) => {
        context.output.result(10n);
      },
    }),
    command('loop', 'old', { deprecated: { since: '0.2.0', use: 'loop start' } }),
    command('loop', 'spec', {
      flags: [
        { name: 'plan', description: 'The plan.', type: 'string', aliases: ['p'] },
        { name: 'path', description: 'The path.', type: 'string', aliases: ['p'] },
      ],
    }),
    command('plan', 'create', { aliases: ['plan'] }),
    command('module', 'exec', {
      exec: true,
      run: async (context) => {
        context.output.info('exec itself');
      },
    }),
    command('usage', 'usage', {
      args: [{ name: 'stub', description: 'The stub.', type: 'string' }],
      flags: [{ name: 'plan', description: 'The plan.', type: 'string', aliases: ['p'], default: 'PLAN.md' }],
    }),
  ],
});

/** The mounted command a module entry exports. */
const ISSUE_NEXT = command('issue', 'next', {
  run: async (context) => {
    seen = { context, active: activeOutput() };
    context.output.info('next issue');
  },
});

/** Two module entries: one that loads, one whose import fails. */
const MODULES = [
  { name: 'linear', entry: '/modules/linear/commands.ts' },
  { name: 'broken', entry: '/modules/broken/commands.ts' },
];

/** Answers the first entry's commands, and fails every other import. */
const importModule: ModuleImporter = async (entry) => {
  if (entry === MODULES[0]?.entry) return { default: [ISSUE_NEXT] };
  throw new Error('Unexpected token at 3:1');
};

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
  outcome: DispatchOutcome;
  stdout: string;
  stderr: string;
}

/** Dispatches a line over the fixture registry with its own streams, an empty environment and the fixed clock. */
async function run(argv: readonly string[], extra: Partial<DispatchOptions> = {}): Promise<Run> {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const outcome = await dispatch(argv, {
    registry: REGISTRY,
    env: {},
    stdout: stdout.stream,
    stderr: stderr.stream,
    now: () => NOW,
    ...extra,
  });
  return { outcome, stdout: stdout.text(), stderr: stderr.text() };
}

/** Matches a string opening with `prefix`, read as text and not as a pattern. */
function startsWith(prefix: string): unknown {
  return expect.stringMatching(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
}

/** The events a json invocation wrote, one per line, each parsed. */
function eventsOf(stdout: string): CliEvent[] {
  return stdout
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as CliEvent);
}

beforeEach(() => {
  seen = null;
});

afterEach(() => {
  setActiveOutput(null);
});

describe('the events of one invocation', () => {
  it.each([
    ['a command that returns', ['loop', 'start']],
    ['a command giving a result', ['loop', 'status']],
    ['a command refusing with a message', ['loop', 'refuse']],
    ['a command refusing without one', ['loop', 'quiet']],
    ['a command stopping early', ['loop', 'early']],
    ['a command that throws', ['loop', 'crash']],
    ['a command emitting a start', ['loop', 'emit-start']],
    ['a command emitting a result', ['loop', 'emit-result']],
    ['a command giving two results', ['loop', 'twice']],
    ['a result that cannot be written', ['loop', 'bigint']],
    ['a deprecated command', ['loop', 'old']],
    ['an alias', ['start']],
    ['a spec parseArgs refuses', ['loop', 'spec']],
    ['an unknown subject', ['bogus']],
    ['a subject with no action', ['loop']],
    ['the root help', []],
    ['an action help', ['loop', 'start', '--help']],
    ['an exec action run itself', ['module', 'exec']],
    ['a mounted action', ['module', 'exec', 'linear', 'next']],
    ['a module word naming no mount', ['module', 'exec', 'broken', 'next']],
  ])('writes one start first and one result last, every line parsing, for %s', async (_title, argv) => {
    const { outcome, stdout } = await run(['--output=json', ...argv], { modules: MODULES, importModule });

    const events = eventsOf(stdout);

    expect(events.filter((event) => event.type === 'start')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'result')).toHaveLength(1);
    expect(events[0]?.type).toBe('start');
    expect(events.at(-1)).toEqual(outcome.result);
  });

  it.each([
    ['loop start', ['loop', 'start'], 0, { type: 'result', ok: true, ts: NOW.toISOString() }],
    ['loop status', ['loop', 'status'], 0, { type: 'result', ok: true, data: { tasks: 2 }, ts: NOW.toISOString() }],
    [
      'loop refuse',
      ['loop', 'refuse'],
      3,
      { type: 'result', ok: false, error: { code: 'command_exit', message: 'plan is not ready' }, ts: NOW.toISOString() },
    ],
    [
      'loop quiet',
      ['loop', 'quiet'],
      2,
      { type: 'result', ok: false, error: { code: 'command_exit', message: 'exit code 2' }, ts: NOW.toISOString() },
    ],
    ['loop early', ['loop', 'early'], 0, { type: 'result', ok: true, data: 'stopped', ts: NOW.toISOString() }],
    [
      'loop crash',
      ['loop', 'crash'],
      1,
      { type: 'result', ok: false, error: { code: 'command_error', message: 'boom' }, ts: NOW.toISOString() },
    ],
    [
      'loop emit-start',
      ['loop', 'emit-start'],
      1,
      {
        type: 'result',
        ok: false,
        error: {
          code: 'command_error',
          message: 'dispatcher: a command emits no start event; the dispatcher writes the one each invocation has',
        },
        ts: NOW.toISOString(),
      },
    ],
    [
      'loop emit-result',
      ['loop', 'emit-result'],
      1,
      {
        type: 'result',
        ok: false,
        error: {
          code: 'command_error',
          message: 'dispatcher: a command emits no result event; the dispatcher writes the one each invocation has',
        },
        ts: NOW.toISOString(),
      },
    ],
    [
      'loop twice',
      ['loop', 'twice'],
      1,
      {
        type: 'result',
        ok: false,
        error: { code: 'command_error', message: 'dispatcher: refused a second result; a command gives exactly one' },
        ts: NOW.toISOString(),
      },
    ],
    [
      'bogus',
      ['bogus'],
      1,
      {
        type: 'result',
        ok: false,
        error: { code: 'unknown_subject', message: 'unknown subject or command "bogus"' },
        ts: NOW.toISOString(),
      },
    ],
    [
      'loop',
      ['loop'],
      1,
      {
        type: 'result',
        ok: false,
        error: { code: 'missing_action', message: startsWith('"loop" needs an action; one of: start, status,') },
        ts: NOW.toISOString(),
      },
    ],
    ['the root help', [], 0, { type: 'result', ok: true, ts: NOW.toISOString() }],
  ])('ends %s with its exit code and terminal event', async (_title, argv, exitCode, result) => {
    const { outcome, stdout } = await run(['--output=json', ...argv]);

    expect(outcome.exitCode).toBe(exitCode);
    expect(outcome.result).toEqual(result as never);
    expect(eventsOf(stdout).at(-1)).toEqual(result as never);
  });

  it('ends a result JSON cannot hold as result_unwritable, with exit code 1', async () => {
    const { outcome, stdout } = await run(['--output=json', 'loop', 'bigint']);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.result).toMatchObject({
      ok: false,
      error: { code: 'result_unwritable', message: startsWith('the result could not be written: ') },
    });
    expect(eventsOf(stdout)).toHaveLength(2);
  });

  it('ends a command whose spec parseArgs refuses as invalid_spec, without running it', async () => {
    const { outcome } = await run(['--output=json', 'loop', 'spec']);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.result.error).toEqual({
      code: 'invalid_spec',
      message: 'command "loop spec" declares arguments or flags that cannot be read:'
        + ' parseArgs: the spelling "p" names both flag "plan" and flag "path"',
    });
    expect(seen).toBeNull();
  });

  it('names the invocation in its start event as routed, and stamps it from the clock', async () => {
    const starts = await Promise.all([
      ['start', '--plan=x'],
      ['bogus', 'thing'],
      ['module', 'exec', 'linear', 'next'],
      [],
    ].map(async (argv) => eventsOf((await run(['--output=json', ...argv], { modules: MODULES, importModule })).stdout)[0]));

    expect(starts).toEqual([
      { type: 'start', command: 'loop start', ts: NOW.toISOString() },
      { type: 'start', command: 'bogus', ts: NOW.toISOString() },
      { type: 'start', command: 'module exec linear next', ts: NOW.toISOString() },
      { type: 'start', command: 'help', ts: NOW.toISOString() },
    ]);
  });

  it('writes a stopping message as an info line, and the lines a command writes between the two events', async () => {
    const early = eventsOf((await run(['--output=json', 'loop', 'early'])).stdout);
    const start = eventsOf((await run(['--output=json', 'loop', 'start'])).stdout);

    expect(early.map((event) => event.type)).toEqual(['start', 'log', 'result']);
    expect(early[1]).toMatchObject({ type: 'log', level: 'info', message: 'nothing to do' });
    expect(start.map((event) => event.type)).toEqual(['start', 'log', 'step', 'result']);
    expect(start[2]).toEqual({ type: 'step', name: 'load', ts: NOW.toISOString() });
  });

  it('selects json mode from RAFA_OUTPUT when the line names no output', async () => {
    const { stdout } = await run(['loop', 'start'], { env: { RAFA_OUTPUT: 'json' } });

    expect(eventsOf(stdout).map((event) => event.type)).toEqual(['start', 'log', 'step', 'result']);
  });
});

describe('text mode', () => {
  it('writes what the command writes and no event', async () => {
    const { outcome, stdout, stderr } = await run(['loop', 'start']);

    expect(stdout).toBe('starting\nstep: load\n');
    expect(stderr).toBe('');
    expect(outcome.exitCode).toBe(0);
    expect(outcome.result).toEqual({ type: 'result', ok: true, ts: NOW.toISOString() });
  });

  it('writes a result the command gave as the text adapter writes one', async () => {
    const { stdout } = await run(['loop', 'status']);

    expect(stdout).toBe('result: {"tasks":2}\n');
  });

  it.each([
    ['a refusal with a message, as the command gave it', ['loop', 'refuse'], 3, 'plan is not ready\n'],
    ['a refusal without one, as nothing', ['loop', 'quiet'], 2, ''],
    ['a thrown error, named by rafa', ['loop', 'crash'], 1, 'rafa: boom\n'],
    ['an unknown subject, named by rafa', ['bogus'], 1, 'rafa: unknown subject or command "bogus"\n'],
    [
      'a spec parseArgs refuses, named by rafa',
      ['loop', 'spec'],
      1,
      'rafa: command "loop spec" declares arguments or flags that cannot be read:'
        + ' parseArgs: the spelling "p" names both flag "plan" and flag "path"\n',
    ],
  ])('writes %s to stderr and nothing to stdout', async (_title, argv, exitCode, stderrText) => {
    const { outcome, stdout, stderr } = await run(argv);

    expect(outcome.exitCode).toBe(exitCode);
    expect(stderr).toBe(stderrText);
    expect(stdout).toBe('');
  });

  it('writes the stack of a thrown error as a debug line at verbosity 2', async () => {
    const { stdout, stderr } = await run(['--verbose=2', 'loop', 'crash']);

    expect(stdout.startsWith('debug: Error: boom\n')).toBe(true);
    expect(stderr).toBe('rafa: boom\n');
  });

  it('writes the default usage line for a help request, and the text a renderer answers when one is handed in', async () => {
    const requests: string[] = [];
    const plain = await run([]);
    const rendered = await run(['help', 'loop'], {
      renderHelp: (request, registry) => {
        requests.push(request.level);
        return `${registry.actionsOf('loop').length} actions\n`;
      },
    });

    expect(plain.stdout).toBe(renderUsage({ level: 'root' }));
    expect(plain.stdout).toBe('usage: rafa <subject> <action> [args] [flags]\n');
    expect(rendered.stdout).toBe(`${REGISTRY.actionsOf('loop').length} actions\n`);
    expect(requests).toEqual(['subject']);
  });

  it('writes no help text in json mode, only the two events', async () => {
    const { stdout } = await run(['--output=json', 'loop', '--help']);

    expect(eventsOf(stdout).map((event) => event.type)).toEqual(['start', 'result']);
  });

  it('writes a usage line for each help level by default', () => {
    const route = routeLine(REGISTRY, ['help', 'loop', 'start']);
    const request = route.kind === 'help'
      ? route.request
      : null;

    expect(request === null
      ? null
      : renderUsage(request)).toBe('usage: rafa loop start [args] [flags]\n');
    expect(renderUsage({ level: 'subject', subject: { name: 'loop', summary: 'the loop' } }))
      .toBe('usage: rafa loop <action> [args] [flags]\n');
  });
});

describe('deprecation lines', () => {
  it.each([
    ['an alias', ['start'], 'rafa: "rafa start" is deprecated; use "rafa loop start"\n'],
    ['an alias spelled as a subject', ['plan', '--spec=x.md'], 'rafa: "rafa plan" is deprecated; use "rafa plan create"\n'],
    ['a deprecated command', ['loop', 'old'], 'rafa: "rafa loop old" is deprecated since 0.2.0; use "rafa loop start"\n'],
    ['the canonical spelling', ['loop', 'start'], ''],
    ['a help request naming an alias', ['start', '--help'], ''],
  ])('writes one line to stderr, or none, for %s in text mode', async (_title, argv, stderrText) => {
    const { stderr } = await run(argv);

    expect(stderr).toBe(stderrText);
  });

  it('writes the line once to stderr in json mode, keeping stdout to its events', async () => {
    const { stdout, stderr } = await run(['--output=json', 'start']);

    expect(stderr).toBe('rafa: "rafa start" is deprecated; use "rafa loop start"\n');
    expect(eventsOf(stdout).map((event) => event.type)).toEqual(['start', 'log', 'step', 'result']);
  });

  it('answers no line for a command reached by its own spelling', () => {
    const route = routeLine(REGISTRY, ['loop', 'start']);

    expect(route.kind === 'command'
      ? deprecationLine(route)
      : 'not a command').toBeNull();
  });

  it('names a deprecated command reached through an alias once, with the version and the declared use', () => {
    const registry = createCommandRegistry({
      subjects: [{ name: 'loop', summary: 'the loop' }],
      commands: [command('loop', 'begin', { aliases: ['begin'], deprecated: { since: '0.2.0', use: 'loop start' } })],
    });
    const route = routeLine(registry, ['begin']);

    expect(route.kind === 'command'
      ? deprecationLine(route)
      : null).toBe('rafa: "rafa begin" is deprecated since 0.2.0; use "rafa loop start"');
  });
});

describe('what a command runs with', () => {
  it('hands the words after its action as argv, and the rest of the line to args and flags', async () => {
    await run(['-v', 'loop', 'start', '--plan=x', 'extra']);

    expect(seen?.context.argv).toEqual(['--plan=x', 'extra']);
    expect(seen?.context.args).toEqual(['extra']);
    expect(seen?.context.flags).toEqual({ v: true, plan: 'x' });
    expect(seen?.context.verbosity).toBe(1);
    expect(seen?.context.outputMode).toBe('text');
    expect(Object.isFrozen(seen?.context)).toBe(true);
    expect(Object.isFrozen(seen?.context.argv)).toBe(true);
  });

  it('reads the line against the command spec, its aliases and defaults', async () => {
    await run(['usage']);
    const defaults = seen?.context;
    await run(['usage', 'stub-a', '-p', 'OTHER.md']);
    const given = seen?.context;

    expect(defaults?.flags).toEqual({ plan: 'PLAN.md' });
    expect(given?.flags).toEqual({ plan: 'OTHER.md' });
    expect(given?.args).toEqual(['stub-a']);
    expect(given?.argv).toEqual(['stub-a', '-p', 'OTHER.md']);
  });

  it('hands the registry the line was routed through: the caller one with no module, and one holding the mount otherwise', async () => {
    await run(['loop', 'start']);
    const bare = seen?.context.registry;
    await run(['loop', 'start'], { modules: MODULES, importModule });
    const mounted = seen?.context.registry;

    expect(bare).toBe(REGISTRY);
    expect(REGISTRY.mounts()).toEqual([]);
    expect(mounted).not.toBe(REGISTRY);
    expect(mounted?.mounts().map((mount) => [mount.name, mount.commands])).toEqual([['linear', [ISSUE_NEXT]]]);
  });

  it('hands a mounted action the words after its module action', async () => {
    const { stdout, stderr } = await run(['module', 'exec', 'linear', 'next', '--since=today'], { modules: MODULES, importModule });

    expect(seen?.context.argv).toEqual(['--since=today']);
    expect(stdout).toBe(
      'warn: module "broken": skipped "/modules/broken/commands.ts": import failed: Unexpected token at 3:1\nnext issue\n',
    );
    expect(stderr).toBe('');
  });

  it('runs an exec action itself when the line names no module', async () => {
    const { stdout } = await run(['module', 'exec']);

    expect(stdout).toBe('exec itself\n');
  });

  it('hands the signal it was given', async () => {
    const controller = new AbortController();

    await run(['loop', 'start'], { signal: controller.signal });

    expect(seen?.context.signal).toBe(controller.signal);
  });

  it('writes each module warning at warn level after the start event', async () => {
    const { stdout } = await run(['--output=json', 'loop', 'start'], { modules: MODULES, importModule });

    const events = eventsOf(stdout);

    expect(events.map((event) => event.type)).toEqual(['start', 'log', 'log', 'step', 'result']);
    expect(events[1]).toMatchObject({
      type: 'log',
      level: 'warn',
      message: 'module "broken": skipped "/modules/broken/commands.ts": import failed: Unexpected token at 3:1',
    });
  });
});

describe('the active output and the exit code', () => {
  it('sets the context output as the active output while the command runs, and puts the previous one back', async () => {
    const sentinel = createJsonOutput({ stream: memoryStream().stream });
    setActiveOutput(sentinel);

    await run(['loop', 'start']);

    expect(seen?.active).toBe(seen?.context.output);
    expect(seen?.active).not.toBe(sentinel);
    expect(activeOutput()).toBe(sentinel);
  });

  it('puts the previous output back when the command throws', async () => {
    const before = activeOutput();

    await run(['loop', 'crash']);

    expect(activeOutput()).toBe(before);
  });

  it('sets the invocation output mode beside the active output while the command runs, and puts the previous mode back', async () => {
    const during: string[] = [];
    const after: string[] = [];
    const registry = createCommandRegistry({
      subjects: [{ name: 'loop', summary: 'the loop' }],
      commands: [command('loop', 'mode', {
        run: async () => {
          during.push(activeOutputMode());
        },
      })],
    });

    setActiveOutput(createJsonOutput({ stream: memoryStream().stream }), 'json');
    await run(['loop', 'mode'], { registry });
    after.push(activeOutputMode());

    setActiveOutput(null);
    await run(['--output=json', 'loop', 'mode'], { registry });
    after.push(activeOutputMode());

    expect(during).toEqual(['text', 'json']);
    expect(after).toEqual(['json', 'text']);
  });

  it('reads no process exit code a command sets, ending that command as a success, in a process of its own', () => {
    const cwd = mkdtempSync(join(tempBase, 'exit-code-'));
    writeFileSync(join(cwd, 'probe.ts'), [
      `const { dispatch } = await import(${JSON.stringify(join(CLI_DIR, 'dispatch.ts'))});`,
      `const { createCommandRegistry } = await import(${JSON.stringify(join(CLI_DIR, 'registry.ts'))});`,
      'const registry = createCommandRegistry({',
      '  subjects: [{ name: "loop", summary: "the loop" }],',
      '  commands: [{',
      '    name: "loop exit-code", description: "Sets the exit code.", subject: "loop", action: "exit-code",',
      '    summary: "sets it", args: [], flags: [], examples: [], outputs: ["text"],',
      '    run: async () => { process.exitCode = 1; },',
      '  }],',
      '});',
      'const sink = { write: () => true };',
      'const outcome = await dispatch(["loop", "exit-code"], { registry, env: {}, stdout: sink, stderr: sink });',
      'console.log(JSON.stringify({ exitCode: outcome.exitCode, ok: outcome.result.ok, processExitCode: process.exitCode ?? null }));',
      '',
    ].join('\n'));

    const child = Bun.spawnSync([process.execPath, 'probe.ts'], { cwd, env: {} });
    const lines = child.stdout
      .toString()
      .trimEnd()
      .split('\n');

    expect(cwd.startsWith(tempBase)).toBe(true);
    expect(child.stderr.toString()).toBe('');
    expect(JSON.parse(lines.at(-1) ?? 'null')).toEqual({ exitCode: 0, ok: true, processExitCode: 1 });
    expect(child.exitCode).toBe(1);
  });

  it('sets no process exit code, whatever the invocation ends with', async () => {
    const before = process.exitCode;

    const { outcome } = await run(['loop', 'refuse']);

    expect(outcome.exitCode).toBe(3);
    expect(process.exitCode).toBe(before);
  });
});
