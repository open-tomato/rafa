/**
 * One store taken from the plan-ci schema, the last of the legacy
 * history, through `row-origins` and `store-meta`, then copied with
 * {@link copyEffortStore} and written to on both sides.
 *
 * The rows written before the copy are shared: they carry one origin
 * pair, the same on both stores. The rows each side writes afterwards
 * carry a different `origin_store`, minted for the copy on its own first
 * writing open. A row planted the way a 0.24.x runtime, holding no
 * `row-origins` migration, would insert one -- its column list naming
 * neither origin column -- sits beside them, NULL in both, since the
 * partial unique index `plan_ci_by_origin` covers only rows whose
 * `origin_store` is not NULL.
 *
 * Every store sits under this file's own directory under `tmpdir()`.
 * `writePlanCi` is the one production writer exercised; `mint` brings a
 * store's schema forward and settles its identity through
 * `withSqliteStore` directly, the project injected so no git runs, as
 * `origins.test.ts` does for the same reason.
 */
import type { PlanCiRow } from './plan-ci.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { copyEffortStore } from './copy.js';
import { effortStoreDir } from './location.js';
import { LEGACY_GATE_OPEN, SQLITE_MIGRATIONS } from './migrations.js';
import { readPlanCi, writePlanCi } from './plan-ci.js';
import { migrateSchema, sqliteStorePath, withSqliteStore } from './sqlite.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-copy-origins-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

let planted = 0;

/** A fresh project root under the suite's scope, not yet on disk. */
function freshRoot(name: string): string {
  planted += 1;
  return join(scope, `${String(planted)}-${name}`);
}

/**
 * A store under `root`, migrated to the schema a 0.24.x runtime left:
 * every legacy entry through `plan-ci`, and no further.
 */
function plantPlanCiStore(root: string): void {
  const path = sqliteStorePath(root);
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, readwrite: true });
  migrateSchema(db, path, SQLITE_MIGRATIONS.slice(0, LEGACY_GATE_OPEN));
  db.close();
}

/**
 * Brings the store under `root` forward through `row-origins` and
 * `store-meta` and mints `storeId` into it, the project injected so no
 * git runs. The store's file must already exist.
 */
function mint(root: string, storeId: string): void {
  withSqliteStore(sqliteStorePath(root), 'write', false, () => undefined, {
    readProject: () => ({ rootCommit: 'a1b2c3d4', remote: null }),
    newStoreId: () => storeId,
    now: () => new Date('2026-09-29T10:00:00.000Z'),
  });
}

/** One row's append order and origin pair, read straight off `plan_ci`. */
interface OriginRow {
  readonly seq: number;
  readonly origin_store: string | null;
  readonly origin_seq: number | null;
}

/** Every `plan_ci` row under `root`'s origin pair, in append order, read on a connection of its own. */
function originsOf(root: string): OriginRow[] {
  const db = new Database(sqliteStorePath(root), { readonly: true });
  try {
    return db.query<OriginRow, []>('SELECT seq, origin_store, origin_seq FROM plan_ci ORDER BY seq').all();
  } finally {
    db.close();
  }
}

/** A settled plan-ci reading of `headSha` at `readAt`, the pull request and plan fixed across the suite. */
function reading(headSha: string, readAt: string): PlanCiRow {
  return { planStub: 'rafa-322-effort-stores-two-devices', pr: 9, headSha, verdict: 'none', failing: [], readAt };
}

/**
 * Inserts a `plan_ci` row under `root` the way a 0.24.x runtime, holding
 * no `row-origins` migration, would: a column list naming neither origin
 * column, so both read NULL.
 */
function plantLegacyRow(root: string, headSha: string, readAt: string): void {
  const db = new Database(sqliteStorePath(root), { readwrite: true });
  try {
    db.query<unknown, [string, string]>(
      'INSERT INTO plan_ci (plan_stub, pr, head_sha, verdict, failing, read_at)'
        + ' VALUES (\'rafa-322-effort-stores-two-devices\', 9, ?, \'none\', \'[]\', ?)',
    ).run(headSha, readAt);
  } finally {
    db.close();
  }
}

describe('a store copied after row-origins and store-meta', () => {
  it('keeps one origin pair on the shared rows, mints two different origins for what each side writes after the copy, and coexists with a row a 0.24.x runtime planted with NULL origins', () => {
    const original = freshRoot('original');
    plantPlanCiStore(original);
    mint(original, 'store-original');

    writePlanCi(original, reading('sha-shared-1', '2026-09-29T10:00:00.000Z'));
    writePlanCi(original, reading('sha-shared-2', '2026-09-29T10:01:00.000Z'));

    const copy = freshRoot('copy');
    copyEffortStore({ source: effortStoreDir(original), target: effortStoreDir(copy) });
    mint(copy, 'store-copy');

    writePlanCi(original, reading('sha-original-after-1', '2026-09-29T10:02:00.000Z'));
    writePlanCi(original, reading('sha-original-after-2', '2026-09-29T10:03:00.000Z'));
    writePlanCi(copy, reading('sha-copy-after-1', '2026-09-29T10:04:00.000Z'));
    writePlanCi(copy, reading('sha-copy-after-2', '2026-09-29T10:05:00.000Z'));

    plantLegacyRow(copy, 'sha-legacy', '2026-09-28T09:00:00.000Z');

    const shared = [
      { seq: 1, origin_store: 'store-original', origin_seq: 1 },
      { seq: 2, origin_store: 'store-original', origin_seq: 2 },
    ];
    expect(originsOf(original).slice(0, 2)).toEqual(shared);
    expect(originsOf(copy).slice(0, 2)).toEqual(shared);

    const originalAfter = originsOf(original).slice(2);
    const copyAfter = originsOf(copy).slice(2, 4);
    expect(originalAfter).toEqual([
      { seq: 3, origin_store: 'store-original', origin_seq: 3 },
      { seq: 4, origin_store: 'store-original', origin_seq: 4 },
    ]);
    expect(copyAfter).toEqual([
      { seq: 3, origin_store: 'store-copy', origin_seq: 3 },
      { seq: 4, origin_store: 'store-copy', origin_seq: 4 },
    ]);
    expect(originalAfter[0]?.origin_store).not.toBe(copyAfter[0]?.origin_store);

    expect(originsOf(copy)).toEqual([...shared, ...copyAfter, { seq: 5, origin_store: null, origin_seq: null }]);
    expect(readPlanCi(copy).map(({ headSha }) => headSha)).toEqual([
      'sha-shared-1', 'sha-shared-2', 'sha-copy-after-1', 'sha-copy-after-2', 'sha-legacy',
    ]);
  });
});
