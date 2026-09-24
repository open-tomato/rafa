/**
 * Tests for the dispatcher's command hook (`src/cli/dispatch.ts`, "The
 * command hook"): which invocations call it, where its line goes, when
 * each half runs against the command and the terminal event, and that a
 * half that fails is a `debug` line and nothing more. The rest of the
 * dispatcher is `dispatch.test.ts`'s, which runs with no hook handed in.
 *
 * Every case hands in a hook that appends each call to one log, and a
 * command that appends to the same log as it runs, so the order the
 * three ran in is read from one array. Every invocation here runs with
 * the working directory and the home of a project planted in this file's
 * temporary directory, and a case outside a project hands a sibling
 * directory, so no case walks up from the suite's own working directory.
 *
 * Every case that says a half was NOT called runs beside a control that
 * the same hook is called for a plain command of the same registry in
 * the same mode, so an empty log is read against one the hook filled.
 *
 * Five mutations of `dispatch.ts` were driven on 2026-09-24, one run
 * each over this file with 25 pass before, each restored
 * sha256-identical, and each reddened at least one case: the hook called
 * in json mode 2, a failed half rethrown 6, the line never written 5,
 * `after` never called 9, and the hook called with no project 2. That
 * last one first stayed green: the recording hook read `project.root`
 * before it logged, so the throw was swallowed as a `debug` line and the
 * call went unseen. {@link callOf} now reads the project as possibly
 * null, and the dispatcher's second check on it, which no case could
 * tell apart from the first, went.
 */
import type { RafaCommand } from './command.js';
import type { CommandHook, DispatchOptions, DispatchOutcome } from './dispatch.js';
import type { CommandRoute } from './route.js';
import type { OutputStream } from '../adapters/output/stream.js';
import type { ProjectFound } from '../project/scope.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { plantProjectConfig } from '../tests/cli-capture.js';

import { CommandExit } from './command.js';
import { dispatch } from './dispatch.js';
import { createCommandRegistry } from './registry.js';
import { restoreRunningCommand } from './running.js';

/** A temporary directory of this file's own, outside the repository. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-dispatch-hook-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A project of this file's own, its root holding `.rafa/config.yaml`. */
const PROJECT = join(tempBase, 'project');

/** The home every invocation passes over, beside the project. */
const HOME = join(tempBase, 'home');

/** A directory no project holds, beside the project. */
const OUTSIDE = join(tempBase, 'outside');

plantProjectConfig(PROJECT);
for (const dir of [HOME, OUTSIDE]) mkdirSync(dir, { recursive: true });

/** The clock every event is stamped from. */
const NOW = new Date('2026-09-24T12:00:00.000Z');

/** The line the recording hook's `before` answers unless a case says otherwise. */
const NOTICE = 'rafa: since your last command: 1 worktree went idle; run rafa cleanup';

/** One call the log holds: a hook half with the route's label and the project's root, or the command running. */
type Call =
  | { readonly kind: 'before' | 'after'; readonly label: string; readonly root: string }
  | { readonly kind: 'run'; readonly label: string };

/** Every call of the current case, in the order made. */
let log: Call[] = [];

/** A command with every field filled, under a subject and action, that logs its run. */
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
    run: async () => {
      log.push({ kind: 'run', label: `${subject} ${action}` });
    },
    ...overrides,
  };
}

/** Logs its run, then runs `then`. */
function logging(label: string, then: () => void): RafaCommand['run'] {
  return async () => {
    log.push({ kind: 'run', label });
    then();
  };
}

const REGISTRY = createCommandRegistry({
  subjects: [{ name: 'loop', summary: 'the loop' }],
  commands: [
    command('loop', 'start'),
    command('loop', 'status', {
      run: async (context) => {
        log.push({ kind: 'run', label: 'loop status' });
        context.output.result({ tasks: 2 });
      },
    }),
    command('loop', 'refuse', {
      run: logging('loop refuse', () => {
        throw new CommandExit(3, 'plan is not ready');
      }),
    }),
    command('loop', 'crash', {
      run: logging('loop crash', () => {
        throw new Error('boom');
      }),
    }),
    command('loop', 'old', { deprecated: { since: '0.2.0', use: 'loop start' } }),
    command('loop', 'spec', {
      flags: [
        { name: 'plan', description: 'The plan.', type: 'string', aliases: ['p'] },
        { name: 'path', description: 'The path.', type: 'string', aliases: ['p'] },
      ],
    }),
    command('init', 'init', { needsProject: false }),
  ],
});

/** How the recording hook's halves answer. */
interface HookScript {
  /** What `before` answers, or a function it throws from. Defaults to {@link NOTICE}. */
  readonly before?: string | null | (() => never);
  /** A function `after` throws from, or nothing. */
  readonly after?: () => never;
}

/**
 * The part of a call a route and a project give. The project is read as
 * possibly null, although the type says otherwise, so a dispatcher that
 * called the hook with none is logged rather than throwing here, where
 * the throw would be swallowed and the call never seen.
 */
function callOf(kind: 'before' | 'after', route: CommandRoute, project: ProjectFound): Call {
  const found = project as ProjectFound | null;
  return { kind, label: route.label, root: found?.root ?? '(no project)' };
}

/** A hook logging each call, answering as `script` says. */
function recordingHook(script: HookScript = {}): CommandHook {
  return {
    before: async (route, project) => {
      log.push(callOf('before', route, project));
      const answer = script.before === undefined
        ? NOTICE
        : script.before;
      return typeof answer === 'function'
        ? answer()
        : answer;
    },
    after: async (route, project) => {
      log.push(callOf('after', route, project));
      script.after?.();
    },
  };
}

/** A stream of its own, the text written to it, and a hook into each write. */
function memoryStream(onWrite: (chunk: string) => void = () => undefined): { stream: OutputStream; text: () => string } {
  const chunks: string[] = [];
  return {
    stream: {
      write: (chunk) => {
        onWrite(chunk);
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
  /** The log as it stood when the first chunk reached stdout, or null when nothing did. */
  readonly logAtStdout: readonly Call[] | null;
}

/** Dispatches a line over the fixture registry with `hook`, its own streams, an empty environment and the fixed clock. */
async function run(argv: readonly string[], hook: CommandHook | undefined, extra: Partial<DispatchOptions> = {}): Promise<Run> {
  let logAtStdout: Call[] | null = null;
  const stdout = memoryStream(() => {
    logAtStdout ??= [...log];
  });
  const stderr = memoryStream();
  const outcome = await dispatch(argv, {
    registry: REGISTRY,
    env: {},
    stdout: stdout.stream,
    stderr: stderr.stream,
    now: () => NOW,
    cwd: PROJECT,
    home: HOME,
    ...(hook === undefined
      ? {}
      : { commandHook: hook }),
    ...extra,
  });
  return { outcome, stdout: stdout.text(), stderr: stderr.text(), logAtStdout };
}

beforeEach(() => {
  log = [];
});

afterEach(() => {
  setActiveOutput(null);
  restoreRunningCommand(null);
});

describe('a command that runs inside a project, in text mode', () => {
  it('calls before, runs the command, then calls after, each with the route and the project', async () => {
    const { outcome } = await run(['loop', 'start'], recordingHook());

    expect(outcome.exitCode).toBe(0);
    expect(log).toEqual([
      { kind: 'before', label: 'loop start', root: PROJECT },
      { kind: 'run', label: 'loop start' },
      { kind: 'after', label: 'loop start', root: PROJECT },
    ]);
  });

  it('writes the line before answers to stderr, with a newline, and nothing to stdout', async () => {
    const { stdout, stderr } = await run(['loop', 'start'], recordingHook());

    expect(stderr).toBe(`${NOTICE}\n`);
    expect(stdout).toBe('');
  });

  it('writes nothing when before answers null, and still calls after', async () => {
    const { stderr } = await run(['loop', 'start'], recordingHook({ before: null }));

    expect(stderr).toBe('');
    expect(log.map((call) => call.kind)).toEqual(['before', 'run', 'after']);
  });

  it('writes the line ahead of the command\'s deprecation line', async () => {
    const { stderr } = await run(['loop', 'old'], recordingHook());

    expect(stderr).toBe(`${NOTICE}\nrafa: "rafa loop old" is deprecated since 0.2.0; use "rafa loop start"\n`);
  });

  it('calls after before the result a command gave is written', async () => {
    const { stdout, logAtStdout } = await run(['loop', 'status'], recordingHook());

    expect(stdout).toContain('tasks');
    expect(logAtStdout?.map((call) => call.kind)).toEqual(['before', 'run', 'after']);
  });

  it.each([
    ['refuses with an exit code', ['loop', 'refuse'], 3, 'plan is not ready\n'],
    ['throws', ['loop', 'crash'], 1, 'rafa: boom\n'],
  ])('calls after for a command that %s, and keeps its exit code and stderr line', async (_how, argv, exitCode, line) => {
    const { outcome, stderr } = await run(argv, recordingHook());

    expect(outcome.exitCode).toBe(exitCode);
    expect(stderr).toBe(`${NOTICE}\n${line}`);
    expect(log.map((call) => call.kind)).toEqual(['before', 'run', 'after']);
  });

  it('calls the hook for a command run from a subdirectory with the project root', async () => {
    const sub = join(PROJECT, 'sub');
    mkdirSync(sub, { recursive: true });

    await run(['loop', 'start'], recordingHook(), { cwd: sub });

    expect(log[0]).toEqual({ kind: 'before', label: 'loop start', root: PROJECT });
  });
});

describe('an invocation the hook is not called for', () => {
  it('calls it for a plain command in the same registry, the control for the cases below', async () => {
    await run(['loop', 'start'], recordingHook());

    expect(log.filter((call) => call.kind !== 'run')).toHaveLength(2);
  });

  it.each([
    ['a help request', ['loop', 'start', '--help'], 0],
    ['a version request', ['--version'], 0],
    ['a routing refusal', ['nope'], 1],
    ['a spec that cannot be read', ['loop', 'spec'], 1],
    ['a command declaring needsProject: false', ['init'], 0],
  ])('calls neither half for %s', async (_what, argv, exitCode) => {
    const { outcome, stderr } = await run(argv, recordingHook());

    expect(outcome.exitCode).toBe(exitCode);
    expect(log.filter((call) => call.kind !== 'run')).toEqual([]);
    expect(stderr).not.toContain(NOTICE);
  });

  it('calls neither half for no_project, and the command never runs', async () => {
    const { outcome, stderr } = await run(['loop', 'start'], recordingHook(), { cwd: OUTSIDE });

    expect(outcome.result.error?.code).toBe('no_project');
    expect(log).toEqual([]);
    expect(stderr).not.toContain(NOTICE);
  });

  it('runs a command declaring needsProject: false all the same', async () => {
    await run(['init'], recordingHook());

    expect(log).toEqual([{ kind: 'run', label: 'init init' }]);
  });

  it.each([
    ['typed on the line', ['--output=json', 'loop', 'start'], {}],
    ['read from RAFA_OUTPUT', ['loop', 'start'], { RAFA_OUTPUT: 'json' }],
  ])('calls neither half in json mode %s, and the command still runs', async (_how, argv, env) => {
    const { outcome, stderr } = await run(argv, recordingHook(), { env });

    expect(outcome.exitCode).toBe(0);
    expect(log).toEqual([{ kind: 'run', label: 'loop start' }]);
    expect(stderr).toBe('');
  });

  it('runs a command with no hook handed in', async () => {
    const { outcome, stderr } = await run(['loop', 'start'], undefined);

    expect(outcome.exitCode).toBe(0);
    expect(log).toEqual([{ kind: 'run', label: 'loop start' }]);
    expect(stderr).toBe('');
  });
});

describe('a half that fails', () => {
  /** Throws `message`. */
  const throwing = (message: string) => (): never => {
    throw new Error(message);
  };

  it('runs the command after a before that throws, writing no line and keeping the exit code', async () => {
    const { outcome, stderr } = await run(['loop', 'start'], recordingHook({ before: throwing('git refused') }));

    expect(outcome.exitCode).toBe(0);
    expect(outcome.result.ok).toBe(true);
    expect(stderr).toBe('');
    expect(log.map((call) => call.kind)).toEqual(['before', 'run', 'after']);
  });

  it('keeps the exit code and result of a command whose after throws', async () => {
    const { outcome, stdout, stderr } = await run(['loop', 'status'], recordingHook({ after: throwing('disk full') }));

    expect(outcome.exitCode).toBe(0);
    expect(outcome.result).toMatchObject({ ok: true, data: { tasks: 2 } });
    expect(stdout).toContain('tasks');
    expect(stderr).toBe(`${NOTICE}\n`);
  });

  it('keeps a failing command\'s own exit code when after throws as well', async () => {
    const { outcome } = await run(['loop', 'refuse'], recordingHook({ after: throwing('disk full') }));

    expect(outcome.exitCode).toBe(3);
    expect(outcome.result.error?.code).toBe('command_exit');
  });

  it('writes each failure as one debug line at verbosity 2', async () => {
    const script = { before: throwing('git refused'), after: throwing('disk full') };

    const { stdout } = await run(['--verbose=2', 'loop', 'start'], recordingHook(script));

    expect(stdout).toBe('debug: command hook before: git refused\ndebug: command hook after: disk full\n');
  });

  it('writes no debug line at the default verbosity', async () => {
    const script = { before: throwing('git refused'), after: throwing('disk full') };

    const { stdout, stderr } = await run(['loop', 'start'], recordingHook(script));

    expect(stdout).toBe('');
    expect(stderr).toBe('');
  });

  it('swallows a half that rejects with something other than an Error', async () => {
    const hook: CommandHook = {
      before: async () => Promise.reject(new Error('not an error, as a string')),
      after: async () => Promise.reject('a bare string'),
    };

    const { outcome, stdout } = await run(['--verbose=2', 'loop', 'start'], hook);

    expect(outcome.exitCode).toBe(0);
    expect(stdout).toBe('debug: command hook before: not an error, as a string\ndebug: command hook after: a bare string\n');
  });
});
