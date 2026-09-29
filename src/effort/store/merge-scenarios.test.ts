/**
 * The #322 scenarios run through `mergeStore` itself, over the stores
 * `testdata/merge-scenarios.ts` builds. `merge-scenarios.test.ts` one
 * directory down reads the builders back on their own terms — the union
 * each claims, counted from the rows planted; this file is what a real
 * merge does with those same stores.
 *
 * ## The identity comparison
 *
 * Two stores holding the same rows can still disagree on `seq` (local
 * order) and on `origin_store`/`origin_seq` for a row matched by
 * identity rather than by its origin pair: a commit two devices
 * collected under their own origins matches by `sha`, and whichever
 * side ran the merge keeps its own origin on that row (see
 * `PLAN_TRACKER-rafa-322-effort-stores-two-devices.md`, "the same
 * commit collected on two devices matches by sha, but each side keeps
 * its own origin pair"). So "the same store" here means every merged
 * table holds the same rows once `seq`, `origin_store` and `origin_seq`
 * are set aside — {@link expectSameUnion}, over {@link ORIGIN_TABLES}.
 *
 * ## Scenarios 3, 4, 5 and 6 converge; 9 does in six orders; the cloned
 * disk does not
 *
 * The four two-device scenarios that hold no origin-pair collision
 * (3, 4, 5, 6) merge to the identity-equal store from either side, and
 * a second run of the same merge changes nothing. Scenario 9's three
 * devices reach the same store whichever of the six orders their
 * pairwise merges run in. The cloned disk is built to collide on
 * purpose — the same origin pair holding different content on each
 * side — so its own case asks only what the module note promises:
 * the local row is kept, and the incoming one is recorded in
 * `merge_conflicts`, both kept. Scenarios 7 and 8 are refused before
 * anything is built, so both files stay byte-identical.
 *
 * Every merge here runs as an installed runtime with no `readProject`
 * git read (`decideStoreIdentity`'s doc: a read decides nothing, and
 * every store here is already minted or deliberately not). `isAlive`
 * is never overridden, so scenario 8's own loop record, planted under
 * this test process's real pid, reads `running` the way a live one
 * would, and the merge refuses it without any seam faking the OS.
 */
import type { MergeOptions, MergeRefusalReason } from './merge-store.js';
import type { OriginTable } from './origins.js';
import type { OriginCollision, Scenario, ScenarioDevice } from './testdata/merge-scenarios.js';
import type { RuntimeIdentity } from '../../runtime/identity.js';

import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { EXTRACT_FILE_NAMES, readExtractSide, restoreExtractSide } from './fixture-extract.js';
import { withoutGap } from './merge-commit-gaps.js';
import { MergeRefusal, mergeStore } from './merge-store.js';
import { ORIGIN_TABLES } from './origins.js';
import {
  buildCleanStarts,
  buildClonedDisk,
  buildCopyDiverged,
  buildOtherProject,
  buildPlanCiSide,
  buildRestoredBak,
  buildRunningLoop,
  buildThreeDevices,
} from './testdata/merge-scenarios.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-merge-scenarios-run-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** Several full merges run inside one `it()`, past bun's 5-second default. */
const MERGE_CASE_TIMEOUT_MS = 30_000;

/** An installed runtime, which may swap a merged store in anywhere; no test store here is a development build's own. */
const INSTALLED: RuntimeIdentity = { kind: 'installed', entry: '/home/u/.rafa/runtime/0.26.0/cli.js' };

let stampSeq = 0;

/** A stamp naming its own parallel and backup files, distinct from every other merge run in this file. */
function nextStamp(): string {
  stampSeq += 1;
  return `stamp-${String(stampSeq).padStart(4, '0')}`;
}

/** One merge's options: an installed runtime, its own stamp, and no real git read (see the module note). */
function options(path: string, otherPath: string): MergeOptions {
  return {
    path,
    otherPath,
    backend: 'sqlite',
    dryRun: false,
    stamp: nextStamp(),
    readProject: () => ({ rootCommit: null, remote: null }),
    identity: INSTALLED,
  };
}

/** A fresh directory of its own under `scope`, its path real. */
function freshDir(scope: string, name: string): string {
  return realpathSync(mkdtempSync(join(scope, `${name}-`)));
}

/** A copy of the file at `sourcePath`, under a directory of its own, ready to be merged into. */
function copyFileTo(scope: string, name: string, sourcePath: string): string {
  const path = join(freshDir(scope, name), 'effort.sqlite');
  copyFileSync(sourcePath, path);
  return path;
}

/** A copy of `device`'s store, under a directory of its own. The original file is only ever read. */
function copyDeviceTo(scope: string, name: string, device: ScenarioDevice): string {
  return copyFileTo(scope, name, device.path);
}

/** One row read off a store, by column. */
type Row = Readonly<Record<string, unknown>>;

/** Rows `sql` answers on the store at `path`, read-only. */
function readRows(path: string, sql: string): Row[] {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<Row, []>(sql).all();
  } finally {
    db.close();
  }
}

/** `seq` and the origin pair are local order and which side wrote a row, not its content; see the module note. */
const NOT_CONTENT = new Set(['seq', 'origin_store', 'origin_seq']);

/**
 * `row`'s content, `seq` and the origin pair set aside, as one comparable
 * string. `commits.row_json` is compared through {@link withoutGap}, as
 * `merge-conflicts.ts` compares it: `MERGE_RULES` declares the gap
 * `RECOMPUTED`, so two rows of one commit that differ only in it are the
 * same row, whichever side's merge last touched it.
 */
function contentOf(table: OriginTable, row: Row): string {
  const entries = Object.entries(row).filter(([column]) => !NOT_CONTENT.has(column))
    .map(([column, value]): readonly [string, unknown] => (table === 'commits' && column === 'row_json' && typeof value === 'string'
      ? [column, withoutGap(value)]
      : [column, value]));
  return JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b)));
}

/** Every row of `table` on the store at `path`, as content strings, sorted so two stores compare order-free. */
function sortedContent(path: string, table: OriginTable): string[] {
  return readRows(path, `SELECT * FROM ${table}`).map((row) => contentOf(table, row))
    .sort();
}

/** Every merged table of every store at `paths` holds the same rows under the identity comparison. */
function expectSameUnion(paths: readonly string[]): void {
  const [first, ...rest] = paths;
  if (first === undefined) throw new Error('expectSameUnion needs at least one path');
  for (const table of ORIGIN_TABLES) {
    const base = sortedContent(first, table);
    for (const path of rest) expect(sortedContent(path, table)).toEqual(base);
  }
}

/** The two devices of a two-device scenario. */
function twoOf(scenario: Scenario): readonly [ScenarioDevice, ScenarioDevice] {
  const [a, b] = scenario.devices;
  if (a === undefined || b === undefined) throw new Error(`${scenario.name} has fewer than two devices`);
  return [a, b];
}

/** Every file in `dir` by name, with its bytes. */
function snapshot(dir: string): ReadonlyMap<string, Buffer> {
  return new Map(readdirSync(dir).sort()
    .map((name) => [name, readFileSync(join(dir, name))]));
}

/** Whether two snapshots hold the same names with the same bytes. */
function sameFiles(before: ReadonlyMap<string, Buffer>, after: ReadonlyMap<string, Buffer>): boolean {
  return before.size === after.size && [...before].every(([name, bytes]) => after.get(name)?.equals(bytes) === true);
}

/** Runs the merge of `scenario`'s two devices directly on their own files, and finds both refused and unchanged. */
function expectRefused(scenario: Scenario, reason: MergeRefusalReason): void {
  const [a, b] = twoOf(scenario);
  const beforeA = snapshot(dirname(a.path));
  const beforeB = snapshot(dirname(b.path));

  let thrown: unknown = null;
  try {
    mergeStore(options(a.path, b.path));
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(MergeRefusal);
  expect((thrown as MergeRefusal).reason).toBe(reason);
  expect(sameFiles(beforeA, snapshot(dirname(a.path)))).toBe(true);
  expect(sameFiles(beforeB, snapshot(dirname(b.path)))).toBe(true);
}

/** The row `collision` names on the store at `path`, `seq` set aside, or undefined when it holds none. */
function rowAt(path: string, collision: OriginCollision): Row | undefined {
  const [row] = readRows(
    path,
    `SELECT * FROM ${collision.table} WHERE origin_store = '${collision.originStore}' AND origin_seq = ${String(collision.originSeq)}`,
  );
  return row === undefined
    ? undefined
    : Object.fromEntries(Object.entries(row).filter(([column]) => column !== 'seq'));
}

/** The local `seq` of the row `collision` names on the store at `path`. */
function collisionSeq(path: string, collision: OriginCollision): number {
  const [row] = readRows(
    path,
    `SELECT seq FROM ${collision.table} WHERE origin_store = '${collision.originStore}' AND origin_seq = ${String(collision.originSeq)}`,
  );
  const seq = row?.['seq'];
  if (typeof seq !== 'number') throw new Error(`${collision.table} holds no row at ${collision.originStore}:${String(collision.originSeq)} on ${path}`);
  return seq;
}

/** Every ordering of `items`, depth-first. Six for three devices. */
function orderings<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  return items.flatMap((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    return orderings(rest).map((tail) => [item, ...tail]);
  });
}

/** A copy of `order[0]`'s store with each later device merged into it in turn, answering the final path. */
function mergeInOrder(scope: string, name: string, order: readonly ScenarioDevice[]): string {
  const [first, ...rest] = order;
  if (first === undefined) throw new Error(`${name} has no devices to merge`);
  const path = copyDeviceTo(scope, `${name}-base`, first);
  for (const device of rest) {
    const result = mergeStore(options(path, device.path));
    if (result.status !== 'merged') throw new Error(`${name}: merging ${device.name} in answered ${result.status}`);
  }
  return path;
}

/** The four two-device scenarios with no origin-pair collision: they converge, and merge again adds nothing. */
const CONVERGING_SCENARIOS: ReadonlyArray<readonly [string, (scope: string) => Scenario]> = [
  ['3: two clean starts', buildCleanStarts],
  ['4: a copy then divergence', buildCopyDiverged],
  ['5: a restored older .bak', buildRestoredBak],
  ['6: one side at plan-ci', buildPlanCiSide],
];

describe('a two-device scenario merges to the same store from either side, and again adds nothing', () => {
  it.each(CONVERGING_SCENARIOS)('%s', (_, build) => {
    const scenario = build(scope);
    const [a, b] = twoOf(scenario);

    const aIntoB = mergeStore(options(copyDeviceTo(scope, 'a-into-b', b), a.path));
    const bIntoA = mergeStore(options(copyDeviceTo(scope, 'b-into-a', a), b.path));

    expect(aIntoB.status).toBe('merged');
    expect(bIntoA.status).toBe('merged');
    expectSameUnion([aIntoB.path, bIntoA.path]);

    const before = ORIGIN_TABLES.map((table) => sortedContent(aIntoB.path, table));
    const again = mergeStore(options(aIntoB.path, a.path));

    expect(again).toMatchObject({ status: 'merged', rowsAdded: 0, rowsInConflict: 0 });
    expect(ORIGIN_TABLES.map((table) => sortedContent(aIntoB.path, table))).toEqual(before);
  }, MERGE_CASE_TIMEOUT_MS);
});

describe('scenario 9: three devices', () => {
  it('agree under the identity comparison whichever of the six merge orders combines them', () => {
    const { devices } = buildThreeDevices(scope);

    const paths = orderings(devices).map((order, index) => mergeInOrder(scope, `three-devices-order-${String(index)}`, order));

    expect(paths).toHaveLength(6);
    expectSameUnion(paths);
  }, MERGE_CASE_TIMEOUT_MS);
});

describe('a merge refused before anything is built leaves both stores byte-identical', () => {
  it('7: refuses two stores that name different projects', () => {
    expectRefused(buildOtherProject(scope), 'other-project');
  });

  it('8: refuses while a live loop records to the store', () => {
    expectRefused(buildRunningLoop(scope), 'live-loop');
  });
});

describe('the cloned disk', () => {
  it('merges, keeping the local row of each colliding origin pair and recording the incoming one in merge_conflicts', () => {
    const scenario = buildClonedDisk(scope);
    const [a, clone] = twoOf(scenario);
    expect(scenario.collisions.length).toBeGreaterThan(0);

    const result = mergeStore(options(copyDeviceTo(scope, 'cloned-disk', a), clone.path));

    expect(result.status).toBe('merged');
    expect(result.rowsInConflict).toBe(scenario.collisions.length);
    for (const collision of scenario.collisions) {
      expect(rowAt(result.path, collision)).toEqual(rowAt(a.path, collision));

      const localSeq = collisionSeq(result.path, collision);
      const [conflict] = readRows(
        result.path,
        `SELECT incoming FROM merge_conflicts WHERE table_name = '${collision.table}' AND local_seq = ${String(localSeq)}`,
      );
      const incoming = JSON.parse(String(conflict?.['incoming'])) as Row;
      const incomingContent = Object.fromEntries(Object.entries(incoming).filter(([column]) => column !== 'seq'));
      expect(incomingContent).toEqual(rowAt(clone.path, collision));
    }
  });
});

/** Where a real scenario-4 extract, made with `scripts/extract-merge-fixture.ts`, would be committed. */
const REAL_SCENARIO_4_DIR = join(import.meta.dir, 'testdata', 'merge', 'scenario-4');

const realFixtureFiles = Object.values(EXTRACT_FILE_NAMES);
const realFixturePresent = realFixtureFiles.every((name) => existsSync(join(REAL_SCENARIO_4_DIR, name)));

describe('the real scenario-4 extract, when the fixture directory holds it', () => {
  it.skipIf(!realFixturePresent)('merges its two sides without throwing, and converges from either direction', () => {
    const sideA = readExtractSide(join(REAL_SCENARIO_4_DIR, EXTRACT_FILE_NAMES.a));
    const sideB = readExtractSide(join(REAL_SCENARIO_4_DIR, EXTRACT_FILE_NAMES.b));
    const pathA = join(scope, 'real-scenario-4-a.sqlite');
    const pathB = join(scope, 'real-scenario-4-b.sqlite');
    restoreExtractSide(sideA, pathA);
    restoreExtractSide(sideB, pathB);

    const aIntoB = mergeStore(options(copyFileTo(scope, 'real-4-a-into-b', pathB), pathA));
    const bIntoA = mergeStore(options(copyFileTo(scope, 'real-4-b-into-a', pathA), pathB));

    expect(aIntoB.status).toBe('merged');
    expect(bIntoA.status).toBe('merged');
    expectSameUnion([aIntoB.path, bIntoA.path]);
  }, MERGE_CASE_TIMEOUT_MS);
});
