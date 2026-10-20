/**
 * The reader over a planted tree with its own cut rules, the pure
 * renderer, and the command line. The live reading of this repository
 * is `facade-names.sweep.test.ts`.
 */
import type { CutRules } from './cut-table';
import type { FacadeName, FacadeReading } from './facade-names';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { facadeFolder, main, readFacadeNames, renderFacadeEntry, renderProblem } from './facade-names';

/** The planted rules: one package with a folder and a named file, the rest, and an unassigned folder. */
const RULES: CutRules = {
  packages: [
    { folders: ['src/pkg/'], name: 'rafa-pkg', named: ['src/named.ts'] },
    { folders: ['src/cli/'], name: 'rafa-cli', named: [] },
  ],
  rest: 'rafa-cli',
  unassigned: ['src/loose/'],
};

const COMPILER_OPTIONS = {
  module: 'ESNext',
  moduleResolution: 'bundler',
  noEmit: true,
  strict: true,
  target: 'ES2022',
  types: [],
};

/**
 * The planted tree. `src/pkg/` is the package, with its own index
 * re-exporting two names of `a.ts`; `src/named.ts` is the package's by
 * name. The outside importers are `src/user.ts` (the rest), `src/loose/`
 * (unassigned) and `scripts/tool.ts`; `src/pkg/inner.ts`,
 * `src/tests/helper.ts` and `src/user.test.ts` import `secret` and are set
 * aside, so `secret` is no name.
 */
const TREE: Readonly<Record<string, string>> = {
  'scripts/tool.ts': [
    'import { answer } from \'../src/pkg/a.js\';',
    'import { other as renamed } from \'../src/pkg/b.js\';',
    '',
    'export { default as runner } from \'../src/pkg/a.js\';',
    'export const total = answer + renamed;',
  ].join('\n'),
  'src/core/base.ts': 'export const baseValue = 1;\n',
  'src/loose/other.ts': [
    'import anon from \'../pkg/b.js\';',
    'import { answer } from \'../pkg/b.js\';',
    'import * as space from \'../pkg/space.js\';',
    '',
    'export { other } from \'../pkg/b.js\';',
    'export * from \'../pkg/star.js\';',
    'export const all = [anon, answer, space];',
    'export async function load(): Promise<unknown> {',
    '  return import(\'../pkg/lazy.js\');',
    '}',
  ].join('\n'),
  'src/named.ts': 'export const namedThing = 1;\n',
  'src/pkg/a.ts': [
    'export interface Shape { size: number }',
    'export type Alias = string;',
    'export class Widget {}',
    'export const answer = 42;',
    'export const secret = 2;',
    'export function helper(): number {',
    '  return 1;',
    '}',
    'export default function run(): void {}',
  ].join('\n'),
  'src/pkg/b.ts': [
    'export const answer = 7;',
    'export const other = 1;',
    'export default function (): void {}',
  ].join('\n'),
  'src/pkg/index.ts': [
    'export { helper } from \'./a.js\';',
    'export type { Shape } from \'./a.js\';',
  ].join('\n'),
  'src/pkg/inner.ts': 'import { secret } from \'./a.js\';\n\nexport const inner = secret;\n',
  'src/pkg/lazy.ts': 'export const lazy = 1;\n',
  'src/pkg/reexport.ts': 'export { baseValue } from \'../core/base.js\';\n',
  'src/pkg/space.ts': 'export const spaced = 1;\n',
  'src/pkg/star.ts': 'export const starred = 1;\n',
  'src/tests/helper.ts': 'import { secret } from \'../pkg/a.js\';\n\nexport const helped = secret;\n',
  'src/user.test.ts': 'import { secret } from \'./pkg/a.js\';\n\nexport const tested = secret;\n',
  'src/user.ts': [
    'import type { Alias, Shape, Widget } from \'./pkg/a.js\';',
    '',
    'import { namedThing } from \'./named.js\';',
    'import run, { helper as h } from \'./pkg/a.js\';',
    'import { baseValue } from \'./pkg/reexport.js\';',
    '',
    'export const used = [run, h, baseValue, namedThing];',
    'export type Used = Alias | Shape | Widget;',
  ].join('\n'),
  'tsconfig.json': JSON.stringify({
    compilerOptions: COMPILER_OPTIONS,
    exclude: ['**/*.test.ts'],
    include: ['src', 'scripts'],
  }),
  'tsconfig.scripts.json': JSON.stringify({ compilerOptions: COMPILER_OPTIONS, include: ['scripts'] }),
};

/** A name entry with the fields a case does not vary. */
function entry(name: string, fields: Partial<FacadeName>): FacadeName {
  return {
    declaredIn: 'src/pkg/a.ts',
    exportedBy: 'src/pkg/a.ts',
    importers: ['src/user.ts'],
    kind: 'value',
    name,
    viaDefault: false,
    ...fields,
  };
}

let root = '';
let reading: FacadeReading;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'facade-names-'));
  for (const [path, text] of Object.entries(TREE)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  reading = readFacadeNames(root, 'rafa-pkg', { rules: RULES });
});

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('readFacadeNames over a planted tree', () => {
  it('reads every name an outside file imports, sorted by code unit', () => {
    expect(reading.package).toBe('rafa-pkg');
    expect(reading.names).toEqual([
      entry('Alias', { kind: 'type' }),
      entry('Shape', { exportedBy: 'src/pkg/index.ts', kind: 'type' }),
      entry('Widget', {}),
      entry('baseValue', { declaredIn: 'src/core/base.ts', exportedBy: 'src/pkg/reexport.ts' }),
      entry('helper', { exportedBy: 'src/pkg/index.ts' }),
      entry('namedThing', { declaredIn: 'src/named.ts', exportedBy: 'src/named.ts' }),
      entry('other', {
        declaredIn: 'src/pkg/b.ts',
        exportedBy: 'src/pkg/b.ts',
        importers: ['scripts/tool.ts', 'src/loose/other.ts'],
      }),
      entry('run', { importers: ['scripts/tool.ts', 'src/user.ts'], viaDefault: true }),
    ]);
  });

  it('reads a class taken by `import type` as a value, off the symbol', () => {
    expect(reading.names.find((name) => name.name === 'Widget')?.kind).toBe('value');
  });

  it('leaves out what the package, a test and a test-support file import', () => {
    expect(reading.names.map((name) => name.name)).not.toContain('secret');
    expect(reading.names.flatMap((name) => name.importers)).not.toContain('src/pkg/inner.ts');
  });

  it('names each problem: an anonymous default, a collision and two namespace imports', () => {
    expect(reading.problems.map((problem) => problem.kind)).toEqual([
      'anonymous-default',
      'collision',
      'namespace-import',
      'namespace-import',
    ]);
    expect(reading.problems[0]).toEqual({ importer: 'src/loose/other.ts', kind: 'anonymous-default', target: 'src/pkg/b.ts' });
    expect(reading.problems.slice(2)).toEqual([
      { importer: 'src/loose/other.ts', kind: 'namespace-import', target: 'src/pkg/space.ts' },
      { importer: 'src/loose/other.ts', kind: 'namespace-import', target: 'src/pkg/star.ts' },
    ]);
  });

  it('names both declarations of a collision and records no name for it', () => {
    const collision = reading.problems[1];
    expect(collision?.kind).toBe('collision');
    if (collision?.kind !== 'collision') {
      return;
    }
    expect(collision.name).toBe('answer');
    expect(collision.declarations.map(({ file, name }) => `${file}:${name}`)).toEqual([
      'src/pkg/a.ts:answer',
      'src/pkg/b.ts:answer',
    ]);
    expect(reading.names.map((name) => name.name)).not.toContain('answer');
  });

  it('lists a dynamic import into the package and makes it no problem', () => {
    expect(reading.dynamicImports).toEqual([{ importer: 'src/loose/other.ts', target: 'src/pkg/lazy.ts' }]);
  });

  it('reads the tsconfig an option names', () => {
    const scripts = readFacadeNames(root, 'rafa-pkg', { rules: RULES, tsconfig: 'tsconfig.scripts.json' });
    expect(scripts.names.map((name) => name.name)).toEqual(['answer', 'other', 'run']);
    expect(scripts.problems).toEqual([]);
  });

  it('refuses a package the rules do not hold', () => {
    expect(() => readFacadeNames(root, 'rafa-nope', { rules: RULES })).toThrow('no package named rafa-nope');
  });
});

describe('renderFacadeEntry', () => {
  const planted: FacadeReading = {
    dynamicImports: [],
    names: [
      entry('zeta', { exportedBy: 'src/pkg/z.mts' }),
      entry('Shape', { kind: 'type' }),
      entry('run', { viaDefault: true }),
      entry('Alias', { kind: 'type' }),
      entry('alpha', {}),
      entry('Only', { exportedBy: 'src/pkg/index.ts', kind: 'type' }),
    ],
    package: 'rafa-pkg',
    problems: [],
  };

  it('writes one group per file, types then values, names sorted, specifiers ending .js', () => {
    expect(renderFacadeEntry(planted, 'packages/rafa-pkg/')).toBe([
      '/**',
      ' * The facade of `rafa-pkg`: every name a file outside the',
      ' * package imports from it, re-exported from where it lives today.',
      ' * Written by `bun scripts/survey/facade-names.ts --package=rafa-pkg --entry`.',
      ' */',
      '',
      'export type {',
      '  Alias,',
      '  Shape,',
      '} from \'../../src/pkg/a.js\';',
      'export {',
      '  alpha,',
      '  default as run,',
      '} from \'../../src/pkg/a.js\';',
      '',
      'export type { Only } from \'../../src/pkg/index.js\';',
      '',
      'export { zeta } from \'../../src/pkg/z.mjs\';',
      '',
    ].join('\n'));
  });

  it('is pure: the same reading gives the same text, with or without the closing slash', () => {
    expect(renderFacadeEntry(planted, 'packages/rafa-pkg')).toBe(renderFacadeEntry(planted, 'packages/rafa-pkg/'));
  });

  it('names the facade folder by the package less its scope', () => {
    expect(facadeFolder('rafa-effort')).toBe('packages/rafa-effort/');
    expect(facadeFolder('@open-tomato/rafa-core')).toBe('packages/rafa-core/');
  });
});

describe('main over a planted tree', () => {
  it('prints one tab-separated line per name and the problems and dynamic imports on stderr', () => {
    const run = main(root, ['--package=rafa-pkg'], { rules: RULES });
    expect(run.exitCode).toBe(0);
    expect(run.stdout[0]).toBe('Alias\ttype\tsrc/pkg/a.ts\tsrc/pkg/a.ts');
    expect(run.stdout).toHaveLength(reading.names.length);
    expect(run.stderr).toEqual([
      ...reading.problems.map((problem) => `problem\t${renderProblem(problem)}`),
      'dynamic-import\tsrc/loose/other.ts\tsrc/pkg/lazy.ts',
    ]);
  });

  it('prints the reading as JSON with --json', () => {
    const run = main(root, ['--package=rafa-pkg', '--json'], { rules: RULES });
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout.join('\n'))).toEqual(JSON.parse(JSON.stringify(reading)));
  });

  it('refuses --entry with the problems on stderr when any exists', () => {
    const run = main(root, ['--package=rafa-pkg', '--entry'], { rules: RULES });
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr).toHaveLength(reading.problems.length);
  });

  it('prints the entry with --entry when no problem exists', () => {
    const run = main(root, ['--package=rafa-pkg', '--entry'], { rules: RULES, tsconfig: 'tsconfig.scripts.json' });
    expect(run.exitCode).toBe(0);
    expect(run.stdout.join('\n')).toContain('export {\n  answer,\n  default as run,\n} from \'../../src/pkg/a.js\';');
  });

  it.each([
    [['--package=rafa-nope'], 'no package named rafa-nope'],
    [[], 'no --package= given'],
    [['--package=rafa-pkg', '--json', '--entry'], '--json and --entry are one of'],
    [['--package=rafa-pkg', '--loud'], 'refused argument --loud'],
  ])('refuses %j on exit 1', (args, message) => {
    const run = main(root, args, { rules: RULES });
    expect(run.exitCode).toBe(1);
    expect(run.stderr.join('\n')).toContain(message);
  });
});
