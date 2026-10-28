/**
 * Tests for the `load.ts` barrel: it exports every name `config-load.ts`
 * exports, each once, as the same binding, no other name, and no name
 * either of the other two config barrels holds.
 *
 * The barrel spells its names, so a name added to `config-load.ts` and
 * not to the barrel is a name no file outside `packages/rafa/src/core/` can import.
 * Nothing here is spelled a second time: both sides are read off the
 * modules, the runtime names off their namespaces and the type names
 * with the TypeScript checker, as `sections.test.ts` reads its barrel.
 *
 * Four names are held by name, so a reading that came back empty, or one
 * that saw runtime names alone, fails rather than agreeing with itself:
 * `loadConfig`, the one function every command imports,
 * `readProjectScope`, which reads the project's two files alone, and
 * `ConfigRoots` and `ProjectScopeFiles`, the two types `config-load.ts`
 * exports.
 *
 * The last case holds the three barrels apart. `InjectMode` on
 * `sections.ts` and `ConfigError` on `index.ts` are its controls: a
 * reading of either barrel that came back empty would find no name in
 * common and pass.
 */
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as load from './config-load.js';
import * as barrel from './load.js';

const ROOT = resolve(import.meta.dir, '../../../../..');

const BARREL = 'packages/rafa/src/core/config/load.ts';
const CONFIG_BARREL = 'packages/rafa/src/core/config/index.ts';
const SECTIONS_BARREL = 'packages/rafa/src/core/config/sections.ts';
const LOAD = 'packages/rafa/src/core/config/config-load.ts';

/** Every path a case reads the export names of, in the order the cases first name them. */
const EXPORT_PATHS: readonly string[] = [BARREL, LOAD, CONFIG_BARREL, SECTIONS_BARREL];

/**
 * Every export name of each file, types included, sorted. Runs once,
 * from the `beforeAll`, over {@link EXPORT_PATHS}, so no case pays for
 * the compile inside its own timeout.
 *
 * @param paths - Repository-relative paths of the modules to read.
 * @returns The names by path.
 * @throws When `tsconfig.json` does not parse or a path is no module.
 */
function readExportNames(paths: readonly string[]): Record<string, string[]> {
  const files = paths.map((path) => resolve(ROOT, path));
  const parsed = ts.getParsedCommandLineOfConfigFile(
    resolve(ROOT, 'tsconfig.json'),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  if (parsed === undefined) throw new Error('tsconfig.json did not parse');
  const program = ts.createProgram(files, parsed.options);
  const checker = program.getTypeChecker();
  const names: Record<string, string[]> = {};
  for (const [index, file] of files.entries()) {
    const sourceFile = program.getSourceFile(file);
    if (sourceFile === undefined) throw new Error(`not in program: ${file}`);
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (moduleSymbol === undefined) throw new Error(`not a module: ${file}`);
    names[paths[index] ?? file] = checker
      .getExportsOfModule(moduleSymbol)
      .map((symbol) => symbol.name)
      .sort();
  }
  return names;
}

let exportNames: Record<string, string[]> | null = null;

/**
 * The export names by path, once `beforeAll` has read them.
 *
 * @returns The names by path of every file in {@link EXPORT_PATHS}.
 * @throws When the `beforeAll` never ran.
 */
function storedExportNames(): Record<string, string[]> {
  if (exportNames === null) throw new Error('the export names were never read');
  return exportNames;
}

describe('the load barrel', () => {
  beforeAll(() => {
    exportNames = readExportNames(EXPORT_PATHS);
  }, 30_000);

  it('exports the runtime names of config-load.ts, each once, and no other', () => {
    const expected = Object.keys(load).sort();

    expect(expected).toContain('loadConfig');
    expect(expected).toContain('readProjectScope');
    expect(Object.keys(barrel).sort()).toEqual(expected);
  });

  it('exports each runtime name as the binding config-load.ts declares', () => {
    const exported: Readonly<Record<string, unknown>> = barrel;

    for (const [name, value] of Object.entries(load)) {
      expect([name, exported[name] === value]).toEqual([name, true]);
    }
  });

  it('exports the type names of config-load.ts with the runtime ones, each once, and no other', () => {
    const names = storedExportNames();

    expect(names[LOAD]).toContain('ConfigRoots');
    expect(names[LOAD]).toContain('ProjectScopeFiles');
    expect(names[LOAD]).toContain('loadConfig');
    expect(Object.keys(load)).not.toContain('ConfigRoots');
    expect(Object.keys(load)).not.toContain('ProjectScopeFiles');
    expect(names[BARREL]).toEqual(names[LOAD] ?? []);
  });

  it('holds no name either of the other two config barrels holds, type or runtime', () => {
    const names = storedExportNames();
    const others = [...(names[CONFIG_BARREL] ?? []), ...(names[SECTIONS_BARREL] ?? [])];
    const onTwo = (names[BARREL] ?? []).filter((name) => others.includes(name));

    expect(names[BARREL]?.length).toBeGreaterThan(0);
    expect(names[CONFIG_BARREL]).toContain('ConfigError');
    expect(names[SECTIONS_BARREL]).toContain('InjectMode');
    expect(onTwo).toEqual([]);
  });
});
