# Trace: `c04-sqlite`

Coverage: 163 of 163 cluster members read, the 163 files `docs/survey/import-graph.json` lists for `c04-sqlite`; all 163 are tracked by `git ls-files`, and no tracked member was left unread. The 71 non-test members (68 source, 3 test support) were read for their module notes and exports; the 92 test files were read through the graph and `docs/survey/test-index.json` only.

The largest cluster in the import graph with no trace file once `trace-c01-github.md`, `trace-c02-active.md` and `trace-c03-config.md` exist: 163 files, 71 of them source or support and 92 tests, 645 edges inside it. The cluster is **the effort store and what is written into and read back out of it**: the SQLite backend and its migrations (`src/effort/store/sqlite.ts`, `migrations.ts`, `bring-forward.ts`, `schema-plan.ts`), the repairs and moves built on them (`fix-schema`, `migrate`, `copy`, `merge-store` and its `merge-*` parts, `move`, `rebuild-aside`), the store's identity and location (`store-meta`, `store-identity`, `origins`, `location`, `development-build`), one writer and reader per table (`findings`, `triage`, `changes`, `dispatches`, `preflight`, `plan-ci`, `reports`, `absences`, `skill-invocations`, `tracker-refs`, `task-finishes`), the `rafa effort` commands over them (seven), the report that rolls the rows up (`src/effort/report*.ts`, `skill-facts`, `skill-signals`, `recurrence`), the task report a session ends with (`src/report/`), and a handful of small neighbours (`src/runtime/identity.ts`, `src/cli/version.ts`, `src/utils/progress.ts`, `src/triage/machine-fault.ts`, `src/fixtures/`). Its hub is `src/effort/store/sqlite.ts` (80 in-cluster edges, `migrations.ts` second with 44); the highest betweenness belongs to `src/effort/store/merge-store.ts` (31,717, rank 14 of the whole graph), then `sqlite.ts` (7,008, rank 56) and `src/effort/report.ts` (6,380, rank 60).

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. Neither has landed, as `trace-c03-config.md` records: `src/steps/` and `src/flows/` do not exist, no source file imports `@open-tomato/define-config`, and `src/config-load.ts` still does its own merge. So every "present" below means present in today's shape, and every gap is what a cut has to change to reach the contract. This cluster is the nearest thing the repository has to a package already: `package.json` exports `./store` (`src/effort/store/index.ts`), and the two hub packages import it as `@open-tomato/rafa/store`.

## Members and folders

71 non-test members by folder:

| Folder | Files | Holds |
| --- | --- | --- |
| `src/effort/store` | 37 | the store: `sqlite.ts`, `migrations.ts`, `migration-shapes.ts`, `bring-forward.ts`, `schema-plan.ts`, `schema-report.ts`, `rebuild-aside.ts`, `development-build.ts`, `location.ts`, `legacy.ts`, `ndjson.ts`, `types.ts` (the port), `store-meta.ts`, `store-identity.ts`, `store-generation.ts`, `origins.ts`; the repairs `fix-schema.ts`, `migrate.ts`, `copy.ts`, `move.ts`; the merge `merge-store.ts`, `merge-union.ts`, `merge-conflicts.ts`, `merge-commit-gaps.ts`, `merge-rules.ts`; the table writers `findings.ts`, `triage.ts`, `changes.ts`, `dispatches.ts`, `preflight.ts`, `plan-ci.ts`, `reports.ts`, `absences.ts`, `skill-invocations.ts`, `tracker-refs.ts`, `task-finishes.ts`; `fixture-extract.ts` |
| `src/effort` | 12 | `store.ts` (the sibling's NDJSON module, not the port), `session-log.ts`, `commits.ts`, and the report: `report.ts`, `report-format.ts`, `report-budgets.ts`, `report-trend-read.ts`, `report-skills.ts`, `report-skills-format.ts`, `skill-facts.ts`, `skill-signals.ts`, `recurrence.ts` |
| `src/commands/effort` | 7 | `copy.ts`, `fix-schema.ts`, `import.ts`, `merge.ts`, `migrate.ts`, `move.ts`, `schema.ts` |
| `src/commands` | 2 | `doctor-effort-schema.ts`, `doctor-install.ts` |
| `src/effort/sync`, `src/fixtures`, `src/report` | 2 each | `file.ts` and `wire.ts` (the `file` sync strategy and the wire codec); `fixture-path.ts` and `scrub.ts`; `parse.ts` and `record.ts` (the `rafa:report` block and its recording) |
| `src/effort/store/testdata` | 2 | `merge-scenarios.ts`, `store-rows.ts` (support) |
| one file each | 5 | `src/cli/version.ts`, `src/runtime/identity.ts`, `src/triage/machine-fault.ts`, `src/utils/progress.ts`, `src/tests/merged-stores.ts` (support) |

The full member list, with the 92 test files, is the `members` array of `c04-sqlite` in `docs/survey/import-graph.json`. The cluster spans 15 folders and shares most of them with other clusters:

| Folder | Here | Of | The rest |
| --- | --- | --- | --- |
| `src/effort/store` | 81 | 86 | `c03-config` 3 (`settings.ts` and two tests), `c12-index` 1 (`index.ts`), `c16-store-sources.sweep.test` 1 |
| `src/effort` | 28 | 53 | `c05-sessions` 12, `c02-active` 5, `c03-config` 5, `c12-index` 2, `c10-index` 1 |
| `src/commands/effort` | 15 | 19 | `c06-command` 2 (`collect.ts`, `report.ts`), `c05-sessions` 2 (`dashboard.ts` and its test) |
| `src/effort/sync` | 5 | 9 | `c03-config` 4 (`select.ts`, `contact.ts` and tests) |
| `src/commands` | 4 | 86 | `c01-github` 29, `c03-config` 24, `c06-command` 11, `c05-sessions` 10, `c08-cli-capture` 6, `c11-frontmatter` 2 |
| `src/tests` | 7 | 188 | `c08-cli-capture` 71, `c02-active` 26, `c01-github` 25, and 15 more clusters |
| `src/triage` | 2 | 23 | `c10-index` 19, `c01-github` 2 |
| `src/utils` | 2 | 18 | `c02-active` 10, `c03-config` 4, `c07-index` 2 |
| `src/report` | 4 | 6 | `c02-active` 2 |
| `src/cli` | 2 | 22 | `c06-command` 20 |
| `src/runtime` | 2 | 4 | `c05-sessions` 2 |
| `src/claims`, `src/commands/claim` | 1 + 1 | 18, 9 | `c07-index` 15 and 8, `c01-github` 2 (one test each) |

`src/effort/store/testdata`, `src/fixtures` are whole in the cluster; `src/effort/store` is whole but for the one entry file, the settings file and a sweep test. Of the 15 folders, the odd ones are the two claims tests (`src/claims/device.test.ts`, `src/commands/claim/release-after-merge.test.ts`, which read the store's identity) and the `src/tests/` files, which spawn `rafa effort` commands.

## What crosses the boundary

Non-test imports leaving the cluster (87 edges, 32 distinct files; 65 of the 86 that start in a source file are value edges, 21 type edges), by the cluster they reach:

| Target cluster | Edges | Distinct files | Files a cut would have to give `c04-sqlite` access to |
| --- | --- | --- | --- |
| `c03-config` | 33 | 10 | `src/config.ts`, `src/config-load.ts`, `src/config-sections.ts`, `src/effort/collect.ts`, `src/effort/store/settings.ts`, `src/effort/sync/contact.ts`, `src/project/pre-init-dirs.ts`, `src/schema/tiers.ts`, `src/tiers/{resolve,skill-names}.ts` |
| `c05-sessions` | 20 | 8 | `src/commands/plan/plan-files.ts`, `src/effort/{report-args,report-trend,report-trend-format}.ts`, `src/loop/sessions.ts`, `src/pr/types.ts`, `src/project/{bin-path,scope}.ts` |
| `c06-command` | 11 | 1 | `src/cli/command.ts` |
| `c02-active` | 11 | 8 | `src/adapters/output/active.ts`, `src/commands/instinct/instinct-records.ts`, `src/effort/{attribution,classify}.ts`, `src/plan/blocks.ts`, `src/preflight/run.ts`, `src/start/serving.ts`, `src/utils/declaration.ts` |
| `c10-index` | 5 | 3 | `src/ports/index.ts`, `src/triage/{local-paths,triage}.ts` |
| `c01-github` | 2 | 2 | `src/commands/doctor-previous.ts`, `src/pr/git.ts` |
| `c12-index` | 2 | 1 | `src/effort/store/index.ts` |
| `c07-index` | 2 | 2 | `src/pr/checks.ts`, `src/schema/project-id.ts` |
| `c11-frontmatter` | 1 | 1 | `src/schema/frontmatter.ts` |

Non-test imports entering the cluster (92 edges, 38 distinct members) come from `c02-active` (20), `c10-index` (19), `c03-config` (17), `c06-command` (10), `c05-sessions` (10), `c12-index` (6), `c09-version` (5), `c07-index` (4) and `c08-cli-capture` (1). Unlike the settings cluster, which takes more than twice what it gives, this one is balanced (92 in, 87 out): a store is called by the loop and calls back into the config and the loop's records, so a cut leaves edges in both directions.

Links specific to this cluster:

- **The store's entry is outside it.** `src/effort/store/index.ts` (`selectEffortStore`, the `./store` subpath) is in `c12-index` with the two hub packages, because they import it; it and `src/effort/session-log-dirs.ts` send the six edges `c12-index` has into the cluster, and the entry is how the packages reach the engine.
- **The report block is a leaf the store and the loop both stand on.** `src/report/parse.ts` (668 lines, imports nothing) is imported by 14 non-test files outside, from `c02-active`, `c09-version` and `c10-index` (`start/commit.ts`, `start/background-wait.ts`, `start/triage.ts`, `plan/index.ts`, `release/changelog.ts`, `release/level.ts`, the triage readers and `commands/epic/close.ts`), and by the five store writers `findings.ts`, `changes.ts`, `reports.ts` (value) and `absences.ts`, `triage.ts` (type). Twelve outside test files import it, and 762 of the 908 tests reach it in the test index.
- **The store reads the loop's records.** `development-build.ts` and `migrate.ts` import `src/loop/sessions.ts` and `src/project/scope.ts` (`c05-sessions`) to refuse a swap while a loop runs; the three commands that swap (`fix-schema`, `merge`, `migrate`) import `loop/sessions.ts` too.
- **The adapter registry imports the backends.** `src/adapters/registry.ts` (`c03-config`) imports `sqlite.ts`, `ndjson.ts` and `sync/file.ts` as values, so selecting a store is a static import of every backend (`src/effort/store/index.ts` reads the registry back through `CORE_ADAPTER_REGISTRY`).

Test reach, from `docs/survey/test-index.json`: the 92 member tests have indexes from 0 to 130 with a median of 22; 14 are at 10 or below, 68 between 11 and 63, 8 between 64 and 127 and 2 at or above 128 (`src/commands/claim/release-after-merge.test.ts` at 128, `src/fixtures/fixture-guard.sweep.test.ts` at 130); the next four are 68 (`commands/effort/import.test.ts`, `effort/report-trend-read.test.ts`, `effort/report.test.ts`) and 66 (`tests/store-version-guard.test.ts`). 25 spawn a process, 18 of those through `src/tests/cli-capture.ts` (every `rafa effort` command test among them). The numbers that matter are not the cluster's own tests but who reaches the store: `sqlite.ts`, `types.ts`, `migrations.ts`, `merge-store.ts`, `location.ts` and `settings.ts` are each reached by 756 of the 908 tests, 715 from other folders, and the 756 are the very set that reaches `src/config-schema.ts`; `src/report/parse.ts` by 762; `store/index.ts` by 398 (the registry's set), `findings.ts` by 422 and `report.ts` by 341. A store test is cheap; a change to the port is not.

## Entry points

An entry point is a member imported from outside the cluster, or a command registered from it. 42 members are imported from outside the cluster, 38 of them by at least one non-test file. Seven registered commands are in the cluster; three more run an engine from it.

### Registered commands

Each is a default export `createXCommand()` of a `RafaCommand`, listed in `CORE_COMMANDS` (`src/commands/index.ts`, imports at lines 337–346, the array from 461). All build with a seams argument except `effort move`.

| Command | File | Outputs | Spends | Refusal exit |
| --- | --- | --- | --- | --- |
| `effort copy` | `src/commands/effort/copy.ts` | text, json | no | exit 1 on `RAFA_EFFORT_DIR` set, a directory with no store file, or a target that is a file or a non-empty directory; exit 2 on a read or write failure, with what it wrote removed |
| `effort schema` | `src/commands/effort/schema.ts` | text, json | no | with `--check`, exit 1 when this rafa would refuse the store or the location; exit 2 when the file cannot be read as a store; the report alone exits 0 |
| `effort fix-schema` | `src/commands/effort/fix-schema.ts` | text, json | no | exit 1 on every refusal, the live store untouched (a loop running or paused, a development build over a store it does not own, a store the schema does not let it rebuild) |
| `effort migrate` | `src/commands/effort/migrate.ts` | text, json | no | exit 1 on every refusal, as `fix-schema`, plus the migration's own `breaks` refusal |
| `effort merge` | `src/commands/effort/merge.ts` | text, json | no | exit 1 for a refusal the stores can be merged past; exit 2 for two stores that cannot be merged as they are (another project's, an NDJSON project) |
| `effort import` | `src/commands/effort/import.ts` | text, json | no | as `effort merge`, over the file strategy's pull |
| `effort move` | `src/commands/effort/move.ts` | text, json | no | exit 1 on every refusal: not a `store: ndjson` project, a bad `--to`, a development build, a failed count check |

The seven share `src/commands/plan/plan-files.ts` (`c05-sessions`) to resolve the project and its config (`resolveProjectConfig`), `src/cli/command.ts` (`c06-command`) for `RafaCommand` and `CommandExit`, and `merge.ts` exports `mergeTargetPath`, `mergeRefusalExit` and `renderMerge` for `import.ts` to reuse, so those two are one definition in two files. Two doctor readings are registered from the cluster's files but belong to `rafa doctor`, not to a command: `doctor-effort-schema.ts` (the store's schema row, over `readSchemaReport`) and `doctor-install.ts` (the install rows, over `legacy.ts`); both are called only from `src/commands/doctor.ts` (`c03-config`).

### Commands whose engine is in the cluster

| Command | Definition (outside) | Engine (inside) | What the definition passes |
| --- | --- | --- | --- |
| `effort report` | `src/commands/effort/report.ts` (`c06-command`), through `wrapPhaseZeroCommand` | `src/effort/report.ts` (798 lines), `report-format.ts`, `report-skills.ts`, `report-budgets.ts`, `report-trend-read.ts` | the line's words; the argv parser (`src/effort/report-args.ts`) and the trend and format readers (`report-trend.ts`, `report-trend-format.ts`) are in `c05-sessions` |
| `effort dashboard` | `src/commands/effort/dashboard.ts` (`c05-sessions`) | `src/effort/dashboard.ts` (`c05-sessions`) over `report.ts`, `report-skills.ts`, `report-trend-read.ts` | the flags; it reads this cluster and owns none of it |
| `effort collect` | `src/commands/effort/collect.ts` (`c06-command`) | `src/effort/collect.ts` (`c03-config`) over `session-log.ts` and `commits.ts` here | the line's words and the project root |

`trace-c03-config.md` places `src/commands/effort/collect.ts` in `c04-sqlite`; the graph puts it in `c06-command`, and the engine it calls is in `c03-config`. This cluster supplies the readers of that engine (`session-log.ts`, `commits.ts`) and the store it appends to.

### Other callers that the cluster serves

| Caller (cluster) | Calls | Members used |
| --- | --- | --- |
| `storeTaskReport` (`src/start/dispatch.ts`, `c02-active`) | one dispatch row, then the report's rows | `store/dispatches.ts` (`writeDispatch`), `report/record.ts` (`recordTaskReport`, `describeTaskReportRecord`) |
| the loop's task commit and wait (`src/start/commit.ts`, `background-wait.ts`, `c02-active`) | the report reader | `report/parse.ts` (`parseReport`) |
| `renderProgressForDispatch` (`src/start/dispatch.ts`, `src/start.ts`) | `progress.txt` rendered from the stored findings | `utils/progress.ts` (`writeProgress`, `PROGRESS_CAP_BYTES`) |
| the loop's preflight (`src/start/preflight.ts`, `c02-active`) | a read-only schema reading, then one row per check | `store/schema-report.ts` (`readSchemaReport`, `unknownAdditive*`), `store/preflight.ts` (`writePreflightChecks`), `store/location.ts` (`effortStoreDir`), `store/sqlite.ts` (`SQLITE_STORE_FILE_NAME`) |
| the loop's triage (`src/start/triage.ts`, `src/triage/*.ts`, `c10-index`) | the stored findings and the tracker reference for a bug | `store/findings.ts`, `store/tracker-refs.ts`, `report/parse.ts`, `triage/machine-fault.ts` |
| `pr merge` and `pr triage` (`c06-command`, `c07-index`) | the plan's CI row | `store/plan-ci.ts` |
| the release guard and stage (`src/release/guard.ts`, `src/start/release-stage.ts`, `src/commands/release/status.ts`, `c09-version`) | the change notes of a plan | `store/changes.ts` |
| `rafa loop status` (`src/commands/loop/loop-sessions.ts`, `c05-sessions`) | when each task finished, for the ETA | `store/task-finishes.ts` |
| `rafa epic close` (`c10-index`) | the epic's cost and findings | `effort/epic-cost.ts` (`c10-index`) over `store/types.ts`, `report-format.ts`, `commits.ts`; `store/findings.ts` |
| the adapter registry (`src/adapters/registry.ts`, `c03-config`) | the core store and sync adapters | `store/sqlite.ts`, `store/ndjson.ts`, `sync/file.ts` |
| device claims (`src/claims/device.ts`, `c07-index`) | the store's identity | `store/merge-store.ts`, `store/sqlite.ts`, `store/store-meta.ts` |
| the hub packages (`c12-index`) and `src/ports/index.ts` (`c10-index`) | the port, the wire codec and the merge | `store/index.ts`, `store/merge-store.ts`, `store/types.ts` |
| `rafa doctor` (`c03-config`) | the legacy-store row, the version | `store/legacy.ts`, `cli/version.ts` (also `src/cli/dispatch.ts`, `src/notices/run.ts`, `src/commands/update/current.ts`) |
| `rafa effort report` and the dashboard (`c05-sessions`) | the roll-up | `effort/report.ts`, `report-format.ts`, `report-skills.ts`, `report-trend-read.ts` |

### Most imported from outside

The members with the most non-test importers outside the cluster:

| Member | Non-test importers | Test importers |
| --- | --- | --- |
| `src/report/parse.ts` | 14 | 12 |
| `src/effort/store/types.ts` | 7 | 8 |
| `src/effort/store/findings.ts` | 7 | 3 |
| `src/effort/session-log.ts` | 6 | 1 |
| `src/effort/report.ts` | 5 | 3 |
| `src/effort/store/sqlite.ts` | 4 | 21 |
| `src/cli/version.ts` | 4 | 2 |
| `src/effort/store/changes.ts` | 3 | 6 |
| `src/effort/store/merge-store.ts` | 3 | 1 |
| `src/effort/report-format.ts` | 3 | 0 |
| `src/effort/commits.ts` | 2 | 2 |
| `src/effort/store/ndjson.ts` | 2 | 1 |

`parse.ts` leads because the `rafa:report` block is read by everything that acts on a task's result, not only by the store. `session-log.ts` is the reader of Claude Code's session logs, used by the collector and the classifier (`attribution.ts`, `classify.ts`) and by `session-log-dirs.ts` and `start/loop-events.ts`: it sits here because `report.ts` and `store/types.ts` import its row types, not because it stores anything. `cli/version.ts` is 24 lines of version text and is here because `bring-forward.ts` and `development-build.ts` write it into the migration log.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **partial** | 7 `RafaCommand` definitions here (`effort copy`, `schema`, `fix-schema`, `migrate`, `merge`, `import`, `move`); `effort report`, `dashboard` and `collect` run engines from here and are defined in `c06-command`, `c05-sessions` and `c06-command` | `run` is `run(context: RafaContext): Promise<void>`, not `run(ctx, options) → { outcome, context?, message? }`; every refusal is a thrown `CommandExit`; registration is a central static import in `src/commands/index.ts`; the `effort` subject is split over three clusters |
| Steps with guards | **partial** | the step-shaped units are the store writers and readers the loop calls (`dispatches.ts`, `report/record.ts` with the five writers it calls, `preflight.ts`, `schema-report.ts`, `plan-ci.ts`, `changes.ts`, `task-finishes.ts`) and `utils/progress.ts`; guards are code inside them (`schema-plan.ts`, `development-build.ts`, `location.ts`, `rebuild-aside.ts`) | no registry, no step id, no guard class declared, no `expect`, no `ctx.answered`; the loop calls the units from `src/start/dispatch.ts`, `src/start/preflight.ts` and `src/start.ts` in `c02-active` |
| Config section | **partial** | `store`, `effort.busyTimeoutMs` and `effort.sync` in `src/config-schema.ts` (`c03-config`), with `StoreBackend`, `STORE_BACKENDS` and `SyncStrategy` in `src/config.ts`; the one value the store reads is `activeStoreSettings()` in `src/effort/store/settings.ts` (`c03-config`) | no `config-schema-effort.ts`, no section of this cluster's own: three keys in two sections it does not declare, and a module-level setter that `loadConfig` calls as a side effect |
| Flows | **partial** | nine multi-step paths the cluster drives end to end (below), six of them one function of `src/effort/store/` each | each is a hand-ordered function chain; no flow list, no step id to drop or swap; `--dry-run` exists on four commands as a built-then-deleted copy, not a flow walk |

### Commands

All seven satisfy the superset shape `commandProblem` checks (`subject`, `action`, `summary`, `flags`, `examples`, `outputs`); none declares `spends`. Four things a package has to take on:

- The `RafaCommand` type, `RafaContext`, `CommandExit` and the output events are in `c06-command` (`src/cli/command.ts`); the 11 edges into it from this cluster are that one file, and every command reads `context.output`, `context.flags` and `context.project`.
- Every command resolves its project and config through `src/commands/plan/plan-files.ts` (`c05-sessions`), a file named for plans: `copy`, `schema`, `fix-schema`, `migrate`, `merge`, `import` and `move` all import it for `resolveProjectConfig` and the project root. A package that owns the store commands has to import a plan file or the helper has to move to a leaf.
- The `effort` subject is held in three clusters: `copy`, `schema`, `fix-schema`, `migrate`, `merge`, `import`, `move` here (7), `collect` and `report` in `c06-command` (the phase-0 commands `wrapPhaseZeroCommand` builds), and `dashboard` in `c05-sessions`. `CORE_SUBJECTS` in `src/commands/index.ts` (line 419) names one `effort` subject with one summary for all ten.
- Two commands pass the loop's records: `fix-schema`, `merge` and `migrate` call `loop/sessions.ts` to refuse a swap under a running loop and take a `RuntimeIdentity` from `src/runtime/identity.ts` (here) for the development-build refusal.

### Steps with guards

Nothing here is a registered step. These are the units the cluster contributes to a loop run or a command, with the guard that decides each and the class #119's vocabulary would give it. The classes are an assignment from `docs/workflow-checks.md` §2 and §5 and the source; no code declares them. "Behaviour" means no setting or flag turns the refusal off.

| Step (today's unit) | File | Guard that decides it | Class |
| --- | --- | --- | --- |
| open the store | `src/effort/store/sqlite.ts` (`openSqliteStore`), `bring-forward.ts` (`bringForward`), `schema-plan.ts` (`planSchema`) | a store past this rafa (an unknown breaking migration, an edited one, a gate mismatch, a pre-log store past the catalogue) refuses every read and write with its own next step; an unknown additive migration is read and written as it is | 🔒 |
| development build refuses a live store | `src/effort/store/development-build.ts` (`refuseUnownedDevelopmentWrite`) | a checkout's code that would adopt or apply a migration on a store it does not own is refused before anything is written; passed by pointing `RAFA_EFFORT_DIR` at a copy (`rafa effort copy`) | 🔒 |
| store location | `src/effort/store/location.ts` (`effortStoreDir`, `readEffortDirOverride`, `guardTestProcess`) | a relative `RAFA_EFFORT_DIR`, one resolving to the project's own store (symlinks and `..` included), and a test process opening any store but its own are refused | 🔒 |
| schema reading at preflight | `src/effort/store/schema-report.ts` (`readSchemaReport`), run from `src/start/preflight.ts:628` | one warning for each unknown additive migration; a store this rafa refuses prints nothing here; one that cannot be read is one warning; never halts | reading |
| preflight rows | `src/effort/store/preflight.ts` (`writePreflightChecks`), run from `src/start/preflight.ts:638` | rows that could not be stored halt the run (exit 1), as a failed required item does | 🔒 |
| dispatch row | `src/effort/store/dispatches.ts` (`writeDispatch`), run from `src/start/dispatch.ts:812` | refuses a store past this rafa; a throw is caught in `storeTaskReport`, which prints "was not stored" and answers `false` | 🔒 |
| report recording | `src/report/record.ts` (`recordTaskReport`) over `findings.ts`, `triage.ts`, `changes.ts`, `reports.ts`, `absences.ts` | a report writes its four lists and a status row, no report writes one absence row, never both; each writer in its own transaction and deduplicated per session; a writer that refuses throws and is not caught here | behaviour |
| report reading | `src/report/parse.ts` (`parseReport`) | takes any string and never throws: answers the report, or an explicit record of why there is none, so a session that reported nothing is a row and not a refusal | reading |
| progress render | `src/utils/progress.ts` (`writeProgress`), run from `renderProgressForDispatch` (`src/start/dispatch.ts:680`) | the file is replaced whole, and a store with no finding for the plan renders it empty; an over-cap render drops findings with a warning; a store that cannot be read answers `false` with the file left as it was, and the caller stops the run before the dispatch | 🔒 |
| plan CI row | `src/effort/store/plan-ci.ts` | records what the checks read, for which plan, on which head, when (`recordPlanCi`, called from `src/commands/pr/merge.ts:571`); read by `effort report --skills` | reading |
| fix, migrate, merge, import | `rebuild-aside.ts` (`rebuildAside`) with `fix-schema.ts`, `migrate.ts`, `merge-store.ts` | a swap is refused while a loop record under the project reads `running` or `paused`, from a development build before anything is built, over a failed row-count check or `integrity_check`, and for another project's store; a failed swap leaves the store as it was with the build and the backup named | 🔒 |
| move to SQLite | `src/effort/store/move.ts` (`moveToSqlite`) | counts checked before `store: sqlite` is written to the config; refused from a development build over a store it does not own | 🔒 |
| change notes read | `src/effort/store/changes.ts` | read by the release guard, `release status` and the release stage; a plan whose sessions wrote none reads as none | reading |

The ⚠️ class has no home and no user in this cluster: none of the `dangerous.*` keys is read here. `RAFA_EFFORT_DIR` is an environment variable, kept out of the config deliberately ("so that it never moves the loop's own store", `context/effort-store.md`), so the one pass of a 🔒 guard here (the development-build refusal) is not a setting a package's config layer could drop or name in `passedBy`; a cut has to decide whether the variable becomes the contract's `passedBy` or stays outside it. No unit of this cluster is a 🧭 guard: no setting turns any refusal into a choice.

Consent: no unit of this cluster asks a question. `fix-schema`, `migrate`, `merge`, `import` and `move` write after their command line, with `--dry-run` as the only switch before a swap, and none reads a typed answer; `effort copy` writes into a new directory and refuses an existing one.

### Config section

The cluster does not declare any of the config it reads; `src/config-schema.ts` (`c03-config`) does. Three keys are read here, and one environment variable stands in for a fourth.

| Key | Default | Declared in | Read here by |
| --- | --- | --- | --- |
| `store` | `sqlite`, one of `STORE_BACKENDS` (`ndjson`, `sqlite`) | `src/config-schema.ts`, with `StoreBackend` and `STORE_BACKENDS` in `src/config.ts`; settable on the command line (`cli: true`) | `store/index.ts` (`selectEffortStore`, over `Pick<RafaConfig, 'store'>`), `commands/effort/merge.ts` and `import.ts` (`resolveProjectConfig(...).store`), `store/move.ts` (writes the key through `parseConfigText` and `configFilePath`), `store/merge-store.ts` and `sync/file.ts` (the type) |
| `effort.busyTimeoutMs` | 5000, a whole number from 1 to 60000 | `src/config-schema.ts` (`effortBusyTimeoutMs`, reader `busyTimeoutMs`) | `store/settings.ts` (`setActiveStoreSettings`, the module-level value), then `sqlite.ts`, `copy.ts`, `schema-report.ts` and `sync/wire.ts` through `activeStoreSettings()` |
| `effort.sync` | `local`, one of `SYNC_STRATEGIES` | `src/config-schema.ts` (`effortSync`) | not read here; `sync/select.ts` and `sync/contact.ts` (`c03-config`) read it, and `commands/effort/import.ts` documents it |
| `loop.worktreeDir` | `.rafa/worktrees` | `src/config-schema.ts` | not read here; `effort/collect.ts` (`c03-config`) passes it to `session-log-dirs.ts` for the logs this cluster's rows come from |
| `RAFA_EFFORT_DIR` | unset | not a key | `store/location.ts`, `start/run-config.ts` (`c02-active`), `store/development-build.ts`, `store/copy.ts` |

So the slice is a top-level key (`store`) and the two keys of the `effort` section (`effort.busyTimeoutMs`, `effort.sync`), three of 64 settings in 26 sections that has no file of its own: the five section files (`config-schema-hub.ts`, `-release.ts`, `-tests.ts`, `-triage.ts`, `-wrap-up.ts`) are the shape a section would take, and `effort` is not among them. The values are folded into `RafaConfig`, `CONFIG_DEFAULTS` and `SETTINGS` as `trace-c03-config.md` records for every section. Two things a cut has to settle: the busy timeout reaches the store as a side effect (`loadConfig` calls `setActiveStoreSettings`, so any command that opens a store before loading the config opens it with the default, and a test that sets it leaks it to the next), and `StoreBackend` is a type defined in `src/config.ts` that `store/index.ts` re-exports as a public name of `./store`, so the package's entry depends on the config module for one of its own types.

Tests: `store/settings.test.ts` and `store/preflight.test.ts` sit in `c03-config` because they import the config; the merge's rules are held by `src/effort/store/merge-rules.sweep.test.ts` (one of the `tests.alwaysRun` sweeps) and `store-sources.sweep.test.ts` (`c16-store-sources.sweep.test`, a one-file cluster of its own that reads the sources as text).

### Flows

Multi-step paths the cluster drives end to end. Each is an ordered chain of functions with a refusal or a reading between steps and no flow declaration.

1. **Opening the store:** the location (`effortStoreDir`, `RAFA_EFFORT_DIR` checked, the test guard) → the file opened with the busy timeout → `bringForward` reads `schema_migrations` and the legacy gate → `planSchema` decides use or refusal (seven reasons) → a development build over a store it does not own is refused → the pending named migrations applied, each logged with `applied_by` → the store's identity row minted or kept and the generation rotated (`store-meta.ts`, `store-identity.ts`, `store-generation.ts`). `openSqliteStore` in `src/effort/store/sqlite.ts`, through `selectEffortStore` in `store/index.ts` for the config's backend.
2. **Recording a task report:** the captured output → `parseReport` (a report or an absence) → findings → blockers and out-of-scope bugs → change notes → the status row, or one absence row, each in its own transaction → the notes and warnings printed → the lessons pushed to the learning port (outside). `recordTaskReport` in `src/report/record.ts`, called by `storeTaskReport` after `writeDispatch`.
3. **Preflight storage:** the schema read-only reading and its warnings → `runPreflight` over every item (`c02-active`) → one row per check, in the SQLite store whatever `store` selects → a halt on a failed required item or on rows that could not be stored. `writePreflightChecks` in `src/effort/store/preflight.ts`; `readPreflightHalts` reads the halted runs back for `effort report`.
4. **`effort fix-schema`:** the plan (`planSchema`, asked for a write) → a refusal or a rebuild of the store beside it through `bringForward` with `builtAside` → table and column copy, row counts, `integrity_check`, the plan finds it current → `VACUUM INTO` the backup → rename over the store; `--dry-run` deletes the rebuild. `fixStoreSchema` in `src/effort/store/fix-schema.ts` over `rebuildAside`.
5. **`effort migrate`:** the plan as the `migrate` caller → a copy built beside the store with `vacuumInto` → brought forward → counts, `integrity_check`, plan current → backup → swap through `rebuildAside`; refused under a running loop and from a development build. `migrateStore` in `src/effort/store/migrate.ts`.
6. **`effort merge` and `effort import`:** another store's file read (or pulled through the `file` strategy) → project and backend checks → a copy of this store built beside it → the union of every `merged` table's rows with origin stamps → each matched pair's edited fields settled by rule, the rest recorded in `merge_conflicts` → commit gaps recomputed → counts and `integrity_check` → whole-file backup → swap; `--dry-run` deletes the build. `mergeStore` in `src/effort/store/merge-store.ts` (502 lines), `merge-union.ts`, `merge-conflicts.ts`, `merge-commit-gaps.ts`, rules in `merge-rules.ts`.
7. **`effort move --to=sqlite`:** an NDJSON project's sessions and commits appended to its SQLite store → counts checked → `store: sqlite` written to `.rafa/config.yaml`, every other line kept. `moveToSqlite` in `src/effort/store/move.ts`.
8. **`effort report`:** the roll-up per plan from the store's session and commit rows → task reports tallied by plan, status and outcome → halted preflights listed → with `--skills`, the fact rows joined from the SQLite-only tables and the signals and recurrence computed → with `--trend`, the trend and loop segments (`c05-sessions`) → a pull from the hub first through `effort/sync/contact.ts` (`c03-config`). `buildReport` and `readSkillsReport` in `src/effort/report.ts`, `report-skills.ts`, `skill-facts.ts`, `skill-signals.ts`, `recurrence.ts`.
9. **Copy and schema reading for branch code:** `effort copy` (a `VACUUM INTO` on a read-only connection, or a file copy for NDJSON, into `.rafa/scratch/effort-<stamp>/`, then the `RAFA_EFFORT_DIR=` line) → `effort schema` against the copy (read-only, `Next safe step:`). `copyEffortStore` in `src/effort/store/copy.ts` and `readSchemaReport` in `store/schema-report.ts`.

## Gaps

Every export that is missing or partial, with the file a cut would have to change. Gaps 1 to 3 are the contract itself and would be the same for any cluster; gaps 4 to 15 are specific to this one.

1. **No `run(ctx, options)` for the cluster's commands** (commands, partial). `run` takes `RafaContext` and returns `Promise<void>`. A cut changes `src/cli/command.ts` (the type) and the seven files under *Registered commands*; for the three commands whose definition is outside, `src/commands/effort/report.ts` and `collect.ts` (`c06-command`) and `src/commands/effort/dashboard.ts` (`c05-sessions`) have to move with `copy` and the others so that the subject is one package's.
2. **No step registry or guard class** (steps, missing). Guards are code inside the units. A cut adds the registry (`src/steps/registry.ts`, not yet present) and moves each guard in the *Steps with guards* table into a step: `src/effort/store/sqlite.ts` and `bring-forward.ts` (open), `development-build.ts`, `location.ts`, `rebuild-aside.ts`, `preflight.ts`, `dispatches.ts` and `src/report/record.ts`. The `required` set a loader needs is every row marked 🔒 above; no file of the cluster says today which of its refusals those are, and `planSchema`'s seven reasons would be seven outcomes of one step.
3. **No consent in the context** (steps, missing). Nothing here asks, so a cut owes it nothing on the read side; the commands take `--dry-run` and `--to` as flags, which stay flags.
4. **No config section of its own** (config, partial). `store`, `effort.busyTimeoutMs` and `effort.sync` sit in `src/config-schema.ts`; a cut adds a section file for `effort` and a home for the top-level `store`, folds it into `SETTINGS` as the five existing section files are, and moves `StoreBackend`, `STORE_BACKENDS` and `SyncStrategy` out of `src/config.ts` so that `src/effort/store/index.ts`, `merge-store.ts`, `move.ts` and `sync/file.ts` stop importing the config module for their own types. `move.ts` also reads and writes `.rafa/config.yaml` itself (`configFilePath`, `parseConfigText`), a second place the config's file format lives besides `src/config-load.ts`; #118's `createLoader` would have to give it a writer, or the move stays in the config package.
5. **The busy timeout is a module-level global set by `loadConfig`** (config, partial; cut boundary). `src/effort/store/settings.ts` (`c03-config`) holds `activeStoreSettings()` and is read by `sqlite.ts`, `copy.ts`, `schema-report.ts` and `sync/wire.ts`; `src/config-load.ts` calls the setter. A package that owns the store and not the config needs the timeout as an argument of the opener, or owns `settings.ts` and exposes the setter; today an open before a config load uses `CONFIG_DEFAULTS.effortBusyTimeoutMs`, which `settings.ts` imports from `src/config.ts`, so the store package depends on the config module for a number.
6. **The store's entry is in another cluster from its engine** (cut boundary). `src/effort/store/index.ts` is in `c12-index` with `packages/rafa-hub` and `packages/rafa-sync-service`; the export a package would make is `./store`, which exists and exports the port, both openers, `mergeStore`, the wire codec and the key projections, and not a command, a step, a flow or a config section. A cut keeps `./store` as the package entry, adds the four exports to it, and has the two hub packages keep importing it by name. The two packages' non-test files import only `./store` (37 imports) and `./ports` (4), so they are the proof that the boundary holds; any new export must not pull the commands through it.
7. **The adapter registry imports the backends** (cut boundary). `src/adapters/registry.ts` (`c03-config`) imports `openSqliteStore`, `openNdjsonStore` and `createFileSync` as values (lines 128–131), and `store/index.ts` reads the registry back (`CORE_ADAPTER_REGISTRY.find('store', …)`). That is the one cycle between this cluster and its entry, and it is why the registry, the config and every test that reaches them reach the SQLite file. A cut either has the store package register its own adapters (as an add-on does through `src/modules/`) and the registry import the package, or keeps the registry in the package.
8. **The task report is not the store's** (cut boundary). `src/report/parse.ts` has 14 non-test importers outside the cluster and is value-imported by `findings.ts`, `changes.ts` and `reports.ts`; `record.ts` is the one place store and loop meet and has one caller (`src/start/dispatch.ts`). A cut moves `parse.ts` to a package both sides import (the `rafa:report` contract is what #119's `report` is closest to), or has the writers take the parsed shape as their input and drops the three value imports; `src/triage/machine-fault.ts` (imports `parse.ts`) goes with `parse.ts`, and `src/utils/progress.ts` goes with whichever package owns `progress.txt`.
9. **The writers reach into loop domains** (cut boundary). `store/plan-ci.ts` imports `src/effort/attribution.ts` (`c02-active`) and `src/pr/checks.ts` (`c07-index`) as values and `src/pr/types.ts` (`c05-sessions`); `store/preflight.ts` imports `src/config.ts` and `src/preflight/run.ts` (`c02-active`, type); `store/store-identity.ts` imports `src/pr/git.ts` (`c01-github`) and `src/schema/project-id.ts` (`c07-index`); `store/dispatches.ts` imports `src/utils/declaration.ts` (`c02-active`, type); `store/types.ts` imports `src/effort/attribution.ts` and `src/effort/classify.ts` (type); `store/tracker-refs.ts` imports `src/ports/index.ts` (`c10-index`, type). A cut either moves those files down or hands the values in as arguments; `attribution.ts` (618 lines) is the heavy one, imported by `plan-ci.ts` by value, and is in `c02-active`.
10. **The store reads the loop's records to refuse a swap** (cut boundary). `development-build.ts` and `migrate.ts` import `src/loop/sessions.ts` and `src/project/scope.ts` (`c05-sessions`); `fix-schema.ts` and `merge.ts` commands do too. A cut passes the loop-liveness reading in as a seam, so that the store does not import the loop, as `PreflightWriterSeams` does for the clock; the commands under `src/commands/effort/` supply it.
11. **`src/effort/store.ts` and `src/effort/store/` are two different stores** (cut boundary). The sibling's NDJSON module (`src/effort/store.ts`, 347 lines, `EFFORT_STORE_DIR`, `STORE_FILE_NAMES`) has its own `openEffortStore`, `EffortRowKind` and `AppendResult`, and is imported by `ndjson.ts`, `store/copy.ts`, `legacy.ts`, `location.ts` and the `copy` command. `context/effort-store.md` says to import from `./store/index.js`, never from `./store.js`; a cut needs the NDJSON file names and the directory constant in the store package and the sibling module either folded or left behind with its one remaining caller.
12. **`effort report` is in three clusters and calls the config and the collector** (steps and flows, partial). `report.ts` (798 lines, two under the soft ceiling) imports `loadConfig`, `src/effort/collect.ts`, `src/effort/sync/contact.ts` (`c03-config`), `src/start/serving.ts` and `src/effort/classify.ts` (`c02-active`), `report-args.ts` (`c05-sessions`) and `src/adapters/output/active.ts`; `report-trend-read.ts` imports `loadConfig`, `config.ts` and `store/index.ts`. A package that owns the report needs a pull seam in place of `contact.ts`, the tier reading in place of `start/serving.ts` (`resolveSessionTiers`, which the skills report calls), and the trend, the argv parser and the dashboard (`c05-sessions`, eight files) moved with it; none of it is the store.
13. **The doctor's two readings and the version are small and shared** (steps and flows, partial). `doctor-effort-schema.ts` and `doctor-install.ts` are called only by `src/commands/doctor.ts` (`c03-config`), the aggregator `trace-c03-config.md` lists as its gap 8; a cut makes each a contribution to the doctor's list from the package that owns the reading. `src/cli/version.ts` is imported by `bring-forward.ts` and `development-build.ts` (the version a migration is logged with) and by `src/cli/dispatch.ts`, `src/notices/run.ts` and `src/commands/update/current.ts` elsewhere, so it is a leaf both sides read, as `src/runtime/identity.ts` is (nine non-test importers, all in the cluster).
14. **`--dry-run` exists, and is not the contract's** (flows, partial). `fix-schema`, `migrate`, `merge` and `import` take `--dry-run` and implement it as a build beside the store that is then deleted (`rebuildAside`'s `dryRun`), so a dry run does the work and removes the evidence; `move` and `copy` have none (`move` writes the config file, `copy` writes a directory). #119's `--dry-run` is a `ctx.dryRun` walk that reports `would-run | already | would-refuse(<guard>) | would-ask`. A cut changes `rebuild-aside.ts` to report the planned outcome without building where the plan alone decides (`planSchema` already answers `current` and `behind` with no build), and gives `move.ts` and `copy.ts` a `would-run`.
15. **A tool and its fixtures live in the production folder** (cut boundary). `src/effort/store/fixture-extract.ts` (656 lines) is imported by no other member and is run by `scripts/extract-merge-fixture.ts`; it brings `src/fixtures/scrub.ts` and `fixture-path.ts` into the cluster (`fixture-path.ts` imports and is imported by nothing but tests), the two files of `src/effort/store/testdata/` and `src/tests/merged-stores.ts` are support for the merge's suites, and `src/fixtures/fixture-guard.sweep.test.ts` is the cluster's highest test (index 130). A cut moves the extractor, the scrub and the two testdata files to a test-support or tooling package, so that the store's package ships without them and no test's index counts them as a folder; `src/tests/merged-stores.ts` goes with the merge.
16. **The tests reach the whole tree through the store** (cut boundary). Of the 92 member tests, two are at or above 128 and 25 spawn a process (18 through `src/tests/cli-capture.ts`); six store files are each reached by 756 tests. A cut keeps the epic's fourth criterion only if those 756 tests import the store as one folder and the config as one folder, rather than the 30-odd files of the two clusters; `src/commands/claim/release-after-merge.test.ts` and `src/claims/device.test.ts` are claims tests that sit here because they reach the store's identity, and move with the claims, not with this package.

## Cut order this implies

The cluster has two lines through it that a cut can use. The inner one is the store itself: `types.ts`, `sqlite.ts`, `migrations.ts`, `bring-forward.ts`, `schema-plan.ts`, `rebuild-aside.ts`, the merge parts and the table writers already form a folder whose only imports out are the ones gaps 4, 5, 9 and 10 list (the config's three values, five loop-domain files, and the loop's records), so it can leave as a package once those are arguments and the entry `store/index.ts`, already `./store`, is its entry. The outer one is the report: `src/report/parse.ts`, `record.ts`, `machine-fault.ts` and `utils/progress.ts` are a small package of their own (gap 8) that the store's writers import and the loop calls, and `effort report` and the dashboard are the readers on the other side (gap 12).

Taken first, `settings.ts` moves into the store (gap 5) and the three config types are cut from `src/config.ts` (gap 4), because six files of the store are reached by 756 tests through them and nothing else can begin while the store imports the config module. The registry's static imports (gap 7) come with them, since they are the other half of the cycle. Taken last, `effort report` with its readers (gap 12), the doctor's rows (gap 13) and the three commands defined outside (gap 1), because they import the config, the collector, the loop's serving and the output, which are the other clusters' to give first.
