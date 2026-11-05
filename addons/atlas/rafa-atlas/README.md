# @open-tomato/rafa-atlas

The rafa bundle: reads a rafa project into an Atlas replica
(`<root>/.rafa/atlas/atlas.sqlite`) and serves it. The effort store is
copied with `vacuumInto` and opened read-only; it is never migrated.

`src/ingest/` holds one reader per source, `src/build/` the one-pass
builder, `src/metrics/` the catalogue per lens, `src/registry.ts` the
registry the handler serves, and `src/commands/` the rafa module commands
(`build`, `serve`, `describe`), reached through `rafa module exec`.
