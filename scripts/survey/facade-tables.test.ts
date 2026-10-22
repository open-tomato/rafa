/**
 * The facade tables over planted entry texts and a planted tree: the rows
 * of an entry by name, source, source name and kind; each refusal by
 * name, with a control that the same entry less the refused line parses;
 * the bindings an importer takes from one specifier; and the tables of a
 * planted tree under `mkdtemp`, resolved by bun.
 */
import type { FacadeRefusal } from './facade-tables';
import type { ResolveImport } from './import-graph';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { FacadeEntryError, parseFacadeEntry, readFacadeBindings, readFacadeTables } from './facade-tables';

const ENTRY = 'packages/rafa-alpha/index.ts';

/** Resolves `./x.js` against the importer's folder to `x.ts`; nothing else resolves. */
const plantedResolve: ResolveImport = (specifier, from) => (specifier.startsWith('.')
  ? posix.join(posix.dirname(from), specifier).replace(/\.js$/, '.ts')
  : undefined);

/** An entry of the facade form, each shape of re-export once. */
const FACADE_TEXT = [
  '/** The planted facade. */',
  '',
  'export type { Shape } from \'../../src/alpha/shape.js\';',
  'export {',
  '  answer,',
  '  default as run,',
  '  inner as outer,',
  '  type Mode,',
  '} from \'../../src/alpha/run.js\';',
  '',
].join('\n');

/** Parses `text` as the planted entry and returns the refusal it throws. */
function refusalOf(text: string): FacadeEntryError {
  try {
    parseFacadeEntry(text, ENTRY, plantedResolve);
  } catch (error) {
    if (error instanceof FacadeEntryError) {
      return error;
    }
    throw error;
  }
  throw new Error('the entry parsed with no refusal');
}

describe('parseFacadeEntry', () => {
  it('gives one row per re-exported name with its source, source name and kind', () => {
    expect(parseFacadeEntry(FACADE_TEXT, ENTRY, plantedResolve)).toEqual([
      { kind: 'type', name: 'Shape', source: 'src/alpha/shape.ts', sourceName: 'Shape' },
      { kind: 'value', name: 'answer', source: 'src/alpha/run.ts', sourceName: 'answer' },
      { kind: 'value', name: 'run', source: 'src/alpha/run.ts', sourceName: 'default' },
      { kind: 'value', name: 'outer', source: 'src/alpha/run.ts', sourceName: 'inner' },
      { kind: 'type', name: 'Mode', source: 'src/alpha/run.ts', sourceName: 'Mode' },
    ]);
  });

  it('gives no row for an entry holding comments only', () => {
    expect(parseFacadeEntry('/** Nothing yet. */\n', ENTRY, plantedResolve)).toEqual([]);
  });

  const refused: readonly (readonly [string, string, FacadeRefusal])[] = [
    ['export *', 'export * from \'../../src/alpha/run.js\';', 'export *'],
    ['export * as', 'export * as alpha from \'../../src/alpha/run.js\';', 'export *'],
    ['a local const', 'export const extra = 1;', 'local declaration'],
    ['a local function', 'function helper(): void {}', 'local declaration'],
    ['a local interface', 'export interface Local { a: number }', 'local declaration'],
    ['an export default', 'export default 1;', 'local declaration'],
    ['a side-effect import', 'import \'../../src/alpha/setup.js\';', 'side-effect import'],
    ['an import', 'import { answer } from \'../../src/alpha/run.js\';', 'import'],
    ['a local export', 'export { answer };', 'local export'],
    ['an expression', 'console.log(1);', 'statement'],
    ['a specifier resolving to nothing', 'export { gone } from \'bare-package\';', 'unresolved source'],
    ['a name exported twice', 'export { answer } from \'../../src/alpha/other.js\';', 'duplicate name'],
  ];

  for (const [label, line, refusal] of refused) {
    it(`refuses ${label} by name, on its line`, () => {
      const error = refusalOf(`${FACADE_TEXT}${line}\n`);
      expect(error.refusal).toBe(refusal);
      expect(error.entry).toBe(ENTRY);
      expect(error.line).toBe(FACADE_TEXT.split('\n').length);
      expect(error.message).toContain(`${ENTRY}:${error.line}: `);
      expect(error.message).toContain(`not ${refusal}`);
    });
  }

  it('parses the same entry less the refused line, so each refusal is the line\'s', () => {
    expect(() => parseFacadeEntry(FACADE_TEXT, ENTRY, plantedResolve)).not.toThrow();
  });
});

describe('readFacadeBindings', () => {
  const SPEC = '@open-tomato/rafa-alpha';

  it('gives each named binding with its local name and the kind per statement and per binding', () => {
    const text = [
      `import { answer, inner as mine, type Mode } from '${SPEC}';`,
      `import type { Shape, run as Run } from '${SPEC}';`,
    ].join('\n');
    expect(readFacadeBindings(text, SPEC)).toEqual([
      { kind: 'value', local: 'answer', name: 'answer', shape: 'named' },
      { kind: 'value', local: 'mine', name: 'inner', shape: 'named' },
      { kind: 'type', local: 'Mode', name: 'Mode', shape: 'named' },
      { kind: 'type', local: 'Shape', name: 'Shape', shape: 'named' },
      { kind: 'type', local: 'Run', name: 'run', shape: 'named' },
    ]);
  });

  it('reads a default import as the name default', () => {
    expect(readFacadeBindings(`import alpha, { answer } from '${SPEC}';\n`, SPEC)).toEqual([
      { kind: 'value', local: 'alpha', name: 'default', shape: 'named' },
      { kind: 'value', local: 'answer', name: 'answer', shape: 'named' },
    ]);
  });

  it('gives a namespace import its own shape', () => {
    expect(readFacadeBindings(`import * as alpha from '${SPEC}';\nimport type * as types from '${SPEC}';\n`, SPEC)).toEqual([
      { kind: 'value', local: 'alpha', shape: 'namespace' },
      { kind: 'type', local: 'types', shape: 'namespace' },
    ]);
  });

  it('reads export … from, export type … from, export * as and export *', () => {
    const text = [
      `export { answer as reply, default as run } from '${SPEC}';`,
      `export type { Shape } from '${SPEC}';`,
      `export * as alpha from '${SPEC}';`,
      `export * from '${SPEC}';`,
    ].join('\n');
    expect(readFacadeBindings(text, SPEC)).toEqual([
      { kind: 'value', local: 'reply', name: 'answer', shape: 'named' },
      { kind: 'value', local: 'run', name: 'default', shape: 'named' },
      { kind: 'type', local: 'Shape', name: 'Shape', shape: 'named' },
      { kind: 'value', local: 'alpha', shape: 'namespace' },
      { kind: 'value', shape: 'star' },
    ]);
  });

  it('takes nothing from a side-effect import or another specifier, and reads the specifier when present', () => {
    const text = [
      `import '${SPEC}';`,
      'import { answer } from \'@open-tomato/rafa-beta\';',
      `import { other } from '${SPEC}/sub';`,
    ].join('\n');
    expect(readFacadeBindings(text, SPEC)).toEqual([]);
    expect(readFacadeBindings(text, '@open-tomato/rafa-beta')).toEqual([
      { kind: 'value', local: 'answer', name: 'answer', shape: 'named' },
    ]);
  });
});

describe('readFacadeTables over a planted tree', () => {
  let root = '';

  /** Writes `text` at the repository-relative `path` under the planted root. */
  function plant(path: string, text: string): void {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'survey-facade-tables-'));
    plant('src/alpha/shape.ts', 'export interface Shape { size: number }\n');
    plant('src/alpha/run.ts', [
      'export type Mode = \'a\' | \'b\';',
      'export const answer = 42;',
      'export const inner = 1;',
      'export default function run(): void {}',
    ].join('\n'));
    plant(ENTRY, FACADE_TEXT);
    plant('packages/rafa-beta/index.ts', 'export { answer } from \'../../src/alpha/run.js\';\n');
    // A member with no entry, and an index outside the `rafa-` prefix: neither is a facade.
    plant('packages/rafa-hub/package.json', '{}\n');
    plant('packages/eslint-config/index.ts', 'export const rules = {};\n');
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('reads every rafa-* entry into a map keyed by entry path, resolved by bun', () => {
    const tables = readFacadeTables(root);
    expect([...tables.keys()]).toEqual([ENTRY, 'packages/rafa-beta/index.ts']);
    expect(tables.get(ENTRY)).toEqual(parseFacadeEntry(FACADE_TEXT, ENTRY, plantedResolve));
    expect(tables.get('packages/rafa-beta/index.ts')).toEqual([
      { kind: 'value', name: 'answer', source: 'src/alpha/run.ts', sourceName: 'answer' },
    ]);
  });

  it('refuses a planted entry that is not of the facade form', () => {
    plant('packages/rafa-gamma/index.ts', 'export * from \'../../src/alpha/run.js\';\n');
    try {
      expect(() => readFacadeTables(root)).toThrow('packages/rafa-gamma/index.ts:1: a facade entry holds re-exports only, not export *');
    } finally {
      rmSync(join(root, 'packages/rafa-gamma'), { force: true, recursive: true });
    }
  });

  it('gives an empty map for a tree with no packages folder', () => {
    const bare = mkdtempSync(join(tmpdir(), 'survey-facade-tables-bare-'));
    try {
      expect(readFacadeTables(bare).size).toBe(0);
    } finally {
      rmSync(bare, { force: true, recursive: true });
    }
  });
});
