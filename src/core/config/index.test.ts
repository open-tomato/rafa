/**
 * Tests for the `index.ts` barrel: it exports every name
 * `config-items.ts`, `config-schema.ts` and `config.ts` export and the
 * `sections.ts` barrel does not, each once, as the same binding, and no
 * other name.
 *
 * The barrel spells its names, so a name added to one of the three files
 * and not to the barrel is a name no file outside `src/core/` can import.
 * Nothing here is spelled a second time: both sides are read off the
 * modules, the runtime names off their namespaces and the type names
 * with the TypeScript checker, as `sections.test.ts` reads its barrel.
 *
 * `config.ts` re-exports names of the other two files and of
 * `config-sections.ts`, so the expected list is the union of the three
 * files' names, each counted once, less the names of `sections.ts`. The
 * last case holds the two barrels apart on its own: no name is on both.
 *
 * Five names are held by name, so a reading that came back empty, or one
 * that saw runtime names alone, fails rather than agreeing with itself:
 * `SettingSpec`, a type of `config-schema.ts` that `config.ts` does not
 * re-export; `ConfigLayers`, a type of `config.ts`; `HubContext`, the
 * type `config.ts` re-exports from `src/config-schema-hub.ts` and none
 * of the three declares; `moduleSource`, a reader of `config-items.ts`
 * that `config.ts` does not re-export; and `InjectMode`, a type
 * `config.ts` re-exports from `config-sections.ts`, which is the control
 * that the subtraction removes something.
 */
import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as items from './config-items.js';
import * as schema from './config-schema.js';
import * as config from './config.js';
import * as sectionsBarrel from './sections.js';

import * as barrel from './index.js';

const ROOT = resolve(import.meta.dir, '../../..');

const BARREL = 'src/core/config/index.ts';
const SECTIONS_BARREL = 'src/core/config/sections.ts';
const ITEMS = 'src/core/config/config-items.ts';
const SCHEMA = 'src/core/config/config-schema.ts';
const CONFIG = 'src/core/config/config.ts';

/**
 * Every export name of each file, types included, sorted.
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

/**
 * The names of several lists, each once, less the names of one list,
 * sorted.
 *
 * @param lists - The lists to join.
 * @param less - The names to leave out.
 * @returns The joined names.
 */
function unionLess(lists: readonly (readonly string[])[], less: readonly string[]): string[] {
  return [...new Set(lists.flat())]
    .filter((name) => !less.includes(name))
    .sort();
}

/** The runtime bindings of the three files, a name two of them export counted once. */
const BEHIND: Readonly<Record<string, unknown>> = { ...items, ...schema, ...config };

describe('the config barrel', () => {
  it('exports the runtime names of the three files the sections barrel does not hold, each once, and no other', () => {
    const expected = unionLess(
      [Object.keys(items), Object.keys(schema), Object.keys(config)],
      Object.keys(sectionsBarrel),
    );

    expect(Object.keys(items).length).toBeGreaterThan(0);
    expect(Object.keys(schema).length).toBeGreaterThan(0);
    expect(Object.keys(config).length).toBeGreaterThan(0);
    expect(expected).toContain('moduleSource');
    expect(Object.keys(config)).toContain('INJECT_MODES');
    expect(expected).not.toContain('INJECT_MODES');
    expect(Object.keys(barrel).sort()).toEqual(expected);
  });

  it('exports each runtime name as the binding its file declares', () => {
    const exported: Readonly<Record<string, unknown>> = barrel;

    for (const name of Object.keys(barrel)) {
      expect([name, exported[name] === BEHIND[name]]).toEqual([name, true]);
    }
    // A name two of the three export is one binding, so the spread above lost none.
    for (const [name, value] of [...Object.entries(items), ...Object.entries(schema)]) {
      expect([name, BEHIND[name] === value]).toEqual([name, true]);
    }
  });

  it('exports the type names of the three files with the runtime ones, each once, and no other', () => {
    const names = readExportNames([BARREL, SECTIONS_BARREL, ITEMS, SCHEMA, CONFIG]);
    const expected = unionLess(
      [names[ITEMS] ?? [], names[SCHEMA] ?? [], names[CONFIG] ?? []],
      names[SECTIONS_BARREL] ?? [],
    );

    expect(names[SCHEMA]).toContain('SettingSpec');
    expect(names[CONFIG]).not.toContain('SettingSpec');
    expect(names[CONFIG]).toContain('ConfigLayers');
    expect(names[CONFIG]).toContain('HubContext');
    expect(names[CONFIG]).toContain('InjectMode');
    expect(Object.keys(config)).not.toContain('ConfigLayers');
    expect(expected).not.toContain('InjectMode');
    expect(names[BARREL]).toEqual(expected);
  });

  it('holds no name the sections barrel holds, type or runtime', () => {
    const names = readExportNames([BARREL, SECTIONS_BARREL]);
    const onBoth = (names[BARREL] ?? []).filter((name) => (names[SECTIONS_BARREL] ?? []).includes(name));

    expect(names[BARREL]?.length).toBeGreaterThan(0);
    expect(names[SECTIONS_BARREL]).toContain('InjectMode');
    expect(onBoth).toEqual([]);
  });
});
