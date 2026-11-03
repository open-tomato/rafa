# @open-tomato/atlas-data

Buckets, a SQLite replica writer and a tabular query engine, with Standard
Schema contracts. Imports no rafa package: the readers that fill the
buckets from a rafa project live in `../rafa-atlas`.

Folders, as the design lays them out: `src/contract/` (browser-safe types,
zod schemas, the contract version, formulas), `src/replica/` (DDL, writer,
reader), `src/query/` (engine, aggregates, windows, quantiles) and
`src/source.ts` (`DataSource`, `defineTableSource`).
