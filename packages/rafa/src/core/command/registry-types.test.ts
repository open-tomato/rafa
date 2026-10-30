/**
 * Type tests for `CommandFeature` (`packages/rafa/src/core/command/registry-types.ts`).
 *
 * `registry-types.ts` exports types alone, so every claim is compiled as
 * a probe through the TypeScript compiler API under the root tsconfig's
 * options, as `types.test.ts` beside this file does and for its reason:
 * `bun:test`'s `expectTypeOf` checks nothing when the suite runs. The
 * probes are written to a temporary directory outside the repository and
 * import the modules by absolute path, so no gate ever reads one.
 *
 * The clean probe holds that a feature's three fields are exactly
 * `string`, `readonly SubjectSpec[]` and `readonly RafaCommand[]`; that
 * a feature is a `CommandRegistryInput`, so one feature's lists build a
 * registry as they stand; and that the command barrel and
 * `packages/rafa/src/cli/registry.ts` both export it as the same type as
 * `registry-types.ts` declares. It must compile with no diagnostic.
 *
 * Every refusal probe changes one thing and is held to exactly one
 * diagnostic, its code and a message naming the change, so a probe
 * failing for another reason does not pass as the refusal. The clean
 * probe keeps the refusals from passing vacuously, and each refusal is
 * the control that the compile can fail.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import ts from 'typescript';

/** The command folder, `packages/rafa/src/core/command/`, the probes import from. */
const COMMAND_DIR = fileURLToPath(new URL('./', import.meta.url));

/** The repository root, whose tsconfig the probes compile under. */
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

/**
 * A module a probe imports, as a quoted absolute specifier.
 *
 * @param path - The module's absolute path.
 * @returns The path, quoted.
 */
function specifierOf(path: string): string {
  return JSON.stringify(path);
}

/**
 * A probe's source: the contract imported as `R`, then the lines given.
 *
 * @param lines - The probe's own lines.
 * @returns The source.
 */
function probeSource(...lines: string[]): string {
  return [
    `import type * as R from ${specifierOf(join(COMMAND_DIR, 'registry-types.js'))};`,
    ...lines,
    '',
  ].join('\n');
}

/** `Equals` holds when two types are the same type. */
const EQUALS = [
  'type Equals<A, B> = (<X>() => X extends A ? 1 : 2) extends (<X>() => X extends B ? 1 : 2)',
  '  ? true',
  '  : false;',
];

/** The probe holding every claim, which must compile clean. */
const CONFORMING_PROBE = probeSource(
  `import type * as C from ${specifierOf(join(COMMAND_DIR, 'command.js'))};`,
  `import type * as B from ${specifierOf(join(COMMAND_DIR, 'index.js'))};`,
  `import type * as L from ${specifierOf(join(REPO_ROOT, 'packages', 'rafa', 'src', 'cli', 'registry.js'))};`,
  ...EQUALS,
  'export const nameIsExact: Equals<R.CommandFeature["name"], string> = true;',
  'export const subjectsAreExact: Equals<R.CommandFeature["subjects"], readonly R.SubjectSpec[]> = true;',
  'export const commandsAreExact: Equals<R.CommandFeature["commands"], readonly C.RafaCommand[]> = true;',
  'export const keysAreExact: Equals<keyof R.CommandFeature, "name" | "subjects" | "commands"> = true;',
  'export const barrelIsSame: Equals<B.CommandFeature, R.CommandFeature> = true;',
  'export const cliIsSame: Equals<L.CommandFeature, R.CommandFeature> = true;',
  'declare const command: C.RafaCommand;',
  'export const feature: R.CommandFeature = {',
  '  name: "plan",',
  '  subjects: [{ name: "plan", summary: "Plans." }],',
  '  commands: [command],',
  '};',
  'export const input: R.CommandRegistryInput = feature;',
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
    title: 'a feature with no name',
    file: 'no-name.ts',
    source: probeSource('export const feature: R.CommandFeature = { subjects: [], commands: [] };'),
    code: 2741,
    names: '\'name\'',
  },
  {
    title: 'a feature with no commands',
    file: 'no-commands.ts',
    source: probeSource('export const feature: R.CommandFeature = { name: "plan", subjects: [] };'),
    code: 2741,
    names: '\'commands\'',
  },
  {
    title: 'subjects spelled as bare words',
    file: 'subjects-words.ts',
    source: probeSource('export const feature: R.CommandFeature = { name: "plan", subjects: ["plan"], commands: [] };'),
    code: 2322,
    names: 'Type \'string\' is not assignable to type \'SubjectSpec\'',
  },
  {
    title: 'a feature named by a number',
    file: 'name-number.ts',
    source: probeSource('export const feature: R.CommandFeature = { name: 7, subjects: [], commands: [] };'),
    code: 2322,
    names: 'Type \'number\' is not assignable to type \'string\'',
  },
  {
    title: 'a feature\'s subjects pushed to',
    file: 'subjects-push.ts',
    source: probeSource(
      'declare const feature: R.CommandFeature;',
      'feature.subjects.push({ name: "plan", summary: "Plans." });',
    ),
    code: 2339,
    names: '\'push\' does not exist',
  },
];

/** One diagnostic of one probe. */
interface Reading {
  code: number;
  message: string;
}

/** The compile every case reads, its readings taken when it was built. */
interface Compiled {
  configErrors: readonly ts.Diagnostic[];
  /** Every probe's diagnostics, by the probe's file name. */
  readings: Readonly<Record<string, readonly Reading[]>>;
}

let tempDir = '';
let compiled: Compiled | null = null;

/**
 * The compile, once `beforeAll` has made it.
 *
 * @returns The compile.
 * @throws When `beforeAll` never ran.
 */
function compiledProbes(): Compiled {
  if (compiled === null) throw new Error('the probes were never compiled');
  return compiled;
}

/**
 * Every diagnostic the compile holds against one probe, read off the
 * checker. Called by `beforeAll` alone, so the checker binds and checks
 * there and not inside the first case.
 *
 * @param program - The compile holding the probe.
 * @param file - The probe's file name.
 * @returns Its diagnostics.
 * @throws When the probe is not in the compile.
 */
function diagnosticsOf(program: ts.Program, file: string): Reading[] {
  const source = program.getSourceFile(join(tempDir, file));
  if (source === undefined) throw new Error(`the probe ${file} is not in the compile`);
  return ts.getPreEmitDiagnostics(program, source).map((diagnostic) => ({
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }));
}

/**
 * Every diagnostic the compile holds against one probe, as stored.
 *
 * @param file - The probe's file name.
 * @returns Its diagnostics.
 * @throws When the probe is not in the compile.
 */
function readingsOf(file: string): readonly Reading[] {
  const readings = compiledProbes().readings[file];
  if (readings === undefined) throw new Error(`the probe ${file} is not in the compile`);
  return readings;
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rafa-registry-types-'));

  const probes: [string, string][] = [
    ['feature.ts', CONFORMING_PROBE],
    ...REFUSALS.map((refusal): [string, string] => [refusal.file, refusal.source]),
  ];
  for (const [file, source] of probes) writeFileSync(join(tempDir, file), source);

  const configPath = join(REPO_ROOT, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, REPO_ROOT, undefined, configPath);

  const program = ts.createProgram({
    rootNames: probes.map(([file]) => join(tempDir, file)),
    options: parsed.options,
  });

  compiled = {
    configErrors: [...config.error === undefined
      ? []
      : [config.error], ...parsed.errors],
    readings: Object.fromEntries(probes.map(([file]) => [file, diagnosticsOf(program, file)])),
  };
}, 30_000);

afterAll(() => {
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

describe('CommandFeature, compiled', () => {
  it('reads the root tsconfig with no error', () => {
    expect(compiledProbes().configErrors.map((error) => error.code)).toEqual([]);
  });

  it('compiles the probe holding every claim with no diagnostic', () => {
    expect(readingsOf('feature.ts')).toEqual([]);
  });

  for (const refusal of REFUSALS) {
    it(`refuses ${refusal.title} with one diagnostic naming it`, () => {
      const readings = readingsOf(refusal.file);

      expect(readings.map((reading) => reading.code)).toEqual([refusal.code]);
      expect(readings[0]?.message).toContain(refusal.names);
    });
  }
});
