/**
 * Tests for the schema 2 roster (`src/cli/describe.ts`): the completeness
 * case the spec's definition of done asks for, the document over the core
 * registry, and each rule of the module note over registries built here.
 *
 * ## The completeness case
 *
 * `.specs/cli-surface.md` holds that every registered action has a
 * summary, a description, at least one example and its outputs, and that
 * `rafa describe` fails its own test when one lacks them.
 * `commandProblem` checks shape and not content, so the registry accepts
 * an empty summary and an empty list. {@link gapsOf} reads content, a
 * blank string counting as missing, and answers one line per field an
 * entry lacks. The case runs it over every command the core registry
 * holds, hidden ones included, and over every entry of the document built
 * from that registry. Its control runs it over a registry planting one
 * gap of each kind, among them a hidden action and a mounted one, and
 * holds the lines to exactly those gaps.
 *
 * ## The rules
 *
 * The planted registry holds what the core roster lacks: arguments and
 * flags with and without a default, a required flag, aliases, a hidden
 * action, a hidden top-level command, a deprecated action, an `exec`
 * action with two modules mounted, a hidden mounted action, and a subject
 * whose one action is hidden. Every entry of each document is also routed
 * back through `routeLine`, so a name the document gives is a line that
 * dispatches the command it describes.
 *
 * ## How far the cases reach
 *
 * Fourteen mutations were driven on 2026-09-14, one run each through a
 * driver asserting one match, with every mutated file restored
 * byte-identical (sha256), and each reddened at least one case. Twelve
 * changed `describe.ts`, run over this file and
 * `src/commands/describe.test.ts`. A missing default left undefined and
 * `required` copied as declared reddened 4 each, the two JSON round trips
 * among them, and no deprecation written as undefined 5. Flag aliases
 * dropped, an alias left unnormalised, a mounted action given its own
 * aliases, a hidden mounted action listed and a hidden top-level command
 * listed reddened 1 each, and hidden subject actions listed 3. A mounted
 * action named without the `exec` word reddened 8, its module dropped 5,
 * and the mounts listed under a command declaring no `exec` 5. Two
 * changed `src/commands/usage.ts`, run over this file alone: an empty
 * `outputs` and a blank `description` each reddened the completeness case
 * over the core registry and nothing else.
 */
import type { RafaCommand } from './command.js';
import type { DescribedAction, DescribeDocument } from './describe.js';
import type { CommandRegistry } from './registry.js';

import { describe, expect, it } from 'bun:test';

import { CORE_REGISTRY } from '../commands/index.js';

import { commandSpelling, isTopLevel } from './command.js';
import { DESCRIBE_BINARY, DESCRIBE_SCHEMA_VERSION, describeRegistry } from './describe.js';
import { createCommandRegistry, mountKey } from './registry.js';
import { routeLine } from './route.js';

/** A command with every field filled, under a subject and action. */
function command(subject: string, action: string, overrides: Partial<RafaCommand> = {}): RafaCommand {
  return {
    name: `${subject} ${action}`,
    subject,
    action,
    summary: `${action} things`,
    description: `Does ${action}.`,
    args: [],
    flags: [],
    examples: [{ cmd: `rafa ${subject} ${action}`, note: `runs ${action}` }],
    outputs: ['text'],
    run: async () => {},
    ...overrides,
  };
}

/** The four fields every registered action declares with content. */
type Declared = Pick<RafaCommand, 'summary' | 'description' | 'examples' | 'outputs'>;

/** An entry to check: the line it is typed as, and what it declares. */
type Checked = readonly [label: string, entry: Declared];

/** Each field every registered action declares, and how its content is read. */
const REQUIRED: readonly (readonly [field: string, holds: (entry: Declared) => boolean])[] = [
  ['a summary', (entry) => entry.summary.trim() !== ''],
  ['a description', (entry) => entry.description.trim() !== ''],
  ['an example', (entry) => entry.examples.length > 0],
  ['its outputs', (entry) => entry.outputs.length > 0],
];

/** One line per field an entry lacks, in entry order then field order. */
function gapsOf(entries: readonly Checked[]): string[] {
  return entries.flatMap(([label, entry]) => REQUIRED
    .filter(([, holds]) => !holds(entry))
    .map(([field]) => `${label} lacks ${field}`));
}

/** Every command a registry holds, hidden and mounted ones included, labelled by its spelling or its mount. */
function registered(registry: CommandRegistry): Checked[] {
  return [
    ...registry.commands({ includeHidden: true }).map((held): Checked => [commandSpelling(held), held]),
    ...registry.mounts().flatMap((mount) => registry.actionsOf(mountKey(mount.name), { includeHidden: true })
      .map((held): Checked => [`module ${mount.name} ${held.action}`, held])),
  ];
}

/** Every entry of a document, labelled by the line it is typed as after `rafa`. */
function described(document: DescribeDocument): (readonly [string, DescribedAction])[] {
  return [
    ...document.subjects.flatMap((subject) => subject.actions.map((action) => [`${subject.name} ${action.name}`, action] as const)),
    ...document.commands.map((entry) => [entry.name, entry] as const),
  ];
}

/** The entry named `name` under a subject of a document. */
function actionOf(document: DescribeDocument, subject: string, name: string): DescribedAction | undefined {
  return document.subjects.find((held) => held.name === subject)?.actions.find((action) => action.name === name);
}

/** The mounted command whose declared aliases and deprecation the document reads. */
const LINEAR_NEXT = command('linear', 'next', {
  summary: 'claim the next issue',
  aliases: ['next'],
  deprecated: { since: '0.3.0', use: 'module exec linear claim' },
  outputs: ['json'],
  spends: { when: 'always', what: 'one session per issue' },
});

const PLANTED = createCommandRegistry({
  subjects: [
    { name: 'loop', summary: 'the loop' },
    { name: 'plan', summary: 'plans' },
    { name: 'module', summary: 'modules' },
  ],
  commands: [
    command('loop', 'start', {
      summary: 'start the loop',
      args: [
        { name: 'stub', description: 'The stub.', type: 'string', required: true },
        { name: 'mode', description: 'The mode.', type: 'string', default: 'full' },
      ],
      flags: [
        { name: 'plan', description: 'The plan.', type: 'string', aliases: ['p'] },
        { name: 'ci-wait', description: 'Waits.', type: 'boolean', default: true },
        { name: 'ci-timeout', description: 'Minutes.', type: 'number', default: 30, required: true },
      ],
      outputs: ['text', 'json', 'tui'],
      aliases: ['start', ' begin   now '],
      spends: { when: 'with', flag: '--plan', what: 'one session per task' },
    }),
    command('loop', 'secret', { hidden: true }),
    command('loop', 'old', { deprecated: { since: '0.2.0', use: 'loop start' } }),
    command('plan', 'draft', { hidden: true }),
    command('module', 'exec', { exec: true }),
    command('module', 'list'),
    command('doctor', 'doctor'),
    command('hush', 'hush', { hidden: true }),
  ],
})
  .mount({
    name: 'linear',
    entry: '/modules/linear/commands.ts',
    commands: [LINEAR_NEXT, command('linear', 'claim'), command('linear', 'draft', { hidden: true })],
  })
  .mount({ name: 'github', entry: '/modules/github/commands.ts', commands: [command('github', 'sync')] });

/** A registry whose `exec` action is top-level. */
const TOP_EXEC = createCommandRegistry({
  subjects: [],
  commands: [command('run', 'run', { exec: true }), command('doctor', 'doctor')],
}).mount({ name: 'linear', entry: '/modules/linear/commands.ts', commands: [command('linear', 'next')] });

describe('what every registered action declares', () => {
  it('names no command of the core registry, hidden ones included, or entry of its document lacking a summary, a description, an example or its outputs', () => {
    const entries = registered(CORE_REGISTRY);

    expect(entries.length).toBeGreaterThan(0);
    expect(gapsOf(entries)).toEqual([]);
    expect(gapsOf(described(describeRegistry(CORE_REGISTRY, '1.0.0')))).toEqual([]);
  });

  it('names each action lacking one, hidden and mounted ones included, so the case above can fail', () => {
    const gapped = createCommandRegistry({
      subjects: [{ name: 'loop', summary: 'the loop' }, { name: 'module', summary: 'modules' }],
      commands: [
        command('loop', 'start'),
        command('loop', 'quiet', { summary: '' }),
        command('loop', 'blank', { description: '  ' }),
        command('loop', 'secret', { hidden: true, examples: [] }),
        command('module', 'exec', { exec: true }),
        command('doctor', 'doctor', { outputs: [] }),
      ],
    }).mount({
      name: 'linear',
      entry: '/modules/linear/commands.ts',
      commands: [command('linear', 'next', { examples: [], outputs: [] })],
    });

    expect(gapsOf(registered(gapped))).toEqual([
      'loop quiet lacks a summary',
      'loop blank lacks a description',
      'loop secret lacks an example',
      'doctor lacks its outputs',
      'module linear next lacks an example',
      'module linear next lacks its outputs',
    ]);
    expect(gapsOf(described(describeRegistry(gapped, '1.0.0')))).toEqual([
      'loop quiet lacks a summary',
      'loop blank lacks a description',
      'module exec linear next lacks an example',
      'module exec linear next lacks its outputs',
      'doctor lacks its outputs',
    ]);
  });
});

describe('the document over the core registry', () => {
  const document = describeRegistry(CORE_REGISTRY, '1.0.0');

  it('lists each subject with its visible actions, then the visible top-level commands, in the order declared', () => {
    expect(document.subjects.map((subject) => [subject.name, subject.summary, subject.actions.map((action) => action.name)]))
      .toEqual(CORE_REGISTRY.subjects().map((subject) => [
        subject.name,
        subject.summary,
        CORE_REGISTRY.actionsOf(subject.name).map((held) => held.action),
      ]));
    expect(document.commands.map((entry) => entry.name))
      .toEqual(CORE_REGISTRY.commands()
        .filter(isTopLevel)
        .map((held) => held.action));
    expect(document.commands.map((entry) => entry.name)).toContain('describe');
    expect(document.commands.map((entry) => entry.name)).toContain('roadmap');
    expect(document.commands.map((entry) => entry.name)).toContain('cleanup');
  });

  it('gives each core command its spends declaration as written, and null for one declaring none', () => {
    const spendsOf = (subject: string, name: string): DescribedAction['spends'] | undefined => actionOf(document, subject, name)?.spends;
    const command = (name: string): DescribedAction | undefined => document.commands.find((entry) => entry.name === name);

    expect(spendsOf('plan', 'create')).toStrictEqual({ when: 'always', what: 'one planning session' });
    expect(spendsOf('pr', 'triage')).toStrictEqual({ when: 'with', flag: '--resolve', what: 'runs a small fixed plan through the loop' });
    expect(spendsOf('skill', 'backfill')?.when).toBe('with');
    expect(spendsOf('loop', 'start')?.when).toBe('always');
    expect(command('next')?.spends?.when).toBe('through');
    expect(command('describe')?.spends).toBeNull();
    expect(command('roadmap')?.spends).toBeNull();
    expect(command('cleanup')?.spends).toBeNull();
    expect(spendsOf('loop', 'status')).toBeNull();
  });
});

describe('the document', () => {
  const document = describeRegistry(PLANTED, '9.9.9');

  it('stamps schema 2, the binary and the version handed in, and holds nothing else at its top', () => {
    expect([DESCRIBE_SCHEMA_VERSION, DESCRIBE_BINARY]).toEqual([2, 'rafa']);
    expect(Object.keys(document)).toEqual(['schemaVersion', 'binary', 'version', 'subjects', 'commands']);
    expect([document.schemaVersion, document.binary, document.version]).toEqual([2, 'rafa', '9.9.9']);
  });

  it('lists every subject, one with no visible action included, and leaves every hidden command out', () => {
    expect(document.subjects.map((subject) => [subject.name, subject.summary, subject.actions.map((action) => action.name)])).toEqual([
      ['loop', 'the loop', ['start', 'old']],
      ['plan', 'plans', []],
      ['module', 'modules', ['exec', 'list', 'exec linear next', 'exec linear claim', 'exec github sync']],
    ]);
    expect(document.commands.map((entry) => entry.name)).toEqual(['doctor']);
  });

  it('describes an action with every field, required a boolean and a missing default null', () => {
    expect(actionOf(document, 'loop', 'start')).toStrictEqual({
      name: 'start',
      summary: 'start the loop',
      description: 'Does start.',
      args: [
        { name: 'stub', description: 'The stub.', type: 'string', required: true, default: null },
        { name: 'mode', description: 'The mode.', type: 'string', required: false, default: 'full' },
      ],
      flags: [
        { name: 'plan', description: 'The plan.', type: 'string', required: false, default: null, aliases: ['p'] },
        { name: 'ci-wait', description: 'Waits.', type: 'boolean', required: false, default: true, aliases: [] },
        { name: 'ci-timeout', description: 'Minutes.', type: 'number', required: true, default: 30, aliases: [] },
      ],
      examples: [{ cmd: 'rafa loop start', note: 'runs start' }],
      outputs: ['text', 'json', 'tui'],
      aliases: ['start', 'begin now'],
      deprecated: null,
      module: null,
      spends: { when: 'with', flag: '--plan', what: 'one session per task' },
    });
  });

  it('describes a top-level command in the same shape, and a deprecation as since and use', () => {
    expect(document.commands[0]).toStrictEqual({
      name: 'doctor',
      summary: 'doctor things',
      description: 'Does doctor.',
      args: [],
      flags: [],
      examples: [{ cmd: 'rafa doctor doctor', note: 'runs doctor' }],
      outputs: ['text'],
      aliases: [],
      deprecated: null,
      module: null,
      spends: null,
    });
    expect(actionOf(document, 'loop', 'old')?.deprecated).toStrictEqual({ since: '0.2.0', use: 'loop start' });
  });

  it('describes a mounted action as typed through the exec action, naming its module, with no alias', () => {
    expect(actionOf(document, 'module', 'exec linear next')).toStrictEqual({
      name: 'exec linear next',
      summary: 'claim the next issue',
      description: 'Does next.',
      args: [],
      flags: [],
      examples: [{ cmd: 'rafa linear next', note: 'runs next' }],
      outputs: ['json'],
      aliases: [],
      deprecated: { since: '0.3.0', use: 'module exec linear claim' },
      module: 'linear',
      spends: { when: 'always', what: 'one session per issue' },
    });
    expect(actionOf(document, 'module', 'exec')?.module).toBeNull();
    expect(actionOf(document, 'module', 'exec linear claim')?.spends).toBeNull();
  });

  it('lists the mounted actions after the top-level commands when the exec action is top-level', () => {
    expect(describeRegistry(TOP_EXEC, '1.0.0').commands.map((entry) => [entry.name, entry.module])).toEqual([
      ['run', null],
      ['doctor', null],
      ['run linear next', 'linear'],
    ]);
  });

  it('lists no mounted action where no visible exec action reaches it', () => {
    const linear = { name: 'linear', entry: '/modules/linear/commands.ts', commands: [command('linear', 'next')] };
    const subjects = [{ name: 'module', summary: 'modules' }];
    const lines = (commands: readonly RafaCommand[]): string[] => {
      const registry = createCommandRegistry({ subjects, commands }).mount(linear);
      return described(describeRegistry(registry, '1.0.0'))
        .map(([line]) => line);
    };

    expect(lines([command('module', 'list')])).toEqual(['module list']);
    expect(lines([command('module', 'list'), command('module', 'exec', { exec: true, hidden: true })])).toEqual(['module list']);
    expect(lines([command('module', 'list'), command('module', 'exec', { exec: true })]))
      .toEqual(['module list', 'module exec', 'module exec linear next']);
  });

  it.each([
    ['the planted registry', PLANTED],
    ['a registry whose exec action is top-level', TOP_EXEC],
    ['the core registry', CORE_REGISTRY],
  ])('names every entry of %s as a line routing to the command it describes', (_title, registry) => {
    const entries = described(describeRegistry(registry, '1.0.0'));
    const routed = entries.map(([line]) => {
      const route = routeLine(registry, line.split(' '));
      return route.kind === 'command'
        ? [line, route.label, route.module?.name ?? null, route.command.summary]
        : [line, route.kind];
    });

    expect(entries.length).toBeGreaterThan(0);
    expect(routed).toEqual(entries.map(([line, entry]) => [line, line, entry.module, entry.summary]));
  });

  it.each([
    ['the planted registry', PLANTED],
    ['the core registry', CORE_REGISTRY],
  ])('comes back from a JSON round trip of %s unchanged, holding no undefined field', (_title, registry) => {
    const built = describeRegistry(registry, '1.0.0');

    expect(JSON.parse(JSON.stringify(built))).toStrictEqual(built);
  });
});
