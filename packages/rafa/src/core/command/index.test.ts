/**
 * Tests for the `index.ts` barrel: it exports every name `command.ts`,
 * `confirm.ts`, `lazy.ts`, `registry-types.ts`, `running.ts`,
 * `spends.ts`, `types.ts` and `version.ts` export, each once, as the same binding,
 * and no other name.
 *
 * The barrel spells its names, so a name added to one of the eight files
 * and not to the barrel is a name no file outside `packages/rafa/src/core/` can import.
 * Nothing here is spelled a second time: both sides are read off the
 * modules, the runtime names off their namespaces and the type names
 * with the TypeScript checker, as `packages/rafa/src/core/config/sections.test.ts`
 * reads its barrel.
 *
 * The eight files hold no name in common, which the second case holds on
 * its own: were one name on two files, the barrel could export one of
 * the two bindings only, and the joined list below would hide which.
 *
 * Twelve names are held by name, so a reading that came back empty, or
 * one that saw runtime names alone, fails rather than agreeing with
 * itself: `RafaCommand`, a type of `command.ts`; `Prompter`, a type of
 * `confirm.ts`; `CommandDeclaration`, a type of `lazy.ts`, and
 * `lazyCommand`, a function of it; `CommandRegistry`, a type of `registry-types.ts`, which
 * exports no runtime name; `RunningCommand`, a type of `running.ts`, and
 * `runningCommand`, a function of it; `CommandSpend`, a type of `spends.ts`, and `spendsMark`,
 * a function of it; `CliContext`, a type of `types.ts`, which exports no
 * runtime name; `versionLine`, a function of `version.ts`, which exports
 * no type; and `CommandExit`, the class every command refuses with.
 */
import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as command from './command.js';
import * as confirm from './confirm.js';
import * as lazy from './lazy.js';
import * as registryTypes from './registry-types.js';
import * as running from './running.js';
import * as spends from './spends.js';
import * as types from './types.js';
import * as version from './version.js';

import * as barrel from './index.js';

const ROOT = resolve(import.meta.dir, '../../../../..');

const BARREL = 'packages/rafa/src/core/command/index.ts';
const COMMAND = 'packages/rafa/src/core/command/command.ts';
const CONFIRM = 'packages/rafa/src/core/command/confirm.ts';
const LAZY = 'packages/rafa/src/core/command/lazy.ts';
const REGISTRY_TYPES = 'packages/rafa/src/core/command/registry-types.ts';
const RUNNING = 'packages/rafa/src/core/command/running.ts';
const SPENDS = 'packages/rafa/src/core/command/spends.ts';
const TYPES = 'packages/rafa/src/core/command/types.ts';
const VERSION = 'packages/rafa/src/core/command/version.ts';

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
 * The names more than one of the lists holds, sorted.
 *
 * @param lists - The lists to compare.
 * @returns Each name found in two lists or more, once.
 */
function onTwo(lists: readonly (readonly string[])[]): string[] {
  const all = lists.flat();
  return [...new Set(all.filter((name, index) => all.indexOf(name) !== index))].sort();
}

/** The runtime bindings of the eight files; the second case holds that no name is lost to the spread. */
const BEHIND: Readonly<Record<string, unknown>> = {
  ...command,
  ...confirm,
  ...lazy,
  ...registryTypes,
  ...running,
  ...spends,
  ...types,
  ...version,
};

describe('the command barrel', () => {
  it('exports the runtime names of the eight files, each once, and no other', () => {
    const expected = [
      ...Object.keys(command),
      ...Object.keys(confirm),
      ...Object.keys(lazy),
      ...Object.keys(registryTypes),
      ...Object.keys(running),
      ...Object.keys(spends),
      ...Object.keys(types),
      ...Object.keys(version),
    ].sort();

    expect(Object.keys(command)).toContain('CommandExit');
    expect(Object.keys(confirm)).toContain('createLinePrompter');
    expect(Object.keys(lazy)).toEqual(['lazyCommand']);
    expect(Object.keys(registryTypes)).toEqual([]);
    expect(Object.keys(running)).toContain('runningCommand');
    expect(Object.keys(spends)).toContain('spendsMark');
    expect(Object.keys(types)).toEqual([]);
    expect(Object.keys(version)).toContain('versionLine');
    expect(Object.keys(barrel).sort()).toEqual(expected);
  });

  it('reads eight files that hold no name in common, type or runtime', () => {
    const names = readExportNames([COMMAND, CONFIRM, LAZY, REGISTRY_TYPES, RUNNING, SPENDS, TYPES, VERSION]);

    expect(names[COMMAND]?.length).toBeGreaterThan(0);
    expect(names[CONFIRM]?.length).toBeGreaterThan(0);
    expect(names[LAZY]?.length).toBeGreaterThan(0);
    expect(names[REGISTRY_TYPES]?.length).toBeGreaterThan(0);
    expect(names[RUNNING]?.length).toBeGreaterThan(0);
    expect(names[SPENDS]?.length).toBeGreaterThan(0);
    expect(names[TYPES]?.length).toBeGreaterThan(0);
    expect(names[VERSION]?.length).toBeGreaterThan(0);
    expect(onTwo([['a', 'b'], ['b', 'c'], ['c']])).toEqual(['b', 'c']);
    expect(onTwo([
      names[COMMAND] ?? [],
      names[CONFIRM] ?? [],
      names[LAZY] ?? [],
      names[REGISTRY_TYPES] ?? [],
      names[RUNNING] ?? [],
      names[SPENDS] ?? [],
      names[TYPES] ?? [],
      names[VERSION] ?? [],
    ])).toEqual([]);
  });

  it('exports each runtime name as the binding its file declares', () => {
    const exported: Readonly<Record<string, unknown>> = barrel;

    expect(Object.keys(BEHIND).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(BEHIND)) {
      expect([name, exported[name] === value]).toEqual([name, true]);
    }
  });

  it('exports the type names of the eight files with the runtime ones, each once, and no other', () => {
    const names = readExportNames([BARREL, COMMAND, CONFIRM, LAZY, REGISTRY_TYPES, RUNNING, SPENDS, TYPES, VERSION]);
    const expected = [
      ...(names[COMMAND] ?? []),
      ...(names[CONFIRM] ?? []),
      ...(names[LAZY] ?? []),
      ...(names[REGISTRY_TYPES] ?? []),
      ...(names[RUNNING] ?? []),
      ...(names[SPENDS] ?? []),
      ...(names[TYPES] ?? []),
      ...(names[VERSION] ?? []),
    ].sort();

    expect(names[COMMAND]).toContain('RafaCommand');
    expect(names[CONFIRM]).toContain('Prompter');
    expect(names[LAZY]).toContain('CommandDeclaration');
    expect(names[REGISTRY_TYPES]).toContain('CommandRegistry');
    expect(names[RUNNING]).toContain('RunningCommand');
    expect(names[SPENDS]).toContain('CommandSpend');
    expect(names[TYPES]).toContain('CliContext');
    expect(names[VERSION]).toContain('versionLine');
    expect(Object.keys(command)).not.toContain('RafaCommand');
    expect(Object.keys(confirm)).not.toContain('Prompter');
    expect(Object.keys(lazy)).not.toContain('CommandDeclaration');
    expect(Object.keys(running)).not.toContain('RunningCommand');
    expect(Object.keys(spends)).not.toContain('CommandSpend');
    expect(names[BARREL]).toEqual(expected);
  });
});
