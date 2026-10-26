# Import graph

Coverage: 2193 of 2193 tracked files read (src/ and packages/*/src/).

2193 files, 11091 edges (7963 value, 3128 type), 42 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 339 | `packages/rafa-board/src/board` (116), `src/commands` (27), `src/tests` (26), `packages/rafa-board/src/board/relations` (19), `src/next` (13), `packages/rafa-board/src/commands/epic` (11), `packages/rafa-board/src/refs` (11), `src/status` (11), `packages/rafa-board/src/commands/issue` (10), `src/commands/plan` (10), `src/tests/board-coupled/commands/epic` (10), `src/commands/pr` (8), `packages/rafa-board/src/next` (6), `packages/rafa/src/core/git` (6), `src/tests/board-coupled/commands/issue` (6), `src/board` (5), `packages/rafa-board/src/board/project` (4), `src/tests/board-coupled/board` (4), `src/pr` (3), `src/start` (3), `packages/rafa-board/src/adapters/tracker` (2), `packages/rafa-board/src/claims` (2), `packages/rafa-board/src/tests` (2), `packages/rafa/src/next` (2), `packages/rafa/src/project` (2), `src/claims` (2), `src/suite` (2), `src/tests/board-coupled/commands` (2), `src/tests/board-coupled/refs` (2), `src/triage` (2), `packages/rafa-board/src/commands` (1), `packages/rafa-board/src/commands/board` (1), `packages/rafa-board/src/commands/plan` (1), `packages/rafa-board/src/epic` (1), `packages/rafa/src/board` (1), `packages/rafa/src/cli` (1), `src/commands/epic` (1), `src/plan/risk` (1), `src/tests/board-coupled/commands/board` (1), `src/tests/board-coupled/commands/plan` (1) |
| `c02-index` | 268 | `packages/rafa-effort/src/effort` (44), `src/triage` (28), `packages/rafa/src/effort/store` (25), `packages/rafa-board/src/adapters/tracker` (15), `src/start` (15), `packages/rafa/src/bugs` (13), `packages/rafa/src/triage` (12), `src/tests` (11), `src/tests/effort-coupled/effort` (7), `packages/rafa/src/errors` (6), `src/bugs` (6), `src/commands/bug` (6), `src/errors` (6), `packages/rafa/src/core/services` (5), `src/tests/board-coupled/commands/issue` (5), `packages/rafa-board/src/commands/epic` (4), `packages/rafa/src/ports` (4), `src/docs` (4), `packages/rafa-board/src/commands/issue` (3), `packages/rafa-board/src/epic` (3), `packages/rafa/src/report` (3), `packages/rafa/src/utils` (3), `src/tests/core-coupled/bugs` (3), `packages/rafa-board/src/bugs` (2), `packages/rafa/src/adapters/logger` (2), `packages/rafa/src/effort` (2), `src` (2), `src/commands/plan` (2), `src/commands/pr` (2), `src/pr` (2), `src/tests/board-coupled/adapters/tracker` (2), `src/tests/board-coupled/commands/epic` (2), `src/tests/core-coupled/effort/store` (2), `packages/rafa-board/src/board/project` (1), `packages/rafa/src` (1), `packages/rafa/src/errors/fixtures` (1), `packages/rafa/src/modules/testdata/sync-fixture` (1), `packages/rafa/src/project` (1), `packages/rafa/src/start` (1), `packages/rafa/src/tests` (1), `src/cli` (1), `src/commands/docs` (1), `src/commands/release` (1), `src/ports` (1), `src/tests/core-coupled` (1), `src/tests/core-coupled/errors` (1), `src/tests/core-coupled/ports` (1), `src/tests/core-coupled/project` (1), `src/tests/core-coupled/start` (1), `src/tests/core-coupled/utils` (1) |
| `c03-index` | 248 | `src/start` (110), `src/tests` (19), `src/suite` (16), `packages/rafa/src/core/plan` (14), `src/cli` (13), `packages/rafa-board/src/board` (9), `packages/rafa/src/core/output` (4), `packages/rafa/src/plan/risk` (4), `src/cli/core` (4), `src/commands` (4), `src/commands/plan` (4), `src/loop` (4), `packages/rafa-inventory/src/plan/risk` (3), `src/commands/module` (3), `src/next` (3), `packages/rafa/src/adapters/output` (2), `packages/rafa/src/cli` (2), `packages/rafa/src/runtime` (2), `packages/rafa/src/utils` (2), `src/adapters/output` (2), `src/adapters/planner` (2), `src/docs` (2), `src/plan` (2), `src/runtime` (2), `src/tests/core-coupled/core/output` (2), `src/triage` (2), `packages/rafa/src` (1), `packages/rafa/src/core/loop` (1), `packages/rafa/src/ports` (1), `packages/rafa/src/tests` (1), `src` (1), `src/cleanup` (1), `src/commands/stretch` (1), `src/plan/risk` (1), `src/preflight` (1), `src/tests/core-coupled/utils` (1), `src/tests/inventory-coupled/plan/risk` (1), `src/utils` (1) |
| `c04-index` | 230 | `src/commands/pr` (33), `src/commands/release` (26), `src/next` (19), `src/commands/loop` (15), `src/release` (15), `src/commands` (14), `src/stretch` (13), `packages/rafa-board/src/commands/issue` (12), `src/commands/update` (10), `src/ci` (7), `src/commands/plan` (7), `src/commands/stretch` (6), `packages/rafa-board/src/commands/epic` (5), `src/tests` (5), `src/commands/effort` (4), `src/loop` (4), `src/project` (3), `src/tests/board-coupled/commands/issue` (3), `packages/rafa-board/src/board` (2), `packages/rafa-board/src/commands/board` (2), `src/commands/ci` (2), `src/commands/config` (2), `src/commands/instinct` (2), `src/commands/skill` (2), `src/pr` (2), `packages/rafa/src/commands/plan` (1), `packages/rafa/src/core/command` (1), `packages/rafa/src/core/config` (1), `packages/rafa/src/core/loop` (1), `packages/rafa/src/modules/testdata/seam-fixture` (1), `packages/rafa/src/project` (1), `src/cli` (1), `src/commands/agent` (1), `src/commands/board` (1), `src/commands/bug` (1), `src/commands/docs` (1), `src/commands/issue` (1), `src/commands/module` (1), `src/plan` (1), `src/tests/core-coupled/commands/plan` (1) |
| `c05-sections` | 210 | `src/commands` (21), `packages/rafa-inventory/src/inventory` (14), `src/tests` (14), `packages/rafa-inventory/src/schema` (11), `packages/rafa-inventory/src/backfill` (10), `packages/rafa-inventory/src/demote` (10), `packages/rafa-inventory/src/learning` (10), `packages/rafa-inventory/src/tiers` (10), `src/start` (10), `src/commands/instinct` (9), `src/commands/skill` (9), `packages/rafa-inventory/src/check` (8), `packages/rafa-inventory/src/task` (8), `src/preflight` (8), `src/commands/agent` (6), `src/commands/plan` (6), `src/plan` (6), `packages/rafa/src/plan` (4), `packages/rafa/src/schema` (4), `packages/rafa-inventory/src/adapters/learning` (3), `packages/rafa-inventory/src/agents` (2), `packages/rafa-inventory/src/inventory/search` (2), `packages/rafa-inventory/src/report` (2), `packages/rafa-inventory/src/start` (2), `packages/rafa/src/utils` (2), `src/pr` (2), `src/schema` (2), `src/tests/inventory-coupled/agents` (2), `src/tests/inventory-coupled/tiers` (2), `packages/rafa-board/src/board` (1), `packages/rafa-effort/src/effort` (1), `packages/rafa/src/board` (1), `packages/rafa/src/core/config` (1), `packages/rafa/src/pr` (1), `src` (1), `src/notices` (1), `src/tests/core-coupled/plan` (1), `src/tests/core-coupled/report` (1), `src/tests/inventory-coupled/adapters/learning` (1), `src/tiers` (1) |
| `c06-cli-capture` | 210 | `src/tests` (79), `src/release` (50), `src/start` (24), `src/commands/pr` (11), `src/commands/release` (10), `packages/rafa/src/tests` (5), `src/commands` (5), `src/project` (5), `packages/rafa/src/release` (2), `src` (2), `src/commands/bug` (2), `src/commands/config` (2), `src/notices` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src/utils` (2), `packages/rafa/src/pr` (1), `src/cli` (1), `src/next` (1), `src/tests/core-coupled/next` (1), `src/tests/core-coupled/project` (1) |
| `c07-index` | 196 | `src/pr` (27), `src/commands/pr` (23), `src/cleanup` (21), `src/pr/triage` (18), `src/tests` (14), `src/commands/claim` (12), `src/cli/prompt` (10), `src/start` (10), `src/claims` (8), `src/status` (8), `packages/rafa/src/claims` (6), `src/commands` (6), `src/next` (5), `src/pr/plans` (5), `packages/rafa-board/src/board` (4), `packages/rafa/src/pr` (3), `src/tests/board-coupled/board` (3), `packages/rafa/src/effort/store` (2), `packages/rafa/src/start` (2), `src/inventory` (2), `packages/rafa/src/schema` (1), `packages/rafa/src/utils` (1), `src/board` (1), `src/commands/release` (1), `src/commands/stretch` (1), `src/tests/core-coupled/schema` (1), `src/tests/core-coupled/utils` (1) |
| `c08-index` | 185 | `packages/rafa/src/core/config` (28), `packages/rafa/src/core/loop` (20), `packages/rafa/src/core/command` (18), `src/tests/core-coupled` (13), `packages/rafa/src` (12), `src` (11), `src/config` (8), `packages/rafa/src/adapters/logger` (7), `src/commands` (7), `src/release` (6), `src/tests` (6), `src/tests/core-coupled/core/config` (6), `packages/rafa/src/core/adapters` (4), `packages/rafa/src/modules` (4), `packages/rafa-effort/src/effort/sync` (3), `src/project` (3), `src/tests/core-coupled/adapters/logger` (3), `src/tests/effort-coupled/effort/sync` (3), `packages/rafa/src/core/plan` (2), `packages/rafa/src/effort/store` (2), `src/cli` (2), `src/commands/config` (2), `src/start` (2), `packages/rafa/src/core/git` (1), `packages/rafa/src/core/output` (1), `packages/rafa/src/modules/testdata/hub-down-sync` (1), `packages/rafa/src/ports` (1), `src/modules` (1), `src/modules/testdata/pull-merge-sync` (1), `src/preflight` (1), `src/tests/board-coupled/board` (1), `src/tests/core-coupled/core/command` (1), `src/tests/core-coupled/core/loop` (1), `src/tests/core-coupled/effort/store` (1), `src/tests/core-coupled/modules` (1), `src/tests/core-coupled/project` (1) |
| `c09-sqlite` | 131 | `packages/rafa/src/effort/store` (64), `src/commands/effort` (15), `src/tests/core-coupled/effort/store` (11), `src/tests` (10), `packages/rafa-inventory/src/inventory/search` (9), `packages/rafa/src/effort/store/testdata` (4), `src/commands` (4), `packages/rafa/src/core/runtime` (3), `packages/rafa-effort/src/effort` (2), `packages/rafa/src/effort` (2), `src/tests/effort-coupled/effort/sync` (2), `packages/rafa-effort/src/effort/sync` (1), `src/claims` (1), `src/commands/claim` (1), `src/tests/core-coupled/core/runtime` (1), `src/tests/inventory-coupled/inventory/search` (1) |
| `c10-refresh` | 70 | `packages/rafa-board/src/board/project` (37), `src/commands` (9), `packages/rafa/src/project` (5), `src/start` (3), `src/tests` (3), `src/commands/release` (2), `src/project` (2), `src/tests/board-coupled/commands/issue` (2), `src/tests/core-coupled/project` (2), `packages/rafa-board/src/commands/board` (1), `packages/rafa-board/src/commands/issue` (1), `src/tests/board-coupled/board/project` (1), `src/tests/board-coupled/commands/board` (1), `src/tests/board-coupled/commands/epic` (1) |
| `c11-index` | 44 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa/src/effort/store` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1) |
| `c12-sweep-timeout` | 31 | `src/tests` (24), `src/fixtures` (5), `src/commands` (1), `src/tests/core-coupled/effort/store` (1) |
| `c13-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c14-index.test` | 1 | `packages/rafa-board/src/commands/board` (1) |
| `c15-declarations.test` | 1 | `packages/rafa-board/src/commands/epic` (1) |
| `c16-declarations.test` | 1 | `packages/rafa-board/src/commands/issue` (1) |
| `c17-config-schema-readings` | 1 | `packages/rafa/src` (1) |
| `c18-registry-types.test` | 1 | `packages/rafa/src/core/command` (1) |
| `c19-types.test` | 1 | `packages/rafa/src/core/command` (1) |
| `c20-types.test` | 1 | `packages/rafa/src/pr` (1) |
| `c21-declarations.test` | 1 | `src/commands/claim` (1) |
| `c22-index.test` | 1 | `src/commands/claim` (1) |
| `c23-declarations.test` | 1 | `src/commands/pr` (1) |
| `c24-index.test` | 1 | `src/commands/pr` (1) |
| `c25-declarations.test` | 1 | `src/commands/release` (1) |
| `c26-index.test` | 1 | `src/commands/release` (1) |
| `c27-agent-gates.test` | 1 | `src/tests` (1) |
| `c28-agents-split-accounting.test` | 1 | `src/tests` (1) |
| `c29-cut-table-shape.test` | 1 | `src/tests` (1) |
| `c30-dependabot-config.test` | 1 | `src/tests` (1) |
| `c31-entry-exports.test` | 1 | `src/tests` (1) |
| `c32-epic-guard-workflow.test` | 1 | `src/tests` (1) |
| `c33-eslint-stand-in` | 1 | `src/tests` (1) |
| `c34-learning-boundary.test` | 1 | `src/tests` (1) |
| `c35-package-lint-spawned.test` | 1 | `src/tests` (1) |
| `c36-references-gate-spawned.test` | 1 | `src/tests` (1) |
| `c37-release-bot-fragment-workflow.test` | 1 | `src/tests` (1) |
| `c38-release-publish-workflow.test` | 1 | `src/tests` (1) |
| `c39-skill-gap-section.test` | 1 | `src/tests` (1) |
| `c40-verify-workflow.test` | 1 | `src/tests` (1) |
| `c41-cli.test` | 1 | `src/tools/ts-symbols` (1) |
| `c42-cli` | 1 | `src/tools/ts-symbols` (1) |

## The 30 files of highest betweenness

| Rank | File | Betweenness | Cluster |
| --- | --- | --- | --- |
| 1 | `packages/rafa/src/ports/index.ts` | 63337.224372 | `c02-index` |
| 2 | `packages/rafa/src/effort/store/merge-store.ts` | 51552.381422 | `c09-sqlite` |
| 3 | `src/tests/cli-capture.ts` | 31606.947788 | `c06-cli-capture` |
| 4 | `packages/rafa/src/core/command/index.ts` | 25896.383089 | `c04-index` |
| 5 | `packages/rafa/src/core/config/index.ts` | 22534.668184 | `c08-index` |
| 6 | `src/commands/index.ts` | 18002.321915 | `c04-index` |
| 7 | `packages/rafa/src/core/loop/index.ts` | 17712.843372 | `c03-index` |
| 8 | `packages/rafa-board/src/adapters/tracker/github.ts` | 16806.506643 | `c01-github` |
| 9 | `packages/rafa/src/core/config/scope.ts` | 12960.058607 | `c08-index` |
| 10 | `src/project/scaffold.ts` | 12775.799384 | `c06-cli-capture` |
| 11 | `packages/rafa-board/src/board/relations/labels.ts` | 12647.052449 | `c01-github` |
| 12 | `packages/rafa/src/core/config/config-load.ts` | 12135.836698 | `c08-index` |
| 13 | `packages/rafa/src/core/output/active.ts` | 11505.048962 | `c08-index` |
| 14 | `packages/rafa-board/src/board/setup.ts` | 11231.670751 | `c01-github` |
| 15 | `src/config-registry.ts` | 10503.181876 | `c08-index` |
| 16 | `packages/rafa/src/effort/store/development-build.ts` | 10113.951907 | `c09-sqlite` |
| 17 | `packages/rafa-board/src/board/project/refresh.ts` | 10019.279245 | `c10-refresh` |
| 18 | `packages/rafa-board/src/board/roadmap.ts` | 9869.828648 | `c01-github` |
| 19 | `packages/rafa/src/effort/store/sqlite.ts` | 9651.747749 | `c09-sqlite` |
| 20 | `packages/rafa/src/core/config/sections.ts` | 9143.710824 | `c05-sections` |
| 21 | `src/start/loop-events.ts` | 8758.144099 | `c03-index` |
| 22 | `src/start/suite-step.ts` | 8649.932612 | `c03-index` |
| 23 | `src/cli/dispatch.ts` | 8329.085443 | `c03-index` |
| 24 | `src/pr/index.ts` | 8029.173902 | `c07-index` |
| 25 | `src/start/dispatch.ts` | 7867.320197 | `c03-index` |
| 26 | `src/start/suite-blocker.ts` | 7744.161905 | `c03-index` |
| 27 | `packages/rafa-board/src/board/issue.ts` | 7558.633799 | `c01-github` |
| 28 | `packages/rafa-board/src/board/gate.ts` | 7354.81049 | `c01-github` |
| 29 | `packages/rafa/src/core/command/types.ts` | 7222.22295 | `c08-index` |
| 30 | `packages/rafa/src/core/plan/index.ts` | 6982.663667 | `c03-index` |
