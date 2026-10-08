# Trace: `c01-github`

Coverage: 265 of 265 cluster members read, the 265 files `docs/survey/import-graph.json` lists for `c01-github`; all 265 are tracked by `git ls-files`, and no tracked member was left unread. The 106 non-test members were read for their module notes and exports; the 159 test files were read through the graph and `docs/survey/test-index.json` only.

The largest cluster in the import graph with no trace file: 265 files, 106 of them source and 159 tests, 1,346 edges inside it. The cluster is the **board**: everything that reads or writes GitHub issues as specs, epics, roadmap lines and blockers, and the commands that put that on the terminal. Its hub is `src/adapters/tracker/github.ts` (157 in-cluster edges, the `GhRunner` seam); the highest betweenness belongs to `src/commands/plan/refs-check.ts` (186,043), `src/commands/doctor-refs.ts` (185,424) and `src/commands/issue/issue-tracker.ts` (137,956).

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. Neither has landed: `src/steps/` does not exist, no source file imports `@open-tomato/define-config`, and no `rafa.config.ts` is read (`src/config-load.ts` reads `.rafa/config.yaml` into `SETTINGS`). So every "present" below means present in today's shape, and every gap is measured against the issues' design.

## Members and folders

106 source files by folder:

| Folder | Source files | Holds |
| --- | --- | --- |
| `src/board` | 38 | roadmap, epic, readiness, blocked-line, naming, spec-source and plan-spec readings and writes |
| `src/board/relations` | 10 | the `BoardRelations` port, its `labels` and `native` adapters, the contract suite |
| `src/commands` | 11 | `roadmap`, `switch`, `init-board`, and the `doctor-*` board readings |
| `src/commands/epic` | 9 | `new`, `show`, `cancel`, `move`, `defer`, `promote` and their shared pieces |
| `src/commands/issue` | 9 | `ready`, `unblock`, `check`, `list`, `issue-tracker` and the roadmap tables |
| `src/commands/plan` | 5 | the offers and routes `plan create` makes over the board |
| `src/commands/pr` | 3 | the roadmap tick, unblock and freed readings `pr merge` runs after a merge |
| `src/next` | 5 | the `hop` and `home` actions and their record, rows and chain |
| `src/refs` | 5 | reference extraction, stamping, reading and verification |
| one file each | 11 | `src/adapters/tracker/github.ts`, `src/claims/drift.ts`, `src/cli/prompt/confirm.ts`, `src/commands/board/list.ts`, `src/pr/git.ts`, `src/project/position.ts`, `src/start/preflight-drift.ts`, `src/status/blocked-count.ts`, `src/suite/owns.ts`, `src/tests/spec-bodies.ts`, `src/triage/refs-section.ts` |

The full member list, with the 159 test files, is the `members` array of `c01-github` in `docs/survey/import-graph.json`. The cluster spans 20 folders and splits several of them: `src/commands/pr` (3 of its 8 files here, 18 in `c06-command`, 7 in `c09-version`), `src/next` (5 source files here, the rest across `c05-sessions` and `c06-command`) and `src/start` (3 test and source files here, 68 in `c02-active`). The 25 `src/tests` members are 24 tests and the `spec-bodies.ts` fixture.

## What crosses the boundary

Non-test imports leaving the cluster, by the cluster they reach:

| Target cluster | Edges | Distinct files | Files a cut would have to give `c01-github` access to |
| --- | --- | --- | --- |
| `c03-config` | 80 | 6 | `src/config-schema.ts`, `src/config.ts`, `src/config-load.ts`, `src/config-sections.ts`, `src/adapters/registry.ts`, `src/commands/doctor-render.ts` |
| `c06-command` | 33 | 8 | `src/cli/command.ts`, `src/cli/registry.ts`, `src/cli/help.ts`, `src/cli/describe.ts`, `src/commands/index.ts`, `src/next/state.ts`, `src/next/ending.ts`, `src/board/leak.ts` |
| `c05-sessions` | 27 | 8 | `src/project/scope.ts`, `src/loop/sessions.ts`, `src/next/readings.ts`, `src/pr/owner-approval.ts`, `src/board/board-owns.ts`, `src/board/board-body.ts`, `src/board/owner-resolve.ts`, `src/commands/plan/plan-files.ts` |
| `c07-index` | 19 | 10 | `src/board/trust.ts`, `src/board/issue-board.ts`, `src/board/roadmap-claims.ts`, `src/claims/*.ts` (4), `src/pr/provider.ts`, `src/schema/project-id.ts`, `src/start/branch-decision.ts` |
| `c10-index` | 18 | 5 | `src/ports/index.ts`, `src/adapters/tracker/issue-values.ts`, `src/adapters/tracker/resolve.ts`, `src/board/epic-body.ts`, `src/board/epic-template.ts` |
| `c02-active` | 9 | 2 | `src/adapters/output/active.ts`, `src/board/gate.ts` |
| `c09-version` | 1 | 1 | `src/commands/pr/merge-cleanup.ts` |

Non-test imports entering the cluster come from `c05-sessions` (52 edges), `c06-command` (37), `c07-index` (25), `c10-index` (20), `c03-config` (16), `c02-active` (16), `c08-cli-capture` (16), `c09-version` (13) and `c04-sqlite` (2).

Test reach, from `docs/survey/test-index.json`: the 159 member tests have indexes from 1 to 128 with a median of 64; 5 are at 10 or below, 22 between 11 and 63, 84 between 64 and 127 and 48 at the 128 ceiling. 49 of them spawn a process, 40 of those through `src/tests/cli-capture.ts`. A cut that leaves these tests importing the whole of `src/` leaves 48 tests at the ceiling, so the cluster is where the epic's fourth criterion (no test above the baseline) is most exposed.

## Entry points

An entry point is a member imported from outside the cluster, or a command registered from it. 71 members are imported from outside the cluster, 65 of them by at least one non-test file; all 13 registered commands are among the 65, each imported by `src/commands/index.ts`.

### Registered commands

Each is a default export `createXCommand()` of a `RafaCommand`, listed in `CORE_COMMANDS` (`src/commands/index.ts`, imports at lines 329–403).

| Command | File | Outputs | Spends | Refusal exit |
| --- | --- | --- | --- | --- |
| `board list` | `src/commands/board/list.ts` | text, json | no | `BOARD_LIST_REFUSAL_EXIT` |
| `epic new` | `src/commands/epic/new.ts` | text, json | no | `EPIC_NEW_REFUSAL_EXIT` |
| `epic show` | `src/commands/epic/show.ts` | text, json | no | `CommandExit` |
| `epic cancel` | `src/commands/epic/cancel.ts` | text, json | no | `EPIC_CANCEL_REFUSAL_EXIT` |
| `epic move` | `src/commands/epic/move.ts` | text, json | no | `EPIC_MOVE_REFUSAL_EXIT` |
| `epic defer` | `src/commands/epic/defer.ts` | text, json | no | via `horizon-change.ts` |
| `epic promote` | `src/commands/epic/promote.ts` | text, json | no | via `horizon-change.ts` |
| `issue ready` | `src/commands/issue/ready.ts` | text, json | no | `READY_WRITE_EXIT` |
| `issue unblock` | `src/commands/issue/unblock.ts` | text, json | no | `CommandExit(1)` |
| `issue check` | `src/commands/issue/check.ts` | text, json | no | `CommandExit` |
| `issue list` | `src/commands/issue/list.ts` | text, json | no | `CommandExit` |
| `roadmap` | `src/commands/roadmap.ts` | text, json | no | `issue list`'s own |
| `switch` | `src/commands/switch.ts` | text, json | no | `SWITCH_REFUSAL_EXIT` |

None declares `spends`: the cluster starts no Claude session. `roadmap` is `issue list --roadmap` and `epic defer` and `epic promote` share one run in `src/commands/epic/horizon-change.ts`.

### Commands that other clusters register and the cluster serves

These are outside the cluster, and each calls into it. A package cut would have to keep the call working across the package line.

| Caller (cluster) | Calls | Members used |
| --- | --- | --- |
| `pr merge` (`src/commands/pr/merge.ts`) | the after-merge steps | `commands/pr/merge-tick.ts`, `merge-unblock.ts`, `merge-freed.ts`, `board/roadmap-tick.ts`, `board/relations/select.ts` |
| `plan create` (`src/plan.ts`) | spec route and the readiness gate | `commands/plan/spec-route.ts`, `commands/plan/refs-check.ts`, `board/spec-source.ts`, `board/epic-context.ts` (`board/plan-spec.ts` is reached through `spec-route.ts`) |
| `rafa next` (`src/commands/next.ts`, `src/next/state.ts`) | the hop rows and the `issue ready` action | `next/hop-rows.ts`, `board/readiness.ts`, `board/blocked.ts`, `commands/issue/ready.ts` |
| `loop start` (`src/start.ts`, `src/start/preflight.ts`) | the drift check | `start/preflight-drift.ts` |
| `loop start` stage step (`src/start/suite-step.ts`) | the plan's `Owns:` folders | `suite/owns.ts` |
| `doctor` (`src/commands/doctor.ts`) | board, refs and relations readings | `doctor-board.ts`, `doctor-refs.ts`, `doctor-previous.ts` |
| `init` (`src/commands/init.ts`) | the `--board` step | `commands/init-board.ts` |
| `epic close` (`src/commands/epic/close.ts`) | board and epic readings | `board/epics.ts`, `board/roadmap-board.ts`, `board/relations/labels.ts`, `commands/issue/issue-tracker.ts` |

### Most imported from outside

The members with the most non-test importers outside the cluster (the full 71 are the `edges` of the graph with `to` in the cluster and `from` outside it):

| Member | Non-test importers | Test importers |
| --- | --- | --- |
| `src/adapters/tracker/github.ts` | 32 | 39 |
| `src/pr/git.ts` | 31 | 37 |
| `src/cli/prompt/confirm.ts` | 14 | 16 |
| `src/board/roadmap.ts` | 8 | 5 |
| `src/commands/issue/issue-tracker.ts` | 7 | 2 |
| `src/project/position.ts` | 7 | 16 |
| `src/board/roadmap-board.ts` | 6 | 6 |
| `src/next/hop-record.ts` | 6 | 9 |
| `src/board/readiness.ts` | 4 | 6 |
| `src/board/epics.ts` | 4 | 1 |
| `src/board/setup.ts` | 4 | 2 |

`github.ts`, `git.ts`, `confirm.ts`, `position.ts` and `issue-tracker.ts` are shared infrastructure that sits here by import weight (the `GhRunner`, the `GitRunner`, the prompt kit, the position file and the issue tracker handle); the others are board readings.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **present** | 13 `RafaCommand` definitions in `src/commands/{board,epic,issue}/` and `src/commands/{roadmap,switch}.ts`, registered by `src/commands/index.ts` | `run` is `run(context: RafaContext): Promise<void>` (`src/cli/command.ts`), not `run(ctx, options) → { outcome, context?, message? }`; registration is a central static import, so a package cannot contribute its own |
| Steps with guards | **partial** | guards as code inside commands and readings: `board/readiness.ts`, `board/epic-problems.ts`, `board/refs-gate.ts`, `board/blocked-line.ts`, `next/hop-chain.ts`, `commands/pr/merge-*.ts`; none as a registered step | no registry (`src/steps/registry.ts` absent), no guard class (🔒 / ⚠️ / 🧭) declared, no `expect`, no `ctx.answered`, no dry-run path per step |
| Config section | **partial** | five keys read by the cluster, declared inline in `src/config-schema.ts` (see below) | no `config-schema-board.ts` beside `-hub`, `-release`, `-triage`, `-tests` and `-wrap-up`; keys are in the shared `SETTINGS`, `RafaConfig` and `CONFIG_DEFAULTS`, and the cluster reads them through `Pick<RafaConfig, …>` |
| Flows | **partial** | six multi-step paths the cluster drives end to end (below) | each is a hand-ordered function chain; no flow list, no `flow show`, no step id to drop or swap |

### Commands

All 13 satisfy the superset shape `commandProblem` checks (`subject`, `action`, `summary`, `flags`, `examples`, `outputs`). Each is built by a factory that takes its seams (`gh`, `git`, a prompter, `isTerminal`), so the command is testable without GitHub. Two things a package has to take on:

- The `RafaCommand` type, `RafaContext`, `CommandExit` and the registry live in `c06-command` (`src/cli/command.ts`, `src/cli/registry.ts`). Every command here imports `type { RafaCommand }`, and the cluster's 33 edges into `c06-command` are mostly this.
- Subjects `board`, `epic`, `issue`, `roadmap` and `switch` are declared in `CORE_SUBJECTS` (`src/commands/index.ts:414`), next to subjects other clusters own. `epic` is shared with `epic close` (`src/commands/epic/close.ts`, outside the cluster) and `issue` with `issue create`, `comment`, `move` and `show`.

### Steps with guards

Nothing here is a registered step. These are the units a loop run or a command chain executes that the cluster owns, with the guard that decides each and the class #119's vocabulary would give it. The classes are an assignment from `docs/workflow-checks.md` §5 and the source; no code declares them.

| Step (today's unit) | File | Guard that decides it | Class |
| --- | --- | --- | --- |
| `issue ready`: the author may write to the repository | `src/commands/issue/ready.ts`, reading `src/board/trust.ts` (`c07-index`) | `trustRefusalClause`; `board.trustedAuthors` adds logins | 🔒 |
| `issue ready`: body fills the six spec headings | `src/board/readiness.ts` (`requireCompleteSpec`, `TEMPLATE_HEADINGS`) | refuses with `READINESS_REFUSAL_EXIT` 2 | 🧭 |
| `issue ready`: one `epic:` label at most | `src/commands/issue/ready.ts` `requireOneEpic`, `src/board/epic-problems.ts` | exit 2; skipped under `board.relationships: native` | 🔒 |
| `issue ready`: mark `spec:ready` | `src/commands/issue/ready.ts` `markIssueReady` | asks when there is a terminal and `--yes` was not typed (`readReadyYes`); `docs/workflow-checks.md` §4 still says there is no `--yes`, which the code no longer matches | consent |
| `issue unblock` | `src/commands/issue/unblock.ts` | one question per issue whose blockers have all closed | consent |
| `plan create` check 0 and 1: trust and `spec:ready` | `src/board/plan-spec.ts` `inspectSpecIssue`, `src/commands/plan/ready-offer.ts` | exit `BOARD_REFUSAL_EXIT` 2; the offer runs `issue ready` in place | 🔒 / consent |
| `plan create` check 2: leak and completeness | `src/board/leak.ts` (`c06-command`), `src/board/readiness.ts` | refuses before the body is saved | 🔒 / 🧭 |
| `plan create` snapshot settle | `src/board/snapshot-settle.ts`, `src/commands/plan/refresh-offer.ts` | asks only on a changed body and without `--refresh` | consent |
| `plan create` check 4: references | `src/board/refs-gate.ts`, `src/commands/plan/refs-check.ts`, `src/refs/*` | `dangling` and `suspect` refuse; `dangerous.acceptStaleRefs` or `--accept-refs` passes them, printed | 🔒 + ⚠️ |
| `plan create --next`: blocked line | `src/board/blocked-line.ts`, `src/commands/plan/blocked-offer.ts` | offers the first ready, unblocked, untaken line; the yes decides order only | consent |
| `pr merge` after-merge: epic checklist tick | `src/commands/pr/merge-tick.ts` (`tickEpics`) | warns, never refuses | 🧭 |
| `pr merge` after-merge: roadmap tick | `src/board/roadmap-tick.ts`, `src/commands/pr/merge-tick.ts` | `TICK_ATTEMPTS` 2; failure is a warning | 🧭 |
| `pr merge` after-merge: unblock reading (`labels`) | `src/commands/pr/merge-unblock.ts` | null before any board read when the PR closes no issue | 🧭 |
| `pr merge` after-merge: freed reading (`native`) | `src/commands/pr/merge-freed.ts` | reads, never writes | 🧭 |
| `loop start` preflight: claim drift | `src/start/preflight-drift.ts` | every `DRIFT_EVERY` (2) runs, only under `pr.provider: gh`; warnings only | 🧭 |
| `loop start` stage scope: plan `Owns:` | `src/suite/owns.ts` (`readPlanOwns`) | degrades by reason (`no-issue`, `no-epic`, `no-owns-line`, `gh-failed`), never refuses | reading |
| `rafa next --roadmap`: `hop` and `home` | `src/next/hop-action.ts`, `src/next/hop-chain.ts`, `src/next/hop-rows.ts`, `src/next/hop-record.ts` | the one-hop decision `stay`, `halt`, `wait` or `hop`; `both-away` and `blocked-blocker` halt | 🔒 |
| `switch` | `src/commands/switch.ts` | `SWITCH_REFUSAL_EXIT`; the position file write refuses with exit 1 | 🔒 |
| `init --board`: epic guard workflow | `src/board/epic-guard.ts`, `src/commands/init-board.ts` | optional; `EPIC_GUARD_NATIVE_REFUSAL` under `native` | 🧭 |

Consent today is a prompter each command opens for itself (`createLinePrompter` from `src/cli/prompt/confirm.ts`, the `Prompter` seam, `isTerminal` seam). Every command listed as "consent" asks its own question; `rafa next` runs `issue ready` and `issue unblock` as commands (`src/next/actions.ts`), so the #92 double-question case is live here. This is the cluster's largest distance from `ctx.answered`.

### Config section

Five keys. The schema is not split into a board file the way hub, release, triage, tests and wrap-up are (`src/config-schema-board.test.ts` exists with no `config-schema-board.ts` beside it); the declarations sit in the shared `src/config-schema.ts`.

| Key | Reader | Default | Declared in | Read by the cluster in |
| --- | --- | --- | --- | --- |
| `board.trustedAuthors` | `listOf(githubLogin, 'GitHub logins')` | `[]` | `src/config-schema.ts` (type 268, default 381, spec 482) | `src/commands/issue/ready.ts:479`, which hands it to `src/board/trust.ts` (`c07-index`) as `trustedAuthors`; also `src/plan.ts`, `src/commands/pr/pr-context.ts` and `src/commands/plan/needs.ts` outside the cluster |
| `board.relationships` | `oneOf(BOARD_RELATIONSHIP_MODES)` | `labels` | `src/config-schema.ts` (275, 382, 487); modes in `src/config-sections.ts:284` | `src/board/relations/select.ts` (`Pick<RafaConfig, 'boardRelationships'>`), `src/commands/epic/move-native.ts` |
| `roadmap.issue` | `issueNumber` | `null` | `src/config-schema.ts` (280, 383, 492) | `src/board/setup-config.ts`, `src/board/status.ts`, `src/board/plan-spec.ts`, `src/commands/switch.ts:322`, `src/commands/epic/show.ts`, `src/commands/issue/list.ts`, `src/commands/plan/spec-route.ts`, `src/start/preflight-drift.ts` |
| `dangerous.acceptStaleRefs` | `flag` | `false` | `src/config-schema.ts` (305, 391, 508) | `src/board/refs-gate.ts:100` (`ACCEPT_STALE_REFS_KEY`) |
| `specs.dir` | `directory`, `cli: true` | `.rafa/specs` | `src/config-schema.ts` (228, 362, 432) | `src/board/naming.ts`, `src/board/previous-copy.ts`, `src/commands/doctor-previous.ts` |

`specs.dir` is read here and by `plan create`, so it is shared with another cluster rather than owned. The cluster also reads `pr.provider` (`src/start/preflight-drift.ts`), which `PR_SETTINGS` owns. Tests: `src/config-schema-board.test.ts` covers `board.relationships`.

### Flows

Multi-step paths the cluster drives end to end. Each is an ordered chain of functions with a refusal or a question between steps and no flow declaration.

1. **Readiness gate for `plan create --issue` and `--next`:** route words (`board/spec-source.ts`) → `resolvePlanSpec` (`board/plan-spec.ts`) → checks 0, 1 (with the `issue ready` offer), 2 → `settleSpecSnapshot` with the refresh offer → check 4 (`commands/plan/refs-check.ts`) → the planner session (outside the cluster, in `src/plan.ts`).
2. **`issue ready`:** read issue → trust → completeness → one-epic → already-ready check → terminal check → question → label swap (`commands/issue/ready.ts`).
3. **After-merge board clean-up:** epic checklist tick → roadmap tick → unblock reading (`labels`) or freed reading (`native`), chosen through the `BoardRelations.afterMerge` port (`board/relations/port.ts`, `labels.ts`); called from `src/commands/pr/merge.ts` after the provider merged.
4. **Epic lifecycle:** `epic new` (label, template, checklist), `epic cancel` (dependents question, target question, note), `epic move`, `epic defer` and `epic promote` (`horizon-change.ts`), each reading the board once and writing through `GhRunner`.
5. **`rafa next --roadmap` hop:** state row → `decideHop` (`stay`, `halt`, `wait`, `hop`) → `runHop` writes the hop record and runs `switch <epic> --no-rehome` → work → `runHome` writes `waiting`, `merged` or `halted`.
6. **`init --board`:** board question → labels and roadmap issue (`board/setup.ts`) → optional epic guard workflow (`board/epic-guard.ts`).

## Gaps

Every export that is missing or partial, with the file a cut would have to change. Gaps 1 to 3 are the contract itself and would be the same for any cluster; gaps 4 to 9 are specific to this one.

1. **No `run(ctx, options)` for the cluster's commands** (commands, partial). `run` takes `RafaContext` and returns `Promise<void>`. A cut changes `src/cli/command.ts` (the type) and each of the 13 files under *Registered commands*.
2. **No step registry or guard class** (steps, missing). Guards are code inside commands and readings. A cut adds the registry (`src/steps/registry.ts`, not yet present) and moves each guard in the *Steps with guards* table into a step: `src/board/readiness.ts`, `src/board/epic-problems.ts`, `src/board/refs-gate.ts`, `src/board/plan-spec.ts`, `src/commands/issue/ready.ts`, `src/commands/switch.ts`, `src/next/hop-chain.ts`.
3. **No consent in the context** (steps, missing). `src/commands/issue/ready.ts`, `src/commands/issue/unblock.ts`, `src/commands/epic/cancel.ts`, `src/commands/epic/move.ts`, `src/commands/plan/ready-offer.ts`, `src/commands/plan/refresh-offer.ts`, `src/commands/plan/blocked-offer.ts` and `src/commands/init-board.ts` each open `createLinePrompter` and ask. A cut routes them through `ctx.answered`, with `src/next/actions.ts` (outside the cluster) passing it instead of spelling flags.
4. **Registration is central** (commands, partial). A package's commands cannot be contributed from the package: `src/commands/index.ts` lists every command by static import, and `CORE_SUBJECTS` holds the `board`, `epic`, `issue`, `roadmap` and `switch` subjects. A cut changes `src/commands/index.ts` and `src/cli/registry.ts`, and splits the `epic` and `issue` subjects with `src/commands/epic/close.ts`, `src/commands/issue/create.ts`, `comment.ts`, `move.ts` and `show.ts`, which are not in the cluster.
5. **The board config section has no file of its own** (config, partial). Five keys live in `src/config-schema.ts` and `src/config-sections.ts`, and `specs.dir` is shared with `plan create`. A cut moves them to a `config-schema-board.ts` the way `-hub`, `-release` and `-triage` are, and changes `src/config-schema.ts` (the spread into `SETTINGS`, `RafaConfig` and `CONFIG_DEFAULTS`) and `src/config-sections.ts` (`BOARD_RELATIONSHIP_MODES`). Through define-config (#118) it also changes `src/config-load.ts`. The cluster's 80 edges into `c03-config` are the readers a cut has to keep reachable (`Pick<RafaConfig, …>` in `src/board/relations/select.ts`, `src/commands/doctor-previous.ts` and `src/start/preflight-drift.ts`).
6. **No flow declarations** (flows, partial). The six flows above are function chains with no step ids. A cut that wants `pr merge`'s after-merge steps droppable (`pr.deleteBranch` in #71) changes `src/commands/pr/merge.ts` (outside the cluster), `src/commands/pr/merge-tick.ts`, `merge-unblock.ts` and `merge-freed.ts`, and `src/board/relations/labels.ts` (`afterMerge`), which today runs the tick and unblock as one block.
7. **A missing guard** (steps, missing). `docs/workflow-checks.md` §5 records that the branch of a different issue than the plan has no guard anywhere; #119 adds `git/branch-matches-issue`. It reads `naming.branch` (`src/board/naming.ts`), so a cut changes `src/board/naming.ts` and `src/start/branch-decision.ts` (`c07-index`).
8. **Shared infrastructure sits inside the cluster** (cut boundary). `src/adapters/tracker/github.ts` (the `GhRunner`), `src/pr/git.ts` (the `GitRunner`), `src/cli/prompt/confirm.ts` (the prompt kit) and `src/project/position.ts` are imported from outside by 32, 31, 14 and 7 non-test files and are not board code. A cut either moves them to the package every other package imports or leaves `c01-github` as the owner of three packages' seams. Files to move: those four, and `src/commands/issue/issue-tracker.ts`, which `epic close`, `instinct flag`, `issue create` and four other commands import.
9. **Tests reach the whole tree** (cut boundary). 48 of the 159 member tests sit at the index ceiling of 128 and 49 spawn a process, 40 of them through `src/tests/cli-capture.ts` (`c08-cli-capture`). The cut keeps the epic's fourth criterion only if these tests import their own package; the `src/tests/spec-bodies.ts` fixture and the `next-chain-*` fixtures in `src/tests` are what a cut would have to move with them.

## Cut order this implies

The cluster has two lines through it that a cut can use. The inner one is `src/board/relations/port.ts`: `labels` and `native` already sit behind one contract suite (`src/board/relations/contract.ts`), so the adapters can leave as a unit. The outer one is the `GhRunner` in `src/adapters/tracker/github.ts`, the seam every board file reaches GitHub through; moving it first removes the largest in-cluster hub and lets the board code move without it.
