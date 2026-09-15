/**
 * Tests for routing a line (`src/cli/route.ts`): the command it runs,
 * the help it asks for, or the refusal, with what each route carries.
 *
 * Every route is read whole into a summary and compared with one spelled
 * here, so a route carrying the right command with a wrong `argv`, `line`
 * or `label` fails as surely as one routing elsewhere. Each routing rule
 * sits beside the line that differs from it in the one word the rule
 * reads: a flag ahead of the subject beside a flag value typed with a
 * space, an alias spelled as a subject beside that subject with one of
 * its actions, a subject asking for help beside the same subject asked
 * to run.
 *
 * Six mutations of `route.ts` were driven on 2026-09-14, one run each
 * over the eight suites under `src/cli/`, with 326 pass before and after
 * and the module restored byte-identical (sha256), and each reddened at
 * least one case. `argv` cut one routing word late reddened 21 and an
 * alias counted as no routing word 6. No subject help ahead of an alias
 * reddened 4, a refusal naming hidden actions 3, routing past `--` 2, and
 * a bare `exec` action refused 2.
 */
import type { RafaCommand } from './command.js';
import type { HelpRequest, Route } from './route.js';

import { describe, expect, it } from 'bun:test';

import { commandSpelling } from './command.js';
import { createCommandRegistry } from './registry.js';
import { routeLine } from './route.js';

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
    outputs: ['text'],
    run: async () => {},
    ...overrides,
  };
}

const SUBJECTS = [
  { name: 'plan', summary: 'plans' },
  { name: 'loop', summary: 'the loop' },
  { name: 'module', summary: 'modules' },
  { name: 'issue', summary: 'the tracker' },
];

const CORE = createCommandRegistry({
  subjects: SUBJECTS,
  commands: [
    command('plan', 'create', { aliases: ['plan'] }),
    command('plan', 'list'),
    command('loop', 'start', { aliases: ['start'] }),
    command('loop', 'status'),
    command('loop', 'debug', { hidden: true }),
    command('module', 'exec', { exec: true, aliases: ['exec'] }),
    command('usage', 'usage'),
  ],
});

const REGISTRY = CORE.mount({
  name: 'linear',
  entry: '/modules/linear.ts',
  commands: [command('issue', 'next'), command('issue', 'peek', { hidden: true })],
});

/** A help request as a summary reads it. */
function requestOf(request: HelpRequest): string {
  switch (request.level) {
    case 'root':
      return 'root';
    case 'subject':
      return `subject ${request.subject.name}`;
    case 'action':
      return request.module === null
        ? `action ${request.spelling}`
        : `action ${request.spelling} from ${request.module.name}`;
  }
}

/** A route with every field it carries, the command as its spelling. */
function summaryOf(route: Route): Record<string, unknown> {
  switch (route.kind) {
    case 'command':
      return {
        kind: route.kind,
        command: commandSpelling(route.command),
        module: route.module?.name ?? null,
        alias: route.alias,
        label: route.label,
        argv: route.argv,
        line: route.line,
      };
    case 'help':
      return { kind: route.kind, request: requestOf(route.request), label: route.label, line: route.line };
    case 'refusal':
      return { kind: route.kind, code: route.code, message: route.message, label: route.label, line: route.line };
  }
}

/** The summary of a command route. */
function ran(
  spelling: string,
  label: string,
  argv: string[],
  line: string[],
  extra: { alias?: string; module?: string } = {},
): Record<string, unknown> {
  return {
    kind: 'command',
    command: spelling,
    module: extra.module ?? null,
    alias: extra.alias ?? null,
    label,
    argv,
    line,
  };
}

/** The summary of a help route. */
function helped(request: string, line: string[]): Record<string, unknown> {
  return { kind: 'help', request, label: 'help', line };
}

/** The summary of a refusal route. */
function refused(code: string, message: string, label: string, line: string[]): Record<string, unknown> {
  return { kind: 'refusal', code, message, label, line };
}

describe('a line routed to a command', () => {
  it.each([
    [
      'a subject and one of its actions',
      ['loop', 'start', '--plan=PLAN.md'],
      ran('loop start', 'loop start', ['--plan=PLAN.md'], ['--plan=PLAN.md']),
    ],
    ['a subject spelled as its plural', ['loops', 'status'], ran('loop status', 'loop status', [], [])],
    [
      'a top-level command, whose next word is not an action',
      ['usage', 'usage', '--x'],
      ran('usage', 'usage', ['usage', '--x'], ['usage', '--x']),
    ],
    [
      'a flag ahead of the subject, which takes no routing word as its value',
      ['-v', 'loop', 'start'],
      ran('loop start', 'loop start', [], ['-v']),
    ],
    [
      'flags between the routing words',
      ['loop', '--verbose=2', 'start', 'PLAN.md'],
      ran('loop start', 'loop start', ['PLAN.md'], ['--verbose=2', 'PLAN.md']),
    ],
    [
      'a help flag after --, which is a word of the command',
      ['loop', 'start', '--', '--help'],
      ran('loop start', 'loop start', ['--', '--help'], ['--', '--help']),
    ],
    [
      'an alias',
      ['start', '--plan=PLAN.md'],
      ran('loop start', 'loop start', ['--plan=PLAN.md'], ['--plan=PLAN.md'], { alias: 'start' }),
    ],
    [
      'an alias spelled as a subject, with no word after it',
      ['plan', '--spec=x.md'],
      ran('plan create', 'plan create', ['--spec=x.md'], ['--spec=x.md'], { alias: 'plan' }),
    ],
    [
      'an alias spelled as a subject, with a word that is none of its actions',
      ['plan', 'bogus'],
      ran('plan create', 'plan create', ['bogus'], ['bogus'], { alias: 'plan' }),
    ],
    [
      'a subject action ahead of an alias spelled as that subject',
      ['plan', 'list'],
      ran('plan list', 'plan list', [], []),
    ],
    ['a hidden action', ['loop', 'debug'], ran('loop debug', 'loop debug', [], [])],
    [
      'an exec action with no module word',
      ['module', 'exec', '--x'],
      ran('module exec', 'module exec', ['--x'], ['--x']),
    ],
    [
      'a mounted action through an exec action',
      ['module', 'exec', 'linear', 'next', '--since=today'],
      ran('issue next', 'module exec linear next', ['--since=today'], ['--since=today'], { module: 'linear' }),
    ],
    [
      'a mounted action through the plural subject',
      ['modules', 'exec', 'linear', 'next'],
      ran('issue next', 'module exec linear next', [], [], { module: 'linear' }),
    ],
    [
      'a mounted action through an alias of the exec action',
      ['exec', 'linear', 'next'],
      ran('issue next', 'module exec linear next', [], [], { module: 'linear', alias: 'exec linear next' }),
    ],
    [
      'a hidden mounted action',
      ['module', 'exec', 'linear', 'peek'],
      ran('issue peek', 'module exec linear peek', [], [], { module: 'linear' }),
    ],
  ])('routes %s', (_title, argv, expected) => {
    expect(summaryOf(routeLine(REGISTRY, argv))).toEqual(expected);
  });
});

describe('a line asking for help', () => {
  it.each([
    ['no word at all', [], helped('root', [])],
    ['flags and no routing word', ['--output=json'], helped('root', ['--output=json'])],
    ['only words after --', ['--', 'loop', 'start'], helped('root', ['--', 'loop', 'start'])],
    ['the help word alone', ['help'], helped('root', [])],
    ['the help flag alone', ['--help'], helped('root', ['--help'])],
    ['the help word and a plural subject', ['help', 'loops'], helped('subject loop', [])],
    ['a subject and --help', ['loop', '--help'], helped('subject loop', ['--help'])],
    ['a subject an alias is spelled as, and -h', ['plan', '-h'], helped('subject plan', ['-h'])],
    ['the help word and an action', ['help', 'loop', 'start'], helped('action loop start', [])],
    ['an alias and --help', ['start', '--help'], helped('action loop start', ['--help'])],
    [
      'a mounted action and --help',
      ['module', 'exec', 'linear', 'next', '--help'],
      helped('action module exec linear next from linear', ['--help']),
    ],
  ])('asks for help with %s', (_title, argv, expected) => {
    expect(summaryOf(routeLine(REGISTRY, argv))).toEqual(expected);
  });
});

describe('a line refused', () => {
  it.each([
    [
      'an unknown first word',
      ['bogus', 'start'],
      refused('unknown_subject', 'unknown subject or command "bogus"', 'bogus', ['start']),
    ],
    [
      'a flag value typed with a space ahead of the subject',
      ['--output', 'json', 'loop', 'start'],
      refused('unknown_subject', 'unknown subject or command "json"', 'json', ['--output', 'loop', 'start']),
    ],
    [
      'a subject with no action, naming no hidden one',
      ['loop'],
      refused('missing_action', '"loop" needs an action; one of: start, status', 'loop', []),
    ],
    [
      'a subject with an unknown action',
      ['loop', 'bogus', 'x'],
      refused('unknown_action', '"loop" has no action "bogus"; one of: start, status', 'loop bogus', ['x']),
    ],
    [
      'a subject holding no action',
      ['issue'],
      refused('missing_action', '"issue" needs an action; one of: none', 'issue', []),
    ],
    [
      'a mounted command by its own subject',
      ['issue', 'next'],
      refused('unknown_action', '"issue" has no action "next"; one of: none', 'issue next', []),
    ],
    [
      'a module word naming no mount',
      ['module', 'exec', 'jira', 'next'],
      refused('unknown_module', 'no module "jira" is mounted; mounted: linear', 'module exec jira', ['next']),
    ],
    [
      'a mount with no action, naming no hidden one',
      ['module', 'exec', 'linear'],
      refused('missing_action', 'module "linear" needs an action; one of: next', 'module exec linear', []),
    ],
    [
      'a mount with an unknown action',
      ['module', 'exec', 'linear', 'bogus'],
      refused('unknown_action', 'module "linear" has no action "bogus"; one of: next', 'module exec linear bogus', []),
    ],
    [
      'an unknown action asked for help',
      ['loop', 'bogus', '--help'],
      refused('unknown_action', '"loop" has no action "bogus"; one of: start, status', 'loop bogus', ['--help']),
    ],
  ])('refuses %s', (_title, argv, expected) => {
    expect(summaryOf(routeLine(REGISTRY, argv))).toEqual(expected);
  });

  it('refuses a module word when nothing is mounted, saying so', () => {
    expect(summaryOf(routeLine(CORE, ['module', 'exec', 'linear', 'next']))).toEqual(
      refused('unknown_module', 'no module "linear" is mounted; mounted: none', 'module exec linear', ['next']),
    );
  });
});

describe('the longest spelling', () => {
  const registry = createCommandRegistry({
    subjects: SUBJECTS,
    commands: [command('usage', 'usage'), command('loop', 'status', { aliases: ['usage now'] })],
  });

  it('routes an alias longer than the top-level command its first word names', () => {
    expect(summaryOf(routeLine(registry, ['usage', 'now']))).toEqual(
      ran('loop status', 'loop status', [], [], { alias: 'usage now' }),
    );
  });

  it('routes the top-level command when the next word is not the alias', () => {
    expect(summaryOf(routeLine(registry, ['usage', 'later']))).toEqual(ran('usage', 'usage', ['later'], ['later']));
  });
});

describe('routing', () => {
  it('reads a frozen line without changing it, and answers the same route twice', () => {
    const argv = Object.freeze(['-v', 'loop', 'start', '--plan=PLAN.md']);

    const first = summaryOf(routeLine(REGISTRY, argv));
    const second = summaryOf(routeLine(REGISTRY, argv));

    expect(first).toEqual(second);
    expect(argv).toEqual(['-v', 'loop', 'start', '--plan=PLAN.md']);
  });
});
