# Cut table

Read from `docs/survey/import-graph.json`: 1989 files, 1961 of them in 10 packages (718 left to place) and 28 in 3 unassigned folders. Of the 4438 edges between two files neither of which is a test, value and type alike, 263 point upward, 0 of them cleared by #118, and 78 have an end in an unassigned folder and no rank.

The counts rank options. They do not certify a cut: `tsc --build` with project references is that gate (#807).

## Packages, lowest first

An upward edge leaves a package for one further down this table. A file left to place counts as a file of `@open-tomato/rafa-cli`.

| Rank | Package | Files | Source | Test | Test support | Upward edges | Cleared by #118 | Remaining |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `@open-tomato/rafa` | 217 | 105 | 110 | 2 | 11 | 0 | 11 |
| 2 | `rafa-inventory` | 102 | 51 | 51 | 0 | 26 | 0 | 26 |
| 3 | `rafa-board` | 303 | 136 | 160 | 7 | 71 | 0 | 71 |
| 4 | `rafa-pr` | 177 | 76 | 99 | 2 | 48 | 0 | 48 |
| 5 | `rafa-run` | 221 | 92 | 129 | 0 | 93 | 0 | 93 |
| 6 | `rafa-release` | 73 | 35 | 38 | 0 | 9 | 0 | 9 |
| 7 | `rafa-effort` | 70 | 36 | 34 | 0 | 5 | 0 | 5 |
| 8 | `rafa-hub` | 31 | 9 | 14 | 8 | 0 | 0 | 0 |
| 9 | `rafa-sync-service` | 10 | 4 | 5 | 1 | 0 | 0 | 0 |
| 10 | `@open-tomato/rafa-cli` | 757 | 264 | 466 | 27 | 0 | 0 | 0 |

## What each package holds by rule

A folder is followed by the files of the graph it placed. A named file is placed by name, whatever its folder.

| Package | Folders | Named files |
| --- | --- | --- |
| `@open-tomato/rafa` | `src/effort/store/` (114), `src/core/` (92), `src/ports/` (3) | `src/report/parse.ts`, `src/report/record.ts`, `src/schema/project-id.ts`, `src/schema/tiers.ts` |
| `rafa-inventory` | `src/inventory/` (28), `src/tiers/` (13), `src/schema/` (11), `src/backfill/` (10), `src/demote/` (10), `src/learning/` (10), `src/check/` (8), `src/task/` (8), `src/agents/` (4), `src/bundled/` (0) | - |
| `rafa-board` | `src/board/` (129), `src/board/project/` (41), `src/commands/issue/` (41), `src/commands/epic/` (29), `src/adapters/tracker/` (17), `src/refs/` (13), `src/commands/board/` (4) | `src/board/flags.ts`, `src/board/gate.ts`, `src/board/issue.ts`, `src/board/leak.ts`, `src/board/naming.ts`, `src/board/plan-field.ts`, `src/board/plan-spec.ts`, `src/board/previous-copy.ts`, `src/board/readiness.ts`, `src/board/review-comment.ts`, `src/board/review-stamp.ts`, `src/board/snapshot-settle.ts`, `src/board/spec-review.ts`, `src/board/spec-source.ts`, `src/board/trust.ts` |
| `rafa-pr` | `src/commands/pr/` (73), `src/pr/` (65), `src/triage/` (37) | `src/pr/index.ts` |
| `rafa-run` | `src/start/` (171), `src/claims/` (18), `src/suite/` (13), `src/commands/claim/` (9), `src/preflight/` (8) | `src/start/branch-decision.ts` |
| `rafa-release` | `src/release/` (56), `src/commands/release/` (17) | - |
| `rafa-effort` | `src/effort/` (68) | `src/schema/frontmatter.ts` |
| `rafa-hub` | `packages/rafa-hub/` (31) | - |
| `rafa-sync-service` | `packages/rafa-sync-service/` (10) | - |
| `@open-tomato/rafa-cli` | `src/cli/` (34) | `src/commands/index.ts`, `src/rafa.ts`, `src/schema/agent.ts` |

## Upward edges by pair of packages

| From | Into | Edges |
| --- | --- | --- |
| `@open-tomato/rafa` | `rafa-inventory` | 3 |
| `@open-tomato/rafa` | `rafa-board` | 1 |
| `@open-tomato/rafa` | `rafa-pr` | 1 |
| `@open-tomato/rafa` | `rafa-run` | 1 |
| `@open-tomato/rafa` | `@open-tomato/rafa-cli` | 5 |
| `rafa-inventory` | `rafa-run` | 1 |
| `rafa-inventory` | `rafa-effort` | 16 |
| `rafa-inventory` | `@open-tomato/rafa-cli` | 9 |
| `rafa-board` | `rafa-pr` | 6 |
| `rafa-board` | `rafa-run` | 11 |
| `rafa-board` | `rafa-release` | 2 |
| `rafa-board` | `rafa-effort` | 2 |
| `rafa-board` | `@open-tomato/rafa-cli` | 50 |
| `rafa-pr` | `rafa-run` | 7 |
| `rafa-pr` | `rafa-release` | 26 |
| `rafa-pr` | `@open-tomato/rafa-cli` | 15 |
| `rafa-run` | `rafa-release` | 16 |
| `rafa-run` | `rafa-effort` | 3 |
| `rafa-run` | `@open-tomato/rafa-cli` | 74 |
| `rafa-release` | `rafa-effort` | 1 |
| `rafa-release` | `@open-tomato/rafa-cli` | 8 |
| `rafa-effort` | `@open-tomato/rafa-cli` | 5 |

## The 20 files most upward edges end on

| File | Upward edges in | Counted in | Placed |
| --- | --- | --- | --- |
| `src/utils/tracker.ts` | 23 | `@open-tomato/rafa-cli` | left to place |
| `src/schema/frontmatter.ts` | 15 | `rafa-effort` | by rule |
| `src/utils/declaration.ts` | 15 | `@open-tomato/rafa-cli` | left to place |
| `src/commands/plan/plan-files.ts` | 13 | `@open-tomato/rafa-cli` | left to place |
| `src/project/scope.ts` | 10 | `@open-tomato/rafa-cli` | left to place |
| `src/config-registry.ts` | 9 | `@open-tomato/rafa-cli` | left to place |
| `src/config-schema-loop-retries.ts` | 6 | `@open-tomato/rafa-cli` | left to place |
| `src/project/position.ts` | 6 | `@open-tomato/rafa-cli` | left to place |
| `src/plan/index.ts` | 5 | `@open-tomato/rafa-cli` | left to place |
| `src/release/enabled.ts` | 5 | `rafa-release` | by rule |
| `src/release/settle.ts` | 5 | `rafa-release` | by rule |
| `src/claims/stale.ts` | 4 | `rafa-run` | by rule |
| `src/next/ending.ts` | 4 | `@open-tomato/rafa-cli` | left to place |
| `src/release/guard-merge.ts` | 4 | `rafa-release` | by rule |
| `src/release/guard.ts` | 4 | `rafa-release` | by rule |
| `src/release/version.ts` | 4 | `rafa-release` | by rule |
| `src/commands/doctor-refs.ts` | 3 | `@open-tomato/rafa-cli` | left to place |
| `src/commands/plan/refs-check.ts` | 3 | `@open-tomato/rafa-cli` | left to place |
| `src/epic/verify-plan.ts` | 3 | `@open-tomato/rafa-cli` | left to place |
| `src/modules/load.ts` | 3 | `@open-tomato/rafa-cli` | left to place |

## Edges #118 clears

Issue #118 makes each package own its config section, so these imports of a section file from `src/core/config/` go with it.

None.

## Files left to place

No rule holds these 718 files. By folder, with the upward edges that end on its files:

| Folder | Files | Not tests | Upward edges in |
| --- | --- | --- | --- |
| `src/utils/` | 16 | 9 | 51 |
| `src/` | 37 | 19 | 22 |
| `src/project/` | 27 | 13 | 19 |
| `src/commands/plan/` | 31 | 16 | 16 |
| `src/plan/` | 14 | 8 | 8 |
| `src/next/` | 50 | 19 | 7 |
| `src/bugs/` | 11 | 6 | 6 |
| `src/cleanup/` | 22 | 10 | 5 |
| `src/commands/` | 96 | 41 | 5 |
| `src/docs/` | 6 | 3 | 4 |
| `src/epic/` | 4 | 2 | 4 |
| `src/modules/` | 4 | 2 | 4 |
| `src/loop/` | 10 | 5 | 2 |
| `src/runtime/` | 5 | 3 | 2 |
| `src/adapters/logger/` | 12 | 6 | 1 |
| `src/adapters/output/` | 6 | 4 | 1 |
| `src/plan/risk/` | 10 | 5 | 1 |
| `src/report/` | 2 | 1 | 1 |
| `src/adapters/learning/` | 4 | 2 | 0 |
| `src/adapters/planner/` | 2 | 1 | 0 |
| `src/commands/agent/` | 7 | 4 | 0 |
| `src/commands/bug/` | 2 | 1 | 0 |
| `src/commands/ci/` | 2 | 1 | 0 |
| `src/commands/config/` | 5 | 2 | 0 |
| `src/commands/docs/` | 2 | 1 | 0 |
| `src/commands/effort/` | 19 | 10 | 0 |
| `src/commands/instinct/` | 11 | 6 | 0 |
| `src/commands/loop/` | 15 | 8 | 0 |
| `src/commands/module/` | 4 | 2 | 0 |
| `src/commands/skill/` | 11 | 6 | 0 |
| `src/commands/update/` | 10 | 9 | 0 |
| `src/config/` | 6 | 3 | 0 |
| `src/errors/` | 6 | 3 | 0 |
| `src/fixtures/` | 5 | 2 | 0 |
| `src/modules/testdata/hub-down-sync/` | 1 | 1 | 0 |
| `src/modules/testdata/pull-merge-sync/` | 1 | 1 | 0 |
| `src/modules/testdata/seam-fixture/` | 1 | 1 | 0 |
| `src/modules/testdata/sync-fixture/` | 1 | 1 | 0 |
| `src/notices/` | 3 | 2 | 0 |
| `src/status/` | 19 | 9 | 0 |
| `src/tests/` | 214 | 21 | 0 |
| `src/tools/ts-symbols/` | 2 | 1 | 0 |
| `src/tools/ts-symbols/fixtures/proj/src/` | 2 | 2 | 0 |

## Unassigned folders

Left for the second architect pass. A file here has no rank, so no edge that touches it is upward; the edges are counted by the package at their other end.

| Folder | Files | Imports from | Imported by |
| --- | --- | --- | --- |
| `src/ci/` | 7 | `rafa-board` (3), `@open-tomato/rafa` (1), `rafa-pr` (1) | `@open-tomato/rafa-cli` (3), `src/stretch/` (3), `src/commands/stretch/` (1) |
| `src/commands/stretch/` | 8 | `@open-tomato/rafa` (16), `src/stretch/` (12), `@open-tomato/rafa-cli` (10), `rafa-board` (5), `rafa-pr` (3), `src/ci/` (1) | `@open-tomato/rafa-cli` (5) |
| `src/stretch/` | 13 | `@open-tomato/rafa` (10), `src/ci/` (3), `@open-tomato/rafa-cli` (1), `rafa-board` (1), `rafa-pr` (1), `rafa-release` (1) | `src/commands/stretch/` (12), `@open-tomato/rafa-cli` (1) |
