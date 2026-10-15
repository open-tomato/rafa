/**
 * Tests for the `index.ts` barrel: it exports every name
 * `config-items.ts`, `config-schema.ts`, `core-section.ts`, `section.ts`,
 * `config.ts`, `dangerous.ts`, `scope.ts` and `default-routing.ts` export and the `sections.ts`
 * barrel does not, each
 * once, as the same binding, and no other name.
 *
 * The barrel spells its names, so a name added to one of the eight files
 * and not to the barrel is a name no file outside `packages/rafa/src/core/` can import.
 * Nothing here is spelled a second time: both sides are read off the
 * modules, the runtime names off their namespaces and the type names
 * with the TypeScript checker, as `sections.test.ts` reads its barrel.
 *
 * `config.ts` re-exports names of the other files and of
 * `config-sections.ts`, so the expected list is the union of the eight
 * files' names, each counted once, less the names of `sections.ts`. The
 * last case holds the two barrels apart on its own: no name is on both.
 *
 * `config-schema.ts` declares types alone, which the first case holds:
 * its namespace carries no runtime name. No file behind the barrel
 * exports a merged schema: `SETTINGS`, `CONFIG_DEFAULTS` and the key
 * indexes are `src/config-registry.ts`'s, outside `packages/rafa/src/core/`, and the
 * first case holds that none of them is here.
 *
 * Eleven names are held by name, so a reading that came back empty, or one
 * that saw runtime names alone, fails rather than agreeing with itself:
 * `SettingSpec`, a type of `config-schema.ts` that `config.ts` does not
 * re-export; `ConfigLayers`, a type of `config.ts`;
 * `activeSettingByKey`, a key index `section.ts` answers, which
 * `config.ts` does not re-export; `moduleSource`, a reader of
 * `config-items.ts` that `config.ts` does not re-export; `CORE_SECTION`,
 * a value of `core-section.ts` that `config.ts` does not re-export;
 * `registerConfigSections` and `ConfigSection`, a value and a type of
 * `section.ts`, which `config.ts` does not re-export; and
 * `InjectMode`, a type `config.ts` re-exports from `config-sections.ts`,
 * which is the control that the subtraction removes something; and
 * `runWithDangerousPhrases`, the one name of `dangerous.ts` a file
 * outside `packages/rafa/src/core/` imports, the dispatcher; and `scopeAt` and
 * `ProjectFound`, a value and a type of `scope.ts`.
 * `HubContext` is held absent from `config.ts`: the hub's types are
 * `src/config-schema-hub.ts`'s, which no file under `packages/rafa/src/core/` imports.
 */
import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as items from './config-items.js';
import * as schema from './config-schema.js';
import * as config from './config.js';
import * as coreSection from './core-section.js';
import * as dangerous from './dangerous.js';
import * as defaultRouting from './default-routing.js';
import * as scope from './scope.js';
import * as section from './section.js';
import * as sectionsBarrel from './sections.js';

import * as barrel from './index.js';

const ROOT = resolve(import.meta.dir, '../../../../..');

const BARREL = 'packages/rafa/src/core/config/index.ts';
const SECTIONS_BARREL = 'packages/rafa/src/core/config/sections.ts';
const ITEMS = 'packages/rafa/src/core/config/config-items.ts';
const SCHEMA = 'packages/rafa/src/core/config/config-schema.ts';
const CORE = 'packages/rafa/src/core/config/core-section.ts';
const SECTION = 'packages/rafa/src/core/config/section.ts';
const CONFIG = 'packages/rafa/src/core/config/config.ts';
const DANGEROUS = 'packages/rafa/src/core/config/dangerous.ts';
const SCOPE = 'packages/rafa/src/core/config/scope.ts';
const ROUTING = 'packages/rafa/src/core/config/default-routing.ts';

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

/** The runtime bindings of the eight files, a name two of them export counted once. */
const BEHIND: Readonly<Record<string, unknown>> = {
  ...items,
  ...schema,
  ...coreSection,
  ...section,
  ...config,
  ...dangerous,
  ...scope,
  ...defaultRouting,
};

describe('the config barrel', () => {
  it('exports the runtime names of the eight files the sections barrel does not hold, each once, and no other', () => {
    const expected = unionLess(
      [
        Object.keys(items),
        Object.keys(schema),
        Object.keys(coreSection),
        Object.keys(section),
        Object.keys(config),
        Object.keys(dangerous),
        Object.keys(scope),
        Object.keys(defaultRouting),
      ],
      Object.keys(sectionsBarrel),
    );

    expect(Object.keys(items).length).toBeGreaterThan(0);
    expect(Object.keys(schema)).toEqual([]);
    expect(Object.keys(coreSection)).toContain('CORE_SECTION');
    expect(Object.keys(config).length).toBeGreaterThan(0);
    expect(Object.keys(config)).not.toContain('CORE_SECTION');
    expect(expected).toContain('CORE_SECTION');
    expect(Object.keys(config)).not.toContain('registerConfigSections');
    expect(expected).toContain('registerConfigSections');
    expect(expected).toContain('moduleSource');
    expect(Object.keys(config)).toContain('INJECT_MODES');
    expect(expected).not.toContain('INJECT_MODES');
    expect(Object.keys(section)).toContain('activeSettingByKey');
    expect(Object.keys(config)).not.toContain('activeSettingByKey');
    expect(expected).toContain('activeSettingByKey');
    expect(expected).toContain('runWithDangerousPhrases');
    expect(Object.keys(scope)).toEqual(['scopeAt']);
    for (const merged of ['SETTINGS', 'CONFIG_DEFAULTS', 'SETTING_NAMES', 'SETTING_BY_KEY', 'SECTIONS', 'knownKeysAbove']) {
      expect([merged, merged in barrel]).toEqual([merged, false]);
    }
    expect(Object.keys(barrel).sort()).toEqual(expected);
  });

  it('exports each runtime name as the binding its file declares', () => {
    const exported: Readonly<Record<string, unknown>> = barrel;

    for (const name of Object.keys(barrel)) {
      expect([name, exported[name] === BEHIND[name]]).toEqual([name, true]);
    }
    // A name two of the eight export is one binding, so the spread above lost none.
    for (const [name, value] of [
      ...Object.entries(items),
      ...Object.entries(schema),
      ...Object.entries(coreSection),
      ...Object.entries(section),
      ...Object.entries(dangerous),
      ...Object.entries(scope),
      ...Object.entries(defaultRouting),
    ]) {
      expect([name, BEHIND[name] === value]).toEqual([name, true]);
    }
  });

  it('exports the type names of the eight files with the runtime ones, each once, and no other', () => {
    const names = readExportNames([
      BARREL,
      SECTIONS_BARREL,
      ITEMS,
      SCHEMA,
      CORE,
      SECTION,
      CONFIG,
      DANGEROUS,
      SCOPE,
      ROUTING,
    ]);
    const expected = unionLess(
      [
        names[ITEMS] ?? [],
        names[SCHEMA] ?? [],
        names[CORE] ?? [],
        names[SECTION] ?? [],
        names[CONFIG] ?? [],
        names[DANGEROUS] ?? [],
        names[SCOPE] ?? [],
        names[ROUTING] ?? [],
      ],
      names[SECTIONS_BARREL] ?? [],
    );

    expect(names[SCHEMA]).toEqual(['CommandLineSetting', 'ConfigSetting', 'RafaConfig', 'SettingSpec']);
    expect(names[CORE]).toContain('CoreSetting');
    expect(names[SECTION]).toContain('ConfigSection');
    expect(names[CONFIG]).not.toContain('ConfigSection');
    expect(names[CONFIG]).not.toContain('SettingSpec');
    expect(names[CONFIG]).toContain('ConfigLayers');
    expect(names[CONFIG]).not.toContain('HubContext');
    expect(names[CONFIG]).toContain('InjectMode');
    expect(Object.keys(config)).not.toContain('ConfigLayers');
    expect(expected).not.toContain('InjectMode');
    expect(names[DANGEROUS]).toContain('DangerousPhrases');
    expect(names[SCOPE]).toEqual(['ProjectFound', 'Scope', 'scopeAt']);
    expect(names[ROUTING]).toEqual(['DEFAULT_ROUTES', 'DEFAULT_ROUTING', 'Route']);
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
