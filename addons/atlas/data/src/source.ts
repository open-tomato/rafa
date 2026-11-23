/**
 * `DataSource`, what the handler queries, and `defineTableSource`, a
 * source over one replica bucket.
 *
 * A table source checks its spec when it is defined: the table must be a
 * key of `REPLICA_TABLES`, the descriptor must pass its schema (every field
 * key lower snake case, so a SQL-looking key is refused there), its keys
 * must be unique and its time field one of them. A query then runs the
 * engine over the replica the reader holds now, both windows of a
 * `compare: 'previous'` over the same build, and answers the freshness the
 * build stamped: `asOf` is the newest as-of of the `atlas_sources` rows the
 * spec names, `partial` is true when any of them is, and `partialReasons`
 * holds their reasons.
 */
import type { DataSourceDescriptor, QueryParams, QueryResult } from './contract/types.js';
import type { RunQueryOptions, RunSelects } from './query/engine.js';
import type { SqlValue } from './query/sql.js';
import type { OpenReplica, ReplicaReader } from './replica/reader.js';
import type { SourceStamp } from './replica/writer.js';

import { DataSourceDescriptorSchema } from './contract/schemas.js';
import { runQuery } from './query/engine.js';
import { isReplicaTable } from './replica/ddl.js';

/** One source the handler lists, describes and queries. */
export interface DataSource {
  /** `<source>.<channel>`, such as `local.tasks`. */
  readonly id: string;
  describe(): Promise<DataSourceDescriptor>;
  /** Throws `InvalidParams` for params the descriptor refuses. */
  query(params: QueryParams, signal?: AbortSignal): Promise<QueryResult>;
}

/** The descriptor fields a build stamps; a spec leaves them out. */
type Stamped = 'asOf' | 'partial' | 'partialReasons';

export interface TableSourceSpec {
  readonly descriptor: Omit<DataSourceDescriptor, Stamped>;
  /** Whitelisted: must be a key of `REPLICA_TABLES`. */
  readonly table: string;
  /** The `atlas_sources` rows this table is filled from; defaults to the descriptor's id. */
  readonly stamps?: readonly string[];
}

export interface TableSourceOptions {
  /** The clock a `last` window counts back from; defaults to the system clock. */
  readonly now?: () => Date;
  /** The scan cap; defaults to `MAX_SCAN_ROWS`. */
  readonly maxScanRows?: number;
}

function checkSpec(spec: TableSourceSpec): void {
  const { id } = spec.descriptor;
  if (!isReplicaTable(spec.table)) {
    throw new Error(`source ${id}: ${JSON.stringify(spec.table)} is not a replica table`);
  }
  const parsed = DataSourceDescriptorSchema.safeParse({ ...spec.descriptor, asOf: null, partial: false, partialReasons: [] });
  if (!parsed.success) {
    const paths = parsed.error.issues.map((issue) => issue.path.map(String).join('.'));
    throw new Error(`source ${id}: the descriptor does not match the contract at ${paths.join(', ')}`);
  }
  const keys = spec.descriptor.fields.map((field) => field.key);
  if (new Set(keys).size !== keys.length) throw new Error(`source ${id}: a field key is listed twice`);
  const { timeField } = spec.descriptor;
  if (timeField !== null && !keys.includes(timeField)) {
    throw new Error(`source ${id}: the time field ${timeField} is not one of its fields`);
  }
}

function newest(stamps: readonly SourceStamp[]): string | null {
  return stamps
    .map((stamp) => stamp.asOf)
    .filter((asOf): asOf is string => asOf !== null)
    .reduce<string | null>((latest, asOf) => latest === null || Date.parse(asOf) > Date.parse(latest)
      ? asOf
      : latest, null);
}

function describeFrom(spec: TableSourceSpec, replica: OpenReplica): DataSourceDescriptor {
  const names = spec.stamps ?? [spec.descriptor.id];
  const stamps = names
    .map((name) => replica.sources.get(name))
    .filter((stamp): stamp is SourceStamp => stamp !== undefined);
  const partial = stamps.filter((stamp) => stamp.partial);
  return {
    ...spec.descriptor,
    asOf: newest(stamps),
    partial: partial.length > 0,
    partialReasons: partial.map((stamp) => stamp.reason ?? `${stamp.source} was read in part`),
  };
}

function runner(replica: OpenReplica): RunSelects {
  return (selects) => selects.map((select) => replica.database
    .query<unknown[], SqlValue[]>(select.sql)
    .values(...select.bindings));
}

/** A source over the bucket `spec.table` of the replica `reader` follows. */
export function defineTableSource(reader: ReplicaReader, spec: TableSourceSpec, options: TableSourceOptions = {}): DataSource {
  checkSpec(spec);
  return {
    id: spec.descriptor.id,
    describe: async () => reader.read((replica) => describeFrom(spec, replica)),
    query: async (params, signal) => {
      signal?.throwIfAborted();
      const engineOptions: RunQueryOptions = {
        now: (options.now ?? (() => new Date()))(),
        ...(options.maxScanRows === undefined
          ? {}
          : { maxScanRows: options.maxScanRows }),
      };
      return reader.read((replica) => runQuery(
        runner(replica),
        { table: spec.table, descriptor: describeFrom(spec, replica) },
        params,
        engineOptions,
      ));
    },
  };
}
