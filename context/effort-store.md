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

`findings`, `blockers`, `out_of_scope_bugs`, `changes`,
`report_absences`, `task_reports`, `preflight` and `dispatches` are
SQLite-only and stay out of the port's row map. Each arrives as a new
`SQLITE_MIGRATIONS` entry, is written under the `sqliteStorePath` that
`store/sqlite.ts` exports, and lands in `effort.sqlite` whatever `store`
selects. A writer that can be left with nothing to insert goes through
`writeSqliteStore`, as `writeFindings`, `writeTriage`, `writeChanges`
and `writePreflightChecks` do, so an empty write on a store that exists
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
`reports.test.ts`, `preflight.test.ts`, `dispatches.test.ts` and
`changes.test.ts`, and the filter the version-5 case of
`preflight.test.ts` takes the later tables out with, beside the
version-7 filter of `changes.test.ts`.

**`out_of_scope_bugs.scope` is read, not copied.** Every other column of
these tables holds what a report wrote; `scope` holds what
`src/triage/machine-fault.ts` reads off the bug's `what` and `artifact`,
which `store/triage.ts` calls for each bug it stores: `machine` for a
fault of the machine the session ran on, `rafa` otherwise, and never
NULL. It arrived at schema version 9 as an `ALTER TABLE ... ADD COLUMN`,
the one migration that creates no table, so a row a version-8 store
already held reads NULL — stored before the reading existed. It is
outside `out_of_scope_bugs_by_entry` because it is a function of `what`
and `artifact`, which that index already holds, so a repeat of an entry
is still the duplicate it was and keeps the scope on the row. A column
added to one of these tables moves every COLUMN-list expectation, as a
new table moves the table lists: the `COLUMNS` map and the whole-row
case of `store/triage.test.ts` for this one.

**`dispatches` is written for every stored session, ahead of its
report.** `storeTaskReport` (`start/dispatch.ts`) writes one row keyed by
the session id, holding the block as written, each declared value the
parser could use and the flags the session was spawned with, whatever
became of the task, and then the report; a refused dispatch row stores no
report. No column holds the outcome: `task_reports` and `report_absences`
hold it under the same session id.

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
`.rafa/effort/` unless it also passes a `store` opened under a temp root,
or uses a temp `repoRoot` with `plansDir` and `readCommits` supplied. The
parity suites pass the sibling's `.plans/` as `plansDir` beside the store,
so they attribute by the sibling's roster and read no config.

**Compare the two backends' rows by `JSON.stringify(row)`, paired by key
rather than by position.** `toEqual` ignores field order, and
byte-identical rows do not.
