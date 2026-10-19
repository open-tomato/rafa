import type { WorkspaceMember } from './package-entries';
import type { TestIndex, TestIndexEntry } from './test-index';
import type { RecordInput, TestIndexRecord, TestRecord } from './test-index-record';

import { describe, expect, it } from 'bun:test';

import { TESTS_DEFAULTS } from '../../src/config-schema-tests';

import { parseCutMap } from './cut-map';
import { checkHeader, compareToRecord, holdsRecord, renderGuard } from './test-index-guard';
import { parseRecord, recordEntry, renderRecordJson } from './test-index-record';

/** The defaults, as a project with no `tests` key reads them. */
const GLOBS = { contract: TESTS_DEFAULTS.testsContract, integration: TESTS_DEFAULTS.testsIntegration };

const CORE = '@open-tomato/rafa-core';
const CORE_STORE = 'packages/rafa/src/effort/store/index.ts';
const CORE_SQLITE = 'packages/rafa/src/effort/store/sqlite.ts';
const BOARD_SYNC = 'src/board/sync.ts';
const RUN_LOOP = 'src/run/loop.ts';

const HELD = 'src/run/held.test.ts';
const RISES = 'src/run/rises.test.ts';
const SORTS = 'src/run/sorts.test.ts';
const WIDENS = 'src/run/widens.test.ts';
const STAYS = 'src/run/stays.test.ts';
const ADDED = 'src/run/added.test.ts';
const NEW_DEEP = 'src/run/new-spawned.test.ts';
const GONE = 'src/run/gone.test.ts';
const UNREAD = 'src/run/unread.test.ts';
const NEW_UNREAD = 'src/run/new-unread.test.ts';
const STILL_UNINDEXED = 'src/run/still-unindexed.test.ts';
const UNINDEXED_GONE = 'src/run/unindexed-gone.test.ts';
const STRAY = 'src/stray.test.ts';

/** Every planted test of unit `rafa-run`; `STRAY` is listed nowhere. */
const RUN_TESTS = [HELD, RISES, SORTS, WIDENS, STAYS, ADDED, NEW_DEEP, GONE, UNREAD, NEW_UNREAD, STILL_UNINDEXED, UNINDEXED_GONE];

/** A planted cut table: core, run and board, the board a projected package with no manifest. */
const MAP = parseCutMap(JSON.stringify({
  packages: [
    { files: [CORE_STORE, CORE_SQLITE], name: CORE },
    { files: [RUN_LOOP, ...RUN_TESTS], name: 'rafa-run' },
    { files: [BOARD_SYNC], name: 'rafa-board' },
  ],
  unassigned: [],
}), 'docs/survey/cut-table.json');

/** Core is the one member: its manifest exports `./store`. */
const MEMBERS: readonly WorkspaceMember[] = [{ exports: ['./store'], folder: 'packages/rafa/', name: CORE }];

/** Where each specifier lands, whatever file imports it. */
const LANDINGS: ReadonlyMap<string, string> = new Map([
  ['./loop.js', RUN_LOOP],
  ['../board/sync.js', BOARD_SYNC],
  ['@open-tomato/rafa/store', CORE_STORE],
  ['../../packages/rafa/src/effort/store/sqlite.js', CORE_SQLITE],
]);

/** A planted test: the units its walk reaches and the specifiers its text imports. */
interface Planted {
  readonly folders: readonly string[];
  readonly specifiers: readonly string[];
}

/** The input every test's record is read by, over the planted texts. */
function inputFor(planted: ReadonlyMap<string, Planted>): RecordInput {
  const text = (specifiers: readonly string[]): string => specifiers.map((specifier, at) => `import * as m${at} from '${specifier}';`).join('\n');
  return {
    globs: GLOBS,
    map: MAP,
    members: MEMBERS,
    resolve: (specifier) => LANDINGS.get(specifier),
    sources: new Map([...planted].map(([test, { specifiers }]) => [test, text(specifiers)])),
  };
}

/** An index entry for `test` whose walk reached `folders`. */
function entryFor(test: string, folders: readonly string[]): TestIndexEntry {
  return {
    folder: MAP.unitOf(test),
    folders,
    index: folders.length,
    sourceFiles: folders.length,
    spawns: false,
    spawnsVia: [],
    support: [],
    supportFolders: [],
    test,
  };
}

/** The index of a planted tree: the indexed tests and the unindexed ones. */
function indexOf(planted: ReadonlyMap<string, Planted>, unindexed: readonly string[]): TestIndex {
  const tests = [...planted.keys()].sort().map((test) => entryFor(test, planted.get(test)?.folders ?? []));
  return { read: [...planted.keys()].sort(), sources: [], tests, unindexed: [...unindexed].sort(), unplaced: [] };
}

const ONLY_RUN: Planted = { folders: ['rafa-run'], specifiers: ['./loop.js'] };
const TO_BOARD: Planted = { folders: ['rafa-board', 'rafa-run'], specifiers: ['./loop.js', '../board/sync.js'] };

/** The tree the record is taken from. */
const BEFORE: ReadonlyMap<string, Planted> = new Map([
  [HELD, ONLY_RUN],
  [RISES, ONLY_RUN],
  [SORTS, TO_BOARD],
  [WIDENS, TO_BOARD],
  [STAYS, TO_BOARD],
  [GONE, ONLY_RUN],
  [UNREAD, ONLY_RUN],
]);
const BEFORE_UNINDEXED = [STILL_UNINDEXED, UNINDEXED_GONE];

/** The tree the guard reads: one test of each bucket. */
const AFTER: ReadonlyMap<string, Planted> = new Map([
  [HELD, ONLY_RUN],
  [RISES, TO_BOARD],
  [SORTS, ONLY_RUN],
  [WIDENS, { folders: [CORE, 'rafa-board', 'rafa-run'], specifiers: ['../board/sync.js', '@open-tomato/rafa/store'] }],
  [STAYS, TO_BOARD],
  [ADDED, ONLY_RUN],
  [NEW_DEEP, { folders: [CORE, 'rafa-run'], specifiers: ['@open-tomato/rafa/store', '../../packages/rafa/src/effort/store/sqlite.js'] }],
  [STRAY, ONLY_RUN],
]);
const AFTER_UNINDEXED = [UNREAD, NEW_UNREAD, STILL_UNINDEXED];

/** The record a tree's index writes, read back as the guard reads it. */
function recordOf(planted: ReadonlyMap<string, Planted>, unindexed: readonly string[]): TestIndexRecord {
  const input = inputFor(planted);
  const tests = new Map<string, TestRecord>(indexOf(planted, unindexed).tests.map((entry) => [entry.test, recordEntry(entry, input)]));
  const header = { binReach: ['rafa-run'], commit: 'c'.repeat(40), map: { path: MAP.path, sha256: MAP.sha256 } };
  return parseRecord(renderRecordJson({ tests, unindexed: [...unindexed].sort() }, header));
}

/** The tree after, compared with the record of the tree before. */
function plantedComparison(): ReturnType<typeof compareToRecord> {
  return compareToRecord(indexOf(AFTER, AFTER_UNINDEXED), recordOf(BEFORE, BEFORE_UNINDEXED), inputFor(AFTER));
}

describe('checkHeader', () => {
  const record = { map: { path: 'docs/survey/cut-table.json', sha256: MAP.sha256 }, unit: 'packages' };

  it('refuses nothing for a record in packages taken on the handed map, whatever path names it', () => {
    expect(checkHeader(record, MAP)).toEqual([]);
    expect(checkHeader(record, { path: '/repo/docs/survey/cut-table.json', sha256: MAP.sha256 })).toEqual([]);
  });

  it('refuses a record whose unit is not packages, naming both units', () => {
    expect(checkHeader({ ...record, unit: 'folders' }, MAP)).toEqual([
      'test-index: the record\'s unit is folders; the guard reads packages',
    ]);
  });

  it('refuses a record taken on another map, naming both paths and both hashes', () => {
    const other = { path: 'cut-table.edited.json', sha256: 'b'.repeat(64) };
    expect(checkHeader(record, other)).toEqual([
      `test-index: the record was taken on docs/survey/cut-table.json at sha256 ${MAP.sha256}; `
      + `the map handed is cut-table.edited.json at sha256 ${'b'.repeat(64)}`,
    ]);
  });

  it('answers both refusals for a record failing both', () => {
    expect(checkHeader({ map: { path: 'x.json', sha256: 'a' }, unit: 'folders' }, MAP)).toHaveLength(2);
  });
});

describe('compareToRecord', () => {
  it('holds the tree the record was taken from: nothing risen, sorted, added, gone or unread', () => {
    const comparison = compareToRecord(indexOf(BEFORE, BEFORE_UNINDEXED), recordOf(BEFORE, BEFORE_UNINDEXED), inputFor(BEFORE));
    expect(comparison.risen).toEqual([]);
    expect(comparison.sorted).toEqual([]);
    expect(comparison.added).toEqual([]);
    expect(comparison.gone).toEqual([]);
    expect(comparison.unread).toEqual([]);
    expect(comparison.held).toEqual([GONE, HELD, RISES, UNREAD]);
    expect(comparison.unsorted).toEqual([
      { test: SORTS, widened: [] },
      { test: STAYS, widened: [] },
      { test: WIDENS, widened: [] },
    ]);
    expect(comparison.unindexed).toEqual(BEFORE_UNINDEXED);
  });

  it('names a test that left its rule off the unsorted list risen, with its kind, unit and the units beyond its own', () => {
    expect(plantedComparison().risen).toContainEqual({
      inRecord: true,
      kind: 'unit',
      package: 'rafa-run',
      reason: 'reaches rafa-board beyond its own unit',
      test: RISES,
    });
  });

  it('names a new test that does not meet its rule risen, with the deep specifiers of a use-case test', () => {
    expect(plantedComparison().risen).toContainEqual({
      inRecord: false,
      kind: 'use-case',
      package: 'rafa-run',
      reason: 'enters another unit through no public entry by ../../packages/rafa/src/effort/store/sqlite.js',
      test: NEW_DEEP,
    });
  });

  it('sorts each test file of the tree into its one bucket', () => {
    const comparison = plantedComparison();
    expect(comparison.risen.map((risen) => risen.test)).toEqual([NEW_DEEP, RISES]);
    expect(comparison.sorted).toEqual([SORTS]);
    expect(comparison.unsorted).toEqual([{ test: STAYS, widened: [] }, { test: WIDENS, widened: [CORE] }]);
    expect(comparison.held).toEqual([HELD]);
    expect(comparison.added).toEqual([ADDED]);
    expect(comparison.gone).toEqual([GONE, UNINDEXED_GONE]);
    expect(comparison.unread).toEqual([NEW_UNREAD, UNREAD]);
    expect(comparison.unindexed).toEqual([STILL_UNINDEXED]);
    expect(comparison.unplaced).toEqual([STRAY]);
    expect(comparison.commit).toBe('c'.repeat(40));
    expect(comparison.mapPath).toBe('docs/survey/cut-table.json');
  });

  it('holds a test the record listed unindexed and that has an index now as a test the record does not hold', () => {
    const record = recordOf(new Map([[HELD, ONLY_RUN]]), [ADDED, RISES]);
    const now = new Map([[HELD, ONLY_RUN], [ADDED, ONLY_RUN], [RISES, TO_BOARD]]);
    const comparison = compareToRecord(indexOf(now, []), record, inputFor(now));
    expect(comparison.added).toEqual([ADDED]);
    expect(comparison.risen.map((risen) => [risen.test, risen.inRecord])).toEqual([[RISES, false]]);
    expect(comparison.gone).toEqual([]);
  });
});

describe('holdsRecord', () => {
  const holding = compareToRecord(indexOf(BEFORE, BEFORE_UNINDEXED), recordOf(BEFORE, BEFORE_UNINDEXED), inputFor(BEFORE));

  it('holds a comparison with no refusal, no risen and no unread, unsorted and unindexed tests included', () => {
    expect(holding.unsorted).not.toEqual([]);
    expect(holdsRecord(holding, [])).toBe(true);
  });

  it('is false on a risen test alone', () => {
    const risen = plantedComparison().risen;
    expect(holdsRecord({ ...holding, risen }, [])).toBe(false);
  });

  it('is false on an unread test alone', () => {
    expect(holdsRecord({ ...holding, unread: [UNREAD] }, [])).toBe(false);
  });

  it('is false on a refusal alone', () => {
    expect(holdsRecord(holding, checkHeader({ map: { path: MAP.path, sha256: MAP.sha256 }, unit: 'folders' }, MAP))).toBe(false);
  });

  it('is not failed by added, gone, sorted or unplaced tests', () => {
    expect(holdsRecord({ ...holding, added: [ADDED], gone: [GONE], sorted: [SORTS], unplaced: [STRAY] }, [])).toBe(true);
  });
});

describe('renderGuard', () => {
  const refusals = checkHeader({ map: { path: 'old.json', sha256: 'a'.repeat(64) }, unit: 'folders' }, MAP);
  const text = renderGuard(plantedComparison(), refusals, 'docs/survey/test-index.baseline.json');
  const lines = text.split('\n');

  it('opens with the counts', () => {
    expect(lines[0]).toBe(`test-index: 7 test file(s) held to docs/survey/test-index.baseline.json, taken at commit ${'c'.repeat(40)} `
      + 'on docs/survey/cut-table.json: 2 risen, 1 sorted, 2 unsorted (1 widened), 1 held, 1 new');
    expect(lines[1]).toBe('test-index: 2 gone, 2 not read, 1 unindexed still, 1 unplaced');
  });

  it('prints both refusals', () => {
    expect(lines.slice(2, 4)).toEqual(refusals);
  });

  it('names each risen test with its kind, its unit and its reason', () => {
    expect(lines).toContain(`  ${RISES} (unit test in rafa-run): reaches rafa-board beyond its own unit`);
    expect(lines).toContain(`  ${NEW_DEEP} (use-case test in rafa-run, not in the record): `
      + 'enters another unit through no public entry by ../../packages/rafa/src/effort/store/sqlite.js');
  });

  it('names the widened with their new units, the sorted, the unread, the added and the gone', () => {
    expect(text).toContain(`Widened, an unsorted test reaches units its record did not (1):\n  ${WIDENS}: ${CORE}`);
    expect(text).toContain(`(1):\n  ${SORTS}`);
    expect(text).toContain(`(2):\n  ${NEW_UNREAD}\n  ${UNREAD}`);
    expect(text).toContain(`New, not in the record and meeting its rule (1):\n  ${ADDED}`);
    expect(text).toContain(`Gone, no test file answers the record entry (2):\n  ${GONE}\n  ${UNINDEXED_GONE}`);
  });

  it('names neither the held nor an unsorted test that did not widen', () => {
    expect(lines).not.toContain(`  ${HELD}`);
    expect(text).not.toContain(STAYS);
  });

  it('prints the counts alone for a tree that holds, with no refusal', () => {
    const holding = compareToRecord(indexOf(BEFORE, BEFORE_UNINDEXED), recordOf(BEFORE, BEFORE_UNINDEXED), inputFor(BEFORE));
    expect(renderGuard(holding, [], 'record.json').split('\n')).toHaveLength(2);
  });
});
