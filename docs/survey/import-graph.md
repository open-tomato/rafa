# Import graph

Coverage: 2195 of 2195 tracked files read (src/ and packages/*/src/).

2195 files, 11095 edges (7893 value, 3202 type), 44 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 319 | `packages/rafa-board/src/board` (112), `src/commands` (25), `src/tests` (24), `packages/rafa-board/src/board/relations` (19), `src/next` (14), `packages/rafa-board/src/commands/epic` (11), `packages/rafa-board/src/refs` (11), `src/status` (11), `packages/rafa-board/src/commands/issue` (10), `src/tests/board-coupled/commands/epic` (10), `src/commands/plan` (8), `src/commands/pr` (8), `packages/rafa-board/src/next` (6), `src/tests/board-coupled/commands/issue` (6), `src/board` (5), `packages/rafa-board/src/board/project` (4), `src/pr` (3), `src/tests/board-coupled/board` (3), `packages/rafa-board/src/adapters/tracker` (2), `packages/rafa-board/src/tests` (2), `packages/rafa/src/next` (2), `packages/rafa/src/project` (2), `src/claims` (2), `src/start` (2), `src/suite` (2), `src/tests/board-coupled/commands` (2), `src/tests/board-coupled/refs` (2), `src/triage` (2), `packages/rafa-board/src/commands` (1), `packages/rafa-board/src/commands/board` (1), `packages/rafa-board/src/commands/plan` (1), `packages/rafa-board/src/epic` (1), `packages/rafa/src/board` (1), `packages/rafa/src/cli` (1), `src/commands/epic` (1), `src/tests/board-coupled/commands/board` (1), `src/tests/board-coupled/commands/plan` (1) |
| `c02-sections` | 282 | `src/commands` (33), `src/tests` (16), `packages/rafa-inventory/src/inventory` (14), `src` (13), `src/tests/core-coupled` (13), `packages/rafa/src` (12), `packages/rafa-inventory/src/backfill` (10), `packages/rafa-inventory/src/demote` (10), `packages/rafa-inventory/src/tiers` (10), `src/commands/skill` (10), `packages/rafa-inventory/src/check` (8), `packages/rafa-inventory/src/task` (8), `src/config` (8), `src/project` (8), `packages/rafa-inventory/src/schema` (7), `src/preflight` (7), `packages/rafa/src/project` (6), `src/commands/agent` (6), `src/commands/plan` (6), `src/plan` (6), `src/start` (6), `packages/rafa/src/core/config` (4), `packages/rafa/src/modules` (4), `packages/rafa/src/schema` (4), `packages/rafa-board/src/board` (3), `packages/rafa-effort/src/effort/sync` (3), `src/commands/config` (3), `src/tests/core-coupled/project` (3), `src/tests/effort-coupled/effort/sync` (3), `packages/rafa-inventory/src/agents` (2), `packages/rafa-inventory/src/inventory/search` (2), `packages/rafa-inventory/src/start` (2), `packages/rafa-release/src/release` (2), `packages/rafa/src/plan` (2), `packages/rafa/src/utils` (2), `src/commands/module` (2), `src/pr` (2), `src/schema` (2), `src/tests/inventory-coupled/agents` (2), `src/tests/inventory-coupled/tiers` (2), `src/tests/release-coupled/release` (2), `packages/rafa-effort/src/effort` (1), `packages/rafa/src/board` (1), `packages/rafa/src/core/adapters` (1), `packages/rafa/src/pr` (1), `src/cli` (1), `src/commands/instinct` (1), `src/modules` (1), `src/notices` (1), `src/status` (1), `src/tests/board-coupled/board` (1), `src/tests/core-coupled/core/config` (1), `src/tests/core-coupled/effort/store` (1), `src/tests/core-coupled/modules` (1), `src/tiers` (1) |
| `c03-parse` | 233 | `packages/rafa-effort/src/effort` (44), `src/triage` (27), `packages/rafa/src/effort/store` (25), `src/start` (14), `packages/rafa/src/bugs` (13), `packages/rafa/src/triage` (12), `src/commands/bug` (7), `src/tests` (7), `src/tests/effort-coupled/effort` (7), `packages/rafa/src/errors` (6), `src/bugs` (6), `src/errors` (6), `packages/rafa/src/core/services` (5), `packages/rafa-board/src/commands/epic` (4), `packages/rafa-board/src/epic` (3), `packages/rafa-release/src/docs` (3), `packages/rafa/src/report` (3), `packages/rafa/src/utils` (3), `src/tests/core-coupled/bugs` (3), `packages/rafa-board/src/adapters/tracker` (2), `packages/rafa-board/src/bugs` (2), `packages/rafa/src/effort` (2), `packages/rafa/src/ports` (2), `src/cli` (2), `src/commands/docs` (2), `src/commands/pr` (2), `src/tests/board-coupled/commands/epic` (2), `src/tests/core-coupled/effort/store` (2), `packages/rafa-board/src/board/project` (1), `packages/rafa-board/src/commands/issue` (1), `packages/rafa-release/src/commands/release` (1), `packages/rafa/src` (1), `packages/rafa/src/errors/fixtures` (1), `packages/rafa/src/project` (1), `packages/rafa/src/start` (1), `src` (1), `src/pr` (1), `src/tests/core-coupled` (1), `src/tests/core-coupled/errors` (1), `src/tests/core-coupled/project` (1), `src/tests/core-coupled/start` (1), `src/tests/core-coupled/utils` (1), `src/tests/inventory-coupled/inventory/search` (1), `src/tests/release-coupled/commands/release` (1), `src/tests/release-coupled/docs` (1) |
| `c04-index` | 200 | `src/commands/pr` (26), `src/next` (17), `src/commands` (14), `src/commands/loop` (14), `src/stretch` (13), `packages/rafa-board/src/commands/issue` (12), `src/cli` (12), `src/commands/update` (10), `src/tests` (8), `src/ci` (7), `src/commands/plan` (7), `src/commands/stretch` (7), `src/loop` (6), `packages/rafa-board/src/commands/epic` (5), `src/cli/core` (4), `src/commands/effort` (4), `src/start` (3), `src/tests/board-coupled/commands/issue` (3), `packages/rafa-board/src/board` (2), `packages/rafa-board/src/commands/board` (2), `packages/rafa/src/adapters/output` (2), `packages/rafa/src/cli` (2), `packages/rafa/src/pr` (2), `src/adapters/output` (2), `src/commands/ci` (2), `src/commands/instinct` (2), `src/commands/module` (2), `packages/rafa/src/commands/plan` (1), `packages/rafa/src/core/command` (1), `packages/rafa/src/core/loop` (1), `packages/rafa/src/modules/testdata/seam-fixture` (1), `src/commands/agent` (1), `src/commands/board` (1), `src/commands/config` (1), `src/commands/issue` (1), `src/plan` (1), `src/tests/core-coupled/commands/plan` (1) |
| `c05-index` | 197 | `src/start` (107), `src/tests` (17), `packages/rafa-board/src/board` (10), `src/suite` (10), `packages/rafa/src/core/plan` (6), `packages/rafa/src/suite` (6), `packages/rafa/src/plan/risk` (4), `src/commands/plan` (4), `packages/rafa-inventory/src/plan/risk` (3), `src/next` (3), `src/preflight` (3), `packages/rafa/src/plan` (2), `packages/rafa/src/utils` (2), `src/adapters/planner` (2), `src/docs` (2), `src/plan` (2), `src/plan/risk` (2), `src/triage` (2), `packages/rafa/src` (1), `packages/rafa/src/core/output` (1), `packages/rafa/src/ports` (1), `packages/rafa/src/tests` (1), `src` (1), `src/cleanup` (1), `src/tests/core-coupled/plan` (1), `src/tests/core-coupled/utils` (1), `src/tests/inventory-coupled/plan/risk` (1), `src/utils` (1) |
| `c06-index` | 189 | `packages/rafa-release/src/release` (57), `packages/rafa-release/src/commands/release` (19), `src/cleanup` (18), `src/commands/pr` (11), `src/tests/release-coupled/commands/release` (11), `src/cli/prompt` (10), `src/tests` (9), `src/commands` (8), `packages/rafa/src/core/git` (6), `src/start` (6), `src/pr/triage` (4), `src/status` (4), `packages/rafa/src/pr` (3), `packages/rafa-release/src/cleanup` (2), `packages/rafa-release/src/project` (2), `packages/rafa-release/src/release/strategies` (2), `packages/rafa/src/release` (2), `src/commands/release` (2), `src/inventory` (2), `src/pr` (2), `src/project` (2), `packages/rafa-release/src/next` (1), `packages/rafa/src/claims` (1), `packages/rafa/src/start` (1), `src/release` (1), `src/tests/release-coupled/next` (1), `src/tests/release-coupled/release` (1), `src/triage` (1) |
| `c07-cli-capture` | 156 | `src/tests` (77), `src/start` (21), `packages/rafa-release/src/release` (7), `src/commands/pr` (6), `packages/rafa/src/tests` (5), `src/commands` (4), `packages/rafa-release/src/commands` (2), `packages/rafa/src/runtime` (2), `src` (2), `src/commands/bug` (2), `src/commands/config` (2), `src/loop` (2), `src/notices` (2), `src/runtime` (2), `src/tests/release-coupled/commands/release` (2), `src/utils` (2), `packages/rafa-release/src/commands/release` (1), `packages/rafa/src/core/loop` (1), `packages/rafa/src/pr` (1), `src/cleanup` (1), `src/cli` (1), `src/commands/loop` (1), `src/commands/release` (1), `src/commands/skill` (1), `src/commands/stretch` (1), `src/next` (1), `src/project` (1), `src/status` (1), `src/tests/core-coupled/next` (1), `src/tests/core-coupled/project` (1), `src/tests/release-coupled/commands` (1), `src/tests/release-coupled/release` (1) |
| `c08-index` | 140 | `src/pr` (28), `src/commands/pr` (24), `src/pr/triage` (16), `src/commands/claim` (12), `src/start` (9), `src/claims` (8), `src/tests` (8), `packages/rafa-board/src/board` (5), `packages/rafa/src/claims` (5), `src/pr/plans` (5), `src/next` (4), `src/tests/board-coupled/board` (4), `packages/rafa-board/src/claims` (2), `src/commands/plan` (2), `src/status` (2), `packages/rafa/src/schema` (1), `packages/rafa/src/start` (1), `packages/rafa/src/utils` (1), `src/board` (1), `src/tests/core-coupled/schema` (1), `src/tests/core-coupled/utils` (1) |
| `c09-sqlite` | 130 | `packages/rafa/src/effort/store` (66), `src/commands/effort` (15), `src/tests/core-coupled/effort/store` (11), `packages/rafa-inventory/src/inventory/search` (9), `src/tests` (9), `packages/rafa/src/effort/store/testdata` (4), `packages/rafa/src/core/runtime` (3), `src/commands` (3), `packages/rafa-effort/src/effort` (2), `packages/rafa/src/effort` (2), `src/tests/effort-coupled/effort/sync` (2), `packages/rafa-effort/src/effort/sync` (1), `src/claims` (1), `src/commands/claim` (1), `src/tests/core-coupled/core/runtime` (1) |
| `c10-index` | 100 | `packages/rafa-board/src/adapters/tracker` (13), `packages/rafa-inventory/src/learning` (10), `packages/rafa/src/adapters/logger` (9), `src/tests` (9), `src/commands/instinct` (8), `src/start` (6), `src/tests/board-coupled/commands/issue` (5), `packages/rafa-inventory/src/schema` (4), `packages/rafa-inventory/src/adapters/learning` (3), `packages/rafa/src/core/adapters` (3), `packages/rafa/src/core/output` (3), `packages/rafa/src/ports` (3), `src/tests/core-coupled/adapters/logger` (3), `packages/rafa-board/src/commands/issue` (2), `packages/rafa-inventory/src/report` (2), `src/cli` (2), `src/commands/plan` (2), `src/tests/board-coupled/adapters/tracker` (2), `src/tests/core-coupled/core/output` (2), `packages/rafa/src/core/git` (1), `packages/rafa/src/modules/testdata/hub-down-sync` (1), `packages/rafa/src/modules/testdata/sync-fixture` (1), `packages/rafa/src/tests` (1), `src/modules/testdata/pull-merge-sync` (1), `src/ports` (1), `src/tests/core-coupled/ports` (1), `src/tests/core-coupled/report` (1), `src/tests/inventory-coupled/adapters/learning` (1) |
| `c11-config-sections` | 84 | `packages/rafa/src/core/config` (26), `packages/rafa/src/core/loop` (20), `packages/rafa/src/core/command` (18), `packages/rafa/src/core/plan` (10), `src/tests/core-coupled/core/config` (5), `packages/rafa/src/effort/store` (2), `packages/rafa/src/core/output` (1), `src/tests/core-coupled/core/command` (1), `src/tests/core-coupled/core/loop` (1) |
| `c12-refresh` | 59 | `packages/rafa-board/src/board/project` (37), `src/commands` (7), `src/start` (3), `src/tests` (3), `src/tests/board-coupled/commands/issue` (2), `packages/rafa-board/src/commands/board` (1), `packages/rafa-board/src/commands/issue` (1), `packages/rafa-release/src/commands/release` (1), `src/tests/board-coupled/board/project` (1), `src/tests/board-coupled/commands/board` (1), `src/tests/board-coupled/commands/epic` (1), `src/tests/release-coupled/commands/release` (1) |
| `c13-index` | 44 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa/src/effort/store` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1) |
| `c14-sweep-timeout` | 31 | `src/tests` (24), `src/fixtures` (5), `src/commands` (1), `src/tests/core-coupled/effort/store` (1) |
| `c15-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c16-index.test` | 1 | `packages/rafa-board/src/commands/board` (1) |
| `c17-declarations.test` | 1 | `packages/rafa-board/src/commands/epic` (1) |
| `c18-declarations.test` | 1 | `packages/rafa-board/src/commands/issue` (1) |
| `c19-declarations.test` | 1 | `packages/rafa-release/src/commands/release` (1) |
| `c20-index.test` | 1 | `packages/rafa-release/src/commands/release` (1) |
| `c21-config-schema-readings` | 1 | `packages/rafa/src` (1) |
| `c22-registry-types.test` | 1 | `packages/rafa/src/core/command` (1) |
| `c23-types.test` | 1 | `packages/rafa/src/core/command` (1) |
| `c24-types.test` | 1 | `packages/rafa/src/pr` (1) |
| `c25-declarations.test` | 1 | `src/commands/claim` (1) |
| `c26-index.test` | 1 | `src/commands/claim` (1) |
| `c27-declarations.test` | 1 | `src/commands/pr` (1) |
| `c28-index.test` | 1 | `src/commands/pr` (1) |
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
| 1 | `packages/rafa/src/ports/index.ts` | 63285.69565 | `c10-index` |
| 2 | `packages/rafa/src/effort/store/merge-store.ts` | 51494.28943 | `c09-sqlite` |
| 3 | `src/tests/cli-capture.ts` | 31522.791667 | `c07-cli-capture` |
| 4 | `packages/rafa/src/core/command/index.ts` | 25968.753646 | `c04-index` |
| 5 | `packages/rafa/src/core/config/index.ts` | 22527.541422 | `c02-sections` |
| 6 | `src/commands/index.ts` | 18025.557385 | `c04-index` |
| 7 | `packages/rafa/src/core/loop/index.ts` | 17754.482432 | `c07-cli-capture` |
| 8 | `packages/rafa-board/src/adapters/tracker/github.ts` | 16807.468821 | `c01-github` |
| 9 | `packages/rafa/src/core/config/scope.ts` | 12977.312467 | `c11-config-sections` |
| 10 | `src/project/scaffold.ts` | 12695.073068 | `c07-cli-capture` |
| 11 | `packages/rafa-board/src/board/relations/labels.ts` | 12568.86356 | `c01-github` |
| 12 | `packages/rafa/src/core/config/config-load.ts` | 12134.907042 | `c11-config-sections` |
| 13 | `packages/rafa/src/core/output/active.ts` | 11535.672646 | `c11-config-sections` |
| 14 | `packages/rafa-board/src/board/setup.ts` | 11195.437418 | `c01-github` |
| 15 | `src/config-registry.ts` | 10422.681876 | `c02-sections` |
| 16 | `packages/rafa-board/src/board/project/refresh.ts` | 10307.293531 | `c12-refresh` |
| 17 | `packages/rafa/src/effort/store/development-build.ts` | 10117.601041 | `c09-sqlite` |
| 18 | `packages/rafa-board/src/board/roadmap.ts` | 9928.735489 | `c01-github` |
| 19 | `packages/rafa/src/effort/store/sqlite.ts` | 9680.251687 | `c09-sqlite` |
| 20 | `packages/rafa/src/core/config/sections.ts` | 9140.190472 | `c02-sections` |
| 21 | `src/cli/dispatch.ts` | 8339.82711 | `c04-index` |
| 22 | `src/pr/index.ts` | 8006.160604 | `c08-index` |
| 23 | `src/start/suite-step.ts` | 7945.932612 | `c05-index` |
| 24 | `src/start/dispatch.ts` | 7867.138379 | `c05-index` |
| 25 | `packages/rafa-board/src/board/issue.ts` | 7544.255228 | `c01-github` |
| 26 | `src/start/loop-events.ts` | 7544.097274 | `c05-index` |
| 27 | `packages/rafa-board/src/board/gate.ts` | 7336.065385 | `c05-index` |
| 28 | `packages/rafa/src/core/command/types.ts` | 7286.419729 | `c11-config-sections` |
| 29 | `packages/rafa/src/core/plan/index.ts` | 6983.513831 | `c05-index` |
| 30 | `packages/rafa-inventory/src/inventory/record.ts` | 6878.826732 | `c02-sections` |
