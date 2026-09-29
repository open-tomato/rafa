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
in the backup alone. The original is then renamed to
`effort.sqlite.v<user_version>-<stamp>.bak`, whole, and the rebuild
takes its place. `--dry-run` deletes the rebuild instead, so it can be
repeated and runs beside a live loop and from a development build; the
swap refuses while a loop session is running or paused, and from a
development build before anything is built. A newer schema that dropped
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
`integrity_check` and the swap to removal on failure, are `rebuildAside`
(`src/effort/store/rebuild-aside.ts`), which takes the two file names
and the build from its caller and opens no store itself;
`SchemaFixRefusal` is its `RebuildRefusal`, and so is `effort migrate`'s
`MigrateRefusal`.

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
finds it current, then renames the original to
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
`migrations.lock.json` at the newest `v*` tag by version order through
`git show`, and fails a line changed or dropped since. The case is
skipped, its title naming why, when git, the tag or the lock at the tag
is absent. At v0.24.1 the lock is absent, since that release predates it.
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
path, access, 'open')` before `use`. A read of a current store writes nothing;
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
`merge_conflicts` each incoming row one could not settle. No writer
fills them yet.
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
and `readSessionBudgets` the `dispatches` rows carrying a budget.
`readTaskFinishes` (`store/task-finishes.ts`) reads the `done` rows of
`task_reports` and `report_absences` back the same way, for the rough ETA
of `rafa loop status`, and `readPlanChanges` (`store/changes.ts`) every
`changes` row under one plan stub, in append order, for a release step to
render.
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
and `out_of_scope_bugs` rows in append order, and every `plan_ci` reading
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
`readReportedSkills` (`store/reports.ts`) answers the list per row in
append order, NULL as null. A `SkillFact` reads it as `skillsUsed` after
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
the key and the reference, and keeps a reference already there.
`readTrackerRef` answers the oldest reference stored under a key, in any
session. `triage/triage.ts` keys by the bug's artifact WITH the tracker
file it was reported against, so its rows carry that key rather than a
bare artifact and never land on a report's finding. A caller that does
key by a bare artifact writes a report's findings first: a finding
written after a reference under the same session and artifact is skipped
as that row's duplicate. An inserted row reaches `progress.txt` as the
bullet `- artifact: <key>`.

**Read a plan's recorded debt back out of `findings` and
`out_of_scope_bugs`, keyed by `plan_stub` and ordered by `seq`.** That is
where a task's substance lands; `task_reports` holds no prose, as the row
above says. Select EVERY column rather than filtering on `kind`: a row
`store/tracker-refs.ts` inserted for a filed issue carries only the
dispatch, the key and the `tracker_ref`, leaving `kind`, `what` and
`signal` NULL, so a `where kind = ...` query silently drops exactly the
findings that were escalated. Measured over rafa-63: 210 rows under the
stub, 12 of them null-`kind`.

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
environment sets `RAFA_TEST=1`, a store path outside `tmpdir()` (or its
real path) throws `effort store: a test opened <path>, outside the temp
directory <tmp>; a test opens stores under tmpdir() only`. `runRafa` sets
`RAFA_TEST=1` and the suite's `TMPDIR` on its child. A SQLite read of a
file that does not exist opens nothing and so is not guarded; an NDJSON
read or append is guarded whether or not its file exists.

**Compare the two backends' rows by `JSON.stringify(row)`, paired by key
rather than by position.** `toEqual` ignores field order, and
byte-identical rows do not.
