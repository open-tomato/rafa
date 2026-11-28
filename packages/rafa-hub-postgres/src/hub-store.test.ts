/**
 * The connector's `HubStore` over a real Postgres where `POSTGRES_URL` is
 * set: a push merges by origin pair (a repeated push, a relayed row and a
 * row with no origin add nothing twice), `contract()` and `status()`
 * answer the wire ids the schema's Drizzle log maps to, a pull cuts its
 * page at the limit and resumes past it, and each listed project keeps
 * its rows in a schema of its own. Each case opens its store under a
 * schema prefix no other case or run holds and drops only the schemas
 * that prefix made. Without a database, the cases that refuse before
 * anything connects run over a stand-in client.
 */
import type { WirePayload, WireRow } from '@open-tomato/rafa/store';
import type { HubServedProject, HubStore, HubStoreContext } from '@open-tomato/rafa-hub-port';

import { WIRE_CONTRACT_VERSION, WIRE_FORMAT, WIRE_VERSION, WireFormatError } from '@open-tomato/rafa/store';
import { SQL } from 'bun';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';

import { DEFAULT_PROJECT_ID, projectSchemaName } from './hub-projects.js';
import { checkLimit } from './hub-pull.js';
import { openPostgresHubStore } from './hub-store.js';
import { PostgresUpgradeRequired } from './refusals.js';
import { DRIZZLE_WIRE_MIGRATIONS } from './wire-migrations.js';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const C = 'cccccccc-0000-4000-8000-00000000000c';

const T0 = '2026-11-26T10:00:00.000Z';
const ONE: HubServedProject = { id: '1'.repeat(40), name: 'open-tomato/one' };
const TWO: HubServedProject = { id: '2'.repeat(40), name: 'open-tomato/two' };

/** Every wire id the shipped migrations cover, in order: what a migrated schema mirrors. */
const WIRE_IDS = DRIZZLE_WIRE_MIGRATIONS.flatMap(({ wire }) => wire);

/** A commit row of `origin`'s `originSeq`, sent under the device's own `seq`. */
function commit(origin: string | null, originSeq: number | null, seq = 50 + (originSeq ?? 0)): WireRow {
  const sha = `sha-${String(origin)}-${String(originSeq)}`;
  return { seq, sha, row_json: JSON.stringify({ sha }), origin_store: origin, origin_seq: originSeq };
}

/** A payload carrying `tables` under `migrations`. */
function payloadOf(tables: Readonly<Record<string, readonly WireRow[]>>, migrations: readonly string[] = WIRE_IDS): WirePayload {
  return { format: WIRE_FORMAT, version: WIRE_VERSION, migrations, tables, cursor: {} };
}

/** The origin pairs of a pull's commits, sorted. */
function pairsIn(payload: WirePayload): string[] {
  return (payload.tables['commits'] ?? []).map((row) => `${String(row['origin_store'])}:${String(row['origin_seq'])}`).sort();
}

/** A context over the clock reading {@link T0}, with `extra` in it. */
function contextOf(extra: Partial<HubStoreContext> = {}): HubStoreContext {
  return { directory: '/nonexistent', now: () => new Date(T0), ...extra };
}

describe('openPostgresHubStore, before it connects', () => {
  it('refuses a layout the migrator cannot take, with the client closed', async () => {
    let closes = 0;
    const client = { close: async () => { closes += 1; } } as unknown as SQL;
    const opened = openPostgresHubStore(contextOf({ projects: [{ id: 'not-a-sha', name: 'x' }, ONE] }), { client, schemaPrefix: 'p' });
    await expect(opened).rejects.toThrow('is no schema name');
    expect(closes).toBe(1);
  });

  it('refuses a pull limit that is not a whole number above zero', () => {
    expect(() => checkLimit(0)).toThrow(RangeError);
    expect(() => checkLimit(1.5)).toThrow('a pull limit of 1.5 cannot be served');
    expect(() => checkLimit(1)).not.toThrow();
  });
});

const url = process.env['POSTGRES_URL'];

describe.skipIf(url === undefined || url === '')('openPostgresHubStore, live on POSTGRES_URL', () => {
  let admin: SQL;
  let store: HubStore | undefined;
  const made: string[] = [];

  /** Opens a store under a fresh prefix, recording the schemas its projects make for the drop. */
  async function open(extra: Partial<HubStoreContext> = {}): Promise<HubStore> {
    const prefix = `test_hubstore_${crypto
      .randomUUID()
      .replaceAll('-', '')
      .slice(0, 8)}`;
    const ids = extra.projects?.map(({ id }) => id) ?? [DEFAULT_PROJECT_ID];
    made.push(...ids.map((id) => projectSchemaName(prefix, id)));
    store = await openPostgresHubStore(contextOf(extra), { client: new SQL(url as string), schemaPrefix: prefix });
    return store;
  }

  /** The tables `schema` holds, sorted. */
  async function tablesOf(schema: string): Promise<string[]> {
    const rows = await admin.unsafe<{ table_name: string }[]>(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
      [schema],
    );
    return rows.map((row) => row.table_name);
  }

  beforeAll(() => {
    admin = new SQL(url as string);
  });

  afterEach(async () => {
    await store?.close();
    store = undefined;
    for (const name of made.splice(0)) await admin.unsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
  });

  afterAll(async () => {
    await admin.close();
  });

  describe('the merge by origin pair', () => {
    it('adds each origin pair once, over a repeated, an overlapping and a relaying push', async () => {
      const hub = await open();
      const first = await hub.push({ device: A, payload: payloadOf({ commits: [commit(A, 1), commit(A, 2)] }) });
      const again = await hub.push({ device: A, payload: payloadOf({ commits: [commit(A, 1), commit(A, 2)] }) });
      const relayed = await hub.push({ device: B, payload: payloadOf({ commits: [commit(A, 2, 9), commit(B, 1)] }) });
      const status = await hub.status();

      expect([first.added, again.added, relayed.added]).toEqual([2, 0, 1]);
      expect([first.received, again.received, relayed.received]).toEqual([2, 2, 2]);
      expect(status.rows['commits']).toBe(3);
      expect(pairsIn(await hub.pull({ device: C, since: {} }))).toEqual([`${A}:1`, `${A}:2`, `${B}:1`]);
    });

    it('numbers the rows it adds with its own seq, one apart, and keeps every other column as pushed', async () => {
      const hub = await open();
      const pushed = [commit(A, 5, 70), commit(B, 2, 90)];
      await hub.push({ device: A, payload: payloadOf({ commits: pushed }) });
      await hub.push({ device: A, payload: payloadOf({ commits: [commit(A, 6, 71)] }) });
      const rows = (await hub.pull({ device: C, since: {} })).tables['commits'] ?? [];

      expect(rows.map((row) => row['seq'])).toEqual([1, 2, 3]);
      const withoutSeq = (row: WireRow): WireRow => Object.fromEntries(Object.entries(row).filter(([column]) => column !== 'seq'));
      expect(rows.slice(0, 2).map(withoutSeq)).toEqual(pushed.map(withoutSeq));
    });

    it('adds a row with no origin once, matched by every column but seq, and a differing one beside it', async () => {
      const hub = await open();
      const legacy = commit(null, null);
      await hub.push({ device: A, payload: payloadOf({ commits: [legacy] }) });
      const again = await hub.push({ device: A, payload: payloadOf({ commits: [{ ...legacy, seq: 3 }, { ...legacy, row_json: '{}' }] }) });

      expect(again.added).toBe(1);
      expect((await hub.status()).rows['commits']).toBe(2);
    });

    it('stamps the device on a push that adds nothing, and names no device that only pulled', async () => {
      const hub = await open();
      await hub.pull({ device: C, since: {} });
      await hub.push({ device: B, payload: payloadOf({}) });

      expect((await hub.status()).devices).toEqual([{ device: B, lastPushAt: T0 }]);
    });
  });

  describe('what a push is refused', () => {
    it('refuses a payload naming a wire id the schema does not mirror, before anything is written', async () => {
      const hub = await open();
      const refused = hub.push({ device: A, payload: payloadOf({ commits: [commit(A, 1)] }, [...WIRE_IDS, 'from-the-future']) });

      await expect(refused).rejects.toBeInstanceOf(PostgresUpgradeRequired);
      await expect(refused).rejects.toThrow('has applied migration from-the-future');
      const status = await hub.status();
      expect([status.rows['commits'], status.devices]).toEqual([0, []]);
    });

    it('takes a payload naming fewer ids, a column its schema lacks held as null', async () => {
      const hub = await open();
      const behind = WIRE_IDS.slice(0, WIRE_IDS.indexOf('session-worktree'));
      const session: WireRow = { seq: 1, session_id: 's-1', row_json: '{}', origin_store: A, origin_seq: 1 };
      await hub.push({ device: A, payload: payloadOf({ sessions: [session] }, behind) });
      const [row] = (await hub.pull({ device: B, since: {} })).tables['sessions'] ?? [];

      expect(row).toEqual({ ...session, worktree: null });
    });

    it('refuses a table or a column the schema does not hold with the wire\'s format error', async () => {
      const hub = await open();

      await expect(hub.push({ device: A, payload: payloadOf({ ref_links: [{ seq: 1 }] }) })).rejects.toBeInstanceOf(WireFormatError);
      await expect(hub.push({ device: A, payload: payloadOf({ commits: [{ ...commit(A, 1), grown: 'x' }] }) })).rejects.toThrow('carry grown');
    });
  });

  describe('the wire ids and the contract', () => {
    it('answers the ids the schema\'s Drizzle log maps to, alike in contract() and status()', async () => {
      const hub = await open();
      const contract = hub.contract();

      expect(contract.migrations).toEqual(WIRE_IDS);
      expect((await hub.status()).migrations).toEqual(WIRE_IDS);
      expect(contract.contractVersion).toBe(WIRE_CONTRACT_VERSION);
      expect(contract.capabilities).toEqual({ fts: false, vector: false, graph: false, projection: false });
    });

    it('answers the context\'s payload cap as given, and no cap when it gives none', async () => {
      const uncapped = (await open()).contract().maxPayloadRows;
      await store?.close();
      const capped = (await open({ maxPayloadRows: 7 })).contract().maxPayloadRows;

      expect([uncapped, capped]).toEqual([null, 7]);
    });
  });

  describe('a paged pull', () => {
    it('answers at most the limit across tables, the caller\'s own counting none, and resumes past the page', async () => {
      const hub = await open();
      await hub.push({ device: A, payload: payloadOf({ commits: [commit(B, 1), commit(A, 1), commit(A, 2), commit(A, 3)] }) });
      const first = await hub.pull({ device: B, since: {}, limit: 2 });
      const second = await hub.pull({ device: B, since: first.cursor, limit: 2 });

      expect([pairsIn(first), pairsIn(second)]).toEqual([[`${A}:1`, `${A}:2`], [`${A}:3`]]);
      expect(first.cursor['commits']).toBe(3);
      expect(second.cursor['commits']).toBe(4);
    });
  });

  describe('one schema per project', () => {
    it('keeps each listed project\'s rows and devices in its own schema, and refuses one not listed', async () => {
      const hub = await open({ projects: [ONE, TWO] });
      await hub.push({ device: A, project: TWO.id, payload: payloadOf({ commits: [commit(A, 1)] }) });
      const one = await hub.status({ project: ONE.id });
      const two = await hub.status({ project: TWO.id });

      expect([one.rows['commits'], two.rows['commits']]).toEqual([0, 1]);
      expect([one.devices.length, two.devices.length]).toEqual([0, 1]);
      expect(two.projects).toEqual([ONE, TWO]);
      expect(await tablesOf(made[1] ?? '')).toContain('commits');
      await expect(hub.pull({ device: B, project: '3'.repeat(40), since: {} })).rejects.toThrow('is not served here; add it under hub.projects');
    });

    it('refuses a schema whose metadata holds another project, with the client closed', async () => {
      const hub = await open({ projects: [ONE, TWO] });
      await hub.status({ project: TWO.id });
      const schema = made[1] ?? '';
      await admin.unsafe(`UPDATE "${schema}".hub_store_meta SET project_id = 'someone-else'`);

      await expect(hub.status({ project: TWO.id })).resolves.toBeDefined();
      await hub.close();
      store = undefined;
      const prefix = schema.slice(0, schema.length - TWO.id.length - 1);
      const reopened = openPostgresHubStore(contextOf({ projects: [TWO, ONE] }), { client: new SQL(url as string), schemaPrefix: prefix });
      await expect(reopened).rejects.toThrow(`holds project someone-else, not ${TWO.id}`);
    });
  });

  it('refuses a request once closed', async () => {
    const hub = await open();
    await hub.close();
    store = undefined;

    await expect(hub.push({ device: A, payload: payloadOf({}) })).rejects.toThrow('the store is closed');
  });
});
