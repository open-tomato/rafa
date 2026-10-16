/**
 * The graph check over planted trees under a temp directory. One tree
 * that holds is the base: a composite core, a composite service that
 * declares and references it and imports it through the `paths` alias,
 * and a config package with no `tsconfig.json`. Each refusal plants one
 * breach into a fresh copy of it, and each has a control beside it that
 * the base, or a near breach the check must let pass, reads clean, so no
 * clean reading here is of a check that could never fail.
 */
import type { GraphReport } from './graph-check';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';

import { checkGraph, graphHolds, main, renderReport } from './graph-check';

/** A planted file: text as it is, anything else written as JSON. */
type Planted = string | Record<string, unknown>;

/** The scratch roots planted by the running test, removed after it. */
const scratchRoots: string[] = [];

afterEach(() => {
  for (const root of scratchRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A composite member's `tsconfig.json`, referencing `references`. */
function compositeTsconfig(references: readonly string[] = []): Record<string, unknown> {
  return {
    compilerOptions: { composite: true, rootDir: 'src', outDir: '.tsbuild', emitDeclarationOnly: true },
    include: ['src'],
    references: references.map((path) => ({ path })),
  };
}

/** The scripts of a typed member: the three `turbo.json` tasks. */
const TYPED_SCRIPTS = { lint: 'eslint .', 'check-types': 'tsc --build', test: 'bun test' };

/** The tree that holds, keyed by path relative to the root. */
function baseTree(): Record<string, Planted> {
  return {
    'package.json': { name: '@open-tomato/rafa', private: true, workspaces: ['packages/*'] },
    'turbo.json': '{\n  // the three tasks\n  "tasks": { "lint": {}, "check-types": {}, "test": {} }\n}\n',
    'tsconfig.references.json': {
      files: [],
      references: [{ path: './packages/core' }, { path: './packages/svc/tsconfig.json' }],
    },
    'tsconfig.packages.json': {
      compilerOptions: { paths: { '@open-tomato/rafa/*': ['./packages/core/src/*'] } },
    },
    'packages/core/package.json': { name: '@open-tomato/rafa-core', scripts: TYPED_SCRIPTS },
    'packages/core/tsconfig.json': compositeTsconfig(),
    'packages/core/src/store.ts': 'export const store: number = 1;\n',
    'packages/svc/package.json': {
      name: '@open-tomato/rafa-svc',
      scripts: TYPED_SCRIPTS,
      dependencies: { '@open-tomato/rafa-core': 'workspace:*' },
      devDependencies: { '@open-tomato/rafa-config': 'workspace:*' },
    },
    'packages/svc/tsconfig.json': compositeTsconfig(['../core']),
    'packages/svc/src/index.ts': [
      'import type { store } from \'@open-tomato/rafa/store\';',
      '// import { x } from \'@open-tomato/rafa-undeclared\';',
      'const text: string = \'@open-tomato/rafa-also-undeclared\';',
      'export type Store = typeof store;',
      'export { text };',
      '',
    ].join('\n'),
    'packages/config/package.json': {
      name: '@open-tomato/rafa-config',
      scripts: { lint: 'eslint .', test: 'bun test' },
    },
    'packages/config/eslint.config.mjs': 'import base from \'@open-tomato/rafa-config\';\nexport default [...base];\n',
    'packages/config/node_modules/dep/index.js': 'import \'@open-tomato/rafa-linked\';\n',
  };
}

/**
 * Plants a tree under a fresh temp directory.
 *
 * @param tree - The files, keyed by path relative to the root; `null` leaves a file out.
 * @returns The root.
 */
function plant(tree: Readonly<Record<string, Planted | null>>): string {
  const root = mkdtempSync(join(tmpdir(), 'graph-check-'));
  scratchRoots.push(root);
  for (const [path, content] of Object.entries(tree)) {
    if (content === null) {
      continue;
    }
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof content === 'string'
      ? content
      : `${JSON.stringify(content, null, 2)}\n`);
  }
  return root;
}

/** The base tree with `changes` laid over it, planted. */
function plantWith(changes: Readonly<Record<string, Planted | null>>): string {
  return plant({ ...baseTree(), ...changes });
}

/** The reasons the report gives for the member at `dir`. */
function reasonsOf(report: GraphReport, dir: string): readonly string[] {
  return report.members.find((member) => member.dir === dir)?.reasons ?? ['<no such member>'];
}

/** Every reason the report gives, prefixed with its member's directory. */
function allReasons(report: GraphReport): string[] {
  return [...report.root, ...report.members.flatMap((member) => member.reasons.map((reason) => `${member.dir}: ${reason}`))];
}

/** Runs the command over `root`, collecting its lines. */
function run(root: string): { readonly code: number; readonly lines: readonly string[] } {
  const lines: string[] = [];
  const code = main(['--root', root], (line) => lines.push(line));
  return { code, lines };
}

describe('a tree that holds', () => {
  test('every member holds and the command prints one ok line per member, exit 0', () => {
    const root = plant(baseTree());

    const report = checkGraph(root);
    const { code, lines } = run(root);

    expect(allReasons(report)).toEqual([]);
    expect(graphHolds(report)).toBe(true);
    expect(report.members.map((member) => member.dir)).toEqual(['packages/config', 'packages/core', 'packages/svc']);
    expect(code).toBe(0);
    expect(lines).toEqual([
      'packages/config (@open-tomato/rafa-config): ok',
      'packages/core (@open-tomato/rafa-core): ok',
      'packages/svc (@open-tomato/rafa-svc): ok',
    ]);
  });
});

describe('a member missing a script', () => {
  test('a typed member with no lint script is refused, exit 1', () => {
    const root = plantWith({
      'packages/svc/package.json': {
        name: '@open-tomato/rafa-svc',
        scripts: { 'check-types': 'tsc --build', test: 'bun test' },
        dependencies: { '@open-tomato/rafa-core': 'workspace:*' },
        devDependencies: { '@open-tomato/rafa-config': 'workspace:*' },
      },
    });

    const { code, lines } = run(root);

    expect(allReasons(checkGraph(root))).toEqual(['packages/svc: no "lint" script for the turbo.json task']);
    expect(code).toBe(1);
    expect(lines).toContain('packages/svc (@open-tomato/rafa-svc): no "lint" script for the turbo.json task');
  });

  test('a typed member with no check-types script is refused', () => {
    const root = plantWith({
      'packages/core/package.json': { name: '@open-tomato/rafa-core', scripts: { lint: 'eslint .', test: 'bun test' } },
    });

    expect(reasonsOf(checkGraph(root), 'packages/core')).toEqual(['no "check-types" script for the turbo.json task']);
  });

  test('a member with no tsconfig.json and no test script is refused', () => {
    const root = plantWith({
      'packages/config/package.json': { name: '@open-tomato/rafa-config', scripts: { lint: 'eslint .', test: '' } },
    });

    expect(reasonsOf(checkGraph(root), 'packages/config')).toEqual(['no "test" script for the turbo.json task']);
  });

  test('control: the task names come from turbo.json, so a fourth task is asked of every member', () => {
    const root = plantWith({ 'turbo.json': { tasks: { lint: {}, 'check-types': {}, test: {}, build: {}, 'svc#deploy': {} } } });

    expect(allReasons(checkGraph(root))).toEqual([
      'packages/config: no "build" script for the turbo.json task',
      'packages/core: no "build" script for the turbo.json task',
      'packages/svc: no "build" script for the turbo.json task',
    ]);
  });

  test('control: a member with no tsconfig.json is not asked for check-types', () => {
    expect(reasonsOf(checkGraph(plant(baseTree())), 'packages/config')).toEqual([]);
  });
});

describe('a non-composite member', () => {
  test('a tsconfig.json without composite is refused', () => {
    const root = plantWith({
      'packages/core/tsconfig.json': { compilerOptions: { rootDir: 'src', noEmit: true }, include: ['src'] },
    });

    expect(reasonsOf(checkGraph(root), 'packages/core')).toEqual(['tsconfig.json is not composite']);
  });

  test('a composite flag the member reads through extends counts', () => {
    const root = plantWith({
      'tsconfig.composite.json': { compilerOptions: { composite: true, emitDeclarationOnly: true } },
      'packages/core/tsconfig.json': { extends: '../../tsconfig.composite.json', compilerOptions: { rootDir: 'src' }, include: ['src'] },
    });

    expect(allReasons(checkGraph(root))).toEqual([]);
  });

  test('control: once the dependency is not composite, the service need not reference it', () => {
    const root = plantWith({
      'packages/core/tsconfig.json': { compilerOptions: { rootDir: 'src' }, include: ['src'] },
      'packages/svc/tsconfig.json': compositeTsconfig(),
    });

    expect(reasonsOf(checkGraph(root), 'packages/svc')).toEqual([]);
  });
});

describe('a member absent from the solution file', () => {
  test('a member the solution file does not reference is refused', () => {
    const root = plantWith({ 'tsconfig.references.json': { files: [], references: [{ path: './packages/core' }] } });

    expect(allReasons(checkGraph(root))).toEqual(['packages/svc: tsconfig.json is missing from tsconfig.references.json']);
  });

  test('a missing solution file is a root refusal and every typed member is refused', () => {
    const root = plantWith({ 'tsconfig.references.json': null });

    const report = checkGraph(root);

    expect(report.root).toEqual(['tsconfig.references.json is missing']);
    expect(reasonsOf(report, 'packages/core')).toEqual(['tsconfig.json is missing from tsconfig.references.json']);
    expect(graphHolds(report)).toBe(false);
  });

  test('control: a member with no tsconfig.json is not asked to be in the solution file', () => {
    expect(reasonsOf(checkGraph(plant(baseTree())), 'packages/config')).toEqual([]);
  });
});

describe('a reference omitting a declared workspace dependency', () => {
  test('a service declaring core with workspace:* and no reference to it is refused', () => {
    const root = plantWith({ 'packages/svc/tsconfig.json': compositeTsconfig() });

    expect(allReasons(checkGraph(root))).toEqual([
      'packages/svc: tsconfig.json references omit @open-tomato/rafa-core (packages/core), a declared workspace dependency',
    ]);
  });

  test('control: a declared workspace dependency with no tsconfig.json needs no reference', () => {
    expect(reasonsOf(checkGraph(plant(baseTree())), 'packages/svc')).toEqual([]);
  });

  test('control: a dependency on a registry range is no workspace dependency', () => {
    const root = plantWith({
      'packages/svc/package.json': {
        name: '@open-tomato/rafa-svc',
        scripts: TYPED_SCRIPTS,
        dependencies: { '@open-tomato/rafa-core': '^1.0.0' },
      },
      'packages/svc/tsconfig.json': compositeTsconfig(),
    });

    expect(reasonsOf(checkGraph(root), 'packages/svc')).toEqual([]);
  });
});

describe('an undeclared bare @open-tomato import', () => {
  test('an import type of a package no dependency field names is refused', () => {
    const root = plantWith({
      'packages/core/src/load.ts': 'import type { Loader } from \'@open-tomato/define-config\';\nexport type L = Loader;\n',
    });

    expect(allReasons(checkGraph(root))).toEqual([
      'packages/core: imports @open-tomato/define-config, which no dependency field declares: src/load.ts (@open-tomato/define-config)',
    ]);
  });

  test('a core subpath counts as the member the paths map resolves it to', () => {
    const root = plantWith({
      'packages/config/base.mjs': 'export * from \'@open-tomato/rafa/store\';\n',
    });

    expect(reasonsOf(checkGraph(root), 'packages/config')).toEqual([
      'imports @open-tomato/rafa-core, which no dependency field declares: base.mjs (@open-tomato/rafa/store)',
    ]);
  });

  test('a dynamic import and a require are read too', () => {
    const root = plantWith({
      'packages/config/lazy.js': 'await import(\'@open-tomato/rafa-hub\');\nrequire(\'@open-tomato/rafa-cli\');\n',
    });

    expect(reasonsOf(checkGraph(root), 'packages/config')).toEqual([
      'imports @open-tomato/rafa-cli, which no dependency field declares: lazy.js (@open-tomato/rafa-cli)',
      'imports @open-tomato/rafa-hub, which no dependency field declares: lazy.js (@open-tomato/rafa-hub)',
    ]);
  });

  test('control: a declared devDependency, a self-import, a comment, a string and node_modules read clean', () => {
    const root = plantWith({
      'packages/core/package.json': {
        name: '@open-tomato/rafa-core',
        scripts: TYPED_SCRIPTS,
        devDependencies: { '@open-tomato/define-config': '0.5.0' },
      },
      'packages/core/src/load.ts': 'import type { Loader } from \'@open-tomato/define-config\';\nexport type L = Loader;\n',
    });

    expect(allReasons(checkGraph(root))).toEqual([]);
  });

  test('control: a file in a skipped folder is not read', () => {
    const root = plantWith({ 'packages/core/.tsbuild/store.d.ts': 'export * from \'@open-tomato/rafa-linked\';\n' });

    expect(reasonsOf(checkGraph(root), 'packages/core')).toEqual([]);
  });
});

describe('a root the check cannot read', () => {
  test('globs naming no member are refused, so an empty reading never passes', () => {
    const root = plantWith({ 'package.json': { name: '@open-tomato/rafa', workspaces: ['libs/*'] } });

    const { code, lines } = run(root);

    expect(code).toBe(1);
    expect(lines).toEqual(['root: the workspaces globs (libs/*) name no member']);
  });

  test('a root manifest with no workspaces is refused', () => {
    const root = plantWith({ 'package.json': { name: '@open-tomato/rafa' } });

    expect(checkGraph(root).root).toEqual(['package.json names no workspaces glob']);
  });

  test('a missing turbo.json and one with no task are refused', () => {
    expect(checkGraph(plantWith({ 'turbo.json': null })).root).toEqual(['turbo.json is missing']);
    expect(checkGraph(plantWith({ 'turbo.json': { tasks: {} } })).root).toEqual(['turbo.json defines no task']);
  });

  test('an excluding glob drops its member', () => {
    const root = plantWith({ 'package.json': { name: '@open-tomato/rafa', workspaces: ['packages/*', '!packages/config'] } });

    expect(renderReport(checkGraph(root))).toEqual([
      'packages/core (@open-tomato/rafa-core): ok',
      'packages/svc (@open-tomato/rafa-svc): ok',
    ]);
  });
});
