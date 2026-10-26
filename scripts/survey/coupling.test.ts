import type { CouplingEdge } from './coupling';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  DEFAULT_GRAPH,
  DEFAULT_MAP,
  isAboveMax,
  main,
  MOVE_ORDER,
  parseCouplingArgs,
  parseGraphEdges,
  readCoupling,
  renderCoupling,
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

describe('MOVE_ORDER', () => {
  it('holds the six feature packages in the order the spec names', () => {
    expect(MOVE_ORDER).toEqual(['rafa-effort', 'rafa-inventory', 'rafa-board', 'rafa-release', 'rafa-pr', 'rafa-run']);
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

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'coupling-'));
    writeFileSync(join(root, 'graph.json'), JSON.stringify({ edges: PLANTED }));
    writeFileSync(join(root, 'table.json'), JSON.stringify(TABLE));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('reads the files the flags name and exits 0 at or under --max', () => {
    const run = main(root, ['--graph=graph.json', '--map=table.json', '--max=60']);

    expect(run.exitCode).toBe(0);
    expect(run.lines.at(-1)).toBe('back 3 of 5 value imports between feature packages, 60.0%');
  });

  it('exits 1 above --max, and 0 with no --max', () => {
    expect(main(root, ['--graph=graph.json', '--map=table.json', '--max=20']).exitCode).toBe(1);
    expect(main(root, [`--graph=${join(root, 'graph.json')}`, '--map=table.json']).exitCode).toBe(0);
  });
});
