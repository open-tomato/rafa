/**
 * A stand-in hub store: the port held in memory, written for the tests
 * so the contract suite runs against an adapter that is not the SQLite
 * one, as the spec's definition of done asks. It keeps each table's rows
 * as pushed under a hub `seq` of its own, knows a row by its origin
 * pair, and merges nothing, so it is the port's rules and no more.
 *
 * Each push replaces the state with a new one rather than editing it.
 */
import type {
  HubDevice,
  HubPullRequest,
  HubPushRequest,
  HubPushResult,
  HubStore,
  HubStoreContext,
  HubStoreStatus,
} from '../port.js';
import type { WirePayload, WireRow } from '@open-tomato/rafa/store';

import { WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';

/** Everything the stand-in holds. */
interface MemoryState {
  /** Each table's rows in hub `seq` order, `seq` the hub's own. */
  readonly tables: Readonly<Record<string, readonly WireRow[]>>;
  /** Every migration a push named, in the order first named. */
  readonly migrations: readonly string[];
  /** Each device's last push, ISO 8601. */
  readonly devices: Readonly<Record<string, string>>;
}

/** How a row is known: its origin pair. */
function pairOf(row: WireRow): string {
  return `${String(row['origin_store'])}:${String(row['origin_seq'])}`;
}

/** `held` with the rows of `pushed` whose origin pair it lacks appended under new hub seqs. */
function appendNew(held: readonly WireRow[], pushed: readonly WireRow[]): readonly WireRow[] {
  return pushed.reduce<readonly WireRow[]>((rows, row) => {
    if (rows.some((kept) => pairOf(kept) === pairOf(row))) return rows;
    return [...rows, { ...row, seq: rows.length + 1 }];
  }, held);
}

/** Opens an empty stand-in; `directory` is left unused. */
export function openMemoryHubStore(context: HubStoreContext): HubStore {
  let state: MemoryState = { tables: {}, migrations: [], devices: {} };

  const push = (request: HubPushRequest): Promise<HubPushResult> => {
    const { device, payload } = request;
    const at = context.now().toISOString();
    const pushed = Object.entries(payload.tables);
    const tables = Object.fromEntries(pushed.map(([table, rows]) => [table, appendNew(state.tables[table] ?? [], rows)]));
    const added = pushed.reduce((total, [table]) => total + (tables[table]?.length ?? 0) - (state.tables[table]?.length ?? 0), 0);
    state = {
      tables: { ...state.tables, ...tables },
      migrations: [...state.migrations, ...payload.migrations.filter((id) => !state.migrations.includes(id))],
      devices: { ...state.devices, [device]: at },
    };
    const received = pushed.reduce((total, [, rows]) => total + rows.length, 0);
    return Promise.resolve({ received, added, at });
  };

  const pull = (request: HubPullRequest): Promise<WirePayload> => {
    const { device, since } = request;
    const held = Object.entries(state.tables);
    const tables = Object.fromEntries(held.map(([table, rows]) => [
      table,
      rows.filter((row) => Number(row.seq) > (since[table] ?? 0) && row['origin_store'] !== device),
    ]));
    const cursor = { ...since, ...Object.fromEntries(held.map(([table, rows]) => [table, Math.max(since[table] ?? 0, rows.length)])) };
    return Promise.resolve({ format: WIRE_FORMAT, version: WIRE_VERSION, migrations: state.migrations, tables, cursor });
  };

  const status = (): Promise<HubStoreStatus> => {
    const rows = Object.fromEntries(Object.entries(state.tables).map(([table, held]) => [table, held.length]));
    const devices: HubDevice[] = Object.entries(state.devices)
      .map(([device, lastPushAt]) => ({ device, lastPushAt }))
      .sort((left, right) => left.device.localeCompare(right.device));
    return Promise.resolve({ migrations: state.migrations, rows, devices });
  };

  return { push, pull, status, close: () => Promise.resolve() };
}
