import type { Resolver } from './test-index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  clustersFromGraph,
  folderOf,
  importSpecifiers,
  indexStats,
  indexTestFile,
  isSupportOrFake,
  isTestFile,
  loadImportGraph,
  readTestIndex,
  renderTestIndex,
  resolveImport,
  surveyTestIndex,
} from './test-index.js';

/**
 * The test index over in-memory imports and a temporary git repository,
 * never the live one. Each guard case is paired with its unguarded
 * reading, so a guard that set nothing aside would fail it.
 */

let base = '';

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-test-index-test-')));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A resolver answering from `table`, keyed `<fromDir>|<specifier>`, throwing on any other. */
function tableResolver(table: Record<string, string>): Resolver {
  return (specifier, fromDir) => {
    const hit = table[`${fromDir}|${specifier}`];
    if (hit === undefined) {
      throw new Error(`cannot resolve ${specifier}`);
    }
    return hit;
  };
}

/** Writes `files` under `root`, creating folders. */
function plant(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

describe('folderOf', () => {
  it('reads the first folder under src, src for its root, and the package under packages', () => {
    expect(folderOf('src/commands/a/b.ts')).toBe('src/commands');
    expect(folderOf('src/config.ts')).toBe('src');
    expect(folderOf('packages/rafa-hub/src/x.ts')).toBe('packages/rafa-hub');
    expect(folderOf('scripts/survey/x.ts')).toBe('scripts');
    expect(folderOf('package.json')).toBe('.');
  });
});

describe('isTestFile and isSupportOrFake', () => {
  it('takes test files only', () => {
    expect(isTestFile('src/a/b.test.ts')).toBe(true);
    expect(isTestFile('src/a/b.ts')).toBe(false);
  });

  it('sets aside test-support, testdata and fakes, and nothing else', () => {
    expect(isSupportOrFake('src/tests/spawn.ts')).toBe(true);
    expect(isSupportOrFake('src/effort/store/testdata/rows.ts')).toBe(true);
    expect(isSupportOrFake('src/pr/gh-fake.ts')).toBe(true);
    expect(isSupportOrFake('packages/rafa-sync-service/src/stand-in-hub.ts')).toBe(true);
    expect(isSupportOrFake('src/effort/store.ts')).toBe(false);
    expect(isSupportOrFake('src/testsuite/x.ts')).toBe(false);
  });
});

describe('importSpecifiers', () => {
  it('reads every from clause, type-only and re-exports included, across lines', () => {
    const text = [
      'import type { A } from \'./a.js\';',
      'import {',
      '  b,',
      '} from \'../b/b.js\';',
      'export { c } from \'./c.js\';',
      'import { test } from \'bun:test\';',
      'const d = await import(\'./d.js\');',
    ].join('\n');
    expect(importSpecifiers(text)).toEqual(['./a.js', '../b/b.js', './c.js', 'bun:test']);
  });
});

describe('resolveImport', () => {
  const root = '/repo';
  const resolver = tableResolver({
    '/repo/src/a|./x.js': '/repo/src/a/x.ts',
    '/repo/packages/hub/src|@open-tomato/rafa/store': '/repo/src/effort/store/index.ts',
    '/repo/src/a|./dep.js': '/repo/node_modules/dep/index.js',
  });

  it('resolves relative and @open-tomato specifiers to repository files', () => {
    expect(resolveImport('./x.js', 'src/a/x.test.ts', root, resolver)).toEqual({ path: 'src/a/x.ts', unresolved: false });
    expect(resolveImport('@open-tomato/rafa/store', 'packages/hub/src/s.test.ts', root, resolver))
      .toEqual({ path: 'src/effort/store/index.ts', unresolved: false });
  });

  it('skips other specifiers and files under node_modules', () => {
    expect(resolveImport('bun:test', 'src/a/x.test.ts', root, resolver)).toEqual({ path: null, unresolved: false });
    expect(resolveImport('./dep.js', 'src/a/x.test.ts', root, resolver)).toEqual({ path: null, unresolved: false });
  });

  it('keeps an unresolved relative specifier by plain path and drops an unresolved package one', () => {
    expect(resolveImport('../b/gone.js', 'src/a/x.test.ts', root, resolver))
      .toEqual({ path: 'src/b/gone.js', unresolved: true });
    expect(resolveImport('@open-tomato/rafa/gone', 'src/a/x.test.ts', root, resolver))
      .toEqual({ path: null, unresolved: true });
  });
});

describe('indexTestFile', () => {
  const clusters = new Map([
    ['src/a/x.ts', 'c1'],
    ['src/b/y.ts', 'c1'],
    ['src/c/z.ts', 'c2'],
    ['src/tests/spawn.ts', 'c3'],
  ]);

  it('counts the own folder and each folder reached, and the clusters reached', () => {
    const file = indexTestFile('src/a/x.test.ts', ['src/a/x.ts', 'src/b/y.ts', 'src/c/z.ts'], false, clusters);
    expect(file.byFolder.groups).toEqual(['src/a', 'src/b', 'src/c']);
    expect(file.byFolder.index).toBe(3);
    expect(file.byCluster.groups).toEqual(['c1', 'c2']);
    expect(file.byCluster.index).toBe(2);
  });

  it('doubles every index when the file spawns', () => {
    const file = indexTestFile('src/a/x.test.ts', ['src/b/y.ts'], true, clusters);
    expect(file.byFolder.index).toBe(4);
    expect(file.byFolder.guardIndex).toBe(4);
    expect(file.byCluster.index).toBe(2);
  });

  it('sets test-support and fakes aside in the guard index only', () => {
    const file = indexTestFile('src/a/x.test.ts', ['src/a/x.ts', 'src/tests/spawn.ts', 'src/pr/gh-fake.ts'], false, clusters);
    expect(file.byFolder.index).toBe(3);
    expect(file.byFolder.guardIndex).toBe(1);
    expect(file.byCluster.groups).toEqual(['c1', 'c3', 'none']);
    expect(file.byCluster.guardGroups).toEqual(['c1']);
  });

  it('counts the own folder even when it is test-support, and a cluster index of 1 for no import', () => {
    const file = indexTestFile('src/tests/flow.test.ts', ['src/tests/spawn.ts'], false, clusters);
    expect(file.byFolder.guardGroups).toEqual(['src/tests']);
    expect(file.byFolder.guardIndex).toBe(1);
    expect(file.byCluster.guardIndex).toBe(1);
  });

  it('ignores imports outside src and packages, and the file itself', () => {
    const file = indexTestFile('src/a/x.test.ts', ['package.json', 'scripts/s.ts', 'src/a/x.test.ts'], false, clusters);
    expect(file.imports).toEqual([]);
    expect(file.byFolder.index).toBe(1);
  });
});

describe('indexStats', () => {
  it('reads p50, p90 and max as the sketches did, with the distribution', () => {
    const stats = indexStats([1, 1, 2, 2, 2, 3, 4, 4, 6, 8]);
    expect(stats).toEqual({
      files: 10,
      p50: 3,
      p90: 8,
      max: 8,
      distribution: [
        { index: 1, files: 2 },
        { index: 2, files: 3 },
        { index: 3, files: 1 },
        { index: 4, files: 2 },
        { index: 6, files: 1 },
        { index: 8, files: 1 },
      ],
    });
  });

  it('reads zeros over no file', () => {
    expect(indexStats([])).toEqual({ files: 0, p50: 0, p90: 0, max: 0, distribution: [] });
  });
});

describe('readTestIndex', () => {
  it('summarizes per own folder and counts reach from other folders only', () => {
    const clusters = new Map([['src/a/x.ts', 'c1'], ['src/b/y.ts', 'c2']]);
    const data = readTestIndex([
      indexTestFile('src/a/x.test.ts', ['src/a/x.ts', 'src/b/y.ts'], false, clusters),
      indexTestFile('src/a/w.test.ts', ['src/a/x.ts'], true, clusters),
      indexTestFile('src/b/y.test.ts', ['src/b/y.ts'], false, clusters),
    ]);
    expect(data.files.map((file) => file.path)).toEqual(['src/a/w.test.ts', 'src/a/x.test.ts', 'src/b/y.test.ts']);
    expect(data.spawning).toBe(1);
    expect(data.folders.map((folder) => [folder.name, folder.folder.files, folder.spawning]))
      .toEqual([['src/a', 2, 1], ['src/b', 1, 0]]);
    expect(data.folderReach).toEqual([{ group: 'src/b', testFiles: 1 }]);
    expect(data.clusterReach).toEqual([{ group: 'c1', testFiles: 2 }, { group: 'c2', testFiles: 2 }]);
    const markdown = renderTestIndex(data);
    expect(markdown).toContain('3 test files, 1 of them spawning');
    expect(markdown).toContain('| `src/a` | 2 | 1 |');
  });
});

describe('loadImportGraph and clustersFromGraph', () => {
  it('names the script to run first when the graph is absent', async () => {
    await expect(loadImportGraph(base)).rejects.toThrow('run bun scripts/survey/import-graph.ts first');
  });

  it('maps each clustered file and leaves isolated ones out', () => {
    const map = clustersFromGraph({
      files: [
        { path: 'src/a.ts', cluster: 'c1', betweenness: 0, imports: 1, importedBy: 0 },
        { path: 'src/b.ts', cluster: null, betweenness: 0, imports: 0, importedBy: 0 },
      ],
    });
    expect([...map]).toEqual([['src/a.ts', 'c1']]);
  });
});

describe('surveyTestIndex', () => {
  it('indexes every tracked test file of a git repository and writes the coverage line', async () => {
    plant(base, {
      'src/a/x.ts': 'export const x = 1;\n',
      'src/b/y.ts': 'export const y = 2;\n',
      'src/tests/spawn.ts': 'export const spawnRafa = () => 0;\n',
      'src/a/x.test.ts': 'import { x } from \'./x.js\';\nimport { y } from \'../b/y.js\';\n',
      'src/b/y.test.ts': 'import { y } from \'./y.js\';\nimport { spawnRafa } from \'../tests/spawn.js\';\nspawnRafa();\n',
      'src/a/untracked.test.ts': 'import { x } from \'./x.js\';\n',
      '.rafa/survey/import-graph.json': JSON.stringify({
        data: {
          files: [
            { path: 'src/a/x.ts', cluster: 'c1', betweenness: 0, imports: 0, importedBy: 0 },
            { path: 'src/b/y.ts', cluster: 'c2', betweenness: 0, imports: 0, importedBy: 0 },
          ],
        },
      }),
    });
    await Bun.$`git init -q && git add src`.cwd(base).quiet();
    await Bun.$`git rm -q --cached src/a/untracked.test.ts`.cwd(base).quiet();

    const data = await surveyTestIndex(base);

    expect(data.files.map((file) => [file.path, file.byFolder.index, file.byFolder.guardIndex, file.byCluster.index]))
      .toEqual([['src/a/x.test.ts', 2, 2, 2], ['src/b/y.test.ts', 4, 2, 4]]);
    const markdown = await Bun.file(join(base, '.rafa/survey/test-index.md')).text();
    expect(markdown.split('\n')[0]).toBe('Coverage: 2 tracked, 2 read, 0 missed: none');
    const json = (await Bun.file(join(base, '.rafa/survey/test-index.json')).json()) as { name: string };
    expect(json.name).toBe('test-index');
  });
});
