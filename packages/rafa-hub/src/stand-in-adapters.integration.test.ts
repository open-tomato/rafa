/**
 * The identity and hub store contract suites run against stand-in
 * adapters written here, in the test, beside the default SQLite store:
 * the spec's definition of done for the two ports, that an adapter the
 * package does not ship passes the same cases the shipped one does.
 *
 * The identity stand-in reads a scheme the default adapter does not,
 * a key in `x-hub-key`, so the suite cannot lean on `Authorization`.
 * The store stand-in keeps rows in `Map`s by origin pair, and counts
 * its hub `seq` per table apart from the rows it holds.
 */
import type { HubAction, HubIdentity, IdentityAnswer } from './identity/port.js';
import type {
  HubPullRequest,
  HubPushRequest,
  HubPushResult,
  HubStore,
  HubStoreContext,
  HubStoreStatus,
} from './store/port.js';
import type { WirePayload, WireRow } from '@open-tomato/rafa/store';

import { WIRE_FORMAT, WIRE_VERSION } from '@open-tomato/rafa/store';

import { identityContract } from './identity/contract.js';
import { HUB_ACTIONS } from './identity/port.js';
import { hubStoreContract } from './store/contract.js';
import { openSqliteHubStore } from './store/sqlite.js';

/** The provider the identity stand-in answers with. */
const KEY_PROVIDER = 'header-key';

/** The header the identity stand-in reads its credential from. */
const KEY_HEADER = 'x-hub-key';

/** What the identity stand-in grants each key. */
const KEYS: Readonly<Record<string, { readonly id: string; readonly may: readonly HubAction[] }>> = {
  'key-served-0001': { id: 'keyed-caller', may: HUB_ACTIONS },
  'key-forbidden-0002': { id: 'keyed-reader', may: [] },
};

/** The stand-in identity: a hub key in `x-hub-key`. */
function openKeyIdentity(): HubIdentity {
  const identify = (request: Request): Promise<IdentityAnswer> => {
    const key = request.headers.get(KEY_HEADER);
    const grant = key === null
      ? undefined
      : KEYS[key];
    if (grant === undefined) {
      return Promise.resolve({ served: false, refusal: { reason: 'unauthenticated', message: 'Send a hub key the hub knows.' } });
    }
    if (grant.may.length === 0) {
      return Promise.resolve({ served: false, refusal: { reason: 'forbidden', message: `${grant.id} may not sync with this hub.` } });
    }
    return Promise.resolve({ served: true, caller: { id: grant.id, provider: KEY_PROVIDER }, may: grant.may });
  };
  return { identify };
}

identityContract('header-key stand-in written in the test', () => ({
  identity: openKeyIdentity(),
  served: { [KEY_HEADER]: 'key-served-0001' },
  forbidden: { [KEY_HEADER]: 'key-forbidden-0002' },
  unrecognised: { [KEY_HEADER]: 'key-unknown-0003' },
}));

/** One table of the map store: rows by origin pair, and the last `seq` handed out. */
interface MapTable {
  readonly rows: ReadonlyMap<string, WireRow>;
  readonly lastSeq: number;
}

/** How a row is known: its origin pair. */
function pairKey(row: WireRow): string {
  return JSON.stringify([row['origin_store'], row['origin_seq']]);
}

/** The stand-in store: `Map`s by origin pair, a `seq` counter per table. */
function openMapStore(context: HubStoreContext): HubStore {
  let tables = new Map<string, MapTable>();
  let migrations: readonly string[] = [];
  let devices = new Map<string, string>();

  const push = (request: HubPushRequest): Promise<HubPushResult> => {
    const at = context.now().toISOString();
    const next = new Map(tables);
    let received = 0;
    let added = 0;
    for (const [name, pushed] of Object.entries(request.payload.tables)) {
      const rows = new Map(next.get(name)?.rows ?? []);
      let lastSeq = next.get(name)?.lastSeq ?? 0;
      for (const row of pushed) {
        received += 1;
        if (rows.has(pairKey(row))) continue;
        lastSeq += 1;
        rows.set(pairKey(row), { ...row, seq: lastSeq });
        added += 1;
      }
      next.set(name, { rows, lastSeq });
    }
    tables = next;
    migrations = [...migrations, ...request.payload.migrations.filter((id) => !migrations.includes(id))];
    devices = new Map(devices).set(request.device, at);
    return Promise.resolve({ received, added, at });
  };

  const pull = (request: HubPullRequest): Promise<WirePayload> => {
    const answered: Record<string, readonly WireRow[]> = {};
    const cursor: Record<string, number> = { ...request.since };
    for (const [name, table] of tables) {
      const since = request.since[name] ?? 0;
      answered[name] = [...table.rows.values()]
        .filter((row) => Number(row.seq) > since && row['origin_store'] !== request.device)
        .sort((left, right) => Number(left.seq) - Number(right.seq));
      cursor[name] = Math.max(since, table.lastSeq);
    }
    return Promise.resolve({ format: WIRE_FORMAT, version: WIRE_VERSION, migrations, tables: answered, cursor });
  };

  const status = (): Promise<HubStoreStatus> => Promise.resolve({
    migrations,
    rows: Object.fromEntries([...tables].map(([name, table]) => [name, table.rows.size])),
    devices: [...devices]
      .map(([device, lastPushAt]) => ({ device, lastPushAt }))
      .sort((left, right) => left.device.localeCompare(right.device)),
  });

  return { push, pull, status, close: () => Promise.resolve() };
}

hubStoreContract('map stand-in written in the test', (context) => openMapStore(context));

hubStoreContract('sqlite default, beside the stand-in', (context) => openSqliteHubStore(context));
