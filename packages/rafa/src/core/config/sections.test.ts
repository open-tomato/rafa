/**
 * Tests for the `sections.ts` barrel: it exports every name
 * `config-sections.ts`, `config-readers.ts`, `branch-template.ts` and
 * `merge-method.ts` export, each once, as the same binding, and no name none of them
 * exports.
 *
 * The barrel spells its names, so a reader added to one of the four files
 * and not to the barrel is a name no file outside `packages/rafa/src/core/` can import.
 * Nothing here is spelled a second time: both sides are read off the
 * modules, the runtime names off their namespaces and the type names
 * with the TypeScript checker, as `src/tests/entry-exports.test.ts`
 * reads the entry barrels. A name two files exported would make the
 * expected list one longer than the barrel's and fail the same cases.
 *
 * Four names are held by name, so a reading that came back empty, or
 * one that saw runtime names alone, fails rather than agreeing with
 * itself: `Reader`, a type of `config-sections.ts`; `ReleaseStrategy`,
 * a type of `config-readers.ts`; `stubOfBranch`, a function of
 * `branch-template.ts`; and `MergeMethod`, a type of `merge-method.ts`.
 */
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as template from './branch-template.js';
import * as readers from './config-readers.js';
import * as sections from './config-sections.js';
import * as mergeMethod from './merge-method.js';
import * as barrel from './sections.js';

const ROOT = resolve(import.meta.dir, '../../../../..');

const BARREL = 'packages/rafa/src/core/config/sections.ts';
const SECTIONS = 'packages/rafa/src/core/config/config-sections.ts';
const READERS = 'packages/rafa/src/core/config/config-readers.ts';
const TEMPLATE = 'packages/rafa/src/core/config/branch-template.ts';
const MERGE_METHOD = 'packages/rafa/src/core/config/merge-method.ts';

/** Every path a case reads the export names of, in the order the cases first name them. */
const EXPORT_PATHS: readonly string[] = [BARREL, SECTIONS, READERS, TEMPLATE, MERGE_METHOD];

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

describe('the sections barrel', () => {
  beforeAll(() => {
    exportNames = readExportNames(EXPORT_PATHS);
  }, 30_000);

  it('exports the runtime names of the four files, each once, and no other', () => {
    const expected = [
      ...Object.keys(sections),
      ...Object.keys(readers),
      ...Object.keys(template),
      ...Object.keys(mergeMethod),
    ].sort();

    expect(Object.keys(sections).length).toBeGreaterThan(0);
    expect(Object.keys(readers).length).toBeGreaterThan(0);
    expect(Object.keys(template)).toContain('stubOfBranch');
    expect(Object.keys(mergeMethod)).toContain('isMergeMethod');
    expect(Object.keys(barrel).sort()).toEqual(expected);
  });

  it('exports each runtime name as the binding its file declares', () => {
    const exported: Readonly<Record<string, unknown>> = barrel;

    const files = [sections, readers, template, mergeMethod];
    for (const [name, value] of files.flatMap((file) => Object.entries(file))) {
      expect([name, exported[name] === value]).toEqual([name, true]);
    }
  });

  it('exports the type names of the four files with the runtime ones, each once, and no other', () => {
    const names = storedExportNames();
    const expected = [
      ...(names[SECTIONS] ?? []),
      ...(names[READERS] ?? []),
      ...(names[TEMPLATE] ?? []),
      ...(names[MERGE_METHOD] ?? []),
    ].sort();

    expect(names[SECTIONS]).toContain('Reader');
    expect(names[READERS]).toContain('ReleaseStrategy');
    expect(names[MERGE_METHOD]).toContain('MergeMethod');
    expect(Object.keys(sections)).not.toContain('Reader');
    expect(names[BARREL]).toEqual(expected);
  });
});
