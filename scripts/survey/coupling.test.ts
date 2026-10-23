import type { CouplingEdge, KeptPair, KeptReader } from './coupling';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  DEFAULT_GRAPH,
  DEFAULT_MAP,
  isAboveMax,
  isImporterFile,
  loadKeptReader,
  main,
  MOVE_ORDER,
  parseCouplingArgs,
  parseGraphEdges,
  readCoupling,
  readKept,
  renderCoupling,
  renderKept,
} from './coupling';
import { parseCutMap } from './cut-map';

/**
 * A planted table: one folder per feature package of the order, plus core
 * and the CLI, which the reading leaves out. Its rows list `rafa-pr` before
 * `rafa-release`, as the live table's rank order does, against the move order.
 */
const TABLE = {
  packages: [
    { files: ['src/effort/a.ts', 'src/effort/b.ts'], folders: ['src/effort/'], name: 'rafa-effort' },
    { files: ['src/inventory/a.ts'], folders: ['src/inventory/'], name: 'rafa-inventory' },
    { files: ['src/board/a.ts', 'src/board/a.test.ts'], folders: ['src/board/'], name: 'rafa-board' },
    { files: ['src/pr/a.ts'], folders: ['src/pr/'], name: 'rafa-pr' },
    { files: ['src/release/a.ts'], folders: ['src/release/'], name: 'rafa-release' },
    { files: ['src/run/a.ts'], folders: ['src/run/'], name: 'rafa-run' },
    { files: ['packages/rafa/src/x.ts'], folders: ['packages/rafa/src/'], name: '@open-tomato/rafa-core' },
    { files: ['src/cli/x.ts'], folders: ['src/cli/'], name: '@open-tomato/rafa' },
  ],
  unassigned: [],
};

const MAP = parseCutMap(JSON.stringify(TABLE), 'planted.json');

/** A value edge from `from` to `to`. */
function value(from: string, to: string): CouplingEdge {
  return { from, kind: 'value', to };
}

/**
 * The planted graph: three back edges (two effort -> run, one board ->
 * pr), two forward ones (run -> effort, pr -> inventory), and the edges
 * the reading must leave out.
 */
const PLANTED: readonly CouplingEdge[] = [
  value('src/effort/b.ts', 'src/run/a.ts'),
  value('src/effort/a.ts', 'src/run/a.ts'),
  value('src/board/a.ts', 'src/pr/a.ts'),
  value('src/run/a.ts', 'src/effort/a.ts'),
  value('src/pr/a.ts', 'src/inventory/a.ts'),
  // Left out: a type edge, a test at either end, one package, core, the CLI, an unplaced file.
  { from: 'src/effort/a.ts', kind: 'type', to: 'src/run/a.ts' },
  value('src/board/a.test.ts', 'src/run/a.ts'),
  value('src/effort/a.ts', 'src/board/a.test.ts'),
  value('src/effort/a.ts', 'src/effort/b.ts'),
  value('src/effort/a.ts', 'packages/rafa/src/x.ts'),
  value('src/cli/x.ts', 'src/run/a.ts'),
  value('src/effort/a.ts', 'elsewhere/x.ts'),
];

/** A type edge from `from` to `to`. */
function typeOnly(from: string, to: string): CouplingEdge {
  return { from, kind: 'type', to };
}

/** A pair of a file and a package it imports. */
function pair(file: string, packageName: string): KeptPair {
  return { file, package: packageName };
}

/**
 * The planted graph of the kept line: eight importer pairs, from the CLI,
 * core, a script and three feature packages, one of them over a type
 * edge alone, and the edges that make no pair. Its back-edge reading is
 * one of three (board -> pr, beside run -> effort and pr -> inventory).
 */
const KEPT_EDGES: readonly CouplingEdge[] = [
  value('src/cli/x.ts', 'src/run/a.ts'),
  value('src/cli/x.ts', 'src/effort/a.ts'),
  value('src/cli/x.ts', 'src/effort/b.ts'),
  typeOnly('src/cli/x.ts', 'src/inventory/a.ts'),
  value('packages/rafa/src/x.ts', 'src/effort/a.ts'),
  value('scripts/x.ts', 'src/pr/a.ts'),
  value('src/board/a.ts', 'src/pr/a.ts'),
  value('src/run/a.ts', 'src/effort/a.ts'),
  value('src/pr/a.ts', 'src/inventory/a.ts'),
  // No pair: a test importer, a script test, one package, a target in core or the CLI, an unplaced target.
  value('src/board/a.test.ts', 'src/run/a.ts'),
  value('scripts/x.test.ts', 'src/pr/a.ts'),
  value('src/effort/a.ts', 'src/effort/b.ts'),
  value('src/run/a.ts', 'packages/rafa/src/x.ts'),
  value('src/run/a.ts', 'src/cli/x.ts'),
  value('src/run/a.ts', 'elsewhere/x.ts'),
];

/**
 * The planted kept pairs: four of the graph's pairs, and two the graph
 * does not hold (a test importer, and a file that imports no release).
 */
const KEPT_PAIRS: readonly KeptPair[] = [
  pair('src/cli/x.ts', 'rafa-run'),
  pair('src/cli/x.ts', 'rafa-inventory'),
  pair('src/run/a.ts', 'rafa-effort'),
  pair('src/pr/a.ts', 'rafa-inventory'),
  pair('src/board/a.test.ts', 'rafa-run'),
  pair('src/cli/x.ts', 'rafa-release'),
];

/** A kept-pair reader that answers `pairs` whatever the root. */
function plantedReader(pairs: readonly KeptPair[]): KeptReader {
  return () => pairs;
}

describe('MOVE_ORDER', () => {
  it('holds the six feature packages in the order the spec names', () => {
    expect(MOVE_ORDER).toEqual(['rafa-inventory', 'rafa-effort', 'rafa-board', 'rafa-release', 'rafa-pr', 'rafa-run']);
  });
});

describe('readCoupling', () => {
  it('counts the value edges between two feature packages and the back edges among them', () => {
    const coupling = readCoupling(PLANTED, MAP.unitOf);

    expect(coupling.total).toBe(5);
    expect(coupling.back).toBe(3);
    expect(coupling.percent).toBe(60);
  });

  it('groups the back edges by pair in the move order, each pair sorted by importer', () => {
    const coupling = readCoupling(PLANTED, MAP.unitOf);

    expect(coupling.pairs).toEqual([
      {
        edges: [value('src/effort/a.ts', 'src/run/a.ts'), value('src/effort/b.ts', 'src/run/a.ts')],
        from: 'rafa-effort',
        to: 'rafa-run',
      },
      { edges: [value('src/board/a.ts', 'src/pr/a.ts')], from: 'rafa-board', to: 'rafa-pr' },
    ]);
  });

  it('reads the move order, not the order the table lists its rows in', () => {
    // The table lists pr before release; by the move order release -> pr is back.
    const coupling = readCoupling([value('src/release/a.ts', 'src/pr/a.ts')], MAP.unitOf);

    expect(coupling.back).toBe(1);
  });

  it('answers zero of zero at 0% when no edge runs between two feature packages', () => {
    const coupling = readCoupling(PLANTED.slice(5), MAP.unitOf);

    expect(coupling).toEqual({ back: 0, pairs: [], percent: 0, total: 0 });
  });
});

describe('renderCoupling', () => {
  it('prints each pair with its edges, then the percent line', () => {
    expect(renderCoupling(readCoupling(PLANTED, MAP.unitOf))).toEqual([
      'rafa-effort -> rafa-run: 2',
      '  src/effort/a.ts -> src/run/a.ts',
      '  src/effort/b.ts -> src/run/a.ts',
      'rafa-board -> rafa-pr: 1',
      '  src/board/a.ts -> src/pr/a.ts',
      'back 3 of 5 value imports between feature packages, 60.0%',
    ]);
  });

  it('spells the percent with one decimal', () => {
    const coupling = readCoupling(PLANTED.slice(0, 4), MAP.unitOf);

    expect(renderCoupling(coupling).at(-1)).toBe('back 3 of 4 value imports between feature packages, 75.0%');
    expect(renderCoupling(readCoupling(PLANTED.slice(2, 5), MAP.unitOf)).at(-1)).toBe(
      'back 1 of 3 value imports between feature packages, 33.3%',
    );
  });
});

describe('isAboveMax', () => {
  const coupling = readCoupling(PLANTED, MAP.unitOf);

  it('passes with no gate, at the gate, and below it', () => {
    expect(isAboveMax(coupling, undefined)).toBe(false);
    expect(isAboveMax(coupling, 60)).toBe(false);
    expect(isAboveMax(coupling, 75)).toBe(false);
  });

  it('fails above the gate', () => {
    expect(isAboveMax(coupling, 59.9)).toBe(true);
  });
});

describe('isImporterFile', () => {
  it('reads a source file under src/ and packages/, and a script that is no test', () => {
    expect(isImporterFile('src/cli/x.ts')).toBe(true);
    expect(isImporterFile('packages/rafa/src/x.ts')).toBe(true);
    expect(isImporterFile('scripts/x.ts')).toBe(true);
  });

  it('refuses a test, a script test, a file of another extension and one outside the three folders', () => {
    expect(isImporterFile('src/board/a.test.ts')).toBe(false);
    expect(isImporterFile('scripts/x.test.ts')).toBe(false);
    expect(isImporterFile('src/cli/notes.json')).toBe(false);
    expect(isImporterFile('elsewhere/x.ts')).toBe(false);
  });
});

describe('readKept', () => {
  it('counts each file once per feature package it imports from outside, by an edge of either kind', () => {
    const kept = readKept(KEPT_EDGES, MAP.unitOf, KEPT_PAIRS);

    expect(kept.total).toBe(8);
    expect(kept.kept).toBe(4);
    expect(kept.percent).toBe(50);
  });

  it('counts a pair held by a type edge alone, which the back-edge line leaves out', () => {
    const typeEdge = [typeOnly('src/cli/x.ts', 'src/inventory/a.ts')];

    expect(readKept(typeEdge, MAP.unitOf, [pair('src/cli/x.ts', 'rafa-inventory')])).toEqual({ kept: 1, percent: 100, total: 1 });
    expect(readCoupling(typeEdge, MAP.unitOf).total).toBe(0);
  });

  it('counts a test importer for neither line, and a kept pair the graph lacks not at all', () => {
    const testEdge = [value('src/board/a.test.ts', 'src/run/a.ts')];

    expect(readKept(testEdge, MAP.unitOf, [pair('src/board/a.test.ts', 'rafa-run')])).toEqual({ kept: 0, percent: 0, total: 0 });
    expect(readCoupling(testEdge, MAP.unitOf).total).toBe(0);
    expect(readKept(KEPT_EDGES, MAP.unitOf, [pair('src/cli/x.ts', 'rafa-release')]).kept).toBe(0);
  });

  it('answers zero of zero at 0% when no file imports a feature package from outside', () => {
    expect(readKept(KEPT_EDGES.slice(9), MAP.unitOf, KEPT_PAIRS)).toEqual({ kept: 0, percent: 0, total: 0 });
  });
});

describe('renderKept', () => {
  it('prints the kept line with the percent to one decimal', () => {
    expect(renderKept(readKept(KEPT_EDGES, MAP.unitOf, KEPT_PAIRS))).toBe('kept 4 of 8 importers on relative paths, 50.0%');
    expect(renderKept(readKept(KEPT_EDGES, MAP.unitOf, KEPT_PAIRS.slice(0, 1)))).toBe(
      'kept 1 of 8 importers on relative paths, 12.5%',
    );
  });

  it('is gated by isAboveMax as the back-edge line is, on the printed figure', () => {
    const kept = readKept(KEPT_EDGES, MAP.unitOf, KEPT_PAIRS);

    expect(isAboveMax(kept, 50)).toBe(false);
    expect(isAboveMax(kept, 49.9)).toBe(true);
  });
});

describe('loadKeptReader', () => {
  let root = '';

  /** Writes `text` at `path` under the scratch root. */
  function plant(path: string, text: string): void {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'coupling-kept-'));
    const init = Bun.spawnSync(['git', 'init', '--quiet'], { cwd: root, stderr: 'pipe', stdout: 'pipe' });
    if (init.exitCode !== 0) {
      throw new Error(`git init exited ${init.exitCode}: ${init.stderr.toString()}`);
    }
    plant('src/effort/a.ts', 'export const a = 1;\n');
    plant('src/effort/b.ts', 'import { a } from \'./a\';\nexport const b = a;\n');
    plant('src/cli/x.ts', 'import { a } from \'../effort/a\';\nexport const x = a;\n');
    plant('src/cli/x.test.ts', 'import { a } from \'../effort/a\';\nexport const t = a;\n');
    plant('src/plan.ts', 'import { a } from \'@open-tomato/rafa-effort\';\nexport const p = a;\n');
    plant('scripts/y.ts', 'import { a } from \'../src/effort/a\';\nexport const y = a;\n');
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('reads the files git lists under the live cut rules and resolver: a relative import outside the package, never a test, a bare name or the package itself', async () => {
    const readKeptPairs = await loadKeptReader();

    expect(readKeptPairs(root)).toEqual([pair('scripts/y.ts', 'rafa-effort'), pair('src/cli/x.ts', 'rafa-effort')]);
  });
});

describe('parseCouplingArgs', () => {
  it('reads the defaults with no argument', () => {
    expect(parseCouplingArgs([])).toEqual({ graph: DEFAULT_GRAPH, map: DEFAULT_MAP, max: undefined });
  });

  it('reads the three flags in any order', () => {
    expect(parseCouplingArgs(['--max=20', '--map=m.json', '--graph=g.json'])).toEqual({
      graph: 'g.json',
      map: 'm.json',
      max: 20,
    });
  });

  it('refuses an unknown argument, a flag twice, an empty value and a --max that is no percent', () => {
    expect(() => parseCouplingArgs(['--dry-run'])).toThrow('refused argument --dry-run');
    expect(() => parseCouplingArgs(['--max=1', '--max=2'])).toThrow('refused argument --max=2');
    expect(() => parseCouplingArgs(['--graph='])).toThrow('refused argument --graph=');
    expect(() => parseCouplingArgs(['--max=lots'])).toThrow('--max must be a percent');
    expect(() => parseCouplingArgs(['--max=-1'])).toThrow('--max must be a percent');
  });
});

describe('parseGraphEdges', () => {
  it('reads the edges and leaves the other keys alone', () => {
    const text = JSON.stringify({ edges: [value('src/a.ts', 'src/b.ts')], nodes: ['src/a.ts', 'src/b.ts'] });

    expect(parseGraphEdges(text, 'g.json')).toEqual([value('src/a.ts', 'src/b.ts')]);
  });

  it('refuses text that is not JSON, a graph with no edges, and an edge of another kind', () => {
    expect(() => parseGraphEdges('{', 'g.json')).toThrow('g.json: the import graph is not JSON');
    expect(() => parseGraphEdges('{}', 'g.json')).toThrow('g.json: the import graph holds no edges array');
    expect(() => parseGraphEdges(JSON.stringify({ edges: [{ from: 'a', kind: 'runtime', to: 'b' }] }), 'g.json')).toThrow(
      'g.json: edge 0 is not a from, a to and a kind of type or value',
    );
  });
});

describe('main', () => {
  let root = '';
  const none = plantedReader([]);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'coupling-'));
    writeFileSync(join(root, 'graph.json'), JSON.stringify({ edges: PLANTED }));
    writeFileSync(join(root, 'kept-graph.json'), JSON.stringify({ edges: KEPT_EDGES }));
    writeFileSync(join(root, 'table.json'), JSON.stringify(TABLE));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('reads the files the flags name and exits 0 at or under --max', () => {
    const run = main(root, ['--graph=graph.json', '--map=table.json', '--max=60'], none);

    expect(run.exitCode).toBe(0);
    expect(run.lines.at(-2)).toBe('back 3 of 5 value imports between feature packages, 60.0%');
  });

  it('exits 1 above --max, and 0 with no --max', () => {
    expect(main(root, ['--graph=graph.json', '--map=table.json', '--max=20'], none).exitCode).toBe(1);
    expect(main(root, [`--graph=${join(root, 'graph.json')}`, '--map=table.json'], none).exitCode).toBe(0);
  });

  it('prints the kept line after the back-edge line, from the pairs the reader answers for the root', () => {
    const roots: string[] = [];
    const run = main(root, ['--graph=kept-graph.json', '--map=table.json'], (asked) => {
      roots.push(asked);
      return KEPT_PAIRS;
    });

    expect(roots).toEqual([root]);
    expect(run.lines.slice(-2)).toEqual([
      'back 1 of 3 value imports between feature packages, 33.3%',
      'kept 4 of 8 importers on relative paths, 50.0%',
    ]);
  });

  it('exits 1 when the kept line alone is over --max, and 0 when neither is', () => {
    const reader = plantedReader(KEPT_PAIRS);

    expect(main(root, ['--graph=kept-graph.json', '--map=table.json', '--max=40'], reader).exitCode).toBe(1);
    expect(main(root, ['--graph=kept-graph.json', '--map=table.json', '--max=40'], none).exitCode).toBe(0);
    expect(main(root, ['--graph=kept-graph.json', '--map=table.json', '--max=50'], reader).exitCode).toBe(0);
  });
});
