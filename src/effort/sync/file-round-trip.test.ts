/**
 * The `file` sync strategy (`src/effort/sync/file.ts`) run as a real
 * round trip: two devices under this file's own temporary directory,
 * each writing rows of its own, exchanging their stores through the
 * `Sync` port's `push` and `pull` alone — never `mergeStore` directly,
 * as `file.test.ts` calls it once each direction to prove the wiring,
 * but never carried through to a full exchange.
 *
 * Both devices start from `freshDevice`/`copyDevice`
 * (`src/tests/merged-stores.ts`), as `file.test.ts` does, and write
 * `dispatches` rows of their own through `writeDispatch` after the
 * copy, so each side holds a row the other does not. `pull` on one
 * device, then `pull` on the other, brings both to the same rows; a
 * second `pull` of the same carried file adds nothing, since `mergeStore`
 * matches every row it already holds by its origin pair.
 *
 * "The same rows" is the plan's own comparison
 * (`PLAN_TRACKER-rafa-323-choose-how-project-s.md`, "Identical stores"):
 * every merged table of `MERGE_RULES`, read as `ORIGIN_TABLES`
 * (`store/origins.ts`), with `seq` and the origin pair set aside, and
 * `commits.row_json` compared through `withoutGap`
 * (`merge-commit-gaps.ts`) so a recomputed gap does not count as a
 * difference. `expectSameUnion` here is the same shape
 * `merge-scenarios.test.ts` runs the #322 scenarios through; it is not
 * imported from there because a `.test.ts` file plants SQL text and
 * `Database` opens on purpose and is not a production source
 * (`store-sources.sweep.test.ts`), so nothing outside a test file may import
 * from one.
 */
import type { RuntimeIdentity } from '../../runtime/identity.js';
import type { Device } from '../../tests/merged-stores.js';
import type { OriginTable } from '../store/origins.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { copyDevice, freshDevice } from '../../tests/merged-stores.js';
import { writeDispatch } from '../store/dispatches.js';
import { withoutGap } from '../store/merge-commit-gaps.js';
import { ORIGIN_TABLES } from '../store/origins.js';
import { sqliteStorePath } from '../store/sqlite.js';

import { createFileSync } from './file.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-sync-file-round-trip-')));

afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** An installed runtime, which may swap a merged store in anywhere. */
const INSTALLED: RuntimeIdentity = { kind: 'installed', entry: '/home/u/.rafa/runtime/0.26.0/cli.js' };

/** The instant the first pull's clock reads; each later one reads a second past the one before it. */
const FIRST_PULL_AT = Date.parse('2026-09-29T12:00:00.000Z');

let scopes = 0;

/** A fresh directory of its own under this file's temporary directory. */
function freshScope(): string {
  scopes += 1;
  return realpathSync(mkdtempSync(join(scope, `scope-${String(scopes)}-`)));
}

let ticks = 0;

/**
 * The `file` strategy over `root`, merging as an installed runtime with
 * no live loop. Each call reads a clock a second past the one before it,
 * so two pulls in the same case never collide on one merge's stamped
 * parallel and backup file names.
 */
function fileSync(root: string): ReturnType<typeof createFileSync> {
  ticks += 1;
  const now = new Date(FIRST_PULL_AT + (ticks * 1000));
  return createFileSync({ repoRoot: root, backend: 'sqlite', now: () => now, identity: INSTALLED, isAlive: () => false, env: {} });
}

/** Plants one `dispatches` row keyed `sessionId` in `device`'s store. */
function dispatch(device: Device, sessionId: string): void {
  writeDispatch(device.root, { sessionId, planStub: null, taskLine: `task of ${sessionId}`, declaration: null, flags: [] });
}

/** The path the `push` request answers a file, is a path, was the copy's `effort.sqlite`. */
function pushedPath(pushed: { status: string; path?: string }): string {
  if (pushed.status !== 'pushed' || typeof pushed.path !== 'string') throw new Error(`push answered ${JSON.stringify(pushed)}, expected a pushed path`);
  return pushed.path;
}

/** One row read off a store, by column. */
type Row = Readonly<Record<string, unknown>>;

/** Every row of `table` on the store at `path`. */
function readRows(path: string, table: OriginTable): Row[] {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<Row, []>(`SELECT * FROM ${table}`).all();
  } finally {
    db.close();
  }
}

/** `seq` and the origin pair are local order and which side wrote a row, not its content; see the module note. */
const NOT_CONTENT = new Set(['seq', 'origin_store', 'origin_seq']);

/**
 * `row`'s content, `seq` and the origin pair set aside, as one comparable
 * string; `commits.row_json` is compared through {@link withoutGap}, as
 * the plan's own comparison reads it.
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
  return readRows(path, table).map((row) => contentOf(table, row))
    .sort();
}

/** Every merged table of every store at `paths` holds the same rows under the plan's comparison. */
function expectSameUnion(paths: readonly string[]): void {
  const [first, ...rest] = paths;
  if (first === undefined) throw new Error('expectSameUnion needs at least one path');
  for (const table of ORIGIN_TABLES) {
    const base = sortedContent(first, table);
    for (const path of rest) expect(sortedContent(path, table)).toEqual(base);
  }
}

/** Every merged table's rows on the store at `path`, one sorted list per table, in `ORIGIN_TABLES` order. */
function allTables(path: string): readonly string[][] {
  return ORIGIN_TABLES.map((table) => sortedContent(path, table));
}

/** Two devices under a fresh scope: `a` copied to `b`, then each writing a row the other does not hold. */
function divergedDevices(): { a: Device; b: Device } {
  const dir = freshScope();
  const a = freshDevice(dir, 'store-a');
  const b = copyDevice(dir, a, 'store-b');
  dispatch(a, 's-a-only');
  dispatch(b, 's-b-only');
  return { a, b };
}

describe('a full round trip with the file strategy', () => {
  it('reaches the same merged-table rows on both devices whichever pulls, under the plan\'s comparison', async () => {
    const { a, b } = divergedDevices();
    const [pathA, pathB] = [sqliteStorePath(a.root), sqliteStorePath(b.root)];
    const carriedFromA = join(scope, 'from-a-to-b');

    const pulledIntoB = await fileSync(b.root).pull({ from: pushedPath(await fileSync(a.root).push({ to: carriedFromA })), dryRun: false });
    expect(pulledIntoB.status).toBe('pulled');

    const carriedFromB = join(scope, 'from-b-to-a');
    const pulledIntoA = await fileSync(a.root).pull({ from: pushedPath(await fileSync(b.root).push({ to: carriedFromB })), dryRun: false });
    expect(pulledIntoA.status).toBe('pulled');

    expectSameUnion([pathA, pathB]);
    expect(sortedContent(pathA, 'dispatches')).toEqual(sortedContent(pathB, 'dispatches'));
    expect(readRows(pathA, 'dispatches').map((row) => row['session_id'])).toEqual(
      expect.arrayContaining(['s-a-only', 's-b-only']),
    );
  });

  it('adds no row on a repeated pull of the same carried file', async () => {
    const { a, b } = divergedDevices();
    const pathB = sqliteStorePath(b.root);
    const carried = await fileSync(a.root).push({ to: join(scope, 'from-a-to-b-repeated') });
    const from = pushedPath(carried);

    const firstPull = await fileSync(b.root).pull({ from, dryRun: false });
    expect(firstPull.status).toBe('pulled');
    const beforeRepeat = allTables(pathB);

    const secondPull = await fileSync(b.root).pull({ from, dryRun: false });

    expect(secondPull).toMatchObject({ status: 'pulled', merge: { status: 'merged', rowsAdded: 0, rowsInConflict: 0 } });
    expect(allTables(pathB)).toEqual(beforeRepeat);
  });
});
