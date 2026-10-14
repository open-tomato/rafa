# Cut table

Read from `docs/survey/import-graph.json`: 1934 files, 1906 of them in 10 packages (699 left to place) and 28 in 3 unassigned folders. Of the 4320 edges between two files neither of which is a test, value and type alike, 308 point upward, 13 of them cleared by #118, and 78 have an end in an unassigned folder and no rank.

The counts rank options. They do not certify a cut: `tsc --build` with project references is that gate (#807).

## Packages, lowest first

An upward edge leaves a package for one further down this table. A file left to place counts as a file of `@open-tomato/rafa-cli`.

| Rank | Package | Files | Source | Test | Test support | Upward edges | Cleared by #118 | Remaining |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `@open-tomato/rafa` | 178 | 80 | 96 | 2 | 64 | 13 | 51 |
| 2 | `rafa-inventory` | 102 | 51 | 51 | 0 | 25 | 0 | 25 |
| 3 | `rafa-board` | 303 | 136 | 160 | 7 | 67 | 0 | 67 |
| 4 | `rafa-pr` | 176 | 75 | 99 | 2 | 48 | 0 | 48 |
| 5 | `rafa-run` | 221 | 92 | 129 | 0 | 91 | 0 | 91 |
| 6 | `rafa-release` | 73 | 35 | 38 | 0 | 8 | 0 | 8 |
| 7 | `rafa-effort` | 71 | 36 | 35 | 0 | 5 | 0 | 5 |
| 8 | `rafa-hub` | 31 | 9 | 14 | 8 | 0 | 0 | 0 |
| 9 | `rafa-sync-service` | 10 | 4 | 5 | 1 | 0 | 0 | 0 |
| 10 | `@open-tomato/rafa-cli` | 741 | 257 | 458 | 26 | 0 | 0 | 0 |

## What each package holds by rule

A folder is followed by the files of the graph it placed. A named file is placed by name, whatever its folder.

| Package | Folders | Named files |
| --- | --- | --- |
| `@open-tomato/rafa` | `src/effort/store/` (100), `src/core/` (68), `src/ports/` (2) | `src/report/parse.ts`, `src/report/record.ts`, `src/schema/project-id.ts`, `src/schema/tiers.ts` |
| `rafa-inventory` | `src/inventory/` (28), `src/tiers/` (13), `src/schema/` (11), `src/backfill/` (10), `src/demote/` (10), `src/learning/` (10), `src/check/` (8), `src/task/` (8), `src/agents/` (4), `src/bundled/` (0) | - |
| `rafa-board` | `src/board/` (129), `src/board/project/` (41), `src/commands/issue/` (41), `src/commands/epic/` (29), `src/adapters/tracker/` (17), `src/refs/` (13), `src/commands/board/` (4) | `src/board/flags.ts`, `src/board/gate.ts`, `src/board/issue.ts`, `src/board/leak.ts`, `src/board/naming.ts`, `src/board/plan-field.ts`, `src/board/plan-spec.ts`, `src/board/previous-copy.ts`, `src/board/readiness.ts`, `src/board/review-comment.ts`, `src/board/review-stamp.ts`, `src/board/snapshot-settle.ts`, `src/board/spec-review.ts`, `src/board/spec-source.ts`, `src/board/trust.ts` |
| `rafa-pr` | `src/commands/pr/` (71), `src/pr/` (65), `src/triage/` (38) | `src/pr/index.ts` |
| `rafa-run` | `src/start/` (171), `src/claims/` (18), `src/suite/` (13), `src/commands/claim/` (9), `src/preflight/` (8) | `src/start/branch-decision.ts` |
| `rafa-release` | `src/release/` (56), `src/commands/release/` (17) | - |
| `rafa-effort` | `src/effort/` (69) | `src/schema/frontmatter.ts` |
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
| `@open-tomato/rafa` | `rafa-effort` | 10 |
| `@open-tomato/rafa` | `@open-tomato/rafa-cli` | 41 |
| `rafa-inventory` | `rafa-run` | 1 |
| `rafa-inventory` | `rafa-effort` | 16 |
| `rafa-inventory` | `@open-tomato/rafa-cli` | 8 |
| `rafa-board` | `rafa-pr` | 6 |
| `rafa-board` | `rafa-run` | 11 |
| `rafa-board` | `rafa-release` | 2 |
| `rafa-board` | `rafa-effort` | 2 |
| `rafa-board` | `@open-tomato/rafa-cli` | 46 |
| `rafa-pr` | `rafa-run` | 7 |
| `rafa-pr` | `rafa-release` | 26 |
| `rafa-pr` | `@open-tomato/rafa-cli` | 15 |
| `rafa-run` | `rafa-release` | 16 |
| `rafa-run` | `rafa-effort` | 3 |
| `rafa-run` | `@open-tomato/rafa-cli` | 72 |
| `rafa-release` | `rafa-effort` | 1 |
| `rafa-release` | `@open-tomato/rafa-cli` | 7 |
| `rafa-effort` | `@open-tomato/rafa-cli` | 5 |

## The 20 files most upward edges end on

| File | Upward edges in | Counted in | Placed |
| --- | --- | --- | --- |
| `src/utils/tracker.ts` | 23 | `@open-tomato/rafa-cli` | left to place |
| `src/utils/declaration.ts` | 19 | `@open-tomato/rafa-cli` | left to place |
| `src/schema/frontmatter.ts` | 15 | `rafa-effort` | by rule |
| `src/commands/plan/plan-files.ts` | 13 | `@open-tomato/rafa-cli` | left to place |
| `src/project/scope.ts` | 13 | `@open-tomato/rafa-cli` | left to place |
| `src/config-schema-loop-retries.ts` | 7 | `@open-tomato/rafa-cli` | left to place |
| `src/project/position.ts` | 6 | `@open-tomato/rafa-cli` | left to place |
| `src/plan/index.ts` | 5 | `@open-tomato/rafa-cli` | left to place |
| `src/release/enabled.ts` | 5 | `rafa-release` | by rule |
| `src/release/settle.ts` | 5 | `rafa-release` | by rule |
| `src/utils/plan-stamp.ts` | 5 | `@open-tomato/rafa-cli` | left to place |
| `src/claims/stale.ts` | 4 | `rafa-run` | by rule |
| `src/next/ending.ts` | 4 | `@open-tomato/rafa-cli` | left to place |
| `src/release/guard-merge.ts` | 4 | `rafa-release` | by rule |
| `src/release/guard.ts` | 4 | `rafa-release` | by rule |
| `src/release/version.ts` | 4 | `rafa-release` | by rule |
| `src/commands/doctor-refs.ts` | 3 | `@open-tomato/rafa-cli` | left to place |
| `src/commands/plan/refs-check.ts` | 3 | `@open-tomato/rafa-cli` | left to place |
| `src/config-schema-board-project.ts` | 3 | `@open-tomato/rafa-cli` | left to place |
| `src/config-schema-hub.ts` | 3 | `@open-tomato/rafa-cli` | left to place |

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

No rule holds these 699 files. By folder, with the upward edges that end on its files:

| Folder | Files | Not tests | Upward edges in |
| --- | --- | --- | --- |
| `src/utils/` | 17 | 9 | 57 |
| `src/` | 33 | 17 | 26 |
| `src/project/` | 27 | 13 | 22 |
| `src/commands/plan/` | 31 | 16 | 16 |
| `src/plan/` | 14 | 8 | 8 |
| `src/next/` | 50 | 19 | 7 |
| `src/adapters/output/` | 7 | 4 | 6 |
| `src/bugs/` | 11 | 6 | 6 |
| `src/cleanup/` | 22 | 10 | 5 |
| `src/commands/` | 94 | 40 | 5 |
| `src/docs/` | 6 | 3 | 4 |
| `src/epic/` | 4 | 2 | 4 |
| `src/modules/` | 4 | 2 | 4 |
| `src/adapters/logger/` | 12 | 6 | 3 |
| `src/runtime/` | 5 | 3 | 3 |
| `src/loop/` | 10 | 5 | 2 |
| `src/adapters/learning/` | 4 | 2 | 1 |
| `src/adapters/planner/` | 2 | 1 | 1 |
| `src/fixtures/` | 5 | 2 | 1 |
| `src/plan/risk/` | 10 | 5 | 1 |
| `src/report/` | 2 | 1 | 1 |
| `src/commands/agent/` | 7 | 4 | 0 |
| `src/commands/bug/` | 2 | 1 | 0 |
| `src/commands/ci/` | 2 | 1 | 0 |
| `src/commands/config/` | 3 | 1 | 0 |
| `src/commands/docs/` | 2 | 1 | 0 |
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
| `src/tests/` | 207 | 20 | 0 |
| `src/tools/ts-symbols/` | 2 | 1 | 0 |
| `src/tools/ts-symbols/fixtures/proj/src/` | 2 | 2 | 0 |

## Unassigned folders

Left for the second architect pass. A file here has no rank, so no edge that touches it is upward; the edges are counted by the package at their other end.

| Folder | Files | Imports from | Imported by |
| --- | --- | --- | --- |
| `src/ci/` | 7 | `rafa-board` (3), `@open-tomato/rafa` (1), `rafa-pr` (1) | `@open-tomato/rafa-cli` (3), `src/stretch/` (3), `src/commands/stretch/` (1) |
| `src/commands/stretch/` | 8 | `@open-tomato/rafa` (16), `src/stretch/` (12), `@open-tomato/rafa-cli` (10), `rafa-board` (5), `rafa-pr` (3), `src/ci/` (1) | `@open-tomato/rafa-cli` (5) |
| `src/stretch/` | 13 | `@open-tomato/rafa` (10), `src/ci/` (3), `@open-tomato/rafa-cli` (1), `rafa-board` (1), `rafa-pr` (1), `rafa-release` (1) | `src/commands/stretch/` (12), `@open-tomato/rafa-cli` (1) |
