/**
 * The hub store port's contract suite: the cases every {@link HubStore}
 * adapter passes, exported as one function a test calls with a name and
 * an adapter factory, so an adapter written outside this package
 * (Postgres, Dolt) runs exactly the cases the SQLite one does.
 *
 * ```ts
 * import { hubStoreContract } from './contract.js';
 *
 * // `openPostgresHubStore` stands for any adapter's factory.
 * hubStoreContract('postgres', (context) => openPostgresHubStore(context));
 * ```
 *
 * ## What it covers
 *
 * Push, pull past a cursor excluding the caller's own origin,
 * idempotent repeat pushes, each device's last push, and row counts:
 * the rules `port.ts` lists as what an adapter owes. What a push naming
 * a migration the hub lacks is refused with is the adapter's own, and
 * its own suite's.
 *
 * ## The payloads it pushes
 *
 * Real ones. A store is opened through `@open-tomato/rafa/store` under
 * the temporary directory, given one commit and one session, and
 * exported with `exportWirePayload`; its migration ids and the two rows'
 * columns are the template every payload here is built from, so a
 * column a later migration adds is carried as the device would carry
 * it. Each row's `seq`, key, `row_json` and origin pair are then set
 * by the case, since a store opened outside a git repository mints no
 * origin: measured, the export's `origin_store` and `origin_seq` were
 * both null. Every payload is passed through `decodeWirePayload` before
 * it is pushed, so an adapter is handed nothing a device could not send.
 *
 * ## Each case's world
 *
 * A fresh adapter per case, made over a new empty directory under the
 * temporary directory and a clock the case sets; the store is closed
 * and the directory removed after the case, whatever it did.
 */
import type {
  HubPullRequest,
  HubStore,
  HubStoreFactory,
  HubStoreStatus,
} from './port.js';
import type {
  CommitEffortRow,
  SessionEffortRow,
  WireCursor,
  WirePayload,
  WireRow,
} from '@open-tomato/rafa/store';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  decodeWirePayload,
  encodeWirePayload,
  exportWirePayload,
  openSqliteStore,
  WIRE_FORMAT,
  WIRE_VERSION,
} from '@open-tomato/rafa/store';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

/** The three devices a case pushes and pulls as, each named by its store origin. */
const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const C = 'cccccccc-0000-4000-8000-00000000000c';

/** The clock's first reading, and two later ones. */
const T0 = '2026-09-30T10:00:00.000Z';
const T1 = '2026-09-30T10:05:00.000Z';
const T2 = '2026-09-30T11:00:00.000Z';

/** The two tables the suite fills. */
const COMMITS = 'commits';
const SESSIONS = 'sessions';

/** What every payload is built from: a real export's migrations and row columns. */
interface WireTemplate {
  readonly migrations: readonly string[];
  readonly commit: WireRow;
  readonly session: WireRow;
}

/** One case's adapter, and the clock it was made with. */
interface World {
  readonly store: HubStore;
  /** Sets what the adapter's clock reads from now on. */
  readonly setClock: (iso: string) => void;
  /** Closes the store and removes its directory. */
  readonly close: () => Promise<void>;
}

/** The row at `index` of `rows`, failing the case when there is none. */
function only(rows: readonly WireRow[] | undefined, index = 0): WireRow {
  const row = rows?.[index];
  if (row === undefined) throw new Error(`hub store contract: the template export holds no row at ${String(index)}`);
  return row;
}

/**
 * Exports a real store holding one commit and one session, as the
 * template. The store keys a row by its key and keeps the rest as
 * written, so each planted row holds its key and nothing a case reads.
 */
function readTemplate(): WireTemplate {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-contract-template-')));
  try {
    const store = openSqliteStore(root);
    store.append('commits', [{ sha: 'f'.repeat(40), timestamp: T0 } as CommitEffortRow]);
    store.append('sessions', [{ sessionId: 'template-session' } as SessionEffortRow]);
    const exported = exportWirePayload({ path: store.path('commits') });
    return {
      migrations: exported.migrations,
      commit: only(exported.tables[COMMITS]),
      session: only(exported.tables[SESSIONS]),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A 40-character hex sha, unique to one origin pair. */
function shaOf(origin: string, originSeq: number): string {
  return new Bun.CryptoHasher('sha1')
    .update(`${origin}:${String(originSeq)}`)
    .digest('hex');
}

/** How a row is identified across stores: its origin pair. */
function pairOf(row: WireRow): string {
  return `${String(row['origin_store'])}:${String(row['origin_seq'])}`;
}

/**
 * The key of a commit's `row_json` core's merge recomputes over the
 * commits a store holds (`MERGE_RULES`, `commits.row_json` edited as
 * `recomputed`), so an adapter merging through `mergeStore` answers it
 * changed. Spelled here since the store subpath does not export it.
 */
const RECOMPUTED_GAP = 'minutesSincePrevious';

/** `row_json` with the recomputed gap left out, its other keys in their order. */
function withoutGap(rowJson: WireRow[string]): WireRow[string] {
  if (typeof rowJson !== 'string') return rowJson;
  const parsed = JSON.parse(rowJson) as Record<string, unknown>;
  return JSON.stringify(Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== RECOMPUTED_GAP)));
}

/**
 * Every column of each commit row but `seq`, with the recomputed gap
 * left out of `row_json`, sorted by origin pair, for comparing rows as
 * pushed with rows as pulled.
 */
function withoutSeq(rows: readonly WireRow[]): Readonly<Record<string, unknown>>[] {
  return [...rows]
    .sort((left, right) => pairOf(left).localeCompare(pairOf(right)))
    .map((row) => Object.fromEntries(Object.entries(row)
      .filter(([column]) => column !== 'seq')
      .map(([column, value]) => [column, column === 'row_json'
        ? withoutGap(value)
        : value])));
}

/** Builds rows and payloads from the template. */
function builders(template: () => WireTemplate): {
  commit: (origin: string, originSeq: number, seq?: number) => WireRow;
  session: (origin: string, originSeq: number, seq?: number) => WireRow;
  payload: (tables: Readonly<Record<string, readonly WireRow[]>>) => WirePayload;
} {
  const commit = (origin: string, originSeq: number, seq = originSeq): WireRow => {
    const sha = shaOf(origin, originSeq);
    return {
      ...template().commit,
      seq,
      sha,
      row_json: JSON.stringify({ sha, timestamp: T0 }),
      origin_store: origin,
      origin_seq: originSeq,
    };
  };
  const session = (origin: string, originSeq: number, seq = originSeq): WireRow => {
    const sessionId = `session-${origin}-${String(originSeq)}`;
    return {
      ...template().session,
      seq,
      session_id: sessionId,
      row_json: JSON.stringify({ sessionId }),
      origin_store: origin,
      origin_seq: originSeq,
    };
  };
  const payload = (tables: Readonly<Record<string, readonly WireRow[]>>): WirePayload => {
    const cursor = Object.fromEntries(Object.entries(tables)
      .map(([table, rows]) => [table, rows.reduce((highest, row) => Math.max(highest, Number(row.seq)), 0)]));
    const built = { format: WIRE_FORMAT, version: WIRE_VERSION, migrations: template().migrations, tables, cursor };
    return decodeWirePayload(JSON.stringify(built));
  };
  return { commit, session, payload };
}

/** Opens a fresh adapter over a new directory and a settable clock. */
async function openWorld(factory: HubStoreFactory): Promise<World> {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-hub-contract-')));
  let reading = T0;
  try {
    const store = await factory({ directory, now: () => new Date(reading) });
    return {
      store,
      setClock: (iso) => {
        reading = iso;
      },
      close: async () => {
        try {
          await store.close();
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

/** The origin pairs `payload` carries in `table`, sorted. */
function pairsIn(payload: WirePayload, table: string): string[] {
  return (payload.tables[table] ?? []).map(pairOf).sort();
}

/** The pairs of `rows`, sorted. */
function pairsOf(...rows: WireRow[]): string[] {
  return rows.map(pairOf).sort();
}

/** The rows `status` counts in `table`; a table left out holds none. */
function countIn(status: HubStoreStatus, table: string): number {
  return status.rows[table] ?? 0;
}

/** Every row a pull answered, across its tables. */
function rowsIn(payload: WirePayload): number {
  return Object.values(payload.tables).reduce((total, rows) => total + rows.length, 0);
}

/**
 * Registers the contract's cases for one adapter, under a `describe`
 * naming it. Call it from a test file, once per adapter.
 */
export function hubStoreContract(name: string, factory: HubStoreFactory): void {
  describe(`the hub store contract: ${name}`, () => {
    let template: WireTemplate | undefined;
    let world: World | undefined;
    const build = builders(() => {
      if (template === undefined) throw new Error('hub store contract: the template was not read');
      return template;
    });
    const { commit, session, payload } = build;
    const hub = (): HubStore => {
      if (world === undefined) throw new Error('hub store contract: no adapter is open');
      return world.store;
    };
    const pull = (device: string, since: WireCursor = {}): Promise<WirePayload> => {
      const request: HubPullRequest = { device, since };
      return hub().pull(request);
    };

    beforeAll(() => {
      template = readTemplate();
    });
    beforeEach(async () => {
      world = await openWorld(factory);
    });
    afterEach(async () => {
      const open = world;
      world = undefined;
      await open?.close();
    });

    describe('push', () => {
      it('answers the rows a push carried and how many were new, at the clock\'s time', async () => {
        world?.setClock(T1);

        const result = await hub().push({ device: A, payload: payload({ [COMMITS]: [commit(A, 1), commit(A, 2)], [SESSIONS]: [session(A, 3)] }) });

        expect(result).toEqual({ received: 3, added: 3, at: T1 });
      });

      it('counts the rows it holds per table', async () => {
        const empty = await hub().status();
        await hub().push({ device: A, payload: payload({ [COMMITS]: [commit(A, 1), commit(A, 2)], [SESSIONS]: [session(A, 3)] }) });
        await hub().push({ device: B, payload: payload({ [COMMITS]: [commit(B, 1)] }) });
        const status = await hub().status();

        expect([countIn(empty, COMMITS), countIn(empty, SESSIONS)]).toEqual([0, 0]);
        expect([countIn(status, COMMITS), countIn(status, SESSIONS)]).toEqual([3, 1]);
      });

      it('holds every migration a push it took named', async () => {
        const pushed = payload({ [COMMITS]: [commit(A, 1)] });
        await hub().push({ device: A, payload: pushed });
        const { migrations } = await hub().status();

        expect(pushed.migrations.length).toBeGreaterThan(0);
        expect(pushed.migrations.filter((id) => !migrations.includes(id))).toEqual([]);
      });
    });

    describe('a repeated push', () => {
      it('adds nothing when the same payload is pushed again', async () => {
        const pushed = payload({ [COMMITS]: [commit(A, 1), commit(A, 2)], [SESSIONS]: [session(A, 3)] });
        await hub().push({ device: A, payload: pushed });
        const again = await hub().push({ device: A, payload: pushed });
        const status = await hub().status();
        const pulled = await pull(B);

        expect([again.received, again.added]).toEqual([3, 0]);
        expect([countIn(status, COMMITS), countIn(status, SESSIONS)]).toEqual([2, 1]);
        expect(pairsIn(pulled, COMMITS)).toEqual(pairsOf(commit(A, 1), commit(A, 2)));
        expect(pairsIn(pulled, SESSIONS)).toEqual(pairsOf(session(A, 3)));
      });

      it('adds only the rows an overlapping push had not sent before', async () => {
        await hub().push({ device: A, payload: payload({ [COMMITS]: [commit(A, 1), commit(A, 2)] }) });
        const overlapping = await hub().push({ device: A, payload: payload({ [COMMITS]: [commit(A, 2), commit(A, 3)] }) });
        const status = await hub().status();
        const pulled = await pull(B);

        expect([overlapping.received, overlapping.added]).toEqual([2, 1]);
        expect(countIn(status, COMMITS)).toBe(3);
        expect(pairsIn(pulled, COMMITS)).toEqual(pairsOf(commit(A, 1), commit(A, 2), commit(A, 3)));
      });

      it('keeps a row another device relays once, under its origin pair', async () => {
        await hub().push({ device: A, payload: payload({ [COMMITS]: [commit(A, 1)] }) });
        const relayed = await hub().push({ device: B, payload: payload({ [COMMITS]: [commit(B, 1), commit(A, 1, 2)] }) });
        const status = await hub().status();
        const pulled = await pull(C);

        expect([relayed.received, relayed.added]).toEqual([2, 1]);
        expect(countIn(status, COMMITS)).toBe(2);
        expect(pairsIn(pulled, COMMITS)).toEqual(pairsOf(commit(A, 1), commit(B, 1)));
      });
    });

    describe('pull', () => {
      it('answers no row from a hub no device has pushed to', async () => {
        const pulled = await pull(A);

        expect(rowsIn(pulled)).toBe(0);
      });

      it('answers the rows other devices pushed and never the caller\'s own', async () => {
        await hub().push({ device: A, payload: payload({ [COMMITS]: [commit(A, 1), commit(A, 2)], [SESSIONS]: [session(A, 3)] }) });
        await hub().push({ device: B, payload: payload({ [COMMITS]: [commit(B, 1)] }) });
        const byA = await pull(A);
        const byB = await pull(B);

        expect([pairsIn(byA, COMMITS), pairsIn(byA, SESSIONS)]).toEqual([pairsOf(commit(B, 1)), []]);
        expect([pairsIn(byB, COMMITS), pairsIn(byB, SESSIONS)]).toEqual([pairsOf(commit(A, 1), commit(A, 2)), pairsOf(session(A, 3))]);
      });

      it('excludes by the row\'s origin, not by the device that pushed it', async () => {
        await hub().push({ device: A, payload: payload({ [COMMITS]: [commit(A, 1), commit(B, 1, 2)] }) });
        const byB = await pull(B);
        const byA = await pull(A);
        const byC = await pull(C);

        expect(pairsIn(byB, COMMITS)).toEqual(pairsOf(commit(A, 1)));
        expect(pairsIn(byA, COMMITS)).toEqual(pairsOf(commit(B, 1)));
        expect(pairsIn(byC, COMMITS)).toEqual(pairsOf(commit(A, 1), commit(B, 1)));
      });

      it('carries every column as pushed but the recomputed gap, with seq the hub\'s own in rising order past the cursor', async () => {
        const pushedRows = [commit(A, 5, 7), commit(A, 6, 9), commit(B, 2, 11)];
        await hub().push({ device: A, payload: payload({ [COMMITS]: pushedRows }) });
        const pulled = await pull(C);
        const rows = pulled.tables[COMMITS] ?? [];
        const seqs = rows.map((row) => Number(row.seq));

        expect(withoutSeq(rows)).toEqual(withoutSeq(pushedRows));
        expect(seqs.every((seq, index) => seq > 0 && (index === 0 || seq > (seqs[index - 1] ?? 0)))).toBe(true);
        expect(pulled.cursor[COMMITS] ?? 0).toBeGreaterThanOrEqual(Math.max(...seqs));
      });

      it('answers only the rows pushed past the cursor it answered', async () => {
        await hub().push({ device: A, payload: payload({ [COMMITS]: [commit(A, 1)], [SESSIONS]: [session(A, 2)] }) });
        const first = await pull(C);
        const unchanged = await pull(C, first.cursor);
        await hub().push({ device: B, payload: payload({ [COMMITS]: [commit(B, 1)] }) });
        await hub().push({ device: A, payload: payload({ [SESSIONS]: [session(A, 3)] }) });
        const second = await pull(C, first.cursor);
        const drained = await pull(C, second.cursor);

        expect([pairsIn(first, COMMITS), pairsIn(first, SESSIONS)]).toEqual([pairsOf(commit(A, 1)), pairsOf(session(A, 2))]);
        expect(rowsIn(unchanged)).toBe(0);
        expect([pairsIn(second, COMMITS), pairsIn(second, SESSIONS)]).toEqual([pairsOf(commit(B, 1)), pairsOf(session(A, 3))]);
        expect(rowsIn(drained)).toBe(0);
      });

      it('answers a payload the wire codec reads back unchanged', async () => {
        await hub().push({ device: A, payload: payload({ [COMMITS]: [commit(A, 1)], [SESSIONS]: [session(A, 2)] }) });
        const pulled = await pull(B);

        expect(decodeWirePayload(encodeWirePayload(pulled))).toEqual(pulled);
        expect(rowsIn(pulled)).toBe(2);
      });
    });

    describe('last push per device', () => {
      it('names no device before a push, nor a device that only pulled', async () => {
        const before = await hub().status();
        await pull(C);
        await hub().push({ device: A, payload: payload({ [COMMITS]: [commit(A, 1)] }) });
        await pull(B);
        const after = await hub().status();

        expect(before.devices).toEqual([]);
        expect(after.devices).toEqual([{ device: A, lastPushAt: T0 }]);
      });

      it('records each device\'s latest push at the clock\'s time, in device order', async () => {
        await hub().push({ device: B, payload: payload({ [COMMITS]: [commit(B, 1)] }) });
        world?.setClock(T1);
        await hub().push({ device: A, payload: payload({ [COMMITS]: [commit(A, 1)] }) });
        world?.setClock(T2);
        await hub().push({ device: B, payload: payload({ [COMMITS]: [commit(B, 2)] }) });
        const { devices } = await hub().status();

        expect(devices).toEqual([{ device: A, lastPushAt: T1 }, { device: B, lastPushAt: T2 }]);
      });

      it('moves a device\'s last push on a push that adds nothing', async () => {
        const pushed = payload({ [COMMITS]: [commit(A, 1)] });
        await hub().push({ device: A, payload: pushed });
        world?.setClock(T2);
        const again = await hub().push({ device: A, payload: pushed });
        const { devices } = await hub().status();

        expect([again.added, again.at]).toEqual([0, T2]);
        expect(devices).toEqual([{ device: A, lastPushAt: T2 }]);
      });
    });
  });
}
