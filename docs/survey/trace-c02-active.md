# Trace: `c02-active`

Coverage: 188 of 188 cluster members read, the 188 files `docs/survey/import-graph.json` lists for `c02-active`; all 188 are tracked by `git ls-files`, and no tracked member was left unread. The 87 non-test members were read for their module notes and exports; the 101 test files were read through the graph and `docs/survey/test-index.json` only.

The largest cluster in the import graph with no trace file once `trace-c01-github.md` exists: 188 files, 87 of them source and 101 tests, 631 edges inside it. The cluster is the **loop run**: `rafa loop start` from the first flag it reads to the pull request it delivers (`src/start.ts` and 34 files of `src/start/`), the suite steps it runs around each session, the preflight, the plan reading it dispatches from (`src/plan/`), the lessons a task is handed and pushes back (`src/learning/`, `src/task/`, `src/report/lessons.ts`), and `plan create`'s engine (`src/plan.ts`, `src/adapters/planner/claude.ts`). Its hub is `src/adapters/output/active.ts` (82 in-cluster edges, the output every line of the run goes through, as `src/start.ts`'s module note says); the highest betweenness belongs to `src/start/dispatch.ts` (22,656, rank 16 of the whole graph), `src/start.ts` (20,063) and `src/start/preflight.ts` (14,711).

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. Neither has landed: `src/steps/` and `src/flows/` do not exist, no source file imports `@open-tomato/define-config` (the name appears only in prose and in a probe example in `src/preflight/prerequisites-md.ts` and `src/start/preflight.test.ts`), and `src/config-load.ts` reads `.rafa/config.yaml` into `SETTINGS`. So every "present" below means present in today's shape, and every gap is measured against the issues' design. #71 counts the `loop start` flow as "one 230-line function, 23 steps"; `start()` is now 373 lines (`src/start.ts:399` to the end of the file), with the steps it reaches as named units in `src/start/`.

## Members and folders

87 source files by folder:

| Folder | Source files | Holds |
| --- | --- | --- |
| `src/start` | 34 | the run: config, branch and checkout, preflight, session record, dispatch, commit, suite steps, wrap-up, release stage, pull request lifecycle |
| `src/utils` | 6 | `claude.ts` (the one `claude` spawn), `declaration.ts`, `tracker.ts`, `plan-stamp.ts`, `commit.ts`, `schedule.ts` |
| `src/board` | 5 | the plan-from-issue review pieces: `gate.ts`, `plan-field.ts`, `review-comment.ts`, `review-stamp.ts`, `spec-review.ts` |
| `src/learning` | 5 | the learning library: `merge`, `bless`, `identity`, `types` and the `./learning` entry `index.ts` |
| `src/plan` | 5 | `parsePlan`, `blocks`, `inject`, `store-rules` and the `./plan` entry `index.ts` |
| `src/commands/instinct` | 4 | `instinct list`, `show`, `promote` and the records they share |
| `src/preflight` | 4 | `run.ts` (the probe runner), `fork.ts`, `first-dispatch.ts`, `prerequisites-md.ts` |
| `src/suite` | 4 | `run.ts` (`bun test` and its JUnit reading), `baseline.ts`, `scope.ts`, `unhandled.ts` |
| `src/commands/plan` | 3 | `plan-record.ts`, `review-gate.ts`, `store-check.ts` |
| `src/task` | 3 | `resolve-skills.ts`, `sections.ts`, `select-lessons.ts` |
| `src/adapters/learning` | 2 | the `local` Learning adapter and its `held.ts` set |
| `src` | 2 | `start.ts` and `plan.ts` |
| `src/effort` | 2 | `attribution.ts` and `classify.ts` (the prompt classifier keys) |
| `src/tests` | 2 | `output-sinks.ts` and `real-node-modules.ts`, test support |
| one file each | 6 | `src/adapters/output/active.ts`, `src/adapters/planner/claude.ts`, `src/notices/run.ts`, `src/pr/conflict-sentence.ts`, `src/report/lessons.ts`, `src/schema/instinct.ts` |

The full member list, with the 101 test files, is the `members` array of `c02-active` in `docs/survey/import-graph.json`. The cluster spans 20 folders and splits most of them: `src/start` (68 of its 122 files here, 16 in `c08-cli-capture`, 13 in `c07-index`, 6 in `c09-version`, 6 in `c03-config`, 5 in `c05-sessions`, 4 in `c10-index`, 3 in `c01-github`, 1 in `c06-command`), `src/board` (10 of 121; 84 are in `c01-github`), `src/pr` (2 of 40; 25 in `c07-index`), `src/effort` (5 of 53; 28 in `c04-sqlite`), `src/schema` (1 of 17; 10 in `c11-frontmatter`), `src/plan` (10 of 14, the rest in `c01-github` and `c03-config`) and `src/commands/plan` (6 of 31). `src/learning` (10 of 10), `src/adapters/learning` (4 of 4) and `src/adapters/planner` (2 of 2) are whole. The 26 `src/tests` members are 24 tests and the two support files.

## What crosses the boundary

Non-test imports leaving the cluster (223 edges, 87 distinct files), by the cluster they reach:

| Target cluster | Edges | Distinct files | Files a cut would have to give `c02-active` access to |
| --- | --- | --- | --- |
| `c03-config` | 82 | 24 | `src/config.ts`, `src/config-load.ts`, `src/config-schema.ts`, `src/config-schema-tests.ts`, `src/config-schema-wrap-up.ts`, `src/config-sections.ts`, `src/adapters/registry.ts`, `src/agents/roster.ts`, `src/tiers/{delivery,resolve,routing,serve,skill-names}.ts`, `src/inventory/{record,trees,search/rank}.ts`, `src/schema/tiers.ts`, `src/effort/sync/contact.ts`, `src/start/{plan-path,preflight-sync,risk-total}.ts`, `src/task/skill-index.ts`, `src/utils/{agent-definition,session-env}.ts` |
| `c07-index` | 34 | 16 | `src/pr/{index,provider,preflight-items}.ts`, `src/utils/git.ts`, `src/claims/{device,plan-claim}.ts`, `src/commands/plan/claim-route.ts`, `src/start/{branch,branch-decision,claim-catch-up,pr-lifecycle,preflight-claim,runner-pr}.ts`, `src/board/{issue-board,trust}.ts`, `src/schema/project-id.ts` |
| `c06-command` | 22 | 3 | `src/cli/command.ts`, `src/cli/running.ts`, `src/commands/plan/validate.ts` |
| `c04-sqlite` | 20 | 11 | `src/effort/store/{dispatches,findings,location,preflight,schema-report,sqlite}.ts`, `src/effort/session-log.ts`, `src/report/{parse,record}.ts`, `src/utils/progress.ts`, `src/cli/version.ts` |
| `c10-index` | 19 | 3 | `src/ports/index.ts`, `src/adapters/output/text.ts`, `src/start/triage.ts` |
| `c01-github` | 16 | 12 | `src/adapters/tracker/github.ts`, `src/cli/prompt/confirm.ts`, `src/board/{epic-context,flags,readiness,spec-source}.ts`, `src/commands/plan/{refs-check,spec-route}.ts`, `src/next/hop-record.ts`, `src/project/position.ts`, `src/start/preflight-drift.ts`, `src/suite/owns.ts` |
| `c05-sessions` | 16 | 8 | `src/loop/sessions.ts`, `src/project/scope.ts`, `src/cleanup/index.ts`, `src/start/{loop-events,worktree-dir}.ts`, `src/board/{board-body,board-owns}.ts`, `src/commands/plan/plan-files.ts` |
| `c08-cli-capture` | 6 | 4 | `src/notices/notices.ts`, `src/project/{roots,worktree-root}.ts`, `src/start/checkout-guard.ts` |
| `c09-version` | 5 | 3 | `src/release/prepare.ts`, `src/start/{release-body,release-stage}.ts` |
| `c11-frontmatter` | 3 | 3 | `src/check/layout.ts`, `src/demote/classify.ts`, `src/schema/frontmatter.ts` |

Non-test imports entering the cluster (132 edges, 38 distinct members) come from `c03-config` (32), `c05-sessions` (19), `c09-version` (16), `c10-index` (16), `c07-index` (11), `c04-sqlite` (11), `c06-command` (10), `c01-github` (9), `c11-frontmatter` (7) and `c08-cli-capture` (1).

The two heaviest links are `c03-config` and `c07-index`. The cluster reads 24 files of config, tiers and inventory, and `src/start/` holds 13 files that the graph put in `c07-index` (the pull request, claim and branch pieces): `src/start/pr-lifecycle.ts`, `runner-pr.ts`, `branch.ts`, `branch-decision.ts`, `claim-catch-up.ts` and `preflight-claim.ts` are called by `start()` and `wrap-up-run.ts`, so the loop run and the pull request lifecycle are one mass that a cut has to give a seam.

Test reach, from `docs/survey/test-index.json`: the 101 member tests have indexes from 1 to 128 with a median of 44; 27 are at 10 or below, 34 between 11 and 63, 32 between 64 and 127 and 8 at the 128 ceiling. 27 of them spawn a process, 10 of those through `src/tests/cli-capture.ts`. This is a lower exposure than `c01-github`: the cluster's tests mostly pass seams (`gh`, `git`, a runner for the session) and read little of the tree. The cut still has to keep the 8 at the ceiling from growing, and `src/tests/output-sinks.ts`, imported by 41 test files outside the cluster, is support the epic's fourth criterion leaves out.

## Entry points

An entry point is a member imported from outside the cluster, or a command registered from it. 48 members are imported from outside the cluster, 38 of them by at least one non-test file. Three registered commands are in the cluster; two other registered commands run its code from a file in `c06-command`.

### Registered commands

Each is a default export `createXCommand()` of a `RafaCommand`, listed in `CORE_COMMANDS` (`src/commands/index.ts`, imports at lines 355–383).

| Command | File | Outputs | Spends | Refusal exit |
| --- | --- | --- | --- | --- |
| `instinct list` | `src/commands/instinct/list.ts` | text, json | no | exit 1 on an adapter that cannot be made or a pull it refuses |
| `instinct show` | `src/commands/instinct/show.ts` | text, json | no | exit 1 on an unknown id |
| `instinct promote` | `src/commands/instinct/promote.ts` | text, json | no | exit 1 on a kind no registry holds, an adapter that cannot be made or a pull it refuses |

`instinct promote` writes nothing: it prints what the next wrap-up would be asked to promote. The `instinct list` and `show` records come from `src/commands/instinct/instinct-records.ts`, which `src/effort/report-skills.ts` (`c05-sessions`) also imports.

### Commands whose engine is in the cluster

The command definitions sit in `c06-command`; the work they do is here. A package cut that moves the engine has to move or re-point these two files too.

| Command | Definition (outside) | Engine (inside) | What the definition passes |
| --- | --- | --- | --- |
| `loop start` | `src/commands/loop/start.ts` | `src/start.ts` (`start(args, repoRoot)`) and `src/start/runtime.ts` (`--runtime`) | the line's words and the project root |
| `plan create`, aliased `plan` | `src/commands/plan/create.ts` | `src/plan.ts`, `src/adapters/planner/claude.ts` | the line's words and the project root |

`src/index.ts` also imports `src/start.ts` and `src/plan.ts` (the package's `.` entry), so those two are entry points twice over.

### Other callers that the cluster serves

| Caller (cluster) | Calls | Members used |
| --- | --- | --- |
| `epic close` (`src/commands/epic/close.ts`) and its verification run (`src/epic/verify-run.ts`), both `c10-index` | one task session outside a loop | `start/dispatch.ts` (`dispatchTask`) |
| inventory search (`src/inventory/search/index.ts`, `c03-config`) | a session | `start/dispatch.ts` |
| the run's triage (`src/start/triage.ts`, `c10-index`) | the suite reading and the baseline | `suite/run.ts`, `suite/baseline.ts` |
| `rafa doctor` (`src/commands/doctor.ts`, `doctor-render.ts`, `doctor-description.ts`, `c03-config`) | the preflight's probes | `preflight/run.ts`, `preflight/first-dispatch.ts`, `preflight/prerequisites-md.ts` |
| `plan validate` (`src/commands/plan/validate.ts`, `c06-command`) | the effort-store rules and their check | `plan/store-rules.ts`, `commands/plan/store-check.ts` |
| `plan needs` (`src/plan/needs.ts`, `c03-config`) | the prerequisites file | `preflight/prerequisites-md.ts` |
| `rafa effort report`, `collect`, `release status` (`c04-sqlite`, `c05-sessions`) | the prompt classifier and attribution | `effort/classify.ts`, `effort/attribution.ts`, `start/serving.ts` |
| `pr merge` clean-up and the runtime installer (`src/commands/pr/merge-cleanup.ts`, `src/runtime/install.ts`) | the installed runtimes | `start/runtime.ts` |
| the Learning port (`src/ports/index.ts`, `c10-index`) | the held-set types | `learning/*`, `board/spec-review.ts` |
| the adapter registry (`src/adapters/registry.ts`, `c03-config`) | the `claude` Planner and the `local` Learning adapter | `adapters/planner/claude.ts`, `adapters/learning/local.ts` |
| `plan create --issue` readiness gate (`src/board/plan-spec.ts`, `setup.ts`, `src/commands/issue/ready.ts`, `src/commands/plan/claim-route.ts`) | the gate | `board/gate.ts` |

### Most imported from outside

The members with the most non-test importers outside the cluster:

| Member | Non-test importers | Test importers |
| --- | --- | --- |
| `src/adapters/output/active.ts` | 23 | 22 |
| `src/plan/parse.ts` | 12 | 7 |
| `src/utils/claude.ts` | 9 | 11 |
| `src/utils/declaration.ts` | 9 | 3 |
| `src/plan/index.ts` | 8 | 6 |
| `src/schema/instinct.ts` | 5 | 9 |
| `src/utils/tracker.ts` | 5 | 7 |
| `src/plan/blocks.ts` | 5 | 1 |
| `src/board/gate.ts` | 4 | 5 |
| `src/preflight/run.ts` | 4 | 5 |
| `src/start/dispatch.ts` | 4 | 4 |
| `src/utils/plan-stamp.ts` | 4 | 1 |
| `src/effort/attribution.ts` | 4 | 0 |
| `src/effort/classify.ts` | 4 | 4 |
| `src/suite/run.ts` | 4 | 2 |

`active.ts` (the active output), `plan/parse.ts` and `plan/blocks.ts` (the plan reading every plan command uses), `utils/claude.ts` (the `claude` spawn), `utils/declaration.ts` (the `{agent=… }` routing token), `utils/tracker.ts` and `utils/plan-stamp.ts` are shared infrastructure that sits here by import weight, as `github.ts` does in `c01-github`; the rest are the loop's own parts.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **partial** | 3 `RafaCommand` definitions in `src/commands/instinct/`; `loop start` and `plan create` run this cluster's `start()` and `plan` from definitions in `c06-command` | `run` is `run(context: RafaContext): Promise<void>`, not `run(ctx, options) → { outcome, context?, message? }`; `loop start` and `plan create` are definitions outside the cluster that call `start(args, repoRoot)` with raw words; registration is a central static import |
| Steps with guards | **partial** | the loop's steps exist as named units with seams (`start/preflight.ts`, `start/suite-step.ts`, `start/wrap-up-run.ts`, `start/checkout-watch.ts`, `start/session.ts`, `start/release-stage.ts`, `start/pr-lifecycle.ts`); guards are code inside them | no registry, no step id, no guard class declared, no `expect`, no `ctx.answered`, no dry-run path; `start()` calls them in a hand-written order |
| Config section | **partial** | the `tests` section (`src/config-schema-tests.ts`) and the `loop.wrapUp` section (`src/config-schema-wrap-up.ts`) have their own files; the other 20 keys the cluster reads sit in `src/config-schema.ts` | no file for the `loop`, `plan`, `task`, `learning`, `tiers` and `prerequisites` keys; they are in the shared `SETTINGS`, `RafaConfig` and `CONFIG_DEFAULTS`, read through `ResolvedConfig` and `Pick<RafaConfig, …>`; no `rafa.config.ts` |
| Flows | **partial** | four multi-step paths the cluster drives end to end (below) | each is a hand-ordered function chain; no flow list, no `flow show`, no step id to drop or swap |

### Commands

`instinct list`, `show` and `promote` satisfy the superset shape `commandProblem` checks (`subject`, `action`, `summary`, `flags`, `examples`, `outputs`) and are built by a factory that takes its seams (`createInstinctPromoteCommand(seams)`), so they are testable without a project. Two things a package has to take on:

- The `RafaCommand` type, `RafaContext`, `CommandExit` and `running.ts` live in `c06-command` (`src/cli/command.ts`, `src/cli/running.ts`). Every file of the cluster that refuses a run throws `CommandExit` (`start/run-config.ts`, `run-setup.ts`, `runtime.ts`, `preflight.ts`, `checkout-watch.ts`, `worktree.ts`, `src/start.ts`), so the 22 edges into `c06-command` are the exit contract more than the command type.
- The `loop start` and `plan create` definitions are outside the cluster, so a package that owns `start()` does not own its command. The `instinct` subject is shared with `instinct check` (`c11-frontmatter`) and `instinct flag` (`c06-command`).

### Steps with guards

Nothing here is a registered step. These are the units a loop run executes, in the order `start()` reaches them (`src/start.ts:399` onward), with the guard that decides each and the class #119's vocabulary would give it. The classes are an assignment from `docs/workflow-checks.md` §2 and §5 and the source; no code declares them. "Behaviour" means no setting or flag turns the refusal off, which is what a 🔒 class means; where a setting or flag does, the class is ⚠️ or 🧭.

| Step (today's unit) | File | Guard that decides it | Class |
| --- | --- | --- | --- |
| detached run | `src/start/run-config.ts` (`refuseDetachedRun`) | `-d|--detached` is refused until phase 6, before anything is read | 🔒 |
| effort-dir override | `src/start/run-config.ts` (`refuseEffortDirRun`) | `RAFA_EFFORT_DIR` set refuses, so a loop records to the project's own store | 🔒 |
| runtime handoff | `src/start/runtime.ts` (`runFromSelectedRuntime`) | `--runtime` naming another installed rafa runs the whole run there; a runtime inside the `src/` of the working directory or the root is refused | 🔒 |
| config loads | `src/start/run-config.ts` (`loadRunConfig`) | a `ConfigError` refuses before the `--start-at` deferral, so a queued run does not lose the night | 🔒 |
| `--start-at` deferral | `src/utils/schedule.ts` (`deferUntil`) | waits to a local time | reading |
| plan file exists | `src/start.ts`, `src/start/plan-path.ts` | refuses a missing plan | 🔒 |
| checkout and branch offer | `src/start/run-checkout.ts`, `run-setup.ts` (`resolveRunBranch`), `branch.ts` (`c07-index`) | on `main` or `master` asks to create or switch to `feat/<stub>`; `--create-branch` answers yes; `--as-worktree` asks nothing | consent |
| branch guard | `src/start/run-setup.ts` (`guardRunBranch`), `branch-decision.ts` (`c07-index`) | refuses a detached HEAD, modified tracked files, a base both ahead and behind, and a run left on the default branch; `--any-branch` passes the last | 🔒 / ⚠️ (`--any-branch`) |
| worktree refusals | `src/start/run-setup.ts`, `worktree.ts` | `--as-worktree` beside `--create-branch` or under a `tracking` setting, and a worktree git would not add | 🔒 |
| loop guard expectation | `src/start/checkout-watch.ts` (`openCheckoutExpectation`), `checkout-guard.ts` (`c08-cli-capture`) | refuses a checkout with no branch at a commit or no checkout of its own | 🔒 |
| risk total | `src/start/risk-total.ts` (`c03-config`) | printed on every run; a reading that throws is a warning | reading |
| notices | `src/notices/run.ts` (`requireNoticesAnswered`), `notices.ts` (`c08-cli-capture`) | alpha and skip-permissions notices until dismissed; a cancel starts nothing | consent |
| session record | `src/start/session.ts` (`openRunSession`), `loop/sessions.ts` (`c05-sessions`) | refuses a plan with a record on another branch, or on this branch still `running` or `paused` | 🔒 |
| preflight, sync strategy | `src/start/preflight-sync.ts` (`c03-config`) | an `effort.sync` kind no adapter serves refuses | 🔒 |
| preflight, agent roster | `src/start/preflight.ts`, `src/agents/roster.ts` (`c03-config`) | an `agent=` or `skills=` no tier serves, a switched-off one, or one two tiers hold with different contents, refuses before any probe | 🔒 |
| preflight, store rules | `src/plan/store-rules.ts`, `src/commands/plan/store-check.ts` | a store change pinned by number, or branch store code run over the live store, refuses | 🔒 |
| preflight, items | `src/preflight/run.ts`, `prerequisites-md.ts`, `src/pr/preflight-items.ts` (`c07-index`) | a failed required item or a malformed `auto`/`start` item refuses; a failed optional one becomes a `known-missing:` line | 🧭 (`prerequisites.*`) |
| preflight, claim | `src/start/preflight-claim.ts` (`c07-index`) | a plan whose issue another device owns, or none holds, is refused | 🔒 |
| preflight, claim drift | `src/start/preflight-drift.ts` (`c01-github`) | every `DRIFT_EVERY` (2) runs, under `pr.provider: gh`; warnings only | 🧭 |
| pause hold | `src/start/pause.ts` (`holdWhilePaused`) | holds while the record reads `paused`; SIGINT ends it | reading |
| loop guard, before dispatch and commit | `src/start/checkout-watch.ts` (`haltIfCheckoutMoved`) | a moved or gone checkout marks the task `[BLOCKED]` with `checkout moved` | 🔒 |
| suite baseline | `src/start/suite-step.ts` (`ensureBaseline`), `src/suite/baseline.ts` | the stored baseline, or the full suite at HEAD, once per plan | reading |
| stage steps due | `src/start/suite-stage-step.ts` (`runDueStageSteps`, `runStageStep`) | red with failures the baseline does not hold inserts a `[BLOCKED]` repair task and stops the run | behaviour |
| task dispatch | `src/start/dispatch.ts` (`dispatchTask`) | spawns the session under the declared flags; a budget exit (`budget.ts`) is `blocked` and any other nonzero exit is `failed` | behaviour |
| task commit | `src/start/commit.ts` (`finishCleanExit`) | a `rafa:report` of `status: blocked` or with a blocker, a missing report, or a refused commit holds the task | behaviour |
| task step | `src/start/suite-step.ts` (`runTaskStep`), `lint-step.ts`, `type-step.ts`, `task-always-run.ts` | scoped tests, `eslint` over the changed files and `tsc` over the changed test files, red only on a failure the base did not hold | behaviour |
| triage | `src/start/triage.ts` (`c10-index`) | a failure is a warning; a security or unflagged bug goes only to the private tracker | 🧭 |
| device sync | `src/effort/sync/contact.ts` (`c03-config`) | never throws; at most one unreachable-hub line per run | 🧭 |
| pre-wrap-up step | `src/start/suite-step.ts` (`runPreWrapUpStep`) | the full suite; red twice stops before the wrap-up | behaviour |
| wrap-up session | `src/start/wrap-up.ts`, `wrap-up-retry.ts` | `loop.wrapUp.retries` sessions are spawned when no pull request is open, then the runner opens it | 🧭 |
| release stage | `src/start/release-stage.ts` (`c09-version`), `release-body.ts` | a refused rewrite restores the loop's own fragment; a stage that cannot run prepares nothing | 🧭 |
| pull request delivery and retarget | `src/start/pr-lifecycle.ts`, `runner-pr.ts` (`c07-index`), `pr-retarget.ts` | a run never ends `done` without a pull request, or a `none` provider; a retarget refused is a warning | 🔒 |
| promoted answer | `src/start/promoted.ts`, `promoted-check.ts` | reported in the pull request body, never blocks | 🧭 |
| CI wait and repair | `src/start/pr-lifecycle.ts` | `--no-ci-wait`, `--ci-timeout`, `--ci-attempts` | 🧭 |

Consent today is two prompts, the branch offer and the notices, plus the answers given by flag (`--create-branch`, `--as-worktree`). `rafa next` starts `loop start` with those flags spelled (`src/next/actions.ts`, outside the cluster), which is the #92 pattern: no `ctx.answered` carries a decision from the chain into the run.

### Config section

Twenty-four keys across the cluster's readers. Two sections already have their own file; the rest sit in `src/config-schema.ts`.

| Key | Declared in | Read by the cluster in |
| --- | --- | --- |
| `tests.fullSuiteTriggers`, `tests.integration`, `tests.alwaysRun` | `src/config-schema-tests.ts` (143, 147, 148) | `src/start/suite-step.ts`, `src/start/suite-stage-step.ts`, `src/start/task-always-run.ts` and `src/start.ts` (`testsAlwaysRun`) |
| `loop.wrapUp.retries` | `src/config-schema-wrap-up.ts` (96) | `src/start/wrap-up-run.ts` |
| `plan.dir` | `src/config-schema.ts` (type 226, default 361, spec 431) | `src/start.ts`, `src/plan.ts`, `src/adapters/planner/claude.ts` |
| `plan.inject` | `src/config-schema.ts` (430) | `src/start.ts`, `src/start/run-config.ts`, `src/start/dispatch.ts`, `src/plan/inject.ts` |
| `loop.settingSources` | `src/config-schema.ts` (type 258, default 377, spec 475) | `src/start.ts`, `src/start/dispatch.ts`, `wrap-up.ts`, `wrap-up-run.ts`, `wrap-up-retry.ts`, `preflight.ts`, `src/utils/claude.ts`, `src/plan.ts` |
| `loop.worktreeDir` | `src/config-schema.ts` (263, 378, 479) | `src/start.ts` |
| `task.skills`, `task.lessons` | `src/config-schema.ts` (524, 525) | `src/start.ts`, `src/start/run-config.ts` and `src/start/handout.ts` |
| `learning.adapter`, `learning.bless.minConfidence`, `learning.promote.after`, `learning.promote.minConfidence` | `src/config-schema.ts` (440, 444, 445, 446) | `src/start.ts`, `src/start/handout.ts`, `src/start/wrap-up.ts`, `src/commands/instinct/list.ts`, `promote.ts` |
| `tiers.rafa`, `tiers.skills`, `tiers.agents` | `src/config-schema.ts` (520–522) | `src/start.ts`, `src/start/preflight.ts` |
| `routing` | `src/config-schema.ts` (type 333, default 398, spec 523) | `src/start/dispatch.ts`, `src/start/session.ts`, `src/utils/declaration.ts`, `src/utils/claude.ts`, `src/plan.ts` |
| `prerequisites.required`, `prerequisites.optional` | `src/config-schema.ts` (449, 455) | `src/preflight/prerequisites-md.ts` |
| `tracking.specs`, `tracking.plans`, `tracking.all` | `src/config-schema.ts` (460–462) | `src/start/run-setup.ts` |
| `claims.ahead` | `src/config-schema.ts` (494) | `src/plan.ts` |

The cluster also reads `pr.provider` and `pr.base` (`src/start/preflight.ts`, `wrap-up-run.ts`), which `PR_SETTINGS` owns, and `roadmap.issue` (`src/start/preflight-drift.ts`), owned by the board. `learning.*` is read here and by the `instinct` commands, so it is shared across commands rather than owned by the loop. Tests: `src/config-schema-tests.test.ts` and `src/config-schema-wrap-up.test.ts` cover the two split sections, and no test covers the rest as a section.

### Flows

Multi-step paths the cluster drives end to end. Each is an ordered chain of functions with a refusal or a question between steps and no flow declaration.

1. **`loop start`:** flags and refusals (`run-config.ts`, `runtime.ts`) → config → deferral → plan path → checkout and branch (`run-checkout.ts`, `run-setup.ts`, `branch.ts`) → loop-guard expectation → risk total → notices → session record → preflight → serving, learning, handout, hub contact, triage, suite steps → tracker created → the turn loop: pause hold → loop guard → baseline and stage steps → progress render → `dispatchTask` → store report → triage → device sync → commit → task step → next turn; when no task is open, the wrap-up flow below. About 23 steps in `start()` (`src/start.ts:399`).
2. **The wrap-up and delivery:** pre-wrap-up step → record names no task → release fragment (`release-stage.ts`) → wrap-up session (`wrap-up.ts`) → loop guard → release verification and push → delivery with retries and the runner's own pull request (`wrap-up-retry.ts`, `runner-pr.ts`) → retarget (`pr-retarget.ts`) → pull request body (`release-body.ts`) → CI wait and repair (`pr-lifecycle.ts`). Driven by `src/start/wrap-up-run.ts`.
3. **One task's session:** handout (skills, lessons) → prompt build with the base, always-run, known-missing and inherited sections → serve tiers (`serving.ts`) → spawn (`utils/claude.ts`) → report parsed and stored (`report/record.ts`, `report/lessons.ts`) → lessons pushed to the Learning adapter. `dispatchTask` in `src/start/dispatch.ts`, also used by `epic close` and its verification run outside the loop.
4. **`plan create`:** config and flags → spec route (`commands/plan/spec-route.ts`, `c01-github`) → claim route (`commands/plan/claim-route.ts`, `c07-index`) → prompt build → the Planner adapter's session (`adapters/planner/claude.ts`) → plan and prerequisites files written → plan stamp (`utils/plan-stamp.ts`) → review gate (`commands/plan/review-gate.ts`, `board/gate.ts`). Driven by `src/plan.ts`.

## Gaps

Every export that is missing or partial, with the file a cut would have to change. Gaps 1 to 3 are the contract itself and would be the same for any cluster; gaps 4 to 10 are specific to this one.

1. **No `run(ctx, options)` for the cluster's commands** (commands, partial). `run` takes `RafaContext` and returns `Promise<void>`. A cut changes `src/cli/command.ts` (the type) and the three files under *Registered commands*: `src/commands/instinct/list.ts`, `show.ts` and `promote.ts`; and, for the two commands whose engine is here, `src/commands/loop/start.ts` and `src/commands/plan/create.ts` (outside the cluster), which today pass words to `start(args, repoRoot)` and `plan`.
2. **No step registry or guard class** (steps, missing). Guards are code inside the units. A cut adds the registry (`src/steps/registry.ts`, not yet present) and moves each guard in the *Steps with guards* table into a step: `src/start/run-config.ts`, `run-setup.ts`, `runtime.ts`, `session.ts`, `preflight.ts`, `checkout-watch.ts`, `suite-step.ts`, `suite-stage-step.ts`, `commit.ts`, `wrap-up-run.ts` and `pr-lifecycle.ts`. The `required` set a loader needs is every row marked 🔒 above.
3. **No consent in the context** (steps, missing). The branch offer (`src/start/branch.ts`, `c07-index`) and the notices (`src/notices/run.ts`) each ask their own question; `--create-branch` and `--as-worktree` answer by flag. A cut routes them through `ctx.answered`, with `src/next/actions.ts` (outside the cluster) passing it instead of spelling flags, and `src/start/run-setup.ts` reading it.
4. **`start()` is one 373-line function over the whole run** (steps, partial). Its turn loop, the three early-return halts and the `finally` that writes the run's end are inline in `src/start.ts:399`, and the file's own module note is 360 lines of the order. A cut has to split it into setup, task and wrap-up phases (the three #71 names) in `src/start.ts`, moving what each phase reads from `ResolvedConfig` and the `session` it opens into the context's shared keys (`base`, `branch`, `plan`).
5. **`src/start/preflight.ts` holds 13 checks in one function** (steps, partial). `runStartPreflight` runs the sync strategy, roster, store rules, items, claim, reminders, start-only tier, probes, stored rows, halt and drift in one ordered body (708 lines). A cut moves each to a step with the guard class from the table, so that `prerequisites.*` and the claim check can be dropped or reordered independently; the files are `src/start/preflight.ts`, `src/start/preflight-sync.ts`, `src/start/preflight-claim.ts`, `src/start/preflight-drift.ts` and `src/preflight/*`.
6. **The suite steps are four recorded steps with no declaration** (steps, partial). `src/start/suite-step.ts` (813 lines, over the soft ceiling, with `suite-stage-step.ts` and `task-step-checks.ts` split off it) is the one account of the baseline, task, stage and pre-wrap-up steps; each already appends a `SessionStep` to the run record (`src/loop/sessions.ts`, `c05-sessions`) before the loop acts on it, which is the shape a step result would take. A cut gives each step an id and `outcomes`, changes `src/start/suite-steps-run.ts` (the placement) and `src/start/suite-blocker.ts` (the repair task), and needs the lint step (`lint-step.ts`) and the type step (`type-step.ts`) as separate steps if a workflow is to drop one.
7. **The config for the loop is in the shared schema** (config, partial). `tests` and `loop.wrapUp` have files; `plan.*`, `loop.*`, `task.*`, `learning.*`, `tiers.*`, `routing` and `prerequisites.*` do not. A cut moves them to files beside `-tests` and `-wrap-up`, and changes `src/config-schema.ts` (the spread into `SETTINGS`, `RafaConfig` and `CONFIG_DEFAULTS`), `src/config-sections.ts` and `src/config-load.ts`. The cluster's 82 edges into `c03-config` are the readers a cut has to keep reachable (`ResolvedConfig` in `src/start.ts` and `src/start/run-config.ts`, `Pick<RafaConfig, …>` in `src/start/pr-lifecycle.ts`, `src/start/preflight.ts` and `src/start/run-setup.ts`). `learning.*` is also read by `instinct list` and `promote`, so it needs one owner.
8. **No flow declarations, and no `--dry-run` for the loop** (flows, partial). The four flows above are function chains with no step ids, and nothing in `src/start.ts` or `src/start/` reads `dryRun` (only `src/plan.ts` has a `--dry-run`, for the spec route). A cut that wants `pr.deleteBranch` or the wrap-up's release stage droppable changes `src/start/wrap-up-run.ts` and `src/start/release-stage.ts`; a `--dry-run` walk of the loop changes every step's file in gap 2 and adds a reading path to `src/start/dispatch.ts` and `src/start/suite-step.ts`, which spawn sessions and run `bun test`.
9. **A missing guard** (steps, missing). `docs/workflow-checks.md` §5 records that a branch of a different issue than the plan has no guard anywhere; #119 adds `git/branch-matches-issue`, first run in `loop start`. It reads `naming.branch` (`src/board/naming.ts`, `c01-github`) and the plan's issue, so a cut changes `src/start/preflight.ts` or `src/start/run-setup.ts` (where the plan stub and the branch are first both known) and `src/start/branch-decision.ts` (`c07-index`).
10. **Shared infrastructure sits inside the cluster, and the cluster is bound to others** (cut boundary). `src/adapters/output/active.ts` (the hub, 23 non-test importers outside), `src/plan/parse.ts` and `src/plan/blocks.ts` (the plan reading, 12 and 5), `src/utils/claude.ts` (9), `src/utils/declaration.ts` (9), `src/utils/tracker.ts` (5) and `src/utils/plan-stamp.ts` (4) are imported by other clusters and are not loop code. A cut either moves them to the package every other package imports or leaves `c02-active` as the owner of the output seam, the plan reading and the `claude` spawn. The 34 edges into `c07-index` (the pull request, claim and branch pieces) and the 16 into `c08-cli-capture` and `c09-version` show `src/start/` is split: 13 of its files are in `c07-index`, 16 in `c08-cli-capture` (mostly test files and fixtures through `src/tests/cli-capture.ts`) and 6 in `c09-version`. Files to decide: the six pull request files of `src/start/` and `src/utils/git.ts`.
11. **Existing subpath entries cover only part** (commands and steps, partial). `package.json` exports `./plan` (`src/plan/index.ts`) and `./learning` (`src/learning/index.ts`) from the cluster, and `./ports` and `./store` beside them; none exports a command, a step, a config section or a flow. A cut keeps those subpaths working (the shim #801 asks for) and adds the four exports to the package entry, changing `package.json` and the two entry files.
12. **The tests reach the whole tree less than elsewhere, but 8 sit at the ceiling** (cut boundary). Of the 101 member tests, 8 are at 128 and 27 spawn a process (10 through `src/tests/cli-capture.ts`). The 24 `src/tests` members are loop tests (declaration, tracker, report, plan-stamp, preflight-halts, learning-adapter and the like); a cut keeps the epic's fourth criterion only if these tests import their own package, and `src/tests/output-sinks.ts` (support, 41 importers outside) moves with the output seam of gap 10.

## Cut order this implies

The cluster has two lines through it that a cut can use. The inner one is the run's own ordering: `start()` already delegates to `run-config`, `run-setup`, `session`, `preflight`, `suite-steps-run`, `wrap-up-run` and `dispatch`, each with its seams, so those units can leave as steps without being rewritten, and the learning library (`src/learning/`, 5 files with an entry and no import from outside it) and the plan reading (`src/plan/`) are already self-contained enough to leave first as their own packages. The outer one is the active output in `src/adapters/output/active.ts`, the seam every line of the run writes through; moving it first removes the largest in-cluster hub (82 edges) and lets `src/start/` move without it.
