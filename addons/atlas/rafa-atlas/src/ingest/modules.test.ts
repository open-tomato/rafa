/**
 * Tests for the module ingest over a tree written in a tmpdir: two
 * packages, `packages/alpha` and `packages/beta`, one importing the other
 * each way, alpha holding a test file and a `node_modules`, `dist` and
 * `.tsbuild` folder the walk leaves out, and no cut table, so every
 * `upward_edges` reads NULL and the stamp says so. A second root adds a
 * cut table as the control that the column can be read. The counts
 * `derive.ts` takes from the effort buckets are read over rows inserted
 * by hand, and one build over the effort fixture store checks the stamp
 * and the rows in the replica.
 */
import type { ModuleIngest } from './modules.js';
import type { Database } from 'bun:sqlite';

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { writeReplica } from '@open-tomato/atlas-data/replica';
import { afterAll, describe, expect, it } from 'bun:test';

import { countModuleFacts } from '../build/derive.js';
import { buildAtlas } from '../build/index.js';

import {
  CUT_TABLE_FILE,
  importedPackagesOf,
  ingestModules,
  locOf,
  MODULES_SOURCE,
  parseCutTable,
  upwardEdgesOf,
} from './modules.js';
import { writeFixtureStore } from './testdata/effort-store.fixture.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-ingest-modules-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const READ_AT = new Date('2026-11-06T12:00:00.000Z');

type Row = Readonly<Record<string, string | number | null>>;

/** The files of the fixture tree, by path under the root. */
const TREE: Readonly<Record<string, string>> = {
  'packages/alpha/package.json': JSON.stringify({ name: '@open-tomato/alpha' }),
  'packages/alpha/src/index.ts': [
    'import type { Shape } from \'@open-tomato/beta/shapes\';',
    '',
    'import { chart } from \'@open-tomato/charts\';',
    'export const draw = (shape: Shape): string => chart(shape);',
    '',
  ].join('\n'),
  'packages/alpha/src/index.test.ts': [
    'import { draw } from \'@open-tomato/alpha\';',
    'it(\'draws\', () => draw(null));',
  ].join('\n'),
  'packages/alpha/README.md': '# alpha\n\nimport x from \'@open-tomato/never\';\n',
  'packages/alpha/node_modules/@open-tomato/gamma/index.ts': 'import \'@open-tomato/gamma-dep\';\nexport const a = 1;\n',
  'packages/alpha/dist/index.js': 'require(\'@open-tomato/dist-dep\');\n',
  'packages/alpha/.tsbuild/index.d.ts': 'export declare const draw: unknown;\n',
  'packages/beta/package.json': JSON.stringify({ name: '@open-tomato/beta' }),
  'packages/beta/src/shapes.ts': [
    'export { draw } from \'@open-tomato/alpha\';',
    'export type Shape = unknown;',
    '',
  ].join('\n'),
};

/** Write `files` under `root`. */
function writeTree(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/** A cut table covering alpha's folder, with one upward edge leaving it. */
const CUT_TABLE = JSON.stringify({
  packages: [
    {
      name: 'alpha',
      folders: ['packages/alpha/'],
      edges: [{ from: 'packages/alpha/src/index.ts', to: 'packages/beta/src/shapes.ts', kind: 'type' }],
    },
  ],
});

/** A root holding the fixture tree, and `extra` beside it. */
function rootWith(name: string, extra: Readonly<Record<string, string>> = {}): string {
  const root = join(scope, name);
  writeTree(root, { ...TREE, ...extra });
  return root;
}

let built = 0;

/** Run the ingest over `root` into a fresh replica, then `after` in the same build; answers the ingest and the rows. */
async function ingestAt(
  root: string,
  after: (database: Database) => void = () => undefined,
): Promise<{ readonly ingest: ModuleIngest; readonly rows: readonly Row[] }> {
  built += 1;
  const path = join(scope, 'replicas', String(built), 'atlas.sqlite');
  const result = await writeReplica({ replicaPath: path, projectLabel: 'modules-fixture' }, (build) => {
    const ingest = ingestModules(build, { root, now: () => READ_AT });
    after(build.database);
    return { ingest, rows: build.database.query<Row, []>('SELECT * FROM module_facts ORDER BY path').all() };
  });
  return result.value;
}

/** The row of `path`, or a failed expectation. */
function moduleRow(rows: readonly Row[], path: string): Row {
  const row = rows.find((each) => each['path'] === path);
  expect(row).toBeDefined();
  return row ?? {};
}

describe('ingestModules over a tree of two packages with no cut table', () => {
  it('writes one row per package, its own package.json name beside it', async () => {
    const { rows, ingest } = await ingestAt(rootWith('plain'));

    expect(rows.map((row) => [row['path'], row['package']])).toEqual([
      ['packages/alpha', '@open-tomato/alpha'],
      ['packages/beta', '@open-tomato/beta'],
    ]);
    expect(ingest).toEqual(expect.objectContaining({ modules: 2, cutTableRead: false }));
  });

  it('counts source files and their non-blank lines, tests apart, leaving out node_modules, dist and .tsbuild', async () => {
    const { rows } = await ingestAt(rootWith('counts'));

    expect(moduleRow(rows, 'packages/alpha')).toEqual(expect.objectContaining({ files: 1, loc: 3, test_files: 1, test_loc: 2 }));
    expect(moduleRow(rows, 'packages/beta')).toEqual(expect.objectContaining({ files: 1, loc: 2, test_files: 0, test_loc: 0 }));
  });

  it('lists the @open-tomato packages each imports, its own left out, and the skipped folders\' imports not at all', async () => {
    const { rows } = await ingestAt(rootWith('imports'));

    expect(JSON.parse(String(moduleRow(rows, 'packages/alpha')['imports_json']))).toEqual(['@open-tomato/beta', '@open-tomato/charts']);
    expect(JSON.parse(String(moduleRow(rows, 'packages/beta')['imports_json']))).toEqual(['@open-tomato/alpha']);
  });

  it('counts one edge each way as a fan-in and a fan-out of one on both, the package outside the tree on neither', async () => {
    const { rows } = await ingestAt(rootWith('fan'));

    expect(moduleRow(rows, 'packages/alpha')).toEqual(expect.objectContaining({ fan_in: 1, fan_out: 1 }));
    expect(moduleRow(rows, 'packages/beta')).toEqual(expect.objectContaining({ fan_in: 1, fan_out: 1 }));
  });

  it('reads upward_edges NULL on every module and stamps local.modules partial naming the cut table', async () => {
    const { rows, ingest } = await ingestAt(rootWith('no-table'));

    expect(rows.map((row) => row['upward_edges'])).toEqual([null, null]);
    expect(ingest.stamps).toEqual([{
      source: MODULES_SOURCE,
      asOf: READ_AT.toISOString(),
      readAt: READ_AT.toISOString(),
      rows: 2,
      partial: true,
      reason: `no cut table read: no file at ${CUT_TABLE_FILE}; upward_edges reads NULL`,
    }]);
  });

  it('control: with a cut table, counts the edges leaving a module it covers and leaves one it does not NULL', async () => {
    const { rows, ingest } = await ingestAt(rootWith('with-table', { [CUT_TABLE_FILE]: CUT_TABLE }));

    expect(moduleRow(rows, 'packages/alpha')['upward_edges']).toBe(1);
    expect(moduleRow(rows, 'packages/beta')['upward_edges']).toBeNull();
    expect(ingest.stamps[0]).toEqual(expect.objectContaining({ partial: false, reason: null }));
  });

  it('writes no row for a root with no module folder and stamps it partial, naming the globs', async () => {
    const root = join(scope, 'empty');
    mkdirSync(root, { recursive: true });

    const { rows, ingest } = await ingestAt(root);

    expect(rows).toEqual([]);
    expect(ingest.stamps[0]?.reason).toContain('the module globs packages/*, src/*, addons/* name no folder under the root');
  });
});

describe('the module readers', () => {
  it('reads the package of from, import, import( and require( specifiers, a subpath as its package, each once', () => {
    const text = [
      'import type { A } from \'@open-tomato/one/sub/path\';',
      'import \'@open-tomato/two\';',
      'const b = await import("@open-tomato/three");',
      'const c = require(\'@open-tomato/one\');',
      'const d = \'@open-tomato/not-an-import\';',
    ].join('\n');

    expect(importedPackagesOf(text)).toEqual(['@open-tomato/one', '@open-tomato/two', '@open-tomato/three']);
  });

  it('counts the lines holding anything but white space', () => {
    expect(locOf('a\n\n  \n\tb\n')).toBe(2);
    expect(locOf('')).toBe(0);
  });

  it('refuses a cut table that does not parse or holds no packages list, so every module reads NULL', () => {
    const broken = parseCutTable('{');
    const empty = parseCutTable('{}');

    expect(broken.ok).toBe(false);
    expect(empty).toEqual({ ok: false, reason: `${CUT_TABLE_FILE} holds no packages list` });
    expect(upwardEdgesOf(empty, 'packages/alpha')).toBeNull();
    expect(upwardEdgesOf(parseCutTable(CUT_TABLE), 'packages/alpha')).toBe(1);
  });
});

describe('countModuleFacts over the effort buckets', () => {
  it('counts out-of-scope bugs, findings with a kind and changes by module, a routed bug and a blocker not at all', async () => {
    const { rows } = await ingestAt(rootWith('counted'), (database) => {
      database.run(`INSERT INTO bug_facts (id, source, module) VALUES
        ('b1', 'out_of_scope', 'packages/alpha'), ('b2', 'routed', 'packages/alpha'), ('b3', 'out_of_scope', NULL)`);
      database.run(`INSERT INTO finding_facts (id, source, module) VALUES
        ('f1', 'finding', 'packages/alpha'), ('f2', 'blocker', 'packages/alpha'), ('f3', 'finding', 'packages/beta')`);
      database.run('INSERT INTO change_facts (id, module) VALUES (\'c1\', \'packages/beta\'), (\'c2\', \'packages/beta\')');
      expect(countModuleFacts(database)).toBe(2);
    });

    expect(moduleRow(rows, 'packages/alpha')).toEqual(expect.objectContaining({ bugs: 1, findings: 1, changes: 0 }));
    expect(moduleRow(rows, 'packages/beta')).toEqual(expect.objectContaining({ bugs: 0, findings: 1, changes: 2 }));
  });

  it('control: before the count the columns read NULL', async () => {
    const { rows } = await ingestAt(rootWith('uncounted'));

    expect(rows.map((row) => [row['bugs'], row['findings'], row['changes']])).toEqual([[null, null, null], [null, null, null]]);
  });
});

describe('buildAtlas over the tree', () => {
  it('fills module_facts and stamps local.modules between the board and the derived sources', async () => {
    const root = rootWith('build');
    writeFixtureStore(root);

    const summary = await buildAtlas({ projectRoot: root, env: {}, now: () => READ_AT, projectLabel: 'modules-fixture' });

    expect(summary.tables).toEqual(expect.objectContaining({ module_facts: 2 }));
    expect(summary.sources.map((stamp) => stamp.source).slice(8, 11)).toEqual(['local.board', MODULES_SOURCE, 'local.daily']);
    expect(summary.sources.find((stamp) => stamp.source === MODULES_SOURCE)).toEqual(expect.objectContaining({ rows: 2, partial: true }));
  });
});
