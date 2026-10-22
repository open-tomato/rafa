/**
 * The facade checks over a planted tree: export equality, for the index
 * and for the commands entry beside it, green on a matching entry and red,
 * field by field, on an entry missing a name, carrying an extra one and
 * binding one to another declaration, and red when one entry is held to
 * the other's names; the fresh load green on a module that loads, the
 * commands entry by its package specifier among them, and red on one that
 * throws; and the workspace gates red over a root that holds no
 * workspace. The live gates over this repository are
 * `facade-check.sweep.test.ts`.
 */
import type { CutRules } from './cut-table';
import type { FacadeReading } from './facade-names';

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { compareFacade, findTsc, loadsFresh, readFacadeExports, workspaceGates } from './facade-check';
import { readFacadeNames, renderCommandsEntry, renderFacadeEntry } from './facade-names';

/** The planted rule: `src/pkg/` and its facade folder are the package, the rest is the CLI's. */
const RULES: CutRules = {
  packages: [
    { folders: ['src/pkg/', 'packages/rafa-pkg/'], name: 'rafa-pkg', named: [] },
    { folders: ['src/cli/'], name: 'rafa-cli', named: [] },
  ],
  rest: 'rafa-cli',
  unassigned: [],
};

/** The re-export lines each planted entry is built from, from `packages/<x>/`. */
const FROM_A = '\'../../src/pkg/a.js\'';
const FROM_B = '\'../../src/pkg/b.js\'';
const FROM_FEATURE = '\'../../src/pkg/feature.js\'';
const FROM_FEATURE_B = '\'../../src/pkg/feature-b.js\'';

/** The facade's name, as the roster spells it with `/commands`. */
const SPECIFIER = '@open-tomato/rafa-pkg';

/** The planted commands entry, as `--commands` writes it from the reading. */
const COMMANDS_TEXT = [
  '/**',
  ' * The commands entry of `rafa-pkg`: every name a file outside',
  ' * the package takes through it alone, re-exported from where it lives today.',
  ' * Written by `bun scripts/survey/facade-names.ts --package=rafa-pkg --commands`.',
  ' */',
  '',
  'export {',
  '  FEATURE,',
  '  TOOL_FEATURE,',
  `} from ${FROM_FEATURE};`,
  '',
].join('\n');

/**
 * The planted tree: two package files that both declare `answer`, and two
 * that both declare `FEATURE`; the outside importer by path, `user.ts`;
 * the roster, which takes the two features through the commands entry of
 * `packages/rafa-pkg/`; and the modules the fresh load imports. `unused`
 * and `unusedFeature` are exported and imported by no one. The facade's
 * index is written from the reading in `beforeAll`; the commands entry is
 * planted first, since the reading takes the roster's names through it.
 */
const TREE: Readonly<Record<string, string>> = {
  'loads/ok.ts': 'export const ok = 1;\n',
  'loads/throws.ts': 'throw new Error(\'planted top-level failure\');\n',
  'packages/commands-extra/commands.ts': `export { FEATURE, TOOL_FEATURE, unusedFeature } from ${FROM_FEATURE};\n`,
  'packages/commands-misaligned/commands.ts': [
    `export { FEATURE } from ${FROM_FEATURE_B};`,
    `export { TOOL_FEATURE } from ${FROM_FEATURE};`,
  ].join('\n'),
  'packages/commands-missing/commands.ts': `export { FEATURE } from ${FROM_FEATURE};\n`,
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
  'packages/rafa-pkg/commands.ts': COMMANDS_TEXT,
  'packages/rafa-pkg/package.json': JSON.stringify({
    exports: { '.': './index.ts', './commands': './commands.ts' },
    name: SPECIFIER,
    private: true,
  }),
  'packages/type-as-value/index.ts': `export { Shape } from ${FROM_A};\n`,
  'packages/unresolved/index.ts': 'export { gone } from \'../../src/pkg/nowhere.js\';\n',
  'src/pkg/a.ts': [
    'export interface Shape { size: number }',
    'export const answer = 42;',
    'export const unused = 1;',
    'export default function run(): void {}',
  ].join('\n'),
  'src/pkg/b.ts': 'export const answer = 7;\n',
  'src/pkg/feature-b.ts': 'export const FEATURE = { name: \'other\' };\n',
  'src/pkg/feature.ts': [
    'export const FEATURE = { name: \'pkg\' };',
    'export const TOOL_FEATURE = { name: \'tool\' };',
    'export const unusedFeature = 1;',
  ].join('\n'),
  'src/roster.ts': [
    `import { FEATURE, TOOL_FEATURE } from '${SPECIFIER}/commands';`,
    '',
    'export const features = [FEATURE, TOOL_FEATURE];',
  ].join('\n'),
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
  // Links the member under node_modules, as `bun install` links a workspace member.
  mkdirSync(join(root, 'node_modules/@open-tomato'), { recursive: true });
  symlinkSync('../../packages/rafa-pkg', join(root, 'node_modules', SPECIFIER));
  reading = readFacadeNames(root, 'rafa-pkg', { rules: RULES });
  writeFileSync(join(root, 'packages', 'rafa-pkg', 'index.ts'), renderFacadeEntry(reading, 'packages/rafa-pkg/'));
});

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('readFacadeExports and compareFacade over a planted facade', () => {
  it('reads the planted reading the comparison is held to, each name on its entry', () => {
    expect(reading.names.map((name) => [name.name, name.kind, name.declaredIn, name.entry])).toEqual([
      ['FEATURE', 'value', 'src/pkg/feature.ts', 'commands'],
      ['Shape', 'type', 'src/pkg/a.ts', 'index'],
      ['TOOL_FEATURE', 'value', 'src/pkg/feature.ts', 'commands'],
      ['answer', 'value', 'src/pkg/a.ts', 'index'],
      ['run', 'value', 'src/pkg/a.ts', 'index'],
    ]);
    expect(reading.problems).toEqual([]);
  });

  it('plants the commands entry the reading renders', () => {
    expect(renderCommandsEntry(reading, 'packages/rafa-pkg/')).toBe(COMMANDS_TEXT);
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
    expect(compareFacade(reading, readFacadeExports(root, 'packages/rafa-pkg/index.ts'), 'index'))
      .toEqual({ extra: [], misaligned: [], missing: [] });
  });

  it('names a name the entry lacks under missing', () => {
    expect(compareFacade(reading, readFacadeExports(root, 'packages/missing/index.ts'), 'index'))
      .toEqual({ extra: [], misaligned: [], missing: ['Shape'] });
  });

  it('names a name no outside importer uses under extra', () => {
    expect(compareFacade(reading, readFacadeExports(root, 'packages/extra/index.ts'), 'index'))
      .toEqual({ extra: ['unused'], misaligned: [], missing: [] });
  });

  it('names a name bound to another declaration of the same name under misaligned', () => {
    expect(compareFacade(reading, readFacadeExports(root, 'packages/misaligned/index.ts'), 'index')).toEqual({
      extra: [],
      misaligned: [{
        actual: { declaredIn: 'src/pkg/b.ts', kind: 'value' },
        expected: { declaredIn: 'src/pkg/a.ts', kind: 'value' },
        name: 'answer',
      }],
      missing: [],
    });
  });

  it('is green on the matching commands entry', () => {
    expect(compareFacade(reading, readFacadeExports(root, 'packages/rafa-pkg/commands.ts'), 'commands'))
      .toEqual({ extra: [], misaligned: [], missing: [] });
  });

  it('names a commands name the commands entry lacks under missing', () => {
    expect(compareFacade(reading, readFacadeExports(root, 'packages/commands-missing/commands.ts'), 'commands'))
      .toEqual({ extra: [], misaligned: [], missing: ['TOOL_FEATURE'] });
  });

  it('names a name the commands entry exports and no importer takes through it under extra', () => {
    expect(compareFacade(reading, readFacadeExports(root, 'packages/commands-extra/commands.ts'), 'commands'))
      .toEqual({ extra: ['unusedFeature'], misaligned: [], missing: [] });
  });

  it('names a commands name bound to another declaration of the same name under misaligned', () => {
    expect(compareFacade(reading, readFacadeExports(root, 'packages/commands-misaligned/commands.ts'), 'commands')).toEqual({
      extra: [],
      misaligned: [{
        actual: { declaredIn: 'src/pkg/feature-b.ts', kind: 'value' },
        expected: { declaredIn: 'src/pkg/feature.ts', kind: 'value' },
        name: 'FEATURE',
      }],
      missing: [],
    });
  });

  it('holds each entry to its own names alone: either entry is red against the other\'s, the control', () => {
    const index = readFacadeExports(root, 'packages/rafa-pkg/index.ts');
    const commands = readFacadeExports(root, 'packages/rafa-pkg/commands.ts');
    expect(compareFacade(reading, index, 'commands'))
      .toEqual({ extra: ['Shape', 'answer', 'run'], misaligned: [], missing: ['FEATURE', 'TOOL_FEATURE'] });
    expect(compareFacade(reading, commands, 'index'))
      .toEqual({ extra: ['FEATURE', 'TOOL_FEATURE'], misaligned: [], missing: ['Shape', 'answer', 'run'] });
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
    expect(loadsFresh(`${SPECIFIER}/commands`, root).green).toBe(true);
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
