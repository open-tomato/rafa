# Import graph

Coverage: 2167 of 2167 tracked files read (src/ and packages/*/src/).

2167 files, 10988 edges (8596 value, 2392 type), 46 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 326 | `src/board` (115), `src/commands/issue` (30), `src/commands` (29), `src/tests` (29), `src/commands/epic` (28), `src/board/relations` (19), `src/refs` (13), `src/commands/plan` (10), `src/next` (9), `src/commands/pr` (7), `packages/rafa/src/core/git` (6), `src/commands/board` (5), `src/board/project` (4), `src/start` (3), `src/status` (3), `packages/rafa/src/project` (2), `src/adapters/tracker` (2), `src/claims` (2), `src/suite` (2), `src/triage` (2), `packages/rafa/src/board` (1), `src/cli` (1), `src/epic` (1), `src/plan` (1), `src/plan/risk` (1), `src/project` (1) |
| `c02-sqlite` | 285 | `packages/rafa/src/effort/store` (90), `src/effort` (47), `src/triage` (33), `src/commands/effort` (15), `src/start` (15), `src/tests` (14), `src/tests/core-coupled/effort/store` (11), `packages/rafa/src/bugs` (9), `src/bugs` (6), `packages/rafa/src/effort/store/testdata` (4), `packages/rafa/src/triage` (4), `src/commands` (4), `packages/rafa/src/core/runtime` (3), `packages/rafa/src/report` (3), `src/adapters/tracker` (3), `src/commands/epic` (3), `src/effort/sync` (3), `src/tests/core-coupled/bugs` (3), `packages/rafa/src/effort` (2), `src/docs` (2), `packages/rafa/src/project` (1), `packages/rafa/src/utils` (1), `src` (1), `src/board/project` (1), `src/claims` (1), `src/commands/claim` (1), `src/commands/issue` (1), `src/inventory/search` (1), `src/tests/core-coupled/core/runtime` (1), `src/tests/core-coupled/project` (1), `src/tests/core-coupled/utils` (1) |
| `c03-cli-capture` | 276 | `src/tests` (86), `src/release` (66), `src/commands/release` (35), `src/start` (24), `src/commands` (9), `src/commands/pr` (9), `src/commands/loop` (6), `src/project` (5), `src/loop` (4), `src/effort` (3), `packages/rafa/src/project` (2), `packages/rafa/src/release` (2), `packages/rafa/src/runtime` (2), `src` (2), `src/commands/bug` (2), `src/commands/config` (2), `src/pr` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src/runtime` (2), `packages/rafa/src/core/loop` (1), `src/cleanup` (1), `src/cli` (1), `src/commands/effort` (1), `src/commands/stretch` (1), `src/docs` (1), `src/next` (1), `src/notices` (1), `src/tests/core-coupled/project` (1) |
| `c04-index` | 190 | `src/commands/pr` (61), `src/pr` (36), `src/cleanup` (21), `src/pr/triage` (18), `src/cli/prompt` (10), `src/tests` (10), `src/commands` (7), `src/start` (7), `src/next` (6), `src/pr/plans` (5), `src/inventory` (2), `packages/rafa/src/schema` (1), `packages/rafa/src/start` (1), `src/board` (1), `src/commands/release` (1), `src/status` (1), `src/tests/core-coupled/schema` (1), `src/tests/core-coupled/start` (1) |
| `c05-index` | 169 | `src/next` (31), `src/cli` (17), `src/status` (13), `src/commands` (12), `src/commands/update` (10), `src/commands/loop` (9), `src/tests` (9), `packages/rafa/src/errors` (6), `src/errors` (6), `src/commands/plan` (5), `src/cli/core` (4), `src/commands/module` (4), `src/commands/skill` (4), `src/loop` (4), `src/commands/effort` (3), `src/commands/instinct` (3), `packages/rafa/src/next` (2), `src/board` (2), `src/bugs` (2), `src/start` (2), `src/utils` (2), `packages/rafa/src/commands/plan` (1), `packages/rafa/src/core/command` (1), `packages/rafa/src/core/loop` (1), `packages/rafa/src/core/plan` (1), `packages/rafa/src/errors/fixtures` (1), `packages/rafa/src/modules/testdata/seam-fixture` (1), `packages/rafa/src/project` (1), `src/adapters/output` (1), `src/commands/agent` (1), `src/commands/bug` (1), `src/commands/config` (1), `src/effort` (1), `src/notices` (1), `src/plan` (1), `src/project` (1), `src/release` (1), `src/tests/core-coupled/commands/plan` (1), `src/tests/core-coupled/errors` (1), `src/tests/core-coupled/next` (1) |
| `c06-record` | 156 | `src/commands` (18), `src/inventory` (14), `src/tiers` (12), `src/inventory/search` (11), `src/backfill` (10), `src/demote` (10), `src/schema` (10), `src/check` (8), `src/task` (8), `src/tests` (8), `src/commands/skill` (7), `src/commands/agent` (6), `src/plan/risk` (5), `packages/rafa/src/plan/risk` (4), `packages/rafa/src/schema` (4), `src/agents` (4), `src/commands/plan` (4), `src/plan` (3), `src/start` (3), `packages/rafa/src/core/loop` (2), `packages/rafa/src/utils` (2), `src/effort` (2), `src/commands/instinct` (1) |
| `c07-index` | 155 | `packages/rafa/src/core/config` (29), `src` (25), `packages/rafa/src/core/command` (16), `src/config` (8), `src/commands` (7), `src/effort/sync` (6), `src/tests/core-coupled/core/config` (6), `src/tests` (5), `packages/rafa/src` (4), `packages/rafa/src/core/adapters` (4), `packages/rafa/src/core/output` (4), `packages/rafa/src/modules` (4), `src/release` (4), `src/tests/core-coupled` (4), `src/commands/config` (3), `src/project` (3), `src/tests/core-coupled/effort/store` (3), `src/start` (2), `src/tests/core-coupled/core/output` (2), `packages/rafa/src/adapters/logger` (1), `packages/rafa/src/core/git` (1), `packages/rafa/src/core/loop` (1), `packages/rafa/src/effort/store` (1), `packages/rafa/src/modules/testdata/hub-down-sync` (1), `packages/rafa/src/ports` (1), `src/board` (1), `src/cli` (1), `src/modules` (1), `src/modules/testdata/pull-merge-sync` (1), `src/preflight` (1), `src/tests/core-coupled/core/command` (1), `src/tests/core-coupled/core/loop` (1), `src/tests/core-coupled/modules` (1), `src/tests/core-coupled/project` (1), `src/tiers` (1) |
| `c08-index` | 152 | `src/start` (105), `src/tests` (14), `src/suite` (12), `src/commands/bug` (6), `src/bugs` (4), `packages/rafa/src/adapters/output` (2), `packages/rafa/src/utils` (2), `src` (2), `packages/rafa/src/core/output` (1), `src/preflight` (1), `src/tests/core-coupled/utils` (1), `src/triage` (1), `src/utils` (1) |
| `c09-sections` | 113 | `src/board` (17), `src/claims` (16), `src/commands/claim` (12), `src/commands/plan` (11), `src/tests` (9), `src/start` (8), `src/preflight` (6), `packages/rafa/src/core/plan` (5), `src/plan` (5), `packages/rafa/src/plan` (3), `src` (3), `src/commands` (3), `src/epic` (3), `src/adapters/planner` (2), `src/status` (2), `packages/rafa/src/board` (1), `packages/rafa/src/core/config` (1), `packages/rafa/src/ports` (1), `packages/rafa/src/utils` (1), `src/commands/epic` (1), `src/notices` (1), `src/tests/core-coupled/plan` (1), `src/tests/core-coupled/utils` (1) |
| `c10-index` | 90 | `src/adapters/tracker` (14), `src/learning` (10), `packages/rafa/src/adapters/logger` (8), `src/tests` (8), `src/commands/instinct` (7), `src/commands/issue` (7), `src/start` (7), `src/adapters/learning` (4), `src/docs` (3), `src/schema` (3), `src/tests/core-coupled/adapters/logger` (3), `packages/rafa/src/ports` (2), `src/commands/docs` (2), `src/commands/release` (2), `src/report` (2), `packages/rafa/src/modules/testdata/sync-fixture` (1), `src/adapters/output` (1), `src/cli` (1), `src/commands/plan` (1), `src/ports` (1), `src/project` (1), `src/tests/core-coupled/ports` (1), `src/tests/core-coupled/report` (1) |
| `c11-refresh` | 70 | `src/board/project` (38), `src/commands` (9), `src/commands/issue` (5), `packages/rafa/src/project` (3), `src/tests` (3), `src/commands/board` (2), `src/commands/epic` (2), `src/commands/release` (2), `src/project` (2), `src/start` (2), `src/tests/core-coupled/project` (2) |
| `c12-index` | 48 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa/src/effort` (2), `packages/rafa/src/effort/store` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort` (1), `src/effort/store` (1), `src/tests` (1) |
| `c13-start` | 33 | `src/stretch` (13), `src/ci` (7), `src/commands/stretch` (7), `src` (2), `src/commands` (2), `src/commands/ci` (2) |
| `c14-sessions` | 29 | `packages/rafa/src/core/loop` (17), `packages/rafa/src/core/plan` (10), `packages/rafa/src/effort/store` (2) |
| `c15-sweep-timeout` | 29 | `src/tests` (21), `src/fixtures` (5), `src/commands` (1), `src/start` (1), `src/tests/core-coupled/effort/store` (1) |
| `c16-board-owns` | 15 | `src/board` (8), `src/suite` (4), `src/pr` (3) |
| `c17-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
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
| `c29-config-schema-readings` | 1 | `src` (1) |
| `c30-types.test` | 1 | `src/pr` (1) |
| `c31-agent-gates.test` | 1 | `src/tests` (1) |
| `c32-agents-split-accounting.test` | 1 | `src/tests` (1) |
| `c33-cut-table-shape.test` | 1 | `src/tests` (1) |
| `c34-dependabot-config.test` | 1 | `src/tests` (1) |
| `c35-entry-exports.test` | 1 | `src/tests` (1) |
| `c36-epic-guard-workflow.test` | 1 | `src/tests` (1) |
| `c37-eslint-stand-in` | 1 | `src/tests` (1) |
| `c38-learning-boundary.test` | 1 | `src/tests` (1) |
| `c39-package-lint-spawned.test` | 1 | `src/tests` (1) |
| `c40-references-gate-spawned.test` | 1 | `src/tests` (1) |
| `c41-release-bot-fragment-workflow.test` | 1 | `src/tests` (1) |
| `c42-release-publish-workflow.test` | 1 | `src/tests` (1) |
| `c43-skill-gap-section.test` | 1 | `src/tests` (1) |
| `c44-verify-workflow.test` | 1 | `src/tests` (1) |
| `c45-cli.test` | 1 | `src/tools/ts-symbols` (1) |
| `c46-cli` | 1 | `src/tools/ts-symbols` (1) |

## The 30 files of highest betweenness

| Rank | File | Betweenness | Cluster |
| --- | --- | --- | --- |
| 1 | `packages/rafa/src/ports/index.ts` | 62724.840998 | `c10-index` |
| 2 | `packages/rafa/src/effort/store/merge-store.ts` | 50857.443652 | `c02-sqlite` |
| 3 | `src/tests/cli-capture.ts` | 31219.985894 | `c03-cli-capture` |
| 4 | `packages/rafa/src/core/command/index.ts` | 24446.151731 | `c05-index` |
| 5 | `packages/rafa/src/core/config/index.ts` | 22533.822554 | `c07-index` |
| 6 | `src/adapters/tracker/github.ts` | 18355.460364 | `c01-github` |
| 7 | `src/commands/index.ts` | 17960.411276 | `c05-index` |
| 8 | `packages/rafa/src/core/loop/index.ts` | 16865.023024 | `c03-cli-capture` |
| 9 | `src/board/relations/labels.ts` | 15230.335839 | `c01-github` |
| 10 | `src/pr/index.ts` | 14710.374662 | `c04-index` |
| 11 | `src/board/setup.ts` | 14277.615418 | `c01-github` |
| 12 | `src/board/roadmap.ts` | 13080.942873 | `c01-github` |
| 13 | `src/next/sources.ts` | 12767.817339 | `c05-index` |
| 14 | `src/project/scaffold.ts` | 12699.12522 | `c03-cli-capture` |
| 15 | `packages/rafa/src/core/config/scope.ts` | 12376.060927 | `c07-index` |
| 16 | `packages/rafa/src/core/config/config-load.ts` | 11708.442294 | `c07-index` |
| 17 | `src/board/gate.ts` | 10698.280659 | `c09-sections` |
| 18 | `src/config-registry.ts` | 10471.133113 | `c07-index` |
| 19 | `packages/rafa/src/core/output/active.ts` | 10436.240273 | `c07-index` |
| 20 | `src/start/dispatch.ts` | 10055.475113 | `c08-index` |
| 21 | `src/board/project/refresh.ts` | 9700.435512 | `c11-refresh` |
| 22 | `packages/rafa/src/effort/store/development-build.ts` | 9680.358819 | `c02-sqlite` |
| 23 | `packages/rafa/src/effort/store/sqlite.ts` | 9212.417321 | `c02-sqlite` |
| 24 | `packages/rafa/src/core/config/sections.ts` | 9102.118378 | `c09-sections` |
| 25 | `src/refs/extract.ts` | 8474.407085 | `c01-github` |
| 26 | `src/triage/triage.ts` | 8279.588017 | `c02-sqlite` |
| 27 | `src/cli/dispatch.ts` | 8266.950003 | `c05-index` |
| 28 | `src/board/issue.ts` | 7993.1855 | `c01-github` |
| 29 | `src/start/loop-events.ts` | 7969.28228 | `c08-index` |
| 30 | `src/start/suite-step.ts` | 7863.319949 | `c08-index` |
