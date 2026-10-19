/**
 * Tests for the `index.ts` barrel: it exports every name `identity.ts`
 * exports, each once, as the same binding, and no other name.
 *
 * The barrel spells its names, so a name added to `identity.ts` and not
 * to the barrel is a name no file outside `packages/rafa/src/core/` can import.
 * Nothing here is spelled a second time: both sides are read off the
 * modules, the runtime names off their namespaces and the type names
 * with the TypeScript checker, as `packages/rafa/src/core/loop/readings.test.ts` reads
 * its barrel.
 *
 * Two names are held by name, so a reading that came back empty, or one
 * that saw runtime names alone, fails rather than agreeing with itself:
 * `readRuntimeIdentity`, the one function of `identity.ts`, and
 * `RuntimeIdentity`, the type it answers with.
 */
import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as identity from './identity.js';

import * as barrel from './index.js';

const ROOT = resolve(import.meta.dir, '../../../../..');

const BARREL = 'packages/rafa/src/core/runtime/index.ts';
const IDENTITY = 'packages/rafa/src/core/runtime/identity.ts';

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

describe('the runtime barrel', () => {
  it('exports the runtime names of identity.ts, each once, and no other', () => {
    const expected = Object.keys(identity).sort();

    expect(expected).toContain('readRuntimeIdentity');
    expect(Object.keys(barrel).sort()).toEqual(expected);
  });

  it('exports each runtime name as the binding identity.ts declares', () => {
    const exported: Readonly<Record<string, unknown>> = barrel;

    expect(Object.keys(identity).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(identity)) {
      expect([name, exported[name] === value]).toEqual([name, true]);
    }
  });

  it('exports the type names of identity.ts with the runtime ones, each once, and no other', () => {
    const names = readExportNames([BARREL, IDENTITY]);

    expect(names[IDENTITY]).toContain('RuntimeIdentity');
    expect(names[IDENTITY]).toContain('readRuntimeIdentity');
    expect(Object.keys(identity)).not.toContain('RuntimeIdentity');
    expect(names[BARREL]).toEqual(names[IDENTITY] ?? []);
  });
});
