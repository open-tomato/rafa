# Import graph

Coverage: 2197 of 2197 tracked files read (src/ and packages/*/src/).

2197 files, 11099 edges (7680 value, 3419 type), 46 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 321 | `packages/rafa-board/src/board` (109), `src/commands` (28), `src/tests` (23), `packages/rafa-board/src/board/relations` (19), `packages/rafa-board/src/commands/issue` (12), `src/next` (12), `packages/rafa-board/src/commands/epic` (11), `packages/rafa-board/src/refs` (11), `src/status` (11), `src/commands/plan` (10), `src/tests/board-coupled/commands/epic` (10), `src/tests/board-coupled/commands/issue` (8), `packages/rafa-board/src/next` (6), `packages/rafa-pr/src/commands/pr` (6), `src/board` (6), `packages/rafa-board/src/board/project` (4), `src/tests/board-coupled/board` (3), `packages/rafa-board/src/adapters/tracker` (2), `packages/rafa-board/src/claims` (2), `packages/rafa-board/src/tests` (2), `packages/rafa-pr/src/pr` (2), `packages/rafa-pr/src/triage` (2), `packages/rafa/src/next` (2), `packages/rafa/src/project` (2), `src/claims` (2), `src/suite` (2), `src/tests/board-coupled/commands` (2), `src/tests/board-coupled/refs` (2), `packages/rafa-board/src/commands` (1), `packages/rafa-board/src/commands/board` (1), `packages/rafa-board/src/commands/plan` (1), `packages/rafa/src/board` (1), `packages/rafa/src/cli` (1), `src/commands/epic` (1), `src/pr` (1), `src/tests/board-coupled/commands/board` (1), `src/tests/board-coupled/commands/plan` (1), `src/tests/pr-coupled/commands/pr` (1) |
| `c02-index` | 216 | `src/start` (127), `src/tests` (21), `packages/rafa-pr/src/triage` (14), `src/suite` (9), `packages/rafa/src/core/plan` (6), `packages/rafa/src/suite` (6), `packages/rafa/src/triage` (6), `packages/rafa/src/utils` (3), `packages/rafa/src` (2), `packages/rafa/src/plan` (2), `packages/rafa/src/tests` (2), `src` (2), `src/loop` (2), `src/preflight` (2), `packages/rafa-inventory/src/start` (1), `packages/rafa-pr/src/docs` (1), `packages/rafa/src/core/loop` (1), `packages/rafa/src/core/output` (1), `packages/rafa/src/ports` (1), `packages/rafa/src/preflight` (1), `src/cleanup` (1), `src/commands/stretch` (1), `src/tests/core-coupled/utils` (1), `src/tests/pr-coupled/triage` (1), `src/triage` (1), `src/utils` (1) |
| `c03-sqlite` | 208 | `packages/rafa/src/effort/store` (89), `packages/rafa-effort/src/effort` (45), `src/commands/effort` (15), `src/tests/core-coupled/effort/store` (13), `src/tests` (12), `src/tests/effort-coupled/effort` (6), `packages/rafa/src/effort/store/testdata` (4), `packages/rafa/src/core/runtime` (3), `packages/rafa/src/report` (3), `src/commands` (3), `packages/rafa/src/effort` (2), `src/tests/effort-coupled/effort/sync` (2), `packages/rafa-effort/src/effort/sync` (1), `packages/rafa-pr/src/docs` (1), `packages/rafa-pr/src/triage` (1), `packages/rafa/src/utils` (1), `src/claims` (1), `src/commands/claim` (1), `src/commands/skill` (1), `src/start` (1), `src/tests/core-coupled/core/runtime` (1), `src/tests/core-coupled/utils` (1), `src/tests/inventory-coupled/inventory/search` (1) |
| `c04-index` | 188 | `packages/rafa-pr/src/commands/pr` (37), `packages/rafa-pr/src/pr` (28), `src/tests/pr-coupled/commands/pr` (26), `packages/rafa-pr/src/pr/triage` (16), `src/cleanup` (13), `src/next` (9), `src/tests` (9), `src/commands` (7), `packages/rafa-pr/src/cleanup` (6), `packages/rafa/src/pr` (6), `packages/rafa-pr/src/pr/plans` (4), `src/status` (4), `packages/rafa-pr/src/start` (2), `packages/rafa-release/src/cleanup` (2), `packages/rafa-release/src/release` (2), `packages/rafa/src/effort/store` (2), `packages/rafa/src/utils` (2), `src/commands/pr` (2), `src/start` (2), `src/tests/board-coupled/board` (2), `src/tests/pr-coupled/pr` (2), `packages/rafa-board/src/board` (1), `packages/rafa/src/schema` (1), `packages/rafa/src/start` (1), `src/pr/plans` (1), `src/tests/core-coupled/start` (1) |
| `c05-sections` | 183 | `src/commands` (20), `packages/rafa-inventory/src/inventory` (14), `packages/rafa-inventory/src/inventory/search` (11), `packages/rafa-inventory/src/backfill` (10), `packages/rafa-inventory/src/tiers` (10), `src/tests` (10), `packages/rafa-inventory/src/demote` (9), `src/commands/skill` (9), `packages/rafa-inventory/src/check` (8), `packages/rafa-inventory/src/task` (8), `packages/rafa-inventory/src/schema` (7), `src/commands/plan` (7), `src/commands/agent` (6), `src/plan` (6), `packages/rafa/src/preflight` (4), `packages/rafa/src/schema` (4), `packages/rafa/src/project` (3), `src` (3), `packages/rafa-inventory/src/agents` (2), `packages/rafa/src/core/config` (2), `packages/rafa/src/modules` (2), `packages/rafa/src/plan` (2), `packages/rafa/src/runtime` (2), `packages/rafa/src/utils` (2), `src/preflight` (2), `src/runtime` (2), `src/schema` (2), `src/start` (2), `src/tests/inventory-coupled/agents` (2), `src/tests/inventory-coupled/tiers` (2), `packages/rafa-board/src/board` (1), `packages/rafa-effort/src/effort` (1), `packages/rafa-inventory/src/start` (1), `packages/rafa/src/board` (1), `src/commands/update` (1), `src/notices` (1), `src/project` (1), `src/tests/core-coupled/plan` (1), `src/tests/core-coupled/ports` (1), `src/tiers` (1) |
| `c06-index` | 172 | `packages/rafa/src/core/config` (28), `packages/rafa/src/core/loop` (20), `packages/rafa/src/core/command` (18), `src/tests/core-coupled` (13), `packages/rafa/src` (11), `packages/rafa/src/core/plan` (10), `src/config` (8), `src/commands` (7), `src/tests/core-coupled/core/config` (6), `packages/rafa/src/core/adapters` (4), `packages/rafa/src/core/output` (4), `src` (4), `src/tests` (4), `packages/rafa-effort/src/effort/sync` (3), `src/project` (3), `src/tests/effort-coupled/effort/sync` (3), `packages/rafa-release/src/release` (2), `packages/rafa/src/effort/store` (2), `packages/rafa/src/modules` (2), `src/start` (2), `src/tests/core-coupled/core/output` (2), `src/tests/release-coupled/release` (2), `packages/rafa/src/modules/testdata/hub-down-sync` (1), `src/cli` (1), `src/cli/core` (1), `src/commands/config` (1), `src/modules` (1), `src/modules/testdata/pull-merge-sync` (1), `src/suite` (1), `src/tests/board-coupled/board` (1), `src/tests/core-coupled/core/command` (1), `src/tests/core-coupled/core/loop` (1), `src/tests/core-coupled/effort/store` (1), `src/tests/core-coupled/modules` (1), `src/tests/core-coupled/preflight` (1), `src/tests/core-coupled/project` (1) |
| `c07-index` | 156 | `src/next` (17), `src/commands/loop` (15), `src/commands` (14), `src/cli` (12), `src/cli/prompt` (10), `packages/rafa-board/src/commands/issue` (9), `src/commands/update` (8), `src/commands/instinct` (7), `src/commands/plan` (7), `src/tests` (7), `src/loop` (6), `packages/rafa-board/src/commands/epic` (5), `src/commands/effort` (4), `src/commands/module` (4), `packages/rafa-board/src/board` (2), `packages/rafa-board/src/commands/board` (2), `packages/rafa/src/adapters/output` (2), `packages/rafa/src/cli` (2), `src` (2), `src/adapters/output` (2), `src/commands/config` (2), `src/inventory` (2), `packages/rafa-inventory/src/schema` (1), `packages/rafa/src/commands/plan` (1), `packages/rafa/src/core/command` (1), `packages/rafa/src/core/loop` (1), `packages/rafa/src/modules/testdata/seam-fixture` (1), `src/cli/core` (1), `src/commands/agent` (1), `src/commands/board` (1), `src/commands/issue` (1), `src/commands/skill` (1), `src/plan` (1), `src/start` (1), `src/status` (1), `src/tests/board-coupled/commands/issue` (1), `src/tests/core-coupled/commands/plan` (1) |
| `c08-cli-capture` | 146 | `src/tests` (77), `src/start` (16), `packages/rafa-release/src/release` (7), `packages/rafa/src/tests` (5), `src/commands/instinct` (3), `src/project` (3), `src/tests/release-coupled/commands/release` (3), `packages/rafa-release/src/commands` (2), `packages/rafa/src/effort` (2), `src/commands` (2), `src/commands/bug` (2), `src/commands/config` (2), `src/commands/pr` (2), `src/notices` (2), `src/utils` (2), `packages/rafa-pr/src/pr` (1), `packages/rafa-release/src/commands/release` (1), `packages/rafa/src/pr` (1), `src` (1), `src/cli` (1), `src/commands/release` (1), `src/commands/update` (1), `src/next` (1), `src/status` (1), `src/tests/core-coupled/next` (1), `src/tests/core-coupled/project` (1), `src/tests/core-coupled/schema` (1), `src/tests/core-coupled/utils` (1), `src/tests/effort-coupled/effort` (1), `src/tests/release-coupled/commands` (1), `src/tests/release-coupled/release` (1) |
| `c09-index` | 144 | `packages/rafa-release/src/release` (55), `packages/rafa-release/src/commands/release` (19), `src/tests/release-coupled/commands/release` (10), `src/start` (8), `packages/rafa/src/core/git` (6), `packages/rafa-pr/src/commands/pr` (5), `packages/rafa-pr/src/pr/triage` (4), `packages/rafa/src/plan/risk` (4), `src/tests` (4), `packages/rafa-inventory/src/plan/risk` (3), `packages/rafa-pr/src/plan` (2), `packages/rafa-pr/src/plan/risk` (2), `packages/rafa-pr/src/pr` (2), `packages/rafa-release/src/project` (2), `packages/rafa-release/src/release/strategies` (2), `packages/rafa/src/release` (2), `src/commands` (2), `src/commands/release` (2), `src/project` (2), `src/tests/core-coupled/project` (2), `packages/rafa-release/src/next` (1), `packages/rafa/src/project` (1), `src/release` (1), `src/tests/inventory-coupled/plan/risk` (1), `src/tests/release-coupled/next` (1), `src/tests/release-coupled/release` (1) |
| `c10-index` | 128 | `packages/rafa-board/src/adapters/tracker` (15), `src/tests` (11), `packages/rafa-inventory/src/learning` (10), `packages/rafa/src/adapters/logger` (9), `src/start` (8), `packages/rafa-board/src/board` (5), `packages/rafa/src/core/services` (5), `packages/rafa/src/ports` (5), `packages/rafa-board/src/commands/epic` (4), `packages/rafa-board/src/epic` (4), `src/tests/board-coupled/commands/issue` (4), `packages/rafa-inventory/src/adapters/learning` (3), `packages/rafa-inventory/src/schema` (3), `packages/rafa-release/src/docs` (3), `src` (3), `src/tests/core-coupled/adapters/logger` (3), `packages/rafa-board/src/commands/issue` (2), `packages/rafa-inventory/src/report` (2), `packages/rafa-pr/src/triage` (2), `packages/rafa/src/core/command` (2), `packages/rafa/src/triage` (2), `src/cli` (2), `src/commands/docs` (2), `src/tests/board-coupled/adapters/tracker` (2), `src/tests/board-coupled/commands/epic` (2), `packages/rafa-board/src/board/project` (1), `packages/rafa-effort/src/effort` (1), `packages/rafa-inventory/src/demote` (1), `packages/rafa-release/src/commands/release` (1), `packages/rafa/src/core/git` (1), `packages/rafa/src/modules/testdata/sync-fixture` (1), `src/commands/config` (1), `src/commands/instinct` (1), `src/commands/plan` (1), `src/ports` (1), `src/tests/core-coupled/report` (1), `src/tests/inventory-coupled/adapters/learning` (1), `src/tests/release-coupled/commands/release` (1), `src/tests/release-coupled/docs` (1), `src/triage` (1) |
| `c11-refresh` | 67 | `packages/rafa-board/src/board/project` (37), `src/commands` (9), `src/start` (3), `src/tests` (3), `src/tests/board-coupled/commands/issue` (3), `packages/rafa-board/src/commands/issue` (2), `packages/rafa/src/project` (2), `src/project` (2), `packages/rafa-board/src/commands/board` (1), `packages/rafa-release/src/commands/release` (1), `src/tests/board-coupled/board/project` (1), `src/tests/board-coupled/commands/board` (1), `src/tests/board-coupled/commands/epic` (1), `src/tests/release-coupled/commands/release` (1) |
| `c12-record` | 67 | `packages/rafa/src/bugs` (13), `packages/rafa-pr/src/triage` (10), `src/commands/bug` (7), `packages/rafa/src/errors` (6), `src/errors` (6), `packages/rafa/src/triage` (4), `src/bugs` (4), `src/tests/core-coupled/bugs` (3), `packages/rafa-board/src/bugs` (2), `packages/rafa-pr/src/bugs` (2), `src/cli` (2), `packages/rafa-board/src/commands/issue` (1), `packages/rafa/src` (1), `packages/rafa/src/errors/fixtures` (1), `packages/rafa/src/project` (1), `src/tests` (1), `src/tests/core-coupled` (1), `src/tests/core-coupled/errors` (1), `src/tests/core-coupled/project` (1) |
| `c13-git` | 61 | `packages/rafa-board/src/board` (14), `src/commands/claim` (12), `src/claims` (8), `packages/rafa/src/claims` (6), `src/tests` (5), `src/commands/plan` (4), `src/start` (4), `packages/rafa/src/start` (2), `src/adapters/planner` (2), `src/status` (2), `src/tests/board-coupled/board` (2) |
| `c14-index` | 44 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa/src/effort/store` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1) |
| `c15-start` | 33 | `src/stretch` (13), `src/ci` (7), `src/commands/stretch` (7), `src` (2), `src/commands` (2), `src/commands/ci` (2) |
| `c16-sweep-timeout` | 32 | `src/tests` (24), `src/fixtures` (5), `src/commands` (1), `src/start` (1), `src/tests/core-coupled/effort/store` (1) |
| `c17-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c18-index.test` | 1 | `packages/rafa-board/src/commands/board` (1) |
| `c19-declarations.test` | 1 | `packages/rafa-board/src/commands/epic` (1) |
| `c20-declarations.test` | 1 | `packages/rafa-board/src/commands/issue` (1) |
| `c21-declarations.test` | 1 | `packages/rafa-pr/src/commands/pr` (1) |
| `c22-index.test` | 1 | `packages/rafa-pr/src/commands/pr` (1) |
| `c23-declarations.test` | 1 | `packages/rafa-release/src/commands/release` (1) |
| `c24-index.test` | 1 | `packages/rafa-release/src/commands/release` (1) |
| `c25-config-schema-readings` | 1 | `packages/rafa/src` (1) |
| `c26-registry-types.test` | 1 | `packages/rafa/src/core/command` (1) |
| `c27-types.test` | 1 | `packages/rafa/src/core/command` (1) |
| `c28-types.test` | 1 | `packages/rafa/src/pr` (1) |
| `c29-declarations.test` | 1 | `src/commands/claim` (1) |
| `c30-index.test` | 1 | `src/commands/claim` (1) |
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
| 1 | `packages/rafa/src/ports/index.ts` | 63390.233096 | `c10-index` |
| 2 | `packages/rafa/src/effort/store/merge-store.ts` | 51545.011653 | `c03-sqlite` |
| 3 | `src/tests/cli-capture.ts` | 31537.501804 | `c08-cli-capture` |
| 4 | `packages/rafa/src/core/command/index.ts` | 25871.935392 | `c07-index` |
| 5 | `packages/rafa/src/core/config/index.ts` | 22520.466479 | `c06-index` |
| 6 | `src/commands/index.ts` | 18019.322003 | `c07-index` |
| 7 | `packages/rafa/src/core/loop/index.ts` | 17789.010192 | `c02-index` |
| 8 | `packages/rafa-board/src/adapters/tracker/github.ts` | 16826.571694 | `c01-github` |
| 9 | `packages/rafa/src/core/config/scope.ts` | 12970.370403 | `c06-index` |
| 10 | `src/project/scaffold.ts` | 12701.736621 | `c08-cli-capture` |
| 11 | `packages/rafa-board/src/board/relations/labels.ts` | 12590.508762 | `c01-github` |
| 12 | `packages/rafa/src/core/config/config-load.ts` | 12140.285007 | `c06-index` |
| 13 | `packages/rafa/src/core/output/active.ts` | 11522.483922 | `c06-index` |
| 14 | `packages/rafa-board/src/board/setup.ts` | 11211.197266 | `c01-github` |
| 15 | `packages/rafa-board/src/board/project/refresh.ts` | 10457.143531 | `c11-refresh` |
| 16 | `src/config-registry.ts` | 10421.561638 | `c06-index` |
| 17 | `packages/rafa/src/effort/store/development-build.ts` | 10147.234374 | `c03-sqlite` |
| 18 | `packages/rafa-board/src/board/roadmap.ts` | 9943.9637 | `c01-github` |
| 19 | `packages/rafa/src/effort/store/sqlite.ts` | 9681.822322 | `c03-sqlite` |
| 20 | `packages/rafa/src/core/config/sections.ts` | 9141.712011 | `c05-sections` |
| 21 | `src/cli/dispatch.ts` | 8343.259848 | `c07-index` |
| 22 | `packages/rafa-pr/src/pr/index.ts` | 8040.849105 | `c04-index` |
| 23 | `src/start/suite-step.ts` | 7945.932612 | `c02-index` |
| 24 | `src/start/dispatch.ts` | 7881.986301 | `c02-index` |
| 25 | `packages/rafa-board/src/board/issue.ts` | 7548.721894 | `c01-github` |
| 26 | `packages/rafa/src/core/command/types.ts` | 7390.433717 | `c06-index` |
| 27 | `packages/rafa-board/src/board/gate.ts` | 7364.141901 | `c13-git` |
| 28 | `src/start/loop-events.ts` | 7332.117368 | `c02-index` |
| 29 | `packages/rafa/src/core/plan/index.ts` | 7017.377749 | `c02-index` |
| 30 | `packages/rafa-inventory/src/inventory/record.ts` | 6891.476732 | `c05-sections` |
