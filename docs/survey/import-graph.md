# Import graph

Coverage: 2168 of 2168 tracked files read (src/ and packages/*/src/).

2168 files, 10989 edges (8453 value, 2536 type), 44 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 337 | `src/board` (120), `src/commands` (31), `src/tests` (29), `src/commands/epic` (28), `src/commands/issue` (27), `src/board/relations` (19), `src/refs` (13), `src/commands/plan` (10), `src/status` (10), `src/next` (9), `src/commands/pr` (8), `packages/rafa/src/core/git` (6), `src/board/project` (4), `src/commands/board` (3), `src/pr` (3), `packages/rafa/src/project` (2), `src/adapters/tracker` (2), `src/claims` (2), `src/start` (2), `src/suite` (2), `src/triage` (2), `packages/rafa/src/board` (1), `src/cli` (1), `src/epic` (1), `src/plan` (1), `src/plan/risk` (1) |
| `c02-index` | 271 | `packages/rafa-effort/src/effort` (40), `src/triage` (33), `packages/rafa/src/effort/store` (25), `src/start` (25), `src/adapters/tracker` (17), `src/tests` (14), `packages/rafa-inventory/src/learning` (10), `src/commands/issue` (10), `packages/rafa/src/bugs` (9), `src/commands/instinct` (8), `packages/rafa/src/adapters/logger` (7), `src/bugs` (6), `src/tests/effort-coupled/effort` (6), `src/docs` (5), `packages/rafa-inventory/src/schema` (4), `packages/rafa/src/triage` (4), `src/commands/epic` (4), `packages/rafa-inventory/src/adapters/learning` (3), `packages/rafa/src/report` (3), `src/epic` (3), `src/tests/core-coupled/adapters/logger` (3), `src/tests/core-coupled/bugs` (3), `packages/rafa-inventory/src/report` (2), `packages/rafa/src/effort` (2), `packages/rafa/src/ports` (2), `src/commands/docs` (2), `src/commands/effort` (2), `src/commands/plan` (2), `src/commands/release` (2), `src/tests/core-coupled/effort/store` (2), `packages/rafa/src` (1), `packages/rafa/src/modules/testdata/sync-fixture` (1), `packages/rafa/src/project` (1), `packages/rafa/src/utils` (1), `src/adapters/output` (1), `src/board/project` (1), `src/ports` (1), `src/tests/core-coupled/ports` (1), `src/tests/core-coupled/project` (1), `src/tests/core-coupled/report` (1), `src/tests/core-coupled/utils` (1), `src/tests/inventory-coupled/adapters/learning` (1), `src/tests/inventory-coupled/inventory/search` (1) |
| `c03-cli-capture` | 258 | `src/tests` (80), `src/release` (69), `src/commands/release` (36), `src/start` (21), `src/commands/pr` (15), `src/commands` (9), `src/project` (5), `packages/rafa/src/release` (2), `src/cli` (2), `src/commands/bug` (2), `src/commands/config` (2), `src/notices` (2), `src/pr` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src` (1), `src/docs` (1), `src/next` (1), `src/tests/core-coupled/next` (1), `src/tests/core-coupled/project` (1), `src/tests/core-coupled/utils` (1), `src/tests/effort-coupled/effort` (1) |
| `c04-index` | 204 | `src/commands/pr` (30), `src/cleanup` (21), `src/cli` (17), `src/commands/loop` (15), `src/commands` (14), `src/tests` (13), `src/cli/prompt` (10), `src/commands/update` (10), `src/status` (7), `packages/rafa/src/errors` (6), `src/errors` (6), `src/loop` (6), `src/next` (5), `src/cli/core` (4), `src/commands/module` (4), `src/commands/instinct` (3), `src/commands/plan` (3), `src/board` (2), `src/bugs` (2), `src/commands/board` (2), `src/commands/effort` (2), `src/inventory` (2), `src/pr` (2), `src/utils` (2), `packages/rafa/src/adapters/logger` (1), `packages/rafa/src/commands/plan` (1), `packages/rafa/src/core/command` (1), `packages/rafa/src/core/loop` (1), `packages/rafa/src/errors/fixtures` (1), `packages/rafa/src/modules/testdata/seam-fixture` (1), `packages/rafa/src/start` (1), `src/adapters/output` (1), `src/commands/agent` (1), `src/commands/bug` (1), `src/commands/config` (1), `src/commands/skill` (1), `src/start` (1), `src/tests/core-coupled/commands/plan` (1), `src/tests/core-coupled/errors` (1), `src/tests/core-coupled/start` (1) |
| `c05-sections` | 196 | `src/commands` (23), `packages/rafa-inventory/src/inventory` (14), `src/tests` (11), `packages/rafa-inventory/src/backfill` (10), `packages/rafa-inventory/src/demote` (10), `packages/rafa-inventory/src/tiers` (10), `src/commands/skill` (9), `packages/rafa-inventory/src/check` (8), `packages/rafa-inventory/src/task` (8), `src/commands/plan` (8), `src/plan` (8), `packages/rafa-inventory/src/schema` (7), `packages/rafa/src/project` (6), `src/commands/agent` (6), `src/preflight` (6), `src/project` (5), `packages/rafa/src/plan/risk` (4), `packages/rafa/src/schema` (4), `src/start` (4), `packages/rafa-inventory/src/plan/risk` (3), `packages/rafa/src/plan` (3), `src` (3), `packages/rafa-inventory/src/agents` (2), `packages/rafa-inventory/src/inventory/search` (2), `packages/rafa/src/core/config` (2), `packages/rafa/src/utils` (2), `src/schema` (2), `src/tests/core-coupled/project` (2), `src/tests/inventory-coupled/agents` (2), `src/tests/inventory-coupled/tiers` (2), `packages/rafa-effort/src/effort` (1), `packages/rafa-inventory/src/start` (1), `packages/rafa/src/board` (1), `packages/rafa/src/modules` (1), `src/board` (1), `src/notices` (1), `src/plan/risk` (1), `src/tests/core-coupled/plan` (1), `src/tests/inventory-coupled/plan/risk` (1), `src/tiers` (1) |
| `c06-index` | 175 | `src/start` (107), `src/tests` (18), `src/suite` (15), `src/commands/bug` (6), `src/bugs` (4), `packages/rafa/src/utils` (3), `packages/rafa/src/adapters/output` (2), `packages/rafa/src/runtime` (2), `src` (2), `src/commands` (2), `src/loop` (2), `src/runtime` (2), `packages/rafa-inventory/src/start` (1), `packages/rafa/src` (1), `packages/rafa/src/core/loop` (1), `packages/rafa/src/core/output` (1), `src/cleanup` (1), `src/commands/stretch` (1), `src/preflight` (1), `src/tests/core-coupled/utils` (1), `src/triage` (1), `src/utils` (1) |
| `c07-index` | 150 | `packages/rafa/src/core/config` (28), `packages/rafa/src/core/command` (16), `src/tests/core-coupled` (14), `packages/rafa/src` (12), `src/config` (8), `src` (7), `src/tests/core-coupled/core/config` (6), `src/commands` (5), `src/tests` (5), `packages/rafa/src/core/adapters` (4), `packages/rafa/src/core/output` (4), `packages/rafa-effort/src/effort/sync` (3), `packages/rafa/src/core/loop` (3), `packages/rafa/src/modules` (3), `src/commands/config` (3), `src/project` (3), `src/tests/effort-coupled/effort/sync` (3), `src/release` (2), `src/start` (2), `src/tests/core-coupled/core/output` (2), `src/tests/core-coupled/effort/store` (2), `packages/rafa/src/adapters/logger` (1), `packages/rafa/src/core/git` (1), `packages/rafa/src/effort/store` (1), `packages/rafa/src/modules/testdata/hub-down-sync` (1), `packages/rafa/src/ports` (1), `src/board` (1), `src/cli` (1), `src/modules` (1), `src/modules/testdata/pull-merge-sync` (1), `src/preflight` (1), `src/suite` (1), `src/tests/core-coupled/core/command` (1), `src/tests/core-coupled/core/loop` (1), `src/tests/core-coupled/modules` (1), `src/tests/core-coupled/project` (1) |
| `c08-index` | 145 | `src/pr` (34), `src/commands/pr` (24), `src/pr/triage` (18), `src/claims` (16), `src/commands/claim` (12), `src/board` (10), `src/start` (10), `src/tests` (7), `src/pr/plans` (5), `src/commands/plan` (2), `src/next` (2), `src/status` (2), `packages/rafa/src/schema` (1), `src/commands` (1), `src/tests/core-coupled/schema` (1) |
| `c09-sqlite` | 134 | `packages/rafa/src/effort/store` (65), `src/commands/effort` (15), `src/tests` (10), `src/tests/core-coupled/effort/store` (10), `packages/rafa-inventory/src/inventory/search` (9), `packages/rafa-effort/src/effort` (6), `packages/rafa/src/effort/store/testdata` (4), `packages/rafa/src/core/runtime` (3), `src/commands` (3), `packages/rafa/src/effort` (2), `src/tests/effort-coupled/effort/sync` (2), `packages/rafa-effort/src/effort/sync` (1), `src/claims` (1), `src/commands/claim` (1), `src/commands/skill` (1), `src/tests/core-coupled/core/runtime` (1) |
| `c10-index` | 99 | `src/next` (30), `packages/rafa/src/core/loop` (17), `packages/rafa/src/core/plan` (16), `src/board` (10), `src/commands/plan` (6), `src/tests` (6), `src/commands` (5), `packages/rafa/src/effort/store` (2), `packages/rafa/src/next` (2), `src/adapters/planner` (2), `packages/rafa/src/ports` (1), `src/plan` (1), `src/start` (1) |
| `c11-refresh` | 63 | `src/board/project` (38), `src/commands` (7), `src/commands/issue` (6), `src/start` (3), `src/tests` (3), `src/commands/board` (2), `src/commands/epic` (2), `src/commands/release` (2) |
| `c12-index` | 44 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa/src/effort/store` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1) |
| `c13-start` | 31 | `src/stretch` (13), `src/ci` (7), `src/commands/stretch` (7), `src` (2), `src/commands/ci` (2) |
| `c14-sweep-timeout` | 30 | `src/tests` (22), `src/fixtures` (5), `src/commands` (1), `src/start` (1), `src/tests/core-coupled/effort/store` (1) |
| `c15-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c16-config-schema-readings` | 1 | `packages/rafa/src` (1) |
| `c17-registry-types.test` | 1 | `packages/rafa/src/core/command` (1) |
| `c18-types.test` | 1 | `packages/rafa/src/core/command` (1) |
| `c19-index.test` | 1 | `src/commands/board` (1) |
| `c20-declarations.test` | 1 | `src/commands/claim` (1) |
| `c21-index.test` | 1 | `src/commands/claim` (1) |
| `c22-declarations.test` | 1 | `src/commands/epic` (1) |
| `c23-declarations.test` | 1 | `src/commands/issue` (1) |
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
| 1 | `packages/rafa/src/ports/index.ts` | 62765.840998 | `c02-index` |
| 2 | `packages/rafa/src/effort/store/merge-store.ts` | 50874.260319 | `c09-sqlite` |
| 3 | `src/tests/cli-capture.ts` | 31225.85256 | `c03-cli-capture` |
| 4 | `packages/rafa/src/core/command/index.ts` | 24433.809867 | `c04-index` |
| 5 | `packages/rafa/src/core/config/index.ts` | 22523.817171 | `c07-index` |
| 6 | `src/adapters/tracker/github.ts` | 18355.460364 | `c01-github` |
| 7 | `src/commands/index.ts` | 17961.881142 | `c04-index` |
| 8 | `packages/rafa/src/core/loop/index.ts` | 16923.595557 | `c06-index` |
| 9 | `src/board/relations/labels.ts` | 15231.782268 | `c01-github` |
| 10 | `src/pr/index.ts` | 14716.291329 | `c08-index` |
| 11 | `src/board/setup.ts` | 14296.032084 | `c01-github` |
| 12 | `src/board/roadmap.ts` | 12886.60954 | `c01-github` |
| 13 | `src/next/sources.ts` | 12832.310197 | `c10-index` |
| 14 | `src/project/scaffold.ts` | 12704.991887 | `c03-cli-capture` |
| 15 | `packages/rafa/src/core/config/scope.ts` | 12391.923204 | `c07-index` |
| 16 | `packages/rafa/src/core/config/config-load.ts` | 11709.250692 | `c07-index` |
| 17 | `src/board/gate.ts` | 10700.030659 | `c10-index` |
| 18 | `src/config-registry.ts` | 10471.132669 | `c07-index` |
| 19 | `packages/rafa/src/core/output/active.ts` | 10463.40694 | `c07-index` |
| 20 | `src/start/dispatch.ts` | 10052.284637 | `c06-index` |
| 21 | `src/board/project/refresh.ts` | 9715.495036 | `c11-refresh` |
| 22 | `packages/rafa/src/effort/store/development-build.ts` | 9684.192152 | `c09-sqlite` |
| 23 | `packages/rafa/src/effort/store/sqlite.ts` | 9225.300654 | `c09-sqlite` |
| 24 | `packages/rafa/src/core/config/sections.ts` | 9102.118378 | `c05-sections` |
| 25 | `src/refs/extract.ts` | 8475.778514 | `c01-github` |
| 26 | `src/triage/triage.ts` | 8281.292779 | `c02-index` |
| 27 | `src/cli/dispatch.ts` | 8266.950003 | `c04-index` |
| 28 | `src/board/issue.ts` | 7973.899786 | `c01-github` |
| 29 | `src/start/loop-events.ts` | 7969.115613 | `c06-index` |
| 30 | `src/start/suite-step.ts` | 7863.986616 | `c06-index` |
