/**
 * The facade checks over a planted tree: export equality green on a
 * matching entry and red, field by field, on an entry missing a name,
 * carrying an extra one and binding one to another declaration; the
 * fresh load green on a module that loads and red on one that throws; and
 * the workspace gates red over a root that holds no workspace. The live
 * gates over this repository are `facade-check.sweep.test.ts`.
 */
import type { CutRules } from './cut-table';
import type { FacadeReading } from './facade-names';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { compareFacade, findTsc, loadsFresh, readFacadeExports, workspaceGates } from './facade-check';
import { readFacadeNames, renderFacadeEntry } from './facade-names';

/** The planted rule: `src/pkg/` is the package, the rest is the CLI's. */
const RULES: CutRules = {
  packages: [
    { folders: ['src/pkg/'], name: 'rafa-pkg', named: [] },
    { folders: ['src/cli/'], name: 'rafa-cli', named: [] },
  ],
  rest: 'rafa-cli',
  unassigned: [],
};

/** The re-export lines each planted entry is built from, from `packages/<x>/`. */
const FROM_A = '\'../../src/pkg/a.js\'';
const FROM_B = '\'../../src/pkg/b.js\'';

/**
 * The planted tree: two package files that both declare `answer`, the one
 * outside importer, and the modules the fresh load imports. `unused` is
 * exported by `a.ts` and imported by no one.
 */
const TREE: Readonly<Record<string, string>> = {
  'loads/ok.ts': 'export const ok = 1;\n',
  'loads/throws.ts': 'throw new Error(\'planted top-level failure\');\n',
  'packages/extra/index.ts': [
    `export type { Shape } from ${FROM_A};`,
    `export { answer, default as run, unused } from ${FROM_A};`,
  ].join('\n'),
  'packages/misaligned/index.ts': [
    `export type { Shape } from ${FROM_A};`,
    `export { default as run } from ${FROM_A};`,
    `export { answer } from ${FROM_B};`,
  ].join('\n'),
  'packages/missing/index.ts': `export { answer, default as run } from ${FROM_A};\n`,
  'packages/type-as-value/index.ts': `export { Shape } from ${FROM_A};\n`,
  'packages/unresolved/index.ts': 'export { gone } from \'../../src/pkg/nowhere.js\';\n',
  'src/pkg/a.ts': [
    'export interface Shape { size: number }',
    'export const answer = 42;',
    'export const unused = 1;',
    'export default function run(): void {}',
  ].join('\n'),
  'src/pkg/b.ts': 'export const answer = 7;\n',
  'src/user.ts': [
    'import type { Shape } from \'./pkg/a.js\';',
    '',
    'import run, { answer } from \'./pkg/a.js\';',
    '',
    'export const used: Shape = { size: answer };',
    'run();',
  ].join('\n'),
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      module: 'ESNext',
      moduleResolution: 'bundler',
      noEmit: true,
      strict: true,
      target: 'ES2022',
      types: [],
    },
    include: ['src'],
  }),
};

let root = '';
let reading: FacadeReading;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'facade-check-'));
  for (const [path, text] of Object.entries(TREE)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  reading = readFacadeNames(root, 'rafa-pkg', { rules: RULES });
  mkdirSync(join(root, 'packages', 'rafa-pkg'), { recursive: true });
  writeFileSync(join(root, 'packages', 'rafa-pkg', 'index.ts'), renderFacadeEntry(reading, 'packages/rafa-pkg/'));
});

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('readFacadeExports and compareFacade over a planted facade', () => {
  it('reads the planted reading the comparison is held to', () => {
    expect(reading.names.map((name) => [name.name, name.kind, name.declaredIn])).toEqual([
      ['Shape', 'type', 'src/pkg/a.ts'],
      ['answer', 'value', 'src/pkg/a.ts'],
      ['run', 'value', 'src/pkg/a.ts'],
    ]);
    expect(reading.problems).toEqual([]);
  });

  it('reads each export of the rendered entry through to its declaration', () => {
    const exports = readFacadeExports(root, 'packages/rafa-pkg/index.ts');
    expect(exports.map((item) => [item.name, item.kind, item.declaredIn, item.declaredName])).toEqual([
      ['Shape', 'type', 'src/pkg/a.ts', 'Shape'],
      ['answer', 'value', 'src/pkg/a.ts', 'answer'],
      ['run', 'value', 'src/pkg/a.ts', 'run'],
    ]);
    expect(readFacadeExports(root, join(root, 'packages/rafa-pkg/index.ts'))).toEqual(exports);
  });

  it('is green on the matching entry', () => {
    expect(compareFacade(reading, readFacadeExports(root, 'packages/rafa-pkg/index.ts')))
      .toEqual({ extra: [], misaligned: [], missing: [] });
  });

  it('names a name the entry lacks under missing', () => {
    expect(compareFacade(reading, readFacadeExports(root, 'packages/missing/index.ts')))
      .toEqual({ extra: [], misaligned: [], missing: ['Shape'] });
  });

  it('names a name no outside importer uses under extra', () => {
    expect(compareFacade(reading, readFacadeExports(root, 'packages/extra/index.ts')))
      .toEqual({ extra: ['unused'], misaligned: [], missing: [] });
  });

  it('names a name bound to another declaration of the same name under misaligned', () => {
    expect(compareFacade(reading, readFacadeExports(root, 'packages/misaligned/index.ts'))).toEqual({
      extra: [],
      misaligned: [{
        actual: { declaredIn: 'src/pkg/b.ts', kind: 'value' },
        expected: { declaredIn: 'src/pkg/a.ts', kind: 'value' },
        name: 'answer',
      }],
      missing: [],
    });
  });

  it('refuses an export that resolves to no declaration, naming it', () => {
    expect(() => readFacadeExports(root, 'packages/unresolved/index.ts')).toThrow('the export gone resolves to no declaration');
  });

  it('refuses an entry that is not there', () => {
    expect(() => readFacadeExports(root, 'packages/absent/index.ts')).toThrow('not a module the program holds');
  });
});

describe('loadsFresh over planted modules', () => {
  it('is green on a module that loads, named by absolute path', () => {
    const run = loadsFresh(join(root, 'loads/ok.ts'), root);
    expect(run).toMatchObject({ exitCode: 0, green: true, stderr: '' });
  });

  it('is red on a module that throws at top level, with the message in stderr', () => {
    const run = loadsFresh(join(root, 'loads/throws.ts'), root);
    expect(run.exitCode).not.toBe(0);
    expect(run.green).toBe(false);
    expect(run.stderr).toContain('planted top-level failure');
  });

  it('loads the matching facade entry and refuses one that exports a type as a value', () => {
    expect(loadsFresh(join(root, 'packages/rafa-pkg/index.ts'), root).green).toBe(true);
    const typeAsValue = loadsFresh(join(root, 'packages/type-as-value/index.ts'), root);
    expect(typeAsValue.green).toBe(false);
    expect(typeAsValue.stderr).toContain('Shape');
  });
});

describe('workspaceGates over a planted root', () => {
  it('finds this repository\'s tsc and refuses a folder with none above it', () => {
    expect(findTsc(import.meta.dir)).toEndWith('/node_modules/.bin/tsc');
    expect(() => findTsc(root)).toThrow('no node_modules/.bin/tsc');
  });

  it('is red for both gates over a root that holds no workspace', () => {
    writeFileSync(join(root, 'package.json'), '{}\n');
    const gates = workspaceGates(root);
    expect(gates.graph.exitCode).toBe(1);
    expect(gates.graph.lines).toContain('root: package.json names no workspaces glob');
    expect(gates.references.exitCode).toBe(1);
    expect(gates.references.lines.some((line) => line.includes('TS5083'))).toBe(true);
    expect(gates.references.command.slice(1)).toEqual(['--build', 'tsconfig.references.json', '--pretty', 'false']);
  });
});
