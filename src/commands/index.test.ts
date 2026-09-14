/**
 * Tests for the core roster (`src/commands/index.ts`) and the
 * declarations of the six commands it registers: what the registry
 * holds, how each spelling of the command tree routes, with the
 * deprecation line each alias prints, and that each command wrapping a
 * phase 0 command declares the flags its phase 0 module reads.
 * `describe` wraps none, and declares no flag.
 *
 * The routing cases dispatch over a registry built from the roster's own
 * subjects and commands, each `run` swapped for one recording what ran
 * and the words it was handed. So each declaration routes as registered,
 * and no phase 0 command runs: no git, no home, no session. That a
 * wrapped `run` hands those words on is held in `wrap.test.ts`, and the
 * phase 0 commands run behind `src/rafa.ts` in the suites that spawn it.
 *
 * ## The flag cases read source
 *
 * A flag declared and not read by its phase 0 parser promises what the
 * command lacks: `-p` for `--plan`, which the command tree spells for
 * `loop start`, is read by no parser, so the loop would run its default
 * plan. A flag read and not declared is missing from help. So each
 * command's flags, typed as a line types them (`--<name>`, or
 * `--no-<name>` for one defaulting to true), are held equal to the quoted
 * `--` literals of the modules reading its command line, a literal being
 * one a quote or an `=` closes. Read when this landed, those literals are
 * exactly the flags each parser compares an argument against: no message,
 * usage line or comment in those modules quotes one that way. The control
 * reads a planted `--detached`, which the tree declares for `loop start`
 * and `src/start.ts` does not read, and skips the same flag inside a
 * message.
 *
 * Seven mutations were driven on 2026-09-14, one run each over this file,
 * with 28 pass before and after and every file restored byte-identical
 * (sha256), and each reddened at least one case. The `start` alias
 * dropped reddened three: the alias case, its route and its help line.
 * `--detached` declared for `loop start` and `--any-branch` left
 * undeclared each reddened the `loop start` flag case, and the default of
 * `progress` dropped reddened the `plan create` one, the flag then typed
 * as `--progress`. The subject `issue` declared ahead of any action
 * reddened the subject case, `json` among the outputs of `usage` its
 * declaration case, and `effort report` ahead of `effort collect` the
 * roster order case and the refusal listing the actions of `effort`.
 */
import type { OutputStream } from '../adapters/output/stream.js';
import type { RafaCommand } from '../cli/command.js';
import type { DispatchOutcome } from '../cli/dispatch.js';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import { commandProblem, commandSpelling } from '../cli/command.js';
import { dispatch } from '../cli/dispatch.js';
import { createCommandRegistry } from '../cli/registry.js';

import { CORE_COMMANDS, CORE_REGISTRY, CORE_SUBJECTS } from './index.js';

/** The `src/` directory, which the phase 0 modules sit in. */
const SRC_DIR = fileURLToPath(new URL('../', import.meta.url));

/** The modules reading each command line, from `src/`. */
const READERS: Readonly<Record<string, readonly string[]>> = {
  'plan create': ['plan.ts'],
  'loop start': ['start.ts', 'start/run-config.ts'],
  'effort collect': ['effort/collect.ts'],
  'effort report': ['effort/report.ts'],
  'usage': ['usage.ts'],
};

/** The outputs each command declares: text and json, each phase 0 command now writing through the active output. */
const OUTPUTS: Readonly<Record<string, RafaCommand['outputs']>> = {
  'plan create': ['text', 'json'],
  'loop start': ['text', 'json'],
  'effort collect': ['text', 'json'],
  'effort report': ['text', 'json'],
  'usage': ['text', 'json'],
  'describe': ['text', 'json'],
};

/** The deprecation line typing `typed` writes, as stderr holds it. */
function deprecation(typed: string, spelling: string): string {
  return `rafa: "rafa ${typed}" is deprecated; use "rafa ${spelling}"\n`;
}

/** Each line: the words after `rafa`, the command that runs, the words it is handed, and stderr. */
const ROUTES: readonly (readonly [string, string, readonly string[], string])[] = [
  ['plan create --spec=.specs/a.md --stub=a', 'plan create', ['--spec=.specs/a.md', '--stub=a'], ''],
  ['plan --spec=.specs/a.md', 'plan create', ['--spec=.specs/a.md'], deprecation('plan', 'plan create')],
  ['plan', 'plan create', [], deprecation('plan', 'plan create')],
  ['loop start --plan=.plans/PLAN-a.md --no-ci-wait', 'loop start', ['--plan=.plans/PLAN-a.md', '--no-ci-wait'], ''],
  ['start --plan=.plans/PLAN-a.md', 'loop start', ['--plan=.plans/PLAN-a.md'], deprecation('start', 'loop start')],
  ['loops start', 'loop start', [], ''],
  ['usage', 'usage', [], ''],
  ['effort collect --since=2026-09-01 --no-git', 'effort collect', ['--since=2026-09-01', '--no-git'], ''],
  ['efforts report --kind=task', 'effort report', ['--kind=task'], ''],
  ['describe', 'describe', [], ''],
];

/** Each core command by its spelling. */
const COMMANDS = CORE_COMMANDS.map((command): [string, RafaCommand] => [commandSpelling(command), command]);

/** What one line ran, and what it wrote. */
interface Dispatched {
  readonly ran: readonly (readonly [string, readonly string[]])[];
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

/** Dispatches the words of `line` over the roster, each command recording what it was handed in place of running. */
async function dispatchRecorded(line: string): Promise<Dispatched> {
  const ran: (readonly [string, readonly string[]])[] = [];
  const commands = CORE_COMMANDS.map((command): RafaCommand => ({
    ...command,
    run: async (context) => {
      ran.push([commandSpelling(command), [...context.argv]]);
    },
  }));
  const stdout = memoryStream();
  const stderr = memoryStream();
  const outcome = await dispatch(line.split(' ').filter((word) => word.length > 0), {
    registry: createCommandRegistry({ subjects: CORE_SUBJECTS, commands }),
    env: {},
    stdout: stdout.stream,
    stderr: stderr.stream,
    now: () => new Date('2026-09-14T12:00:00.000Z'),
  });
  return { ran, outcome, stdout: stdout.text(), stderr: stderr.text() };
}

/** A declared flag as a line types it: `--<name>`, or `--no-<name>` for one defaulting to true. */
function typedFlag(flag: RafaCommand['flags'][number]): string {
  return flag.default === true
    ? `--no-${flag.name}`
    : `--${flag.name}`;
}

/** The quoted flag literals of a source, each once and sorted: `'--name'` and `'--name=`. */
function literalFlags(source: string): string[] {
  const flags = [...source.matchAll(/'(--[a-z][a-z-]*)['=]/g)].map((match) => match[1] ?? '');
  return [...new Set(flags)].sort((a, b) => a.localeCompare(b));
}

describe('the core roster', () => {
  it('registers the three subjects with an action, in roster order', () => {
    expect(CORE_REGISTRY.subjects().map((subject) => subject.name)).toEqual(['plan', 'loop', 'effort']);
    expect(CORE_SUBJECTS.filter((subject) => CORE_REGISTRY.actionsOf(subject.name).length === 0)).toEqual([]);
  });

  it('registers the five phase 0 commands, then describe, in roster order, none of them hidden', () => {
    expect(CORE_REGISTRY.commands({ includeHidden: true }).map(commandSpelling)).toEqual([
      'plan create',
      'loop start',
      'effort collect',
      'effort report',
      'usage',
      'describe',
    ]);
    expect(CORE_REGISTRY.commands()).toHaveLength(CORE_COMMANDS.length);
  });

  it('aliases plan create as plan and loop start as start, and nothing else', () => {
    expect(CORE_REGISTRY.aliases().map((alias) => [alias.words.join(' '), commandSpelling(alias.command)])).toEqual([
      ['plan', 'plan create'],
      ['start', 'loop start'],
    ]);
  });

  it.each(COMMANDS)('declares for %s a summary, a description, examples of its own spelling and its outputs', (spelling, command) => {
    expect(commandProblem(command)).toBeNull();
    expect(command.summary.length).toBeGreaterThan(0);
    expect(command.description.length).toBeGreaterThan(command.summary.length);
    expect(command.examples.length).toBeGreaterThan(0);
    expect(command.examples.filter((example) => !example.cmd.startsWith(`rafa ${spelling}`))).toEqual([]);
    expect(command.outputs).toEqual(OUTPUTS[spelling] ?? []);
  });
});

describe('how the command tree routes', () => {
  it.each(ROUTES)('runs rafa %s as %s', async (line, spelling, argv, stderr) => {
    const run = await dispatchRecorded(line);

    expect(run.ran).toEqual([[spelling, argv]]);
    expect(run.stderr).toBe(stderr);
    expect(run.stdout).toBe('');
    expect(run.outcome.exitCode).toBe(0);
  });

  it('runs rafa effort report --json in json mode after one deprecation line, handed --json as typed', async () => {
    const run = await dispatchRecorded('effort report --json');

    expect(run.ran).toEqual([['effort report', ['--json']]]);
    expect(run.stderr).toBe('rafa: "rafa effort report --json" is deprecated; use "rafa effort report --output=json"\n');
    const types = run.stdout
      .trimEnd()
      .split('\n')
      .map((line) => (JSON.parse(line) as { type: string }).type);
    expect(types).toEqual(['start', 'result']);
    expect(run.outcome.exitCode).toBe(0);
  });

  it.each(['--help', 'start --help', 'plan --help', 'effort report --help'])('answers rafa %s with help, running nothing', async (line) => {
    const run = await dispatchRecorded(line);

    expect(run.ran).toEqual([]);
    expect(run.stdout.length).toBeGreaterThan(0);
    expect(run.stderr).toBe('');
    expect(run.outcome.exitCode).toBe(0);
  });

  it('refuses a subject with no action, and a word naming nothing, running nothing', async () => {
    const bare = await dispatchRecorded('effort');
    const unknown = await dispatchRecorded('stop');

    expect(bare.stderr).toBe('rafa: "effort" needs an action; one of: collect, report\n');
    expect(unknown.stderr).toBe('rafa: unknown subject or command "stop"\n');
    expect([bare.outcome.exitCode, unknown.outcome.exitCode]).toEqual([1, 1]);
    expect([...bare.ran, ...unknown.ran]).toEqual([]);
  });
});

describe('the flags each command declares', () => {
  it('declares no argument and no flag for describe, which wraps no phase 0 command and reads no command line', () => {
    const own = CORE_REGISTRY.topLevel('describe');

    expect(own).toBeDefined();
    expect([own?.args, own?.flags]).toEqual([[], []]);
  });

  it.each(COMMANDS.filter(([spelling]) => spelling !== 'describe'))('declares for %s exactly the flags its phase 0 module reads', (spelling, command) => {
    const readers = READERS[spelling] ?? [];
    const read = literalFlags(readers.map((file) => readFileSync(join(SRC_DIR, file), 'utf8')).join('\n'));

    expect(readers.length).toBeGreaterThan(0);
    expect(command.flags.map(typedFlag).sort((a, b) => a.localeCompare(b))).toEqual(read);
  });

  it('reads a planted quoted flag literal, and none inside a message', () => {
    expect(literalFlags('if (args.includes(\'--detached\')) return;')).toEqual(['--detached']);
    expect(literalFlags('argValue(args, \'--plan\'); arg.startsWith(\'--since=\');')).toEqual(['--plan', '--since']);
    expect(literalFlags('console.error(\'Usage: rafa loop start --detached\');')).toEqual([]);
  });
});
