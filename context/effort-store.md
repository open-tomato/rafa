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

### A store past this rafa

**A plan that adds a migration can lock its own loop out of the store.**
`migrateSchema` refuses a store past the version `SQLITE_MIGRATIONS` holds,
and every read and write goes through it. A task that runs the branch's
own code from its working tree against `.rafa/effort/effort.sqlite`
migrates the project's store, while the loop driving the plan is the older
installed runtime. From then on that runtime refuses the store, and the
task reports it collects are not stored. Seen on rafa-23 (2026-09-26): its
versions 10 and 11 reached the store through `rafa effort collect` run from
the branch, and the 0.18.0 loop stopped.

**`rafa effort fix-schema` repairs such a store**
(`src/effort/store/fix-schema.ts`). It builds `effort.sqlite.fix-<stamp>`
at this rafa's version, copies every table and column this rafa knows,
checks the row counts and `integrity_check`, and lists the tables and
columns only the newer schema holds. The original is then renamed to
`effort.sqlite.v<version>-<stamp>.bak`, whole, and the rebuild takes its
place. `--dry-run` deletes the rebuild instead, so it can be repeated and
runs beside a live loop; the swap refuses while a loop session is running
or paused. A newer schema that dropped a table or column this rafa writes
is not additive, and the repair refuses it rather than copy around it.

### Tables outside the port

`findings`, `blockers`, `out_of_scope_bugs`, `changes`,
`report_absences`, `task_reports`, `preflight`, `dispatches` and
`skill_invocations` are SQLite-only and stay out of the port's row map.
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
`changes.test.ts` and `skill-invocations.test.ts`, and the filter the
version-5 case of `preflight.test.ts` takes the later tables out with,
beside the version-6 filter of `dispatches.test.ts`, the two version-7
filters of `changes.test.ts`, and the version-11 filter of
`skill-invocations.test.ts`.

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
flags the session was spawned with, one row per session. The table has
three columns holding resolver and offer information: `resolver` (the skill
resolver the session ran under), `skills_offered` (the bare names of skills
its prompt offered), and `lessons_offered` (the ids of lessons its prompt
offered). Whatever became of the task, the dispatch is written ahead of the
task report; a refused dispatch row stores no report. A dispatch handed no
handout stores a NULL resolver beside two `[]` offers. No column holds the
outcome: `task_reports` and `report_absences` hold it under the same
session id.

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

**Compare the two backends' rows by `JSON.stringify(row)`, paired by key
rather than by position.** `toEqual` ignores field order, and
byte-identical rows do not.
