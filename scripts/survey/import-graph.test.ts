import type { ImportGraphInput, Metafile, ResolveImport } from './import-graph';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  buildImportGraph,
  bunResolver,
  fileStem,
  main,
  nameClusters,
  readMetafile,
  renderImportGraphJson,
  renderImportGraphMarkdown,
  stableJson,
  surveyImportGraph,
  textImports,
} from './import-graph';

const ROOT = '/repo';

/** Resolves `./x.js` against the importer's folder to `x.ts`, the way bun maps a `.js` specifier. */
const plantedResolve: ResolveImport = (specifier, from) => (specifier.startsWith('.')
  ? posix.join(posix.dirname(from), specifier).replace(/\.js$/, '.ts')
  : undefined);

/** A source text importing each of `specifiers` by value. */
function valueImports(specifiers: readonly string[]): string {
  return specifiers.map((specifier, index) => `import { v${index} } from '${specifier}';\n`).join('');
}

/** Every relative specifier from `from` to each other member of `members`. */
function specifiersTo(from: string, members: readonly string[]): string[] {
  return members
    .filter((member) => member !== from)
    .map((member) => `./${posix.relative(posix.dirname(from), member).replace(/\.ts$/, '.js')}`)
    .map((specifier) => specifier.replace(/^\.\/\.\.\//, '../'));
}

// Two tight groups, each holding one file of `src/shared/`, joined by a
// single bridge. The folder `src/shared/` has to split across them.
const LEFT = ['src/left/a.ts', 'src/left/b.ts', 'src/left/c.ts', 'src/shared/left-end.ts'];
const RIGHT = ['src/right/x.ts', 'src/right/y.ts', 'src/right/z.ts', 'src/shared/right-end.ts'];
const TYPES = 'src/right/types.ts';
const ORPHAN = 'src/orphan/lonely.ts';

/** The planted repository: texts, a metafile listing every file but the orphan, and the resolver. */
function plantedInput(): ImportGraphInput {
  const sources = new Map<string, string>();
  const inputs: Record<string, { imports: { path: string; kind: string; external?: boolean }[] }> = {};
  for (const group of [LEFT, RIGHT]) {
    for (const from of group) {
      const specifiers = specifiersTo(from, group);
      sources.set(from, valueImports(specifiers));
      // Bun names a target that is itself an entry by the specifier as written.
      inputs[from] = { imports: specifiers.map((path) => ({ kind: 'import-statement', path })) };
    }
  }
  // The bridge, recorded the way bun records a target that is not an entry.
  sources.set('src/left/a.ts', `${sources.get('src/left/a.ts') ?? ''}import { r } from '../right/x.js';\n`);
  inputs['src/left/a.ts']?.imports.push({ kind: 'import-statement', path: `${ROOT}/src/right/x.ts` });
  // A type-only import bun leaves out of the metafile, and a package bun keeps external.
  sources.set('src/right/y.ts', `${sources.get('src/right/y.ts') ?? ''}import type { T } from './types.js';\nimport { z } from 'zod';\n`);
  inputs['src/right/y.ts']?.imports.push({ external: true, kind: 'import-statement', path: 'zod' });
  sources.set(TYPES, 'export type T = number;\n');
  inputs[TYPES] = { imports: [] };
  sources.set(ORPHAN, 'import { a } from \'../left/a.js\';\n');
  const metafile: Metafile = { inputs };
  return { files: [...LEFT, ...RIGHT, TYPES, ORPHAN], metafile, resolve: plantedResolve, root: ROOT, sources };
}

describe('the import graph over a planted repository', () => {
  const input = plantedInput();
  const survey = surveyImportGraph(buildImportGraph(input));
  const tracked = [...input.files].sort();

  it('splits one folder across two clusters, each named after its best-linked member', () => {
    const clusterOf = (path: string): string | undefined => survey.clusters.find((cluster) => cluster.members.includes(path))?.name;
    expect(clusterOf('src/shared/left-end.ts')).not.toBe(clusterOf('src/shared/right-end.ts'));
    const spanning = survey.clusters.filter((cluster) => cluster.folders['src/shared'] !== undefined);
    expect(spanning.map((cluster) => cluster.folders)).toEqual([
      { 'src/right': 4, 'src/shared': 1 },
      { 'src/left': 3, 'src/shared': 1 },
    ]);
    // The right group holds five files with `types.ts`, so it ranks first; `y.ts` has
    // one more in-cluster edge than its peers through the type import.
    expect(survey.clusters.map((cluster) => cluster.name)).toEqual(['c01-y', 'c02-a', 'c03-lonely']);
  });

  it('keeps a type-only import as a `type` edge, which the metafile does not record', () => {
    expect(input.metafile.inputs['src/right/y.ts']?.imports.map((item) => item.path)).not.toContain('./types.js');
    expect(survey.edges).toContainEqual({ from: 'src/right/y.ts', kind: 'type', to: TYPES });
    // The control: an import both readings see stays a `value` edge.
    expect(survey.edges).toContainEqual({ from: 'src/right/y.ts', kind: 'value', to: 'src/right/x.ts' });
    expect(survey.edges).toContainEqual({ from: 'src/left/a.ts', kind: 'value', to: 'src/right/x.ts' });
    expect(survey.edges.filter((edge) => edge.kind === 'type')).toHaveLength(1);
  });

  it('adds no edge to a target outside the scope', () => {
    expect(survey.edges.some((edge) => edge.to.includes('zod'))).toBe(false);
    expect(survey.unresolved).toEqual([{ from: 'src/right/y.ts', specifier: 'zod' }]);
  });

  it('keeps a file no entry reaches as a node, with no edge of its own, and names it unread', () => {
    expect(survey.nodes).toContain(ORPHAN);
    expect(survey.unreached).toEqual([ORPHAN]);
    // Its text imports `a.ts`, yet no edge leaves it: its value imports were never recorded.
    expect(survey.edges.some((edge) => edge.from === ORPHAN)).toBe(false);
    expect(survey.betweenness.get(ORPHAN)).toBe(0);
    const markdown = renderImportGraphMarkdown(survey, tracked);
    expect(markdown).toContain(`Coverage: 9 of 10 tracked files read (src/ and packages/*/src/). Not read: \`${ORPHAN}\`.`);
    expect(markdown).toContain('## Unreached files');
  });

  it('puts the bridge ends at the top of the betweenness table', () => {
    const markdown = renderImportGraphMarkdown(survey, tracked);
    const rows = markdown.split('\n').filter((line) => /^\| \d+ \|/.test(line));
    expect(rows.slice(0, 2).map((row) => row.split(' | ')[1])).toEqual(['`src/right/x.ts`', '`src/left/a.ts`']);
    expect(rows).toHaveLength(10);
  });

  it('writes JSON with every key sorted, each node carrying its cluster', () => {
    const json = renderImportGraphJson(survey);
    const parsed = JSON.parse(json) as { nodes: { cluster: string; path: string }[] };
    expect(Object.keys(JSON.parse(json) as object)).toEqual(['betweenness', 'clusters', 'edges', 'nodes', 'unreached', 'unresolved']);
    expect(parsed.nodes.find((node) => node.path === ORPHAN)).toEqual({ cluster: 'c03-lonely', kind: 'source', path: ORPHAN });
    expect(renderImportGraphJson(surveyImportGraph(buildImportGraph(plantedInput())))).toBe(json);
  });
});

describe('helpers', () => {
  it('reads every kind of import from a source text', () => {
    const text = 'import type { A } from \'./a.js\';\nexport { b } from \'./b.js\';\nconst c = await import(\'./c.js\');\n';
    expect(textImports(text)).toEqual(['./a.js', './b.js', './c.js']);
  });

  it('takes a stem by the code extension alone', () => {
    expect(fileStem('src/plan/parse.ts')).toBe('parse');
    expect(fileStem('src/a.test.ts')).toBe('a.test');
  });

  it('pads the rank to three digits once there are a hundred clusters', () => {
    const singles = Array.from({ length: 100 }, (_, index) => [`src/n${String(index).padStart(3, '0')}.ts`]);
    const names = nameClusters(singles, []).map((cluster) => cluster.name);
    expect(names[0]).toBe('c001-n000');
    expect(names[99]).toBe('c100-n099');
  });

  it('sorts keys at every depth', () => {
    expect(stableJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{\n  "a": [\n    {\n      "c": 3,\n      "d": 2\n    }\n  ],\n  "b": 1\n}\n');
  });
});

/** Runs git in a scratch repository and fails the test on a non-zero exit. */
function git(root: string, args: readonly string[]): void {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${result.exitCode}: ${result.stderr.toString()}`);
  }
}

function plant(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

describe('a real bun build over a scratch repository', () => {
  let root = '';
  const files: Record<string, string> = {
    'src/a/main.ts': 'import type { T } from \'../b/types.js\';\nimport { v } from \'../b/value.js\';\nexport const x: T = v;\n',
    'src/a/main.test.ts': 'import { expect, it } from \'bun:test\';\nimport { x } from \'./main.js\';\nit(\'x\', () => expect(x).toBe(1));\n',
    'src/b/types.ts': 'export type T = number;\n',
    'src/b/value.ts': 'export const v = 1;\n',
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'survey-import-graph-'));
    git(root, ['init', '--quiet']);
    for (const [path, text] of Object.entries(files)) {
      plant(root, path, text);
    }
    git(root, ['add', '--', ...Object.keys(files)]);
    plant(root, 'src/a/untracked.ts', 'import { v } from \'../b/value.js\';\nexport const u = v;\n');
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('records the value import, leaves the type import out, and resolves an entry named by specifier', async () => {
    const paths = Object.keys(files).sort();
    const metafile = await readMetafile(root, paths);
    const recorded = metafile.inputs['src/a/main.ts']?.imports.map((item) => item.path) ?? [];
    expect(recorded.some((path) => path.includes('types'))).toBe(false);
    const sources = new Map(paths.map((path) => [path, readFileSync(join(root, path), 'utf8')]));
    const graph = buildImportGraph({ files: paths, metafile, resolve: bunResolver(root), root, sources });
    expect(graph.edges).toEqual([
      { from: 'src/a/main.test.ts', kind: 'value', to: 'src/a/main.ts' },
      { from: 'src/a/main.ts', kind: 'type', to: 'src/b/types.ts' },
      { from: 'src/a/main.ts', kind: 'value', to: 'src/b/value.ts' },
    ]);
    expect(graph.unresolved).toEqual([]);
  });

  it('writes both outputs from the tracked files only, byte-identical on a second run', async () => {
    expect(await main(root)).toEqual(['docs/survey/import-graph.json', 'docs/survey/import-graph.md']);
    const json = readFileSync(join(root, 'docs/survey/import-graph.json'), 'utf8');
    const markdown = readFileSync(join(root, 'docs/survey/import-graph.md'), 'utf8');
    expect(markdown).toContain('Coverage: 4 of 4 tracked files read (src/ and packages/*/src/).');
    expect(json).not.toContain('untracked.ts');
    await main(root);
    expect(readFileSync(join(root, 'docs/survey/import-graph.json'), 'utf8')).toBe(json);
    expect(readFileSync(join(root, 'docs/survey/import-graph.md'), 'utf8')).toBe(markdown);
  });
});
