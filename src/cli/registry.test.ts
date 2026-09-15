/**
 * Tests for the dispatcher's registry (`src/cli/registry.ts`): what it
 * answers, what `mount` answers, and every refusal.
 *
 * Every refusal is spelled here in full, with the error class it is
 * thrown as, and each sits beside a case the registry accepts that
 * differs from it in the one thing refused, so a registry refusing
 * everything fails as surely as one refusing nothing. The lookups are
 * read through names an index into an object would answer, which the
 * registry's maps must not.
 *
 * Seven mutations of `registry.ts` were driven on 2026-09-14, one run
 * each over the eight suites under `src/cli/`, with 326 pass before and
 * after and the module restored byte-identical (sha256), and each
 * reddened at least one case. Hidden commands kept in rosters reddened 8,
 * the routing refusals that list actions among them. No plural spelling
 * reddened 6, and the aliases left in declared order 2. One case each
 * for `help` accepted as a subject, an alias spelled as a top-level
 * command accepted, and a mounted `exec` action accepted. The last is
 * `mount` copying its commands before checking them. The first draft of
 * `mount` did that, and the case for commands that are not a list caught
 * it: it received the engine's spread error in place of the refusal.
 */
import type { RafaCommand } from './command.js';
import type { CommandRegistryInput, SubjectSpec } from './registry.js';

import { describe, expect, it } from 'bun:test';

import { createCommandRegistry, HELP_WORD, mountKey, pluralOf } from './registry.js';

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
    run: async () => {},
    ...overrides,
  };
}

const SUBJECTS: readonly SubjectSpec[] = [
  { name: 'plan', summary: 'create and list plans' },
  { name: 'loop', summary: 'start and stop the loop' },
  { name: 'issue', summary: 'the tracker' },
];

const PLAN_CREATE = command('plan', 'create', { aliases: ['plan'] });
const PLAN_LIST = command('plan', 'list');
const LOOP_START = command('loop', 'start', { aliases: ['start', 'loop begin now'] });
const LOOP_DEBUG = command('loop', 'debug', { hidden: true });
const USAGE = command('usage', 'usage');

const INPUT: CommandRegistryInput = {
  subjects: SUBJECTS,
  commands: [PLAN_CREATE, PLAN_LIST, LOOP_START, LOOP_DEBUG, USAGE],
};

const NEXT = command('issue', 'next');
const PEEK = command('issue', 'peek', { hidden: true });

/** The error building throws, which the case then reads. */
function refusalOf(build: () => unknown): Error {
  try {
    build();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`threw a non-error: ${String(error)}`, { cause: error });
  }
  throw new Error('built without a refusal');
}

/** The input with its commands replaced. */
function withCommands(...commands: RafaCommand[]): CommandRegistryInput {
  return { subjects: SUBJECTS, commands };
}

describe('what a registry answers', () => {
  const registry = createCommandRegistry(INPUT);

  it('answers the subjects in the order declared, each by its name and by its plural', () => {
    expect(registry.subjects()).toEqual(SUBJECTS);
    expect(registry.subjectOf('issue')).toBe(SUBJECTS[2]);
    expect(registry.subjectOf('issues')).toBe(SUBJECTS[2]);
    expect(pluralOf('module')).toBe('modules');
  });

  it('answers no subject for a word it does not hold, prototype names included', () => {
    expect(registry.subjectOf('plugin')).toBeUndefined();
    expect(registry.subjectOf('constructor')).toBeUndefined();
    expect(registry.subjectOf('toString')).toBeUndefined();
    expect(registry.find('constructor', 'constructor')).toBeUndefined();
    expect(registry.mountOf('__proto__')).toBeUndefined();
  });

  it('answers the core commands in the order declared, hidden ones only when asked', () => {
    expect(registry.commands()).toEqual([PLAN_CREATE, PLAN_LIST, LOOP_START, USAGE]);
    expect(registry.commands({ includeHidden: true })).toEqual([PLAN_CREATE, PLAN_LIST, LOOP_START, LOOP_DEBUG, USAGE]);
  });

  it('answers the actions under a subject name alone, never a top-level command', () => {
    expect(registry.actionsOf('loop')).toEqual([LOOP_START]);
    expect(registry.actionsOf('loop', { includeHidden: true })).toEqual([LOOP_START, LOOP_DEBUG]);
    expect(registry.actionsOf('loops')).toEqual([]);
    expect(registry.actionsOf('issue')).toEqual([]);
    expect(registry.actionsOf('usage')).toEqual([]);
  });

  it('finds a command by subject name and action, and a top-level command by its word', () => {
    expect(registry.find('plan', 'list')).toBe(PLAN_LIST);
    expect(registry.find('plans', 'list')).toBeUndefined();
    expect(registry.find('loop', 'debug')).toBe(LOOP_DEBUG);
    expect(registry.topLevel('usage')).toBe(USAGE);
    expect(registry.topLevel('plan')).toBeUndefined();
  });

  it('answers the aliases longest first, in the order declared among equals', () => {
    expect(registry.aliases().map(({ words, command: owner }) => [words.join(' '), owner])).toEqual([
      ['loop begin now', LOOP_START],
      ['plan', PLAN_CREATE],
      ['start', LOOP_START],
    ]);
  });

  it('is frozen, and so is every list it answers', () => {
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.subjects())).toBe(true);
    expect(Object.isFrozen(registry.commands())).toBe(true);
    expect(Object.isFrozen(registry.aliases())).toBe(true);
    expect(Object.isFrozen(registry.mounts())).toBe(true);
  });

  it('keeps what it was built from when the lists handed in change afterwards', () => {
    const commands = [PLAN_LIST];
    const subjects = [...SUBJECTS];
    const built = createCommandRegistry({ subjects, commands });

    commands.push(PLAN_CREATE);
    subjects.pop();

    expect(built.commands()).toEqual([PLAN_LIST]);
    expect(built.subjectOf('issue')).toBe(SUBJECTS[2]);
  });
});

describe('mounting a module', () => {
  const registry = createCommandRegistry(INPUT);
  const mounted = registry.mount({ name: 'linear', entry: '/modules/linear.ts', commands: [NEXT, PEEK] });

  it('answers a new registry holding the mount under module/<name>, leaving the first unchanged', () => {
    expect(mountKey('linear')).toBe('module/linear');
    expect(mounted.mounts()).toEqual([{ name: 'linear', entry: '/modules/linear.ts', commands: [NEXT, PEEK] }]);
    expect(mounted.mountOf('linear')?.commands).toEqual([NEXT, PEEK]);
    expect(mounted.find('module/linear', 'next')).toBe(NEXT);
    expect(mounted.actionsOf('module/linear')).toEqual([NEXT]);
    expect(mounted.actionsOf('module/linear', { includeHidden: true })).toEqual([NEXT, PEEK]);

    expect(registry.mounts()).toEqual([]);
    expect(registry.mountOf('linear')).toBeUndefined();
    expect(registry.find('module/linear', 'next')).toBeUndefined();
  });

  it('routes nothing by a mounted command subject, and keeps the core commands as they were', () => {
    expect(mounted.find('issue', 'next')).toBeUndefined();
    expect(mounted.actionsOf('issue')).toEqual([]);
    expect(mounted.commands()).toEqual(registry.commands());
  });

  it('keeps the commands it mounted when the list handed in changes afterwards', () => {
    const commands = [NEXT];
    const held = registry.mount({ name: 'linear', entry: '/modules/linear.ts', commands });

    commands.push(PEEK);

    expect(held.actionsOf('module/linear', { includeHidden: true })).toEqual([NEXT]);
  });

  it('accepts one action in two modules, a scoped module name, and a mounted command spelled as a core one', () => {
    const both = mounted
      .mount({ name: '@open-tomato/rafa-jira', entry: '/modules/jira.ts', commands: [NEXT, PLAN_LIST] });

    expect(both.find('module/@open-tomato/rafa-jira', 'next')).toBe(NEXT);
    expect(both.find('module/linear', 'next')).toBe(NEXT);
    expect(both.find('module/@open-tomato/rafa-jira', 'list')).toBe(PLAN_LIST);
    expect(both.find('plan', 'list')).toBe(PLAN_LIST);
  });
});

describe('what a registry refuses to be built from', () => {
  it('accepts the input every refusal below changes one thing of', () => {
    expect(() => createCommandRegistry(INPUT)).not.toThrow();
  });

  it.each([
    [
      'a subject named help',
      { subjects: [...SUBJECTS, { name: HELP_WORD, summary: 'help' }], commands: [] },
      Error,
      'command registry: "help" is read as a help request, not a subject',
    ],
    [
      'a subject name with a slash',
      { subjects: [{ name: 'module/linear', summary: 'x' }], commands: [] },
      TypeError,
      'command registry: a subject has name "module/linear" and summary "x",'
        + ' expected a word with no space, no slash and no leading dash, and a string',
    ],
    [
      'a subject declared twice',
      { subjects: [...SUBJECTS, { name: 'loop', summary: 'again' }], commands: [] },
      Error,
      'command registry: subject "loop" is declared twice',
    ],
    [
      'a subject spelled as the plural of another',
      { subjects: [...SUBJECTS, { name: 'plans', summary: 'many' }], commands: [] },
      Error,
      'command registry: subject "plans" is spelled as the plural of subject "plan"',
    ],
  ] as const)('refuses %s', (_title, input, kind, message) => {
    const error = refusalOf(() => createCommandRegistry(input));

    expect(error).toBeInstanceOf(kind);
    expect(error.message).toBe(message);
  });

  it.each([
    [
      'a command failing the shape check',
      withCommands(command('loop', 'start', { run: undefined as unknown as RafaCommand['run'] })),
      TypeError,
      'command registry: command "loop start": run is undefined, expected a function',
    ],
    [
      'a top-level command named help',
      withCommands(command(HELP_WORD, HELP_WORD)),
      Error,
      'command registry: "help" is read as a help request, not a command',
    ],
    [
      'a top-level command spelled as a subject',
      withCommands(command('plan', 'plan')),
      Error,
      'command registry: top-level command "plan" is spelled as a subject',
    ],
    [
      'a top-level command spelled as the plural of a subject',
      withCommands(command('plans', 'plans')),
      Error,
      'command registry: top-level command "plans" is spelled as a subject',
    ],
    [
      'a command under an undeclared subject',
      withCommands(command('skill', 'check')),
      Error,
      'command registry: command "skill check" is under subject "skill", which is not declared',
    ],
    [
      'a command under the plural of a subject',
      withCommands(command('plans', 'create')),
      Error,
      'command registry: command "plans create" is under subject "plans", which is not declared',
    ],
    [
      'a command declared twice',
      withCommands(PLAN_LIST, command('plan', 'list')),
      Error,
      'command registry: command "plan list" is declared twice',
    ],
    [
      'an alias that is a flag',
      withCommands(command('plan', 'create', { aliases: ['plan --spec'] })),
      Error,
      'command registry: command "plan create" has alias "plan --spec", expected words with no slash and no leading dash',
    ],
    [
      'an alias opening with help',
      withCommands(command('loop', 'start', { aliases: ['help start'] })),
      Error,
      'command registry: "help" is read as a help request, not the first word of an alias',
    ],
    [
      'an alias claimed twice',
      withCommands(command('loop', 'start', { aliases: ['go'] }), command('plan', 'create', { aliases: ['go'] })),
      Error,
      'command registry: alias "go" is claimed by "loop start" and by "plan create"',
    ],
    [
      'an alias spelled as a top-level command',
      withCommands(USAGE, command('loop', 'start', { aliases: ['usage'] })),
      Error,
      'command registry: alias "usage" of "loop start" is spelled as command "usage"',
    ],
    [
      'an alias spelled as a subject and one of its actions',
      withCommands(PLAN_LIST, command('loop', 'start', { aliases: ['plan list'] })),
      Error,
      'command registry: alias "plan list" of "loop start" is spelled as command "plan list"',
    ],
    [
      'an alias spelled as the plural of a subject and one of its actions',
      withCommands(PLAN_LIST, command('loop', 'start', { aliases: ['plans list'] })),
      Error,
      'command registry: alias "plans list" of "loop start" is spelled as command "plan list"',
    ],
  ] as const)('refuses %s', (_title, input, kind, message) => {
    const error = refusalOf(() => createCommandRegistry(input));

    expect(error).toBeInstanceOf(kind);
    expect(error.message).toBe(message);
  });

  it('accepts an alias spelled as a subject alone, as its plural, and one longer than a subject action', () => {
    const registry = createCommandRegistry(withCommands(
      PLAN_LIST,
      command('plan', 'create', { aliases: ['plan', 'plans', 'plan list now', 'usage now'] }),
      USAGE,
    ));

    expect(registry.aliases().map(({ words }) => words.join(' '))).toEqual(['plan list now', 'usage now', 'plan', 'plans']);
  });
});

describe('what a mount is refused for', () => {
  const registry = createCommandRegistry(INPUT);
  const linear = { name: 'linear', entry: '/modules/linear.ts', commands: [NEXT] };

  it('accepts the mount every refusal below changes one thing of', () => {
    expect(() => registry.mount(linear)).not.toThrow();
  });

  it.each([
    ['a name opening with a dash', { ...linear, name: '-linear' }, TypeError, 'command registry: a module is named "-linear", expected a word with no leading dash'],
    ['an empty name', { ...linear, name: '' }, TypeError, 'command registry: a module is named "", expected a word with no leading dash'],
    ['a name holding a space', { ...linear, name: 'lin ear' }, TypeError, 'command registry: a module is named "lin ear", expected a word with no leading dash'],
    [
      'commands that are not a list',
      { ...linear, commands: NEXT as unknown as RafaCommand[] },
      TypeError,
      'command registry: module "linear" has commands a mapping, expected a list',
    ],
    [
      'a command failing the shape check',
      { ...linear, commands: [command('issue', 'next', { outputs: ['html'] as unknown as RafaCommand['outputs'] })] },
      TypeError,
      'command registry: module "linear": command "issue next": outputs is a list, expected a list of text, json, tui',
    ],
    [
      'a command declaring exec',
      { ...linear, commands: [command('issue', 'next', { exec: true })] },
      Error,
      'command registry: module "linear": action "next" declares exec, and a mounted action delegates to nothing',
    ],
    [
      'an action declared twice',
      { ...linear, commands: [NEXT, command('plan', 'next')] },
      Error,
      'command registry: module "linear": action "next" is declared twice',
    ],
  ] as const)('refuses %s', (_title, mount, kind, message) => {
    const error = refusalOf(() => registry.mount(mount));

    expect(error).toBeInstanceOf(kind);
    expect(error.message).toBe(message);
  });

  it('refuses a module mounted twice, and leaves the registry it was called on with one mount', () => {
    const once = registry.mount(linear);
    const error = refusalOf(() => once.mount({ ...linear, entry: '/modules/other.ts' }));

    expect(error.message).toBe('command registry: module "linear" is mounted twice');
    expect(once.mounts()).toHaveLength(1);
  });
});
