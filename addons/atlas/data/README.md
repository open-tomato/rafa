# @open-tomato/atlas-data

Atlas layers 2 and 4: bucket tables in a SQLite replica, a tabular query
engine over them, and the Standard Schema contracts that query and config
share. Imports no rafa package: the readers that fill the buckets from a
rafa project live in `../rafa-atlas`.

The entries, as `package.json` exports them:

| Entry | Holds |
|---|---|
| `.` and `./contract` | browser-safe: `DataSourceDescriptor`, `QueryParams`, `QueryResult`, `Envelope`, `MetricDefinition`, zod schemas, `validateStandard`, `applyFormula`, `ATLAS_CONTRACT_VERSION`, `InvalidParams`, `ReplicaUnavailable` |
| `./query` | `runQuery` over a select runner, `aggregate`, `resolveWindow`, `previousWindow`, `nearestRank`, `timeKey`; reads no database |
| `./replica` | `writeReplica` (builds beside, renames in), `openReplica` (follows renames), `replicaDdl`, `REPLICA_TABLES`, `REPLICA_VERSION`; runs under bun |
| `./source` | `defineTableSource` and `DataSource`: one source over one bucket, its freshness stamped from `atlas_sources` |

Folders, as the design lays them out: `src/contract/` (types, schemas, the
contract version, formulas), `src/replica/` (DDL, writer, reader),
`src/query/` (engine, select builder, windows, grains, quantiles) and
`src/source.ts`.

A replica holds seven bucket tables (`task_facts`, `plan_facts`,
`daily_rollup`, `bug_facts`, `finding_facts`, `change_facts`,
`ci_facts`) and two meta tables. The fact buckets carry a `UNIQUE` key
over the origin pair; the writer inserts what the build hands it. The
build (`../rafa-atlas`) fills the origin pair before the insert: a row
with no origin of its own takes the store's id and its `seq`, so no NULL
reaches the key (the D3 rule, applied in ingest).

A window is `{ last: '28d' }`, a count and `d`, `w` or `m`, or a
`from`/`to` pair. A `last` window ends today, UTC, as `resolveWindow`
resolves it; `last-year` in the live page is `52w`, and a store that spans
11 weeks answers the 11 weeks there are. The map from the page's ranges to
windows (D6) lives in the demo's live source (`RANGE_WINDOW`), not here.
