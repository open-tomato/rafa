# @open-tomato/rafa-atlas

The rafa bundle: reads a rafa project into an Atlas replica
(`<root>/.rafa/atlas/atlas.sqlite`) and serves it. The effort store is
copied with `vacuumInto` into `<root>/.rafa/atlas/snapshot/` and the copy is
opened read-only; the store is never opened in place or migrated.

## Run it

The module's commands are reached through exec; `rafa atlas` routes nothing:

```sh
rafa module exec @open-tomato/rafa-atlas build      # writes the replica
rafa module exec @open-tomato/rafa-atlas serve      # the API at /api/atlas, 127.0.0.1:4317
rafa module exec @open-tomato/rafa-atlas describe   # sources and metrics by lens; opens no replica
```

From a worktree, `ATLAS_PROJECT_ROOT=<main checkout>` names the root that
holds the store. `RAFA_EFFORT_DIR` names the store and wins over it.

`serve` builds the replica when there is none, binds to loopback only,
and takes `--port` (0 picks a free one; 4317 by default) and
`--rebuild-every=<minutes>` (0 by default: build only when no replica
exists). A failed rebuild keeps the replica it had.

## Config

`<root>/.rafa/atlas/config.json` holds the project's own targets, read by
`loadAtlasConfig` and laid over the metrics by `serve`:

```json
{ "budget": { "tokensPerWeek": 18000000 }, "wipLimit": 3 }
```

Both keys are optional and null when unset. With no `budget.tokensPerWeek`,
`pm.budget-burn` draws the spend and says no target is set. Any other key,
or a value that is not a whole number above zero, refuses the file with
every problem named at once. The module reads no core `loadConfig` and no
`gh`; GitHub reads wait for a later phase behind a flag.

## Layout

`src/ingest/` holds one reader per source: `effort.ts` (sessions, findings,
bugs, changes and CI from the snapshot), `plans.ts` (plan files), `git.ts`
(commits, `v*` release tags and stretch marks from the first-parent history
of `origin/HEAD`'s target, or of `HEAD` when that names none, with git run in
the project root), `board.ts` (issues and today's counts by board stage from
the board cache `<root>/.rafa/cache/board.json`, read once per build and
stamped with its watermark; no cache stamps both sources missing),
`modules.ts` (each module's files, LOC, `@open-tomato` imports and fan, and
its upward edges from `docs/survey/cut-table.json`, NULL with no table),
`attribute.ts` (the module column), and `snapshot.ts` (the `vacuumInto`
copy). `src/build/` is the one-pass builder: `index.ts` writes the replica,
`derive.ts` the work type, the rollups and each module's counts, `daily.ts` the daily rollup.
`src/sources.ts` holds each bucket's source descriptor, `src/metrics/` the
catalogue per lens, `src/registry.ts` the registry the handler serves, and
`src/commands/` the three module commands.

## Dedupe and work type

Rows are deduped on the D3 key: `coalesce(origin_store,
store_meta.store_id)` with `coalesce(origin_seq, seq)`. A row with no
origin pair was written by this store, so its own id and `seq` stand as
its origin. The first row of a key is kept, in `seq` order, before any
insert; a NULL origin therefore never defeats the key.

Work type is a proxy (D4). `task_facts.work_type` reads the highest change
level the session reported in `change_facts`: `major` and `minor` are
`feature`, `patch` is `fix`, `none` is `chore` (chore or docs). A session
with no change of a known level reads NULL. `branch_type` is `feat` on every
loop branch and is not read. Each metric over the split carries a
`ProxyNote` that says so.
