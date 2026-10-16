/**
 * The graph check over planted trees under a temp directory. One tree
 * that holds is the base: a composite core, a composite service that
 * declares and references it and imports it through the `paths` alias,
 * and a config package with no `tsconfig.json`. Each refusal plants one
 * breach into a fresh copy of it, and each has a control beside it that
 * the base, or a near breach the check must let pass, reads clean, so no
 * clean reading here is of a check that could never fail.
 *
 * Every base member is `private: true`, as every live member is; the
 * publish rules are read over a fourth member, a publishable plugin,
 * planted beside them.
 */
import type { GraphReport } from './graph-check';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    'package.json': {
      name: '@open-tomato/rafa',
      workspaces: ['packages/*'],
      exports: {
        '.': './dist/index.js',
        './store': './dist/effort/store/index.js',
        './config': { types: './dist/config/index.d.ts', import: './dist/config/index.js' },
      },
    },
    'turbo.json': '{\n  // the three tasks\n  "tasks": { "lint": {}, "check-types": {}, "test": {} }\n}\n',
    'tsconfig.references.json': {
      files: [],
      references: [{ path: './packages/core' }, { path: './packages/svc/tsconfig.json' }],
    },
    'tsconfig.packages.json': {
      compilerOptions: { paths: { '@open-tomato/rafa/*': ['./packages/core/src/*'] } },
    },
    'packages/core/package.json': { name: '@open-tomato/rafa-core', private: true, scripts: TYPED_SCRIPTS },
    'packages/core/tsconfig.json': compositeTsconfig(),
    'packages/core/src/store.ts': 'export const store: number = 1;\n',
    'packages/svc/package.json': {
      name: '@open-tomato/rafa-svc',
      private: true,
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
      private: true,
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

/** The planted plugin's directory: a publishable member with no `tsconfig.json`. */
const PLUGIN_DIR = 'packages/plugin';

/**
 * A publishable plugin's manifest and one code file, to lay over the base.
 *
 * @param fields - Manifest fields beside its name and scripts.
 * @param code - The text of its `src/index.ts`.
 * @returns The two files, keyed by path relative to the root.
 */
function plugin(fields: Readonly<Record<string, unknown>>, code = 'export const id: string = \'plugin\';\n'): Record<string, Planted> {
  return {
    [`${PLUGIN_DIR}/package.json`]: { name: '@open-tomato/rafa-plugin', scripts: { lint: 'eslint .', test: 'bun test' }, ...fields },
    [`${PLUGIN_DIR}/src/index.ts`]: code,
  };
}

/** The plugin's manifest fields that hold: rafa as a peer, linked for work in the repository. */
const PEER_FIELDS = {
  peerDependencies: { '@open-tomato/rafa': '>=0.46.0' },
  devDependencies: { '@open-tomato/rafa': 'workspace:*' },
};

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
        private: true,
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
      'packages/core/package.json': { name: '@open-tomato/rafa-core', private: true, scripts: { lint: 'eslint .', test: 'bun test' } },
    });

    expect(reasonsOf(checkGraph(root), 'packages/core')).toEqual(['no "check-types" script for the turbo.json task']);
  });

  test('a member with no tsconfig.json and no test script is refused', () => {
    const root = plantWith({
      'packages/config/package.json': { name: '@open-tomato/rafa-config', private: true, scripts: { lint: 'eslint .', test: '' } },
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
        private: true,
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
        private: true,
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

describe('a publishable member', () => {
  test('a dependency on a private member is refused, naming the member, the field and the package, exit 1', () => {
    const root = plantWith(plugin({ dependencies: { '@open-tomato/rafa-core': 'workspace:*' } }));

    const { code, lines } = run(root);

    expect(allReasons(checkGraph(root))).toEqual([
      'packages/plugin: depends on @open-tomato/rafa-core in dependencies, which is private and never publishes',
    ]);
    expect(code).toBe(1);
    expect(lines).toContain(
      'packages/plugin (@open-tomato/rafa-plugin): depends on @open-tomato/rafa-core in dependencies, which is private and never publishes',
    );
  });

  test('a private member in peerDependencies or optionalDependencies is refused too, and in devDependencies is not', () => {
    const root = plantWith(plugin({
      peerDependencies: { '@open-tomato/rafa-svc': 'workspace:*' },
      optionalDependencies: { '@open-tomato/rafa-config': 'workspace:*' },
      devDependencies: { '@open-tomato/rafa-core': 'workspace:*' },
    }));

    expect(reasonsOf(checkGraph(root), PLUGIN_DIR)).toEqual([
      'depends on @open-tomato/rafa-svc in peerDependencies, which is private and never publishes',
      'depends on @open-tomato/rafa-config in optionalDependencies, which is private and never publishes',
    ]);
  });

  test('an import of @open-tomato/rafa/store with no peer is refused once, and never as an undeclared rafa-core', () => {
    const code = 'import type { store } from \'@open-tomato/rafa/store\';\nexport type Store = typeof store;\n';
    const linked = plantWith(plugin({ devDependencies: { '@open-tomato/rafa': 'workspace:*' } }, code));
    const undeclared = plantWith(plugin({}, code));

    const reason = 'imports @open-tomato/rafa, which peerDependencies does not name: src/index.ts (@open-tomato/rafa/store)';
    expect(reasonsOf(checkGraph(linked), PLUGIN_DIR)).toEqual([reason]);
    expect(reasonsOf(checkGraph(undeclared), PLUGIN_DIR)).toEqual([reason]);
  });

  test('an import of a subpath the root exports do not name is refused, naming the file and the specifier', () => {
    const root = plantWith(plugin(PEER_FIELDS, 'export * from \'@open-tomato/rafa/effort/store/index\';\n'));

    expect(reasonsOf(checkGraph(root), PLUGIN_DIR)).toEqual([
      'src/index.ts imports @open-tomato/rafa/effort/store/index, whose ./effort/store/index the root package.json exports do not name',
    ]);
  });

  test('an import of a private member by name is refused, naming the file and the specifier', () => {
    const root = plantWith(plugin(
      { ...PEER_FIELDS, devDependencies: { '@open-tomato/rafa': 'workspace:*', '@open-tomato/rafa-core': 'workspace:*' } },
      'import { store } from \'@open-tomato/rafa-core\';\nexport { store };\n',
    ));

    expect(reasonsOf(checkGraph(root), PLUGIN_DIR)).toEqual([
      'src/index.ts imports @open-tomato/rafa-core, which names @open-tomato/rafa-core, a private member that never publishes',
    ]);
  });

  test('control: a member with the peer, exported subpaths and a private devDependency holds, exit 0', () => {
    const root = plantWith(plugin(
      { ...PEER_FIELDS, devDependencies: { '@open-tomato/rafa': 'workspace:*', '@open-tomato/rafa-config': 'workspace:*' } },
      [
        'import type { store } from \'@open-tomato/rafa/store\';',
        'import type { Config } from \'@open-tomato/rafa/config\';',
        'import type { main } from \'@open-tomato/rafa\';',
        'export type Parts = [typeof store, Config, typeof main];',
        '',
      ].join('\n'),
    ));

    const { code, lines } = run(root);

    expect(allReasons(checkGraph(root))).toEqual([]);
    expect(code).toBe(0);
    expect(lines).toContain('packages/plugin (@open-tomato/rafa-plugin): ok');
  });

  test('control: the same breaches in a private member are not the publish rules\' to refuse', () => {
    const root = plantWith(plugin(
      { private: true, dependencies: { '@open-tomato/rafa-core': 'workspace:*' } },
      'export * from \'@open-tomato/rafa/store\';\n',
    ));

    expect(reasonsOf(checkGraph(root), PLUGIN_DIR)).toEqual([]);
  });

  test('control: the live tree still holds', () => {
    const report = checkGraph(fileURLToPath(new URL('../../', import.meta.url)));

    expect(allReasons(report)).toEqual([]);
    expect(report.members.length).toBeGreaterThan(0);
  });
});

describe('main over one planted root, before and after the fix', () => {
  test('a publishable member depending on rafa-core exits 1 with the refusal line; the peer entry instead exits 0', () => {
    const refusal = 'packages/plugin (@open-tomato/rafa-plugin): depends on @open-tomato/rafa-core in dependencies, which is private and never publishes';
    const root = plantWith(plugin({ dependencies: { '@open-tomato/rafa-core': 'workspace:*' } }));

    const refused = run(root);

    expect(refused.code).toBe(1);
    expect(refused.lines).toContain(refusal);

    writeFileSync(join(root, PLUGIN_DIR, 'package.json'), `${JSON.stringify({
      name: '@open-tomato/rafa-plugin',
      scripts: { lint: 'eslint .', test: 'bun test' },
      peerDependencies: { '@open-tomato/rafa': '>=0.46.0' },
    }, null, 2)}\n`);
    const fixed = run(root);

    expect(fixed.code).toBe(0);
    expect(fixed.lines).toContain('packages/plugin (@open-tomato/rafa-plugin): ok');
    expect(fixed.lines).not.toContain(refusal);
  });
});
