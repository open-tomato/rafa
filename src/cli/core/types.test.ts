/**
 * Tests for the command contracts (`src/cli/core/types.ts`).
 *
 * The source's suite, open-tomato's
 * `packages/shared/cli-core/src/types.test.ts` at commit
 * `31fec3c1afaf093b77c499a97047cd73a56159e7` (2026-06-25), holds its
 * claims with vitest's `expectTypeOf`. `bun:test` exports one too, and
 * it checks nothing when the suite runs: measured on bun 1.3.14, a file
 * calling `expectTypeOf<string>().toEqualTypeOf<number>()` passed, while
 * its control, `expect(1).toBe(2)`, failed. `check-types` never reads a
 * test file either, so a port calling it would pass whatever the types
 * said. Each claim is compiled as a probe through the TypeScript compiler
 * API instead, under the options the root tsconfig gives `check-types`,
 * as `src/ports/index.test.ts` does. The probes are written to a
 * temporary directory outside the repository and import the modules by
 * absolute path, so no gate ever reads one.
 *
 * The clean probe holds the source's five claims. `outputMode` is exactly
 * `'text' | 'json'`, each of the two is assignable to it, and it is not
 * `string`. A `log` event narrows to the log shape, and each other kind
 * to its own field. `CliEvent['type']` is the union of the four kinds.
 * The events are rafa's, from `src/ports/index.ts`, which the source's
 * `events.ts` was copied into. The probe also holds what the copy
 * changes: `output` is exactly the `Output` port, and a `CliCommand` is a
 * `ParseArgsSpec`. It must compile with no diagnostic.
 *
 * Every refusal probe changes one thing and is held to exactly one
 * diagnostic, its code and a message naming the change, so a probe
 * failing for some other reason does not pass as the refusal. The clean
 * probe keeps the refusals from passing vacuously, and each refusal is
 * the control that the compile can fail.
 *
 * Measured on 2026-09-14. Before `parseArgs.ts` exported `ParseArgsSpec`,
 * the clean probe drew exactly one diagnostic, TS2724 naming it, and every
 * refusal passed. Five mutations of `types.ts` were then driven against
 * `src/cli/core/`, one run each, with 125 pass before and after and the
 * module restored byte-identical (sha256), and every one reddened at least
 * one case. `outputMode` widened to `string` reddened the clean probe and
 * both mode refusals, and `output` made `Output | undefined` the clean
 * probe. `run` allowed to answer synchronously, a flag's `aliases` allowed
 * a string, and an argument's `default` allowed `null` each reddened their
 * own refusal alone.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import ts from 'typescript';

/** The `src/` directory the probes import from. */
const SRC_DIR = fileURLToPath(new URL('../../', import.meta.url));

/** The repository root, whose tsconfig the probes compile under. */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** A module a probe imports, as a quoted absolute specifier. */
function specifierOf(...segments: string[]): string {
  return JSON.stringify(join(SRC_DIR, ...segments));
}

/** A probe's source: the contracts imported as `T`, then the lines given. */
function probeSource(...lines: string[]): string {
  return [
    `import type * as T from ${specifierOf('cli', 'core', 'types.js')};`,
    ...lines,
    '',
  ].join('\n');
}

/** The ports entry imported as `P`, for a probe reading an event or the port. */
const PORTS_IMPORT = `import type * as P from ${specifierOf('ports', 'index.js')};`;

/**
 * `Equals` holds when two types are the same type, and `exactly` reads
 * the type of a value, narrowing included, as `expectTypeOf(value)` does.
 */
const EQUALS = [
  'type Equals<A, B> = (<X>() => X extends A ? 1 : 2) extends (<X>() => X extends B ? 1 : 2)',
  '  ? true',
  '  : false;',
  'declare function exactly<Expected>(): <Actual>(actual: Actual) => Equals<Actual, Expected>;',
];

/** The probe holding every claim, which must compile clean. */
const CONFORMING_PROBE = probeSource(
  PORTS_IMPORT,
  `import type { ParseArgsSpec } from ${specifierOf('cli', 'core', 'parseArgs.js')};`,
  ...EQUALS,
  'export const modeIsExact: Equals<T.CliContext["outputMode"], "text" | "json"> = true;',
  'export const modeIsNotString: Equals<T.CliContext["outputMode"], string> = false;',
  'export const text: T.CliContext["outputMode"] = "text";',
  'export const json: T.CliContext["outputMode"] = "json";',
  'export const kinds: Equals<P.CliEvent["type"], "start" | "step" | "log" | "result"> = true;',
  'export function narrowed(event: P.CliEvent): true {',
  '  if (event.type === "log") {',
  '    const log: true = exactly<{',
  '      type: "log";',
  '      level: "debug" | "info" | "warn" | "error";',
  '      message: string;',
  '      ts: string;',
  '    }>()(event);',
  '    const level: true = exactly<"debug" | "info" | "warn" | "error">()(event.level);',
  '    const message: true = exactly<string>()(event.message);',
  '    return log && level && message;',
  '  }',
  '  if (event.type === "start") {',
  '    const command: true = exactly<string>()(event.command);',
  '    return command;',
  '  }',
  '  if (event.type === "step") {',
  '    const name: true = exactly<string>()(event.name);',
  '    return name;',
  '  }',
  '  const ok: true = exactly<boolean>()(event.ok);',
  '  return ok;',
  '}',
  'export function outputOf(context: T.CliContext): true {',
  '  return exactly<P.Output>()(context.output);',
  '}',
  'export const command: T.CliCommand = {',
  '  name: "show",',
  '  description: "Shows a plan.",',
  '  args: [{ name: "stub", description: "The plan stub.", type: "string", default: "current" }],',
  '  flags: [{ name: "tracker", description: "Reads the tracker.", type: "boolean", aliases: ["t"], default: false }],',
  '  run: async (context) => {',
  '    context.output.info(context.args[0] ?? String(context.flags.tracker));',
  '  },',
  '};',
  'export const spec: ParseArgsSpec = command;',
);

/** One probe changing one thing, and the one diagnostic it must draw. */
interface Refusal {
  /** What the probe changed, as the case title reads it. */
  title: string;
  /** The probe's file name, unique among the probes. */
  file: string;
  source: string;
  /** The diagnostic's code. */
  code: number;
  /** Text the diagnostic's message must hold, naming the change. */
  names: string;
}

const REFUSALS: readonly Refusal[] = [
  {
    title: 'an output mode outside text and json',
    file: 'mode-yaml.ts',
    source: probeSource('export const mode: T.CliContext["outputMode"] = "yaml";'),
    code: 2322,
    names: 'Type \'"yaml"\' is not assignable',
  },
  {
    title: 'a plain string as the output mode',
    file: 'mode-string.ts',
    source: probeSource(
      'declare const typed: string;',
      'export const mode: T.CliContext["outputMode"] = typed;',
    ),
    code: 2322,
    names: 'Type \'string\' is not assignable',
  },
  {
    title: 'a field of another kind read off a narrowed log event',
    file: 'log-command.ts',
    source: probeSource(
      PORTS_IMPORT,
      'export function commandOf(event: P.CliEvent, context: T.CliContext): string {',
      '  return event.type === "log"',
      '    ? event.command',
      '    : context.outputMode;',
      '}',
    ),
    code: 2339,
    names: '\'command\' does not exist on type \'CliEventLog\'',
  },
  {
    title: 'an output with no emit',
    file: 'output-no-emit.ts',
    source: probeSource(
      'export const output: T.CliContext["output"] = {',
      '  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, result: () => {},',
      '};',
    ),
    code: 2741,
    names: '\'emit\'',
  },
  {
    title: 'a command whose run answers no promise',
    file: 'run-sync.ts',
    source: probeSource(
      'export const command: T.CliCommand = {',
      '  name: "show", description: "Shows a plan.", args: [], flags: [],',
      '  run: () => undefined,',
      '};',
    ),
    code: 2322,
    names: 'Promise<void>',
  },
  {
    title: 'flag aliases spelled as one string',
    file: 'aliases-string.ts',
    source: probeSource(
      'export const flag: T.FlagSpec = { name: "plan", description: "The plan.", type: "string", aliases: "p" };',
    ),
    code: 2322,
    names: 'readonly string[]',
  },
  {
    title: 'an argument default no word can hold',
    file: 'default-null.ts',
    source: probeSource(
      'export const arg: T.ArgSpec = { name: "stub", description: "The stub.", type: "string", default: null };',
    ),
    code: 2322,
    names: 'Type \'null\' is not assignable',
  },
];

/** One diagnostic of one probe. */
interface Reading {
  code: number;
  message: string;
}

/** The compile every case reads. */
interface Compiled {
  program: ts.Program;
  configErrors: readonly ts.Diagnostic[];
}

let tempDir = '';
let compiled: Compiled | null = null;

/** The compile, once `beforeAll` has made it. */
function compiledProbes(): Compiled {
  if (compiled === null) throw new Error('the probes were never compiled');
  return compiled;
}

/** Every diagnostic the compile holds against one probe. */
function readingsOf(file: string): Reading[] {
  const { program } = compiledProbes();
  const source = program.getSourceFile(join(tempDir, file));
  if (source === undefined) throw new Error(`the probe ${file} is not in the compile`);
  return ts.getPreEmitDiagnostics(program, source).map((diagnostic) => ({
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }));
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-cli-types-'));

  const probes: [string, string][] = [
    ['contracts.ts', CONFORMING_PROBE],
    ...REFUSALS.map((refusal): [string, string] => [refusal.file, refusal.source]),
  ];
  for (const [file, source] of probes) writeFileSync(join(tempDir, file), source);

  const configPath = join(REPO_ROOT, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, REPO_ROOT, undefined, configPath);

  compiled = {
    program: ts.createProgram({
      rootNames: probes.map(([file]) => join(tempDir, file)),
      options: parsed.options,
    }),
    configErrors: [...config.error === undefined
      ? []
      : [config.error], ...parsed.errors],
  };
}, 30_000);

afterAll(() => {
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('the command contracts, compiled', () => {
  it('reads the root tsconfig with no error', () => {
    expect(compiledProbes().configErrors.map((error) => error.code)).toEqual([]);
  });

  it('compiles the probe holding every claim with no diagnostic', () => {
    expect(readingsOf('contracts.ts')).toEqual([]);
  });

  for (const refusal of REFUSALS) {
    it(`refuses ${refusal.title} with one diagnostic naming it`, () => {
      const readings = readingsOf(refusal.file);

      expect(readings.map((reading) => reading.code)).toEqual([refusal.code]);
      expect(readings[0]?.message).toContain(refusal.names);
    });
  }
});
