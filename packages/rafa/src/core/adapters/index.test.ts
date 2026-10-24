/**
 * Tests for the `index.ts` barrel: it exports every name `registry.ts`
 * exports, each once, as the same binding, and no other name, and it
 * loads no adapter, so the barrel, `registry.ts` and
 * `packages/rafa-effort/src/effort/sync/select.ts` load whichever comes first.
 *
 * The barrel spells its names, so a name added to `registry.ts` and not
 * to the barrel is a name no file outside `packages/rafa/src/core/` can import.
 * Nothing here is spelled a second time: both sides are read off the
 * modules, the runtime names off their namespaces and the type names
 * with the TypeScript checker, as `packages/rafa/src/core/command/index.test.ts`
 * reads its barrel.
 *
 * Three names are held by name, so a reading that came back empty, or
 * one that saw runtime names alone, fails rather than agreeing with
 * itself: `CORE_ADAPTER_REGISTRY`, the facade every caller resolves
 * through; `AdapterContext`, a type, which the namespace must not hold
 * and the checker must; and `AdapterRegistry`, the type of the registry.
 *
 * The binding case is what a barrel over a module-level slot has to
 * hold: a second copy of `registry.ts` would have an active registry of
 * its own, and an adapter registered through one would not be found
 * through the other. The case registers a fixture adapter through the
 * barrel, reads it through `registry.ts`, and puts back the registry it
 * found, so it imports no adapter.
 *
 * The load cases read `packages/rafa/src/core/adapters/index.ts`, `registry.ts` and
 * `packages/rafa-effort/src/effort/sync/select.ts`, the three files of the cycle the barrel's
 * note records as gone, each imported first in a child `bun`, since this
 * file has already imported two of them by the time a case runs. Each
 * child imports the composition root `src/adapter-registry.ts` after
 * it and calls its `registerCoreAdapters`, since importing the root
 * registers nothing, then resolves `sync/local` through the barrel and
 * pushes with it, so a module that loaded with a binding still unset
 * fails the case. The control child imports the barrel and `select.ts`
 * without the root, and must be refused naming it.
 *
 * Three mutations were driven against this file on 2026-10-12, one run
 * each, with every file restored and verified with `sha256sum -c`, while
 * `registry.ts` still imported `select.ts`. The barrel spelling two of
 * the three runtime names reddened the first, second and fourth cases.
 * The barrel leaving out the type `AnyAdapter` reddened the fourth case
 * alone. `select.ts` reading `CORE_ADAPTER_REGISTRY.kinds('sync')` at
 * its top level failed this file at load, no case running, since this
 * file imports the barrel. The same mutation with the three orders run
 * by hand, one fresh `bun` each, failed with a `ReferenceError` when the
 * barrel or `registry.ts` came first and loaded when `select.ts` did.
 */
import type { Adapter } from './registry.js';

import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

import * as registry from './registry.js';

import * as barrel from './index.js';

const ROOT = resolve(import.meta.dir, '../../../../..');

const BARREL = 'packages/rafa/src/core/adapters/index.ts';
const REGISTRY = 'packages/rafa/src/core/adapters/registry.ts';
const SELECT = 'packages/rafa-effort/src/effort/sync/select.ts';
const ROOT_MODULE = 'src/adapter-registry.ts';

/** What every member of `CORE_ADAPTER_REGISTRY` throws while nothing is registered. */
const UNREGISTERED = 'adapter registry: no adapter is registered: call registerCoreAdapters()'
  + ' from src/adapter-registry.ts before reading CORE_ADAPTER_REGISTRY';

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
 * Runs a child `bun` that imports `first` before the other two files,
 * then the composition root unless `withRoot` is false, then resolves
 * `sync/local` through the barrel.
 *
 * @param first - Repository-relative path of the file to import first.
 * @param withRoot - Whether the child imports the composition root.
 * @returns The child's exit code, what it printed, and what it wrote to stderr.
 */
function loadingFirst(first: string, withRoot = true): { exitCode: number; stdout: string; stderr: string } {
  const script = [
    `await import(${JSON.stringify(resolve(ROOT, first))});`,
    ...(withRoot
      ? [`(await import(${JSON.stringify(resolve(ROOT, ROOT_MODULE))})).registerCoreAdapters();`]
      : []),
    `const { CORE_ADAPTER_REGISTRY } = await import(${JSON.stringify(resolve(ROOT, BARREL))});`,
    `const { selectSync } = await import(${JSON.stringify(resolve(ROOT, SELECT))});`,
    'const sync = selectSync("/nonexistent", { effortSync: "local" });',
    'const pushed = await sync.push({ to: null });',
    'console.log(JSON.stringify([CORE_ADAPTER_REGISTRY.kinds("sync"), sync.kind, pushed.status]));',
  ].join('\n');
  const child = Bun.spawnSync([process.execPath, '-e', script]);
  return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
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

  it('registers on and resolves through the one active registry of registry.ts', () => {
    const fixture: Adapter<'sync'> = {
      port: 'sync',
      kind: 'barrel-fixture',
      portVersion: barrel.PORT_VERSIONS.sync,
      create: () => ({
        kind: 'git',
        push: async () => ({ status: 'nothing-to-sync' }),
        pull: async () => ({ status: 'nothing-to-sync' }),
      }),
    };
    const found = registry.activeAdapterRegistry();
    try {
      barrel.restoreAdapters(registry.createAdapterRegistry());
      barrel.registerAdapters([fixture]);

      expect(barrel.CORE_ADAPTER_REGISTRY).toBe(registry.CORE_ADAPTER_REGISTRY);
      expect(registry.activeAdapterRegistry()).toBe(barrel.activeAdapterRegistry());
      expect(barrel.CORE_ADAPTER_REGISTRY.resolve('sync', 'barrel-fixture'))
        .toBe(registry.CORE_ADAPTER_REGISTRY.resolve('sync', 'barrel-fixture'));
    } finally {
      registry.restoreAdapters(found);
    }
  });

  it('exports the type names of registry.ts with the runtime ones, each once, and no other', () => {
    const names = readExportNames([BARREL, REGISTRY]);

    expect(names[REGISTRY]).toContain('CORE_ADAPTER_REGISTRY');
    expect(names[REGISTRY]).toContain('AdapterContext');
    expect(names[REGISTRY]).toContain('AdapterRegistry');
    expect(names[BARREL]).toEqual(names[REGISTRY] ?? []);
  });
});

describe('loading the adapters barrel beside select.ts', () => {
  it.each([BARREL, REGISTRY, SELECT])('resolves sync/local when %s is imported first and the root after it', (first) => {
    expect(loadingFirst(first)).toEqual({
      exitCode: 0,
      stdout: '[["local","file"],"local","nothing-to-sync"]\n',
      stderr: '',
    });
  });

  it('refuses sync/local naming the root when no file imported it', () => {
    const run = loadingFirst(BARREL, false);

    expect(run.exitCode).not.toBe(0);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain(UNREGISTERED);
  });
});
