/**
 * Holds `config-section.d.ts` to its claim through the TypeScript
 * checker: loaded in a program beside a probe importing `ConfigEntry`
 * from `src/config/index.ts` by its path, as this repository's
 * `rafa.config.ts` imports `Config`, it widens `ConfigShape` with
 * `atlas` typed from `layers.ts`, so an entry setting `atlas.layers` is
 * taken and one writing a wrong value there is refused.
 *
 * The control proves the acceptance could have failed: the same entry
 * is refused, naming `atlas`, in a program without the declaration, so
 * the declaration is what admits it.
 *
 * Every program is built over one probe file kept in memory beside the
 * declaration, with the `paths` of `tsconfig.packages.json` that
 * `src/config/` resolves core's section files through, and read by its
 * own diagnostics; `skipLibCheck` is off, so the declaration file is
 * checked too.
 */
import { resolve } from 'node:path';

import { describe, expect, test } from 'bun:test';
import ts from 'typescript';

/** The checkout root, four folders above this file's. */
const ROOT = resolve(import.meta.dir, '../../../..');

/** The declaration under test. */
const DECLARATION = resolve(import.meta.dir, 'config-section.d.ts');

/** The probe module, in memory beside the declaration. */
const PROBE = resolve(import.meta.dir, '__config-section-probe.ts');

/** The config entry by its path from the probe, as the repository's `rafa.config.ts` imports it. */
const CONFIG_BY_PATH = '../../../../src/config/index.js';

/** An entry setting two layers, as `rafa.config.ts` would. */
const TWO_LAYERS = '{ atlas: { layers: [{ name: \'core\', modules: [\'@open-tomato/rafa-core\'] }, { name: \'app\', modules: [\'src/commands\'] }] } }';

/** The timeout of a case building a program over core's config graph. */
const PROGRAM_TIMEOUT_MS = 60_000;

/** The compiler options of the packages' shared tsconfig, its `paths` resolved from the root. */
function packageOptions(): ts.CompilerOptions {
  const file = resolve(ROOT, 'tsconfig.packages.json');
  const read = ts.readConfigFile(file, (path) => ts.sys.readFile(path));
  return ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT, undefined, file).options;
}

/** A program over a probe holding `probe`, with the declaration when `declaration` is true. */
function programOf(probe: string, declaration: boolean): ts.Program {
  const options: ts.CompilerOptions = {
    ...packageOptions(),
    noEmit: true,
    skipLibCheck: false,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (path) => path === PROBE || fileExists.call(host, path);
  host.readFile = (path) => (path === PROBE
    ? probe
    : readFile.call(host, path));
  host.getSourceFile = (path, language, ...rest) => (path === PROBE
    ? ts.createSourceFile(path, probe, language)
    : getSourceFile.call(host, path, language, ...rest));
  const roots = declaration
    ? [DECLARATION, PROBE]
    : [PROBE];
  return ts.createProgram(roots, options, host);
}

/** The messages of `path`'s syntactic and semantic diagnostics in `program`. */
function messagesOf(program: ts.Program, path: string): string[] {
  const file = program.getSourceFile(path);
  if (file === undefined) throw new Error(`${path} is not in its program`);
  return [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)]
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

/** A probe declaring `value` as one `ConfigEntry`. */
function entryProbe(value: string): string {
  return `import type { ConfigEntry } from '${CONFIG_BY_PATH}';\n\nexport const entry: ConfigEntry = ${value};\n`;
}

describe('config-section.d.ts beside src/config/index.ts', () => {
  test('the declaration itself type-checks', () => {
    const program = programOf(entryProbe(TWO_LAYERS), true);

    expect(messagesOf(program, DECLARATION)).toEqual([]);
  }, PROGRAM_TIMEOUT_MS);

  test('a ConfigEntry setting atlas.layers is taken', () => {
    const program = programOf(entryProbe(TWO_LAYERS), true);

    expect(messagesOf(program, PROBE)).toEqual([]);
  }, PROGRAM_TIMEOUT_MS);

  test('a wrong value at atlas.layers is refused', () => {
    const program = programOf(entryProbe('{ atlas: { layers: 3 } }'), true);

    const messages = messagesOf(program, PROBE);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('number');
  }, PROGRAM_TIMEOUT_MS);

  test('ConfigShape[\'atlas\'] is the AtlasSection layers.ts exports', () => {
    const probe = [
      `import type { ConfigShape } from '${CONFIG_BY_PATH}';`,
      'import type { AtlasSection } from \'./layers.js\';',
      '',
      'export const same: [ConfigShape[\'atlas\']] extends [AtlasSection] ? ([AtlasSection] extends [ConfigShape[\'atlas\']] ? true : false) : false = true;',
      '',
    ].join('\n');
    const program = programOf(probe, true);

    expect(messagesOf(program, PROBE)).toEqual([]);
  }, PROGRAM_TIMEOUT_MS);

  test('control: without the declaration the same entry is refused, naming atlas', () => {
    const program = programOf(entryProbe(TWO_LAYERS), false);

    const messages = messagesOf(program, PROBE);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('\'atlas\'');
  }, PROGRAM_TIMEOUT_MS);
});
