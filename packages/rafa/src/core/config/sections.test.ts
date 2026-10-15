/**
 * Tests for the `sections.ts` barrel: it exports every name
 * `config-sections.ts` and `config-readers.ts` export, each once, as the
 * same binding, and no name neither exports.
 *
 * The barrel spells its names, so a reader added to one of the two files
 * and not to the barrel is a name no file outside `packages/rafa/src/core/` can import.
 * Nothing here is spelled a second time: both sides are read off the
 * modules, the runtime names off their namespaces and the type names
 * with the TypeScript checker, as `src/tests/entry-exports.test.ts`
 * reads the entry barrels. A name both files exported would make the
 * expected list one longer than the barrel's and fail the same cases.
 *
 * Two names are held by name, so a reading that came back empty, or
 * one that saw runtime names alone, fails rather than agreeing with
 * itself: `Reader`, a type of `config-sections.ts`; and
 * `ReleaseStrategy`, a type of `config-readers.ts`.
 */
import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as readers from './config-readers.js';
import * as sections from './config-sections.js';
import * as barrel from './sections.js';

const ROOT = resolve(import.meta.dir, '../../../../..');

const BARREL = 'packages/rafa/src/core/config/sections.ts';
const SECTIONS = 'packages/rafa/src/core/config/config-sections.ts';
const READERS = 'packages/rafa/src/core/config/config-readers.ts';

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

describe('the sections barrel', () => {
  it('exports the runtime names of both files, each once, and no other', () => {
    const expected = [...Object.keys(sections), ...Object.keys(readers)].sort();

    expect(Object.keys(sections).length).toBeGreaterThan(0);
    expect(Object.keys(readers).length).toBeGreaterThan(0);
    expect(Object.keys(barrel).sort()).toEqual(expected);
  });

  it('exports each runtime name as the binding its file declares', () => {
    const exported: Readonly<Record<string, unknown>> = barrel;

    for (const [name, value] of [...Object.entries(sections), ...Object.entries(readers)]) {
      expect([name, exported[name] === value]).toEqual([name, true]);
    }
  });

  it('exports the type names of both files with the runtime ones, each once, and no other', () => {
    const names = readExportNames([BARREL, SECTIONS, READERS]);
    const expected = [...(names[SECTIONS] ?? []), ...(names[READERS] ?? [])].sort();

    expect(names[SECTIONS]).toContain('Reader');
    expect(names[READERS]).toContain('ReleaseStrategy');
    expect(names[BARREL]).not.toContain('MergeMethod');
    expect(Object.keys(sections)).not.toContain('Reader');
    expect(names[BARREL]).toEqual(expected);
  });
});
