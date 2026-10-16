import type { WorkspaceMember } from './package-entries';
import type { TestIndexEntry } from './test-index';
import type { RecordInput, TestRecord } from './test-index-record';

import { describe, expect, it } from 'bun:test';

import { TESTS_DEFAULTS } from '../../src/config-schema-tests';

import { parseCutMap } from './cut-map';
import { meetsRule, parseRecord, recordEntry, renderRecordJson } from './test-index-record';

/** The defaults, as a project with no `tests` key reads them. */
const GLOBS = { contract: TESTS_DEFAULTS.testsContract, integration: TESTS_DEFAULTS.testsIntegration };

const CORE_STORE = 'packages/rafa/src/effort/store/index.ts';
const CORE_SQLITE = 'packages/rafa/src/effort/store/sqlite.ts';
const BOARD_SYNC = 'src/board/sync.ts';
const RUN_LOOP = 'src/run/loop.ts';

/** A planted cut table: core, run and board, the board a projected package with no manifest. */
const MAP = parseCutMap(JSON.stringify({
  packages: [
    { files: [CORE_STORE, CORE_SQLITE], name: '@open-tomato/rafa-core' },
    {
      files: [RUN_LOOP, 'src/run/loop.test.ts', 'src/run/loop-spawned.test.ts', 'src/run/loop.contract.test.ts'],
      name: 'rafa-run',
    },
    { files: [BOARD_SYNC], name: 'rafa-board' },
  ],
  unassigned: [],
}), 'docs/survey/cut-table.json');

/** Core is the one member: its manifest exports `./store` and `./store/*`. */
const MEMBERS: readonly WorkspaceMember[] = [
  { exports: ['./store', './store/*'], folder: 'packages/rafa/', name: '@open-tomato/rafa-core' },
];

/** Where each specifier lands, whatever file imports it; a specifier absent here resolves to nothing. */
const LANDINGS: ReadonlyMap<string, string> = new Map([
  ['./loop.js', RUN_LOOP],
  ['../board/sync.js', BOARD_SYNC],
  ['@open-tomato/rafa-board', BOARD_SYNC],
  ['@open-tomato/rafa/store', CORE_STORE],
  ['@open-tomato/rafa/store/sqlite', CORE_SQLITE],
  ['@open-tomato/rafa/effort/store/sqlite', CORE_SQLITE],
  ['../../packages/rafa/src/effort/store/sqlite.js', CORE_SQLITE],
  ['typescript', '/elsewhere/node_modules/typescript/lib/typescript.js'],
  ['bun:test', 'bun:test'],
]);

/** The input for one test whose text imports `specifiers`. */
function inputFor(test: string, specifiers: readonly string[]): RecordInput {
  const text = specifiers.map((specifier, at) => `import * as m${at} from '${specifier}';`).join('\n');
  return {
    globs: GLOBS,
    map: MAP,
    members: MEMBERS,
    resolve: (specifier) => LANDINGS.get(specifier),
    sources: new Map([[test, text]]),
  };
}

/** An index entry for `test` whose walk reached `folders`. */
function entryFor(test: string, folders: readonly string[], spawnsVia: readonly string[] = []): TestIndexEntry {
  return {
    folder: MAP.unitOf(test),
    folders,
    index: folders.length,
    sourceFiles: folders.length,
    spawns: spawnsVia.length > 0,
    spawnsVia,
    support: [],
    supportFolders: [],
    test,
  };
}

/** Reads one planted test into its record. */
function record(test: string, folders: readonly string[], specifiers: readonly string[]): TestRecord {
  return recordEntry(entryFor(test, folders), inputFor(test, specifiers));
}

describe('recordEntry', () => {
  it('meets the unit rule for a unit test reaching only its own unit, ignoring a landing outside the repository and an unresolved one', () => {
    const read = record('src/run/loop.test.ts', ['rafa-run'], ['./loop.js', 'bun:test', 'typescript', '../nowhere.js']);
    expect(read).toEqual({
      deep: [],
      kind: 'unit',
      meets: true,
      package: 'rafa-run',
      packages: ['rafa-run'],
      spawns: false,
      spawnsVia: [],
    });
  });

  it('fails the unit rule for a unit test reaching a second unit, and names the import deep', () => {
    const read = record('src/run/loop.test.ts', ['rafa-board', 'rafa-run'], ['./loop.js', '../board/sync.js']);
    expect(read.kind).toBe('unit');
    expect(read.packages).toEqual(['rafa-board', 'rafa-run']);
    expect(read.deep).toEqual(['../board/sync.js']);
    expect(read.meets).toBe(false);
  });

  it('meets the use-case rule for a test importing core through @open-tomato/rafa/store, though its walk reaches core', () => {
    const read = record('src/run/loop-spawned.test.ts', ['@open-tomato/rafa-core', 'rafa-run'], ['@open-tomato/rafa/store', './loop.js']);
    expect(read.kind).toBe('use-case');
    expect(read.deep).toEqual([]);
    expect(read.meets).toBe(true);
  });

  it('holds a landing on a wildcard key public and a subpath no key names deep', () => {
    const read = record('src/run/loop-spawned.test.ts', ['@open-tomato/rafa-core'], [
      '@open-tomato/rafa/store/sqlite',
      '@open-tomato/rafa/effort/store/sqlite',
    ]);
    expect(read.deep).toEqual(['@open-tomato/rafa/effort/store/sqlite']);
  });

  it('fails the use-case rule for a test importing core through a deep relative path', () => {
    const read = record('src/run/loop-spawned.test.ts', ['@open-tomato/rafa-core', 'rafa-run'], [
      '../../packages/rafa/src/effort/store/sqlite.js',
      './loop.js',
    ]);
    expect(read.deep).toEqual(['../../packages/rafa/src/effort/store/sqlite.js']);
    expect(read.meets).toBe(false);
  });

  it('names every import of a projected package with no manifest deep, bare or relative', () => {
    const read = record('src/run/loop-spawned.test.ts', ['rafa-board', 'rafa-run'], ['@open-tomato/rafa-board', '../board/sync.js']);
    expect(read.deep).toEqual(['../board/sync.js', '@open-tomato/rafa-board']);
    expect(read.meets).toBe(false);
  });

  it('reads a contract test by its name and holds it to its own unit', () => {
    const read = record('src/run/loop.contract.test.ts', ['@open-tomato/rafa-core', 'rafa-run'], ['@open-tomato/rafa/store']);
    expect(read.kind).toBe('contract');
    expect(read.deep).toEqual([]);
    expect(read.meets).toBe(false);
  });

  it('carries the entry\'s spawn reading', () => {
    const test = 'src/run/loop-spawned.test.ts';
    const read = recordEntry(entryFor(test, ['rafa-run'], [test]), inputFor(test, []));
    expect(read.spawns).toBe(true);
    expect(read.spawnsVia).toEqual([test]);
  });

  it('refuses a test the map holds no unit for, naming it and the map', () => {
    expect(() => record('src/stray.test.ts', [], [])).toThrow('src/stray.test.ts: the map docs/survey/cut-table.json holds no unit for the test');
  });
});

describe('meetsRule', () => {
  const base = { deep: [], package: 'rafa-run', packages: ['rafa-run'], spawns: false, spawnsVia: [] };

  it('holds a unit and a contract test to nothing but their own unit', () => {
    for (const kind of ['unit', 'contract'] as const) {
      expect(meetsRule({ ...base, kind })).toBe(true);
      expect(meetsRule({ ...base, kind, packages: [] })).toBe(true);
      expect(meetsRule({ ...base, kind, packages: ['rafa-board', 'rafa-run'] })).toBe(false);
    }
  });

  it('holds a use-case test to an empty deep list, whatever its walk reaches', () => {
    expect(meetsRule({ ...base, kind: 'use-case', packages: ['rafa-board', 'rafa-run'] })).toBe(true);
    expect(meetsRule({ ...base, deep: ['../board/sync.js'], kind: 'use-case' })).toBe(false);
  });
});

const HEADER = {
  binReach: ['@open-tomato/rafa', 'rafa-run'],
  commit: 'a'.repeat(40),
  map: { path: 'docs/survey/cut-table.json', sha256: MAP.sha256 },
};

/** Two records: one meeting its rule, one not, inserted out of path order. */
function plantedIndex(): { tests: Map<string, TestRecord>; unindexed: string[] } {
  const failing = record('src/run/loop.test.ts', ['rafa-board', 'rafa-run'], ['../board/sync.js']);
  const meeting = record('src/run/loop-spawned.test.ts', ['rafa-run'], ['./loop.js']);
  return {
    tests: new Map([['src/run/loop.test.ts', failing], ['src/run/loop-spawned.test.ts', meeting]]),
    unindexed: ['src/run/unread.test.ts'],
  };
}

describe('renderRecordJson', () => {
  it('writes the header first in the stage\'s order, then tests, unsorted and unindexed', () => {
    const text = renderRecordJson(plantedIndex(), HEADER);
    expect(text.split('\n')[1]).toBe('  "unit": "packages",');
    expect(Object.keys(JSON.parse(text))).toEqual(['unit', 'map', 'commit', 'binReach', 'tests', 'unsorted', 'unindexed']);
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('lists under unsorted only the tests whose meets is false, and sorts the tests by path', () => {
    const parsed = JSON.parse(renderRecordJson(plantedIndex(), HEADER));
    expect(parsed.unsorted).toEqual(['src/run/loop.test.ts']);
    expect(Object.keys(parsed.tests)).toEqual(['src/run/loop-spawned.test.ts', 'src/run/loop.test.ts']);
    expect(Object.keys(parsed.tests['src/run/loop.test.ts'])).toEqual(['deep', 'kind', 'meets', 'package', 'packages', 'spawns', 'spawnsVia']);
  });

  it('writes the same bytes twice', () => {
    expect(renderRecordJson(plantedIndex(), HEADER)).toBe(renderRecordJson(plantedIndex(), HEADER));
  });
});

/** A copy of `object` less `keys`. */
function without(object: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
}

describe('parseRecord', () => {
  /** The planted record's parsed object, for a test to take a field out of. */
  function plantedObject(): Record<string, unknown> {
    return JSON.parse(renderRecordJson(plantedIndex(), HEADER));
  }

  it('reads back what renderRecordJson wrote', () => {
    const index = plantedIndex();
    const read = parseRecord(renderRecordJson(index, HEADER));
    expect(read.unit).toBe('packages');
    expect(read.map).toEqual(HEADER.map);
    expect(read.commit).toBe(HEADER.commit);
    expect(read.binReach).toEqual(HEADER.binReach);
    expect(read.tests).toEqual(index.tests);
    expect(read.unsorted).toEqual(['src/run/loop.test.ts']);
    expect(read.unindexed).toEqual(index.unindexed);
  });

  it('reads a record in another unit as written, for the guard to refuse', () => {
    expect(parseRecord(JSON.stringify({ ...plantedObject(), unit: 'folders' })).unit).toBe('folders');
  });

  it('refuses a text with no unit, naming it', () => {
    expect(() => parseRecord(JSON.stringify(without(plantedObject(), ['unit'])))).toThrow('not a test-index record: it holds no `unit`');
  });

  it('refuses a text whose map holds no sha256, naming it', () => {
    const text = JSON.stringify({ ...plantedObject(), map: { path: HEADER.map.path } });
    expect(() => parseRecord(text)).toThrow('not a test-index record: its `map` holds no `sha256`');
  });

  it('refuses an entry short of its fields, naming the entry and each missing field', () => {
    const planted = plantedObject();
    const tests = planted['tests'] as Record<string, Record<string, unknown>>;
    const short = without(tests['src/run/loop.test.ts'] ?? {}, ['deep', 'meets']);
    const text = JSON.stringify({ ...planted, tests: { ...tests, 'src/run/loop.test.ts': short } });
    expect(() => parseRecord(text)).toThrow('not a test-index record: the entry src/run/loop.test.ts holds no `deep`, `meets`');
  });

  it('refuses a text with no unsorted list, naming it', () => {
    expect(() => parseRecord(JSON.stringify(without(plantedObject(), ['unsorted'])))).toThrow('not a test-index record: it holds no `unsorted` list');
  });

  it('refuses a text that is not JSON', () => {
    expect(() => parseRecord('{ "unit":')).toThrow('not a test-index record:');
  });
});
