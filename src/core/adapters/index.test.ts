/**
 * Tests for the `index.ts` barrel: it exports every name `registry.ts`
 * exports, each once, as the same binding, and no other name, and the
 * import cycle it sits in loads whichever of its files comes first.
 *
 * The barrel spells its names, so a name added to `registry.ts` and not
 * to the barrel is a name no file outside `src/core/` can import.
 * Nothing here is spelled a second time: both sides are read off the
 * modules, the runtime names off their namespaces and the type names
 * with the TypeScript checker, as `src/core/command/index.test.ts`
 * reads its barrel.
 *
 * Three names are held by name, so a reading that came back empty, or
 * one that saw runtime names alone, fails rather than agreeing with
 * itself: `CORE_ADAPTER_REGISTRY`, the registry every caller resolves
 * through; `AdapterContext`, a type, which the namespace must not hold
 * and the checker must; and `AdapterRegistry`, the type of the registry.
 *
 * The binding case is what a barrel over a constant has to hold: a
 * second copy of `registry.ts` would have a `CORE_ADAPTER_REGISTRY` of
 * its own, and an adapter a caller found through one would not be the
 * adapter another found through the other.
 *
 * The cycle cases read `src/core/adapters/index.ts`, `registry.ts` and
 * `src/effort/sync/select.ts`, the three files of the cycle the barrel's
 * note describes, each imported first in a child `bun`, since this file
 * has already imported two of them by the time a case runs. Each child
 * resolves `sync/local` through the barrel and pushes with it, so a
 * module that loaded with a binding still unset fails the case.
 *
 * Three mutations were driven against this file on 2026-10-12, one run
 * each, with every file restored and verified with `sha256sum -c`. The
 * barrel spelling two of the three runtime names reddened the first,
 * second and fourth cases. The barrel leaving out the type `AnyAdapter`
 * reddened the fourth case alone. `select.ts` reading
 * `CORE_ADAPTER_REGISTRY.kinds('sync')` at its top level failed this
 * file at load, no case running, since this file imports the barrel.
 * The same mutation with the three orders run by hand, one fresh `bun`
 * each, failed with a `ReferenceError` when the barrel or `registry.ts`
 * came first and loaded when `select.ts` did.
 */
import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as registry from './registry.js';

import * as barrel from './index.js';

const ROOT = resolve(import.meta.dir, '../../..');

const BARREL = 'src/core/adapters/index.ts';
const REGISTRY = 'src/core/adapters/registry.ts';
const SELECT = 'src/effort/sync/select.ts';

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
 * Runs a child `bun` that imports `first` before the other two files of
 * the cycle, then resolves `sync/local` through the barrel.
 *
 * @param first - Repository-relative path of the file to import first.
 * @returns The child's exit code and what it printed.
 */
function loadingFirst(first: string): { exitCode: number; stdout: string } {
  const script = [
    `await import(${JSON.stringify(resolve(ROOT, first))});`,
    `const { CORE_ADAPTER_REGISTRY } = await import(${JSON.stringify(resolve(ROOT, BARREL))});`,
    `const { selectSync } = await import(${JSON.stringify(resolve(ROOT, SELECT))});`,
    'const sync = selectSync("/nonexistent", { effortSync: "local" });',
    'const pushed = await sync.push({ to: null });',
    'console.log(JSON.stringify([CORE_ADAPTER_REGISTRY.kinds("sync"), sync.kind, pushed.status]));',
  ].join('\n');
  const child = Bun.spawnSync([process.execPath, '-e', script]);
  return { exitCode: child.exitCode, stdout: child.stdout.toString() };
}

describe('the adapters barrel', () => {
  it('exports the runtime names of registry.ts, each once, and no other', () => {
    const expected = Object.keys(registry).sort();

    expect(expected).toContain('CORE_ADAPTER_REGISTRY');
    expect(expected).not.toContain('AdapterContext');
    expect(Object.keys(barrel).sort()).toEqual(expected);
  });

  it('exports each runtime name as the binding registry.ts declares', () => {
    const exported: Readonly<Record<string, unknown>> = barrel;

    expect(Object.keys(registry).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(registry)) {
      expect([name, exported[name] === value]).toEqual([name, true]);
    }
  });

  it('resolves through the one registry of registry.ts', () => {
    expect(barrel.CORE_ADAPTER_REGISTRY).toBe(registry.CORE_ADAPTER_REGISTRY);
    expect(barrel.CORE_ADAPTER_REGISTRY.resolve('sync', 'local'))
      .toBe(registry.CORE_ADAPTER_REGISTRY.resolve('sync', 'local'));
  });

  it('exports the type names of registry.ts with the runtime ones, each once, and no other', () => {
    const names = readExportNames([BARREL, REGISTRY]);

    expect(names[REGISTRY]).toContain('CORE_ADAPTER_REGISTRY');
    expect(names[REGISTRY]).toContain('AdapterContext');
    expect(names[REGISTRY]).toContain('AdapterRegistry');
    expect(names[BARREL]).toEqual(names[REGISTRY] ?? []);
  });
});

describe('the import cycle the adapters barrel is in', () => {
  it.each([BARREL, REGISTRY, SELECT])('resolves sync/local when %s is imported first', (first) => {
    expect(loadingFirst(first)).toEqual({
      exitCode: 0,
      stdout: '[["local","file"],"local","nothing-to-sync"]\n',
    });
  });
});
