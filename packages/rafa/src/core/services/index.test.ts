/**
 * Tests for the `index.ts` barrel: it exports every name `registry.ts`
 * and `shapes.ts` export, each once, as the same binding, and no other
 * name.
 *
 * The barrel spells its names, so a name added to either file and not to
 * the barrel is a name no file outside `packages/rafa/src/core/` can
 * import. Nothing here is spelled a second time: both sides are read off
 * the modules, the runtime names off their namespaces and the type names
 * with the TypeScript checker, as `packages/rafa/src/core/runtime/index.test.ts`
 * reads its barrel.
 *
 * Three names are held by name, so a reading that came back empty, or
 * one that saw runtime names alone, fails rather than agreeing with
 * itself: `activeServices`, the facade every caller reads through;
 * `RafaServices`, a type of `registry.ts`, which the namespace must not
 * hold and the checker must; and `StaleDocLineResult`, a type of
 * `shapes.ts`.
 *
 * The binding case is what a barrel over a module-level slot has to
 * hold: a second copy of `registry.ts` would have an active set of its
 * own, and a set registered through one would not be read through the
 * other. The case registers stubs through the barrel, calls them through
 * `registry.ts`, and puts back the set it found.
 */
import type { RafaServices } from './registry.js';

import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as registry from './registry.js';

import * as barrel from './index.js';

const ROOT = resolve(import.meta.dir, '../../../../..');

const BARREL = 'packages/rafa/src/core/services/index.ts';
const REGISTRY = 'packages/rafa/src/core/services/registry.ts';
const SHAPES = 'packages/rafa/src/core/services/shapes.ts';

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

describe('the services barrel', () => {
  it('exports the runtime names of registry.ts, each once, and no other', () => {
    const expected = Object.keys(registry).sort();

    expect(expected).toContain('activeServices');
    expect(expected).not.toContain('RafaServices');
    expect(Object.keys(barrel).sort()).toEqual(expected);
  });

  it('exports each runtime name as the binding registry.ts declares', () => {
    const exported: Readonly<Record<string, unknown>> = barrel;

    expect(Object.keys(registry).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(registry)) {
      expect([name, exported[name] === value]).toEqual([name, true]);
    }
  });

  it('registers on and reads through the one active set of registry.ts', async () => {
    const services: RafaServices = {
      addStaleDocLine: async () => ({ action: 'kept', title: 'barrel', reason: 'barrel' }),
      endWithNextStep: async () => 'barrel',
      pullRequestsIn: () => ({}) as ReturnType<RafaServices['pullRequestsIn']>,
      readStaleDocsVersion: () => 'barrel',
      triageReport: async () => ({ bugs: [], staleDocs: [] }),
    };
    const found = barrel.registerServices(services);
    try {
      expect(barrel.activeServices()).toBe(registry.activeServices());
      expect(registry.activeServices().readStaleDocsVersion({} as Parameters<RafaServices['readStaleDocsVersion']>[0]))
        .toBe('barrel');
      expect(barrel.SERVICE_REASONS).toBe(registry.SERVICE_REASONS);
    } finally {
      registry.restoreServices(found);
    }
  });

  it('exports the type names of registry.ts and shapes.ts with the runtime ones, each once, and no other', () => {
    const names = readExportNames([BARREL, REGISTRY, SHAPES]);
    const behind = [...(names[REGISTRY] ?? []), ...(names[SHAPES] ?? [])].sort();

    expect(names[REGISTRY]).toContain('activeServices');
    expect(names[REGISTRY]).toContain('RafaServices');
    expect(names[SHAPES]).toContain('StaleDocLineResult');
    expect(new Set(behind).size).toBe(behind.length);
    expect(names[BARREL]).toEqual(behind);
  });
});
