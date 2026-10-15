# Import graph

Coverage: 2005 of 2005 tracked files read (src/ and packages/*/src/).

2005 files, 10389 edges (8153 value, 2236 type), 26 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 370 | `src/board` (118), `src/board/project` (41), `src/commands` (31), `src/commands/epic` (27), `src/commands/issue` (27), `src/tests` (26), `src/board/relations` (19), `src/next` (17), `src/commands/plan` (10), `src/status` (10), `src/commands/pr` (6), `src/core/git` (6), `src/claims` (5), `src/commands/board` (4), `src/epic` (4), `src/suite` (4), `src/pr` (3), `src/start` (3), `src/adapters/tracker` (2), `src/commands/release` (2), `src/project` (2), `src/cleanup` (1), `src/core/loop` (1), `src/refs` (1) |
| `c02-index` | 309 | `src/start` (120), `src/tests` (23), `src/triage` (23), `src/adapters/tracker` (15), `src/adapters/logger` (12), `src/bugs` (11), `src/commands/issue` (10), `src/learning` (10), `src/commands/instinct` (9), `src/suite` (9), `src/core/output` (7), `src/utils` (6), `src/adapters/output` (5), `src/docs` (5), `src/task` (5), `src/adapters/learning` (4), `src/core/adapters` (4), `src/ports` (3), `src/report` (3), `src/schema` (3), `src` (2), `src/commands/docs` (2), `src/commands/release` (2), `src/fixtures` (2), `src/modules` (2), `src/project` (2), `src/cli` (1), `src/commands/epic` (1), `src/commands/plan` (1), `src/core/git` (1), `src/core/plan` (1), `src/modules/testdata/hub-down-sync` (1), `src/modules/testdata/pull-merge-sync` (1), `src/modules/testdata/sync-fixture` (1), `src/notices` (1), `src/preflight` (1) |
| `c03-index` | 249 | `src/commands/pr` (45), `src/next` (31), `src/cli` (17), `src/start` (16), `src/commands` (14), `src/claims` (12), `src/tests` (11), `src/commands/update` (10), `src/project` (9), `src/commands/claim` (8), `src/commands/loop` (8), `src/pr` (8), `src/commands/plan` (7), `src/status` (7), `src/board` (5), `src/cli/core` (5), `src/commands/agent` (5), `src/commands/skill` (5), `src/commands/module` (4), `src/commands/effort` (3), `src` (2), `src/commands/config` (2), `src/commands/issue` (2), `src/effort/sync` (2), `src/loop` (2), `src/adapters/output` (1), `src/commands/instinct` (1), `src/core/command` (1), `src/core/config` (1), `src/core/loop` (1), `src/inventory` (1), `src/modules` (1), `src/modules/testdata/seam-fixture` (1), `src/utils` (1) |
| `c04-sqlite` | 242 | `src/effort/store` (106), `src/effort` (59), `src/commands/effort` (15), `src/tests` (14), `src/triage` (12), `src/inventory/search` (10), `src/core/runtime` (4), `src/effort/store/testdata` (4), `src/commands` (3), `src/effort/sync` (3), `src/report` (3), `src/start` (2), `src/utils` (2), `src/claims` (1), `src/commands/claim` (1), `src/commands/epic` (1), `src/docs` (1), `src/runtime` (1) |
| `c05-cli-capture` | 232 | `src/tests` (91), `src/release` (48), `src/start` (23), `src/commands/release` (13), `src/commands/loop` (7), `src/commands/pr` (7), `src/project` (7), `src/loop` (6), `src/commands` (5), `src/runtime` (4), `src/utils` (3), `src` (2), `src/next` (2), `src/pr` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src/cleanup` (1), `src/commands/bug` (1), `src/commands/config` (1), `src/commands/effort` (1), `src/commands/skill` (1), `src/commands/stretch` (1), `src/core/loop` (1), `src/notices` (1) |
| `c06-index` | 224 | `src/commands` (31), `src/core/config` (29), `src` (28), `src/core/command` (13), `src/tiers` (13), `src/inventory` (12), `src/plan/risk` (10), `src/tests` (8), `src/pr` (7), `src/preflight` (7), `src/project` (7), `src/config` (6), `src/release` (6), `src/start` (6), `src/agents` (4), `src/check` (4), `src/core/loop` (4), `src/effort/sync` (4), `src/schema` (4), `src/plan` (3), `src/task` (3), `src/utils` (3), `src/board` (2), `src/commands/agent` (2), `src/commands/config` (2), `src/effort/store` (2), `src/inventory/search` (2), `src/modules` (1), `src/notices` (1) |
| `c07-types` | 130 | `src/pr` (22), `src/cleanup` (20), `src/tests` (20), `src/pr/triage` (18), `src/commands/pr` (15), `src/cli/prompt` (10), `src/commands` (7), `src/pr/plans` (5), `src/fixtures` (3), `src/start` (3), `src/inventory` (2), `src/status` (2), `src/board` (1), `src/effort/store` (1), `src/loop` (1) |
| `c08-index` | 73 | `src/core/loop` (16), `src/core/plan` (15), `src/commands/plan` (11), `src/plan` (11), `src/board` (10), `src/tests` (6), `src/adapters/planner` (2), `src` (1), `src/ports` (1) |
| `c09-frontmatter` | 57 | `src/schema` (12), `src/backfill` (10), `src/demote` (10), `src/errors` (6), `src/commands/skill` (5), `src/tests` (5), `src/check` (4), `src/commands` (2), `src/commands/bug` (1), `src/commands/instinct` (1), `src/inventory` (1) |
| `c10-index` | 42 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1) |
| `c11-start` | 33 | `src/stretch` (13), `src/ci` (7), `src/commands/stretch` (7), `src` (2), `src/commands` (2), `src/commands/ci` (2) |
| `c12-verify` | 29 | `src/refs` (12), `src/tests` (4), `src/board` (3), `src/commands` (3), `src/commands/issue` (2), `src/commands/plan` (2), `src/triage` (2), `src/cli` (1) |
| `c13-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c14-config-schema-readings` | 1 | `src` (1) |
| `c15-types.test` | 1 | `src/core/command` (1) |
| `c16-agent-gates.test` | 1 | `src/tests` (1) |
| `c17-agents-split-accounting.test` | 1 | `src/tests` (1) |
| `c18-cut-table-shape.test` | 1 | `src/tests` (1) |
| `c19-entry-exports.test` | 1 | `src/tests` (1) |
| `c20-epic-guard-workflow.test` | 1 | `src/tests` (1) |
| `c21-eslint-stand-in` | 1 | `src/tests` (1) |
| `c22-learning-boundary.test` | 1 | `src/tests` (1) |
| `c23-skill-gap-section.test` | 1 | `src/tests` (1) |
| `c24-verify-workflow.test` | 1 | `src/tests` (1) |
| `c25-cli.test` | 1 | `src/tools/ts-symbols` (1) |
| `c26-cli` | 1 | `src/tools/ts-symbols` (1) |

## The 30 files of highest betweenness

| Rank | File | Betweenness | Cluster |
| --- | --- | --- | --- |
| 1 | `src/ports/index.ts` | 50619.910016 | `c02-index` |
| 2 | `src/effort/store/merge-store.ts` | 43894.869991 | `c04-sqlite` |
| 3 | `src/config-registry.ts` | 24424.49475 | `c06-index` |
| 4 | `src/tests/cli-capture.ts` | 22275.867496 | `c05-cli-capture` |
| 5 | `src/core/command/index.ts` | 18895.134436 | `c03-index` |
| 6 | `src/board/roadmap.ts` | 18376.508644 | `c01-github` |
| 7 | `src/core/config/index.ts` | 17814.103584 | `c06-index` |
| 8 | `src/core/loop/index.ts` | 15151.115715 | `c05-cli-capture` |
| 9 | `src/adapters/tracker/github.ts` | 14924.344528 | `c01-github` |
| 10 | `src/commands/index.ts` | 14784.382684 | `c03-index` |
| 11 | `src/board/relations/labels.ts` | 12839.034968 | `c01-github` |
| 12 | `src/board/setup.ts` | 12810.842296 | `c01-github` |
| 13 | `src/start/dispatch.ts` | 12679.146754 | `c02-index` |
| 14 | `src/pr/index.ts` | 12176.75437 | `c03-index` |
| 15 | `src/start/loop-events.ts` | 12012.641515 | `c02-index` |
| 16 | `src/next/sources.ts` | 11969.398419 | `c01-github` |
| 17 | `src/adapter-registry.ts` | 11605.231729 | `c03-index` |
| 18 | `src/project/scaffold.ts` | 10503.033629 | `c05-cli-capture` |
| 19 | `src/board/gate.ts` | 10210.33135 | `c08-index` |
| 20 | `src/config-schema-issues.ts` | 9931.937288 | `c06-index` |
| 21 | `src/board/project/refresh.ts` | 9443.264164 | `c01-github` |
| 22 | `src/effort/store/sqlite.ts` | 9386.521586 | `c04-sqlite` |
| 23 | `src/effort/store/development-build.ts` | 8373.406685 | `c04-sqlite` |
| 24 | `src/core/config/scope.ts` | 8236.525697 | `c06-index` |
| 25 | `src/effort/collect.ts` | 7733.892202 | `c04-sqlite` |
| 26 | `src/core/output/active.ts` | 7396.177284 | `c02-index` |
| 27 | `src/refs/extract.ts` | 7277.958669 | `c12-verify` |
| 28 | `src/core/config/config-load.ts` | 7203.746308 | `c06-index` |
| 29 | `src/board/issue.ts` | 6900.144912 | `c01-github` |
| 30 | `src/bugs/record.ts` | 6715.169841 | `c02-index` |

## Unresolved imports

- `src/tests/package-build.test.ts`: `${DEFINE_CONFIG}`
