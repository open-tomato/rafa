## Effort store

`src/effort/store/` holds what `rafa effort collect` and the task-report
pipeline write: the `EffortStore` port (`store/types.ts`), an NDJSON and a
SQLite backend, and `selectEffortStore` (`store/index.ts`), which picks one
from `store` in `.rafa/config.yaml`, `sqlite` by default.

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

`findings`, `blockers`, `out_of_scope_bugs`, `report_absences` and
`task_reports` are SQLite-only and stay out of the port's row map. Each
arrives as a new `SQLITE_MIGRATIONS` entry, is written under the
`sqliteStorePath` that `store/sqlite.ts` exports, and lands in
`effort.sqlite` whatever `store` selects. A writer that can be left with
nothing to insert goes through `writeSqliteStore`, as `writeFindings`
and `writeTriage` do, so an empty write on a store that exists still
meets the schema check. `writeReportAbsence` always has its one row and
opens `withSqliteStore` directly. `writeTaskReport` always has its one
row too, and passes `writeSqliteStore` a count of one, which opens the
store as that direct call does. A new table moves every full table-list
expectation with it: two in `sqlite.test.ts`, one each in
`triage.test.ts`, `absences.test.ts` and `reports.test.ts`.

### Attribution

**`planStubFromPrompt` (`src/utils/plan-stamp.ts`) answers the FIRST
`ralph:plan=` stamp in a prompt.** Task and wrap-up prompts carry plan
text above the stamp the loop appends, so a plan that quotes a stamp
attributes its sessions to the quoted stub.

### Tests over the store

**`collectEffort` writes the store under its `repoRoot`.** A case pointing
`repoRoot` at the live sibling appends to the sibling's own `.ralph/`
unless it also passes a `store` opened under a temp root, or uses a temp
`repoRoot` with `plansDir` and `readCommits` supplied.

**Compare the two backends' rows by `JSON.stringify(row)`, paired by key
rather than by position.** `toEqual` ignores field order, and
byte-identical rows do not.
