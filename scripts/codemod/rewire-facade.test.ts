/**
 * The rewire codemod over planted trees under `mkdtemp`, each with a
 * planted facade, graph, cut rules and move order: the command line, the
 * four lists with their counts, the rewrite of the to-rewire group (the
 * merge into one value and one type statement, the elision and alias
 * rules, a default import and a default re-export by the facade's name, a
 * re-export kept a re-export), the two refusals writing nothing,
 * `--dry-run` writing nothing, and the other three groups left byte for
 * byte.
 */
import type { RewireOptions } from './rewire-facade';
import type { CutRules } from '../survey/cut-table';
import type { ImportEdge } from '../survey/import-graph';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';
import ts from 'typescript';

import {
  main,
  ONE_LINE_WIDTH,
  parseRewireArgs,
  readCompilerOptions,
  readKeptNames,
  renderStatement,
  REFUSED_EXIT,
  USAGE,
  USAGE_EXIT,
} from './rewire-facade';

/** Alpha is the target; beta moves before it. */
const RULES: CutRules = {
  packages: [
    { folders: ['src/beta/'], name: 'rafa-beta', named: [] },
    { folders: ['packages/rafa-alpha/', 'src/alpha/'], name: 'rafa-alpha', named: ['src/alpha-named.ts'] },
    { folders: [], name: 'root', named: [] },
  ],
  rest: 'root',
  unassigned: [],
};

const OPTIONS_BASE: Omit<RewireOptions, 'paths'> = {
  declarationConfigs: ['tsconfig.config-types.json'],
  moveOrder: ['rafa-beta', 'rafa-alpha'],
  rules: RULES,
};

const SPECIFIER = '@open-tomato/rafa-alpha';

/** The planted graph: run reaches cycle through middle; the declaration build reaches use. */
const EDGES: readonly ImportEdge[] = [
  { from: 'src/alpha/run.ts', kind: 'value', to: 'src/middle.ts' },
  { from: 'src/middle.ts', kind: 'value', to: 'src/cycle.ts' },
  { from: 'src/cycle.ts', kind: 'value', to: 'src/alpha/run.ts' },
  { from: 'src/types/index.ts', kind: 'value', to: 'src/types/use.ts' },
  { from: 'src/types/use.ts', kind: 'type', to: 'src/alpha/shape.ts' },
];

const PLAIN = [
  '/** Every shape of import. */',
  'import type { Shape } from \'./alpha/shape.js\';',
  'import { readFileSync } from \'node:fs\';',
  '',
  'import run, { type Mode, run as runAgain } from \'./alpha/run.js\';',
  'import { NAMED } from \'./alpha-named.js\';',
  'import { cycle } from \'./cycle.js\';',
  '',
  'export const all = [readFileSync, run, NAMED, cycle];',
  'export type Both = [Shape, Mode, typeof runAgain];',
  '',
].join('\n');

const REEXPORT = [
  'import { run } from \'./alpha/run.js\';',
  '',
  'export { run } from \'./alpha/run.js\';',
  'export { default as begin } from \'./alpha/run.js\';',
  'export type { Shape as Outline } from \'./alpha/shape.js\';',
  '',
  'export const twice = (): number => run() * 2;',
  '',
].join('\n');

/** The planted tree: every file's text by its repository-relative path. */
const TREE: Readonly<Record<string, string>> = {
  'graph.json': JSON.stringify({ edges: EDGES, nodes: [] }),
  'packages/rafa-alpha/index.ts': [
    'export { NAMED } from \'../../src/alpha-named.js\';',
    'export { default as start, run } from \'../../src/alpha/run.js\';',
    'export type { Mode } from \'../../src/alpha/run.js\';',
    'export type { Shape } from \'../../src/alpha/shape.js\';',
    '',
  ].join('\n'),
  'packages/rafa-alpha/package.json': `{ "name": "${SPECIFIER}" }\n`,
  'scripts/tool.ts': 'import { run } from \'../src/alpha/run.js\';\n\nrun();\n',
  'src/alpha-named.ts': 'export const NAMED = 1;\n',
  'src/alpha/run.ts': [
    'import { middle } from \'../middle.js\';',
    '',
    'export type Mode = \'fast\' | \'slow\';',
    'export const hidden = 0;',
    'export function run(): number {',
    '  return middle();',
    '}',
    'export default run;',
    '',
  ].join('\n'),
  'src/alpha/shape.ts': 'export interface Shape { readonly size: number }\n',
  'src/beta/early.ts': 'import { run } from \'../alpha/run.js\';\n\nexport const early = run;\n',
  'src/cycle.ts': 'import { run } from \'./alpha/run.js\';\n\nexport const cycle = (): number => run();\n',
  'src/middle.ts': 'import { cycle } from \'./cycle.js\';\n\nexport const middle = (): number => cycle();\n',
  'src/plain.ts': PLAIN,
  'src/reexport.ts': REEXPORT,
  'src/types/index.ts': 'export * from \'./use.js\';\n',
  'src/types/use.ts': 'import type { Shape } from \'../alpha/shape.js\';\n\nexport type Use = Shape;\n',
  'tsconfig.config-types.json': '{ "include": ["src/types/index.ts"] }\n',
  'tsconfig.json': '{ "compilerOptions": { "module": "ESNext", "moduleResolution": "bundler", "target": "ES2022", "isolatedModules": true, "strict": true } }\n',
};

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** Plants the tree, with files added or replaced, under a fresh folder. */
function plant(extra: Readonly<Record<string, string>> = {}): { root: string; tree: Record<string, string> } {
  const root = mkdtempSync(join(tmpdir(), 'rewire-facade-'));
  roots.push(root);
  const tree = { ...TREE, ...extra };
  for (const [path, text] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { root, tree };
}

/** Every planted file's text as it stands on disk. */
function onDisk(root: string, tree: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.keys(tree).map((path) => [path, readFileSync(join(root, path), 'utf8')]));
}

/** Runs the codemod over a planted tree. */
function run(root: string, tree: Readonly<Record<string, string>>, args: readonly string[]): ReturnType<typeof main> {
  return main(root, ['--package=rafa-alpha', '--graph=graph.json', ...args], { ...OPTIONS_BASE, paths: Object.keys(tree) });
}

const LISTS: readonly string[] = [
  'to rewire (3)',
  '  scripts/tool.ts',
  '  src/plain.ts',
  '  src/reexport.ts',
  'load cycle (1)',
  '  src/cycle.ts',
  'back edge (1)',
  '  src/beta/early.ts',
  'declaration graph (1)',
  '  src/types/use.ts',
];

describe('parseRewireArgs', () => {
  it('reads --package=rafa-<name> and --dry-run, the graph defaulting to the survey\'s', () => {
    expect(parseRewireArgs(['--package=rafa-effort'])).toEqual({ dryRun: false, graph: 'docs/survey/import-graph.json', packageName: 'rafa-effort' });
    expect(parseRewireArgs(['--dry-run', '--package=rafa-effort', '--graph=g.json'])).toEqual({ dryRun: true, graph: 'g.json', packageName: 'rafa-effort' });
  });

  it.each([
    [[], 'no --package= given'],
    [['--package=effort'], '--package=effort names no rafa-<name> package'],
    [['--package=rafa-effort', '--package=rafa-board'], 'refused argument --package=rafa-board'],
    [['--package=rafa-effort', '--dry-run', '--dry-run'], 'refused argument --dry-run'],
    [['--package=rafa-effort', '--write'], 'refused argument --write'],
    [['--package=rafa-effort', 'src/'], 'refused argument src/'],
    [['--package=rafa-effort', '--graph='], 'refused argument --graph='],
  ])('refuses %j with the usage', (args, reason) => {
    expect(() => parseRewireArgs(args)).toThrow(`${reason}\n${USAGE}`);
  });

  it('answers a refused command line with the usage on stderr, exit 2, writing nothing', () => {
    const { root, tree } = plant();

    const result = main(root, ['--package=rafa-alpha', '--force'], { ...OPTIONS_BASE, paths: Object.keys(tree) });

    expect(result).toEqual({ exitCode: USAGE_EXIT, stderr: [`refused argument --force\n${USAGE}`], stdout: [] });
    expect(onDisk(root, tree)).toEqual(tree);
  });
});

describe('readCompilerOptions and readKeptNames', () => {
  it('keeps the root options but moduleResolution, which transpileModule throws on for an aliased re-export', () => {
    const { root } = plant();
    const options = readCompilerOptions(root);
    const text = 'export { a as b } from \'./x.js\';\n';

    expect(options.module).toBe(ts.ModuleKind.ESNext);
    expect(options.isolatedModules).toBe(true);
    expect(options.moduleResolution).toBeUndefined();
    expect(readKeptNames('src/x.ts', text, options)).toEqual(new Set(['b']));
    expect(() => ts.transpileModule(text, { compilerOptions: { ...options, moduleResolution: ts.ModuleResolutionKind.Bundler }, fileName: 'src/x.ts' })).toThrow();
  });

  it('drops a binding used only as a type and keeps one used as a value', () => {
    const { root } = plant();

    expect(readKeptNames('src/plain.ts', PLAIN, readCompilerOptions(root))).toEqual(new Set(['readFileSync', 'run', 'NAMED', 'cycle']));
  });
});

describe('renderStatement', () => {
  it('writes one line within the width and one binding per line past it', () => {
    const short = [{ local: 'run', name: 'run' }, { local: 'collectSessions', name: 'collect' }];
    const long = Array.from({ length: 8 }, (_, index) => ({ local: `bindingNumber${index}`, name: `bindingNumber${index}` }));

    expect(renderStatement('import', false, short, SPECIFIER)).toBe('import { run, collect as collectSessions } from \'@open-tomato/rafa-alpha\';');
    expect(renderStatement('export', true, short, SPECIFIER)).toBe('export type { run, collect as collectSessions } from \'@open-tomato/rafa-alpha\';');
    expect(renderStatement('import', false, long, SPECIFIER).split('\n')).toEqual([
      'import {',
      ...long.map((element) => `  ${element.name},`),
      '} from \'@open-tomato/rafa-alpha\';',
    ]);
    expect(`import { ${long.map((element) => element.name).join(', ')} } from '${SPECIFIER}';`.length).toBeGreaterThan(ONE_LINE_WIDTH);
  });
});

describe('main', () => {
  it('prints the four lists sorted under their headings with counts, in the group order', () => {
    const { root, tree } = plant();

    const result = run(root, tree, ['--dry-run']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toEqual([...LISTS, 'dry run, nothing written.']);
  });

  it('writes nothing on --dry-run', () => {
    const { root, tree } = plant();

    run(root, tree, ['--dry-run']);

    expect(onDisk(root, tree)).toEqual(tree);
  });

  it('merges an importer\'s imports into one type and one value statement, by elision, aliased, a default by the facade\'s name', () => {
    const { root, tree } = plant();

    const result = run(root, tree, []);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.at(-1)).toBe('wrote 3 file(s).');
    expect(readFileSync(join(root, 'src/plain.ts'), 'utf8')).toBe([
      '/** Every shape of import. */',
      'import type { Mode, Shape, run as runAgain } from \'@open-tomato/rafa-alpha\';',
      'import { NAMED, start as run } from \'@open-tomato/rafa-alpha\';',
      'import { readFileSync } from \'node:fs\';',
      '',
      'import { cycle } from \'./cycle.js\';',
      '',
      'export const all = [readFileSync, run, NAMED, cycle];',
      'export type Both = [Shape, Mode, typeof runAgain];',
      '',
    ].join('\n'));
    expect(readFileSync(join(root, 'scripts/tool.ts'), 'utf8')).toBe('import { run } from \'@open-tomato/rafa-alpha\';\n\nrun();\n');
  });

  it('rewrites an export … from as a re-export of the facade, a default by the facade\'s name, never folded into the import', () => {
    const { root, tree } = plant();

    run(root, tree, []);

    expect(readFileSync(join(root, 'src/reexport.ts'), 'utf8')).toBe([
      'import { run } from \'@open-tomato/rafa-alpha\';',
      '',
      'export type { Shape as Outline } from \'@open-tomato/rafa-alpha\';',
      'export { run, start as begin } from \'@open-tomato/rafa-alpha\';',
      '',
      'export const twice = (): number => run() * 2;',
      '',
    ].join('\n'));
  });

  it('leaves the load cycle, back edge and declaration graph importers byte for byte', () => {
    const { root, tree } = plant();

    run(root, tree, []);
    const after = onDisk(root, tree);

    for (const path of ['src/cycle.ts', 'src/beta/early.ts', 'src/types/use.ts']) {
      expect(after[path]).toBe(tree[path] ?? '');
    }
    expect(after['src/plain.ts']).not.toBe(tree['src/plain.ts'] ?? '');
  });

  it.each([
    [
      'a binding the facade does not export',
      'src/hidden.ts',
      'import { hidden } from \'./alpha/run.js\';\n\nexport const shown = hidden;\n',
      'src/hidden.ts:1: the facade exports no hidden of src/alpha/run.ts: import { hidden } from \'./alpha/run.js\';',
    ],
    [
      'a namespace import',
      'src/whole.ts',
      'import * as alpha from \'./alpha/run.js\';\n\nexport const whole = alpha.run;\n',
      'src/whole.ts:1: a namespace * as alpha of src/alpha/run.ts cannot come from the facade: import * as alpha from \'./alpha/run.js\';',
    ],
  ])('refuses %s, naming the importer, the binding and the statement, and writes nothing at all', (_case, path, text, line) => {
    const { root, tree } = plant({ [path]: text });

    const result = run(root, tree, []);

    expect(result.exitCode).toBe(REFUSED_EXIT);
    expect(result.stdout.slice(-3)).toEqual(['refused (1)', `  ${line}`, 'refused, nothing written.']);
    expect(onDisk(root, tree)).toEqual(tree);
  });

  it('lists a refusal the same way on --dry-run', () => {
    const { root, tree } = plant({ 'src/whole.ts': 'import * as alpha from \'./alpha/run.js\';\n\nexport const whole = alpha.run;\n' });

    const result = run(root, tree, ['--dry-run']);

    expect(result.exitCode).toBe(REFUSED_EXIT);
    expect(result.stdout.slice(-3)).toEqual([
      'refused (1)',
      '  src/whole.ts:1: a namespace * as alpha of src/alpha/run.ts cannot come from the facade: import * as alpha from \'./alpha/run.js\';',
      'dry run, nothing written.',
    ]);
    expect(onDisk(root, tree)).toEqual(tree);
  });
});
