# Cut table

Read from `docs/survey/import-graph.json`: 2167 files, 2139 of them in 12 packages (618 left to place) and 28 in 3 unassigned folders. Of the 4811 edges between two files neither of which is a test, value and type alike, 111 point upward, 0 of them cleared by #118, and 77 have an end in an unassigned folder and no rank.

The counts rank options. They do not certify a cut: `tsc --build` with project references is that gate (#807).

## Packages, lowest first

An upward edge leaves a package for one further down this table. A file left to place counts as a file of `@open-tomato/rafa`.

| Rank | Package | Files | Source | Test | Test support | Upward edges | Cleared by #118 | Remaining |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `rafa-eslint-config` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2 | `rafa-typescript-config` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 3 | `@open-tomato/rafa-core` | 295 | 168 | 121 | 6 | 0 | 0 | 0 |
| 4 | `rafa-inventory` | 114 | 57 | 57 | 0 | 4 | 0 | 4 |
| 5 | `rafa-board` | 341 | 155 | 179 | 7 | 33 | 0 | 33 |
| 6 | `rafa-pr` | 215 | 93 | 120 | 2 | 55 | 0 | 55 |
| 7 | `rafa-run` | 284 | 121 | 163 | 0 | 18 | 0 | 18 |
| 8 | `rafa-release` | 125 | 55 | 70 | 0 | 1 | 0 | 1 |
| 9 | `rafa-effort` | 66 | 34 | 32 | 0 | 0 | 0 | 0 |
| 10 | `rafa-hub` | 31 | 9 | 14 | 8 | 0 | 0 | 0 |
| 11 | `rafa-sync-service` | 10 | 4 | 5 | 1 | 0 | 0 | 0 |
| 12 | `@open-tomato/rafa` | 658 | 175 | 457 | 26 | 0 | 0 | 0 |

## What each package holds by rule

A folder is followed by the files of the graph it placed. A named file is placed by name, whatever its folder.

| Package | Folders | Named files |
| --- | --- | --- |
| `rafa-eslint-config` | `packages/eslint-config/` (0) | - |
| `rafa-typescript-config` | `packages/typescript-config/` (0) | - |
| `@open-tomato/rafa-core` | `packages/rafa/` (295) | - |
| `rafa-inventory` | `src/inventory/` (28), `src/tiers/` (13), `src/schema/` (11), `src/backfill/` (10), `src/demote/` (10), `src/learning/` (10), `src/check/` (8), `src/task/` (8), `src/agents/` (4), `packages/rafa-inventory/` (0), `src/bundled/` (0) | `src/adapters/learning/held.ts`, `src/adapters/learning/local.ts`, `src/plan/risk/commands.ts`, `src/plan/risk/long-runs.ts`, `src/report/lessons.ts`, `src/start/serving.ts` |
| `rafa-board` | `src/board/` (136), `src/commands/issue/` (44), `src/board/project/` (43), `src/commands/epic/` (35), `src/adapters/tracker/` (19), `src/refs/` (13), `src/commands/board/` (8), `packages/rafa-board/` (0) | `src/board/flags.ts`, `src/board/gate.ts`, `src/board/issue.ts`, `src/board/leak.ts`, `src/board/plan-field.ts`, `src/board/plan-spec.ts`, `src/board/previous-copy.ts`, `src/board/readiness.ts`, `src/board/review-comment.ts`, `src/board/review-stamp.ts`, `src/board/snapshot-settle.ts`, `src/board/spec-review.ts`, `src/board/spec-source.ts`, `src/board/trust.ts`, `src/bugs/cause-rule.ts`, `src/commands/doctor-refs.ts`, `src/commands/plan/refs-check.ts`, `src/config-schema-board-project.ts`, `src/config-schema-issues.ts`, `src/epic/verify-plan.ts`, `src/next/hop-chain.ts`, `src/next/relation-readings.ts` |
| `rafa-pr` | `src/commands/pr/` (79), `src/pr/` (65), `src/triage/` (36), `packages/rafa-pr/` (0) | `src/bugs/filed-values.ts`, `src/bugs/fill.ts`, `src/bugs/versions.ts`, `src/cleanup/branches.ts`, `src/cleanup/groups.ts`, `src/cleanup/steps.ts`, `src/config-schema-readings.ts`, `src/config-schema-triage.ts`, `src/docs/open-lines.ts`, `src/docs/release-issue.ts`, `src/docs/task-reading.ts`, `src/next/owner-gate.ts`, `src/next/relations-mode.ts`, `src/next/settle-step.ts`, `src/next/sources.ts`, `src/plan/risk.ts`, `src/plan/risk/accounts.ts`, `src/pr/index.ts` |
| `rafa-run` | `src/start/` (175), `src/claims/` (19), `src/suite/` (18), `src/commands/claim/` (15), `src/preflight/` (8), `packages/rafa-run/` (0) | `src/cleanup/index.ts`, `src/cleanup/remote-only.ts`, `src/cleanup/runs.ts`, `src/cleanup/worktrees.ts`, `src/commands/switch.ts`, `src/config-schema-checks.ts`, `src/config-schema-loop-continue.ts`, `src/config-schema-loop-retries.ts`, `src/config-schema-tests.ts`, `src/config-schema-wrap-up.ts`, `src/epic/verify-run.ts`, `src/loop/events-file.ts`, `src/next/actions.ts`, `src/next/ending.ts`, `src/next/hint.ts`, `src/next/hop-action.ts`, `src/next/hop-rows.ts`, `src/next/preconditions.ts`, `src/next/readings.ts`, `src/next/state.ts`, `src/plan/index.ts`, `src/plan/list.ts`, `src/plan/store-rules.ts`, `src/plan/validate.ts`, `src/runtime/install.ts`, `src/start/branch-decision.ts` |
| `rafa-release` | `src/release/` (73), `src/commands/release/` (42), `packages/rafa-release/` (0) | `src/cleanup/past-head.ts`, `src/commands/doctor-ladder.ts`, `src/config-schema-release.ts`, `src/next/epic-end.ts`, `src/project/lock.ts` |
| `rafa-effort` | `src/effort/` (64), `packages/rafa-effort/` (0) | `src/config-schema-hub.ts` |
| `rafa-hub` | `packages/rafa-hub/` (31) | - |
| `rafa-sync-service` | `packages/rafa-sync-service/` (10) | - |
| `@open-tomato/rafa` | `src/cli/` (35) | `src/commands/index.ts`, `src/rafa.ts`, `src/schema/agent.ts` |

## Upward edges by pair of packages

| From | Into | Edges |
| --- | --- | --- |
| `rafa-inventory` | `rafa-effort` | 1 |
| `rafa-inventory` | `@open-tomato/rafa` | 3 |
| `rafa-board` | `rafa-pr` | 8 |
| `rafa-board` | `rafa-run` | 16 |
| `rafa-board` | `rafa-release` | 1 |
| `rafa-board` | `rafa-effort` | 2 |
| `rafa-board` | `@open-tomato/rafa` | 6 |
| `rafa-pr` | `rafa-run` | 20 |
| `rafa-pr` | `rafa-release` | 34 |
| `rafa-pr` | `@open-tomato/rafa` | 1 |
| `rafa-run` | `rafa-release` | 16 |
| `rafa-run` | `rafa-effort` | 1 |
| `rafa-run` | `@open-tomato/rafa` | 1 |
| `rafa-release` | `rafa-effort` | 1 |

## The 20 files most upward edges end on

| File | Upward edges in | Counted in | Placed |
| --- | --- | --- | --- |
| `src/release/guard-merge.ts` | 6 | `rafa-release` | by rule |
| `src/release/enabled.ts` | 5 | `rafa-release` | by rule |
| `src/release/settle.ts` | 5 | `rafa-release` | by rule |
| `src/release/version.ts` | 5 | `rafa-release` | by rule |
| `src/triage/triage.ts` | 5 | `rafa-pr` | by rule |
| `src/claims/stale.ts` | 4 | `rafa-run` | by rule |
| `src/cli/describe.ts` | 4 | `@open-tomato/rafa` | by rule |
| `src/next/ending.ts` | 4 | `rafa-run` | by rule |
| `src/release/guard.ts` | 4 | `rafa-release` | by rule |
| `src/cleanup/past-head.ts` | 3 | `rafa-release` | by rule |
| `src/cleanup/worktrees.ts` | 3 | `rafa-run` | by rule |
| `src/next/readings.ts` | 3 | `rafa-run` | by rule |
| `src/release/forecast.ts` | 3 | `rafa-release` | by rule |
| `src/release/fragment-tree.ts` | 3 | `rafa-release` | by rule |
| `src/release/prepare.ts` | 3 | `rafa-release` | by rule |
| `src/cli/registry.ts` | 2 | `@open-tomato/rafa` | by rule |
| `src/commands/switch.ts` | 2 | `rafa-run` | by rule |
| `src/config-schema-loop-retries.ts` | 2 | `rafa-run` | by rule |
| `src/epic/verify-run.ts` | 2 | `rafa-run` | by rule |
| `src/release/branch-forecast.ts` | 2 | `rafa-release` | by rule |

## Edges #118 clears

Issue #118 makes each package own its config section, so these imports of a section file from `packages/rafa/src/core/config/` go with it.

None.

## Files left to place

No rule holds these 618 files. By folder, with the upward edges that end on its files:

| Folder | Files | Not tests | Upward edges in |
| --- | --- | --- | --- |
| `src/` | 14 | 7 | 0 |
| `src/adapters/output/` | 2 | 1 | 0 |
| `src/adapters/planner/` | 2 | 1 | 0 |
| `src/bugs/` | 4 | 2 | 0 |
| `src/cleanup/` | 6 | 2 | 0 |
| `src/commands/` | 93 | 39 | 0 |
| `src/commands/agent/` | 7 | 4 | 0 |
| `src/commands/bug/` | 9 | 4 | 0 |
| `src/commands/ci/` | 2 | 1 | 0 |
| `src/commands/config/` | 6 | 2 | 0 |
| `src/commands/docs/` | 2 | 1 | 0 |
| `src/commands/effort/` | 19 | 10 | 0 |
| `src/commands/instinct/` | 11 | 6 | 0 |
| `src/commands/loop/` | 15 | 8 | 0 |
| `src/commands/module/` | 4 | 2 | 0 |
| `src/commands/plan/` | 29 | 15 | 0 |
| `src/commands/skill/` | 11 | 6 | 0 |
| `src/commands/update/` | 10 | 9 | 0 |
| `src/config/` | 8 | 4 | 0 |
| `src/errors/` | 6 | 3 | 0 |
| `src/fixtures/` | 5 | 2 | 0 |
| `src/loop/` | 6 | 3 | 0 |
| `src/modules/` | 1 | 0 | 0 |
| `src/modules/testdata/pull-merge-sync/` | 1 | 1 | 0 |
| `src/next/` | 18 | 3 | 0 |
| `src/notices/` | 3 | 2 | 0 |
| `src/plan/` | 2 | 1 | 0 |
| `src/ports/` | 1 | 1 | 0 |
| `src/project/` | 11 | 6 | 0 |
| `src/status/` | 19 | 9 | 0 |
| `src/tests/` | 231 | 23 | 0 |
| `src/tests/core-coupled/` | 4 | 0 | 0 |
| `src/tests/core-coupled/adapters/logger/` | 3 | 0 | 0 |
| `src/tests/core-coupled/bugs/` | 3 | 0 | 0 |
| `src/tests/core-coupled/commands/plan/` | 1 | 0 | 0 |
| `src/tests/core-coupled/core/command/` | 1 | 0 | 0 |
| `src/tests/core-coupled/core/config/` | 6 | 0 | 0 |
| `src/tests/core-coupled/core/loop/` | 1 | 0 | 0 |
| `src/tests/core-coupled/core/output/` | 2 | 0 | 0 |
| `src/tests/core-coupled/core/runtime/` | 1 | 0 | 0 |
| `src/tests/core-coupled/effort/store/` | 15 | 0 | 0 |
| `src/tests/core-coupled/errors/` | 1 | 0 | 0 |
| `src/tests/core-coupled/modules/` | 1 | 0 | 0 |
| `src/tests/core-coupled/next/` | 1 | 0 | 0 |
| `src/tests/core-coupled/plan/` | 1 | 0 | 0 |
| `src/tests/core-coupled/ports/` | 1 | 0 | 0 |
| `src/tests/core-coupled/project/` | 5 | 0 | 0 |
| `src/tests/core-coupled/report/` | 1 | 0 | 0 |
| `src/tests/core-coupled/schema/` | 1 | 0 | 0 |
| `src/tests/core-coupled/start/` | 1 | 0 | 0 |
| `src/tests/core-coupled/utils/` | 3 | 0 | 0 |
| `src/tools/ts-symbols/` | 2 | 1 | 0 |
| `src/tools/ts-symbols/fixtures/proj/src/` | 2 | 2 | 0 |
| `src/utils/` | 3 | 2 | 0 |

## Unassigned folders

Left for the second architect pass. A file here has no rank, so no edge that touches it is upward; the edges are counted by the package at their other end.

| Folder | Files | Imports from | Imported by |
| --- | --- | --- | --- |
| `src/ci/` | 7 | `rafa-board` (3), `@open-tomato/rafa-core` (1), `rafa-pr` (1) | `@open-tomato/rafa` (3), `src/stretch/` (3), `src/commands/stretch/` (1) |
| `src/commands/stretch/` | 8 | `@open-tomato/rafa-core` (20), `src/stretch/` (12), `rafa-pr` (7), `rafa-board` (4), `@open-tomato/rafa` (2), `rafa-run` (1), `src/ci/` (1) | `@open-tomato/rafa` (5) |
| `src/stretch/` | 13 | `@open-tomato/rafa-core` (10), `src/ci/` (3), `rafa-board` (1), `rafa-pr` (1), `rafa-release` (1) | `src/commands/stretch/` (12), `@open-tomato/rafa` (1) |
