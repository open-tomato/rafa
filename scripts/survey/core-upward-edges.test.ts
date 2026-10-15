import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

const CUT_TABLE_PATH = fileURLToPath(new URL('../../docs/survey/cut-table.json', import.meta.url));
const CORE_PACKAGE_NAME = '@open-tomato/rafa';

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
  readonly clearedByIssue118: readonly unknown[];
  readonly packages: readonly TablePackage[];
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
});
