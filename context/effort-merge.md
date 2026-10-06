## Effort merge

`rafa effort merge` and `rafa effort move` join stores: two devices
bring their stores together after each makes local changes, or a project
migrates from NDJSON storage to SQLite.

### Merge rules

**A merge rule declares how each table's rows are identified, which
columns can change, and what happens when they cannot.** The rules are
in `src/effort/store/merge-rules.ts` in a `MERGE_RULES` registry, keyed
by table name. A new table must declare its rule in the same commit as
its migration entry, or `merge-rules.sweep.test.ts` will fail.

**A table's scope is either `merged` or `local`.** Merged tables travel
between stores and their rows combine; local tables stay on their
machine and are not combined. The `sessions`, `commits`, `findings`,
`blockers`, `out_of_scope_bugs`, `changes`, `skill_invocations`,
`preflight`, `dispatches`, and `plan_ci` tables are merged. The
`report_absences`, `task_reports`, `schema_migrations`, `store_meta`,
`merges` and `merge_conflicts` tables are local.

**A merged table's rule holds:** its identity columns (which match rows
with NULL origin), the columns that can change after insert (each with
its rule), and `origin_store` and `origin_seq` columns with a partial
unique index `<table>_by_origin` covering just these two and the
identity columns. The rule for each column in the table that a
production statement can write is one of: `recomputed` (the column's
value is derived from others and should be recomputed on merge, such as
a gap between commits), `filled` (a set-once field that may be filled
from the other store when NULL), `skipped` (a field written only by one
store and never merged), or `unchanged` (a field that must be equal in
both rows, or one is a conflict).

**Every writer of a merged table must be checked.** `merge-rules.sweep.test.ts`
reads every `UPDATE <table> SET <column>` in every module under `src/`
(not tests or `store/`) whose column is not in the table's rule, and
fails, so a new edit of an existing table's column needs its rule
added or updated in the same commit. The test applies each entry in
`SQLITE_MIGRATIONS` to `:memory:` and checks that every table and column
it creates or updates is in the registry.

**A set-once field is filled from the other store when it is NULL
here**, by the merge's `settleMatches` step. One filled value against
NULL there is kept; two filled values that differ is a conflict, and
the incoming row is recorded in `merge_conflicts`. Each set-once column
has its literal `UPDATE` in `SET_ONCE_FILLS`, so the test can read it.

**`commits.row_json` is recomputed on merge.** Two rows of one commit
that differ only in their `minutesSincePrevious` are skipped; the gap
here is kept. `recomputeCommitGaps` in `store/merge-commit-gaps.ts`
rewrites that gap, with no git call, for each commit the union inserted
and the commit right after it in time, ordered by `Date.parse` of the
stored timestamp and by sha within an instant. At most two rows are
written per commit brought in.

**`origins.ts` stamps every production insert with the origin pair.**
`STAMPED_COLUMNS` and `stampedValues` spell both, for every writer, in
the insert's column list with no trigger and no `UPDATE`. A store with
no `store_meta` row stamps NULL in both columns. A row an older runtime
inserted reads as any other (with NULL origin fields).

### Rafa effort merge

**`rafa effort merge <file> [--dry-run]` joins another device's store
into the current one** (`src/commands/effort/merge.ts` over `mergeStore`,
`src/effort/store/merge-store.ts`, whose module note holds the rules and
refusals). This store is the one `effortStoreDir` answers (the project's
own store, or one under `RAFA_EFFORT_DIR`). `<file>` is read from the
directory the command runs from and is only read, never modified.

**The merge reads the incoming store, deduplicates rows by their port
key and identity columns, and writes one `merges` row per completed
merge.** It prints, per merged table, the rows added, skipped and in
conflict (and the set-once fields filled, when any), the totals with
the commit gaps recomputed, and the file that was backed up
(`effort.sqlite.before-merge-<stamp>.bak`). Under `--dry-run`, the build
is checked and deleted instead, and the merge can be run again with all
rows brought in.

**Exit codes:** Another project's store is exit code 2. An NDJSON
project names `rafa effort move --to=sqlite` and also exits 2. A live
loop, a development build over a store it does not own, and every other
refusal is exit code 1. Each exit code 1 leaves both files
byte-identical, so the command is safe to run again
(`merge.test.ts` verifies this).

**Copy detection and minting.** The merge detects when the incoming
store is a copy of a store already merged here. It does this by
examining the `store_meta` row of the incoming store: the row's
filesystem identity (device, inode, path) is looked up in the local
store's `merges` table (a log of every completed merge) and in the
incoming store's `origin_store` UUID. If a copy is detected, the merge
records the copy's origin and what copied it in the merge log, and
continues. After the merge completes, if a copy was detected, the local
store is asked to mint a new `origin_store` on the next write, so the
incoming store's rows are brought in under the old origin and the new
device's future writes go under a new one.

**Set-once fills and conflicts.** For each row the union matched,
`settleMatches` compares the rows on every column except `seq` and the
origin pair. An equal pair is skipped. A set-once field NULL here is
filled from the other store if filled there. A filled set-once field
against NULL there is kept. Two filled values that differ, or rows that
differ outside every edited field, is a conflict: the incoming row is
recorded as JSON in `merge_conflicts` with both rows kept, and the
conflict counter is incremented.

**Commit gap recomputation.** After the rows are settled, the commit gaps
are recomputed. `recomputeCommitGaps` finds each commit the union
inserted, the commit right after it in time (ordered by `Date.parse` of
the timestamp, then by sha within an instant), and rewrites the
`minutesSincePrevious` gap in the second commit's `row_json`.

**The merge writes the store through `rebuildAside`, behind a backup.**
It writes to `effort.sqlite.merge-<stamp>`, brings the file forward
(adopting and applying any migrations the incoming store has and the
local one does not), checks the row count of every table in both files
against the live store (the merge cannot lose rows), `integrity_check`
and that `planSchema` finds it current, then copies the store with
`VACUUM INTO` to `effort.sqlite.before-merge-<stamp>.bak`, and swaps
the new file in through `rebuildAside`.

**The swap preserves the local store's identity when it stays the same
store in the same place.** Before renaming the merged file over the live
store, `swapIn` carries the device and inode onto the new file with a
new generation, and writes that generation to the side record just
before the rename, so the identity facts stay tied to that path, and
the store keeps its origin even though its inode may change during the
rename. The backup, left behind when the new file takes the live
store's place, becomes a different file: if restored later, it will have
a new device or inode and will mint a new origin on its first write.
This is the complement to copy detection: a backup is like a photo of
the house before renovation; moving back into the photo is moving into
a different house. The decision to carry identity is the same as a write
open's decision to keep an origin: `decideLiveWrite` reads the live file
read-only with no transaction, and the carried generation is checked on
the next write to catch a restoration. Releasing claims made after the
merge against this store's id before undoing the merge keeps them valid
after restoration; undoing with unconfirmed claims in place orphans them
until they are taken over with `rafa claim take <n> --stale`.

### Rafa effort move

**`rafa effort move --to=sqlite` is the step to migrate from NDJSON to
SQLite storage** (`src/commands/effort/move.ts` over `moveToSqlite`,
`src/effort/store/move.ts`). It reads the NDJSON sessions and commits
with the NDJSON backend's `readRows` and appends them with the SQLite
backend's `append`, both under `effortStoreDir`, so each row is
deduplicated by its port key and the open's development-build refusal
applies (the store cannot be the project's live store under a
development build).

**It then checks, per kind, that the SQLite keys hold every key read and
number the keys before plus the rows appended, and only then sets
`store: sqlite` in `.rafa/config.yaml` by a line edit that keeps every
comment.** The config text is built and parsed back before any row moves,
so a file spelling `store` in a shape the edit does not cover refuses
with nothing moved. A failed count check leaves the config as it was.

**The NDJSON files stay.** A keyless row and an unparsed line are counted
and not moved. A move run again adds nothing and changes no config byte,
which is how rows a loop started before the move appended later are
brought in. If a loop is writing NDJSON rows during the move, they will
be appended to the SQLite store on the next open.

**Exit codes:** `--to` takes `sqlite` alone; any other value or none is
exit code 1 with nothing read or changed. A configuration that cannot be
edited, a mismatch between the keys read and the keys written, or a read
or write failure is also exit code 1. Exit code 2 is never issued.
