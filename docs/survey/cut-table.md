# Cut table

Read from `docs/survey/import-graph.json`: 2197 files, 2169 of them in 12 packages (738 left to place) and 28 in 3 unassigned folders. Of the 4868 edges between two files neither of which is a test, value and type alike, 51 point upward, 0 of them cleared by #118, and 75 have an end in an unassigned folder and no rank.

The counts rank options. They do not certify a cut: `tsc --build` with project references is that gate (#807).

## Packages, lowest first

An upward edge leaves a package for one further down this table. A file left to place counts as a file of `@open-tomato/rafa`.

| Rank | Package | Files | Source | Test | Test support | Upward edges | Cleared by #118 | Remaining |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `rafa-eslint-config` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2 | `rafa-typescript-config` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 3 | `@open-tomato/rafa-core` | 364 | 206 | 149 | 9 | 0 | 0 | 0 |
| 4 | `rafa-inventory` | 105 | 56 | 49 | 0 | 0 | 0 | 0 |
| 5 | `rafa-board` | 301 | 156 | 137 | 8 | 2 | 0 | 2 |
| 6 | `rafa-pr` | 160 | 80 | 78 | 2 | 26 | 0 | 26 |
| 7 | `rafa-run` | 263 | 110 | 153 | 0 | 22 | 0 | 22 |
| 8 | `rafa-release` | 106 | 56 | 50 | 0 | 1 | 0 | 1 |
| 9 | `rafa-effort` | 51 | 32 | 19 | 0 | 0 | 0 | 0 |
| 10 | `rafa-hub` | 31 | 9 | 14 | 8 | 0 | 0 | 0 |
| 11 | `rafa-sync-service` | 10 | 4 | 5 | 1 | 0 | 0 | 0 |
| 12 | `@open-tomato/rafa` | 778 | 176 | 580 | 22 | 0 | 0 | 0 |

## What each package holds by rule

A folder is followed by the files of the graph it placed. A named file is placed by name, whatever its folder.

| Package | Folders | Named files |
| --- | --- | --- |
| `rafa-eslint-config` | `packages/eslint-config/` (0) | - |
| `rafa-typescript-config` | `packages/typescript-config/` (0) | - |
| `@open-tomato/rafa-core` | `packages/rafa/` (364) | - |
| `rafa-inventory` | `packages/rafa-inventory/` (104), `src/tiers/` (1), `src/bundled/` (0), `src/inventory/` (0), `src/schema/` (0) | - |
| `rafa-board` | `packages/rafa-board/` (252), `src/board/` (6), `src/commands/board/` (1), `src/commands/epic/` (1), `src/commands/issue/` (1) | `packages/rafa-board/src/board/flags.ts`, `packages/rafa-board/src/board/gate.ts`, `packages/rafa-board/src/board/issue.ts`, `packages/rafa-board/src/board/leak.ts`, `packages/rafa-board/src/board/plan-field.ts`, `packages/rafa-board/src/board/plan-spec.ts`, `packages/rafa-board/src/board/previous-copy.ts`, `packages/rafa-board/src/board/readiness.ts`, `packages/rafa-board/src/board/review-comment.ts`, `packages/rafa-board/src/board/review-stamp.ts`, `packages/rafa-board/src/board/snapshot-settle.ts`, `packages/rafa-board/src/board/spec-review.ts`, `packages/rafa-board/src/board/spec-source.ts`, `packages/rafa-board/src/board/trust.ts`, `packages/rafa-board/src/bugs/cause-rule.ts`, `packages/rafa-board/src/claims/ahead.ts`, `packages/rafa-board/src/commands/doctor-refs.ts`, `packages/rafa-board/src/commands/plan/refs-check.ts`, `packages/rafa-board/src/epic/verify-plan.ts`, `packages/rafa-board/src/epic/verify-run.ts`, `packages/rafa-board/src/next/hop-chain.ts`, `packages/rafa-board/src/next/relation-readings.ts` |
| `rafa-pr` | `packages/rafa-pr/` (134), `src/commands/pr/` (4), `src/pr/` (2), `src/triage/` (2) | `packages/rafa-pr/src/bugs/filed-values.ts`, `packages/rafa-pr/src/cleanup/branches.ts`, `packages/rafa-pr/src/cleanup/groups.ts`, `packages/rafa-pr/src/cleanup/worktrees.ts`, `packages/rafa-pr/src/docs/task-reading.ts`, `packages/rafa-pr/src/plan/risk.ts`, `packages/rafa-pr/src/plan/risk/accounts.ts`, `packages/rafa-pr/src/start/pr-retarget.ts`, `packages/rafa-pr/src/pr/index.ts` |
| `rafa-run` | `src/start/` (175), `src/commands/claim/` (15), `src/suite/` (12), `src/claims/` (11), `src/preflight/` (10), `packages/rafa-run/` (0) | `src/cleanup/index.ts`, `src/cleanup/remote-only.ts`, `src/cleanup/runs.ts`, `src/cleanup/steps.ts`, `src/commands/switch.ts`, `src/loop/events-file.ts`, `src/next/actions.ts`, `src/next/ending.ts`, `src/next/hint.ts`, `src/next/hop-action.ts`, `src/next/hop-rows.ts`, `src/next/owner-gate.ts`, `src/next/preconditions.ts`, `src/next/readings.ts`, `src/next/relations-mode.ts`, `src/next/settle-step.ts`, `src/next/sources.ts`, `src/next/state.ts`, `src/plan/list.ts`, `src/plan/store-rules.ts`, `src/runtime/install.ts` |
| `rafa-release` | `packages/rafa-release/` (92), `src/commands/release/` (3), `src/release/` (1) | `packages/rafa-release/src/cleanup/past-head.ts`, `packages/rafa-release/src/commands/doctor-ladder.ts`, `packages/rafa-release/src/docs/open-lines.ts`, `packages/rafa-release/src/docs/release-issue.ts`, `packages/rafa-release/src/next/epic-end.ts`, `packages/rafa-release/src/project/lock.ts` |
| `rafa-effort` | `packages/rafa-effort/` (51) | - |
| `rafa-hub` | `packages/rafa-hub/` (31) | - |
| `rafa-sync-service` | `packages/rafa-sync-service/` (10) | - |
| `@open-tomato/rafa` | `src/cli/` (30) | `src/commands/index.ts`, `src/effort/store/index.ts`, `src/inventory/browse.ts`, `src/plan/index.ts`, `src/rafa.ts`, `src/schema/agent.ts` |

## Upward edges by pair of packages

| From | Into | Edges |
| --- | --- | --- |
| `rafa-board` | `rafa-effort` | 2 |
| `rafa-pr` | `rafa-release` | 26 |
| `rafa-run` | `rafa-release` | 21 |
| `rafa-run` | `rafa-effort` | 1 |
| `rafa-release` | `rafa-effort` | 1 |

## The 20 files most upward edges end on

| File | Upward edges in | Counted in | Placed |
| --- | --- | --- | --- |
| `packages/rafa-release/src/release/guard-merge.ts` | 6 | `rafa-release` | by rule |
| `packages/rafa-release/src/release/enabled.ts` | 5 | `rafa-release` | by rule |
| `packages/rafa-release/src/release/settle.ts` | 5 | `rafa-release` | by rule |
| `packages/rafa-release/src/release/guard.ts` | 4 | `rafa-release` | by rule |
| `packages/rafa-release/src/release/version.ts` | 4 | `rafa-release` | by rule |
| `packages/rafa-release/src/cleanup/past-head.ts` | 3 | `rafa-release` | by rule |
| `packages/rafa-release/src/release/prepare.ts` | 3 | `rafa-release` | by rule |
| `packages/rafa-release/src/release/branch-forecast.ts` | 2 | `rafa-release` | by rule |
| `packages/rafa-release/src/release/forecast.ts` | 2 | `rafa-release` | by rule |
| `packages/rafa-release/src/release/release-delivery.ts` | 2 | `rafa-release` | by rule |
| `packages/rafa-effort/src/effort/attribution.ts` | 1 | `rafa-effort` | by rule |
| `packages/rafa-effort/src/effort/epic-cost.ts` | 1 | `rafa-effort` | by rule |
| `packages/rafa-effort/src/effort/file-stamp.ts` | 1 | `rafa-effort` | by rule |
| `packages/rafa-effort/src/effort/sync/doctor-reading.ts` | 1 | `rafa-effort` | by rule |
| `packages/rafa-release/src/commands/release/status-fragments.ts` | 1 | `rafa-release` | by rule |
| `packages/rafa-release/src/docs/release-issue.ts` | 1 | `rafa-release` | by rule |
| `packages/rafa-release/src/next/epic-end.ts` | 1 | `rafa-release` | by rule |
| `packages/rafa-release/src/release/body-forecast.ts` | 1 | `rafa-release` | by rule |
| `packages/rafa-release/src/release/changelog.ts` | 1 | `rafa-release` | by rule |
| `packages/rafa-release/src/release/fragment-tree.ts` | 1 | `rafa-release` | by rule |

## Edges #118 clears

Issue #118 makes each package own its config section, so these imports of a section file from `packages/rafa/src/core/config/` go with it.

None.

## Files left to place

No rule holds these 738 files. By folder, with the upward edges that end on its files:

| Folder | Files | Not tests | Upward edges in |
| --- | --- | --- | --- |
| `src/` | 16 | 8 | 0 |
| `src/adapters/output/` | 2 | 1 | 0 |
| `src/adapters/planner/` | 2 | 1 | 0 |
| `src/bugs/` | 4 | 2 | 0 |
| `src/cleanup/` | 6 | 2 | 0 |
| `src/commands/` | 91 | 39 | 0 |
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
| `src/next/` | 16 | 3 | 0 |
| `src/notices/` | 3 | 2 | 0 |
| `src/plan/` | 2 | 1 | 0 |
| `src/ports/` | 1 | 1 | 0 |
| `src/project/` | 11 | 6 | 0 |
| `src/status/` | 19 | 9 | 0 |
| `src/tests/` | 225 | 19 | 0 |
| `src/tests/board-coupled/adapters/tracker/` | 2 | 0 | 0 |
| `src/tests/board-coupled/board/` | 8 | 0 | 0 |
| `src/tests/board-coupled/board/project/` | 1 | 0 | 0 |
| `src/tests/board-coupled/commands/` | 2 | 0 | 0 |
| `src/tests/board-coupled/commands/board/` | 2 | 0 | 0 |
| `src/tests/board-coupled/commands/epic/` | 13 | 0 | 0 |
| `src/tests/board-coupled/commands/issue/` | 16 | 0 | 0 |
| `src/tests/board-coupled/commands/plan/` | 1 | 0 | 0 |
| `src/tests/board-coupled/refs/` | 2 | 0 | 0 |
| `src/tests/core-coupled/` | 14 | 0 | 0 |
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
| `src/tests/effort-coupled/effort/` | 7 | 0 | 0 |
| `src/tests/effort-coupled/effort/sync/` | 5 | 0 | 0 |
| `src/tests/inventory-coupled/adapters/learning/` | 1 | 0 | 0 |
| `src/tests/inventory-coupled/agents/` | 2 | 0 | 0 |
| `src/tests/inventory-coupled/inventory/search/` | 1 | 0 | 0 |
| `src/tests/inventory-coupled/plan/risk/` | 1 | 0 | 0 |
| `src/tests/inventory-coupled/tiers/` | 2 | 0 | 0 |
| `src/tests/pr-coupled/commands/pr/` | 27 | 0 | 0 |
| `src/tests/pr-coupled/pr/` | 2 | 0 | 0 |
| `src/tests/pr-coupled/triage/` | 1 | 0 | 0 |
| `src/tests/release-coupled/commands/` | 1 | 0 | 0 |
| `src/tests/release-coupled/commands/release/` | 15 | 0 | 0 |
| `src/tests/release-coupled/docs/` | 1 | 0 | 0 |
| `src/tests/release-coupled/next/` | 1 | 0 | 0 |
| `src/tests/release-coupled/release/` | 4 | 0 | 0 |
| `src/tools/ts-symbols/` | 2 | 1 | 0 |
| `src/tools/ts-symbols/fixtures/proj/src/` | 2 | 2 | 0 |
| `src/utils/` | 3 | 2 | 0 |

## Unassigned folders

Left for the second architect pass. A file here has no rank, so no edge that touches it is upward; the edges are counted by the package at their other end.

| Folder | Files | Imports from | Imported by |
| --- | --- | --- | --- |
| `src/ci/` | 7 | `rafa-board` (3), `@open-tomato/rafa-core` (1), `rafa-pr` (1) | `@open-tomato/rafa` (3), `src/stretch/` (3), `src/commands/stretch/` (1) |
| `src/commands/stretch/` | 8 | `@open-tomato/rafa-core` (21), `src/stretch/` (12), `rafa-board` (4), `rafa-pr` (4), `@open-tomato/rafa` (2), `rafa-run` (1), `src/ci/` (1) | `@open-tomato/rafa` (5) |
| `src/stretch/` | 13 | `@open-tomato/rafa-core` (11), `src/ci/` (3), `rafa-board` (1), `rafa-release` (1) | `src/commands/stretch/` (12), `@open-tomato/rafa` (1) |
