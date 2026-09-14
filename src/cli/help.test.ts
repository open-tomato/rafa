/**
 * Tests for the help renderer (`src/cli/help.ts`): the three frozen
 * snapshots over the core registry, and each rule of the module note over
 * a registry built here.
 *
 * ## The snapshots
 *
 * `testdata/help/rafa.txt`, `rafa-loop.txt` and `rafa-loop-start.txt`
 * hold what `rafa --help`, `rafa loop --help` and
 * `rafa loop start --help` print. Each case dispatches its line through
 * `dispatch` over `CORE_REGISTRY` with the renderer handed in, an empty
 * environment and streams of its own, so what is compared is the
 * dispatcher's stdout. One more case spawns `src/rafa.ts --help` and
 * holds its stdout to the root snapshot: the control that the entry hands
 * this renderer in, which the dispatched cases cannot see.
 *
 * Regenerating is opt-in, read as `src/tests/report-ask-live.test.ts`
 * reads its recapture flag. With `RAFA_UPDATE_HELP_SNAPSHOTS=1` this file
 * writes all three before any case reads them, so a run that regenerates
 * compares against what it just wrote and is green by construction: the
 * change is read in the diff. With the variable unset, or set to anything
 * else, nothing is written, and a snapshot that no longer matches is red.
 * The sensitivity case is the control that the comparison can fail: the
 * core roster less `usage` renders a root help that differs from the
 * snapshot.
 *
 * ## The rules
 *
 * The planted registry holds what the core roster lacks: a required
 * argument and a defaulted one, a required flag, flag aliases, a hidden
 * action under a subject and a hidden top-level command, a deprecated
 * action, an `exec` action with a module mounted, a long description and
 * an example longer than the width. Each case reads one block of one
 * level whole, so a line added, dropped or reordered in it is red.
 *
 * ## How far the cases reach
 *
 * Eighteen mutations were driven on 2026-09-14, one run of this file each
 * through a driver asserting one match, with 48 pass before and after and
 * `help.ts`, `src/rafa.ts` and the three snapshots restored byte-identical
 * (sha256), and each reddened at least one case. The quick start dropping
 * the top-level commands reddened 4, and reading hidden actions 1. The
 * subject's examples taken depth-first, or three of them, 1 each. No
 * `--no-` spelling and an optional flag unbracketed 2 each. An optional
 * argument spelled `<name>`, a string default unquoted, hidden actions in
 * `See also`, a mounted action's prefix read as its subject and the
 * deprecation block emptied 1 each. Wrapping one column early 2, no final
 * newline 19, and the verbose global flag dropped 5. The entry handing in
 * no renderer 1, the spawned case alone. The title's dash as a hyphen 10,
 * a one-letter alias with two dashes 2, and the column counting rows with
 * no note 6. Over a snapshot made stale, a run with the variable set to
 * `0` reddened that snapshot's case alone and left the file stale, and a
 * run with it set to `1` passed and wrote the original bytes back.
 */
import type { RafaCommand } from './command.js';
import type { CommandRegistry } from './registry.js';
import type { OutputStream } from '../adapters/output/stream.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { CORE_COMMANDS, CORE_REGISTRY, CORE_SUBJECTS } from '../commands/index.js';

import { commandSpelling } from './command.js';
import { assembleContext } from './core/assembleContext.js';
import { dispatch } from './dispatch.js';
import { GLOBAL_FLAGS, HELP_WIDTH, renderHelp } from './help.js';
import { createCommandRegistry } from './registry.js';
import { routeLine } from './route.js';

/** Where the three frozen snapshots live. */
const SNAPSHOT_DIR = fileURLToPath(new URL('./testdata/help/', import.meta.url));

/** Set to `1` to write the three snapshots afresh before the cases read them. */
const UPDATE_ENV = 'RAFA_UPDATE_HELP_SNAPSHOTS';

/** Each snapshot: the words after `rafa`, and its file under the snapshot directory. */
const SNAPSHOTS: readonly (readonly [line: string, file: string])[] = [
  ['--help', 'rafa.txt'],
  ['loop --help', 'rafa-loop.txt'],
  ['loop start --help', 'rafa-loop-start.txt'],
];

/** The CLI entry the spawned case runs. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** A temporary directory of this file's own, outside the repository. */
const tempBase = mkdtempSync(join(tmpdir(), 'rafa-help-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A stream collecting what is written to it. */
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

/** What dispatching the words of `line` over the core registry printed, with the renderer handed in. */
async function printed(line: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const { exitCode } = await dispatch(line.split(' '), {
    registry: CORE_REGISTRY,
    renderHelp,
    env: {},
    stdout: stdout.stream,
    stderr: stderr.stream,
    now: () => new Date('2026-09-14T12:00:00.000Z'),
  });
  return { stdout: stdout.text(), stderr: stderr.text(), exitCode };
}

if (process.env[UPDATE_ENV] === '1') {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  for (const [line, file] of SNAPSHOTS) {
    writeFileSync(join(SNAPSHOT_DIR, file), (await printed(line)).stdout, 'utf8');
  }
}

/** A snapshot's text, or a refusal naming the variable that writes it. */
function readSnapshot(file: string): string {
  const path = join(SNAPSHOT_DIR, file);
  if (!existsSync(path)) throw new Error(`${path} is missing; run this file with ${UPDATE_ENV}=1 to write it`);
  return readFileSync(path, 'utf8');
}

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

/** An example longer than the width, which is never wrapped. */
const LONG_CMD = `rafa loop status --plan=.plans/PLAN-${'x'.repeat(HELP_WIDTH)}.md`;

/** A description longer than the width, which is wrapped. */
const LONG_DESCRIPTION = `Shows ${'the state of every task in the plan, '.repeat(6)}and nothing else.`;

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
        { name: 'spec', description: 'The spec.', type: 'string', required: true },
        { name: 'ci-wait', description: 'Waits.', type: 'boolean', default: true },
        { name: 'ci-timeout', description: 'Minutes.', type: 'number', default: 30 },
        { name: 'detached', description: 'Detaches.', type: 'boolean', aliases: ['d', 'bg'] },
      ],
      examples: [
        { cmd: 'rafa loop start', note: 'starts' },
        { cmd: 'rafa loop start --plan=P.md', note: 'starts P' },
      ],
      outputs: ['text', 'json'],
      aliases: ['start'],
    }),
    command('loop', 'status', {
      description: LONG_DESCRIPTION,
      examples: [
        { cmd: 'rafa loop status', note: 'shows' },
        { cmd: LONG_CMD, note: 'shows one plan' },
      ],
    }),
    command('loop', 'secret', { hidden: true, examples: [{ cmd: 'rafa loop secret', note: 'hush' }] }),
    command('loop', 'old', { deprecated: { since: '0.2.0', use: 'loop start' } }),
    command('plan', 'draft', { hidden: true }),
    command('plan', 'list'),
    command('module', 'exec', { exec: true, examples: [{ cmd: 'rafa module exec <module> <action>', note: 'runs one' }] }),
    command('doctor', 'doctor', { examples: [{ cmd: 'rafa doctor', note: 'checks' }] }),
    command('hush', 'hush', { hidden: true }),
    command('init', 'init', { examples: [] }),
  ],
}).mount({
  name: 'linear',
  entry: '/modules/linear/commands.ts',
  commands: [command('linear', 'next'), command('linear', 'claim')],
});

/** The help a line asks for over a registry, rendered: the words, then `--help`. */
function helpFor(registry: CommandRegistry, line: string): string {
  const words = line === ''
    ? []
    : line.split(' ');
  const route = routeLine(registry, [...words, '--help']);
  if (route.kind !== 'help') throw new Error(`expected rafa ${line} --help to ask for help, got ${route.kind}`);
  return renderHelp(route.request, registry);
}

/** The lines of one block of a help text: the heading's lines up to the next blank line, the heading left out. */
function blockOf(text: string, heading: string): string[] {
  const lines = text.split('\n');
  const start = lines.indexOf(`${heading}:`);
  if (start === -1) return [];
  const end = lines.indexOf('', start);
  return lines.slice(start + 1, end);
}

/** The headings of a help text, in order. */
function headingsOf(text: string): string[] {
  return text.split('\n').filter((line) => /^[A-Z][a-z ]*:$/.test(line));
}

describe('the frozen help snapshots', () => {
  it.each(SNAPSHOTS)('hold what rafa %s prints, as testdata/help/%s', async (line, file) => {
    const run = await printed(line);

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.stdout).toBe(readSnapshot(file));
  });

  it('differs from the root snapshot once one command leaves the roster, so the comparison can fail', () => {
    const lessUsage = createCommandRegistry({
      subjects: CORE_SUBJECTS,
      commands: CORE_COMMANDS.filter((held) => commandSpelling(held) !== 'usage'),
    });
    const snapshot = readSnapshot('rafa.txt');

    expect(renderHelp({ level: 'root' }, CORE_REGISTRY)).toBe(snapshot);
    expect(renderHelp({ level: 'root' }, lessUsage)).not.toBe(snapshot);
    expect(blockOf(snapshot, 'Commands')).toEqual(['  usage']);
  });

  it('holds the root snapshot as what src/rafa.ts prints for --help', () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('RAFA_')));
    const run = Bun.spawnSync([process.execPath, RAFA_ENTRY, '--help'], { cwd: tempBase, env: { ...env, HOME: tempBase } });

    expect(run.exitCode).toBe(0);
    expect(run.stderr.toString()).toBe('');
    expect(run.stdout.toString()).toBe(readSnapshot('rafa.txt'));
  }, 30_000);
});

describe('the root help', () => {
  const text = helpFor(PLANTED, '');

  it('opens with the tagline and lists its blocks in order', () => {
    expect(text.split('\n')[0]).toBe('rafa — run a plan through the ralph loop, one task per session');
    expect(headingsOf(text)).toEqual(['Usage:', 'Quick start:', 'Subjects:', 'Commands:', 'Global flags:']);
  });

  it('aligns the usage lines past the longest one with a note', () => {
    expect(blockOf(text, 'Usage')).toEqual([
      '  rafa <subject> <action> [args] [flags]',
      '  rafa <subject> --help            actions for a subject',
      '  rafa <subject> <action> --help   arguments, flags, examples',
    ]);
  });

  it('takes the quick start from the first visible action of each subject, then each top-level command with an example', () => {
    expect(blockOf(text, 'Quick start')).toEqual([
      '  rafa loop start',
      '  rafa plan list',
      '  rafa module exec <module> <action>',
      '  rafa doctor',
    ]);
  });

  it('lists every subject with its summary, and the visible top-level commands by name', () => {
    expect(blockOf(text, 'Subjects')).toEqual(['  loop     the loop', '  plan     plans', '  module   modules']);
    expect(blockOf(text, 'Commands')).toEqual(['  doctor, init']);
  });

  it('lists the global flags', () => {
    expect(blockOf(text, 'Global flags')).toEqual([
      '  --output=json   NDJSON events instead of text (also RAFA_OUTPUT=json)',
      '  -v, --verbose   repeat for more, up to 3; --verbose=N (also RAFA_VERBOSITY=N)',
    ]);
  });

  it('leaves out a block with nothing to list', () => {
    const bare = createCommandRegistry({ subjects: [{ name: 'loop', summary: 'the loop' }], commands: [command('loop', 'start')] });

    expect(headingsOf(helpFor(bare, ''))).toEqual(['Usage:', 'Quick start:', 'Subjects:', 'Global flags:']);
  });
});

describe('the global flags the root help lists', () => {
  /** The context `assembleContext` builds for a line and an environment. */
  const read = (argv: string[], env: Record<string, string> = {}) => assembleContext({ argv, env, stream: memoryStream().stream });

  it('are the output mode and the verbosity, each read by assembleContext as its note says', () => {
    expect(GLOBAL_FLAGS.map((flag) => flag.spelling)).toEqual(['--output=json', '-v, --verbose']);
    expect(read([]).outputMode).toBe('text');
    expect(read(['--output=json']).outputMode).toBe('json');
    expect(read([], { RAFA_OUTPUT: 'json' }).outputMode).toBe('json');
    expect(read([]).verbosity).toBe(0);
    expect(read(['-v', '--verbose']).verbosity).toBe(2);
    expect(read(['-v', '-v', '-v', '-v']).verbosity).toBe(3);
    expect(read(['--verbose=2']).verbosity).toBe(2);
    expect(read([], { RAFA_VERBOSITY: '1' }).verbosity).toBe(1);
  });
});

describe('a subject help', () => {
  const text = helpFor(PLANTED, 'loop');

  it('opens with the subject and its summary, then its usage lines', () => {
    expect(text.split('\n')[0]).toBe('rafa loop — the loop');
    expect(blockOf(text, 'Usage')).toEqual([
      '  rafa loop <action> [args] [flags]',
      '  rafa loop <action> --help   arguments, flags, examples',
    ]);
  });

  it('lists each visible action with its summary', () => {
    expect(blockOf(text, 'Actions')).toEqual([
      '  start    start the loop',
      '  status   status things',
      '  old      old things',
    ]);
  });

  it('takes two examples across the actions, the first of each before the second of any', () => {
    expect(blockOf(text, 'Examples')).toEqual([
      '  rafa loop start',
      '      starts',
      '  rafa loop status',
      '      shows',
    ]);
  });

  it('leaves the examples of a hidden action out', () => {
    expect(blockOf(helpFor(PLANTED, 'plan'), 'Examples')).toEqual(['  rafa plan list', '      runs list']);
  });
});

describe('an action help', () => {
  const text = helpFor(PLANTED, 'loop start');

  it('opens with the spelling and summary, and lists its blocks in the order the spec gives', () => {
    expect(text.split('\n')[0]).toBe('rafa loop start — start the loop');
    expect(headingsOf(text)).toEqual([
      'Usage:',
      'Description:',
      'Arguments:',
      'Flags:',
      'Examples:',
      'Outputs:',
      'See also:',
    ]);
  });

  it('builds the usage line from the arguments and flags, required in <> or bare and optional in []', () => {
    expect(blockOf(text, 'Usage')).toEqual([
      '  rafa loop start <stub> [mode] [-p|--plan=<string>] --spec=<string>',
      '    [--no-ci-wait] [--ci-timeout=<number>] [-d|--bg|--detached]',
    ]);
  });

  it('tables the arguments and flags with type, required, default and aliases', () => {
    expect(blockOf(text, 'Arguments')).toEqual([
      '  stub   string, required',
      '      The stub.',
      '  mode   string, default "full"',
      '      The mode.',
    ]);
    expect(blockOf(text, 'Flags')).toEqual([
      '  -p, --plan             string',
      '      The plan.',
      '  --spec                 string, required',
      '      The spec.',
      '  --ci-wait              boolean, default true',
      '      Waits.',
      '  --ci-timeout           number, default 30',
      '      Minutes.',
      '  -d, --bg, --detached   boolean',
      '      Detaches.',
    ]);
  });

  it('lists its examples, its outputs and the other visible actions of its subject', () => {
    expect(blockOf(text, 'Examples')).toEqual(['  rafa loop start', '      starts', '  rafa loop start --plan=P.md', '      starts P']);
    expect(blockOf(text, 'Outputs')).toEqual(['  text, json']);
    expect(blockOf(text, 'See also')).toEqual(['  rafa loop status, rafa loop old']);
  });

  it('is the same for an alias of the action', () => {
    expect(helpFor(PLANTED, 'start')).toBe(text);
  });

  it('says a deprecated action is deprecated, and what to use instead', () => {
    const old = helpFor(PLANTED, 'loop old');

    expect(headingsOf(old)[0]).toBe('Deprecated:');
    expect(blockOf(old, 'Deprecated')).toEqual(['  since 0.2.0; use "rafa loop start"']);
    expect(blockOf(text, 'Deprecated')).toEqual([]);
  });

  it('renders a hidden action, which still dispatches, and names it in no other See also', () => {
    const secret = helpFor(PLANTED, 'loop secret');

    expect(secret.split('\n')[0]).toBe('rafa loop secret — secret things');
    expect(blockOf(secret, 'See also')).toEqual(['  rafa loop start, rafa loop status, rafa loop old']);
  });

  it('has no See also for a top-level command, and none for a flagless one', () => {
    const doctor = helpFor(PLANTED, 'doctor');

    expect(headingsOf(doctor)).toEqual(['Usage:', 'Description:', 'Examples:', 'Outputs:']);
    expect(blockOf(doctor, 'Usage')).toEqual(['  rafa doctor']);
  });

  it('spells a mounted action and its See also through the exec action and the module', () => {
    const next = helpFor(PLANTED, 'module exec linear next');

    expect(next.split('\n')[0]).toBe('rafa module exec linear next — next things');
    expect(blockOf(next, 'Usage')).toEqual(['  rafa module exec linear next']);
    expect(blockOf(next, 'See also')).toEqual(['  rafa module exec linear claim']);
  });
});

describe('the layout of every level', () => {
  /**
   * Each text by its title, read when a case runs. A snapshot read while
   * the cases are collected throws there when it is missing, and bun then
   * drops every case of this block without counting one as failed.
   */
  const texts: readonly (readonly [string, () => string])[] = [
    ...SNAPSHOTS.map(([line, file]) => [`the snapshot of rafa ${line}`, () => readSnapshot(file)] as const),
    ...['', 'loop', 'plan', 'loop start', 'loop status', 'loop old', 'doctor', 'module exec linear next']
      .map((line) => [`planted ${['rafa', line, '--help'].filter((word) => word !== '').join(' ')}`, () => helpFor(PLANTED, line)] as const),
  ];
  const commands = [...CORE_REGISTRY.commands({ includeHidden: true }), ...PLANTED.commands({ includeHidden: true })];
  const exampleLines = new Set(commands.flatMap((held) => held.examples.map((example) => `  ${example.cmd}`)));

  it.each(texts)('ends %s in one newline, with no trailing space and no two blank lines together', (_title, textOf) => {
    const text = textOf();

    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(text.includes('\n\n\n')).toBe(false);
    expect(text.split('\n').filter((line) => line.endsWith(' '))).toEqual([]);
  });

  it.each(texts)('wraps %s at the width, past which only an example command runs', (_title, textOf) => {
    const lines = textOf().split('\n');
    const over = lines.filter((line) => line.length > HELP_WIDTH);

    expect(over.filter((line) => !exampleLines.has(line))).toEqual([]);
  });

  it('wraps a long description under its heading, and keeps a long example whole', () => {
    const status = helpFor(PLANTED, 'loop status');
    const description = blockOf(status, 'Description');

    expect(description.length).toBeGreaterThan(1);
    expect(description.every((line) => line.startsWith('  ') && line.length <= HELP_WIDTH)).toBe(true);
    expect(description.map((line) => line.trim()).join(' ')).toBe(LONG_DESCRIPTION);
    expect(blockOf(status, 'Examples')).toContain(`  ${LONG_CMD}`);
  });
});
