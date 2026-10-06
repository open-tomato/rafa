import type { BuildRun, BuildRunner, ImportEdge, Metafile } from './import-graph.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  betweennessOf,
  capCommunities,
  clusterFiles,
  edgesFromMetafile,
  folderSpread,
  isSurveyedSource,
  MAX_CLUSTERS,
  parseBuildFailures,
  readImportGraph,
  renderImportGraph,
  runMetafileBuild,
} from './import-graph.js';

/**
 * The import graph over hand-built graphs and hand-written metafiles,
 * never the live repository. Each clustering case is paired with a
 * control a folder-based or uncapped reading would fail: files of one
 * folder land in different clusters, and ten communities come out as
 * eight.
 */

let base = '';

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-import-graph-test-')));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A static edge from `from` to `to`. */
function edge(from: string, to: string): ImportEdge {
  return { from, to, kind: 'static' };
}

/** Every edge of a clique over `files`, each pair imported one way. */
function clique(files: readonly string[]): ImportEdge[] {
  return files.flatMap((from, index) => files.slice(index + 1).map((to) => edge(from, to)));
}

/** `count` groups of `size` files, group `n` named `t<n>/f0.ts` on. */
function groupsOf(count: number, size: number): string[][] {
  return Array.from({ length: count }, (_, group) => Array.from({ length: size }, (_, file) => `t${group}/f${file}.ts`));
}

describe('isSurveyedSource', () => {
  it('reads code and leaves tests, declarations and data out', () => {
    expect(isSurveyedSource('src/a.ts')).toBe(true);
    expect(isSurveyedSource('src/tests/stand-in.mjs')).toBe(true);
    expect(isSurveyedSource('src/a.test.ts')).toBe(false);
    expect(isSurveyedSource('src/types.d.ts')).toBe(false);
    expect(isSurveyedSource('src/data.json')).toBe(false);
    expect(isSurveyedSource('src/PROMPT.md')).toBe(false);
  });
});

describe('edgesFromMetafile', () => {
  const root = '/repo';
  const files = new Set(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/sub/d.ts']);
  /** Resolves `./x.js` and `../x.js` to the `.ts` file beside, and throws on `./gone.js`. */
  const resolve = (specifier: string, fromDir: string): string => {
    if (specifier === './gone.js') {
      throw new Error(`Cannot find module '${specifier}'`);
    }
    return join(fromDir, specifier).replace(/\.js$/, '.ts');
  };

  it('resolves raw specifiers, takes absolute paths as they are and keeps static over dynamic', () => {
    const metafile: Metafile = {
      inputs: {
        'src/a.ts': {
          imports: [
            { path: './b.js', kind: 'import-statement' },
            { path: '/repo/src/c.ts', kind: 'import-statement', original: './c.js' },
            { path: './src/sub/d.js', kind: 'dynamic-import', original: './sub/d.js', external: true },
            { path: 'path', kind: 'import-statement', original: 'node:path', external: true },
            { path: 'bun:wrap', kind: 'import-statement' },
          ],
        },
        'src/sub/d.ts': {
          imports: [
            { path: '../c.js', kind: 'dynamic-import', original: '../c.js', external: true },
            { path: '../c.js', kind: 'import-statement' },
            { path: '/repo/package.json', kind: 'import-statement', original: '../../package.json' },
            { path: './d.js', kind: 'import-statement' },
          ],
        },
      },
    };

    const { edges, unresolved } = edgesFromMetafile(metafile, root, files, resolve);

    expect(edges).toEqual([
      { from: 'src/a.ts', to: 'src/b.ts', kind: 'static' },
      { from: 'src/a.ts', to: 'src/c.ts', kind: 'static' },
      { from: 'src/a.ts', to: 'src/sub/d.ts', kind: 'dynamic' },
      { from: 'src/sub/d.ts', to: 'src/c.ts', kind: 'static' },
    ]);
    expect(unresolved).toEqual([]);
  });

  it('reports an import it cannot resolve and reads no input outside the files', () => {
    const metafile: Metafile = {
      inputs: {
        'src/b.ts': { imports: [{ path: './gone.js', kind: 'import-statement' }] },
        'node_modules/x/index.js': { imports: [{ path: '/repo/src/a.ts', kind: 'import-statement' }] },
      },
    };

    const { edges, unresolved } = edgesFromMetafile(metafile, root, files, resolve);

    expect(edges).toEqual([]);
    expect(unresolved).toEqual([{ from: 'src/b.ts', specifier: './gone.js' }]);
  });
});

describe('clusterFiles', () => {
  it('splits two cliques joined by one bridge, ranks the larger c1, and keeps an unlinked file isolated', () => {
    const big = ['x/a.ts', 'y/b.ts', 'x/c.ts', 'y/d.ts', 'x/e.ts'];
    const small = ['y/f.ts', 'x/g.ts', 'y/h.ts', 'x/i.ts'];
    const edges = [...clique(big), ...clique(small), edge('x/e.ts', 'y/f.ts')];

    const clustering = clusterFiles([...big, ...small, 'z/alone.ts'], edges);

    expect(clustering.clusters).toEqual([[...big].sort(), [...small].sort()]);
    expect(clustering.isolated).toEqual(['z/alone.ts']);
    expect(clustering.detached).toEqual([]);
    expect(clustering.modularity).toBeGreaterThan(0);
  });

  it('caps ten chained cliques Louvain keeps apart at eight clusters with no file left out', () => {
    const groups = groupsOf(10, 4);
    const chain = groups.slice(1).map((group, index) => edge(groups[index]?.[3] ?? '', group[0] ?? ''));
    const edges = [...groups.flatMap(clique), ...chain];

    const clustering = clusterFiles(groups.flat(), edges);

    expect(clustering.communities).toBe(10);
    expect(clustering.clusters.map((cluster) => cluster.length)).toEqual([12, 4, 4, 4, 4, 4, 4, 4]);
    expect(clustering.clusters.flat().sort()).toEqual(groups.flat().sort());
    expect(clustering.detached).toEqual([]);
  });

  it('leaves the last two of ten unlinked triangles detached', () => {
    const groups = groupsOf(10, 3);

    const clustering = clusterFiles(groups.flat(), groups.flatMap(clique));

    expect(clustering.communities).toBe(10);
    expect(clustering.clusters).toEqual(groups.slice(0, MAX_CLUSTERS));
    expect(clustering.detached).toEqual([...(groups[8] ?? []), ...(groups[9] ?? [])]);
  });

  it('clusters one graph alike on every run', () => {
    const groups = groupsOf(10, 3);
    const edges = [...groups.flatMap(clique), edge('t0/f0.ts', 't5/f0.ts'), edge('t3/f1.ts', 't9/f2.ts')];

    expect(clusterFiles(groups.flat(), edges)).toEqual(clusterFiles(groups.flat(), edges));
  });
});

describe('capCommunities', () => {
  it('merges a group beyond the cap into the neighbour it shares the most edges with', () => {
    const groups = [['a1', 'a2', 'a3'], ['b1', 'b2'], ['c1']];
    const edges = [edge('c1', 'a1'), edge('c1', 'b1'), edge('b2', 'c1')];

    expect(capCommunities(groups, edges, 2)).toEqual({ kept: [['a1', 'a2', 'a3'], ['b1', 'b2', 'c1']], detached: [] });
  });

  it('merges into the higher-ranked neighbour on a tie', () => {
    const groups = [['a1', 'a2', 'a3'], ['b1', 'b2'], ['c1']];
    const edges = [edge('c1', 'a1'), edge('c1', 'b1')];

    expect(capCommunities(groups, edges, 2)).toEqual({ kept: [['a1', 'a2', 'a3', 'c1'], ['b1', 'b2']], detached: [] });
  });

  it('detaches a group beyond the cap with no edge out', () => {
    const groups = [['a1', 'a2'], ['b1', 'b2'], ['c1']];

    expect(capCommunities(groups, [edge('a1', 'b1')], 2)).toEqual({ kept: [['a1', 'a2'], ['b1', 'b2']], detached: ['c1'] });
  });
});

describe('betweennessOf', () => {
  it('scores the middle of a chain and nothing at its ends', () => {
    const scores = betweennessOf(['a.ts', 'b.ts', 'c.ts'], [edge('a.ts', 'b.ts'), edge('b.ts', 'c.ts')]);

    expect(scores).toEqual(new Map([['a.ts', 0], ['b.ts', 0.5], ['c.ts', 0]]));
  });

  it('follows import direction, so a file only imported scores nothing', () => {
    const scores = betweennessOf(['a.ts', 'b.ts', 'c.ts'], [edge('a.ts', 'b.ts'), edge('c.ts', 'b.ts')]);

    expect(scores.get('b.ts')).toBe(0);
  });
});

describe('folderSpread', () => {
  it('counts a cluster per folder, most first, against every file of that folder', () => {
    const all = ['src/a/x.ts', 'src/a/y.ts', 'src/a/z.ts', 'src/b/x.ts', 'src/c/x.ts', 'src/c/y.ts'];

    expect(folderSpread(['src/a/x.ts', 'src/c/x.ts', 'src/c/y.ts'], all)).toEqual([
      { folder: 'src/c', files: 2, folderTotal: 2 },
      { folder: 'src/a', files: 1, folderTotal: 3 },
    ]);
  });
});

describe('readImportGraph and renderImportGraph', () => {
  const left = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
  const right = ['lib/d.ts', 'lib/e.ts', 'lib/f.ts'];
  const edges = [...clique(left), ...clique(right), edge('src/c.ts', 'lib/d.ts')];
  const files = [...left, ...right, 'src/alone.ts'];

  it('names clusters c1 on, counts internal and cross edges, and leaves the isolated file in none', () => {
    const data = readImportGraph(files, edges);

    expect(data.clusters.map((cluster) => [cluster.id, cluster.files, cluster.internalEdges, cluster.crossEdges])).toEqual([
      ['c1', ['lib/d.ts', 'lib/e.ts', 'lib/f.ts'], 3, 1],
      ['c2', ['src/a.ts', 'src/b.ts', 'src/c.ts'], 3, 1],
    ]);
    expect(data.files.find((file) => file.path === 'src/alone.ts')).toEqual({
      path: 'src/alone.ts',
      cluster: null,
      betweenness: 0,
      imports: 0,
      importedBy: 0,
    });
    expect(data.files.find((file) => file.path === 'src/c.ts')?.imports).toBe(1);
    expect(data.isolated).toEqual(['src/alone.ts']);
  });

  it('prints each cluster row, its folder spread and the isolated files', () => {
    const markdown = renderImportGraph(readImportGraph(files, edges, [{ path: 'src/bad.ts', message: 'Unexpected end of file' }]));

    expect(markdown).toContain('7 files and 7 import edges (7 static, 0 dynamic)');
    expect(markdown).toContain('Build failures: `src/bad.ts` (Unexpected end of file)');
    expect(markdown).toContain('| c2 | 3 | 1 | 3 | 1 | `src/c.ts` (');
    expect(markdown).toContain('### c1 (3 files)\n\n- `lib/` 3 of 3');
    expect(markdown).toContain('### c2 (3 files)\n\n- `src/` 3 of 4');
    expect(markdown).toContain('Isolated, no runtime import edge (1): `src/alone.ts`');
  });
});

describe('parseBuildFailures', () => {
  it('names each surveyed file once with the first error printed for it', () => {
    const output = [
      '1 | export const = ;',
      '                 ^',
      'error: Expected identifier but found "="',
      '    at /real/repo/src/bad.ts:1:14',
      '',
      'error: Unexpected end of file',
      '    at /real/repo/src/bad.ts:1:23',
      'error: Could not resolve: "./missing.js"',
      '    at /real/repo/src/c.ts:1:19',
      'error: Could not resolve: "x"',
      '    at /elsewhere/lib.ts:1:1',
    ].join('\n');

    expect(parseBuildFailures(output, '/real/repo', new Set(['src/bad.ts', 'src/c.ts', 'src/ok.ts']))).toEqual([
      { path: 'src/bad.ts', message: 'Expected identifier but found "="' },
      { path: 'src/c.ts', message: 'Could not resolve: "./missing.js"' },
    ]);
  });
});

describe('runMetafileBuild', () => {
  function writeFile(path: string, text: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }

  it('builds again without each file a failed build names', async () => {
    const calls: string[][] = [];
    const build: BuildRunner = (_root, entries): Promise<BuildRun> => {
      calls.push([...entries]);
      return Promise.resolve(entries.includes('src/bad.ts')
        ? { exitCode: 1, output: `error: Unexpected end of file\n    at ${base}/src/bad.ts:1:1`, metafile: null }
        : { exitCode: 0, output: '', metafile: JSON.stringify({ inputs: { 'src/a.ts': { imports: [] } } }) });
    };

    const result = await runMetafileBuild(base, ['src/a.ts', 'src/bad.ts'], build);

    expect(calls).toEqual([['src/a.ts', 'src/bad.ts'], ['src/a.ts']]);
    expect(result.failures).toEqual([{ path: 'src/bad.ts', message: 'Unexpected end of file' }]);
    expect(Object.keys(result.metafile.inputs)).toEqual(['src/a.ts']);
  });

  it('throws when a failed build names no surveyed file', async () => {
    const build: BuildRunner = () => Promise.resolve({ exitCode: 1, output: 'error: out of memory', metafile: null });

    await expect(runMetafileBuild(base, ['src/a.ts'], build)).rejects.toThrow('bun build failed naming no surveyed file');
  });

  it('drops an unparseable file from a real bun build and reads the rest', async () => {
    writeFile(join(base, 'src/a.ts'), 'import { b } from \'./b.js\';\nexport const a = b;\n');
    writeFile(join(base, 'src/b.ts'), 'export const b = 1;\n');
    writeFile(join(base, 'src/bad.ts'), 'export const = ;;; {{{\n');

    const { metafile, failures } = await runMetafileBuild(base, ['src/a.ts', 'src/b.ts', 'src/bad.ts']);

    expect(failures.map((failure) => failure.path)).toEqual(['src/bad.ts']);
    expect(Object.keys(metafile.inputs).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(edgesFromMetafile(metafile, base, new Set(['src/a.ts', 'src/b.ts'])).edges).toEqual([edge('src/a.ts', 'src/b.ts')]);
  });
});
