import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

const CUT_TABLE_PATH = fileURLToPath(new URL('../../docs/survey/cut-table.json', import.meta.url));
const CORE_PACKAGE_NAME = '@open-tomato/rafa';
const STORE_PREFIX = 'src/effort/store/';

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

describe('cut table: effort store upward edges', () => {
  it('lists no upward edge of core that starts in src/effort/store/', () => {
    const table = JSON.parse(readFileSync(CUT_TABLE_PATH, 'utf8')) as { packages: TablePackage[] };
    const core = table.packages.find((pkg) => pkg.name === CORE_PACKAGE_NAME);
    expect(core).toBeDefined();

    const offenders = (core?.edges ?? [])
      .filter((edge) => edge.from.startsWith(STORE_PREFIX))
      .map((edge) => `${edge.from} -> ${edge.to} (${edge.kind}, ${edge.toPackage})`);

    expect(offenders).toEqual([]);
  });
});
