## Effort store

`src/effort/store/` holds what `rafa effort collect` and the task-report
pipeline write: the `EffortStore` port (`store/types.ts`), an NDJSON and a
SQLite backend, and `selectEffortStore` (`store/index.ts`), which picks one
from `store` in `.rafa/config.yaml`, `sqlite` by default.

**One kind of session row is not collected.** The search runner
(`src/inventory/search/index.ts`) stores the `search` row of its own
session: Claude Code files that session's log under the scratch copy it
ran in, never under the project's log directory `effort collect` walks.
The runner reads the log with `collectSessionRow` and appends it under
`sessions` with `kind` set to `search`.

### Where it lives

**Both backends write under `.rafa/effort/` in the project root, unless
`RAFA_EFFORT_DIR` names another directory.** `EFFORT_STORE_DIR` in
`src/effort/store.ts` spells the directory, and `effortStoreDir`
(`store/location.ts`) resolves it once for both backends:
`sqliteStorePath` (`store/sqlite.ts`) and the NDJSON backend's files join
their names under it. `effortStorePath` in `store.ts` still joins under
`.rafa/effort/` whatever the variable holds, and no backend calls it.
`RAFA_EFFORT_DIR` moves the SQLite and NDJSON files together for one
command line; it is a variable and not a config key so that it never
moves the loop's own store. A relative value is refused (`is not an
absolute path`), and so is one resolving to the project's own store,
symlinks and `..` spellings included, so it cannot bypass the rule that
branch code never migrates the live store. An empty value counts as
unset. The store moved to `.rafa/effort/` from `.ralph/effort/` (Q20), and no backend and no
command reads a store left under `.ralph/effort/`: `rafa doctor` only
looks for the store's file names there, and warns while `.rafa/effort/`
holds none of them (`store/legacy.ts`). A test that plants or
opens a store file by path spells `.rafa/effort`; the `.ralph/effort` the
parity suites name is the sibling's own store, read through
`readStoreRows` and never written. `effort.busyTimeoutMs` in the config sets how long a store open waits for another process's lock, from 1 to 60000 milliseconds, defaulting to 5000.

### Imports

**Import store code from `./store/index.js` and port types from
`./store/types.js`, never from `./store.js`.** `src/effort/store.ts` is the
sibling loop's pre-port module, and its `openEffortStore`, `EffortRowKind`
and `AppendResult` are different declarations under the same names.

### A new row kind or field

**A new `EffortRowByKind` kind turns `check-types` red away from the
fix:** TS2345 at each `effortStorePath` call in `store/ndjson.ts` until
`STORE_FILE_NAMES` in `store.ts` names the kind's file, and TS2741 in
`store/sqlite.ts` until `KIND_TABLES` has the kind.

**`collectSessionRow` (`collect.ts`) copies attribution fields one by
one**, so a field added to the attribution reaches no stored row until it
is copied there as well.

### A store past this rafa

**A plan that adds a migration can lock its own loop out of the store.**
A pre-log release refuses a store past the version its `SQLITE_MIGRATIONS`
holds, and every read and write it makes goes through that check. A task that runs the branch's
own code from its working tree against `.rafa/effort/effort.sqlite`
migrates the project's store, while the loop driving the plan is the older
installed runtime. From then on that runtime refuses the store, and the
task reports it collects are not stored. Seen on rafa-23 (2026-09-26): its
versions 10 and 11 reached the store through `rafa effort collect` run from
the branch, and the 0.18.0 loop stopped.

**`rafa effort fix-schema` repairs such a store**
(`src/effort/store/fix-schema.ts`). It decides through `planSchema`,
asked for a write: a store this rafa uses is `current` or `behind` and
left alone, unknown additive migrations included, and it rebuilds only
on `pre-log-unreleased`, `gate-mismatch`, `edited` and both
`unknown-breaks-*`; the two `breaking-*` refusals are passed on with
their own next step. It builds `effort.sqlite.fix-<stamp>` through
`bringForward` (with `builtAside`, so the open does not ask the
development-build question of a file in the store's directory), which
logs every id this rafa knows with `applied_by` from `appliedByName`
(`development-build.ts`: the version, `+dev:<checkout>` for a
development build). It copies every table and column this rafa knows
except the log, checks the row counts, `integrity_check` and that
`planSchema` finds the rebuild current, and lists the unknown
migrations, tables and columns only the newer schema holds, which stay
in the backup alone. The store is then copied with `VACUUM INTO` to
`effort.sqlite.v<user_version>-<stamp>.bak`, every row of it, and the
rebuild is renamed over the store. `--dry-run` deletes the rebuild
instead, so it can be repeated and runs beside a live loop and from a
development build; the swap refuses while a loop session is running or
paused, and from a development build before anything is built. A newer
schema that dropped
a table or column this rafa writes is not additive, and the repair
refuses it rather than copy around it. It refuses a store that never
held one as well: since `row-origins` added `origin_store` and
`origin_seq`, a pre-log store past this rafa holds legacy tables
without them, and the rebuild answers `the store holds no column
blockers.origin_store, blockers.origin_seq, which this rafa writes;
its newer schema is not additive`. So `fix-schema.test.ts` (store and
command) plants its pre-log store two entries past the whole
catalogue, rebuilds it with a log, reports a logged
store with an unknown additive migration `current`, and spawns
`bun src/rafa.ts` over a store outside the child's temp directory:
the swap is refused, the dry run runs. The steps around the build, from
the in-flight journal refusal through the row-count check,
`integrity_check`, the backup and the swap, are `rebuildAside`
(`src/effort/store/rebuild-aside.ts`), which takes the two file names
and the build from its caller. A failed build is removed; a failed swap
leaves the store unchanged and the rebuild and the backup beside it,
both named in its `SwapFailure`. `SchemaFixRefusal` is its
`RebuildRefusal`, and so is `effort migrate`'s `MigrateRefusal`.

**`rafa effort copy [--to=<dir>]` is how branch code gets real data**
(`src/commands/effort/copy.ts` over `copyEffortStore`,
`src/effort/store/copy.ts`). It copies `<root>/.rafa/effort/` into
`--to`, read from the project root when relative, or into
`<root>/.rafa/scratch/effort-<stamp>/`, and prints the directory and the
`RAFA_EFFORT_DIR=<dir>` line to put in front of each command on the same
line. The SQLite file goes through `VACUUM INTO` on a read-only
connection with the store's busy timeout, the NDJSON files by file copy.
It never calls `bringForward`, so a development build may copy the live
store: `copy.test.ts` copies a pre-log store and finds the live file's
bytes unchanged and no `schema_migrations` in the copy, and a copy taken
while another connection holds a read transaction keeps `user_version`,
the log and every row. Exit 1, with nothing made, when `RAFA_EFFORT_DIR`
is set, when the directory holds no store file, or when the target is a
file or a non-empty directory; exit 2 on a read or write failure, with
every file it wrote and every directory it made removed.

**`rafa effort schema [--check]` says whether this rafa can use the
store, and what to run next when it cannot** (`src/commands/effort/schema.ts`
over `readSchemaReport`, `src/effort/store/schema-report.ts`). It opens
the store `effortStoreDir` answers read-only, never through
`bringForward`, and prints the applied, pending, unknown and edited
migrations, the gate, and the verdict: `absent`, `current`, `behind`, one
of `planSchema`'s seven reasons (asked for a write, so an unknown
`writers` row is refused), or `development-build` when a development
build would be refused the adoption or apply a `behind` store needs. It
ends with `Next safe step: <command>` (json `nextStep`), the refusal's
own, `rafa effort copy` for `development-build`, or `none`. `--check`
exits 1 on any refusal; the report alone exits 0, and 2 when the file is
no store. `schema.test.ts` leaves a pre-log store at 12 and a logged store
with a synthetic entry pending byte-identical, and holds
`REFUSAL_REASONS` to the seven `nextStep` values in order.

**`rafa effort migrate [--dry-run]` applies a migration that breaks
older runtimes** (`src/commands/effort/migrate.ts` over `migrateStore`,
`src/effort/store/migrate.ts`), and any other pending one with it. It
plans as the `migrate` caller, so `breaking-pending` never refuses it;
any other refusal is passed on with its own next step, and a store with
nothing to adopt or apply is `current` and left alone. It writes the
store `effortStoreDir` answers to `effort.sqlite.migrate-<stamp>` with
`vacuumInto` (`copy.ts`), brings that file forward through
`bringForward` with `builtAside`, checks the row count of every table
both files hold against the live store (`checkedCounts`: a table rebuild
that lost a row is refused), `integrity_check` and that `planSchema`
finds it current, then copies the store with `VACUUM INTO` to
`effort.sqlite.before-<id>-<stamp>.bak`, `<id>` being the first migration
applied or `schema_migrations` for an adoption alone, and swaps the new
file in through `rebuildAside`. `--dry-run` deletes it instead and is
refused nothing. The swap is refused before anything is built from a
development build over a store it does not own, with
`refuseUnownedDevelopmentWrite`'s text, and while a loop record under
the project reads `running` or `paused`: `REFUSED — migration <id>
breaks older runtimes, and loop <sessionId> (pid <pid>, plan <stub>) is
running on this store. Nothing was migrated. Finish or stop that loop,
then run it again.`, or, with only additive migrations pending, the loop
and the writes a swap under it would lose. `migrate.test.ts` leaves the
directory byte-identical under a dry run that built the closed gate,
refuses a synthetic rebuild that drops a null-note row while the same
rebuild over non-null rows migrates, names the backup, refuses beside a
planted live loop, and spawns `bun src/rafa.ts`: refused over a project's
store, migrating a copy under `RAFA_EFFORT_DIR`.

**`rafa effort merge <file> [--dry-run]` joins another device's store,
and `rafa effort move --to=sqlite` migrates from NDJSON to SQLite.**
See `context/effort-merge.md` for the merge rules, the command details,
and the merge trail (`merges` and `merge_conflicts` tables).

**A loop never records to a copy, and says what it does not know.**
`loop start` refuses while `RAFA_EFFORT_DIR` is set to anything but the
empty string, right after the detached refusal and before `--runtime`
hands the run on (`refuseEffortDirRun`, `src/start/run-config.ts`):
`❌ RAFA_EFFORT_DIR is set (<dir>); a loop records to the project's own
store. Unset it and run again.` Its preflight then reads the project's
store through `readSchemaReport`, read-only, and warns once for each
logged migration this rafa does not know whose `breaks` is empty, in
the words of `unknownAdditiveWarning` (`schema-report.ts`): `⚠ effort
store holds migration <id> this rafa does not know (applied by <by>);
it is additive, so this run reads and writes the store as it is`. A
refused store gets no warning there, since its first open refuses it;
one that cannot be read is one warning naming why, and none halts.
`rafa doctor` prints an `effort store schema` row
(`src/commands/doctor-effort-schema.ts`) over the store `effort schema`
reads: `fail`, and exit 1 with the next safe step, wherever
`effort schema --check` fails, a refused `RAFA_EFFORT_DIR` and a file
that is no store included; `warn` for each unknown additive migration
and, in the project's own store alone, for each `applied_by` holding
`DEVELOPMENT_MARK` (`+dev:`, `development-build.ts`), which a copy
under `RAFA_EFFORT_DIR` is expected to hold. `loop-start-effort-store.test.ts`
spawns the refusal beside an empty variable that goes on, and the
warning beside a store holding no unknown migration; each run halts
at a failing required item, so no session is spawned.
`doctor-effort-schema.test.ts` spawns `doctor` and `effort schema
--check` over the same stores and holds their exit codes together.

### Sync

**The Sync port defines how stores exchange rows between devices.** It
has two directions: push (send the rows this store wrote, identified by
their origin pair) and pull (merge the rows another device wrote under
its own origin). Every adapter's pull calls `mergeStore`
(`src/effort/store/merge-store.ts`), which implements the merge rules;
nothing here reimplements a merge rule. A pull a loop run makes names
the run's session id (`SyncPullRequest.sessionId`), which the adapter
passes on as `mergeStore`'s `sessionId` parameter. The merge's live-loop
guard receives this session id in the `liveLoop` function
(`src/effort/store/migrate.ts`) as its `ownSessionId` parameter, and
uses it to filter: when looking for concurrent live loops, `liveLoop`
returns only the first record with state `running` or `paused` whose
session id does NOT match `ownSessionId`, so the calling run's own record
is passed by identification and excluded from the refusal check. This way
the run calling `mergeStore` can sync at the end of its task without
being refused by its own active record, while any other live loop — even
one with the same pid but a different session id — is still refused
(`merge-store.test.ts`). `liveLoop` is shared with the migration's guard
(`migrateStore`, `migrate.ts`), which names no session id so it refuses
any live loop, including its own if one somehow persists.

**`effort.sync` in `.rafa/config.yaml` selects the sync strategy, one of
`local`, `file`, `git`, `service`, or `p2p`.** The default is `local`,
which means no sync: a device keeps its own store. The user scope's
`~/.rafa/config.yaml` already layers under the project's for every
setting (`src/config.ts`), so the user default needs no reader of its
own. The user and project scopes share every config key in `config.ts`,
and a change in one scope's declaration of `effort.sync` takes effect
when either is read. A deployment of the `service` strategy requires
`hub.url` (the hub's address), and may name `hub.tokenSecret` (the
secret store name where the token is held, never the token itself) and
`hub.timeout` (how long a request may take, `3s` by default, from `1s`
to `30s`, as `3s`). `selectSync` hands the three to the adapter as
`AdapterContext.hub` (`src/config-schema-hub.ts`). A module implementing
`git`, `service` or `p2p` also names its own settings under `modules:`.

**Core registers two adapters in `CORE_ADAPTER_REGISTRY`
(`src/adapters/registry.ts`): `sync/local` (no action) and `sync/file`
(copy exchange).** The `git`, `service` and `p2p` adapters come from
modules loaded under `src/modules/load.ts`; core ships no code for them.
When `rafa doctor`, the loop preflight and `describe` read the config,
a strategy with no adapter and no module to implement it is named with
the `modules:` and `allowList:` lines that enable the module. A project
that selects `git` without a module loading it, for instance, refuses
every operation with `the sync strategy 'git' needs a module; enable it
with an entry under modules: ... in the config`.

**File exchange happens through `rafa effort copy` (export) and `rafa
effort import` (import).** `rafa effort copy [--to=<dir>]` is already
documented; it copies `<root>/.rafa/effort/` into a directory, using
`VACUUM INTO` on the SQLite file to get a consistent snapshot. `rafa
effort import <file>` takes that snapshot and merges its rows into the
local store. The file exchanged is `<dir>/effort.sqlite`, and the
directory structure it sits under is not part of the exchange; only the
database file matters. Importing each other's files in a loop is safe
and idempotent: a repeat of the same file merges nothing new.

**The `service` strategy syncs rows through a wire format over HTTP, defined
in `src/effort/sync/wire.ts`, and merged only by `mergeStore`.** Push
exports rows the local store wrote (identified by its origin pair) past a
per-table, per-device cursor, building a JSON payload of every `merged`
table's rows that have a `seq` higher than the cursor's value for that
table. Each row carries every column, `seq` and the origin pair
(`origin_store`, `origin_seq`), so the receiver's merge can identify which
device wrote it and skip rows it already holds. The payload also carries
the migration ids the sending store has applied, in order. `exportWirePayload`
reads the SQLite file read-only, and refuses a store with no migration log or
no origin columns, and an integer past `Number.MAX_SAFE_INTEGER` or a BLOB,
rather than round or drop a value. Pull receives a payload from the hub,
decodes its JSON (`decodeWirePayload` checks it whole, throwing
`WireFormatError` on syntax error or missing fields), and builds it with
`materialiseWirePayload` into a scratch `effort.sqlite` in a new directory
under the temporary directory. The scratch file is brought forward through
exactly the migrations the payload names, so its schema matches the sender's,
then rows inserted as sent with their `seq` values intact. `mergeStore` then
takes the scratch file as `otherPath` and brings it forward to this rafa's
schema as it does any store. The payload carries no `local` table (the
migration log, `store_meta`, the merge trail), so the scratch file names no
store and no project: the merge records no other store in `merges`, and its
other-project refusal has nothing to compare. The cursor for the next push
advances only after a successful push; after a successful pull, the next pull
starts from the new rows the merge brought in. The codec, `mergeStore` and
`TRUSTED_PERMISSIONS` are exported from the `./store` subpath for the
packages under `packages/`.

**The `service` strategy makes one contact per command through
`createHubContact` (`src/effort/sync/contact.ts`), which never throws
and never sets the exit code.** A contact runs `pushThenPull()` (push then
pull) or `pull()` alone. `local` and `file` are never contacted: nothing is
loaded, selected or written. The `service` adapter is selected once per
contact by `selectSync` through the registry `loadModules` answers, and a
selection that fails (e.g., `SyncModuleMissing`) is written once through
the caller's `warn`. **When sync runs:** `rafa effort collect` makes one
contact and pushes then pulls after storing rows and writing its summary;
`rafa loop start` makes one contact for the run and pushes then pulls at
the end of each task, whatever its outcome, its pulls naming the run's
session id as `SyncPullRequest.sessionId` so the merge's live-loop guard
passes the run's own record; `rafa status`, `rafa next`
(including `--dry-run`), and `rafa effort report` pull alone before they
read, through `pullBeforeRead` (`src/effort/collect.ts`, `src/start.ts`,
querying in the effort module). **The offline rule:** a push or pull that
rejects with an error whose `name` is `HubUnreachable` (network error,
timeout, or hub unreachable) writes exactly one line per contact, `effort
sync: the hub at <url> is unreachable (<first line of why>); this command
used the local store, and its rows sync on the next contact`. An unreachable
hub does not prevent the command from running: it uses the local store and
exits with the status it would have had, and an unreachable push skips its
pull so a command waits out one timeout. The name `HubUnreachable` is
matched on the error's `name` property rather than its class, so a module
can throw a plain `Error({ name: 'HubUnreachable' })` and import no value
from core. Any other rejection is written as `effort sync: <push|pull> over
service failed: <message>`, and a refused push still attempts its pull.
`pullBeforeRead` reads the config without writing its warnings and contacts
nothing when the config is refused, leaving the refusal to the command.

**Merge requires the SQLite backend.** A project configured with
`store: ndjson` is refused by `rafa effort merge <file>`, which names
`rafa effort move --to=sqlite` as the next safe step. `rafa effort
import` uses the same refusal, since import is the user-facing surface
of merge. `rafa effort move --to=sqlite` is already documented as
migrating the store from NDJSON to SQLite.

**The locked settings of the first release are `effort.sync` and
`prerequisites.required`.** These keys cannot be changed by a plan
pushing a settings change; only a released version can alter what a
device must sync and what prerequisites a plan needs. `rafa-hub` serves
these locked keys so every device on a team sees the same rules. The
lock is declared as an immutable set in the device's settings store, not
enforced by a migration, so a test can override it temporarily.

**A module that is not loaded is named by the sync strategy it
implements.** When a project needs `git` sync but its install has no git
module loaded, every command that touches the store first checks the
config, and refuses with a message naming the `modules:` and `allowList:`
lines needed to enable it. The config holds the configuration; the
registry holds what is installed. The check is done by `rafa doctor`,
the loop's preflight, and every command that runs a sync. A module loaded
but not allowed by `allowList:` is equally refused, since it is not
trustworthy.

### Row origins

**A store's origin is its store id, not the machine id.** A row's
**origin pair** is `(origin_store, origin_seq)`, where `origin_store`
is a UUID minted when the store first writes after a migration, and
`origin_seq` is the row's own local `seq` at the moment of insert. The
origin pair stays with a row through copies and merges, so rows from
the first device keep their A identity even after being copied to device
B. If device B then keeps its own store id and the copied rows under A's
origin, both devices can write new rows with their own store ids
without collision: B's new rows are `finding:B:1`, while the copied
rows keep `finding:A:1`, etc. This is why the origin is the store and
not the machine — a single machine might hold multiple copies of a
store.

**Minting a new origin is always safe; missing a copy is not.** The
principle guides every copy-detection rule. A new origin should be
minted when a copy is detected, even if the detection is uncertain —
false positives create duplicates that merge removes, while false
negatives create collisions that merge cannot undo. A store mints a new
origin on a write open after the first migration (when the origin pair
columns were added) and on a write open that detects a copy, never on a
read open.

**The nine scenarios describe every way two stores can meet.** Numbered
by who comes second (the store being brought in): 1) no store anywhere
(the first device creates it); 2) one device has a store (the other
takes a copy before opening); 3) two clean starts (every row new,
only commits overlap); 4) copied then diverged (the shared part
collapses, diverged parts are added); 5) a restored older `.bak`
(nothing new, just the old store restored); 6) different rafa versions
(both brought to the union of named migrations); 7) wrong project
(refused); 8) a loop is writing the store (refused); 9) three devices or
the same merge twice (same result in any order, any number of times). In
scenario 4, the recommended pattern for starting a second device: first
set aside any existing store on the new device. On 2026-09-28, an `scp`
of the seed store overwrote the second device's own small store before
rename; then take a consistent copy with `rafa effort copy` (or
`sqlite3 .rafa/effort/effort.sqlite ".backup <path>"`, never a plain
file copy during a write), move it and `.rafa/config.yaml` into the new
device's `.rafa/`, and merge back later with `rafa effort merge`.

**Why UUIDs alone are not trusted.** A v4 UUID almost never collides by
chance; collisions come from copies (a restored backup, a cloned VM
starting with the same random state). A project that minimized UUID
collisions still saw a handful a year. The composite id guards against
exactly that: two columns, one fixed per store, one per row within that
store, cost just as much as the UUID column they replace and catch every
copy by detecting when the machine's filesystem reports a fact that did
not come from that store. The storage choice is "expand first" from
expand-and-contract (parallel change); #234 already uses "contract" for
a breaking migration, and expand-first lets migration name everything,
today and in the future.

### Store metadata

**`store_meta` is a single-row table (`id = 1`) that identifies the
store.** The row holds the origin the store stamps (`origin_store`, a
UUID), the project git reads in the store's directory (or the one the
row already names when git finds no root commit there), and the host,
path and file identity the store was minted under. The origin is
minted on a write open, at most once per store file, behind the first
migration named `store-meta`; a write open that keeps the existing
origin asks git nothing. Every write open also rotates the store's
generation (`store_meta.generation`, added by `store-meta-generation`),
as **Every write open rotates the generation** below says. The row is
unminted if it has no value in `origin_store` (the
column is `NOT NULL` for every runtime, but minting is skipped when git
finds no project or repository). A read open never reads or writes the
`store_meta` row, which is why `rafa effort schema` leaves an unminted
store's bytes unchanged.

**The host id is an HMAC-SHA256 of `/etc/machine-id`, the macOS
platform UUID, or the hostname, never the raw value, since `machine-id(5)`
asks for a keyed hash and a store travels between machines.** The path is
the real path, so a symlinked spelling does not trigger a copy-detection
mint. The device and inode are bigints: when a `.bak` file is renamed
over the store, it has a new inode and triggers a copy-detection mint,
but one restored with `cp` over the existing file keeps the old inode,
so those three facts match (measured on tmpfs). The generation catches
that restore once the store has been written since the `.bak` was
taken, as the next paragraph says, and the merge's collision check
catches whatever the open misses. SQLite's INTEGER is signed and bun binds
a bigint past 2^63 by wrapping without warning, so the device and inode
are written as their two's complement and read back through `CAST(… AS TEXT)`
as unsigned.

**Every write open rotates the generation, under `BEGIN IMMEDIATE`.**
`settleStoreIdentity` (`store-meta.ts`) takes the write lock, reads the
row, decides again under the lock (`decideStoreIdentity`,
`store-identity.ts`), and writes a new random generation in that
transaction: into the row it keeps, or into the new row it mints. It
writes the same value to the **side record**, the file
`<real path of the store file>.generation` beside the store
(`store-generation.ts`), then commits. A write open mints when the row
is absent, any of the three facts moved, or the row holds a generation
the side record does not; a NULL generation, written by a runtime that
did not know the column, is judged by the three facts alone, so such a
store keeps its id on its first write and holds a generation after it.
The row is written before the side record and both before the commit:
a crash between the side record's rename and the commit leaves the side
record one rotation ahead, and the next write open mints once and keeps
on the write after. A read open neither reads the side record nor
writes it. Measured in `store-meta.test.ts` and `store-identity.test.ts`.

**A test passes its fifth argument to `withSqliteStore` to inject the
host, the project, the store id and the generation, so test stores can
be minted independently.** `store-identity.ts` observes the facts and
decides, `store-generation.ts` reads and writes the side record, and
`store-meta.ts` reads and writes the row. `withSqliteStore` calls
`settleStoreIdentity` after `bringForward`, so the `generation` column
exists on every write open.

### Copy detection

**The collision check in the merge (`store/merge-store.ts`) catches
every copy by examining the origin pair of each incoming row.** When a
store is copied — backed up and restored, cloned to a new VM, or moved
to another device — the merged store will hold two rows with the same
origin pair: one from the local store (inserted before the copy) and one
from the incoming store (the same insert, copied). The first detection
marks the incoming store's origin as a copy: its `store_meta` row's
filesystem identity (device, inode, path) is found in the local store's
`merges` table (a log of every completed merge) or it collides on
`origin_store`. When a copy is detected and merged, the merge refusal
entry names the copy's origin and what copied it.

**The generation catches a copy of the store file at the open, on the
copy's first write.** A copy carries `store_meta.generation` and leaves
the side record, which sits beside the original's real path as
`<store file>.generation`, behind. So a copy at another path finds no
side record, and a store deleted and replaced by a copy taken before
its last write, or a `.bak` renamed or `cp`'d back over it after a
write, finds a side record one rotation or more ahead of its row, and
mints
with the reason `generation` whether or not the host handed the copy
the freed inode number. It does not catch a restore of the whole
directory, the store file and its side record together: the two agree,
and when the file comes back at its old inode, as `cp` over the existing
file writes it, the three facts match too and nothing mints (measured
on tmpfs). A store deleted and replaced by a copy taken after its last
write holds the generation its side record holds, so only a new inode
number mints it; with the original gone there is one store again, and
no origin pair can collide. The merge's collision check above is what
catches the copies the open misses.

**A development build mints on the first write after copy detection.**
Between the first plan and the lock in `bringForward`, an open with
anything to adopt or apply asks `refuseUnownedDevelopmentWrite` for a
store it does not own. After the lock is taken (in the same transaction),
if the merge detects a copy, `settleStoreIdentity` is called a second
time with the detection flag, and it mints a new origin for this store.
This is why a development build can write copies: it owns stores under
`tmpdir()` and under `RAFA_EFFORT_DIR` unless one sits in the project's
own `<root>/.rafa/effort/`.

### Identity through rebuilds

**When a store is rebuilt in place (by `fix-schema`, `migrate`, or
`merge`), a swap operation preserves the store's identity if it would
keep its id.** A rebuild writes a new file aside with a temporary name
(`effort.sqlite.merge-<stamp>`, `effort.sqlite.migrate-<stamp>`, or
`effort.sqlite.fix-<stamp>`), brings it forward through migrations,
checks it, and backs it up with `VACUUM INTO` to `.before-*-<stamp>.bak`.
Before the new file is renamed over the live store, `swapIn`
(`src/effort/store/rebuild-aside.ts`) calls `decideStoreIdentity` to ask
whether the store would keep its id: if yes, it writes the new file's
own device and inode and a new generation to that file's `store_meta`,
writes the same generation to the side record immediately before the
rename, and then renames the new file over the live store. This keeps
the store's identity even though its inode may change during the rename,
and leaves every file the rebuild left behind on a generation the side
record no longer holds. The old file, now the backup,
carries no identity after the rename. If the backup is ever restored
(undoing the rebuild), its device and inode have changed during the swap,
and its first write will detect it as a copy and mint a new origin with
the reason `generation`.

### The schema history

**SQLITE_MIGRATIONS is defined in `src/effort/store/migrations.ts` and
re-exported from `store/sqlite.ts`.** Every entry takes a store from one
version to the next. The entry at index `i` takes version `i` to version
`i + 1`; the last version is the array's length, so appending a migration
is what raises it. Two things differ from earlier Ralph: the version lives
in `PRAGMA user_version`, a SQLite header field written in the same
transaction as the migrations it records, so a run killed between the two
rolls the field back with the tables; and the last version is the array's
length rather than a constant beside it, so an appended entry cannot be
forgotten. Measured, a throw inside the transaction rolls `user_version`
back as well. That count is what `migrateSchema` writes and a pre-log
release reads. `row-origins`, the first entry past the thirteen legacy
ones, makes the array longer than 13, while an open through
`bringForward` leaves `user_version` at the legacy gate; so a store's
`user_version` no longer equals `SQLITE_SCHEMA_VERSION`, and its log,
not `user_version`, says which entries it holds. A test that plants a
pre-log store `behind` therefore plants it at `LEGACY_GATE_OPEN`, never
at the array's length less one: past 13 a pre-log store is
`pre-log-unreleased`, and `doctor-effort-schema.test.ts`'s behind case
failed that way once `store-meta` made the array 15.

**Each entry is a named `SqliteMigration`: an `id`, what it `breaks` and
its `sql`.** The `id` is kebab-case and is never reused. `breaks` is `[]`
for an additive entry, and a breaking one also carries a `contract`. The
thirteen entries 0.23.0 to 0.24.1 shipped are all `breaks: []`.
`src/effort/store/migrations.lock.json` holds each entry's sha256 by id,
and `migrations.test.ts` fails when an entry's SQL no longer matches its
lock line, or when an entry has no lock line. So a new entry adds its
lock line in the same commit. `LEGACY_GATE_OPEN` (13) and
`LEGACY_GATE_CLOSED` (1000) are the `user_version` values that let a
pre-log release in or keep it out, and `legacyGate` picks one from what
a store holds. The open path reads the names and the gate through
`bringForward`, and nothing outside `migrations.test.ts` reads the lock.
`migrateSchema` still counts by position and writes no log; no open or
command goes through it, and tests plant pre-log stores with it.

**`classifyMigration` (`src/effort/store/migration-shapes.ts`) reads what
an entry's SQL breaks, and `migrations.test.ts` holds every entry to it.**
It strips comments, splits statements (a trigger body stays whole) and
gives each one a row of the spec's additive table: a new table, nullable
column, plain index or view breaks nothing; a unique index does too when
its table is new in the same entry, or when it covers a column the same
entry adds and its `WHERE` holds `c IS NOT NULL` as a top-level
conjunct. Any other unique index, a dropped index or a trigger breaks
`writers`; a dropped or renamed table or column, or a statement matching
no row, breaks both sides. The test fails an entry that declares less
than that, and an additive entry holding a column added `NOT NULL` or
with a non-NULL `DEFAULT`, a PRAGMA, a data statement or an unknown
shape. A breaking rebuild may carry its `INSERT … SELECT`. The test also
checks unique kebab-case ids and `contract` exactly when `breaks` is
not empty. It applies each entry to `:memory:` and requires every object
its text names in a `CREATE` to be in `sqlite_master`. The names are read
before comments are stripped, so a statement a comment swallowed fails
here, and so does a `TEMP` table. SQLite also refuses an `ADD COLUMN`
whose statement ends in a `--` comment before its `;` (`error in table
<t> after add column: incomplete input`). Last, it reads
`migrations.lock.json` as released at v0.33.0, a copy committed as
`src/effort/testdata/migrations/lock-v0.33.0.json`, and fails a line
changed or dropped since; a newer release moves that copy and its
`RELEASED_TAG` forward by hand. A provenance case holds the copy to
`git show v0.33.0:` and is skipped, its title naming why, when git, the
tag or the lock at the tag is absent. The 0.24.1 rule and history are
read from an excerpt of that bundle committed beside it, never from
`~/.rafa`. At v0.24.1 the lock is absent, since that release predates it.
Each rule has a near-miss control, including a planted `DROP COLUMN`
declared `[]`.

**`planSchema` (`src/effort/store/schema-plan.ts`) is the compatibility
decision, and every open asks it through `bringForward`;** `fix-schema`,
`effort schema` and `effort migrate` ask it directly. It takes what a store holds (its
`schema_migrations` rows, or none, and `user_version`), this build's
catalogue with checksums (`sqliteCatalogue`), `read` or `write`, and
whether `rafa effort migrate` asks. It answers "use", with the legacy
entries to adopt, the entries to apply and the gate value, or "refuse"
with one of the seven `REFUSAL_REASONS` and a message ending in
`Next safe step: <command>`. It imports nothing from `bun:sqlite` or
`sqlite.ts`. An open with something to apply counts as a write, so a
store holding an unknown migration that breaks writers refuses a read
that would apply one.

**`bringForward` (`src/effort/store/bring-forward.ts`) acts on that
decision, and every open calls it.** It reads a store's
`schema_migrations` and `user_version`, plans, and throws a refusal as
`SchemaRefusedError` (`reason`, `nextStep`) with nothing written. With
nothing to adopt or apply it returns without taking a lock. Otherwise it
takes `BEGIN IMMEDIATE`, reads and plans again, and in that one
transaction creates `schema_migrations`, logs the adopted legacy entries
unrun with this build's checksums, runs and logs each pending entry, and
sets `user_version` to the gate. A throw rolls all of it back. A test
passes a synthetic tail as its `migrations` option; `applied_by` is this
build's package version unless the caller names another.

**A development build never adopts or migrates a store it does not
own.** Between the first plan and the lock, an open with anything to
adopt or apply asks `refuseUnownedDevelopmentWrite`
(`src/effort/store/development-build.ts`). `readRuntimeIdentity`
(`src/runtime/identity.ts`) walks up from `Bun.main`, through its real
path, to the nearest `package.json` named `@open-tomato/rafa`; the build
is a development build when that directory also holds `src/rafa.ts`, so
`bun src/rafa.ts`, a checkout's `dist/cli.js` and every `bun test`
process are, and a runtime copy (no `package.json`) or an npm install
(no `src/`) is not. A development build owns a store under `tmpdir()`,
and one under `RAFA_EFFORT_DIR` unless it sits in a project's own
`<root>/.rafa/effort/`. Over any other it throws
`DevelopmentBuildRefusedError` (`nextStep` `rafa effort copy`) with the
spec's text, naming `schema_migrations` for an adoption ahead of the
pending ids, and adds ` Loop <sessionId> (pid <pid>, plan <stub>) is
running on this store.` for each record under `<root>/.rafa/runs/` that
reads `running` or `paused` with its pid alive. Nothing is written, so
the store keeps its bytes. With nothing pending a development build
reads and writes the live store as any rafa does. So until the
installed runtime has adopted this project's live store (0.24.1 left it
at `user_version` 13 with no log), every `bun src/rafa.ts` command that
opens it is refused; run it with `RAFA_EFFORT_DIR` over a copy.
`development-build.test.ts` hands the refusal another `tempDir` to make
a store under the real one unowned, as a spawned child's `TMPDIR` would.

**`withSqliteStore(path, access, create, use)` is the open, and every
caller states `access`.** `keys`, `read` and every reader outside the
port pass `'read'`; every writer passes `'write'`, and so does
`writeSqliteStore` for an empty write. The open sets `PRAGMA
busy_timeout` to `effort.busyTimeoutMs`, then calls `bringForward(db,
path, access, 'open')` and `settleStoreIdentity` (`store-meta.ts`,
which mints only on a write) before `use`. A read of a current store writes nothing;
a read of a pre-log store adopts it, since adoption counts as a write,
unless a development build is refused it as above; a
store logging an unknown migration that breaks only writers is read and
refused a write. Without the busy timeout, an open that found migrations
pending while another process held the lock threw `SQLITE_BUSY` at
once; with it, `sqlite.test.ts` has two processes open one fresh store
while a third holds the lock, and one applies every migration while the
other finds nothing pending. A test that expects an open to throw on a
held lock waits out the timeout, five seconds by default, as the lock
case of `tracker-refs.test.ts` does; one that sets a short timeout
through `setActiveStoreSettings` puts `null` back after it.

**`effort.busyTimeoutMs` reaches every open through
`activeStoreSettings` (`src/effort/store/settings.ts`).** It is a whole
number of milliseconds from 1 to 60000, 5000 by default, and the reader
refuses `0`, negatives, `60001`, fractions, quoted numbers and `false`.
`loadConfig` hands the store the value it resolved each time it runs, so
a command that reads its config opens the store with it, and one that
never does opens with the default. The setter refuses a value the
reader would, with a `RangeError`. It is module state, so a test that
sets it sets `null` after. `settings.test.ts` has an open wait on a lock
a child process holds and get in once it is let go, and an open past a
100 ms timeout throw `SQLITE_BUSY`. The two `fix-schema` opens set no
busy timeout.

### Migrations

**A migration is an entry in `src/effort/store/migrations.ts` with an id, its SQL and what it breaks.** The id is kebab-case and never reused. The array's order is only the apply order for a fresh store: a store records applied migrations by id and sha256 in `schema_migrations`, and `migrations.lock.json` freezes each entry's sha256. Never edit a shipped entry; write a new one.

**Additive is the default, and the guard checks it.** A new table, a nullable column, a non-unique index, or a partial unique index over columns the same migration adds breaks nothing. Anything else declares `breaks` and a `contract`, ships as the second of two specs, and runs only through `rafa effort migrate`. Migrations hold DDL only; a backfill is a command. No code reads by `SELECT *` or inserts without a column list. A reader treats NULL as "written by a runtime that did not know this column".

**`user_version` is the legacy gate, not the schema version.** It holds 13 while every applied migration is additive, so pre-log runtimes keep working, and 1000 once a breaking migration runs, which shuts them out.

**A development build never migrates the live store.** To run branch code over real data, copy the store first with `bun src/rafa.ts effort copy --to=.rafa/scratch/<stub>-effort`, then put `RAFA_EFFORT_DIR=<absolute path of that dir>` in front of each command on the same line, because a session's shell may not keep an `export`. A test opens stores under `tmpdir()` only, and the store module throws otherwise.

**A store a runtime refuses** is read with `rafa effort schema`, which names the next safe step: a newer rafa, `rafa effort migrate --dry-run`, or `rafa effort fix-schema --dry-run`.

### Tables outside the port

`findings`, `blockers`, `out_of_scope_bugs`, `changes`,
`report_absences`, `task_reports`, `preflight`, `dispatches`,
`skill_invocations`, `plan_ci`, `store_meta`, `merges` and
`merge_conflicts` are SQLite-only and stay out of the port's row map.
The last three, which migration `store-meta` creates, are the store's
own identity and its merge trail: `store_meta` holds one row (`id = 1`)
naming the origin the store stamps, its project and the host, path and
file identity it was minted under; `merges` records each merge and
`merge_conflicts` each incoming row one could not settle. Migration
`store-meta-generation` adds `store_meta.generation`, a nullable
non-empty text column; NULL there means a runtime that did not know the
column wrote the row. `mergeStore`
(`store/merge-store.ts`) writes one `merges` row per merge into the
build it swaps in through `rebuildAside`, behind
`effort.sqlite.before-merge-<stamp>.bak`; its refusals, the forwarded
copy of an other store that lacks migrations, and its row-count check
(each table's old count plus the rows the merge added, through
`checkedCounts`' `added`) are in its module note. `settleMatches`
(`store/merge-conflicts.ts`) fills
`merge_conflicts`: it compares each pair the union matched on every
column but `seq` and the origin pair, skips an equal pair, fills a
set-once field NULL here from the other store and keeps a filled one
against NULL there, and records the incoming row as JSON, both rows
kept, when two filled values differ (`field` names the column) or the
rows differ outside every edited field (`field` NULL). Each set-once
field has its literal `UPDATE` in `SET_ONCE_FILLS`, so
`merge-rules.sweep.test.ts` can read it. `commits.row_json` is edited under
the rule `recomputed`: two rows of one commit that differ only in its
`minutesSincePrevious` are skipped, the gap here kept, through the
field's entry in `RECOMPUTED_COMPARISONS`. `recomputeCommitGaps`
(`store/merge-commit-gaps.ts`) rewrites that gap, with no git call,
for each commit the union inserted and the commit right after it in
time, ordered by `Date.parse` of the stored timestamp and by sha within
an instant, so at most two rows are written per commit brought in.
`src/effort/store/store-identity.ts` decides, on a write, whether to
mint, and `store-meta.ts` reads and writes the row: `withSqliteStore`
calls `settleStoreIdentity` after `bringForward`, so a `write` open
mints when the row is absent or a fact moved, under `BEGIN IMMEDIATE`
with a second decision, and a `read` open never reads or writes it,
which is why `rafa effort schema` leaves an unminted store's bytes
unchanged. A write that keeps the origin asks git nothing. A mint
records the project git reads in the store file's directory, or the
one the row already names when git finds no root commit there; with
neither, as for a store under `tmpdir()` outside a repository with
commits, the column is `NOT NULL` and nothing is written, so such a
store stays unminted and each writing open asks git again. A test
passes `withSqliteStore` its fifth argument to inject the host and the
project. SQLite's INTEGER is signed and bun binds a bigint past 2^63
by wrapping it without a word, so the device and inode are written as
their two's complement and read back through `CAST(… AS TEXT)` as
unsigned. The host id
is an HMAC of `/etc/machine-id`, the macOS platform UUID or the
hostname, never the raw value, since `machine-id(5)` asks for a keyed
hash and a store travels. The path is the real path, so a symlinked
spelling does not mint; the device and inode are bigints. A `.bak`
renamed over the store has a new inode and mints, but one restored
with `cp` over the existing file keeps the old inode and does not
(measured on tmpfs); the merge's collision check is what catches it.
Every production insert into the twelve tables a merge unions stamps
`origin_store` from that row and `origin_seq` as the row's own `seq`,
which the insert names itself as `COALESCE(MAX(seq), 0) + 1` so the
two cannot differ: `STAMPED_COLUMNS` and `stampedValues`
(`store/origins.ts`) spell both for every writer, in the insert's own
column list, with no trigger and no `UPDATE`. A store with no row
stamps NULL in both. A copy's new origin counts on from the `seq` it
copied, and no reader names either column, so a row an older runtime
inserted is read as any other. `origins.test.ts` reads every
`INSERT INTO` in the modules directly under `store/` from source, not
the scenario builders in `store/testdata/merge-scenarios.ts`, which
plant a `plan-ci` store's rows with no origin columns, and fails on an
unstamped one other than the `schema_migrations` log, `store_meta`, `fix-schema`'s
copy, which carries the columns over as they were, the merge's
union (`store/merge-union.ts`), which inserts another store's unmatched
rows under a new local `seq` with their origin pair unchanged, and the
merge's conflict trail (`store/merge-conflicts.ts`) into the local
`merge_conflicts`, its `merges` row (`store/merge-store.ts`), and the
merge fixtures' restore (`store/fixture-extract.ts`), which builds a
store from an anonymised extract with every row as the extract holds it.
Each arrives as a new `SQLITE_MIGRATIONS` entry, is written under the
`sqliteStorePath` that `store/sqlite.ts` exports, and lands in
`effort.sqlite` whatever `store` selects. A writer that can be left with
nothing to insert goes through `writeSqliteStore`, as `writeFindings`,
`writeTriage`, `writeChanges`, `writePreflightChecks` and
`writeSkillInvocations` do, so an empty write on a store that exists
still meets the schema check. `writeReportAbsence` always has its one
row and opens `withSqliteStore` directly, as `writeTrackerRef` does.
`writeTaskReport` always has its one row too, and passes
`writeSqliteStore` a count of one, which opens the store as that direct
call does; so does `writeDispatch` (`store/dispatches.ts`).
`readTaskReportTallies` reads that table back for `rafa effort report`,
under the repo root whatever `store` selects, and opens nothing when the
file is absent; `readPreflightHalts` reads `preflight` back the same way,
`readSessionBudgets` the `dispatches` rows carrying a budget, and
`readSessionAgents` those naming an agent, for the `--by=agent` split of
`rafa effort report --trend`.
`readTaskFinishes` (`store/task-finishes.ts`) reads the `done` rows of
`task_reports` and `report_absences` back the same way, for the rough ETA
of `rafa loop status`, and `readPlanChanges` (`store/changes.ts`) every
`changes` row under one plan stub, in `ACROSS_STORES_ORDER`
(`store/origins.ts`: `collected_at`, the origin pair, then `seq`), for a
release step to render. A reader that answers rows in order over a table
with `collected_at` sorts by that constant rather than `seq`, since a
merge gives the other store's rows new local `seq` values after its own.

**A new table has a checklist, and each item lands in the table's own
commit:**

- its `SQLITE_MIGRATIONS` entry and its `migrations.lock.json` line;
- **declare its merge rule** in `MERGE_RULES`
  (`store/merge-rules.ts`): its scope, `merged` for a table whose rows
  travel between stores or `local` for one that never leaves its
  machine; for a merged table, the identity columns that match its
  rows with a NULL origin and every column a production statement
  changes after the insert, each with its rule; a merged table also
  carries `origin_store` and `origin_seq` with its partial unique index
  `<table>_by_origin`, and joins `ORIGIN_TABLES` (`store/origins.ts`)
  with its inserts stamped. `merge-rules.sweep.test.ts` builds a store
  through every migration and fails on a table with no entry, an entry
  with no table, a merged table without both origin columns and that
  index, and an `UPDATE <table> SET <column>` in a production module
  under `src/` whose column has no rule; a new edit of an existing
  table's column needs its rule the same way;
- the table-list expectations below.

A new table moves every full table-list expectation with it: two in
`sqlite.test.ts`, one each in `triage.test.ts`, `absences.test.ts`,
`reports.test.ts`, `preflight.test.ts`, `dispatches.test.ts`,
`changes.test.ts`, `skill-invocations.test.ts` and `plan-ci.test.ts`,
and the filter the version-5 case of `preflight.test.ts` takes the later
tables out with, beside the version-6 filter of `dispatches.test.ts`, the
two version-7 filters of `changes.test.ts`, the two version-10 filters of
`skill-invocations.test.ts`, and the two version-12 filters of
`plan-ci.test.ts`. Those lists hold `schema_migrations`, which the first
open through the module creates, and each filter over a store planted
by raw SQL takes it out as well, since no open has made it there yet.

### The fact rows

**`readSkillFacts` (`src/effort/skill-facts.ts`) answers one row per task
report, joining what `rafa effort report --skills` needs.** It reads rows
rafa already stores and nothing else: no session transcript is opened.
It is a TypeScript reader rather than a SQL view, so the schema's table
expectations do not move. Each `SkillFact` holds what `task_reports` says
(plan, task line, outcome, claimed skills), what `dispatches` holds about
its resolver and offers, what `skill_invocations` shows it invoked (or
`'unknown'` when its log could not be read), its `findings`, `blockers`
and `out_of_scope_bugs` rows in `ACROSS_STORES_ORDER`, the facts of one
plan in that order over `task_reports`, and every `plan_ci` reading
of its plan (empty for no plan or a plan with no reading). Names are
mapped through `bareSkillName`, so a served skill reads as its bare name
and a plugin's `plugin:name` is kept. A session with no report (a
`report_absences` row) has no fact row.

### The recurrence rule

**`findRecurrences` (`src/effort/recurrence.ts`) answers where a failure
string appears again in rows rafa stores.** A skill's failure strings come
from its `failure_strings:` in the frontmatter, a lesson's from its
`artifact`. A string recurs when it appears as a case-sensitive literal
(`String.prototype.includes`, no folding) in any field of the task's own
or each later task's findings, blockers or out-of-scope bugs (searched
fields: `trigger`, `what`, `cause`, `artifact` for findings; `what`,
`artifact` for entries), or in the plan's failing check names (the union
over every reading). The task is the fact at `fromIndex`; "later task" is
a row after it in the same plan. A task under no plan has no later task.
NULL fields and empty strings are never searched. Each match names the
string, the source (finding, blocker, bug or plan-ci), the session and
task line it was found in (NULL for plan CI), the field, and the field's
whole value. Matches come in search order: task by task, finding then
blocker then bug then checks, field by field as listed above, string by
string. A string given twice is searched once.

### The signals

**`skillSignals` and `lessonSignals` (`src/effort/skill-signals.ts`) say
what co-occurred with a failure string's recurrence.** Both are pure
functions of the fact rows and the recurrence matcher; neither reads a
path or config. A signal is checked in order, defined once, and never
claims a cause.

**Skill signals.** A skill is read when a row's `skillsOffered` or its
known `invoked` names it. A skill some row offered gets exactly one signal
(in order): `recurring` (a row invoked it and one of its failure strings
then recurred), `unmeasured` (invoked with no failure strings declared),
`earning` (invoked with no recurrence after any invocation), or `ignored`
(no row invoked it). A skill no row offered, and some row invoked, is in
`neverOffered` with no signal. A row whose `invoked` is `'unknown'` never
reads as invoking nothing, so a skill no known row invoked and some
`unknown` row offered has no signal (cannot tell `ignored`).

**Lesson signals.** A lesson is read when a row's `lessonsOffered` names
it. It is `injected-recurring` (its artifact recurred after a row injected
it) or `injected` (otherwise). An id the held set no longer resolves has a
null artifact and reads as `injected`.

### The SkillsReport JSON schema

**`buildSkillsReport` (`src/effort/report-skills.ts`) answers the report as
a pure structure and as JSON.** It reads the store's fact rows (narrowed to
named plans), each skill's `failure_strings:` from the resolved tiers, and
each held lesson's `artifact` by id. One `SkillsReportPlan` per plan the
rows hold, in the order facts list them; a report under no plan is its own
entry. Within a plan, one `SkillsReportArm` per resolver the rows ran under,
in order first seen. A plan run under one resolver has one arm.

| Field | Type | Note |
| --- | --- | --- |
| `plans` | array of `SkillsReportPlan` | one per plan, or empty |
| `plans[].planStub` | string or null | null for no plan |
| `plans[].sessions` | number | count of fact rows of this plan |
| `plans[].planCi` | `PlanCiRow` or null | latest CI reading by time |
| `plans[].resolvers` | array of `SkillsReportArm` | one per resolver |
| `plans[].resolvers[].resolver` | string or null | `planner`, `tag`, `none`, or null |
| `plans[].resolvers[].sessions` | number | fact rows of this arm |
| `plans[].resolvers[].unknownSessions` | number | rows with unknown invocations |
| `plans[].resolvers[].skills` | array of `SkillSignalRow` | offered skills |
| `plans[].resolvers[].skills[].name` | string | bare skill name |
| `plans[].resolvers[].skills[].offered` | number | fact rows that offered it |
| `plans[].resolvers[].skills[].invoked` | number | rows whose log shows invocation |
| `plans[].resolvers[].skills[].reported` | number | rows claiming it was used |
| `plans[].resolvers[].skills[].recurred` | number | invoking rows after which it recurred |
| `plans[].resolvers[].skills[].matches` | array of `Recurrence` | each string found |
| `plans[].resolvers[].skills[].signal` | string or null | `recurring`, `unmeasured`, `earning`, `ignored`, or null |
| `plans[].resolvers[].neverOffered` | array of `SkillTally` | invoked, never offered |
| `plans[].resolvers[].lessons` | array of `LessonSignalRow` | injected lessons |
| `plans[].resolvers[].lessons[].id` | string | lesson id |
| `plans[].resolvers[].lessons[].artifact` | string or null | string it's searched for |
| `plans[].resolvers[].lessons[].injected` | number | fact rows that injected it |
| `plans[].resolvers[].lessons[].recurred` | number | rows after which it recurred |
| `plans[].resolvers[].lessons[].matches` | array of `Recurrence` | each artifact found |
| `plans[].resolvers[].lessons[].signal` | string | `injected-recurring` or `injected` |
| `plans[].resolvers[].m1` | `SkillsMetric` | skill references per task |
| `plans[].resolvers[].m2` | `SkillsMetric` | uptake of offered skills |
| `*.m1.numerator` | number | distinct (task line, skill) invoked |
| `*.m1.denominator` | number | distinct task lines |
| `*.m1.percent` | number or null | `numerator / denominator * 100` |
| `*.m2.numerator` | number | (session, skill) both offered and invoked |
| `*.m2.denominator` | number | (session, skill) offered |
| `*.m2.percent` | number or null | `numerator / denominator * 100` |

Rows with unknown invocations are left out of M1 and M2 denominators and
numerators. A `Recurrence` holds the `string` found, the source, session id
and task line (null for plan CI), field name, and the field's whole `text`.

**`out_of_scope_bugs.scope` is read, not copied.** Every other column of
these tables holds what a report wrote; `scope` holds what
`src/triage/machine-fault.ts` reads off the bug's `what` and `artifact`,
which `store/triage.ts` calls for each bug it stores: `machine` for a
fault of the machine the session ran on, `rafa` otherwise, and never
NULL. It arrived at schema version 9 as an `ALTER TABLE ... ADD COLUMN`,
the first migration that creates no table, so a row a version-8 store
already held reads NULL — stored before the reading existed. It is
outside `out_of_scope_bugs_by_entry` because it is a function of `what`
and `artifact`, which that index already holds, so a repeat of an entry
is still the duplicate it was and keeps the scope on the row. A column
added to one of these tables moves every COLUMN-list expectation, as a
new table moves the table lists — for this one, exactly two: the
`COLUMNS` map and the whole-row `toEqual` of `store/triage.test.ts`.
The table-list expectations named above do NOT move for a column, and
neither does `tests/store-version-guard.test.ts`: `sqlite.test.ts` and
the guard spell table names only, and the guard builds its refusal
wording from `SQLITE_SCHEMA_VERSION + 1` at import time, so a bumped
version moves both sides of its comparison together. Read the two
`store/triage.test.ts` expectations first and expect nothing else to
redden.

**`dispatches` is written for every stored session, ahead of its
report.** `storeTaskReport` (`start/dispatch.ts`) writes one row keyed by
the session id, holding what the task line's declaration asked for and the
flags the session was spawned with, one row per session: a second write
for the same session id is skipped, never merged into the first. The
table has three columns holding resolver and offer information:
`resolver` (the skill resolver the session ran under), `skills_offered`
(the bare names of skills its prompt offered), and `lessons_offered` (the
ids of lessons its prompt offered). Whatever became of the task, the
dispatch is written ahead of the task report; a refused dispatch row
stores no report. A dispatch handed no handout stores a NULL resolver
beside two `[]` offers. No column holds the outcome: `task_reports` and
`report_absences` hold it under the same session id.

**`dispatches.resolver`, `skills_offered` and `lessons_offered` arrived
at schema version 10**, a second `ADD COLUMN` migration, so a row a
version-9 store held reads NULL in all three: not recorded. The
`DispatchWrite` fields behind them are optional and store NULL when left
out; an offered list that was recorded stores `[]` when nothing was
offered. Each list is stored in the order it was handed, as the prompt's
section listed it. Adding the three columns moved three expectations, all
in `store/dispatches.test.ts`: the `COLUMNS` list and the two
whole-row `toEqual`s.

**`skill_invocations` is written by `effort collect`, not by a task
report.** Its collector (`src/effort/skill-use.ts`) reads the input of
`Skill` tool calls — the one exception to the "no tool input" rule — to
extract and count each skill a session invoked, in its main thread and in
its sidechains. The skill half of `effort collect` (`src/effort/collect-skills.ts`)
reads the `Skill` calls of each session the run read into a session row, or
with `--skills` of every session the port holds whose log is in the
directory, and skips a session already holding a row. It writes under
the repo root even when `collectEffort` is handed a store, so the
parity suites, whose `repoRoot` is the live sibling, pass `skills: null`.
One session invoked from both sides is two rows, one per side. An
`unknown` row — one row holding the session and NULL in `name`, `sidechain`
and `count` — marks a session whose log the collector could not vouch for
(log version mismatch, unreadable line, or unreadable skill call). A session
that invoked no skill stores no row at all.

**Claude Code's own usage record covers only plugin-delivered skills, never a
project skill, so `skill_invocations` has no CLI-native count to check
itself against.** The one persisted usage record found under `~/.claude/`
is `pluginUsage` in `~/.claude/.claude.json`: a map keyed
`<plugin>@<marketplace>`, each entry holding `usageCount`, `lastUsedAt` and
`lastUsedNumStartups`, and it backs the "last used" / "never invoked" text
the `/plugin` skill-detail view and `/skill-doctor` read. Verified on
2026-09-27 with a real `claude -p` session under the pinned
`SKILL_USE_CLI_VERSION` (2.1.280): a scratch repo with two project skills
planted under `.claude/skills/`, outside any plugin, each invoked once by
name in the one session recorded. `readSkillUse` over that session's log
answered the expected `probe-alpha` and `probe-beta` counts of 1 each,
while `pluginUsage` held its pre-session eight plugin entries unchanged —
no key for either probe skill appeared, before or after, and no state file
was written into the scratch repo's own `.claude/` either.
`~/.claude/stats-cache.json` was checked too and holds only an aggregate
`toolCallCount` per day, no per-skill field. So `skill_invocations` is not
a second recording of a count the CLI already keeps for a rafa-served
skill; for a project skill, the kind rafa serves, it is the only per-skill
count that exists anywhere, and this collector is the sole source
`rafa effort report --skills` can read.

**The collector's exception to "no tool input".** `session-log.ts`
and the effort port fold a session's logs into counters and identifiers
without keeping message content. The skill-use collector in
`src/effort/skill-use.ts` is the single exception: it reads the `skill`
field from the input of a `Skill` tool call, mapped to a bare name with
`bareSkillName`, and no message content otherwise — not the call's
args, every other tool's input, every prompt, or any tool output. The
counts it answers can therefore be stored beside the session rows without
the store becoming a copy of a transcript. The collector vouches for the log
format by comparing each record's `version` against `SKILL_USE_CLI_VERSION`;
a session read as `unknown` is never averaged as a session that used no skill.

**`plan_ci` is written by `pr triage` and `pr merge`, held by the plan CI
readers.** It arrived at schema version 13: one row per settled reading of
a pull request's checks, keyed by `(pr, head_sha, read_at)`. The row holds
the plan stub the head branch resolves to, the verdict (`green`, `red` or
`none`), and the failing checks' names as a JSON array. Both commands call
`recordPlanCi` (`store/plan-ci.ts`), handing it the pull request, the
`CheckRow`s and `plan.dir`; it never throws. A `pending` reading stores
no row. `readPlanCi` reads every row, or one plan's, in append order.
**Verdict, PR, head commit.** A `pending` verdict (a check still running)
stores no row, and the table's CHECK admits only `green`, `red` and `none`.
`verdictOf` answers the settled verdict over every check, and the `failing`
list is the failing checks' names; a CHECK keeps `failing` non-empty
exactly when the verdict is `red`. The key is `(pr, head_sha, read_at)`:
the same head read twice at two times is two rows, and the same reading
written twice is stored once (the second counted as skipped).
**The plan stub.** The head branch is read as `<type>/<stub>` by
`attributeBranch`, and the stub resolved against the plan roster by
`resolvePlanStub`, as `effort collect` resolves a session's branch. A stub
the roster does not hold is taken verbatim, as `release status` takes it.
A branch naming no stub (`main`, a branch with no `/`) or a queue id
reaching two plans records nothing, since `plan_stub` is never NULL.
**Writers.** `pr triage` calls `recordPlanCi` from `assessOne` after each
checks read of a pull request it assesses, re-assessments of a `--resolve`
run and readings that assess nothing included; the checks the bare form
reads to find red candidates store nothing, since a list answers no head
sha. `pr merge` calls it from `runMerge` straight after its one checks read
and before any refusal, so a merge refused on red checks still stores what
it read. Both tests are in `commands/pr/`: `triage-plan-ci.test.ts` and
`merge-plan-ci.test.ts`.

**`changes` is the one report table with no `outcome` column.** A
change note is about the diff, not about how the session ended, so
`store/changes.ts` passes `checkDispatch` a null outcome and only the
dispatch is checked; the session's verdict is in `task_reports` under
the same session id. Its rows are deduplicated per session by every
stored field — `level`, `area` and `summary` — as `triage` dedupes, not
by an artifact.

**`task_reports.outcome` holds `done` or `blocked` and nothing else.**
`recordTaskReport` (`src/report/record.ts`) writes only that closed-set
status into the column; a report's free-text `feedback` reaches no
queryable table at all. To recover what a past task actually said — the
exit codes it captured, the commands it ran — read `session_id` off its
`task_reports` row and open the matching
`~/.claude/projects/<project-slug>/<session-id>.jsonl`.

**`task_reports.skills_used` arrived at schema version 12**, an `ADD
COLUMN` holding the report's claim of skills used as a JSON array, in the
order written, duplicates kept and no name rewritten; its CHECK admits
NULL or an array and nothing else. `writeTaskReport` stores it from the
`TaskReport.skillsUsed` that `storeTaskReport` hands through
`recordTaskReport`. NULL is "not recorded" and never an empty list: a
row a version-11 store held reads NULL, and so does a write that leaves
the list out, while a report that listed no skill stores `[]`.
`readReportedSkills` (`store/reports.ts`) answers the list per row, the
rows in `ACROSS_STORES_ORDER`, NULL as null. A `SkillFact` reads it as `skillsUsed` after
mapping each name through `bareSkillName`, keeping each once in first-
seen order. It is the session's claim; comparing it with `skill_invocations`
(what the log shows) is the reader's job, not the writer's. Never called
by `rafa effort report --skills`, which reads `invoked` and never
`skillsUsed`. Adding the column moved two expectations, both in
`store/reports.test.ts`: the `COLUMNS` list and the whole-row `toEqual`.

**`preflight` is the one such table no task report fills.**
`store/preflight.ts` writes a run's checks in one transaction, one row
per check keyed by `(run_id, position)`, since a run can check one item
twice. No column says the run halted: a run halted when a required check
did not pass, and `readPreflightHalts` reads that off the rows.
`loop start` writes it through `start/preflight.ts` before any session,
and writes nothing for a run with no item to check. `rafa doctor` checks
the same items and writes no row.

**`findings` has two writers.** `store/tracker-refs.ts` keeps a filed
issue's reference in the row the dispatch's session holds under the text
its caller keys the recurrence by: it sets `tracker_ref` on that
session's row for the key, or inserts a row holding only the dispatch,
the key, the reference and the origin pair every insert stamps, and
keeps a reference already there. See `context/triage.md` for the key
a bug is looked up by and the two-step match.
`readTrackerRef` answers the newest reference stored under a key, in any
session: the last by `ACROSS_STORES_ORDER` (`store/origins.ts`), read
backwards so both sides of a merge answer the same row, which `seq` alone
would not. A reference that supersedes another, filed after the issue
under the key closed as completed, is written with `supersedes` naming
the old one and is inserted as a new row under the same key, never over
the old one, so `tracker_ref` stays `SET_ONCE` and a merge of two stores
keeps both rows (the `findings` entry of `store/merge-rules.ts`). One
session holds one row per key (`findings_by_artifact`), so a write
superseding the reference its own session's row holds is refused with a
`SupersedeInSessionRefusal`, nothing written; the migration that would
let it insert is #656's. `triage/triage.ts` keys by the bug's artifact
WITH the tracker file it was reported against, so its rows carry that key
rather than a bare artifact and never land on a report's finding. A caller that does
key by a bare artifact writes a report's findings first: a finding
written after a reference under the same session and artifact is skipped
as that row's duplicate. An inserted row reaches `progress.txt` as the
bullet `- artifact: <key>`.

**Read a plan's recorded debt back out of `findings` and
`out_of_scope_bugs`, keyed by `plan_stub` and ordered by `seq`.** That is
where a task's substance lands; `task_reports` holds no prose, as the row
above says. Select EVERY column rather than filtering on `kind`: a row
`store/tracker-refs.ts` inserted for a filed issue carries only the
dispatch, the key, the `tracker_ref` and its origin pair, leaving
`kind`, `what` and `signal` NULL, so a `where kind = ...` query
silently drops exactly the findings that were escalated. Measured
over rafa-63: 210 rows under the stub, 12 of them null-`kind`.

### Attribution

**`planStubFromPrompt` (`src/utils/plan-stamp.ts`) answers the FIRST
`ralph:plan=` stamp in a prompt.** Task and wrap-up prompts carry plan
text above the stamp the loop appends, so a plan that quotes a stamp
attributes its sessions to the quoted stub.

**A branch stub is not a queue id.** `QUEUE_ID` in
`src/effort/attribution.ts` is `/^(q\d+[a-z]?)(?:-|$)/`, so only a
`q`-prefixed leading token is read as one. A `rafa-<n>` stub carries
none and resolves by exact match alone, which is why the branch
`feat/rafa-21` matches no plan called `rafa-21-changelog-and-release`.
Write queue-id cases with `q`-prefixed stubs, and expect a `rafa-<n>`
branch stub to fall through to `match: none`.

**`effort collect` attributes by the plan stubs in `plan.dir`**, under
the repo root and `.rafa/plans` unless a config names another, when its
caller passes no `plansDir`.

### Tests over the store

**`collectEffort` writes the store under its `repoRoot`, and reads the
config there unless it is handed both `store` and `plansDir`.** A case
pointing `repoRoot` at the live sibling appends to the sibling's own
`.rafa/effort/` unless it also passes a `store` opened under a temp root
and `skills: null`, or uses a temp `repoRoot` with `plansDir` and
`readCommits` supplied. The parity suites pass the sibling's plans
directory as `plansDir` beside the store, so they attribute by the
sibling's roster and read no config. **Never run this branch's code
against `.rafa/effort/` directly.** Tests over the store open a copy under
a temporary root, or read the store through `readStoreRows` and pass no
path; both patterns keep the real `.rafa/effort/` untouched.

**A test opens stores under `tmpdir()` only, and the store throws
otherwise.** `guardTestProcess` (`store/location.ts`) runs before any file
or directory is made, at every open of either backend and at
`fix-schema`'s. In a process whose `Bun.main` ends in `.test.ts`, or whose
environment sets `RAFA_TEST=1`, a store path outside `tmpdir()` (as
spelled, or with the path and `tmpdir()` both read through their real
paths, a path not made yet through its nearest existing ancestor) throws `effort store: a test opened <path>, outside the temp
directory <tmp>; a test opens stores under tmpdir() only`. `runRafa` sets
`RAFA_TEST=1` and the suite's `TMPDIR` on its child. A SQLite read of a
file that does not exist opens nothing and so is not guarded; an NDJSON
read or append is guarded whether or not its file exists.

**Compare the two backends' rows by `JSON.stringify(row)`, paired by key
rather than by position.** `toEqual` ignores field order, and
byte-identical rows do not.
