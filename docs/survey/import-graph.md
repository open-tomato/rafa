# Import graph

Coverage: 2176 of 2176 tracked files read (src/ and packages/*/src/).

2176 files, 11022 edges (8477 value, 2545 type), 45 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 323 | `src/board` (116), `src/commands/issue` (32), `src/commands` (29), `src/commands/epic` (28), `src/tests` (27), `src/board/relations` (19), `src/refs` (13), `src/commands/plan` (10), `src/next` (8), `src/commands/pr` (7), `packages/rafa/src/core/git` (6), `src/commands/board` (5), `src/board/project` (4), `src/claims` (3), `src/start` (3), `src/adapters/tracker` (2), `src/status` (2), `src/suite` (2), `src/triage` (2), `packages/rafa/src/board` (1), `src/epic` (1), `src/plan` (1), `src/plan/risk` (1), `src/project` (1) |
| `c02-cli-capture` | 251 | `src/tests` (84), `src/release` (68), `src/commands/release` (35), `src/start` (23), `src/commands` (9), `src/commands/pr` (9), `src/project` (5), `packages/rafa/src/release` (2), `src` (2), `src/commands/bug` (2), `src/pr` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src/cli` (1), `src/commands/config` (1), `src/docs` (1), `src/next` (1), `src/notices` (1), `src/tests/effort-coupled/effort` (1) |
| `c03-index` | 243 | `packages/rafa-effort/src/effort` (38), `src/triage` (29), `packages/rafa/src/effort/store` (25), `src/adapters/tracker` (17), `src/start` (17), `packages/rafa/src/bugs` (13), `src/tests` (11), `packages/rafa/src/triage` (10), `packages/rafa/src/adapters/logger` (8), `src/commands/issue` (8), `src/bugs` (6), `src/commands/bug` (6), `src/docs` (5), `src/tests/effort-coupled/effort` (5), `packages/rafa/src/ports` (4), `src/commands/epic` (4), `packages/rafa/src/report` (3), `src/epic` (3), `src/tests/core-coupled/adapters/logger` (3), `src/tests/core-coupled/bugs` (3), `packages/rafa/src/effort` (2), `src/commands/docs` (2), `src/commands/effort` (2), `src/commands/plan` (2), `src/commands/release` (2), `src/tests/core-coupled/effort/store` (2), `packages/rafa/src` (1), `packages/rafa/src/modules/testdata/sync-fixture` (1), `packages/rafa/src/project` (1), `packages/rafa/src/utils` (1), `src/adapters/output` (1), `src/board/project` (1), `src/cli` (1), `src/ports` (1), `src/project` (1), `src/tests/core-coupled/ports` (1), `src/tests/core-coupled/project` (1), `src/tests/core-coupled/utils` (1), `src/tests/inventory-coupled/inventory/search` (1) |
| `c04-sections` | 224 | `src/commands` (22), `packages/rafa-inventory/src/inventory` (14), `src/tests` (14), `packages/rafa-inventory/src/schema` (11), `packages/rafa-inventory/src/backfill` (10), `packages/rafa-inventory/src/demote` (10), `packages/rafa-inventory/src/learning` (10), `packages/rafa-inventory/src/tiers` (10), `src/commands/instinct` (9), `src/commands/skill` (9), `packages/rafa-inventory/src/check` (8), `packages/rafa-inventory/src/task` (8), `src/commands/plan` (8), `src/plan` (7), `src/commands/agent` (6), `src/preflight` (6), `src/start` (5), `packages/rafa/src/plan` (4), `packages/rafa/src/plan/risk` (4), `packages/rafa/src/schema` (4), `packages/rafa-inventory/src/adapters/learning` (3), `packages/rafa-inventory/src/plan/risk` (3), `packages/rafa/src/project` (3), `src` (3), `src/pr` (3), `packages/rafa-effort/src/effort` (2), `packages/rafa-inventory/src/agents` (2), `packages/rafa-inventory/src/inventory/search` (2), `packages/rafa-inventory/src/report` (2), `packages/rafa-inventory/src/start` (2), `packages/rafa/src/core/config` (2), `packages/rafa/src/modules` (2), `packages/rafa/src/utils` (2), `src/schema` (2), `src/tests/inventory-coupled/agents` (2), `src/tests/inventory-coupled/tiers` (2), `packages/rafa/src/board` (1), `src/board` (1), `src/plan/risk` (1), `src/tests/core-coupled/plan` (1), `src/tests/core-coupled/report` (1), `src/tests/inventory-coupled/adapters/learning` (1), `src/tests/inventory-coupled/plan/risk` (1), `src/tiers` (1) |
| `c05-index` | 189 | `src/commands/pr` (61), `src/pr` (32), `src/cleanup` (22), `src/start` (20), `src/pr/triage` (18), `src/commands` (8), `src/tests` (8), `src/pr/plans` (5), `packages/rafa/src/utils` (3), `src/board` (3), `src/next` (2), `packages/rafa/src/schema` (1), `packages/rafa/src/start` (1), `src/commands/release` (1), `src/status` (1), `src/tests/core-coupled/schema` (1), `src/tests/core-coupled/start` (1), `src/tests/core-coupled/utils` (1) |
| `c06-index` | 157 | `src/start` (93), `src/tests` (16), `src/suite` (13), `src/board` (11), `packages/rafa/src/core/plan` (5), `src/commands/plan` (4), `packages/rafa/src/adapters/output` (2), `packages/rafa/src/utils` (2), `src/adapters/planner` (2), `packages/rafa/src` (1), `packages/rafa/src/core/output` (1), `packages/rafa/src/ports` (1), `src` (1), `src/notices` (1), `src/preflight` (1), `src/tests/core-coupled/utils` (1), `src/triage` (1), `src/utils` (1) |
| `c07-index` | 151 | `packages/rafa/src/core/config` (28), `packages/rafa/src/core/command` (16), `src/tests/core-coupled` (14), `packages/rafa/src` (12), `src/config` (8), `src` (6), `src/tests/core-coupled/core/config` (6), `src/commands` (5), `src/commands/config` (5), `src/tests` (5), `packages/rafa/src/core/adapters` (4), `packages/rafa/src/core/output` (4), `packages/rafa-effort/src/effort/sync` (3), `packages/rafa/src/core/loop` (3), `src/project` (3), `src/tests/effort-coupled/effort/sync` (3), `packages/rafa/src/modules` (2), `src/release` (2), `src/start` (2), `src/tests/core-coupled/core/output` (2), `src/tests/core-coupled/effort/store` (2), `src/utils` (2), `packages/rafa/src/adapters/logger` (1), `packages/rafa/src/core/git` (1), `packages/rafa/src/effort/store` (1), `packages/rafa/src/modules/testdata/hub-down-sync` (1), `packages/rafa/src/ports` (1), `src/board` (1), `src/modules` (1), `src/modules/testdata/pull-merge-sync` (1), `src/preflight` (1), `src/suite` (1), `src/tests/core-coupled/core/command` (1), `src/tests/core-coupled/core/loop` (1), `src/tests/core-coupled/modules` (1), `src/tests/core-coupled/project` (1) |
| `c08-index` | 144 | `src/next` (30), `packages/rafa/src/core/loop` (19), `src/commands/loop` (14), `packages/rafa/src/core/plan` (11), `src/status` (9), `src/board` (8), `src/loop` (8), `src/tests` (8), `src/commands` (7), `src/start` (5), `src/pr` (3), `packages/rafa/src/effort/store` (2), `packages/rafa/src/next` (2), `packages/rafa/src/project` (2), `packages/rafa/src/runtime` (2), `src/commands/plan` (2), `src/runtime` (2), `src/suite` (2), `packages/rafa-effort/src/effort` (1), `packages/rafa/src/commands/plan` (1), `src/plan` (1), `src/project` (1), `src/tests/core-coupled/commands/plan` (1), `src/tests/core-coupled/next` (1), `src/tests/core-coupled/project` (1), `src/tests/effort-coupled/effort` (1) |
| `c09-sqlite` | 134 | `packages/rafa/src/effort/store` (65), `src/commands/effort` (15), `src/tests` (10), `src/tests/core-coupled/effort/store` (10), `packages/rafa-inventory/src/inventory/search` (9), `packages/rafa-effort/src/effort` (6), `packages/rafa/src/effort/store/testdata` (4), `packages/rafa/src/core/runtime` (3), `src/commands` (3), `packages/rafa/src/effort` (2), `src/tests/effort-coupled/effort/sync` (2), `packages/rafa-effort/src/effort/sync` (1), `src/claims` (1), `src/commands/claim` (1), `src/commands/skill` (1), `src/tests/core-coupled/core/runtime` (1) |
| `c10-index` | 110 | `src/cli` (19), `src/cli/prompt` (10), `src/commands/update` (10), `src/commands` (8), `packages/rafa/src/errors` (6), `src/errors` (6), `src/next` (6), `src/tests` (6), `src/status` (5), `src/cli/core` (4), `src/commands/module` (4), `src/commands/plan` (3), `src/board` (2), `src/bugs` (2), `src/commands/effort` (2), `src/commands/instinct` (2), `src/inventory` (2), `packages/rafa/src/core/command` (1), `packages/rafa/src/errors/fixtures` (1), `packages/rafa/src/modules/testdata/seam-fixture` (1), `src` (1), `src/adapters/output` (1), `src/commands/agent` (1), `src/commands/bug` (1), `src/commands/loop` (1), `src/commands/skill` (1), `src/notices` (1), `src/pr` (1), `src/release` (1), `src/tests/core-coupled/errors` (1) |
| `c11-refresh` | 68 | `src/board/project` (38), `src/commands` (9), `packages/rafa/src/project` (3), `src/commands/issue` (3), `src/tests` (3), `src/commands/board` (2), `src/commands/epic` (2), `src/commands/release` (2), `src/project` (2), `src/start` (2), `src/tests/core-coupled/project` (2) |
| `c12-git` | 45 | `src/commands/claim` (12), `src/claims` (9), `packages/rafa/src/claims` (6), `src/board` (4), `src/start` (4), `src/tests` (4), `packages/rafa/src/start` (2), `src/commands/plan` (2), `src/status` (2) |
| `c13-index` | 44 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa/src/effort/store` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1) |
| `c14-start` | 32 | `src/stretch` (13), `src/commands/stretch` (8), `src/ci` (7), `src` (2), `src/commands/ci` (2) |
| `c15-sweep-timeout` | 30 | `src/tests` (22), `src/fixtures` (5), `src/commands` (1), `src/start` (1), `src/tests/core-coupled/effort/store` (1) |
| `c16-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c17-config-schema-readings` | 1 | `packages/rafa/src` (1) |
| `c18-registry-types.test` | 1 | `packages/rafa/src/core/command` (1) |
| `c19-types.test` | 1 | `packages/rafa/src/core/command` (1) |
| `c20-index.test` | 1 | `src/commands/board` (1) |
| `c21-declarations.test` | 1 | `src/commands/claim` (1) |
| `c22-index.test` | 1 | `src/commands/claim` (1) |
| `c23-declarations.test` | 1 | `src/commands/epic` (1) |
| `c24-declarations.test` | 1 | `src/commands/issue` (1) |
| `c25-declarations.test` | 1 | `src/commands/pr` (1) |
| `c26-index.test` | 1 | `src/commands/pr` (1) |
| `c27-declarations.test` | 1 | `src/commands/release` (1) |
| `c28-index.test` | 1 | `src/commands/release` (1) |
| `c29-types.test` | 1 | `src/pr` (1) |
| `c30-agent-gates.test` | 1 | `src/tests` (1) |
| `c31-agents-split-accounting.test` | 1 | `src/tests` (1) |
| `c32-cut-table-shape.test` | 1 | `src/tests` (1) |
| `c33-dependabot-config.test` | 1 | `src/tests` (1) |
| `c34-entry-exports.test` | 1 | `src/tests` (1) |
| `c35-epic-guard-workflow.test` | 1 | `src/tests` (1) |
| `c36-eslint-stand-in` | 1 | `src/tests` (1) |
| `c37-learning-boundary.test` | 1 | `src/tests` (1) |
| `c38-package-lint-spawned.test` | 1 | `src/tests` (1) |
| `c39-references-gate-spawned.test` | 1 | `src/tests` (1) |
| `c40-release-bot-fragment-workflow.test` | 1 | `src/tests` (1) |
| `c41-release-publish-workflow.test` | 1 | `src/tests` (1) |
| `c42-skill-gap-section.test` | 1 | `src/tests` (1) |
| `c43-verify-workflow.test` | 1 | `src/tests` (1) |
| `c44-cli.test` | 1 | `src/tools/ts-symbols` (1) |
| `c45-cli` | 1 | `src/tools/ts-symbols` (1) |

## The 30 files of highest betweenness

| Rank | File | Betweenness | Cluster |
| --- | --- | --- | --- |
| 1 | `packages/rafa/src/ports/index.ts` | 62718.925435 | `c03-index` |
| 2 | `packages/rafa/src/effort/store/merge-store.ts` | 50943.39196 | `c09-sqlite` |
| 3 | `src/tests/cli-capture.ts` | 31301.892516 | `c02-cli-capture` |
| 4 | `packages/rafa/src/core/command/index.ts` | 24167.294289 | `c10-index` |
| 5 | `packages/rafa/src/core/config/index.ts` | 22587.170359 | `c07-index` |
| 6 | `src/commands/index.ts` | 18039.06669 | `c10-index` |
| 7 | `src/adapters/tracker/github.ts` | 17729.471162 | `c01-github` |
| 8 | `packages/rafa/src/core/loop/index.ts` | 17176.303982 | `c08-index` |
| 9 | `src/project/scaffold.ts` | 12778.707362 | `c02-cli-capture` |
| 10 | `packages/rafa/src/core/config/scope.ts` | 12736.897135 | `c07-index` |
| 11 | `src/board/relations/labels.ts` | 12600.289628 | `c01-github` |
| 12 | `packages/rafa/src/core/config/config-load.ts` | 11964.194712 | `c07-index` |
| 13 | `src/board/setup.ts` | 11444.278141 | `c01-github` |
| 14 | `src/pr/index.ts` | 11029.675247 | `c05-index` |
| 15 | `packages/rafa/src/core/output/active.ts` | 10934.411731 | `c07-index` |
| 16 | `src/config-registry.ts` | 10506.419971 | `c07-index` |
| 17 | `src/board/roadmap.ts` | 9830.729004 | `c01-github` |
| 18 | `packages/rafa/src/effort/store/development-build.ts` | 9817.113092 | `c09-sqlite` |
| 19 | `src/board/project/refresh.ts` | 9698.704092 | `c11-refresh` |
| 20 | `packages/rafa/src/effort/store/sqlite.ts` | 9340.60171 | `c09-sqlite` |
| 21 | `src/start/dispatch.ts` | 9179.759017 | `c06-index` |
| 22 | `packages/rafa/src/core/config/sections.ts` | 9106.892246 | `c04-sections` |
| 23 | `src/start/loop-events.ts` | 8633.578623 | `c06-index` |
| 24 | `src/start/suite-step.ts` | 8587.246104 | `c06-index` |
| 25 | `src/cli/dispatch.ts` | 8273.46786 | `c10-index` |
| 26 | `src/start/suite-blocker.ts` | 7685.980159 | `c06-index` |
| 27 | `src/board/issue.ts` | 7514.499141 | `c01-github` |
| 28 | `src/board/gate.ts` | 7313.662224 | `c06-index` |
| 29 | `packages/rafa/src/core/command/types.ts` | 7182.980337 | `c07-index` |
| 30 | `packages/rafa/src/core/plan/index.ts` | 6975.350669 | `c08-index` |
