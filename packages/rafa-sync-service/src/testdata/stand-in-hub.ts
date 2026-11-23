/**
 * A stand-in `rafa-hub` on `Bun.serve`, for `sync.test.ts`: the push and
 * pull routes of `packages/rafa-hub/src/server.ts`, answered from memory
 * by the rules the hub store port (`packages/rafa-hub/src/store/port.ts`)
 * states, so the strategy is exercised over real HTTP without the hub's
 * own store or identity.
 *
 *   - A push's payload is checked by core's `decodeWirePayload`; each
 *     row whose origin pair the stand-in does not hold is kept, with the
 *     next hub `seq` of its table, and the payload's migrations become
 *     the ones a pull names.
 *   - A pull answers each table's rows past `since` whose `origin_store`
 *     is not the caller's, and a cursor naming each table's highest hub
 *     `seq`, past the caller's own rows too.
 *
 *   - A status read answers the hub's status shape with the contract
 *     core's `WIRE_CONTRACT_VERSION` names and no capability, so the
 *     hub client sends `contractVersion` on push and pull.
 *   - Once {@link StandInHub.setProjection} names a map, the status
 *     answers `projection: true`, and a pull naming `migrations` that
 *     lack an id the stand-in holds is answered as a projecting hub
 *     answers it: the pushed migrations the pull names, the same rows,
 *     that map as `projected` and the cut columns it was handed, if
 *     any, as `projectedColumns`. A pull naming none, or naming every
 *     id held, is answered whole.
 *
 * It merges nothing: a row is matched by its origin pair alone. Every
 * push and pull is recorded in {@link StandInHub.requests}, and
 * {@link StandInHub.setFault} answers each with a response of the
 * case's own instead. A status read is counted in
 * {@link StandInHub.statusReads} alone and never faulted, so a case
 * reads its push and pull requests as it did before the client read
 * the status first.
 */
import type { WireCursor, WirePayload, WireRow } from '@open-tomato/rafa/store';

import { decodeWirePayload, WIRE_CONTRACT_VERSION, WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';

/** One request the stand-in saw. */
export interface SeenRequest {
  readonly method: string;
  readonly path: string;
  /** The `device` query parameter, or null. */
  readonly device: string | null;
  /** The `since` query parameter as a cursor, or null when it was left out. */
  readonly since: WireCursor | null;
  readonly authorization: string | null;
  /** The rows a push carried, across its tables; 0 for a pull. */
  readonly rows: number;
  /** The `contractVersion` query parameter, or null when it was left out. */
  readonly contractVersion: string | null;
  /** The `migrations` query parameter, or null when it was left out. */
  readonly migrations: string | null;
}

/** A running stand-in. */
export interface StandInHub {
  readonly url: string;
  /** Every push and pull seen, in order. */
  readonly requests: readonly SeenRequest[];
  /** How many status reads were answered. */
  readonly statusReads: () => number;
  /** The rows held in `table`, in hub `seq` order. */
  readonly held: (table: string) => readonly WireRow[];
  /** Answers every request with `answer` from now on; null goes back to serving. */
  readonly setFault: (answer: (() => Response) | null) => void;
  /** Ids a pull names beyond the migrations pushed, as a hub newer than the device's rafa would. */
  readonly setExtraMigrations: (ids: readonly string[]) => void;
  /** Answers `projection: true` and projects a pull naming `migrations` with `projected` and `columns`; null answers whole. */
  readonly setProjection: (
    projected: Readonly<Record<string, readonly string[]>> | null,
    columns?: Readonly<Record<string, readonly string[]>>,
  ) => void;
  /** Stops listening, so the next request fails to connect. */
  readonly stop: () => Promise<void>;
}

/** When every push is taken. */
const PUSHED_AT = '2026-10-01T09:00:00.000Z';

/** A success envelope holding `data`. */
function success(data: unknown): Response {
  return Response.json({ success: true, data });
}

/** How a row is identified across stores: its origin pair. */
function pairOf(row: WireRow): string {
  return `${String(row['origin_store'])}:${String(row['origin_seq'])}`;
}

/** Starts a stand-in on a free port of the loopback interface. */
export function startStandInHub(): StandInHub {
  const requests: SeenRequest[] = [];
  const tables = new Map<string, WireRow[]>();
  const pairs = new Set<string>();
  let migrations: readonly string[] = [];
  let extra: readonly string[] = [];
  let projection: Readonly<Record<string, readonly string[]>> | null = null;
  let cutColumns: Readonly<Record<string, readonly string[]>> | undefined;
  let fault: (() => Response) | null = null;
  let statusReads = 0;

  const status = (): Response => {
    statusReads += 1;
    return success({
      version: '0.0.0-stand-in',
      migrations,
      rows: Object.fromEntries([...tables].map(([table, rows]) => [table, rows.length])),
      devices: [],
      contractVersion: WIRE_CONTRACT_VERSION,
      capabilities: { fts: false, vector: false, graph: false, projection: projection !== null },
    });
  };

  const push = (payload: WirePayload): Response => {
    migrations = payload.migrations;
    let received = 0;
    let added = 0;
    for (const [table, rows] of Object.entries(payload.tables)) {
      const list = tables.get(table) ?? [];
      tables.set(table, list);
      for (const row of rows) {
        received += 1;
        if (pairs.has(pairOf(row))) continue;
        pairs.add(pairOf(row));
        list.push({ ...row, seq: list.length + 1 });
        added += 1;
      }
    }
    return success({ received, added, at: PUSHED_AT });
  };

  const pull = (device: string, since: WireCursor, named: readonly string[] | null): Response => {
    const answered: Record<string, readonly WireRow[]> = {};
    const cursor: Record<string, number> = {};
    for (const [table, rows] of tables) {
      answered[table] = rows.filter((row) => Number(row.seq) > (since[table] ?? 0) && row['origin_store'] !== device);
      cursor[table] = rows.length;
    }
    const lacking = named === null
      ? []
      : [...migrations, ...extra].filter((id) => !named.includes(id));
    const payload: WirePayload = projection === null || named === null || lacking.length === 0
      ? { format: WIRE_FORMAT, version: WIRE_VERSION, migrations: [...migrations, ...extra], tables: answered, cursor }
      : {
        format: WIRE_FORMAT,
        version: WIRE_VERSION,
        migrations: migrations.filter((id) => named.includes(id)),
        tables: answered,
        cursor,
        projected: projection,
        ...(cutColumns === undefined
          ? {}
          : { projectedColumns: cutColumns }),
      };
    return success(payload);
  };

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/v1/status')) return status();
      const sinceText = url.searchParams.get('since');
      const body = await request.text();
      const payload = request.method === 'POST'
        ? decodeWirePayload(body)
        : null;
      requests.push({
        method: request.method,
        path: url.pathname,
        device: url.searchParams.get('device'),
        since: sinceText === null
          ? null
          : JSON.parse(sinceText) as WireCursor,
        authorization: request.headers.get('authorization'),
        rows: payload === null
          ? 0
          : Object.values(payload.tables).reduce((total, rows) => total + rows.length, 0),
        contractVersion: url.searchParams.get('contractVersion'),
        migrations: url.searchParams.get('migrations'),
      });
      if (fault !== null) return fault();
      if (payload !== null) return push(payload);
      const named = url.searchParams.get('migrations');
      return pull(url.searchParams.get('device') ?? '', sinceText === null
        ? {}
        : JSON.parse(sinceText) as WireCursor, named === null
        ? null
        : named.split(','));
    },
  });

  return {
    url: `http://127.0.0.1:${String(server.port)}`,
    requests,
    statusReads: () => statusReads,
    held: (table) => tables.get(table) ?? [],
    setFault: (answer) => {
      fault = answer;
    },
    setExtraMigrations: (ids) => {
      extra = ids;
    },
    setProjection: (projected, columns) => {
      projection = projected;
      cutColumns = columns;
    },
    stop: () => server.stop(true),
  };
}
