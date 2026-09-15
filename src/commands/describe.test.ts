/**
 * Tests for `rafa describe` (`src/commands/describe.ts`): its declaration,
 * what it writes in each mode, and that the roster it gives is the one
 * the dispatcher routed its line through, modules included.
 *
 * Each case dispatches a line through `dispatch`, as `src/rafa.ts` does,
 * with streams, an environment and a clock of its own, so what is read is
 * what the invocation wrote. The version is read from `package.json`
 * here, apart from the import the command takes.
 *
 * The module case dispatches over the core roster, whose `module exec`
 * action reaches a mounted module, naming two module entries a stand-in
 * importer answers:
 * one loads and one fails to import. Its control dispatches the same
 * registry with no module, and lists no module action, so what the first
 * lists came from the mount.
 *
 * Five mutations were driven on 2026-09-14, one run each through a driver
 * asserting one match, with every mutated file restored byte-identical
 * (sha256), and each reddened at least one case here. The json result
 * written as an `info` line reddened 2, and the text document unindented
 * 1. A version other than the manifest's reddened the 3 cases reading it,
 * and the build case of `src/tests/package-build.test.ts`. The dispatcher
 * settling a route over the registry it was handed, rather than the one
 * its modules were mounted on, reddened the module case here and the
 * registry case of `src/cli/dispatch.test.ts`. `describe` dropped from
 * the core roster reddened every case here but the `RAFA_OUTPUT` one,
 * which compares two refusals, and 8 more across the roster, help, entry
 * and builder suites.
 */
import type { OutputStream } from '../adapters/output/stream.js';
import type { RafaCommand } from '../cli/command.js';
import type { DescribeDocument } from '../cli/describe.js';
import type { DispatchOptions, DispatchOutcome } from '../cli/dispatch.js';
import type { ModuleImporter } from '../cli/modules.js';
import type { CliEvent } from '../ports/index.js';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import { describeRegistry } from '../cli/describe.js';
import { dispatch } from '../cli/dispatch.js';

import describeCommand from './describe.js';

import { CORE_REGISTRY } from './index.js';

/** The `version` of the repository's `package.json`, read as a file. */
const PACKAGE_VERSION = (JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as {
  version: string;
}).version;

/** The clock every event is stamped from. */
const NOW = new Date('2026-09-14T12:00:00.000Z');

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
interface Dispatched {
  readonly outcome: DispatchOutcome;
  readonly stdout: string;
  readonly stderr: string;
}

/** Dispatches a line over the core registry, or the one given, with its own streams, an empty environment and the fixed clock. */
async function dispatched(argv: readonly string[], extra: Partial<DispatchOptions> = {}): Promise<Dispatched> {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const outcome = await dispatch(argv, {
    registry: CORE_REGISTRY,
    env: {},
    stdout: stdout.stream,
    stderr: stderr.stream,
    now: () => NOW,
    ...extra,
  });
  return { outcome, stdout: stdout.text(), stderr: stderr.text() };
}

/** The events a json invocation wrote, one per line, each parsed. */
function eventsOf(stdout: string): CliEvent[] {
  return stdout
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as CliEvent);
}

/** The document a json invocation's terminal result carries. */
function resultOf(stdout: string): DescribeDocument {
  const last = eventsOf(stdout).at(-1);
  if (last?.type !== 'result') throw new Error(`expected a result event last, got ${JSON.stringify(last)}`);
  return last.data as DescribeDocument;
}

/** Each entry a module provides: where it is listed, its name and its module. */
function moduleEntries(document: DescribeDocument): (readonly [string, string, string | null])[] {
  return [
    ...document.subjects.flatMap((subject) => subject.actions.map((action) => [subject.name, action.name, action.module] as const)),
    ...document.commands.map((entry) => ['', entry.name, entry.module] as const),
  ].filter(([, , module]) => module !== null);
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

/** The command the loading module entry exports. */
const LINEAR_NEXT = command('linear', 'next');

/** Two module entries: one that loads, one whose import fails. */
const MODULES = [
  { name: 'linear', entry: '/modules/linear/commands.ts' },
  { name: 'broken', entry: '/modules/broken/commands.ts' },
];

/** Answers the first entry's commands, and fails every other import. */
const importModule: ModuleImporter = async (entry) => {
  if (entry === MODULES[0]?.entry) return { default: [LINEAR_NEXT] };
  throw new SyntaxError('Unexpected token at 3:1');
};

describe('the describe declaration', () => {
  it('is the top-level describe of the core registry, reading no argument or flag and writing text and json', () => {
    expect(CORE_REGISTRY.topLevel('describe')).toBe(describeCommand);
    expect([describeCommand.subject, describeCommand.action]).toEqual(['describe', 'describe']);
    expect([describeCommand.args, describeCommand.flags]).toEqual([[], []]);
    expect(describeCommand.outputs).toEqual(['text', 'json']);
    expect(Object.isFrozen(describeCommand)).toBe(true);
  });
});

describe('what rafa describe writes', () => {
  it('gives the document of the registry it was routed through as the data of its one result in json mode', async () => {
    const run = await dispatched(['describe', '--output=json']);
    const events = eventsOf(run.stdout);

    expect(run.outcome.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(events).toEqual([
      { type: 'start', command: 'describe', ts: NOW.toISOString() },
      { type: 'result', ok: true, data: describeRegistry(CORE_REGISTRY, PACKAGE_VERSION), ts: NOW.toISOString() },
    ]);
    expect(resultOf(run.stdout).version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('writes the same stream when RAFA_OUTPUT asks for json', async () => {
    const flagged = await dispatched(['describe', '--output=json']);
    const fromEnv = await dispatched(['describe'], { env: { RAFA_OUTPUT: 'json' } });

    expect(fromEnv.stdout).toBe(flagged.stdout);
  });

  it('prints the same document as JSON indented by two spaces in text mode, with no result prefix', async () => {
    const run = await dispatched(['describe']);

    expect(run.outcome.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.stdout).toBe(`${JSON.stringify(describeRegistry(CORE_REGISTRY, PACKAGE_VERSION), null, 2)}\n`);
  });

  it('lists the actions of a module the dispatcher mounted and warns for the one it skipped, and lists none with no module', async () => {
    const mounted = await dispatched(['describe', '--output=json'], { registry: CORE_REGISTRY, modules: MODULES, importModule });
    const bare = await dispatched(['describe', '--output=json'], { registry: CORE_REGISTRY });
    const loaded = CORE_REGISTRY.mount({ name: 'linear', entry: '/modules/linear/commands.ts', commands: [LINEAR_NEXT] });

    expect(mounted.outcome.exitCode).toBe(0);
    expect(eventsOf(mounted.stdout).map((event) => event.type)).toEqual(['start', 'log', 'result']);
    expect(eventsOf(mounted.stdout)[1]).toMatchObject({
      level: 'warn',
      message: 'module "broken": skipped "/modules/broken/commands.ts": import failed: Unexpected token at 3:1',
    });
    expect(moduleEntries(resultOf(mounted.stdout))).toEqual([['module', 'exec linear next', 'linear']]);
    expect(resultOf(mounted.stdout)).toStrictEqual(describeRegistry(loaded, PACKAGE_VERSION));
    expect(moduleEntries(resultOf(bare.stdout))).toEqual([]);
  });
});
