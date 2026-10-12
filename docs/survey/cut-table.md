# Cut table

Read from `docs/survey/import-graph.json`: 1843 files, 1815 of them in 10 packages (675 left to place) and 28 in 3 unassigned folders. Of the 4095 edges between two files neither of which is a test, value and type alike, 285 point upward, 13 of them cleared by #118, and 78 have an end in an unassigned folder and no rank.

The counts rank options. They do not certify a cut: `tsc --build` with project references is that gate (#807).

## Packages, lowest first

An upward edge leaves a package for one further down this table. A file left to place counts as a file of `@open-tomato/rafa-cli`.

| Rank | Package | Files | Source | Test | Test support | Upward edges | Cleared by #118 | Remaining |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `@open-tomato/rafa` | 166 | 75 | 89 | 2 | 72 | 13 | 59 |
| 2 | `rafa-inventory` | 102 | 51 | 51 | 0 | 25 | 0 | 25 |
| 3 | `rafa-board` | 297 | 133 | 157 | 7 | 62 | 0 | 62 |
| 4 | `rafa-pr` | 156 | 66 | 88 | 2 | 42 | 0 | 42 |
| 5 | `rafa-run` | 197 | 85 | 112 | 0 | 73 | 0 | 73 |
| 6 | `rafa-release` | 71 | 34 | 37 | 0 | 6 | 0 | 6 |
| 7 | `rafa-effort` | 68 | 34 | 34 | 0 | 5 | 0 | 5 |
| 8 | `rafa-hub` | 31 | 9 | 14 | 8 | 0 | 0 | 0 |
| 9 | `rafa-sync-service` | 10 | 4 | 5 | 1 | 0 | 0 | 0 |
| 10 | `@open-tomato/rafa-cli` | 717 | 248 | 444 | 25 | 0 | 0 | 0 |

## What each package holds by rule

A folder is followed by the files of the graph it placed. A named file is placed by name, whatever its folder.

| Package | Folders | Named files |
| --- | --- | --- |
| `@open-tomato/rafa` | `src/effort/store/` (92), `src/core/` (64), `src/ports/` (2) | `src/report/parse.ts`, `src/report/record.ts`, `src/schema/project-id.ts`, `src/schema/tiers.ts` |
| `rafa-inventory` | `src/inventory/` (28), `src/tiers/` (13), `src/schema/` (11), `src/backfill/` (10), `src/demote/` (10), `src/learning/` (10), `src/check/` (8), `src/task/` (8), `src/agents/` (4), `src/bundled/` (0) | - |
| `rafa-board` | `src/board/` (129), `src/board/project/` (41), `src/commands/issue/` (39), `src/commands/epic/` (27), `src/adapters/tracker/` (15), `src/refs/` (13), `src/commands/board/` (4) | `src/board/flags.ts`, `src/board/gate.ts`, `src/board/issue.ts`, `src/board/leak.ts`, `src/board/naming.ts`, `src/board/plan-field.ts`, `src/board/plan-spec.ts`, `src/board/previous-copy.ts`, `src/board/readiness.ts`, `src/board/review-comment.ts`, `src/board/review-stamp.ts`, `src/board/snapshot-settle.ts`, `src/board/spec-review.ts`, `src/board/spec-source.ts`, `src/board/trust.ts` |
| `rafa-pr` | `src/commands/pr/` (68), `src/pr/` (63), `src/triage/` (23) | `src/pr/index.ts` |
| `rafa-run` | `src/start/` (147), `src/claims/` (18), `src/suite/` (13), `src/commands/claim/` (9), `src/preflight/` (8) | `src/start/branch-decision.ts` |
| `rafa-release` | `src/release/` (56), `src/commands/release/` (15) | - |
| `rafa-effort` | `src/effort/` (66) | `src/schema/frontmatter.ts` |
| `rafa-hub` | `packages/rafa-hub/` (31) | - |
| `rafa-sync-service` | `packages/rafa-sync-service/` (10) | - |
| `@open-tomato/rafa-cli` | `src/cli/` (37) | `src/commands/index.ts`, `src/rafa.ts`, `src/schema/agent.ts` |

## Upward edges by pair of packages

| From | Into | Edges |
| --- | --- | --- |
| `@open-tomato/rafa` | `rafa-inventory` | 3 |
| `@open-tomato/rafa` | `rafa-board` | 4 |
| `@open-tomato/rafa` | `rafa-pr` | 4 |
| `@open-tomato/rafa` | `rafa-run` | 2 |
| `@open-tomato/rafa` | `rafa-effort` | 14 |
| `@open-tomato/rafa` | `@open-tomato/rafa-cli` | 45 |
| `rafa-inventory` | `rafa-run` | 1 |
| `rafa-inventory` | `rafa-effort` | 16 |
| `rafa-inventory` | `@open-tomato/rafa-cli` | 8 |
| `rafa-board` | `rafa-pr` | 4 |
| `rafa-board` | `rafa-run` | 10 |
| `rafa-board` | `rafa-release` | 2 |
| `rafa-board` | `rafa-effort` | 2 |
| `rafa-board` | `@open-tomato/rafa-cli` | 44 |
| `rafa-pr` | `rafa-run` | 6 |
| `rafa-pr` | `rafa-release` | 26 |
| `rafa-pr` | `@open-tomato/rafa-cli` | 10 |
| `rafa-run` | `rafa-release` | 10 |
| `rafa-run` | `rafa-effort` | 3 |
| `rafa-run` | `@open-tomato/rafa-cli` | 60 |
| `rafa-release` | `rafa-effort` | 1 |
| `rafa-release` | `@open-tomato/rafa-cli` | 5 |
| `rafa-effort` | `@open-tomato/rafa-cli` | 5 |

## The 20 files most upward edges end on

| File | Upward edges in | Counted in | Placed |
| --- | --- | --- | --- |
| `src/utils/tracker.ts` | 19 | `@open-tomato/rafa-cli` | left to place |
| `src/schema/frontmatter.ts` | 15 | `rafa-effort` | by rule |
| `src/utils/declaration.ts` | 15 | `@open-tomato/rafa-cli` | left to place |
| `src/commands/plan/plan-files.ts` | 13 | `@open-tomato/rafa-cli` | left to place |
| `src/project/scope.ts` | 12 | `@open-tomato/rafa-cli` | left to place |
| `src/project/position.ts` | 6 | `@open-tomato/rafa-cli` | left to place |
| `src/plan/index.ts` | 5 | `@open-tomato/rafa-cli` | left to place |
| `src/runtime/identity.ts` | 5 | `@open-tomato/rafa-cli` | left to place |
| `src/utils/plan-stamp.ts` | 5 | `@open-tomato/rafa-cli` | left to place |
| `src/claims/stale.ts` | 4 | `rafa-run` | by rule |
| `src/config-schema-loop-retries.ts` | 4 | `@open-tomato/rafa-cli` | left to place |
| `src/effort/store.ts` | 4 | `rafa-effort` | by rule |
| `src/next/ending.ts` | 4 | `@open-tomato/rafa-cli` | left to place |
| `src/release/enabled.ts` | 4 | `rafa-release` | by rule |
| `src/release/guard-merge.ts` | 4 | `rafa-release` | by rule |
| `src/release/guard.ts` | 4 | `rafa-release` | by rule |
| `src/release/settle.ts` | 4 | `rafa-release` | by rule |
| `src/commands/doctor-refs.ts` | 3 | `@open-tomato/rafa-cli` | left to place |
| `src/commands/plan/refs-check.ts` | 3 | `@open-tomato/rafa-cli` | left to place |
| `src/config-schema-board-project.ts` | 3 | `@open-tomato/rafa-cli` | left to place |

## Edges #118 clears

Issue #118 makes each package own its config section, so these imports of a section file from `src/core/config/` go with it.

- `src/core/config/config-load.ts` imports `src/config-schema-logger.ts` (value)
- `src/core/config/config-schema.ts` imports `src/config-schema-board-project.ts` (value)
- `src/core/config/config-schema.ts` imports `src/config-schema-errors.ts` (value)
- `src/core/config/config-schema.ts` imports `src/config-schema-hub.ts` (value)
- `src/core/config/config-schema.ts` imports `src/config-schema-issues.ts` (value)
- `src/core/config/config-schema.ts` imports `src/config-schema-logger.ts` (value)
- `src/core/config/config-schema.ts` imports `src/config-schema-loop-continue.ts` (value)
- `src/core/config/config-schema.ts` imports `src/config-schema-loop-retries.ts` (value)
- `src/core/config/config-schema.ts` imports `src/config-schema-release.ts` (value)
- `src/core/config/config-schema.ts` imports `src/config-schema-tests.ts` (value)
- `src/core/config/config-schema.ts` imports `src/config-schema-triage.ts` (value)
- `src/core/config/config-schema.ts` imports `src/config-schema-wrap-up.ts` (value)
- `src/core/config/config.ts` imports `src/config-schema-hub.ts` (value)

## Files left to place

No rule holds these 675 files. By folder, with the upward edges that end on its files:

| Folder | Files | Not tests | Upward edges in |
| --- | --- | --- | --- |
| `src/utils/` | 15 | 8 | 48 |
| `src/` | 33 | 17 | 23 |
| `src/project/` | 27 | 13 | 21 |
| `src/commands/plan/` | 31 | 16 | 16 |
| `src/plan/` | 12 | 7 | 8 |
| `src/next/` | 49 | 19 | 7 |
| `src/adapters/output/` | 7 | 4 | 6 |
| `src/bugs/` | 11 | 6 | 6 |
| `src/commands/` | 93 | 40 | 6 |
| `src/runtime/` | 4 | 2 | 6 |
| `src/modules/` | 4 | 2 | 4 |
| `src/adapters/logger/` | 12 | 6 | 3 |
| `src/epic/` | 4 | 2 | 3 |
| `src/cleanup/` | 19 | 9 | 2 |
| `src/loop/` | 10 | 5 | 2 |
| `src/adapters/learning/` | 4 | 2 | 1 |
| `src/adapters/planner/` | 2 | 1 | 1 |
| `src/fixtures/` | 5 | 2 | 1 |
| `src/plan/risk/` | 8 | 4 | 1 |
| `src/report/` | 2 | 1 | 1 |
| `src/commands/agent/` | 7 | 4 | 0 |
| `src/commands/bug/` | 2 | 1 | 0 |
| `src/commands/ci/` | 2 | 1 | 0 |
| `src/commands/config/` | 2 | 1 | 0 |
| `src/commands/effort/` | 19 | 10 | 0 |
| `src/commands/instinct/` | 11 | 6 | 0 |
| `src/commands/loop/` | 15 | 8 | 0 |
| `src/commands/module/` | 4 | 2 | 0 |
| `src/commands/skill/` | 11 | 6 | 0 |
| `src/commands/update/` | 10 | 9 | 0 |
| `src/errors/` | 6 | 3 | 0 |
| `src/modules/testdata/hub-down-sync/` | 1 | 1 | 0 |
| `src/modules/testdata/pull-merge-sync/` | 1 | 1 | 0 |
| `src/modules/testdata/seam-fixture/` | 1 | 1 | 0 |
| `src/modules/testdata/sync-fixture/` | 1 | 1 | 0 |
| `src/notices/` | 3 | 2 | 0 |
| `src/status/` | 19 | 9 | 0 |
| `src/tests/` | 204 | 19 | 0 |
| `src/tools/ts-symbols/` | 2 | 1 | 0 |
| `src/tools/ts-symbols/fixtures/proj/src/` | 2 | 2 | 0 |

## Unassigned folders

Left for the second architect pass. A file here has no rank, so no edge that touches it is upward; the edges are counted by the package at their other end.

| Folder | Files | Imports from | Imported by |
| --- | --- | --- | --- |
| `src/ci/` | 7 | `rafa-board` (3), `@open-tomato/rafa` (1), `rafa-pr` (1) | `@open-tomato/rafa-cli` (3), `src/stretch/` (3), `src/commands/stretch/` (1) |
| `src/commands/stretch/` | 8 | `@open-tomato/rafa` (16), `src/stretch/` (12), `@open-tomato/rafa-cli` (10), `rafa-board` (5), `rafa-pr` (3), `src/ci/` (1) | `@open-tomato/rafa-cli` (5) |
| `src/stretch/` | 13 | `@open-tomato/rafa` (10), `src/ci/` (3), `@open-tomato/rafa-cli` (1), `rafa-board` (1), `rafa-pr` (1), `rafa-release` (1) | `src/commands/stretch/` (12), `@open-tomato/rafa-cli` (1) |
