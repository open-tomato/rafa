/**
 * The rewire groups over a planted tree under `mkdtemp`, resolved by bun,
 * and a planted graph: the package's files by planted cut rules; the
 * importers with their statements and bindings, and the files that are
 * not importers (tests, test support, a bare or dynamic import, the
 * facade itself); the declaration roots of two planted tsconfig files;
 * and one importer per group, one in two groups, and a package with no
 * importer.
 */
import type { Importer } from './rewire-groups';
import type { CutRules } from '../survey/cut-table';
import type { ImportEdge } from '../survey/import-graph';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  groupImporters,
  isImporterCandidate,
  readDeclarationRoots,
  readGraphEdges,
  readImporters,
  readPackageFiles,
} from './rewire-groups';

/** Alpha is the target; beta moves before it, gamma after it. */
const RULES: CutRules = {
  packages: [
    { folders: ['src/beta/'], name: 'rafa-beta', named: [] },
    { folders: ['packages/rafa-alpha/', 'src/alpha/'], name: 'rafa-alpha', named: ['src/alpha-named.ts'] },
    { folders: ['src/gamma/'], name: 'rafa-gamma', named: [] },
    { folders: [], name: 'root', named: [] },
  ],
  rest: 'root',
  unassigned: [],
};

const ORDER: readonly string[] = ['rafa-beta', 'rafa-alpha', 'rafa-gamma'];

/** The planted tree: every file's text by its repository-relative path. */
const TREE: Readonly<Record<string, string>> = {
  'packages/rafa-alpha/index.ts': 'export { run } from \'../../src/alpha/run.js\';\n',
  'packages/rafa-alpha/package.json': '{ "name": "@open-tomato/rafa-alpha" }\n',
  'packages/rafa-alpha/tsconfig.types.json': '{\n  // core-like declarations\n  "include": ["src/declared.ts"],\n}\n',
  'scripts/tool.test.ts': 'import { run } from \'../src/alpha/run.js\';\n',
  'scripts/tool.ts': 'import { run } from \'../src/alpha/run.js\';\n\nrun();\n',
  'src/alpha-named.ts': 'export const NAMED = 1;\n',
  'src/alpha/run.test.ts': 'import { tested } from \'../tested-only.js\';\n',
  'src/alpha/run.ts': [
    'import { middle } from \'../middle.js\';',
    '',
    'export type Mode = \'fast\' | \'slow\';',
    'export function run(): number {',
    '  return middle();',
    '}',
    'export default run;',
    '',
  ].join('\n'),
  'src/alpha/shape.ts': 'export interface Shape { readonly size: number }\n',
  'src/beta/both.ts': 'import { run } from \'../alpha/run.js\';\n\nexport const both = run;\n',
  'src/beta/declared.ts': 'import type { Shape } from \'../alpha/shape.js\';\n\nexport type Declared = Shape;\n',
  'src/beta/early.ts': 'import { run } from \'../alpha/run.js\';\n\nexport const early = run;\n',
  'src/cycle.ts': 'import { run } from \'./alpha/run.js\';\n\nexport const cycle = (): number => run();\n',
  'src/dynamic.ts': 'export const later = async (): Promise<unknown> => import(\'./alpha/run.js\');\n',
  'src/facade-user.ts': 'import { run } from \'@open-tomato/rafa-alpha\';\n\nrun();\n',
  'src/gamma/late.ts': 'import type { Shape } from \'../alpha/shape.js\';\n\nexport type Late = Shape;\n',
  'src/middle.ts': 'import { cycle } from \'./cycle.js\';\n\nexport const middle = (): number => cycle();\n',
  'src/plain.test.ts': 'import { run } from \'./alpha/run.js\';\n',
  'src/plain.ts': [
    '/** A file with every shape of statement. */',
    'import type { Shape } from \'./alpha/shape.js\';',
    'import { readFileSync } from \'node:fs\';',
    '',
    'import run, { type Mode, run as runAgain } from \'./alpha/run.js\';',
    'import \'./alpha/shape.js\';',
    'import { NAMED } from \'./alpha-named.js\';',
    'import { cycle } from \'./cycle.js\';',
    '',
    'export { run as rerun } from \'./alpha/run.js\';',
    'export type { Shape as Outline } from \'./alpha/shape.js\';',
    'export const all = [readFileSync, run, runAgain, NAMED, cycle];',
    'export type Both = [Shape, Mode];',
    '',
  ].join('\n'),
  'src/tested-only.ts': 'import { run } from \'./alpha/run.js\';\n\nexport const tested = run;\n',
  'src/tests/helper.ts': 'import { run } from \'../alpha/run.js\';\n\nexport const helper = run;\n',
  'src/types/index.ts': 'export * from \'./use.js\';\nexport type { Declared } from \'../beta/declared.js\';\n',
  'src/types/use.ts': 'import type { Shape } from \'../alpha/shape.js\';\n\nexport type Use = Shape;\n',
  'tsconfig.config-types.json': '{ "include": ["src/types/index.ts"] }\n',
};

const CONFIGS: readonly string[] = ['tsconfig.config-types.json', 'packages/rafa-alpha/tsconfig.types.json'];

/** The planted graph, as the survey would read the tree. */
const EDGES: readonly ImportEdge[] = [
  { from: 'src/alpha/run.ts', kind: 'value', to: 'src/middle.ts' },
  { from: 'src/middle.ts', kind: 'value', to: 'src/cycle.ts' },
  { from: 'src/middle.ts', kind: 'value', to: 'src/beta/both.ts' },
  { from: 'src/cycle.ts', kind: 'value', to: 'src/alpha/run.ts' },
  { from: 'src/beta/both.ts', kind: 'value', to: 'src/alpha/run.ts' },
  { from: 'src/alpha/run.test.ts', kind: 'value', to: 'src/tested-only.ts' },
  { from: 'src/alpha/run.ts', kind: 'type', to: 'src/gamma/late.ts' },
  { from: 'src/types/index.ts', kind: 'value', to: 'src/types/use.ts' },
  { from: 'src/types/index.ts', kind: 'type', to: 'src/beta/declared.ts' },
  { from: 'src/types/use.ts', kind: 'type', to: 'src/alpha/shape.ts' },
];

const PATHS: readonly string[] = Object.keys(TREE);

let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'rewire-groups-'));
  for (const [path, text] of Object.entries(TREE)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  writeFileSync(join(root, 'graph.json'), JSON.stringify({ edges: EDGES, nodes: [] }));
});

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

/** The paths of a list of importers. */
function pathsOf(importers: readonly Importer[]): string[] {
  return importers.map((importer) => importer.path);
}

/** The package files and importers of `rafa-alpha` in the planted tree. */
function alphaImporters(): { packageFiles: string[]; importers: Importer[] } {
  const packageFiles = readPackageFiles(PATHS, 'rafa-alpha', RULES);
  return { importers: readImporters(root, PATHS, packageFiles), packageFiles };
}

describe('readPackageFiles', () => {
  it('keeps the code files the rules put in the package, tests and the facade included', () => {
    expect(readPackageFiles(PATHS, 'rafa-alpha', RULES)).toEqual([
      'packages/rafa-alpha/index.ts',
      'src/alpha-named.ts',
      'src/alpha/run.test.ts',
      'src/alpha/run.ts',
      'src/alpha/shape.ts',
    ]);
  });

  it('gives nothing for a package no rule holds a file in', () => {
    expect(readPackageFiles(PATHS, 'rafa-delta', RULES)).toEqual([]);
  });
});

describe('isImporterCandidate', () => {
  it('reads a source file under src/, scripts/ and packages/ and no test or test support', () => {
    expect(isImporterCandidate('src/plain.ts')).toBe(true);
    expect(isImporterCandidate('scripts/tool.ts')).toBe(true);
    expect(isImporterCandidate('packages/rafa/src/core/a.ts')).toBe(true);
    expect(isImporterCandidate('src/plain.test.ts')).toBe(false);
    expect(isImporterCandidate('scripts/tool.test.ts')).toBe(false);
    expect(isImporterCandidate('src/tests/helper.ts')).toBe(false);
    expect(isImporterCandidate('eslint.config.mjs')).toBe(false);
    expect(isImporterCandidate('packages/rafa-alpha/package.json')).toBe(false);
  });
});

describe('readImporters', () => {
  it('names every file outside the package that imports a package file by relative path', () => {
    expect(pathsOf(alphaImporters().importers)).toEqual([
      'scripts/tool.ts',
      'src/beta/both.ts',
      'src/beta/declared.ts',
      'src/beta/early.ts',
      'src/cycle.ts',
      'src/gamma/late.ts',
      'src/plain.ts',
      'src/tested-only.ts',
      'src/types/use.ts',
    ]);
  });

  it('leaves out tests, test support, a bare import, a dynamic import and the facade', () => {
    const paths = pathsOf(alphaImporters().importers);

    for (const path of ['scripts/tool.test.ts', 'src/plain.test.ts', 'src/tests/helper.ts', 'src/facade-user.ts', 'src/dynamic.ts', 'packages/rafa-alpha/index.ts']) {
      expect(paths).not.toContain(path);
    }
  });

  it('gives each statement naming a package file with its place, form, target and bindings', () => {
    const text = TREE['src/plain.ts'] ?? '';
    const plain = alphaImporters().importers.find((importer) => importer.path === 'src/plain.ts');

    expect(plain?.statements.map(({ bindings, form, line, specifier, target, typeOnly }) => ({ bindings, form, line, specifier, target, typeOnly }))).toEqual([
      {
        bindings: [{ kind: 'type', local: 'Shape', name: 'Shape', shape: 'named' }],
        form: 'import',
        line: 2,
        specifier: './alpha/shape.js',
        target: 'src/alpha/shape.ts',
        typeOnly: true,
      },
      {
        bindings: [
          { kind: 'value', local: 'run', name: 'default', shape: 'named' },
          { kind: 'type', local: 'Mode', name: 'Mode', shape: 'named' },
          { kind: 'value', local: 'runAgain', name: 'run', shape: 'named' },
        ],
        form: 'import',
        line: 5,
        specifier: './alpha/run.js',
        target: 'src/alpha/run.ts',
        typeOnly: false,
      },
      { bindings: [], form: 'import', line: 6, specifier: './alpha/shape.js', target: 'src/alpha/shape.ts', typeOnly: false },
      {
        bindings: [{ kind: 'value', local: 'NAMED', name: 'NAMED', shape: 'named' }],
        form: 'import',
        line: 7,
        specifier: './alpha-named.js',
        target: 'src/alpha-named.ts',
        typeOnly: false,
      },
      {
        bindings: [{ kind: 'value', local: 'rerun', name: 'run', shape: 'named' }],
        form: 'export',
        line: 10,
        specifier: './alpha/run.js',
        target: 'src/alpha/run.ts',
        typeOnly: false,
      },
      {
        bindings: [{ kind: 'type', local: 'Outline', name: 'Shape', shape: 'named' }],
        form: 'export',
        line: 11,
        specifier: './alpha/shape.js',
        target: 'src/alpha/shape.ts',
        typeOnly: true,
      },
    ]);
    for (const statement of plain?.statements ?? []) {
      expect(text.slice(statement.start, statement.end)).toBe(statement.text);
    }
    expect(plain?.statements[0]?.text).toBe('import type { Shape } from \'./alpha/shape.js\';');
  });
});

describe('readDeclarationRoots', () => {
  it('reads each include file against its config folder, comments and trailing commas allowed', () => {
    expect(readDeclarationRoots(root, CONFIGS)).toEqual(['packages/rafa-alpha/src/declared.ts', 'src/types/index.ts']);
  });

  it('refuses an include entry that is a pattern, naming the config', () => {
    writeFileSync(join(root, 'glob.json'), '{ "include": ["src/**/*.ts"] }');

    expect(() => readDeclarationRoots(root, ['glob.json'])).toThrow('glob.json: include entry src/**/*.ts is not a code file');
  });

  it('refuses a config with no include list', () => {
    writeFileSync(join(root, 'bare.json'), '{ "compilerOptions": {} }');

    expect(() => readDeclarationRoots(root, ['bare.json'])).toThrow('bare.json: no include list of strings');
  });
});

describe('readGraphEdges', () => {
  it('reads the edges of a graph file named relative to the root', () => {
    expect(readGraphEdges(root, 'graph.json')).toEqual([...EDGES]);
  });
});

describe('groupImporters', () => {
  /** The planted groups of `rafa-alpha`. */
  function alphaGroups(): Record<string, string[]> {
    const { importers, packageFiles } = alphaImporters();
    const groups = groupImporters({
      declarationRoots: readDeclarationRoots(root, CONFIGS),
      edges: readGraphEdges(root, 'graph.json'),
      importers,
      moveOrder: ORDER,
      packageName: 'rafa-alpha',
      packageFiles,
      rules: RULES,
    });
    return {
      backEdge: pathsOf(groups.backEdge),
      declarationGraph: pathsOf(groups.declarationGraph),
      loadCycle: pathsOf(groups.loadCycle),
      rewire: pathsOf(groups.rewire),
    };
  }

  it('puts an importer the package reaches over value edges, through a file between, on a load cycle', () => {
    expect(alphaGroups().loadCycle).toContain('src/cycle.ts');
  });

  it('puts an importer in a package earlier in the move order on a back edge', () => {
    expect(alphaGroups().backEdge).toContain('src/beta/early.ts');
  });

  it('puts an importer reached from a declaration build include in the declaration graph', () => {
    expect(alphaGroups().declarationGraph).toEqual(['src/types/use.ts']);
  });

  it('leaves every other importer to rewire: a later package, a script, one only a package test or a type edge reaches', () => {
    expect(alphaGroups().rewire).toEqual(['scripts/tool.ts', 'src/gamma/late.ts', 'src/plain.ts', 'src/tested-only.ts']);
  });

  it('lists an importer in two groups under the first of load cycle, back edge, declaration graph', () => {
    const groups = alphaGroups();

    expect(groups.loadCycle).toEqual(['src/beta/both.ts', 'src/cycle.ts']);
    expect(groups.backEdge).toEqual(['src/beta/declared.ts', 'src/beta/early.ts']);
    expect(groups.declarationGraph).not.toContain('src/beta/declared.ts');
    expect(groups.backEdge).not.toContain('src/beta/both.ts');
  });

  it('gives four empty groups for a package with no importer', () => {
    const packageFiles = readPackageFiles(PATHS, 'rafa-gamma', RULES);
    const importers = readImporters(root, PATHS, packageFiles);

    expect(packageFiles).toEqual(['src/gamma/late.ts']);
    expect(importers).toEqual([]);
    expect(groupImporters({ declarationRoots: [], edges: EDGES, importers, moveOrder: ORDER, packageFiles, packageName: 'rafa-gamma', rules: RULES })).toEqual({
      backEdge: [],
      declarationGraph: [],
      loadCycle: [],
      rewire: [],
    });
  });

  it('refuses a package outside the move order', () => {
    expect(() => groupImporters({ declarationRoots: [], edges: [], importers: [], moveOrder: ORDER, packageFiles: [], packageName: 'rafa-delta', rules: RULES })).toThrow('rafa-delta is not in the move order');
  });
});
