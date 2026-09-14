/**
 * Tests for `RafaCommand`, `RafaContext`, `CommandExit` and the shape
 * check (`src/cli/command.ts`).
 *
 * The type claims are compiled as probes through the TypeScript compiler
 * API under the root tsconfig, as `src/cli/core/types.test.ts` does and
 * for its reason: `check-types` never reads a test file, and `bun:test`'s
 * `expectTypeOf` checks nothing at run time. The clean probe holds that a
 * `run` written against `CliContext` is a `RafaCommand`'s `run`, that a
 * `RafaContext` is a `CliContext` carrying `argv`, and that a
 * `RafaCommand` is a `ParseArgsSpec`. Each refusal probe changes one
 * thing and is held to exactly one diagnostic naming it, and the clean
 * probe keeps the refusals from passing vacuously.
 *
 * Every shape problem is spelled in full, one field changed at a time
 * from a command with every field, which passes; a command failing on
 * two fields is held to name the first.
 *
 * Four mutations of `command.ts` were driven on 2026-09-14, one run each
 * over the eight suites under `src/cli/`, with 326 pass before and after
 * and the module restored byte-identical (sha256), and each reddened at
 * least one case. A routing word allowed a slash reddened four: two
 * routing-word cases here, the slashed action, and the registry's
 * slashed subject. `CommandExit` accepting 256, `exec` left unchecked,
 * and a list read as a command mapping each reddened their own case.
 */
import type { RafaCommand } from './command.js';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import ts from 'typescript';

import {
  COMMAND_OUTPUTS,
  CommandExit,
  commandProblem,
  commandSpelling,
  isRoutingWord,
  isTopLevel,
} from './command.js';

/** A command with every field filled. */
const VALID: RafaCommand = {
  name: 'loop start',
  description: 'Starts the loop.',
  subject: 'loop',
  action: 'start',
  summary: 'start the loop',
  args: [],
  flags: [{ name: 'plan', description: 'The plan.', type: 'string' }],
  examples: [{ cmd: 'rafa loop start', note: 'starts the loop' }],
  outputs: ['text', 'json'],
  run: async () => {},
};

describe('CommandExit', () => {
  it.each([0, 1, 255])('carries exit code %d as an error named CommandExit', (exitCode) => {
    const exit = new CommandExit(exitCode, 'refused');

    expect(exit).toBeInstanceOf(Error);
    expect(exit.name).toBe('CommandExit');
    expect(exit.exitCode).toBe(exitCode);
    expect(exit.message).toBe('refused');
  });

  it('carries an empty message when none is given', () => {
    expect(new CommandExit(2).message).toBe('');
  });

  it.each([
    [-1, 'CommandExit: exit code is -1, expected a whole number from 0 to 255'],
    [256, 'CommandExit: exit code is 256, expected a whole number from 0 to 255'],
    [1.5, 'CommandExit: exit code is 1.5, expected a whole number from 0 to 255'],
    [Number.NaN, 'CommandExit: exit code is NaN, expected a whole number from 0 to 255'],
  ])('refuses exit code %p with a TypeError', (exitCode, message) => {
    expect(() => new CommandExit(exitCode)).toThrow(TypeError);
    expect(() => new CommandExit(exitCode)).toThrow(message);
  });
});

describe('routing words and spellings', () => {
  it.each(['loop', 'self-update', 'x1', 'module-exec'])('accepts %p as a routing word', (word) => {
    expect(isRoutingWord(word)).toBe(true);
  });

  it.each(['', '-v', '--help', 'a b', 'module/linear', '/x', ' loop', 1, undefined])(
    'refuses %p as a routing word',
    (word) => {
      expect(isRoutingWord(word)).toBe(false);
    },
  );

  it('spells a command by its subject and action, and a top-level command by its one word', () => {
    expect(commandSpelling(VALID)).toBe('loop start');
    expect(isTopLevel(VALID)).toBe(false);
    expect(commandSpelling({ subject: 'usage', action: 'usage' })).toBe('usage');
    expect(isTopLevel({ subject: 'usage', action: 'usage' })).toBe(true);
  });

  it('names the three outputs an action can declare', () => {
    expect(COMMAND_OUTPUTS).toEqual(['text', 'json', 'tui']);
  });
});

describe('the shape check', () => {
  it('answers null for a command with every field', () => {
    expect(commandProblem(VALID)).toBeNull();
  });

  it('answers null for every optional field set, and for fields with no content', () => {
    expect(commandProblem({
      ...VALID,
      summary: '',
      examples: [],
      outputs: [],
      aliases: [],
      deprecated: { since: '0.2.0', use: 'loop start' },
      hidden: false,
      exec: true,
    })).toBeNull();
  });

  it.each([
    ['null', null, 'a command is null, expected a mapping'],
    ['a list', [VALID], 'a command is a list, expected a mapping'],
    ['a string', 'loop start', 'a command is "loop start", expected a mapping'],
  ])('refuses %s as no mapping', (_title, value, message) => {
    expect(commandProblem(value)).toBe(message);
  });

  it.each([
    [
      'a subject with a leading dash',
      { subject: '-loop' },
      'a command: subject is "-loop", expected a word with no space, no slash and no leading dash',
    ],
    [
      'an action with a slash',
      { action: 'a/b' },
      'a command: action is "a/b", expected a word with no space, no slash and no leading dash',
    ],
    ['a name that is not a string', { name: 1 }, 'command "loop start": name is 1, expected a string'],
    ['no summary', { summary: undefined }, 'command "loop start": summary is undefined, expected a string'],
    ['a null description', { description: null }, 'command "loop start": description is null, expected a string'],
    [
      'an unnamed argument',
      { args: [{ description: 'x' }] },
      'command "loop start": args is a list, expected a list of named arguments',
    ],
    [
      'flags that are not a list',
      { flags: 'plan' },
      'command "loop start": flags is "plan", expected a list of named flags, each deprecation naming its use',
    ],
    [
      'a flag deprecation naming no use',
      { flags: [{ name: 'json', description: 'x', type: 'boolean', deprecated: { since: '0.2.0' } }] },
      'command "loop start": flags is a list, expected a list of named flags, each deprecation naming its use',
    ],
    [
      'an example with no note',
      { examples: [{ cmd: 'rafa loop start' }] },
      'command "loop start": examples is a list, expected a list of examples',
    ],
    [
      'an output outside the three',
      { outputs: ['text', 'html'] },
      'command "loop start": outputs is a list, expected a list of text, json, tui',
    ],
    [
      'an alias that is not a string',
      { aliases: [1] },
      'command "loop start": aliases is a list, expected absent or a list of strings',
    ],
    [
      'a deprecation with no use',
      { deprecated: { since: '0.2.0' } },
      'command "loop start": deprecated is a mapping, expected absent or a mapping of since and use',
    ],
    ['hidden as a string', { hidden: 'yes' }, 'command "loop start": hidden is "yes", expected absent or a boolean'],
    ['exec as false', { exec: false }, 'command "loop start": exec is false, expected absent or true'],
    ['no run', { run: undefined }, 'command "loop start": run is undefined, expected a function'],
    ['two fields failing, naming the first', { name: 1, run: undefined }, 'command "loop start": name is 1, expected a string'],
  ])('answers %s', (_title, overrides, message) => {
    expect(commandProblem({ ...VALID, ...overrides })).toBe(message);
  });
});

/** The `src/` directory the probes import from. */
const SRC_DIR = fileURLToPath(new URL('../', import.meta.url));

/** The repository root, whose tsconfig the probes compile under. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** A probe's source: the command module as `C` and the core contracts as `T`, then the lines given. */
function probeSource(...lines: string[]): string {
  return [
    `import type * as C from ${JSON.stringify(join(SRC_DIR, 'cli', 'command.js'))};`,
    `import type * as T from ${JSON.stringify(join(SRC_DIR, 'cli', 'core', 'types.js'))};`,
    `import type { ParseArgsSpec } from ${JSON.stringify(join(SRC_DIR, 'cli', 'core', 'parseArgs.js'))};`,
    'export const base = {',
    '  name: "loop start", description: "Starts.", subject: "loop", action: "start", summary: "starts",',
    '  args: [], flags: [], examples: [{ cmd: "rafa loop start", note: "starts" }],',
    '};',
    'export type Imported = [C.RafaContext, T.CliContext, ParseArgsSpec];',
    ...lines,
    '',
  ].join('\n');
}

/** The probe holding every claim, which must compile clean. */
const CONFORMING_PROBE = probeSource(
  'export const cliRun: T.CliCommand["run"] = async (context) => { context.output.info(context.outputMode); };',
  'export const command: C.RafaCommand = {',
  '  ...base, outputs: ["text", "json", "tui"], aliases: ["start"],',
  '  deprecated: { since: "0.2.0", use: "loop start" }, hidden: false, exec: true, run: cliRun,',
  '};',
  'export function widened(context: C.RafaContext): T.CliContext { return context; }',
  'export function argvOf(context: C.RafaContext): readonly string[] { return context.argv; }',
  'export const spec: ParseArgsSpec = command;',
);

/** One probe changing one thing, and the one diagnostic it must draw. */
interface Refusal {
  title: string;
  file: string;
  source: string;
  code: number;
  names: string;
}

const REFUSALS: readonly Refusal[] = [
  {
    title: 'an output outside text, json and tui',
    file: 'output-html.ts',
    source: probeSource('export const command: C.RafaCommand = { ...base, outputs: ["html"], run: async () => {} };'),
    code: 2322,
    names: '"html"',
  },
  {
    title: 'exec set to false',
    file: 'exec-false.ts',
    source: probeSource('export const command: C.RafaCommand = { ...base, outputs: [], exec: false, run: async () => {} };'),
    code: 2322,
    names: 'false',
  },
  {
    title: 'a command with no summary',
    file: 'no-summary.ts',
    source: probeSource(
      'const { summary, ...rest } = base;',
      'export const dropped = summary;',
      'export const command: C.RafaCommand = { ...rest, outputs: [], run: async () => {} };',
    ),
    code: 2741,
    names: '\'summary\'',
  },
  {
    title: 'argv written to',
    file: 'argv-push.ts',
    source: probeSource('export function push(context: C.RafaContext): void { context.argv.push("x"); }'),
    code: 2339,
    names: '\'push\' does not exist',
  },
  {
    title: 'a run needing more than a RafaContext',
    file: 'run-narrower.ts',
    source: probeSource(
      'export const command: C.RafaCommand = {',
      '  ...base, outputs: [], run: async (context: C.RafaContext & { repoRoot: string }) => { void context.repoRoot; },',
      '};',
    ),
    code: 2322,
    names: 'repoRoot',
  },
];

/** One diagnostic of one probe. */
interface Reading {
  code: number;
  message: string;
}

let tempDir = '';
let program: ts.Program | null = null;

/** Every diagnostic the compile holds against one probe. */
function readingsOf(file: string): Reading[] {
  if (program === null) throw new Error('the probes were never compiled');
  const source = program.getSourceFile(join(tempDir, file));
  if (source === undefined) throw new Error(`the probe ${file} is not in the compile`);
  return ts.getPreEmitDiagnostics(program, source).map((diagnostic) => ({
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }));
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-cli-command-'));
  const probes: [string, string][] = [
    ['command.ts', CONFORMING_PROBE],
    ...REFUSALS.map((refusal): [string, string] => [refusal.file, refusal.source]),
  ];
  for (const [file, source] of probes) writeFileSync(join(tempDir, file), source);

  const configPath = join(REPO_ROOT, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, REPO_ROOT, undefined, configPath);
  program = ts.createProgram({ rootNames: probes.map(([file]) => join(tempDir, file)), options: parsed.options });
}, 30_000);

afterAll(() => {
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('the command types, compiled', () => {
  it('compiles the probe holding every claim with no diagnostic', () => {
    expect(readingsOf('command.ts')).toEqual([]);
  });

  for (const refusal of REFUSALS) {
    it(`refuses ${refusal.title} with one diagnostic naming it`, () => {
      const readings = readingsOf(refusal.file);

      expect(readings.map((reading) => reading.code)).toEqual([refusal.code]);
      expect(readings[0]?.message).toContain(refusal.names);
    });
  }
});
