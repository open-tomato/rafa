# Import graph

Coverage: 2193 of 2193 tracked files read (src/ and packages/*/src/).

2193 files, 11088 edges (7959 value, 3129 type), 44 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 343 | `packages/rafa-board/src/board` (115), `src/commands` (27), `src/tests` (26), `packages/rafa-board/src/board/relations` (19), `packages/rafa-board/src/commands/epic` (16), `packages/rafa-board/src/commands/issue` (11), `packages/rafa-board/src/refs` (11), `src/next` (11), `src/status` (11), `src/commands/plan` (10), `src/tests/board-coupled/commands/epic` (10), `src/tests/board-coupled/commands/issue` (8), `packages/rafa-board/src/next` (6), `packages/rafa/src/core/git` (6), `src/board` (6), `src/commands/pr` (6), `packages/rafa-board/src/board/project` (4), `src/pr` (3), `src/start` (3), `src/tests/board-coupled/board` (3), `packages/rafa-board/src/adapters/tracker` (2), `packages/rafa-board/src/claims` (2), `packages/rafa-board/src/tests` (2), `packages/rafa/src/next` (2), `packages/rafa/src/project` (2), `src/claims` (2), `src/suite` (2), `src/tests/board-coupled/commands` (2), `src/tests/board-coupled/refs` (2), `src/triage` (2), `packages/rafa-board/src/commands` (1), `packages/rafa-board/src/commands/board` (1), `packages/rafa-board/src/commands/plan` (1), `packages/rafa-board/src/epic` (1), `packages/rafa/src/board` (1), `packages/rafa/src/cli` (1), `src/commands/epic` (1), `src/plan` (1), `src/plan/risk` (1), `src/tests/board-coupled/commands/board` (1), `src/tests/board-coupled/commands/plan` (1) |
| `c02-index` | 264 | `src/commands/pr` (49), `src/next` (29), `src/commands/release` (28), `src/commands` (20), `src/commands/loop` (15), `src/release` (15), `packages/rafa-board/src/commands/issue` (11), `src/stretch` (11), `src/commands/update` (10), `src/pr` (8), `src/commands/stretch` (7), `src/project` (7), `src/tests` (7), `packages/rafa/src/project` (6), `src/start` (5), `src/commands/effort` (4), `src/commands/plan` (3), `packages/rafa-board/src/commands/board` (2), `src/commands/config` (2), `src/commands/skill` (2), `src/loop` (2), `src/runtime` (2), `src/tests/board-coupled/commands/issue` (2), `src/tests/core-coupled/project` (2), `packages/rafa-board/src/board` (1), `packages/rafa/src/commands/plan` (1), `packages/rafa/src/core/command` (1), `packages/rafa/src/core/config` (1), `packages/rafa/src/core/loop` (1), `packages/rafa/src/modules/testdata/seam-fixture` (1), `src/cli` (1), `src/commands/agent` (1), `src/commands/board` (1), `src/commands/docs` (1), `src/commands/instinct` (1), `src/commands/issue` (1), `src/commands/module` (1), `src/tests/board-coupled/board` (1), `src/tests/core-coupled/commands/plan` (1) |
| `c03-index` | 260 | `packages/rafa-effort/src/effort` (41), `src/triage` (28), `packages/rafa/src/effort/store` (24), `packages/rafa-board/src/adapters/tracker` (15), `src/start` (15), `packages/rafa/src/bugs` (13), `packages/rafa/src/triage` (12), `src/tests` (10), `src/commands/bug` (7), `packages/rafa/src/errors` (6), `src/bugs` (6), `src/docs` (6), `src/errors` (6), `src/tests/effort-coupled/effort` (6), `packages/rafa/src/core/services` (5), `packages/rafa-board/src/commands/epic` (4), `packages/rafa/src/ports` (4), `src/tests/board-coupled/commands/issue` (4), `packages/rafa-board/src/commands/issue` (3), `packages/rafa-board/src/epic` (3), `packages/rafa/src/report` (3), `src/tests/core-coupled/bugs` (3), `packages/rafa-board/src/bugs` (2), `packages/rafa/src/adapters/logger` (2), `packages/rafa/src/effort` (2), `src` (2), `src/commands/plan` (2), `src/commands/release` (2), `src/tests/board-coupled/adapters/tracker` (2), `src/tests/board-coupled/commands/epic` (2), `src/tests/core-coupled/effort/store` (2), `packages/rafa-board/src/board/project` (1), `packages/rafa/src` (1), `packages/rafa/src/errors/fixtures` (1), `packages/rafa/src/modules/testdata/sync-fixture` (1), `packages/rafa/src/project` (1), `packages/rafa/src/start` (1), `packages/rafa/src/tests` (1), `packages/rafa/src/utils` (1), `src/cli` (1), `src/commands/docs` (1), `src/ports` (1), `src/pr` (1), `src/tests/core-coupled` (1), `src/tests/core-coupled/errors` (1), `src/tests/core-coupled/ports` (1), `src/tests/core-coupled/project` (1), `src/tests/core-coupled/start` (1), `src/tests/core-coupled/utils` (1) |
| `c04-index` | 260 | `src/start` (115), `src/tests` (24), `src/suite` (16), `src/cli` (13), `packages/rafa-board/src/board` (10), `src/commands/plan` (9), `packages/rafa/src/core/plan` (6), `src/loop` (6), `packages/rafa/src/core/output` (4), `packages/rafa/src/plan` (4), `src/cli/core` (4), `packages/rafa-effort/src/effort` (3), `src/commands` (3), `src/commands/module` (3), `src/plan` (3), `src/preflight` (3), `packages/rafa-inventory/src/start` (2), `packages/rafa-inventory/src/tiers` (2), `packages/rafa/src/adapters/output` (2), `packages/rafa/src/cli` (2), `packages/rafa/src/runtime` (2), `packages/rafa/src/utils` (2), `src` (2), `src/adapters/output` (2), `src/adapters/planner` (2), `src/pr` (2), `src/tests/core-coupled/core/output` (2), `src/triage` (2), `packages/rafa/src` (1), `packages/rafa/src/core/loop` (1), `packages/rafa/src/ports` (1), `packages/rafa/src/tests` (1), `src/commands/stretch` (1), `src/notices` (1), `src/tests/core-coupled/plan` (1), `src/tests/core-coupled/utils` (1), `src/tests/effort-coupled/effort` (1), `src/utils` (1) |
| `c05-sections` | 201 | `src/commands` (19), `packages/rafa-inventory/src/inventory` (14), `src/tests` (12), `packages/rafa-inventory/src/schema` (11), `packages/rafa-inventory/src/backfill` (10), `packages/rafa-inventory/src/demote` (10), `packages/rafa-inventory/src/learning` (10), `src/commands/instinct` (10), `src/commands/skill` (9), `packages/rafa-inventory/src/check` (8), `packages/rafa-inventory/src/task` (8), `packages/rafa-inventory/src/tiers` (8), `src/commands/agent` (6), `src/pr` (6), `src/preflight` (6), `packages/rafa/src/schema` (5), `src/commands/plan` (5), `src/plan` (5), `packages/rafa/src/plan/risk` (4), `src/start` (4), `packages/rafa-inventory/src/adapters/learning` (3), `packages/rafa-inventory/src/plan/risk` (3), `packages/rafa-inventory/src/agents` (2), `packages/rafa-inventory/src/inventory/search` (2), `packages/rafa-inventory/src/report` (2), `packages/rafa/src/utils` (2), `src/schema` (2), `src/tests/inventory-coupled/agents` (2), `src/tests/inventory-coupled/tiers` (2), `packages/rafa-board/src/board` (1), `packages/rafa-effort/src/effort` (1), `packages/rafa/src/board` (1), `packages/rafa/src/core/config` (1), `src/notices` (1), `src/plan/risk` (1), `src/tests/core-coupled/report` (1), `src/tests/core-coupled/schema` (1), `src/tests/inventory-coupled/adapters/learning` (1), `src/tests/inventory-coupled/plan/risk` (1), `src/tiers` (1) |
| `c06-cli-capture` | 196 | `src/tests` (83), `src/release` (50), `src/start` (23), `src/commands/release` (8), `src/commands` (5), `src/commands/pr` (5), `src/project` (3), `packages/rafa/src/release` (2), `src` (2), `src/commands/bug` (2), `src/commands/config` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src/utils` (2), `src/cli` (1), `src/next` (1), `src/notices` (1), `src/tests/core-coupled/next` (1), `src/tests/core-coupled/project` (1) |
| `c07-index` | 193 | `packages/rafa/src/core/config` (28), `packages/rafa/src/core/loop` (20), `packages/rafa/src/core/command` (18), `src/tests/core-coupled` (13), `packages/rafa/src` (12), `src` (11), `packages/rafa/src/core/plan` (10), `src/config` (8), `packages/rafa/src/adapters/logger` (7), `src/commands` (7), `src/release` (6), `src/tests` (6), `src/tests/core-coupled/core/config` (6), `packages/rafa/src/core/adapters` (4), `packages/rafa/src/modules` (4), `packages/rafa-effort/src/effort/sync` (3), `src/project` (3), `src/tests/core-coupled/adapters/logger` (3), `src/tests/effort-coupled/effort/sync` (3), `packages/rafa/src/effort/store` (2), `src/cli` (2), `src/commands/config` (2), `src/start` (2), `packages/rafa/src/core/git` (1), `packages/rafa/src/core/output` (1), `packages/rafa/src/modules/testdata/hub-down-sync` (1), `packages/rafa/src/ports` (1), `src/modules` (1), `src/modules/testdata/pull-merge-sync` (1), `src/preflight` (1), `src/tests/board-coupled/board` (1), `src/tests/core-coupled/core/command` (1), `src/tests/core-coupled/core/loop` (1), `src/tests/core-coupled/effort/store` (1), `src/tests/core-coupled/modules` (1), `src/tests/core-coupled/project` (1) |
| `c08-sqlite` | 131 | `packages/rafa/src/effort/store` (65), `src/commands/effort` (15), `src/tests/core-coupled/effort/store` (11), `src/tests` (10), `packages/rafa-inventory/src/inventory/search` (9), `packages/rafa/src/effort/store/testdata` (4), `packages/rafa/src/core/runtime` (3), `src/commands` (3), `packages/rafa-effort/src/effort` (2), `packages/rafa/src/effort` (2), `src/tests/effort-coupled/effort/sync` (2), `packages/rafa-effort/src/effort/sync` (1), `src/claims` (1), `src/commands/claim` (1), `src/tests/core-coupled/core/runtime` (1), `src/tests/inventory-coupled/inventory/search` (1) |
| `c09-types` | 120 | `src/cleanup` (22), `src/pr` (21), `src/pr/triage` (18), `src/commands/pr` (17), `src/cli/prompt` (10), `src/tests` (7), `src/commands` (6), `src/status` (6), `src/pr/plans` (5), `packages/rafa/src/effort/store` (2), `packages/rafa/src/utils` (2), `src/inventory` (2), `packages/rafa-board/src/board` (1), `src/tests/board-coupled/board` (1) |
| `c10-refresh` | 59 | `packages/rafa-board/src/board/project` (37), `src/commands` (7), `src/start` (3), `src/tests` (3), `src/commands/release` (2), `src/tests/board-coupled/commands/issue` (2), `packages/rafa-board/src/commands/board` (1), `packages/rafa-board/src/commands/issue` (1), `src/tests/board-coupled/board/project` (1), `src/tests/board-coupled/commands/board` (1), `src/tests/board-coupled/commands/epic` (1) |
| `c11-git` | 48 | `src/commands/claim` (12), `src/claims` (8), `packages/rafa/src/claims` (6), `src/start` (6), `packages/rafa-board/src/board` (4), `src/tests` (4), `packages/rafa/src/start` (2), `src/status` (2), `src/tests/board-coupled/board` (2), `packages/rafa/src/utils` (1), `src/tests/core-coupled/utils` (1) |
| `c12-index` | 44 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa/src/effort/store` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1) |
| `c13-sweep-timeout` | 32 | `src/tests` (24), `src/fixtures` (5), `src/commands` (1), `src/start` (1), `src/tests/core-coupled/effort/store` (1) |
| `c14-runs` | 11 | `src/ci` (7), `src/commands/ci` (2), `src/stretch` (2) |
| `c15-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c16-index.test` | 1 | `packages/rafa-board/src/commands/board` (1) |
| `c17-declarations.test` | 1 | `packages/rafa-board/src/commands/epic` (1) |
| `c18-declarations.test` | 1 | `packages/rafa-board/src/commands/issue` (1) |
| `c19-config-schema-readings` | 1 | `packages/rafa/src` (1) |
| `c20-registry-types.test` | 1 | `packages/rafa/src/core/command` (1) |
| `c21-types.test` | 1 | `packages/rafa/src/core/command` (1) |
| `c22-declarations.test` | 1 | `src/commands/claim` (1) |
| `c23-index.test` | 1 | `src/commands/claim` (1) |
| `c24-declarations.test` | 1 | `src/commands/pr` (1) |
| `c25-index.test` | 1 | `src/commands/pr` (1) |
| `c26-declarations.test` | 1 | `src/commands/release` (1) |
| `c27-index.test` | 1 | `src/commands/release` (1) |
| `c28-types.test` | 1 | `src/pr` (1) |
| `c29-agent-gates.test` | 1 | `src/tests` (1) |
| `c30-agents-split-accounting.test` | 1 | `src/tests` (1) |
| `c31-cut-table-shape.test` | 1 | `src/tests` (1) |
| `c32-dependabot-config.test` | 1 | `src/tests` (1) |
| `c33-entry-exports.test` | 1 | `src/tests` (1) |
| `c34-epic-guard-workflow.test` | 1 | `src/tests` (1) |
| `c35-eslint-stand-in` | 1 | `src/tests` (1) |
| `c36-learning-boundary.test` | 1 | `src/tests` (1) |
| `c37-package-lint-spawned.test` | 1 | `src/tests` (1) |
| `c38-references-gate-spawned.test` | 1 | `src/tests` (1) |
| `c39-release-bot-fragment-workflow.test` | 1 | `src/tests` (1) |
| `c40-release-publish-workflow.test` | 1 | `src/tests` (1) |
| `c41-skill-gap-section.test` | 1 | `src/tests` (1) |
| `c42-verify-workflow.test` | 1 | `src/tests` (1) |
| `c43-cli.test` | 1 | `src/tools/ts-symbols` (1) |
| `c44-cli` | 1 | `src/tools/ts-symbols` (1) |

## The 30 files of highest betweenness

| Rank | File | Betweenness | Cluster |
| --- | --- | --- | --- |
| 1 | `packages/rafa/src/ports/index.ts` | 63551.867553 | `c03-index` |
| 2 | `packages/rafa/src/effort/store/merge-store.ts` | 51694.229552 | `c08-sqlite` |
| 3 | `src/tests/cli-capture.ts` | 31615.288442 | `c06-cli-capture` |
| 4 | `packages/rafa/src/core/command/index.ts` | 25998.105933 | `c02-index` |
| 5 | `packages/rafa/src/core/config/index.ts` | 22695.005884 | `c07-index` |
| 6 | `src/commands/index.ts` | 18021.47159 | `c02-index` |
| 7 | `packages/rafa-board/src/adapters/tracker/github.ts` | 17801.517316 | `c01-github` |
| 8 | `packages/rafa/src/core/loop/index.ts` | 17281.537611 | `c04-index` |
| 9 | `packages/rafa/src/core/config/scope.ts` | 12904.863369 | `c07-index` |
| 10 | `src/project/scaffold.ts` | 12792.995457 | `c06-cli-capture` |
| 11 | `packages/rafa-board/src/board/relations/labels.ts` | 12648.052449 | `c01-github` |
| 12 | `packages/rafa/src/core/config/config-load.ts` | 12115.063326 | `c07-index` |
| 13 | `packages/rafa-board/src/board/setup.ts` | 11211.51781 | `c01-github` |
| 14 | `packages/rafa/src/core/output/active.ts` | 11098.550194 | `c07-index` |
| 15 | `src/pr/index.ts` | 10737.655305 | `c02-index` |
| 16 | `src/config-registry.ts` | 10518.398542 | `c07-index` |
| 17 | `packages/rafa/src/effort/store/development-build.ts` | 10092.687621 | `c08-sqlite` |
| 18 | `packages/rafa-board/src/board/project/refresh.ts` | 10020.349588 | `c10-refresh` |
| 19 | `packages/rafa-board/src/board/roadmap.ts` | 9874.041941 | `c01-github` |
| 20 | `packages/rafa/src/effort/store/sqlite.ts` | 9462.439885 | `c08-sqlite` |
| 21 | `packages/rafa/src/core/config/sections.ts` | 9144.986388 | `c05-sections` |
| 22 | `src/start/loop-events.ts` | 8715.144099 | `c04-index` |
| 23 | `src/start/suite-step.ts` | 8606.932612 | `c04-index` |
| 24 | `src/cli/dispatch.ts` | 8329.169631 | `c04-index` |
| 25 | `src/start/dispatch.ts` | 7867.205911 | `c04-index` |
| 26 | `src/start/suite-blocker.ts` | 7701.161905 | `c04-index` |
| 27 | `packages/rafa-board/src/board/issue.ts` | 7547.017132 | `c01-github` |
| 28 | `packages/rafa-board/src/board/gate.ts` | 7345.427157 | `c04-index` |
| 29 | `packages/rafa/src/core/command/types.ts` | 7193.536696 | `c07-index` |
| 30 | `packages/rafa/src/core/plan/index.ts` | 6988.127953 | `c04-index` |
