/**
 * The connector's `HubStore`: every served project's rows kept in a
 * Postgres schema of its own (`hub-projects.ts`), over one `Bun.sql`
 * client through Drizzle (`drizzle-orm/bun-sql`).
 *
 * ## Opening
 *
 * {@link openPostgresHubStore} takes an open client, as the connection
 * opener (`connection.ts`) answers it, and owns it from then on. It
 * reads the layout, then brings the first served project's schema
 * through every shipped migration (`migrator.ts`), records the project
 * in the schema's metadata row, and reads the wire migration ids the
 * schema mirrors off its Drizzle log (`wireMigrationIds`). Every other
 * project's schema is made the same way on its first request; a first
 * request that fails there is tried again on the next. A schema whose
 * metadata names another project is refused, so two hubs whose prefixes
 * meet never merge one project's rows into another's. An open that
 * fails closes the client.
 *
 * ## Push
 *
 * A payload naming a wire migration the project's schema does not
 * mirror is refused with {@link PostgresUpgradeRequired} before
 * anything is written, as the SQLite store refuses a newer store; a
 * payload naming fewer is taken. A table or column the schema does not
 * hold is refused with core's `WireFormatError`. Then, in one
 * transaction, each table the payload fills is locked against other
 * writers (`EXCLUSIVE`, which readers pass), in name order, so two
 * pushes never interleave their `seq`; what it holds of the payload's
 * origin pairs is read, and the rows `mergeByOrigin` (`hub-merge.ts`)
 * answers new are inserted past its highest `seq`. `added` counts them.
 * The device's last push is stamped in `hub_devices` in the same
 * transaction, a push that adds nothing included, at the context's
 * clock read once before it.
 *
 * ## Pull, status and contract
 *
 * A pull is `readPulledRows` (`hub-pull.ts`) in one read-only snapshot,
 * framed with the schema's wire migration ids. `status()` answers the
 * project's wire ids read fresh off its log, each row table's count,
 * every device's last push in `device` order, and every listed project
 * (none when the context lists none). `contract()` answers
 * `WIRE_CONTRACT_VERSION`, the first project's wire ids as read at open,
 * the context's `maxPayloadRows` as given (`null` when it gives none;
 * the store enforces no cap), and every capability `false`: this store
 * has no index of its own and cannot project, so the hub's route
 * refuses a device behind it.
 *
 * ## Closing
 *
 * `close()` closes the client; a request after it is refused.
 *
 * ## The index beside it
 *
 * {@link openPostgresHubStoreParts} answers, beside the store, the
 * lookup of a project's schema made ready as a push makes it, which the
 * connector's index rebuild (`index-build.ts`) runs on, so the pointer
 * to the serving build is there before any build is swapped in.
 *
 * Nothing here is exported from the package's entry: the client it
 * takes is a `Bun.sql` type the leak rule keeps inside the connector.
 */
import type { HeldRows } from './hub-merge.js';
import type { ProjectSchema } from './hub-projects.js';
import type { HubDatabase, HubTransaction } from './hub-tables.js';
import type { FolderMigration } from './migrator.js';
import type { WireTable } from './schema.js';
import type { WirePayload, WireRow } from '@open-tomato/rafa/store';
import type {
  HubCapabilities,
  HubContract,
  HubDevice,
  HubPushRequest,
  HubPushResult,
  HubStore,
  HubStoreContext,
  HubStoreStatus,
} from '@open-tomato/rafa-hub-port';
import type { SQL } from 'bun';

import { WIRE_CONTRACT_VERSION, WIRE_FORMAT, WIRE_VERSION, WireFormatError } from '@open-tomato/rafa/store';
import { asc, count, isNull, max, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';

import { contentKey, mergeByOrigin, pairKey, SEQ, unknownColumns } from './hub-merge.js';
import { schemaLayout } from './hub-projects.js';
import { checkLimit, readPulledRows } from './hub-pull.js';
import { columnNames, columnOf, inProjectSchema, wireRowOf } from './hub-tables.js';
import { appliedMigrations, migrateProjectSchema, readFolderMigrations, SHIPPED_MIGRATIONS_FOLDER } from './migrator.js';
import { PostgresUpgradeRequired } from './refusals.js';
import { hubDevices, hubStoreMeta, WIRE_TABLES } from './schema.js';
import { wireMigrationIds } from './wire-migrations.js';

/** What the store may vary beyond the port's context. */
export interface PostgresHubStoreOptions {
  /** The open client, which the store owns and closes on `close()`. */
  readonly client: SQL;
  /** The prefix of every project's schema name; `DEFAULT_SCHEMA_PREFIX` when left out. */
  readonly schemaPrefix?: string;
}

/** The most rows one insert statement carries, well under Postgres's 65535 bound parameters. */
export const INSERT_BATCH = 1000;

/** What the store can answer beyond push, pull and status: nothing, as the module note says. */
const CAPABILITIES: HubCapabilities = Object.freeze({ fts: false, vector: false, graph: false, projection: false });

/** A project whose schema is migrated and recorded, with the wire ids it mirrors. */
interface ReadyProject {
  readonly place: ProjectSchema;
  readonly migrations: readonly string[];
}

/** The rows a payload carries across every table. */
function rowsIn(payload: WirePayload): number {
  return Object.values(payload.tables).reduce((total, rows) => total + rows.length, 0);
}

/** Refuses a payload naming a wire id `held` lacks, or a table or column the schema does not hold. */
function checkPayload(payload: WirePayload, held: readonly string[]): void {
  const missing = payload.migrations.filter((id) => !held.includes(id));
  if (missing.length > 0) throw new PostgresUpgradeRequired(missing);
  for (const [name, rows] of Object.entries(payload.tables)) {
    const table = WIRE_TABLES[name];
    if (table === undefined) throw new WireFormatError(`hub postgres: the payload carries ${name}, which this hub's schema does not hold`);
    const unknown = unknownColumns(rows, columnNames(table));
    if (unknown.length > 0) {
      throw new WireFormatError(`hub postgres: the payload's ${name} rows carry ${unknown.join(', ')}, which this hub's schema does not hold`);
    }
  }
}

/** What `table` holds of the origin pairs and the unpaired rows `rows` carry. */
async function heldOf(tx: HubTransaction, name: string, table: WireTable, rows: readonly WireRow[]): Promise<HeldRows> {
  const paired = rows.filter((row) => pairKey(row) !== null);
  const pairs = new Set<string>();
  if (paired.length > 0) {
    const wanted = JSON.stringify(paired.map((row) => ({ s: row['origin_store'], q: row['origin_seq'] })));
    const found = await tx.execute<{ pair: string }>(sql`SELECT origin_store || ':' || origin_seq::text AS pair FROM ${table}
      JOIN jsonb_to_recordset(CAST(${wanted} AS text)::jsonb) AS wanted(s text, q bigint) ON origin_store = wanted.s AND origin_seq = wanted.q`);
    for (const { pair } of found) pairs.add(pair);
  }
  const contents = new Set<string>();
  if (paired.length < rows.length) {
    const columns = columnNames(table);
    const unpaired = await tx
      .select()
      .from(table)
      .where(or(isNull(columnOf(table, 'origin_store')), isNull(columnOf(table, 'origin_seq'))));
    for (const row of unpaired) contents.add(contentKey(wireRowOf(name, row), columns));
  }
  return { pairs, contents };
}

/** Merges one table's rows into the project's schema under its lock; answers the rows added. */
async function mergeTable(tx: HubTransaction, name: string, rows: readonly WireRow[]): Promise<number> {
  const table = WIRE_TABLES[name];
  if (table === undefined || rows.length === 0) return 0;
  await tx.execute(sql`LOCK TABLE ${table} IN EXCLUSIVE MODE`);
  const held = await heldOf(tx, name, table, rows);
  const [top] = await tx.select({ highest: max(columnOf(table, SEQ)) }).from(table);
  const fresh = mergeByOrigin(rows, held, columnNames(table), Number(top?.highest ?? 0) + 1);
  for (let start = 0; start < fresh.length; start += INSERT_BATCH) {
    await tx.insert(table).values(fresh.slice(start, start + INSERT_BATCH) as never);
  }
  return fresh.length;
}

/** Each row table's count and every device's last push, inside the project's schema. */
async function readHeld(tx: HubTransaction): Promise<Pick<HubStoreStatus, 'rows' | 'devices'>> {
  const rows: Record<string, number> = {};
  for (const [name, table] of Object.entries(WIRE_TABLES)) {
    const [counted] = await tx.select({ n: count() }).from(table);
    rows[name] = counted?.n ?? 0;
  }
  const devices: HubDevice[] = (await tx
    .select({ device: hubDevices.device, lastPushAt: hubDevices.lastPushAt })
    .from(hubDevices)
    .orderBy(asc(hubDevices.device)))
    .map((device) => Object.freeze({ ...device }));
  return { rows: Object.freeze(rows), devices: Object.freeze(devices) };
}

/** Records `place` in its schema's metadata row, refusing a schema that holds another project. */
async function recordProject(db: HubDatabase, place: ProjectSchema, now: () => Date): Promise<void> {
  await inProjectSchema(db, place.schema, async (tx) => {
    await tx
      .insert(hubStoreMeta)
      .values({ id: 1, projectId: place.id, contractVersion: WIRE_CONTRACT_VERSION, createdAt: now().toISOString() })
      .onConflictDoNothing({ target: hubStoreMeta.id });
    const [meta] = await tx.select({ projectId: hubStoreMeta.projectId }).from(hubStoreMeta);
    if (meta?.projectId !== place.id) {
      throw new Error(`hub postgres: the schema ${place.schema} holds project ${String(meta?.projectId)}, not ${place.id}; give this hub another hub.store.postgres schema prefix or database`);
    }
  });
}

/** The store, and what the index beside it shares of it. */
export interface PostgresHubStoreParts {
  /** The port's store. */
  readonly store: HubStore;
  /**
   * The schema of the project a request names, the first served one's
   * for none, migrated and recorded as a push would find it. Rejects for
   * a project not served, and once the store is closed.
   */
  readonly placeOf: (project: string | undefined) => Promise<ProjectSchema>;
}

/**
 * Opens the connector's store over `context` on `options.client`, the
 * first served project's schema made when it is not there and every
 * other project's on first use. Rejects, with the client closed, when
 * the layout is refused or the first schema cannot be made; see the
 * module note.
 */
export async function openPostgresHubStore(context: HubStoreContext, options: PostgresHubStoreOptions): Promise<HubStore> {
  return (await openPostgresHubStoreParts(context, options)).store;
}

/** {@link openPostgresHubStore}, answering beside the store the schema lookup the index rebuild runs on. */
export async function openPostgresHubStoreParts(context: HubStoreContext, options: PostgresHubStoreOptions): Promise<PostgresHubStoreParts> {
  const { client } = options;
  const { now } = context;
  const db: HubDatabase = drizzle({ client });
  let journal: readonly FolderMigration[];
  let layout: ReturnType<typeof schemaLayout>;
  try {
    journal = readFolderMigrations(SHIPPED_MIGRATIONS_FOLDER);
    layout = schemaLayout(context.projects ?? [], options.schemaPrefix);
  } catch (error) {
    await client.close();
    throw error;
  }
  const wireIdsOf = async (schema: string): Promise<readonly string[]> => Object.freeze(wireMigrationIds(journal, await appliedMigrations(client, schema)));
  const readying = new Map<string, Promise<ReadyProject>>();
  let closed = false;

  const ready = (project: string | undefined): Promise<ReadyProject> => {
    if (closed) return Promise.reject(new Error('hub store: the store is closed'));
    let place: ProjectSchema;
    try {
      place = layout.schemaOf(project);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    let made = readying.get(place.id);
    if (made === undefined) {
      made = (async () => {
        await migrateProjectSchema(client, place.schema);
        await recordProject(db, place, now);
        return Object.freeze({ place, migrations: await wireIdsOf(place.schema) });
      })();
      readying.set(place.id, made);
      made.catch(() => readying.delete(place.id));
    }
    return made;
  };

  let first: ReadyProject;
  try {
    first = await ready(undefined);
  } catch (error) {
    await client.close();
    throw error;
  }
  const served: Pick<HubStoreStatus, 'projects'> = context.projects === undefined
    ? {}
    : { projects: Object.freeze(context.projects.map(({ id, name }) => Object.freeze({ id, name }))) };

  const push = async (request: HubPushRequest): Promise<HubPushResult> => {
    const { place, migrations } = await ready(request.project);
    const { device, payload } = request;
    checkPayload(payload, migrations);
    const at = now().toISOString();
    const added = await inProjectSchema(db, place.schema, async (tx) => {
      let total = 0;
      for (const name of Object.keys(payload.tables).sort()) total += await mergeTable(tx, name, payload.tables[name] ?? []);
      await tx
        .insert(hubDevices)
        .values({ device, lastPushAt: at })
        .onConflictDoUpdate({ target: hubDevices.device, set: { lastPushAt: at } });
      return total;
    });
    return { received: rowsIn(payload), added, at };
  };

  const store: HubStore = {
    push,
    pull: async (request) => {
      checkLimit(request.limit);
      const { place, migrations } = await ready(request.project);
      const { tables, cursor } = await inProjectSchema(
        db,
        place.schema,
        (tx) => readPulledRows(tx, request),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
      return Object.freeze({ format: WIRE_FORMAT, version: WIRE_VERSION, migrations, tables, cursor });
    },
    status: async (request = {}) => {
      const { place } = await ready(request.project);
      const migrations = await wireIdsOf(place.schema);
      const held = await inProjectSchema(db, place.schema, readHeld, { isolationLevel: 'repeatable read', accessMode: 'read only' });
      return { migrations, ...held, ...served };
    },
    contract: (): HubContract => Object.freeze({
      contractVersion: WIRE_CONTRACT_VERSION,
      migrations: first.migrations,
      capabilities: CAPABILITIES,
      maxPayloadRows: context.maxPayloadRows ?? null,
    }),
    close: async () => {
      if (closed) return;
      closed = true;
      await client.close();
    },
  };
  return { store, placeOf: async (project) => (await ready(project)).place };
}
