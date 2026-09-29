/**
 * The scenario builders, read back: each store is where the scenario
 * says, names the origin and project it says, and holds rows whose
 * overlap is the one the scenario describes. The union each scenario
 * claims is checked against the stores themselves, counting the distinct
 * values of each merged table's identity columns (`MERGE_RULES`) across
 * every device, so a builder whose written names and planted rows drift
 * apart fails here. What a merge does with the stores is
 * `merge-scenarios.test.ts` one directory up.
 */
import type { OriginCollision, Scenario, ScenarioDevice } from './merge-scenarios.js';
import type { OriginTable } from '../origins.js';

import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { MERGE_RULES } from '../merge-rules.js';
import { liveLoop } from '../migrate.js';
import { LEGACY_GATE_OPEN } from '../migrations.js';
import { ORIGIN_TABLES } from '../origins.js';

import {
  buildCleanStarts,
  buildClonedDisk,
  buildCopyDiverged,
  buildOtherProject,
  buildPlanCiSide,
  buildRestoredBak,
  buildRunningLoop,
  buildThreeDevices,
  OTHER_PROJECT,
  SCENARIO_BUILDERS,
  SCENARIO_PROJECT,
} from './merge-scenarios.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-merge-scenarios-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** One row read off a store, by column. */
type Row = Readonly<Record<string, unknown>>;

/** Rows `sql` answers on `device`'s store, read-only. */
function read(device: ScenarioDevice, sql: string): Row[] {
  const db = new Database(device.path, { readonly: true });
  try {
    return db.query<Row, []>(sql).all();
  } finally {
    db.close();
  }
}

/** Whether `device`'s store has `table`. */
function hasTable(device: ScenarioDevice, table: string): boolean {
  return read(device, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`).length === 1;
}

/** The identity columns of a merged table. */
function identityOf(table: OriginTable): readonly string[] {
  const rule = MERGE_RULES[table];
  return rule?.scope === 'merged'
    ? rule.identity
    : [];
}

/** Each row of `table` on `device`, keyed by its identity. */
function byIdentity(device: ScenarioDevice, table: OriginTable): ReadonlyMap<string, Row> {
  return new Map(read(device, `SELECT * FROM ${table}`)
    .map((row) => [JSON.stringify(identityOf(table).map((column) => row[column])), row]));
}

/** The distinct identities each merged table holds across `devices`. */
function unionCounted(devices: readonly ScenarioDevice[]): Record<OriginTable, number> {
  return Object.fromEntries(ORIGIN_TABLES.map((table) => [
    table,
    new Set(devices.flatMap((device) => [...byIdentity(device, table).keys()])).size,
  ])) as Record<OriginTable, number>;
}

/** The identities `table` holds on both devices. */
function shared(a: ScenarioDevice, b: ScenarioDevice, table: OriginTable): string[] {
  const there = byIdentity(b, table);
  return [...byIdentity(a, table).keys()].filter((key) => there.has(key));
}

/** The origin pairs of `table` on `device`, as `store:seq`. */
function pairs(device: ScenarioDevice, table: OriginTable): string[] {
  return read(device, `SELECT origin_store, origin_seq FROM ${table} WHERE origin_store IS NOT NULL ORDER BY seq`)
    .map((row) => `${String(row.origin_store)}:${String(row.origin_seq)}`);
}

/** The row of `table` on `device` under one origin pair, less `seq`. */
function rowAt(device: ScenarioDevice, collision: OriginCollision): Row | undefined {
  const [row] = read(device, `SELECT * FROM ${collision.table}`
    + ` WHERE origin_store = '${collision.originStore}' AND origin_seq = ${String(collision.originSeq)}`);
  return row === undefined
    ? undefined
    : Object.fromEntries(Object.entries(row).filter(([column]) => column !== 'seq'));
}

/** The two devices of a two-device scenario. */
function twoOf(scenario: Scenario): readonly [ScenarioDevice, ScenarioDevice] {
  const [a, b] = scenario.devices;
  if (a === undefined || b === undefined) throw new Error(`${scenario.name} has fewer than two devices`);
  return [a, b];
}

/** The `store_meta` row's origin and project, or null when the store has none. */
function metaOf(device: ScenarioDevice): Row | null {
  if (!hasTable(device, 'store_meta')) return null;
  return read(device, 'SELECT store_id, project_root_commit, store_path FROM store_meta')[0] ?? null;
}

describe('every scenario builder', () => {
  it.each(Object.entries(SCENARIO_BUILDERS))('builds %s under the scope, each store naming the origin it reports', (_, build) => {
    const scenario = build(scope);

    expect(scenario.devices.length).toBeGreaterThanOrEqual(2);
    for (const device of scenario.devices) {
      expect(device.path.startsWith(`${scope}/`)).toBe(true);
      expect(device.path).toBe(join(device.root, '.rafa', 'effort', 'effort.sqlite'));
      expect(read(device, 'PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
      const meta = metaOf(device);
      expect(meta?.store_id ?? null).toBe(device.storeId);
    }
    if (scenario.union !== null) expect(unionCounted(scenario.devices)).toEqual(scenario.union);
  });

  it('refuses a scope outside tmpdir() before making anything', () => {
    const outside = '/proc/rafa-merge-scenarios-refused';

    expect(() => buildCleanStarts(outside)).toThrow('outside the temp directory');
    expect(existsSync(outside)).toBe(false);
  });
});

describe('the scenarios, read back', () => {
  it('3: two clean starts share only commits, each held under its own origin', () => {
    const [a, b] = twoOf(buildCleanStarts(scope));

    const overlapping = ORIGIN_TABLES.filter((table) => shared(a, b, table).length > 0);
    expect(overlapping).toEqual(['commits']);
    expect(pairs(a, 'commits')).toEqual(['store-a:1', 'store-a:2', 'store-a:3']);
    expect(pairs(b, 'commits')).toEqual(['store-b:1', 'store-b:2', 'store-b:3']);
    expect(read(a, 'SELECT sha, row_json FROM commits ORDER BY seq')).toEqual(read(b, 'SELECT sha, row_json FROM commits ORDER BY seq'));
  });

  it('4: a copy shares its prefix under the first origin and diverges under a new one', () => {
    const [a, b] = twoOf(buildCopyDiverged(scope));

    expect(pairs(a, 'findings')).toEqual(['store-a:1', 'store-a:2', 'store-a:3', 'store-a:4']);
    expect(pairs(b, 'findings')).toEqual(['store-a:1', 'store-a:2', 'store-b:3']);
    expect(shared(a, b, 'findings')).toEqual(['["finding-s1"]', '["finding-s2"]']);
    expect(shared(a, b, 'commits')).toEqual(['["sha-1000"]', '["sha-1010"]']);
    expect(metaOf(b)?.store_path).toBe(b.path);
  });

  it('4: each side measures its commit gaps over its own commits alone', () => {
    const [a, b] = twoOf(buildCopyDiverged(scope));
    const gaps = (device: ScenarioDevice): unknown[] => read(device, 'SELECT row_json FROM commits ORDER BY seq')
      .map(({ row_json: rowJson }) => (JSON.parse(String(rowJson)) as { minutesSincePrevious: unknown }).minutesSincePrevious);

    expect(gaps(a)).toEqual([null, 10, 30]);
    expect(gaps(b)).toEqual([null, 10, 20]);
  });

  it('5: the restored .bak holds a prefix of the newer store, row for row, under the same origin', () => {
    const [a, restored] = twoOf(buildRestoredBak(scope));

    expect(restored.storeId).toBe(a.storeId);
    for (const table of ORIGIN_TABLES) {
      const newer = byIdentity(a, table);
      const older = byIdentity(restored, table);
      expect(older.size).toBeLessThan(newer.size);
      for (const [key, row] of older) expect(row).toEqual(newer.get(key) ?? {});
    }
  });

  it('6: the old side stays at plan-ci with no origin columns, and the shared rows carry no origin on the new side', () => {
    const [a, old] = twoOf(buildPlanCiSide(scope));

    expect(read(old, 'PRAGMA user_version')).toEqual([{ user_version: LEGACY_GATE_OPEN }]);
    expect(['schema_migrations', 'store_meta', 'merges'].filter((table) => hasTable(old, table))).toEqual([]);
    expect(read(old, 'SELECT name FROM pragma_table_info(\'findings\') WHERE name LIKE \'origin_%\'')).toEqual([]);
    expect(read(a, 'SELECT id, origin_store FROM findings ORDER BY seq')).toEqual([
      { id: 'finding-s1', origin_store: null },
      { id: 'finding-s2', origin_store: null },
      { id: 'finding-a1', origin_store: 'store-a' },
    ]);
    expect(shared(a, old, 'findings')).toEqual(['["finding-s1"]', '["finding-s2"]']);
  });

  it('7: the two stores name different projects', () => {
    const [a, b] = twoOf(buildOtherProject(scope));

    expect([metaOf(a)?.project_root_commit, metaOf(b)?.project_root_commit]).toEqual([SCENARIO_PROJECT, OTHER_PROJECT]);
  });

  it('8: a loop reads running beside each store, and none does once its pid reads dead (control)', () => {
    const scenario = buildRunningLoop(scope);

    for (const device of scenario.devices) {
      expect(liveLoop(device.path, {})?.state).toBe('running');
      expect(liveLoop(device.path, { isAlive: () => false })).toBeUndefined();
    }
  });

  it('9: three devices share the seed under A, and C shares with B what B wrote before C was taken', () => {
    const [a, b, c] = buildThreeDevices(scope).devices;
    if (a === undefined || b === undefined || c === undefined) throw new Error('three-devices has fewer than three devices');

    expect(pairs(b, 'findings')).toEqual(['store-a:1', 'store-a:2', 'store-b:3', 'store-b:4']);
    expect(pairs(c, 'findings')).toEqual(['store-a:1', 'store-a:2', 'store-b:3', 'store-c:4', 'store-c:5']);
    expect(shared(b, c, 'findings')).toEqual(['["finding-s1"]', '["finding-s2"]', '["finding-b1"]']);
    expect(new Set([a.storeId, b.storeId, c.storeId]).size).toBe(3);
  });

  it('the cloned disk holds each listed origin pair on both sides with different rows, and every other shared pair alike', () => {
    const scenario = buildClonedDisk(scope);
    const [a, clone] = twoOf(scenario);

    expect(clone.storeId).toBe(a.storeId);
    expect(scenario.collisions).toHaveLength(ORIGIN_TABLES.length);
    for (const collision of scenario.collisions) {
      const here = rowAt(a, collision);
      const there = rowAt(clone, collision);
      expect(here).toBeDefined();
      expect(there).toBeDefined();
      expect(there).not.toEqual(here);
    }
    const listed = new Set(scenario.collisions.map(({ table, originSeq }) => `${table}:store-a:${String(originSeq)}`));
    const differing = ORIGIN_TABLES.flatMap((table) => pairs(a, table)
      .filter((pair) => pairs(clone, table).includes(pair))
      .filter((pair) => {
        const [originStore = '', originSeq = ''] = pair.split(':');
        const collision = { table, originStore, originSeq: Number(originSeq) };
        return !Bun.deepEquals(rowAt(a, collision), rowAt(clone, collision));
      })
      .map((pair) => `${table}:${pair}`));
    expect(new Set(differing)).toEqual(listed);
  });
});
