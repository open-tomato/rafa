/**
 * Tests for the `index.ts` barrel: it exports every name `command.ts`,
 * `confirm.ts` and `version.ts` export, each once, as the same binding,
 * and no other name.
 *
 * The barrel spells its names, so a name added to one of the three files
 * and not to the barrel is a name no file outside `src/core/` can import.
 * Nothing here is spelled a second time: both sides are read off the
 * modules, the runtime names off their namespaces and the type names
 * with the TypeScript checker, as `src/core/config/sections.test.ts`
 * reads its barrel.
 *
 * The three files hold no name in common, which the second case holds on
 * its own: were one name on two files, the barrel could export one of
 * the two bindings only, and the joined list below would hide which.
 *
 * Four names are held by name, so a reading that came back empty, or one
 * that saw runtime names alone, fails rather than agreeing with itself:
 * `RafaCommand`, a type of `command.ts`; `Prompter`, a type of
 * `confirm.ts`; `versionLine`, a function of `version.ts`, which exports
 * no type; and `CommandExit`, the class every command refuses with.
 */
import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as command from './command.js';
import * as confirm from './confirm.js';
import * as version from './version.js';

import * as barrel from './index.js';

const ROOT = resolve(import.meta.dir, '../../..');

const BARREL = 'src/core/command/index.ts';
const COMMAND = 'src/core/command/command.ts';
const CONFIRM = 'src/core/command/confirm.ts';
const VERSION = 'src/core/command/version.ts';

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

/** The runtime bindings of the three files; the second case holds that no name is lost to the spread. */
const BEHIND: Readonly<Record<string, unknown>> = { ...command, ...confirm, ...version };

describe('the command barrel', () => {
  it('exports the runtime names of the three files, each once, and no other', () => {
    const expected = [...Object.keys(command), ...Object.keys(confirm), ...Object.keys(version)].sort();

    expect(Object.keys(command)).toContain('CommandExit');
    expect(Object.keys(confirm)).toContain('createLinePrompter');
    expect(Object.keys(version)).toContain('versionLine');
    expect(Object.keys(barrel).sort()).toEqual(expected);
  });

  it('reads three files that hold no name in common, type or runtime', () => {
    const names = readExportNames([COMMAND, CONFIRM, VERSION]);

    expect(names[COMMAND]?.length).toBeGreaterThan(0);
    expect(names[CONFIRM]?.length).toBeGreaterThan(0);
    expect(names[VERSION]?.length).toBeGreaterThan(0);
    expect(onTwo([['a', 'b'], ['b', 'c'], ['c']])).toEqual(['b', 'c']);
    expect(onTwo([names[COMMAND] ?? [], names[CONFIRM] ?? [], names[VERSION] ?? []])).toEqual([]);
  });

  it('exports each runtime name as the binding its file declares', () => {
    const exported: Readonly<Record<string, unknown>> = barrel;

    expect(Object.keys(BEHIND).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(BEHIND)) {
      expect([name, exported[name] === value]).toEqual([name, true]);
    }
  });

  it('exports the type names of the three files with the runtime ones, each once, and no other', () => {
    const names = readExportNames([BARREL, COMMAND, CONFIRM, VERSION]);
    const expected = [...(names[COMMAND] ?? []), ...(names[CONFIRM] ?? []), ...(names[VERSION] ?? [])].sort();

    expect(names[COMMAND]).toContain('RafaCommand');
    expect(names[CONFIRM]).toContain('Prompter');
    expect(names[VERSION]).toContain('versionLine');
    expect(Object.keys(command)).not.toContain('RafaCommand');
    expect(Object.keys(confirm)).not.toContain('Prompter');
    expect(names[BARREL]).toEqual(expected);
  });
});
