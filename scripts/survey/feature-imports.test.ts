import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

const CUT_TABLE_PATH = fileURLToPath(new URL('../../docs/survey/cut-table.json', import.meta.url));
const CLI_PACKAGE_NAME = '@open-tomato/rafa';
const FEATURE_PACKAGES: readonly string[] = [
  'rafa-board',
  'rafa-pr',
  'rafa-run',
  'rafa-release',
  'rafa-effort',
  'rafa-inventory',
];

interface TableEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly toPackage: string;
}

interface TablePackage {
  readonly name: string;
  readonly edges: readonly TableEdge[];
}

interface CutTable {
  readonly leftToPlace: readonly { readonly path: string }[];
  readonly packages: readonly TablePackage[];
}

function readCutTable(): CutTable {
  return JSON.parse(readFileSync(CUT_TABLE_PATH, 'utf8')) as CutTable;
}

/** Edges of the feature packages into the CLI package, each `{ package, edge }`. */
function featureEdgesIntoCli(table: CutTable): readonly { readonly pkg: string; readonly edge: TableEdge }[] {
  return table.packages
    .filter((pkg) => FEATURE_PACKAGES.includes(pkg.name))
    .flatMap((pkg) => pkg.edges.filter((edge) => edge.toPackage === CLI_PACKAGE_NAME).map((edge) => ({ pkg: pkg.name, edge })));
}

/** The edges that land on a file left to place, as `importer -> target (kind, package)`. */
function edgesOnLeftToPlace(table: CutTable): readonly string[] {
  const left = new Set(table.leftToPlace.map((file) => file.path));

  return featureEdgesIntoCli(table)
    .filter(({ edge }) => left.has(edge.to))
    .map(({ pkg, edge }) => `${edge.from} -> ${edge.to} (${edge.kind}, ${pkg})`);
}

describe('cut table: feature packages and the files left to place', () => {
  it('lists no feature edge into the CLI that lands on a file left to place', () => {
    expect(edgesOnLeftToPlace(readCutTable())).toEqual([]);
  });

  // The live table held one feature edge into the CLI until the parser
  // moved into core: `packages/rafa-run/src/next/actions.ts` to `src/cli/core/parseArgs.ts`.
  // With it gone the case above holds for want of any edge, so the planted
  // table below is its control.
  it('reads no feature edge into the CLI at all, while files are still left to place', () => {
    const table = readCutTable();
    const edges = featureEdgesIntoCli(table).map(({ pkg, edge }) => `${edge.from} -> ${edge.to} (${edge.kind}, ${pkg})`);

    expect(table.leftToPlace.length).toBeGreaterThan(0);
    expect(edges).toEqual([]);
  });

  it('names importer and target for an edge a planted table lands on a left-to-place file', () => {
    const planted: CutTable = {
      leftToPlace: [{ path: 'src/left.ts' }],
      packages: [
        {
          name: 'rafa-pr',
          edges: [{ from: 'src/pr/a.ts', to: 'src/left.ts', kind: 'value', toPackage: CLI_PACKAGE_NAME }],
        },
      ],
    };

    expect(edgesOnLeftToPlace(planted)).toEqual(['src/pr/a.ts -> src/left.ts (value, rafa-pr)']);
  });
});
