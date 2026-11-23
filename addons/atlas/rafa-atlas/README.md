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

No build calls `gh` unless `build` or `serve` is given `--github`. With it,
`gh pr list --state all` fills `pr_facts` (`local.prs`), `gh issue list
--state all` the issue times, each stage reads the closing pull requests
(`stage_basis` `labels+prs`), and `plan_facts.merged_at` and
`daily_rollup.prs_merged` are filled. A failed `gh` read stamps `local.prs`
failed with `gh`'s stderr, warns once, and builds the rest as without the
flag, exit 0.

The diff stats (`additions`, `deletions`, `changed_files`) come from a
third call, `gh api graphql --paginate` in pages of 25: GitHub works them
out from each diff, and the pages of 100 `gh pr list` asks for answer 502
once a repository holds a few hundred pull requests. When that call fails,
every pull request keeps NULL stats and `local.prs` is stamped partial with
the reason; nothing else changes.

## Config

`<root>/.rafa/atlas/config.json` holds the project's own targets, read by
`loadAtlasConfig` and laid over the metrics by `serve`:

```json
{ "budget": { "tokensPerWeek": 18000000 }, "wipLimit": 3 }
```

Both keys are optional and null when unset. With no `budget.tokensPerWeek`,
`pm.budget-burn` draws the spend and says no target is set; `wipLimit` is the
goal of `dev.wip`, which draws the count alone without one. Any other key,
or a value that is not a whole number above zero, refuses the file with
every problem named at once. The module reads no core `loadConfig`, and
calls `gh` only under `--github`.

## Layout

`src/ingest/` holds one reader per source: `effort.ts` (sessions from the
snapshot), `facts.ts` (the finding, bug, change and CI buckets, read the
same way), `columns.ts` (the column check: a store column the snapshot lacks
reads as NULL and the stamp names it), `plans.ts` (plan files), `git.ts`
(commits, `v*` release tags and stretch marks from the first-parent history
of `origin/HEAD`'s target, or of `HEAD` when that names none, with git run
in the project root), `board.ts` (issues and today's counts by board stage
from the board cache `<root>/.rafa/cache/board.json`, read once per build
and stamped with its watermark; no cache stamps both sources missing),
`modules.ts` (each module's files, LOC, `@open-tomato` imports and fan, and
its upward edges from `docs/survey/cut-table.json`, NULL with no table),
`github.ts` (pull requests and issue times through `gh`, under `--github`
only), `attribute.ts` (the module column), and `snapshot.ts` (the
`vacuumInto` copy). `src/sources.ts` holds the twelve source descriptors the
registry serves, `local.tasks` to `local.prs`, one per bucket except
`change_facts`, which the build stamps as `local.changes` with no descriptor
yet. `src/build/` is the one-pass builder: `index.ts` writes the replica,
`derive.ts` the work type, the rollups and each module's counts, and
`daily.ts` the daily rollup. `src/metrics/` is the catalogue per lens,
`src/registry.ts` the registry the handler serves, and `src/commands/` the
three module commands.

## Marks, joins and WIP

A stretch mark is a stretch end the history names. Offline, git reads two
subject shapes, `Stretch <n> (#<pr>)` and `Merge pull request #<pr> from
<owner>/stretch/<n>`: the lane is `M` for a three-digit number and `A` for
one or two, and a number of another length is skipped and counted. With
`--github`, a commit whose pull request has the head `stretch/<n>` is a mark
too. An item subject never gives one, since its numbers are items, not
stretches. `stretch_marks` keeps a row per stretch end and the API serves it
as `local.marks`; no chart draws it yet.

`dev.wip` counts the open issues whose board stage is Claimed or In
development, never those carrying the `rafa:in-development` label, since
many closed issues still carry it. A board bug counts as filed by a loop
when its body names a plan (`plan_stub`); the bug outcome and drop-rate
metrics read only those, and a bug filed by hand is left out of them.

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
