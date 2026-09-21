/**
 * Tests for the action table (`./actions.ts`): the command each action
 * id runs, the words it runs with, the context it is called over, and
 * what travels back out of it.
 *
 * Every case that RUNS an action drives a recording registry: one built
 * from `createCommandRegistry` whose commands hold the spelling that
 * ran and the whole context they were handed, so the case reads what
 * `run` was called with rather than what a command did. The cases that
 * only read the table call `actionInvocation` and build no registry at
 * all. No case spawns a process, reaches git or reaches GitHub, and the
 * caller's project is resolved over an in-memory filesystem seam
 * (`src/project/scope.ts`) rather than a directory planted on disk.
 *
 * The declaration cases are the ones that read the real commands: they
 * hold the eight spellings of the table to the modules that export
 * them, every flag word an action passes to a flag that command
 * declares, and every positional word to an argument it declares. A
 * rename on either side is what they are there for, and their control
 * is a spelling, a flag and an argument the declarations do not hold.
 * They read the declarations rather than `CORE_REGISTRY` so that they
 * hold whether or not the roster has registered each command yet.
 *
 * ## What passes while wrong
 *
 * Five mutations of `actions.ts` were driven on 2026-09-21, one at a
 * time, over `env -u CLAUDECODE bun test src/next/`, the module
 * restored from a scratch copy and verified with `shasum -c` each
 * time, against 126 pass and 0 fail either side:
 *
 *  - `--yes` dropped from the words `merge` runs with: 123 pass and 3
 *    fail, the table case, the case that counts `--yes` and `--resolve`
 *    across every action, and the call case that reads what `pr merge`
 *    was handed.
 *  - the action's `args` and `flags` left as the caller's, its `argv`
 *    alone replaced: 123 pass and 3 fail, the spec case, the positional
 *    case and the case that holds the caller's own words out. The call
 *    case passes either way, because `argv` is all it reads.
 *  - `--create-branch` dropped from `start`, which makes it `resume`:
 *    124 pass and 2 fail, the table case and the spec case, the second
 *    of them reading the flag defaults `loop start` fills.
 *  - the `CommandExit` a command threw caught and rethrown as a plain
 *    `Error`: 125 pass and 1 fail, the propagation case alone. Every
 *    other case ends without a throw, and none of them sees it.
 *  - the subject and the action swapped in the registry lookup: 119
 *    pass and 7 fail, every case that runs a command at all. The
 *    refusal case passes, because a lookup that finds nothing is what
 *    it plants.
 */
import type { NextState } from './state.js';
import type { RafaCommand, RafaContext } from '../cli/command.js';
import type { ProjectFound } from '../project/scope.js';

import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { CommandExit } from '../cli/command.js';
import { createCommandRegistry } from '../cli/registry.js';
import issueReady from '../commands/issue/ready.js';
import issueUnblock from '../commands/issue/unblock.js';
import loopStart from '../commands/loop/start.js';
import planCreate from '../commands/plan/create.js';
import prMerge from '../commands/pr/merge.js';
import prTriage from '../commands/pr/triage.js';
import prWait from '../commands/pr/wait.js';
import { resolveScope } from '../project/scope.js';
import { sinkOutput } from '../tests/output-sinks.js';

import { actionInvocation, NEXT_COMMAND_ACTIONS, runAction, runsCommand } from './actions.js';

/** The project root the caller's context carries. */
const ROOT = join('/', 'scratch', 'project');

/** The home beside it. */
const HOME = join('/', 'scratch', 'home');

/** The plan file every plan action runs on, absolute as a row answers it. */
const PLAN = join(ROOT, '.rafa', 'plans', 'PLAN-rafa-63-one-command-next-step.md');

/** The pull request the pull request rows name. */
const PR = 41;

/** The issue the roadmap rows name. */
const ISSUE = 64;

/** A project resolved over a filesystem holding one config file and nothing else. */
function projectAt(): ProjectFound {
  const configFile = join(ROOT, '.rafa', 'config.yaml');
  const scope = resolveScope(ROOT, {
    home: HOME,
    fs: { exists: (path: string) => path === configFile, realpath: (path: string) => path },
  });
  if (!scope.found) throw new Error(`the scratch project did not resolve: ${scope.hint}`);
  return scope;
}

/** A state as a row answers one, with the fields the cases fill. */
function stateOf(over: Partial<NextState>): NextState {
  return Object.freeze({
    id: 'pr-green',
    action: 'merge',
    reading: 'a reading',
    proposal: 'a proposal',
    pullRequest: null,
    issue: null,
    planStub: null,
    planPath: null,
    problems: [],
    ...over,
  });
}

/** The state each action is read off, one per action the table holds. */
const STATES: Readonly<Record<string, NextState>> = Object.freeze({
  resume: stateOf({ id: 'tracker-open', action: 'resume', planStub: 'rafa-63', planPath: PLAN }),
  wait: stateOf({ id: 'pr-pending', action: 'wait', pullRequest: PR }),
  triage: stateOf({ id: 'pr-red', action: 'triage', pullRequest: PR }),
  merge: stateOf({ id: 'pr-green', action: 'merge', pullRequest: PR }),
  start: stateOf({ id: 'plan-unstarted', action: 'start', planStub: 'rafa-63', planPath: PLAN }),
  plan: stateOf({ id: 'issue-ready', action: 'plan', issue: ISSUE }),
  unblock: stateOf({ id: 'issue-blocked', action: 'unblock', issue: ISSUE }),
  ready: stateOf({ id: 'issue-not-ready', action: 'ready', issue: ISSUE }),
});

/** One call a recording command took. */
interface Seen {
  /** The command that ran, as a person types it. */
  readonly spelling: string;
  /** The whole context it was handed. */
  readonly context: RafaContext;
}

/** A command recording what it was called with, and whatever `overrides` adds. */
function recording(seen: Seen[], subject: string, action: string, overrides: Partial<RafaCommand> = {}): RafaCommand {
  return {
    name: `${subject} ${action}`,
    description: `Records one call of ${subject} ${action}.`,
    subject,
    action,
    summary: `${subject} ${action}`,
    args: [{ name: 'n', description: 'A number.', type: 'string' }],
    flags: [],
    examples: [{ cmd: `rafa ${subject} ${action}`, note: 'runs it' }],
    outputs: ['text', 'json'],
    run: async (context: RafaContext) => {
      seen.push({ spelling: `${subject} ${action}`, context });
    },
    ...overrides,
  };
}

/** The four subjects the table reaches. */
const SUBJECTS = [
  { name: 'pr', summary: 'pull requests' },
  { name: 'loop', summary: 'the loop' },
  { name: 'plan', summary: 'plans' },
  { name: 'issue', summary: 'the board' },
];

/** What a case drives: the registry, the caller's context, and what ran. */
interface Harness {
  readonly caller: RafaContext;
  readonly seen: readonly Seen[];
  readonly lines: readonly string[];
}

/** A harness whose registry holds every command of the table but those `without` names. */
function harnessFor(without: readonly string[] = []): Harness {
  const seen: Seen[] = [];
  const lines: string[] = [];
  const commands = [
    recording(seen, 'pr', 'wait'),
    recording(seen, 'pr', 'triage'),
    recording(seen, 'pr', 'merge', { flags: [{ name: 'yes', description: 'Merge without asking.', type: 'boolean' }] }),
    recording(seen, 'loop', 'start', {
      args: [],
      flags: [
        { name: 'plan', description: 'The plan.', type: 'string' },
        { name: 'create-branch', description: 'Cut the branch.', type: 'boolean' },
        { name: 'ci-wait', description: 'Wait on the checks.', type: 'boolean', default: true },
      ],
    }),
    recording(seen, 'plan', 'create', {
      args: [],
      flags: [{ name: 'next', description: 'The roadmap line.', type: 'boolean' }],
    }),
    recording(seen, 'issue', 'unblock'),
    recording(seen, 'issue', 'ready'),
  ].filter((command) => !without.includes(`${command.subject} ${command.action}`));
  const registry = createCommandRegistry({ subjects: SUBJECTS, commands });
  const caller: RafaContext = Object.freeze({
    args: ['a positional the caller typed'],
    flags: { 'dry-run': true, yes: 'merge,plan' },
    outputMode: 'text',
    verbosity: 2,
    output: sinkOutput({ info: (line: string) => lines.push(line) }),
    signal: new AbortController().signal,
    env: { RAFA_TEST: 'actions' },
    argv: ['--yes=merge,plan'],
    registry,
    project: projectAt(),
  });
  return { caller, seen, lines };
}

describe('the command each action runs', () => {
  it('maps the eight action ids of the table onto their commands and words', () => {
    const invocations = NEXT_COMMAND_ACTIONS.map((action) => {
      const invocation = actionInvocation(STATES[action]);
      return [action, invocation?.command, invocation?.argv];
    });

    expect(invocations).toEqual([
      ['resume', 'loop start', [`--plan=${PLAN}`]],
      ['wait', 'pr wait', ['41']],
      ['triage', 'pr triage', ['41']],
      ['merge', 'pr merge', ['41', '--yes']],
      ['start', 'loop start', [`--plan=${PLAN}`, '--create-branch']],
      ['plan', 'plan create', ['--next']],
      ['unblock', 'issue unblock', ['64']],
      ['ready', 'issue ready', ['64']],
    ]);
  });

  it('passes no --resolve with triage, so no action spends a repair session unasked', () => {
    const words = NEXT_COMMAND_ACTIONS.flatMap((action) => actionInvocation(STATES[action])?.argv ?? []);

    expect(words.filter((word) => word.startsWith('--resolve'))).toEqual([]);
    expect(words.filter((word) => word === '--yes')).toEqual(['--yes']);
  });

  it('answers no invocation for the two ids that run no command', () => {
    const none = stateOf({ id: 'loop-running', action: 'none' });
    const sync = stateOf({ id: 'base-behind', action: 'sync' });

    expect([runsCommand('none'), runsCommand('sync'), runsCommand('merge')]).toEqual([false, false, true]);
    expect([actionInvocation(none), actionInvocation(sync)]).toEqual([null, null]);
  });

  it('throws over a state whose row proposed an action and left its field null', () => {
    const noPull = stateOf({ id: 'pr-pending', action: 'wait' });
    const noIssue = stateOf({ id: 'issue-blocked', action: 'unblock' });
    const noPlan = stateOf({ id: 'plan-unstarted', action: 'start' });

    expect(() => actionInvocation(noPull)).toThrow(/state "pr-pending" proposes "wait" and names no pull request/);
    expect(() => actionInvocation(noIssue)).toThrow(/names no issue/);
    expect(() => actionInvocation(noPlan)).toThrow(/names no plan file/);
  });
});

describe('what an action is called with', () => {
  it('calls the mapped command as its own function, with the action own words', async () => {
    const { caller, seen } = harnessFor();

    await runAction(caller, STATES.merge);

    expect(seen.map((call) => [call.spelling, call.context.argv])).toEqual([['pr merge', ['41', '--yes']]]);
  });

  it('reads the action words against the command own spec, the defaults it declares filled in', async () => {
    const { caller, seen } = harnessFor();

    await runAction(caller, STATES.start);

    expect(seen[0]?.context.args).toEqual([]);
    expect(seen[0]?.context.flags).toEqual({ plan: PLAN, 'create-branch': true, 'ci-wait': true });
  });

  it('reads a number the state names as the command positional word', async () => {
    const { caller, seen } = harnessFor();

    await runAction(caller, STATES.ready);

    expect([seen[0]?.spelling, seen[0]?.context.args, seen[0]?.context.flags]).toEqual(['issue ready', ['64'], {}]);
  });

  it('hands on the caller output, project, registry, environment, signal, mode and verbosity', async () => {
    const { caller, seen } = harnessFor();

    await runAction(caller, STATES.plan);

    const context = seen[0]?.context;
    expect(context?.output).toBe(caller.output);
    expect(context?.project).toBe(caller.project);
    expect(context?.registry).toBe(caller.registry);
    expect(context?.signal).toBe(caller.signal);
    expect(context?.env).toBe(caller.env);
    expect([context?.outputMode, context?.verbosity]).toEqual(['text', 2]);
  });

  it('leaves the caller own words out of the action context', async () => {
    const { caller, seen } = harnessFor();

    await runAction(caller, STATES.plan);

    expect(seen[0]?.context.argv).toEqual(['--next']);
    expect(seen[0]?.context.args).toEqual([]);
    expect(seen[0]?.context.flags).toEqual({ next: true });
    expect(caller.flags).toEqual({ 'dry-run': true, yes: 'merge,plan' });
  });

  it('writes what the command writes through the caller own output', async () => {
    const { caller, seen, lines } = harnessFor();
    const talking = stateOf({ id: 'pr-pending', action: 'wait', pullRequest: PR });

    await runAction(caller, talking);
    seen[0]?.context.output.info('checks are still running');

    expect(lines).toEqual(['checks are still running']);
  });
});

describe('what travels back out of an action', () => {
  it('throws the CommandExit the command threw, with its own code and message', async () => {
    const seen: Seen[] = [];
    const refusing = recording(seen, 'pr', 'merge', {
      run: async () => {
        throw new CommandExit(3, 'the PR is not green');
      },
    });
    const { caller } = harnessFor(['pr merge']);
    const registry = createCommandRegistry({ subjects: SUBJECTS, commands: [refusing] });
    const over: RafaContext = Object.freeze({ ...caller, registry });

    const thrown = await runAction(over, STATES.merge).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(CommandExit);
    expect([(thrown as CommandExit).exitCode, (thrown as CommandExit).message]).toEqual([3, 'the PR is not green']);
  });

  it('refuses with exit code 1 when the registry holds no such command, naming the line it would run', async () => {
    const { caller, seen } = harnessFor(['pr merge']);

    const thrown = await runAction(caller, STATES.merge).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(CommandExit);
    expect((thrown as CommandExit).exitCode).toBe(1);
    expect((thrown as CommandExit).message).toContain('rafa pr merge');
    expect(seen).toEqual([]);
  });

  it('throws over a state whose action runs no command at all', async () => {
    const { caller } = harnessFor();
    const sync = stateOf({ id: 'base-behind', action: 'sync' });

    const thrown = await runAction(caller, sync).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(CommandExit);
    expect((thrown as Error).message).toMatch(/the action "sync" of state "base-behind" runs no registered command/);
  });
});

describe('the declarations the table names', () => {
  /** The command each action runs, as the module that declares it exports it. */
  const DECLARED: readonly RafaCommand[] = [prWait, prTriage, prMerge, loopStart, planCreate, issueUnblock, issueReady];

  /** The command of a spelling among the declarations, or undefined. */
  function declaredAs(spelling: string): RafaCommand | undefined {
    return DECLARED.find((command) => `${command.subject} ${command.action}` === spelling);
  }

  it('names a command that exists for every action, each flag it passes declared by that command', () => {
    const missing = NEXT_COMMAND_ACTIONS.flatMap((action) => {
      const invocation = actionInvocation(STATES[action]);
      if (invocation === null) return [`${action}: no invocation`];
      const command = declaredAs(invocation.command);
      if (command === undefined) return [`${action}: no command "rafa ${invocation.command}"`];
      const declared = command.flags.map((flag) => flag.name);
      return invocation.argv
        .filter((word) => word.startsWith('--'))
        .map((word) => word.slice(2).split('=')[0] ?? '')
        .filter((name) => !declared.includes(name))
        .map((name) => `${action}: "rafa ${invocation.command}" declares no --${name}`);
    });

    expect(missing).toEqual([]);
  });

  it('names a command declaring a positional argument wherever the action passes a word', () => {
    const wrong = NEXT_COMMAND_ACTIONS.flatMap((action) => {
      const invocation = actionInvocation(STATES[action]);
      const command = invocation === null
        ? undefined
        : declaredAs(invocation.command);
      const words = (invocation?.argv ?? []).filter((word) => !word.startsWith('-'));
      return words.length > (command?.args.length ?? 0)
        ? [`${action}: "rafa ${invocation?.command}" declares ${command?.args.length ?? 0} arguments for ${words.length} words`]
        : [];
    });

    expect(wrong).toEqual([]);
  });

  it('answers for a spelling and a flag the declarations do not hold, which is the control', () => {
    expect(declaredAs('pr sync')).toBeUndefined();
    expect(declaredAs('pr merge')?.flags.map((flag) => flag.name)).not.toContain('resolve');
    expect(declaredAs('plan create')?.args).toEqual([]);
  });
});
