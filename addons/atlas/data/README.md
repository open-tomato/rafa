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

A replica holds thirteen bucket tables and two meta tables. Seven
buckets come from the effort store and plans (`task_facts`, `plan_facts`,
`daily_rollup`, `bug_facts`, `finding_facts`, `change_facts`,
`ci_facts`), and six from git, GitHub, the board and the module tree
(`commit_facts`, `pr_facts`, `issue_facts`, `board_snapshot`,
`module_facts`, `stretch_marks`). Four of the seven effort buckets
(`task_facts`, `bug_facts`, `finding_facts` and `change_facts`) carry a
`UNIQUE` key over the origin pair; `plan_facts`, `daily_rollup` and `ci_facts`
key on their own ids (`plan_stub`, `day`, and `plan_stub` with `head_sha` and
`read_at`). The writer inserts what the build hands it. The six git, GitHub,
board and module buckets key on their own id too: `sha`, `number`, `path`,
`number` with `part`, or `day` with `stage`. The build (`../rafa-atlas`)
fills the origin pair before the insert: a row with no origin of its own
takes the store's id and its `seq`, so no NULL reaches a `UNIQUE` key (the D3
rule, applied in ingest).

The replica is at version 5 (`REPLICA_VERSION`, stamped as `replica_version`),
and a reader refuses a replica of any other version. Its `module_facts` holds
each module's lines in five columns, one kind per file: `loc`, `test_loc`,
`docs_loc`, `config_loc` and `fixtures_loc`. It also holds `layer` and
`layer_rank`, the module's place in `atlas.layers`, NULL when no layer lists
it. `change_facts` holds one row per changelog entry, the rows of
`local.changes`.

`board_snapshot` is the one bucket carried between builds: before the
rename, the writer copies the old replica's rows into the build file. A
row the build wrote for the same day and stage stays, and with no old
replica the snapshot starts empty.

A window is `{ last: '28d' }`, a count and `d`, `w` or `m`, or a
`from`/`to` pair. A `last` window ends today, UTC, as `resolveWindow`
resolves it; `last-year` in the live page is `52w`, and a store that spans
11 weeks answers the 11 weeks there are. The map from the page's ranges to
windows (D6) lives in the demo's live source (`RANGE_WINDOW`), not here.
