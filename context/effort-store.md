## Effort store

`src/effort/store/` holds what `rafa effort collect` and the task-report
pipeline write: the `EffortStore` port (`store/types.ts`), an NDJSON and a
SQLite backend, and `selectEffortStore` (`store/index.ts`), which picks one
from `store` in `.rafa/config.yaml`, `sqlite` by default.

### Where it lives

**Both backends write under `.rafa/effort/` in the project root.**
`EFFORT_STORE_DIR` in `src/effort/store.ts` spells the directory once, and
`effortStorePath` and `sqliteStorePath` (`store/sqlite.ts`) join it under
the root. It moved there from `.ralph/effort/` (Q20), and no backend and no
command reads a store left under `.ralph/effort/`: `rafa doctor` only
looks for the store's file names there, and warns while `.rafa/effort/`
holds none of them (`store/legacy.ts`). A test that plants or
opens a store file by path spells `.rafa/effort`; the `.ralph/effort` the
parity suites name is the sibling's own store, read through
`readStoreRows` and never written.

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

### Tables outside the port

`findings`, `blockers`, `out_of_scope_bugs`, `report_absences`,
`task_reports` and `preflight` are SQLite-only and stay out of the port's
row map. Each arrives as a new `SQLITE_MIGRATIONS` entry, is written
under the `sqliteStorePath` that `store/sqlite.ts` exports, and lands in
`effort.sqlite` whatever `store` selects. A writer that can be left with
nothing to insert goes through `writeSqliteStore`, as `writeFindings`,
`writeTriage` and `writePreflightChecks` do, so an empty write on a store
that exists still meets the schema check. `writeReportAbsence` always has
its one row and opens `withSqliteStore` directly, as `writeTrackerRef`
does. `writeTaskReport`
always has its one row too, and passes `writeSqliteStore` a count of
one, which opens the store as that direct call does.
`readTaskReportTallies` reads that table back for `rafa effort report`,
under the repo root whatever `store` selects, and opens nothing when the
file is absent; `readPreflightHalts` reads `preflight` back the same way.
A new table moves every full table-list expectation with it: two in
`sqlite.test.ts`, one each in `triage.test.ts`, `absences.test.ts`,
`reports.test.ts` and `preflight.test.ts`.

**`preflight` is the one such table no task report fills.**
`store/preflight.ts` writes a run's checks in one transaction, one row
per check keyed by `(run_id, position)`, since a run can check one item
twice. No column says the run halted: a run halted when a required check
did not pass, and `readPreflightHalts` reads that off the rows.
`loop start` writes it through `start/preflight.ts` before any session,
and writes nothing for a run with no item to check. `rafa doctor` checks
the same items and writes no row.

**`findings` has two writers.** `store/tracker-refs.ts` keeps a filed
issue's reference in the row the dispatch's session holds under the
bug's artifact: it sets `tracker_ref` on that session's finding, or
inserts a row holding only the dispatch, the artifact and the reference,
and keeps a reference already there. `readTrackerRef` answers the oldest
reference stored under an artifact, in any session. Write a report's
findings before its references: a finding written after a reference
under the same session and artifact is skipped as that row's duplicate.
An inserted row reaches `progress.txt` as the bullet
`- artifact: <artifact>`.

### Attribution

**`planStubFromPrompt` (`src/utils/plan-stamp.ts`) answers the FIRST
`ralph:plan=` stamp in a prompt.** Task and wrap-up prompts carry plan
text above the stamp the loop appends, so a plan that quotes a stamp
attributes its sessions to the quoted stub.

**`effort collect` attributes by the plan stubs in `plan.dir`**, under
the repo root and `.rafa/plans` unless a config names another, when its
caller passes no `plansDir`.

### Tests over the store

**`collectEffort` writes the store under its `repoRoot`, and reads the
config there unless it is handed both `store` and `plansDir`.** A case
pointing `repoRoot` at the live sibling appends to the sibling's own
`.rafa/effort/` unless it also passes a `store` opened under a temp root,
or uses a temp `repoRoot` with `plansDir` and `readCommits` supplied. The
parity suites pass the sibling's `.plans/` as `plansDir` beside the store,
so they attribute by the sibling's roster and read no config.

**Compare the two backends' rows by `JSON.stringify(row)`, paired by key
rather than by position.** `toEqual` ignores field order, and
byte-identical rows do not.
