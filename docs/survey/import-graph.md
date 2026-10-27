# Import graph

Coverage: 2197 of 2197 tracked files read (src/ and packages/*/src/).

2197 files, 11102 edges (7680 value, 3422 type), 47 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 318 | `packages/rafa-board/src/board` (109), `src/commands` (25), `src/tests` (23), `packages/rafa-board/src/board/relations` (19), `packages/rafa-board/src/commands/issue` (12), `src/next` (12), `packages/rafa-board/src/commands/epic` (11), `packages/rafa-board/src/refs` (11), `src/status` (11), `src/commands/plan` (10), `src/tests/board-coupled/commands/epic` (10), `src/tests/board-coupled/commands/issue` (8), `packages/rafa-board/src/next` (6), `packages/rafa-pr/src/commands/pr` (6), `src/board` (6), `packages/rafa-board/src/board/project` (4), `src/tests/board-coupled/board` (3), `packages/rafa-board/src/adapters/tracker` (2), `packages/rafa-board/src/claims` (2), `packages/rafa-board/src/tests` (2), `packages/rafa-pr/src/pr` (2), `packages/rafa-pr/src/triage` (2), `packages/rafa/src/next` (2), `packages/rafa/src/project` (2), `src/claims` (2), `src/suite` (2), `src/tests/board-coupled/commands` (2), `src/tests/board-coupled/refs` (2), `packages/rafa-board/src/commands` (1), `packages/rafa-board/src/commands/board` (1), `packages/rafa-board/src/commands/plan` (1), `packages/rafa/src/board` (1), `packages/rafa/src/cli` (1), `src/commands/epic` (1), `src/pr` (1), `src/tests/board-coupled/commands/board` (1), `src/tests/board-coupled/commands/plan` (1), `src/tests/pr-coupled/commands/pr` (1) |
| `c02-sqlite` | 207 | `packages/rafa/src/effort/store` (89), `packages/rafa-effort/src/effort` (45), `src/commands/effort` (15), `src/tests/core-coupled/effort/store` (13), `src/tests` (12), `src/tests/effort-coupled/effort` (5), `packages/rafa/src/effort/store/testdata` (4), `packages/rafa/src/core/runtime` (3), `packages/rafa/src/report` (3), `src/commands` (3), `packages/rafa/src/effort` (2), `src/tests/effort-coupled/effort/sync` (2), `packages/rafa-effort/src/effort/sync` (1), `packages/rafa-pr/src/docs` (1), `packages/rafa-pr/src/triage` (1), `packages/rafa/src/utils` (1), `src/claims` (1), `src/commands/claim` (1), `src/commands/skill` (1), `src/start` (1), `src/tests/core-coupled/core/runtime` (1), `src/tests/core-coupled/utils` (1), `src/tests/inventory-coupled/inventory/search` (1) |
| `c03-index` | 206 | `src/start` (126), `src/tests` (17), `packages/rafa-pr/src/triage` (14), `src/suite` (9), `packages/rafa/src/suite` (6), `packages/rafa/src/triage` (6), `packages/rafa/src/core/plan` (5), `packages/rafa/src/utils` (3), `packages/rafa/src` (2), `packages/rafa/src/adapters/output` (2), `packages/rafa/src/tests` (2), `src` (2), `src/loop` (2), `packages/rafa-pr/src/docs` (1), `packages/rafa/src/core/loop` (1), `packages/rafa/src/core/output` (1), `packages/rafa/src/ports` (1), `src/cleanup` (1), `src/commands/stretch` (1), `src/tests/core-coupled/utils` (1), `src/tests/pr-coupled/triage` (1), `src/triage` (1), `src/utils` (1) |
| `c04-index` | 201 | `packages/rafa-pr/src/commands/pr` (37), `packages/rafa-pr/src/pr` (28), `src/tests/pr-coupled/commands/pr` (26), `packages/rafa-pr/src/pr/triage` (16), `src/cleanup` (13), `src/tests` (11), `src/cli/prompt` (10), `src/next` (9), `packages/rafa-pr/src/cleanup` (6), `packages/rafa/src/pr` (6), `src/commands` (6), `packages/rafa-pr/src/pr/plans` (4), `src/status` (4), `packages/rafa-pr/src/start` (2), `packages/rafa-release/src/cleanup` (2), `packages/rafa-release/src/release` (2), `packages/rafa/src/effort/store` (2), `packages/rafa/src/utils` (2), `src/commands/pr` (2), `src/inventory` (2), `src/start` (2), `src/tests/board-coupled/board` (2), `src/tests/pr-coupled/pr` (2), `packages/rafa-board/src/board` (1), `packages/rafa/src/schema` (1), `packages/rafa/src/start` (1), `src/pr/plans` (1), `src/tests/core-coupled/start` (1) |
| `c05-sections` | 181 | `src/commands` (18), `packages/rafa-inventory/src/inventory` (14), `src/tests` (13), `packages/rafa-inventory/src/inventory/search` (11), `packages/rafa-inventory/src/backfill` (10), `packages/rafa-inventory/src/demote` (10), `packages/rafa-inventory/src/learning` (10), `packages/rafa-inventory/src/schema` (10), `packages/rafa-inventory/src/tiers` (10), `src/commands/skill` (10), `packages/rafa-inventory/src/check` (8), `packages/rafa-inventory/src/task` (8), `src/commands/agent` (6), `packages/rafa/src/schema` (4), `src/start` (4), `packages/rafa-inventory/src/adapters/learning` (3), `packages/rafa-inventory/src/agents` (2), `packages/rafa-inventory/src/report` (2), `packages/rafa-inventory/src/start` (2), `packages/rafa/src/utils` (2), `src/commands/instinct` (2), `src/commands/plan` (2), `src/plan` (2), `src/schema` (2), `src/tests/inventory-coupled/agents` (2), `src/tests/inventory-coupled/tiers` (2), `packages/rafa-board/src/board` (1), `packages/rafa-effort/src/effort` (1), `packages/rafa/src/board` (1), `packages/rafa/src/core/config` (1), `packages/rafa/src/plan` (1), `packages/rafa/src/project` (1), `src` (1), `src/notices` (1), `src/project` (1), `src/tests/core-coupled/report` (1), `src/tests/inventory-coupled/adapters/learning` (1), `src/tiers` (1) |
| `c06-index` | 153 | `src/next` (17), `src/commands/loop` (15), `src/cli` (12), `src/commands` (12), `src/commands/plan` (11), `src/commands/update` (10), `packages/rafa-board/src/commands/issue` (9), `src/tests` (8), `src/commands/instinct` (6), `src/loop` (6), `packages/rafa-board/src/commands/epic` (5), `src/plan` (5), `src/cli/core` (4), `src/commands/effort` (4), `packages/rafa/src/plan` (3), `packages/rafa-board/src/board` (2), `packages/rafa-board/src/commands/board` (2), `packages/rafa/src/cli` (2), `src/adapters/output` (2), `src/commands/module` (2), `src/start` (2), `packages/rafa-inventory/src/schema` (1), `packages/rafa/src/commands/plan` (1), `packages/rafa/src/core/command` (1), `packages/rafa/src/core/loop` (1), `packages/rafa/src/core/plan` (1), `packages/rafa/src/modules/testdata/seam-fixture` (1), `src/commands/agent` (1), `src/commands/board` (1), `src/commands/config` (1), `src/commands/issue` (1), `src/tests/board-coupled/commands/issue` (1), `src/tests/core-coupled/commands/plan` (1), `src/tests/core-coupled/plan` (1), `src/tests/effort-coupled/effort` (1) |
| `c07-index` | 144 | `packages/rafa-release/src/release` (55), `packages/rafa-release/src/commands/release` (19), `src/tests/release-coupled/commands/release` (10), `src/start` (8), `packages/rafa/src/core/git` (6), `packages/rafa-pr/src/commands/pr` (5), `packages/rafa-pr/src/pr/triage` (4), `packages/rafa/src/plan/risk` (4), `src/tests` (4), `packages/rafa-inventory/src/plan/risk` (3), `packages/rafa-pr/src/plan` (2), `packages/rafa-pr/src/plan/risk` (2), `packages/rafa-pr/src/pr` (2), `packages/rafa-release/src/project` (2), `packages/rafa-release/src/release/strategies` (2), `packages/rafa/src/release` (2), `src/commands` (2), `src/commands/release` (2), `src/project` (2), `src/tests/core-coupled/project` (2), `packages/rafa-release/src/next` (1), `packages/rafa/src/project` (1), `src/release` (1), `src/tests/inventory-coupled/plan/risk` (1), `src/tests/release-coupled/next` (1), `src/tests/release-coupled/release` (1) |
| `c08-cli-capture` | 143 | `src/tests` (75), `src/start` (16), `packages/rafa-release/src/release` (7), `packages/rafa/src/tests` (5), `src/commands/instinct` (3), `src/project` (3), `src/tests/release-coupled/commands/release` (3), `packages/rafa-release/src/commands` (2), `packages/rafa/src/effort` (2), `src/commands` (2), `src/commands/bug` (2), `src/commands/config` (2), `src/commands/pr` (2), `src/notices` (2), `src/utils` (2), `packages/rafa-pr/src/pr` (1), `packages/rafa-release/src/commands/release` (1), `packages/rafa/src/pr` (1), `src` (1), `src/cli` (1), `src/commands/release` (1), `src/next` (1), `src/status` (1), `src/tests/core-coupled/next` (1), `src/tests/core-coupled/project` (1), `src/tests/core-coupled/schema` (1), `src/tests/core-coupled/utils` (1), `src/tests/effort-coupled/effort` (1), `src/tests/release-coupled/commands` (1), `src/tests/release-coupled/release` (1) |
| `c09-index` | 126 | `src/commands` (17), `src/tests/core-coupled` (13), `packages/rafa/src` (11), `src` (10), `src/preflight` (10), `src/config` (8), `src/tests` (7), `src/project` (5), `packages/rafa/src/modules` (4), `packages/rafa/src/project` (4), `src/start` (4), `packages/rafa-effort/src/effort/sync` (3), `packages/rafa/src/core/config` (3), `src/commands/config` (3), `src/tests/effort-coupled/effort/sync` (3), `packages/rafa-release/src/release` (2), `packages/rafa/src/runtime` (2), `src/commands/module` (2), `src/runtime` (2), `src/tests/release-coupled/release` (2), `packages/rafa/src/core/adapters` (1), `src/cli` (1), `src/modules` (1), `src/status` (1), `src/suite` (1), `src/tests/board-coupled/board` (1), `src/tests/board-coupled/commands/issue` (1), `src/tests/core-coupled/core/config` (1), `src/tests/core-coupled/effort/store` (1), `src/tests/core-coupled/modules` (1), `src/tests/core-coupled/project` (1) |
| `c10-index` | 105 | `packages/rafa-board/src/adapters/tracker` (15), `packages/rafa/src/adapters/logger` (9), `src/tests` (8), `packages/rafa-board/src/board` (5), `packages/rafa/src/core/services` (5), `packages/rafa/src/ports` (5), `packages/rafa-board/src/commands/epic` (4), `packages/rafa-board/src/epic` (4), `src/start` (4), `packages/rafa-release/src/docs` (3), `packages/rafa/src/core/adapters` (3), `packages/rafa/src/core/output` (3), `src/tests/board-coupled/commands/issue` (3), `src/tests/core-coupled/adapters/logger` (3), `packages/rafa-board/src/commands/issue` (2), `packages/rafa-pr/src/triage` (2), `packages/rafa/src/triage` (2), `src/cli` (2), `src/commands/docs` (2), `src/commands/plan` (2), `src/tests/board-coupled/adapters/tracker` (2), `src/tests/board-coupled/commands/epic` (2), `src/tests/core-coupled/core/output` (2), `packages/rafa-board/src/board/project` (1), `packages/rafa-effort/src/effort` (1), `packages/rafa-release/src/commands/release` (1), `packages/rafa/src/core/git` (1), `packages/rafa/src/modules/testdata/hub-down-sync` (1), `packages/rafa/src/modules/testdata/sync-fixture` (1), `src` (1), `src/modules/testdata/pull-merge-sync` (1), `src/ports` (1), `src/tests/core-coupled/ports` (1), `src/tests/release-coupled/commands/release` (1), `src/tests/release-coupled/docs` (1), `src/triage` (1) |
| `c11-config-sections` | 84 | `packages/rafa/src/core/config` (26), `packages/rafa/src/core/loop` (20), `packages/rafa/src/core/command` (18), `packages/rafa/src/core/plan` (10), `src/tests/core-coupled/core/config` (5), `packages/rafa/src/effort/store` (2), `packages/rafa/src/core/output` (1), `src/tests/core-coupled/core/command` (1), `src/tests/core-coupled/core/loop` (1) |
| `c12-record` | 67 | `packages/rafa/src/bugs` (13), `packages/rafa-pr/src/triage` (10), `src/commands/bug` (7), `packages/rafa/src/errors` (6), `src/errors` (6), `packages/rafa/src/triage` (4), `src/bugs` (4), `src/tests/core-coupled/bugs` (3), `packages/rafa-board/src/bugs` (2), `packages/rafa-pr/src/bugs` (2), `src/cli` (2), `packages/rafa-board/src/commands/issue` (1), `packages/rafa/src` (1), `packages/rafa/src/errors/fixtures` (1), `packages/rafa/src/project` (1), `src/tests` (1), `src/tests/core-coupled` (1), `src/tests/core-coupled/errors` (1), `src/tests/core-coupled/project` (1) |
| `c13-git` | 61 | `packages/rafa-board/src/board` (14), `src/commands/claim` (12), `src/claims` (8), `packages/rafa/src/claims` (6), `src/tests` (5), `src/commands/plan` (4), `src/start` (4), `packages/rafa/src/start` (2), `src/adapters/planner` (2), `src/status` (2), `src/tests/board-coupled/board` (2) |
| `c14-refresh` | 61 | `packages/rafa-board/src/board/project` (37), `src/commands` (7), `src/start` (3), `src/tests` (3), `src/tests/board-coupled/commands/issue` (3), `packages/rafa-board/src/commands/issue` (2), `packages/rafa-board/src/commands/board` (1), `packages/rafa-release/src/commands/release` (1), `src/tests/board-coupled/board/project` (1), `src/tests/board-coupled/commands/board` (1), `src/tests/board-coupled/commands/epic` (1), `src/tests/release-coupled/commands/release` (1) |
| `c15-index` | 44 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa/src/effort/store` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1) |
| `c16-start` | 33 | `src/stretch` (13), `src/ci` (7), `src/commands/stretch` (7), `src` (2), `src/commands` (2), `src/commands/ci` (2) |
| `c17-sweep-timeout` | 32 | `src/tests` (24), `src/fixtures` (5), `src/commands` (1), `src/start` (1), `src/tests/core-coupled/effort/store` (1) |
| `c18-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c19-index.test` | 1 | `packages/rafa-board/src/commands/board` (1) |
| `c20-declarations.test` | 1 | `packages/rafa-board/src/commands/epic` (1) |
| `c21-declarations.test` | 1 | `packages/rafa-board/src/commands/issue` (1) |
| `c22-declarations.test` | 1 | `packages/rafa-pr/src/commands/pr` (1) |
| `c23-index.test` | 1 | `packages/rafa-pr/src/commands/pr` (1) |
| `c24-declarations.test` | 1 | `packages/rafa-release/src/commands/release` (1) |
| `c25-index.test` | 1 | `packages/rafa-release/src/commands/release` (1) |
| `c26-config-schema-readings` | 1 | `packages/rafa/src` (1) |
| `c27-registry-types.test` | 1 | `packages/rafa/src/core/command` (1) |
| `c28-types.test` | 1 | `packages/rafa/src/core/command` (1) |
| `c29-types.test` | 1 | `packages/rafa/src/pr` (1) |
| `c30-declarations.test` | 1 | `src/commands/claim` (1) |
| `c31-index.test` | 1 | `src/commands/claim` (1) |
| `c32-agent-gates.test` | 1 | `src/tests` (1) |
| `c33-agents-split-accounting.test` | 1 | `src/tests` (1) |
| `c34-cut-table-shape.test` | 1 | `src/tests` (1) |
| `c35-dependabot-config.test` | 1 | `src/tests` (1) |
| `c36-entry-exports.test` | 1 | `src/tests` (1) |
| `c37-epic-guard-workflow.test` | 1 | `src/tests` (1) |
| `c38-eslint-stand-in` | 1 | `src/tests` (1) |
| `c39-learning-boundary.test` | 1 | `src/tests` (1) |
| `c40-package-lint-spawned.test` | 1 | `src/tests` (1) |
| `c41-references-gate-spawned.test` | 1 | `src/tests` (1) |
| `c42-release-bot-fragment-workflow.test` | 1 | `src/tests` (1) |
| `c43-release-publish-workflow.test` | 1 | `src/tests` (1) |
| `c44-skill-gap-section.test` | 1 | `src/tests` (1) |
| `c45-verify-workflow.test` | 1 | `src/tests` (1) |
| `c46-cli.test` | 1 | `src/tools/ts-symbols` (1) |
| `c47-cli` | 1 | `src/tools/ts-symbols` (1) |

## The 30 files of highest betweenness

| Rank | File | Betweenness | Cluster |
| --- | --- | --- | --- |
| 1 | `packages/rafa/src/ports/index.ts` | 63344.517873 | `c10-index` |
| 2 | `packages/rafa/src/effort/store/merge-store.ts` | 51534.511653 | `c02-sqlite` |
| 3 | `src/tests/cli-capture.ts` | 31524.903572 | `c08-cli-capture` |
| 4 | `packages/rafa/src/core/command/index.ts` | 26028.011691 | `c06-index` |
| 5 | `packages/rafa/src/core/config/index.ts` | 22528.228327 | `c09-index` |
| 6 | `src/commands/index.ts` | 18049.268227 | `c06-index` |
| 7 | `packages/rafa/src/core/loop/index.ts` | 17767.271249 | `c03-index` |
| 8 | `packages/rafa-board/src/adapters/tracker/github.ts` | 16815.848178 | `c01-github` |
| 9 | `packages/rafa/src/core/config/scope.ts` | 12977.198181 | `c11-config-sections` |
| 10 | `src/project/scaffold.ts` | 12693.096878 | `c08-cli-capture` |
| 11 | `packages/rafa-board/src/board/relations/labels.ts` | 12585.86356 | `c01-github` |
| 12 | `packages/rafa/src/core/config/config-load.ts` | 12145.523709 | `c11-config-sections` |
| 13 | `packages/rafa/src/core/output/active.ts` | 11537.672646 | `c11-config-sections` |
| 14 | `packages/rafa-board/src/board/setup.ts` | 11201.437418 | `c01-github` |
| 15 | `packages/rafa-board/src/board/project/refresh.ts` | 10457.143531 | `c14-refresh` |
| 16 | `src/config-registry.ts` | 10421.561638 | `c09-index` |
| 17 | `packages/rafa/src/effort/store/development-build.ts` | 10117.734374 | `c02-sqlite` |
| 18 | `packages/rafa-board/src/board/roadmap.ts` | 9942.113267 | `c01-github` |
| 19 | `packages/rafa/src/effort/store/sqlite.ts` | 9682.572322 | `c02-sqlite` |
| 20 | `packages/rafa/src/core/config/sections.ts` | 9148.084555 | `c05-sections` |
| 21 | `src/cli/dispatch.ts` | 8342.543776 | `c06-index` |
| 22 | `packages/rafa-pr/src/pr/index.ts` | 8037.765339 | `c04-index` |
| 23 | `src/start/suite-step.ts` | 7945.932612 | `c03-index` |
| 24 | `src/start/dispatch.ts` | 7867.138379 | `c03-index` |
| 25 | `packages/rafa-board/src/board/issue.ts` | 7548.721894 | `c01-github` |
| 26 | `src/start/loop-events.ts` | 7544.097274 | `c03-index` |
| 27 | `packages/rafa-board/src/board/gate.ts` | 7354.382052 | `c13-git` |
| 28 | `packages/rafa/src/core/command/types.ts` | 7318.541085 | `c11-config-sections` |
| 29 | `packages/rafa/src/core/plan/index.ts` | 6994.865346 | `c06-index` |
| 30 | `packages/rafa-inventory/src/inventory/record.ts` | 6878.826732 | `c05-sections` |
