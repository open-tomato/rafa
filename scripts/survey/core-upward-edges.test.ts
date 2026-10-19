import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import { CUT_RULES } from './cut-table';

const CUT_TABLE_PATH = fileURLToPath(new URL('../../docs/survey/cut-table.json', import.meta.url));
const GRAPH_FILE_PATH = fileURLToPath(new URL('../../docs/survey/import-graph.json', import.meta.url));
const SHARED_CONFIG_PACKAGES: readonly string[] = ['rafa-typescript-config', 'rafa-eslint-config'];
const CORE_PACKAGE_NAME = '@open-tomato/rafa-core';

interface TableEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly toPackage: string;
}

interface TablePackage {
  readonly name: string;
  readonly edges: readonly TableEdge[];
  readonly files: readonly string[];
}

interface TableFolder {
  readonly folder: string;
  readonly files: readonly string[];
}

interface CutTable {
  readonly clearedByIssue118: readonly unknown[];
  readonly order: readonly string[];
  readonly packages: readonly TablePackage[];
  readonly unassigned: readonly TableFolder[];
}

function readCutTable(): CutTable {
  return JSON.parse(readFileSync(CUT_TABLE_PATH, 'utf8')) as CutTable;
}

describe('cut table: core upward edges', () => {
  it('lists no upward edge of core from any file', () => {
    const core = readCutTable().packages.find((pkg) => pkg.name === CORE_PACKAGE_NAME);
    expect(core).toBeDefined();

    const offenders = (core?.edges ?? []).map(
      (edge) => `${edge.from} -> ${edge.to} (${edge.kind}, ${edge.toPackage})`,
    );

    expect(offenders).toEqual([]);
  });

  it('reads a table that lists edges of other packages, so core\'s empty list is not vacuous', () => {
    const packages = readCutTable().packages;

    expect(packages.some((pkg) => pkg.name !== CORE_PACKAGE_NAME && pkg.edges.length > 0)).toBe(true);
  });

  it('holds clearedByIssue118 at 0', () => {
    expect(readCutTable().clearedByIssue118).toHaveLength(0);
  });

  describe('against the tree', () => {
    /** The graph's node paths that the table lists zero times or more than once, as `path xN`. */
    function misplacedPaths(table: CutTable, paths: readonly string[]): readonly string[] {
      const counts = new Map<string, number>();
      const lists = [...table.packages.map((pkg) => pkg.files), ...table.unassigned.map((folder) => folder.files)];
      for (const list of lists) {
        for (const path of list) {
          counts.set(path, (counts.get(path) ?? 0) + 1);
        }
      }

      return paths.filter((path) => (counts.get(path) ?? 0) !== 1).map((path) => `${path} x${counts.get(path) ?? 0}`);
    }

    const graphPaths = (JSON.parse(readFileSync(GRAPH_FILE_PATH, 'utf8')) as { nodes: readonly { path: string }[] }).nodes.map(
      (node) => node.path,
    );

    it('orders the packages as CUT_RULES lists them', () => {
      expect(readCutTable().order).toEqual(CUT_RULES.packages.map((pkg) => pkg.name));
    });

    it('lists every graph node in exactly one package row or unassigned folder', () => {
      expect(graphPaths.length).toBeGreaterThan(0);
      expect(misplacedPaths(readCutTable(), graphPaths)).toEqual([]);
    });

    it('has a row for each shared-config package', () => {
      const names = readCutTable().packages.map((pkg) => pkg.name);

      for (const name of SHARED_CONFIG_PACKAGES) {
        expect(names).toContain(name);
      }
    });

    it('reports a file a planted table drops', () => {
      const table = readCutTable();
      const dropped = graphPaths[0] ?? '';
      const planted: CutTable = {
        ...table,
        packages: table.packages.map((pkg) => ({ ...pkg, files: pkg.files.filter((path) => path !== dropped) })),
        unassigned: table.unassigned.map((folder) => ({ ...folder, files: folder.files.filter((path) => path !== dropped) })),
      };

      expect(misplacedPaths(planted, graphPaths)).toEqual([`${dropped} x0`]);
    });
  });
});
