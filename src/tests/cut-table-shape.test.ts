import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

interface CutPackage {
  readonly name: string;
  readonly folders: readonly string[];
  readonly upwardEdges: number;
}

interface CutEdge {
  readonly clearedBy: number;
}

interface CutTable {
  readonly packages: readonly CutPackage[];
  readonly unassigned: readonly { readonly folder: string }[];
  readonly clearedByIssue118: readonly CutEdge[];
}

const ROOT = join(import.meta.dir, '..', '..');
const TABLE_PATH = join(ROOT, 'docs', 'survey', 'cut-table.json');
const PACKAGE_COUNT = 10;
const UNASSIGNED_FOLDERS = ['src/ci/', 'src/commands/stretch/', 'src/stretch/'];

const table = (await Bun.file(TABLE_PATH).json()) as CutTable;

describe('docs/survey/cut-table.json', () => {
  test('holds ten packages, each with an integer upward-edge count', () => {
    expect(table.packages).toHaveLength(PACKAGE_COUNT);
    for (const pkg of table.packages) {
      expect(Number.isInteger(pkg.upwardEdges)).toBe(true);
      expect(pkg.upwardEdges).toBeGreaterThanOrEqual(0);
    }
  });

  test('names each package once', () => {
    const names = table.packages.map((pkg) => pkg.name);
    expect(new Set(names).size).toBe(PACKAGE_COUNT);
  });

  test('every assigned folder is present in the tree', () => {
    const missing = table.packages
      .flatMap((pkg) => pkg.folders)
      .filter((folder) => {
        const path = join(ROOT, folder);
        return !existsSync(path) || !statSync(path).isDirectory();
      });
    expect(missing).toEqual([]);
  });

  test('lists the three unassigned folders', () => {
    expect(table.unassigned.map((entry) => entry.folder).slice()
      .sort()).toEqual(
      UNASSIGNED_FOLDERS,
    );
  });

  test('marks at least one edge as cleared by issue 118', () => {
    expect(table.clearedByIssue118.length).toBeGreaterThan(0);
    for (const edge of table.clearedByIssue118) {
      expect(edge.clearedBy).toBe(118);
    }
  });
});
