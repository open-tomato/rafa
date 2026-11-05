import type { TestIndex, TestIndexEntry } from './test-index';
import type { RecordInput, TestIndexRecord, TestRecord } from './test-index-record';
import type { Rename } from './test-index-rekey';

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { templateEntry } from '../../src/config/templates';

import { parseCutMap, readCutMap } from './cut-map';
import { compareToRecord } from './test-index-guard';
import { parseRecord, renderRecordJson } from './test-index-record';
import { readRenames, rekey, rekeyRecord } from './test-index-rekey';
import { IDENTITY, SCRATCH_MAP, git, plant, plantScratch } from './test-index-scratch';

/** The `escalation` template's two lists, as a project naming it reads them. */
const GLOBS = {
  contract: templateEntry('escalation')?.tests?.contract ?? [],
  integration: templateEntry('escalation')?.tests?.integration ?? [],
};

const HEAD = 'a'.repeat(40);
const COMMIT = 'c'.repeat(40);

const OLD = 'src/run/loop.test.ts';
const NEW = 'packages/rafa-run/src/loop.test.ts';
const LAST = 'packages/rafa-run/src/run/loop.test.ts';
const STAYS = 'src/board/sync.test.ts';
const UNINDEXED_OLD = 'src/run/unread.test.ts';
const UNINDEXED_NEW = 'packages/rafa-run/src/unread.test.ts';
const STRAY = 'src/stray/loop.test.ts';
const BOARD_SYNC = 'src/board/sync.ts';
const FAR = 'src/far/far.ts';

/** The table now: run's tests under its package, board in place but listed under a new row, and a far unit. */
const MAP = parseCutMap(JSON.stringify({
  packages: [
    { files: [NEW, LAST, UNINDEXED_NEW], name: 'rafa-run' },
    { files: [BOARD_SYNC, STAYS], name: 'rafa-board-next' },
    { files: [FAR], name: 'rafa-far' },
  ],
  unassigned: [],
}), 'docs/survey/cut-table.next.json');

/** A record entry as the record was taken: a unit test of `unit` that reached `packages`. */
function entry(unit: string, packages: readonly string[], meets: boolean): TestRecord {
  return { deep: ['./kept.js'], kind: 'unit', meets, package: unit, packages, spawns: true, spawnsVia: ['src/run/spawns.ts'] };
}

/** The record taken under the old table: the run test reaching board, board's own test, one unindexed test. */
function oldRecord(): TestIndexRecord {
  return {
    binReach: ['rafa-old'],
    commit: COMMIT,
    map: { path: 'docs/survey/cut-table.json', sha256: 'f'.repeat(64) },
    rekeyed: undefined,
    tests: new Map([
      [STAYS, entry('rafa-board', ['rafa-board'], true)],
      [OLD, entry('rafa-old', ['rafa-board', 'rafa-old'], false)],
    ]),
    unindexed: [UNINDEXED_OLD],
    unit: 'packages',
    unsorted: [OLD],
  };
}

/** Re-keys `record` and checks the handed record came back unchanged. */
function pureRekey(record: TestIndexRecord, renames: readonly Rename[]): ReturnType<typeof rekeyRecord> {
  const before = structuredClone(record);
  const bytes = renderRecordJson(record, record);
  const result = rekeyRecord(record, renames, MAP, HEAD);
  expect(record).toEqual(before);
  expect(renderRecordJson(record, record)).toBe(bytes);
  return result;
}

describe('rekeyRecord', () => {
  it('names a rename whose new path the map places in no unit', () => {
    const { record, report } = pureRekey(oldRecord(), [{ from: OLD, to: STRAY }]);
    expect(report.unplaced).toEqual([{ from: OLD, to: STRAY }]);
    expect(record.tests.get(STRAY)?.package).toBe('rafa-old');
  });

  it('skips and counts a rename whose old side is no entry and no unindexed path', () => {
    const later = { from: 'src/run/later.test.ts', to: 'packages/rafa-run/src/later.test.ts' };
    const { record, report } = pureRekey(oldRecord(), [later]);
    expect(report.skipped).toEqual([later]);
    expect(report.moved).toEqual([]);
    expect(report.unplaced).toEqual([]);
    expect([...record.tests.keys()]).toEqual([STAYS, OLD]);
  });

  it('moves a renamed entry, keeping every field but its path and gaining its unit', () => {
    const { record, report } = pureRekey(oldRecord(), [{ from: OLD, to: NEW }]);
    expect(report.moved).toEqual([{ from: OLD, to: NEW }]);
    expect(record.tests.has(OLD)).toBe(false);
    expect(record.tests.get(NEW)).toEqual({
      ...entry('rafa-old', ['rafa-board', 'rafa-old'], false),
      package: 'rafa-run',
      packages: ['rafa-board', 'rafa-old', 'rafa-run'],
    });
  });

  it('reads again the unit of an entry whose folder changed unit at the same path, changing nothing else of it', () => {
    const { record, report } = pureRekey(oldRecord(), []);
    expect(report.moved).toEqual([]);
    expect(report.unitsReadAgain).toContainEqual({ from: 'rafa-board', test: STAYS, to: 'rafa-board-next' });
    expect(record.tests.get(STAYS)).toEqual({
      ...entry('rafa-board', ['rafa-board'], true),
      package: 'rafa-board-next',
      packages: ['rafa-board', 'rafa-board-next'],
    });
  });

  it('moves a test renamed twice once, from the first path to the last', () => {
    const { record, report } = pureRekey(oldRecord(), [{ from: OLD, to: LAST }]);
    expect(report.moved).toEqual([{ from: OLD, to: LAST }]);
    expect([...record.tests.keys()]).toEqual([LAST, STAYS]);
  });

  it('moves the unsorted and the unindexed paths along the renames', () => {
    const renames = [{ from: OLD, to: NEW }, { from: UNINDEXED_OLD, to: UNINDEXED_NEW }];
    const { record, report } = pureRekey(oldRecord(), renames);
    expect(record.unsorted).toEqual([NEW]);
    expect(record.unindexed).toEqual([UNINDEXED_NEW]);
    expect(report.movedUnindexed).toEqual([{ from: UNINDEXED_OLD, to: UNINDEXED_NEW }]);
    expect(report.skipped).toEqual([]);
  });

  it('takes the map\'s hash and path and the head as rekeyed, keeping commit and binReach', () => {
    const { record } = pureRekey(oldRecord(), [{ from: OLD, to: NEW }]);
    expect(record.map).toEqual({ path: MAP.path, sha256: MAP.sha256 });
    expect(record.rekeyed).toBe(HEAD);
    expect(record.commit).toBe(COMMIT);
    expect(record.binReach).toEqual(['rafa-old']);
    expect(record.unit).toBe('packages');
    expect(parseRecord(renderRecordJson(record, record)).rekeyed).toBe(HEAD);
  });
});

describe('the widening control', () => {
  /** The guard's input over the moved test's text, which imports nothing a unit could be read from. */
  const input: RecordInput = {
    globs: GLOBS,
    map: MAP,
    members: [],
    resolve: () => undefined,
    sources: new Map([[NEW, '']]),
  };

  /** The tree now: the moved test alone, its walk reaching `folders`. */
  function treeReaching(folders: readonly string[]): TestIndex {
    const now: TestIndexEntry = {
      folder: 'rafa-run',
      folders,
      index: folders.length,
      sourceFiles: folders.length,
      spawns: false,
      spawnsVia: [],
      support: [],
      supportFolders: [],
      test: NEW,
    };
    return { read: [NEW], sources: [], tests: [now], unindexed: [], unplaced: [] };
  }

  it('names a moved entry widened by the third unit alone', () => {
    const { record } = pureRekey(oldRecord(), [{ from: OLD, to: NEW }]);
    const comparison = compareToRecord(treeReaching(['rafa-board', 'rafa-far', 'rafa-run']), record, input);
    expect(comparison.risen).toEqual([]);
    expect(comparison.unsorted).toEqual([{ test: NEW, widened: ['rafa-far'] }]);
  });

  it('names a moved entry reaching its new unit and the other widened by nothing', () => {
    const { record } = pureRekey(oldRecord(), [{ from: OLD, to: NEW }]);
    const comparison = compareToRecord(treeReaching(['rafa-board', 'rafa-run']), record, input);
    expect(comparison.unsorted).toEqual([{ test: NEW, widened: [] }]);
  });

  it('control: the path moved without its unit gained, the new unit reads as widened too', () => {
    const record = oldRecord();
    const pathOnly: TestIndexRecord = {
      ...record,
      tests: new Map([...record.tests].map(([test, value]) => [test === OLD
        ? NEW
        : test, value])),
      unsorted: [NEW],
    };
    const comparison = compareToRecord(treeReaching(['rafa-board', 'rafa-far', 'rafa-run']), pathOnly, input);
    expect(comparison.unsorted).toEqual([{ test: NEW, widened: ['rafa-far', 'rafa-run'] }]);
  });
});

describe('the driver over a scratch repository', () => {
  const RECORD = 'docs/survey/test-index.baseline.json';
  const UNIT_TEST = 'src/a/one.test.ts';
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  /** A committed scratch repository with a hand-written record of its one test, taken at `HEAD`. */
  function scratchWithRecord(rekeyed?: string): string {
    const root = plantScratch('test-index-rekey-');
    roots.push(root);
    git(root, [...IDENTITY, 'commit', '--quiet', '-m', 'planted']);
    const tests = new Map([[UNIT_TEST, { ...entry('@scratch/cli', ['@scratch/cli'], true), deep: [], spawns: false, spawnsVia: [] }]]);
    const header = {
      binReach: ['@scratch/cli'],
      commit: headOf(root),
      map: { path: SCRATCH_MAP, sha256: readCutMap(root, SCRATCH_MAP).sha256 },
      rekeyed,
    };
    plant(root, RECORD, renderRecordJson({ tests, unindexed: [] }, header));
    return root;
  }

  function headOf(root: string): string {
    return git(root, ['rev-parse', 'HEAD']).trim();
  }

  /** Moves the unit test to `to`, making its folder, and commits it. */
  function moveTest(root: string, from: string, to: string): void {
    mkdirSync(dirname(join(root, to)), { recursive: true });
    git(root, ['mv', from, to]);
    git(root, [...IDENTITY, 'commit', '--quiet', '-m', `move ${from}`]);
  }

  it('names an unplaced rename and writes nothing', () => {
    const root = scratchWithRecord();
    const before = readFileSync(join(root, RECORD), 'utf8');
    moveTest(root, UNIT_TEST, 'src/stray/one.test.ts');
    const reading = rekey(root, { dryRun: false, map: SCRATCH_MAP, rekey: RECORD }, headOf(root));
    expect(reading.refused).toBe(true);
    expect(reading.written).toBe(false);
    expect(reading.lines).toContain(`  ${UNIT_TEST} -> src/stray/one.test.ts`);
    expect(reading.lines.at(-1)).toBe('test-index: nothing written (1 rename placed in no unit)');
    expect(readFileSync(join(root, RECORD), 'utf8')).toBe(before);
  });

  it('refuses a missing record', () => {
    const root = scratchWithRecord();
    expect(() => rekey(root, { dryRun: true, map: SCRATCH_MAP, rekey: 'docs/none.json' }, headOf(root)))
      .toThrow(`cannot read the record: no file at ${join(root, 'docs/none.json')}`);
  });

  it('writes nothing on a dry run, then writes the moved entry, then reads from rekeyed', () => {
    const root = scratchWithRecord();
    const commit = headOf(root);
    const before = readFileSync(join(root, RECORD), 'utf8');
    moveTest(root, UNIT_TEST, 'src/deep/one.test.ts');
    const head = headOf(root);
    const dry = rekey(root, { dryRun: true, map: SCRATCH_MAP, rekey: RECORD }, head);
    expect(dry.written).toBe(false);
    expect(dry.refused).toBe(false);
    expect(dry.lines).toEqual([
      `test-index: renames read from the record's commit ${commit} to ${head}; the record names no rekeyed`,
      'test-index: 1 entry to move, 0 unindexed paths to move, 0 units read again',
      'test-index: nothing written (--dry-run)',
    ]);
    expect(readFileSync(join(root, RECORD), 'utf8')).toBe(before);

    const wet = rekey(root, { dryRun: false, map: SCRATCH_MAP, rekey: RECORD }, head);
    expect(wet.written).toBe(true);
    expect(wet.lines.at(-1)).toBe(`test-index: wrote ${RECORD}`);
    const record = parseRecord(readFileSync(join(root, RECORD), 'utf8'));
    expect([...record.tests.keys()]).toEqual(['src/deep/one.test.ts']);
    expect(record.rekeyed).toBe(head);
    expect(record.commit).toBe(commit);

    const again = rekey(root, { dryRun: true, map: SCRATCH_MAP, rekey: RECORD }, head);
    expect(again.lines.slice(0, 2)).toEqual([
      `test-index: renames read from the record's rekeyed ${head} to ${head}`,
      'test-index: 0 entries to move, 0 unindexed paths to move, 0 units read again',
    ]);
  });

  it('falls back to commit when the repository lacks rekeyed, and says so', () => {
    const missing = '0'.repeat(40);
    const root = scratchWithRecord(missing);
    const commit = headOf(root);
    moveTest(root, UNIT_TEST, 'src/far/one.test.ts');
    const head = headOf(root);
    const reading = rekey(root, { dryRun: false, map: SCRATCH_MAP, rekey: RECORD }, head);
    expect(reading.lines[0]).toBe(`test-index: renames read from the record's commit ${commit} to ${head}; `
      + `the record's rekeyed ${missing} is no commit of this repository`);
    expect(reading.lines).toContain('  src/far/one.test.ts: @scratch/cli -> @scratch/far');
    expect(parseRecord(readFileSync(join(root, RECORD), 'utf8')).tests.get('src/far/one.test.ts')?.packages)
      .toEqual(['@scratch/cli', '@scratch/far']);
  });

  it('readRenames follows a renamed test file and not a renamed source file', () => {
    const root = scratchWithRecord();
    const since = headOf(root);
    git(root, ['mv', 'src/far/y.ts', 'src/far/y-renamed.ts']);
    moveTest(root, UNIT_TEST, 'src/deep/one.test.ts');
    expect(readRenames(root, since)).toEqual([{ from: UNIT_TEST, to: 'src/deep/one.test.ts' }]);
    expect(existsSync(join(root, 'src/far/y-renamed.ts'))).toBe(true);
  });

  it('readRenames refuses a since that is not a commit hash', () => {
    const root = scratchWithRecord();
    expect(() => readRenames(root, '--output=marker')).toThrow('is not a commit hash');
  });
});
