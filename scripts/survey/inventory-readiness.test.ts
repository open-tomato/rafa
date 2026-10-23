/**
 * The readiness case for pass 4's first move, inventory's: the reading that
 * move starts from. The table's edges are imports of kind `value` or `type`
 * between two non-test files, from a package lower in the cut table's order
 * into a higher one. Inventory is the lowest feature package in `CUT_RULES`,
 * above the two shared configs and core (which nothing in inventory imports),
 * so an edge out of an inventory file into any package but core or inventory
 * is one of these, and the row must list none.
 *
 * The case goes stale only with `docs/survey/cut-table.json`, which
 * `scripts/survey/maps.test.ts` does not check and the survey task of each
 * item regenerates.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

const CUT_TABLE_PATH = fileURLToPath(new URL('../../docs/survey/cut-table.json', import.meta.url));
const INVENTORY_PACKAGE_NAME = 'rafa-inventory';
const BOARD_PACKAGE_NAME = 'rafa-board';

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

interface CutTable {
  readonly packages: readonly TablePackage[];
}

function readCutTable(): CutTable {
  return JSON.parse(readFileSync(CUT_TABLE_PATH, 'utf8')) as CutTable;
}

/** The edges of a package's row, each as `importer -> target (kind, package)`. */
function namedEdges(table: CutTable, packageName: string): readonly string[] {
  const row = table.packages.find((pkg) => pkg.name === packageName);

  return (row?.edges ?? []).map((edge) => `${edge.from} -> ${edge.to} (${edge.kind}, ${edge.toPackage})`);
}

describe('cut table: inventory readiness', () => {
  it('lists no edge out of any inventory file', () => {
    expect(namedEdges(readCutTable(), INVENTORY_PACKAGE_NAME)).toEqual([]);
  });

  it('reads a row that lists files and a table whose board row lists edges, so the empty list is not vacuous', () => {
    const packages = readCutTable().packages;

    expect(packages.find((pkg) => pkg.name === INVENTORY_PACKAGE_NAME)?.files.length ?? 0).toBeGreaterThan(0);
    expect(packages.find((pkg) => pkg.name === BOARD_PACKAGE_NAME)?.edges.length ?? 0).toBeGreaterThan(0);
  });

  it('names an edge a planted table carries as importer -> target (kind, package)', () => {
    const planted: CutTable = {
      packages: [
        {
          name: INVENTORY_PACKAGE_NAME,
          files: ['src/inventory/a.ts'],
          edges: [{ from: 'src/inventory/a.ts', to: 'src/effort/b.ts', kind: 'value', toPackage: 'rafa-effort' }],
        },
      ],
    };

    expect(namedEdges(planted, INVENTORY_PACKAGE_NAME)).toEqual([
      'src/inventory/a.ts -> src/effort/b.ts (value, rafa-effort)',
    ]);
  });
});
