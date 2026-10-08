import type { FileReading, InventoryConcept } from './doc-inventory';
import type { ResolveImport } from './import-graph';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  UNCLUSTERED,
  clustersFromGraph,
  conceptsFromMap,
  inventoryDocs,
  main,
  readDocFile,
  renderDocInventoryJson,
  renderDocInventoryMarkdown,
} from './doc-inventory';

const WRITE = 'src/store/write.ts';
const HELPER = 'src/store/helper.ts';
const READ = 'src/review/read.ts';
const BARREL = 'src/review/index.ts';
const READ_TEST = 'src/review/read.test.ts';

const SOURCES: Record<string, string> = {
  [BARREL]: [
    '/** The review barrel: passes {@link write} on. */',
    '',
    'export { write } from \'../store/write.js\';',
    '',
  ].join('\n'),
  [HELPER]: [
    'import { readFileSync } from \'node:fs\';',
    '',
    '/** Helps {@link write}; its own TSDoc, not a module note. */',
    'export function helper(): string {',
    '  return readFileSync(\'x\', \'utf8\');',
    '}',
    '',
  ].join('\n'),
  [READ]: [
    '#!/usr/bin/env bun',
    '',
    '/**',
    ' * Reads the side record back for hindsight.',
    ' */',
    '',
    '/** A reader of {@link import(\'../store/write.js\').write}. */',
    'export interface Reader { read(): string }',
    '',
  ].join('\n'),
  [READ_TEST]: [
    'import { expect, it } from \'bun:test\';',
    '',
    'it(\'reads\', () => expect(1).toBe(1));',
    '',
  ].join('\n'),
  [WRITE]: [
    '/**',
    ' * Writes the side record, one row per task.',
    ' */',
    '',
    'import type { Reader } from \'../review/read.js\';',
    '',
    'import { helper } from \'./helper.js\';',
    '',
    '/**',
    ' * Writes for hindsight. A {@link Reader | reader} reads it, {@link',
    ' * helper} helps, {@link Map} and {@link https://example.com/ the docs}',
    ' * lie outside any cluster.',
    ' */',
    'export function write(reader: Reader): string {',
    '  return helper() + reader.read();',
    '}',
    '',
  ].join('\n'),
};

/** The planted cut: the store against the review. */
const CLUSTER_OF = new Map([
  [BARREL, 'c02-review'],
  [HELPER, 'c01-store'],
  [READ, 'c02-review'],
  [READ_TEST, 'c02-review'],
  [WRITE, 'c01-store'],
]);

const CONCEPTS: InventoryConcept[] = [
  { clusters: ['c01-store', 'c02-review'], key: 'hindsight', name: 'Hindsight', terms: ['hindsight'] },
  { clusters: ['c01-store', 'c02-review'], key: 'side record', name: 'Side record', terms: ['side record'] },
];

/** Resolves a relative `.js` specifier to the planted `.ts` file it names. */
const resolvePlanted: ResolveImport = (specifier, from) => {
  const path = posix.normalize(posix.join(posix.dirname(from), specifier.replace(/\.js$/, '.ts')));
  return path in SOURCES
    ? path
    : undefined;
};

function plantedReadings(): Map<string, FileReading> {
  return new Map(Object.entries(SOURCES).map(([path, text]) => [path, readDocFile(path, text, resolvePlanted)]));
}

describe('reading one file', () => {
  it('reads a module note after a shebang, and normalizes it', () => {
    expect(readDocFile(READ, SOURCES[READ] ?? '', resolvePlanted).note).toBe('reads the side record back for hindsight');
  });

  it('reads a file without a note: TSDoc on its first declaration is that declaration\'s', () => {
    expect(readDocFile(HELPER, SOURCES[HELPER] ?? '', resolvePlanted).note).toBeUndefined();
    expect(readDocFile('src/a.ts', '/** A. */\nexport const a = 1;\n', resolvePlanted).note).toBeUndefined();
    expect(readDocFile('src/a.ts', 'export const a = 1;\n', resolvePlanted).note).toBeUndefined();
  });

  it('reads a note before a declaration when a blank line, a second comment or a tag sets it apart', () => {
    expect(readDocFile('src/a.ts', '/** A. */\n\nexport const a = 1;\n', resolvePlanted).note).toBe('a');
    expect(readDocFile('src/a.ts', '/** A. */\n/** B. */\nexport const a = 1;\n', resolvePlanted).note).toBe('a');
    expect(readDocFile('src/a.ts', '/** A. @module */\nexport const a = 1;\n', resolvePlanted).note).toBe('a. @module');
    expect(readDocFile('src/a.ts', '/** Only a note. */\n', resolvePlanted).note).toBe('only a note');
  });

  it('resolves each link by import, re-export, import() or declaration, a wrapped one included', () => {
    const links = (path: string): [string, string | undefined][] => readDocFile(path, SOURCES[path] ?? '', resolvePlanted)
      .links
      .map((link) => [link.target, link.file]);
    expect(links(WRITE)).toEqual([
      ['Reader', READ],
      ['helper', HELPER],
      ['Map', undefined],
      ['https://example.com/', undefined],
    ]);
    expect(links(READ)).toEqual([['import(\'../store/write.js\').write', WRITE]]);
    expect(links(BARREL)).toEqual([['write', WRITE]]);
    expect(links(HELPER)).toEqual([['write', undefined]]);
    expect(readDocFile('src/a.ts', '/** See {@link a}. */\nexport const a = 1;\n', resolvePlanted).links)
      .toEqual([{ file: 'src/a.ts', target: 'a', url: false }]);
  });
});

describe('the inventory over a planted cut', () => {
  const inventory = inventoryDocs({ clusterOf: CLUSTER_OF, concepts: CONCEPTS, readings: plantedReadings() });
  const cluster = (name: string): (typeof inventory.clusters)[number] | undefined => inventory.clusters
    .find((entry) => entry.name === name);

  it('names the source file without a note under its cluster, and no test file', () => {
    expect(cluster('c01-store')).toMatchObject({ notedSources: 1, sources: 2, sourcesWithoutNote: [HELPER] });
    expect(cluster('c02-review')).toMatchObject({ files: 3, notedSources: 2, sources: 2, sourcesWithoutNote: [] });
    expect(inventory.files.find((file) => file.path === READ_TEST)).toEqual({
      cluster: 'c02-review',
      kind: 'test',
      moduleNote: false,
      path: READ_TEST,
    });
  });

  it('reports each link across the cut, and not the one inside a cluster', () => {
    expect(inventory.crossClusterLinks).toEqual([
      { from: BARREL, fromCluster: 'c02-review', occurrences: 1, target: 'write', to: WRITE, toCluster: 'c01-store' },
      {
        from: READ,
        fromCluster: 'c02-review',
        occurrences: 1,
        target: 'import(\'../store/write.js\').write',
        to: WRITE,
        toCluster: 'c01-store',
      },
      { from: WRITE, fromCluster: 'c01-store', occurrences: 1, target: 'Reader', to: READ, toCluster: 'c02-review' },
    ]);
    expect(inventory.links).toEqual({ across: 3, inside: 1, outside: 1, unbound: 2 });
  });

  it('reports the inside link once the planted cut runs between its two files (control)', () => {
    const moved = new Map([...CLUSTER_OF, [HELPER, 'c03-helper']]);
    const control = inventoryDocs({ clusterOf: moved, concepts: CONCEPTS, readings: plantedReadings() });
    expect(control.crossClusterLinks.map((link) => [link.from, link.target])).toContainEqual([WRITE, 'helper']);
    expect(control.links.inside).toBe(0);
  });

  it('counts repeated links as one row with their occurrences', () => {
    const text = '/** {@link Reader} and {@link Reader.read}, then {@link Reader} again. */\n\n'
      + 'import type { Reader } from \'../review/read.js\';\n';
    const readings = new Map([[WRITE, readDocFile(WRITE, text, resolvePlanted)]]);
    const repeated = inventoryDocs({ clusterOf: CLUSTER_OF, concepts: [], readings });
    expect(repeated.crossClusterLinks.map((link) => [link.target, link.occurrences])).toEqual([['Reader', 2], ['Reader.read', 1]]);
  });

  it('tags the concepts each cluster\'s notes name, and lists those only its other TSDoc names', () => {
    expect(cluster('c01-store')).toMatchObject({ conceptsInNotes: ['side record'], conceptsNotInNotes: ['hindsight'] });
    expect(cluster('c02-review')).toMatchObject({ conceptsInNotes: ['hindsight', 'side record'], conceptsNotInNotes: [] });
  });

  it('puts a file the graph does not list in the unclustered cluster', () => {
    const readings = new Map([['src/new.ts', readDocFile('src/new.ts', 'export const n = 1;\n', resolvePlanted)]]);
    expect(inventoryDocs({ clusterOf: CLUSTER_OF, concepts: [], readings }).files[0]?.cluster).toBe(UNCLUSTERED);
  });

  it('writes the summary: coverage, files without a note, links across, untagged concepts', () => {
    const markdown = renderDocInventoryMarkdown(inventory, [...Object.keys(SOURCES), 'src/dropped.ts']);
    const lines = markdown.split('\n');
    expect(lines[2]).toBe('Coverage: 5 of 6 tracked files read (src/ and packages/*/src/). Not read: `src/dropped.ts`.');
    expect(markdown).toContain('### `c01-store` (1 of 2 source files)\n\n- `src/store/helper.ts`\n');
    expect(markdown).toContain('Every source file has a module note in: `c02-review`.');
    expect(markdown).toContain('| `src/store/write.ts` | `c01-store` | `Reader` | 1 | `src/review/read.ts` | `c02-review` |');
    expect(markdown).not.toMatch(/\| `helper` \|/);
    expect(markdown).toContain('### `c01-store` (1; 1 named in notes)\n\n- Hindsight\n');
    expect(markdown.endsWith('- Hindsight\n')).toBe(true);
  });

  it('renders equal JSON for equal input, every list sorted', () => {
    const json = renderDocInventoryJson(inventory);
    expect(renderDocInventoryJson(inventoryDocs({ clusterOf: CLUSTER_OF, concepts: CONCEPTS, readings: plantedReadings() })))
      .toBe(json);
    const parsed = JSON.parse(json) as { read: string[] };
    expect(parsed.read).toEqual([...parsed.read].sort());
  });
});

describe('reading the survey inputs', () => {
  it('takes clusters from the graph nodes and refuses a graph without them', () => {
    expect(clustersFromGraph({ nodes: [{ cluster: 'c01-a', kind: 'source', path: 'src/a.ts' }] }))
      .toEqual(new Map([['src/a.ts', 'c01-a']]));
    expect(() => clustersFromGraph({})).toThrow('import-graph.json has no nodes list');
  });

  it('takes concepts from the concept map and refuses one without terms', () => {
    expect(conceptsFromMap({ concepts: [{ clusters: [], files: [], key: 'k', name: 'K', terms: ['k'] }] }))
      .toEqual([{ clusters: [], key: 'k', name: 'K', terms: ['k'] }]);
    expect(() => conceptsFromMap({ concepts: [{ key: 'k' }] })).toThrow('concepts.json has a concept without');
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

describe('main over a scratch repository', () => {
  let root = '';

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'survey-doc-inventory-'));
    git(root, ['init', '--quiet']);
    for (const [path, text] of Object.entries(SOURCES)) {
      plant(root, path, text);
    }
    git(root, ['add', '--', ...Object.keys(SOURCES)]);
    const nodes = [...CLUSTER_OF].map(([path, cluster]) => ({ cluster, kind: 'source', path }));
    plant(root, 'docs/survey/import-graph.json', JSON.stringify({ nodes }));
    plant(root, 'docs/survey/concepts.json', JSON.stringify({ concepts: CONCEPTS }));
    plant(root, 'src/review/untracked.ts', '/** Untracked, {@link write}. */\n\nexport { write } from \'../store/write.js\';\n');
  });

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('writes both outputs from tracked files only, byte-identical on a second run', async () => {
    expect(await main(root)).toEqual(['docs/survey/doc-inventory.json', 'docs/survey/doc-inventory.md']);
    const json = readFileSync(join(root, 'docs/survey/doc-inventory.json'), 'utf8');
    const markdown = readFileSync(join(root, 'docs/survey/doc-inventory.md'), 'utf8');
    expect(markdown).toContain('Coverage: 5 of 5 tracked files read (src/ and packages/*/src/).');
    expect(markdown).toContain('| `src/store/write.ts` | `c01-store` | `Reader` | 1 | `src/review/read.ts` | `c02-review` |');
    expect(markdown).toContain('`{@link}`s read: 7; 1 inside one cluster, 3 across clusters');
    expect(json).not.toContain('untracked');
    await main(root);
    expect(readFileSync(join(root, 'docs/survey/doc-inventory.json'), 'utf8')).toBe(json);
    expect(readFileSync(join(root, 'docs/survey/doc-inventory.md'), 'utf8')).toBe(markdown);
  });
});
