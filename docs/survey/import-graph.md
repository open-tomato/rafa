# Import graph

Coverage: 2186 of 2186 tracked files read (src/ and packages/*/src/).

2186 files, 11069 edges (8505 value, 2564 type), 44 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 324 | `src/board` (125), `src/commands/issue` (29), `src/commands/epic` (28), `src/tests` (27), `src/commands` (26), `src/board/relations` (19), `src/refs` (13), `src/commands/plan` (10), `src/next` (9), `src/commands/pr` (7), `src/board/project` (4), `src/claims` (3), `src/commands/board` (3), `src/pr` (3), `src/start` (3), `src/adapters/tracker` (2), `src/status` (2), `src/suite` (2), `src/triage` (2), `packages/rafa/src/board` (1), `packages/rafa/src/core/git` (1), `src/cli` (1), `src/epic` (1), `src/plan` (1), `src/plan/risk` (1), `src/project` (1) |
| `c02-index` | 273 | `packages/rafa-effort/src/effort` (39), `src/triage` (29), `packages/rafa/src/effort/store` (25), `src/start` (17), `src/adapters/tracker` (16), `packages/rafa/src/bugs` (13), `packages/rafa/src/triage` (12), `src/tests` (12), `src/commands/issue` (9), `packages/rafa/src/adapters/logger` (8), `src/bugs` (8), `src/commands/bug` (7), `packages/rafa/src/errors` (6), `src/docs` (6), `src/errors` (6), `packages/rafa/src/core/services` (5), `src/commands/epic` (5), `src/tests/effort-coupled/effort` (5), `packages/rafa/src/ports` (4), `packages/rafa/src/report` (3), `src/epic` (3), `src/tests/core-coupled/adapters/logger` (3), `src/tests/core-coupled/bugs` (3), `packages/rafa/src/effort` (2), `src/commands/docs` (2), `src/commands/effort` (2), `src/commands/plan` (2), `src/commands/release` (2), `src/tests/core-coupled/effort/store` (2), `packages/rafa/src` (1), `packages/rafa/src/errors/fixtures` (1), `packages/rafa/src/modules/testdata/hub-down-sync` (1), `packages/rafa/src/modules/testdata/sync-fixture` (1), `packages/rafa/src/project` (1), `packages/rafa/src/utils` (1), `src/adapters/output` (1), `src/board/project` (1), `src/cli` (1), `src/modules/testdata/pull-merge-sync` (1), `src/ports` (1), `src/project` (1), `src/tests/core-coupled/errors` (1), `src/tests/core-coupled/ports` (1), `src/tests/core-coupled/project` (1), `src/tests/core-coupled/utils` (1), `src/tests/inventory-coupled/inventory/search` (1) |
| `c03-index` | 256 | `src/commands` (35), `src/tests/core-coupled` (14), `packages/rafa-inventory/src/inventory` (13), `packages/rafa/src` (12), `src` (12), `packages/rafa-inventory/src/tiers` (10), `src/tests` (10), `packages/rafa-inventory/src/task` (8), `src/commands/plan` (8), `src/config` (8), `src/plan` (7), `src/preflight` (7), `src/start` (7), `packages/rafa/src/project` (6), `src/commands/agent` (6), `src/release` (6), `packages/rafa/src/schema` (5), `src/commands/skill` (5), `src/project` (5), `packages/rafa-inventory/src/check` (4), `packages/rafa/src/core/config` (4), `packages/rafa/src/modules` (4), `packages/rafa/src/plan/risk` (4), `packages/rafa-effort/src/effort/sync` (3), `packages/rafa-inventory/src/plan/risk` (3), `src/commands/config` (3), `src/pr` (3), `src/tests/core-coupled/project` (3), `src/tests/effort-coupled/effort/sync` (3), `packages/rafa-inventory/src/agents` (2), `packages/rafa-inventory/src/inventory/search` (2), `packages/rafa-inventory/src/schema` (2), `packages/rafa-inventory/src/start` (2), `packages/rafa/src/plan` (2), `packages/rafa/src/utils` (2), `src/board` (2), `src/schema` (2), `src/tests/inventory-coupled/agents` (2), `src/tests/inventory-coupled/tiers` (2), `packages/rafa-effort/src/effort` (1), `packages/rafa/src/adapters/logger` (1), `packages/rafa/src/board` (1), `packages/rafa/src/core/adapters` (1), `packages/rafa/src/effort/store` (1), `packages/rafa/src/ports` (1), `src/adapters/tracker` (1), `src/cli` (1), `src/commands/issue` (1), `src/modules` (1), `src/plan/risk` (1), `src/suite` (1), `src/tests/core-coupled/core/config` (1), `src/tests/core-coupled/effort/store` (1), `src/tests/core-coupled/modules` (1), `src/tests/core-coupled/schema` (1), `src/tests/inventory-coupled/plan/risk` (1), `src/tiers` (1) |
| `c04-cli-capture` | 245 | `src/tests` (85), `src/release` (64), `src/commands/release` (35), `src/start` (23), `src/commands/pr` (9), `src/commands` (7), `src/project` (5), `packages/rafa/src/release` (2), `src` (2), `src/commands/bug` (2), `src/pr` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src/cli` (1), `src/commands/config` (1), `src/next` (1), `src/notices` (1), `src/tests/effort-coupled/effort` (1) |
| `c05-index` | 213 | `src/next` (34), `src/cli` (17), `src/commands/loop` (15), `src/status` (14), `src/commands` (13), `src/stretch` (13), `src/tests` (12), `src/commands/update` (10), `src/commands/stretch` (8), `src/loop` (8), `src/ci` (7), `src/commands/plan` (5), `src/start` (5), `src/cli/core` (4), `src/commands/module` (4), `packages/rafa/src/core/loop` (2), `packages/rafa/src/next` (2), `packages/rafa/src/plan` (2), `packages/rafa/src/project` (2), `packages/rafa/src/runtime` (2), `src` (2), `src/board` (2), `src/commands/board` (2), `src/commands/ci` (2), `src/commands/config` (2), `src/commands/effort` (2), `src/runtime` (2), `src/utils` (2), `packages/rafa-effort/src/effort` (1), `packages/rafa/src/commands/plan` (1), `packages/rafa/src/core/command` (1), `packages/rafa/src/core/plan` (1), `packages/rafa/src/modules/testdata/seam-fixture` (1), `src/adapters/output` (1), `src/commands/agent` (1), `src/commands/instinct` (1), `src/notices` (1), `src/plan` (1), `src/pr` (1), `src/project` (1), `src/release` (1), `src/tests/core-coupled/commands/plan` (1), `src/tests/core-coupled/next` (1), `src/tests/core-coupled/plan` (1), `src/tests/core-coupled/project` (1), `src/tests/effort-coupled/effort` (1) |
| `c06-index` | 200 | `src/commands/pr` (61), `src/pr` (32), `src/cleanup` (22), `src/start` (20), `src/pr/triage` (18), `src/cli/prompt` (10), `src/tests` (10), `src/commands` (8), `src/pr/plans` (5), `packages/rafa/src/utils` (3), `src/next` (3), `src/inventory` (2), `packages/rafa/src/start` (1), `src/board` (1), `src/commands/release` (1), `src/status` (1), `src/tests/core-coupled/start` (1), `src/tests/core-coupled/utils` (1) |
| `c07-index` | 142 | `src/start` (93), `src/tests` (16), `src/suite` (15), `packages/rafa/src/core/plan` (5), `packages/rafa/src/adapters/output` (2), `packages/rafa/src/utils` (2), `packages/rafa/src` (1), `packages/rafa/src/core/output` (1), `packages/rafa/src/ports` (1), `src` (1), `src/notices` (1), `src/preflight` (1), `src/tests/core-coupled/utils` (1), `src/triage` (1), `src/utils` (1) |
| `c08-sqlite` | 134 | `packages/rafa/src/effort/store` (65), `src/commands/effort` (15), `src/tests/core-coupled/effort/store` (11), `src/tests` (10), `packages/rafa-inventory/src/inventory/search` (9), `packages/rafa-effort/src/effort` (6), `packages/rafa/src/effort/store/testdata` (4), `packages/rafa/src/core/runtime` (3), `packages/rafa/src/effort` (2), `src/commands` (2), `src/tests/effort-coupled/effort/sync` (2), `packages/rafa-effort/src/effort/sync` (1), `src/claims` (1), `src/commands/claim` (1), `src/commands/skill` (1), `src/tests/core-coupled/core/runtime` (1) |
| `c09-config-sections` | 96 | `packages/rafa/src/core/config` (26), `packages/rafa/src/core/loop` (20), `packages/rafa/src/core/command` (16), `packages/rafa/src/core/plan` (10), `packages/rafa/src/core/git` (6), `src/tests/core-coupled/core/config` (5), `packages/rafa/src/core/output` (4), `packages/rafa/src/core/adapters` (3), `packages/rafa/src/effort/store` (2), `src/tests/core-coupled/core/output` (2), `src/tests/core-coupled/core/command` (1), `src/tests/core-coupled/core/loop` (1) |
| `c10-instinct` | 75 | `packages/rafa-inventory/src/backfill` (10), `packages/rafa-inventory/src/demote` (10), `packages/rafa-inventory/src/learning` (10), `src/commands/instinct` (10), `packages/rafa-inventory/src/schema` (9), `src/tests` (7), `src/commands/skill` (5), `packages/rafa-inventory/src/check` (4), `packages/rafa-inventory/src/adapters/learning` (3), `packages/rafa-inventory/src/report` (2), `src/commands` (2), `packages/rafa-inventory/src/inventory` (1), `src/tests/core-coupled/report` (1), `src/tests/inventory-coupled/adapters/learning` (1) |
| `c11-git` | 63 | `src/board` (16), `src/commands/claim` (12), `src/claims` (9), `packages/rafa/src/claims` (6), `src/commands/plan` (6), `src/start` (4), `src/tests` (4), `packages/rafa/src/start` (2), `src/adapters/planner` (2), `src/status` (2) |
| `c12-refresh` | 59 | `src/board/project` (38), `src/commands` (7), `src/commands/issue` (4), `src/tests` (3), `src/commands/board` (2), `src/commands/release` (2), `src/start` (2), `src/commands/epic` (1) |
| `c13-index` | 44 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa/src/effort/store` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1) |
| `c14-sweep-timeout` | 31 | `src/tests` (23), `src/fixtures` (5), `src/commands` (1), `src/start` (1), `src/tests/core-coupled/effort/store` (1) |
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
| 1 | `packages/rafa/src/ports/index.ts` | 62966.01142 | `c02-index` |
| 2 | `packages/rafa/src/effort/store/merge-store.ts` | 51132.532149 | `c08-sqlite` |
| 3 | `src/tests/cli-capture.ts` | 31419.41622 | `c04-cli-capture` |
| 4 | `packages/rafa/src/core/command/index.ts` | 24164.293235 | `c05-index` |
| 5 | `packages/rafa/src/core/config/index.ts` | 22605.92558 | `c03-index` |
| 6 | `src/commands/index.ts` | 17992.266431 | `c05-index` |
| 7 | `src/adapters/tracker/github.ts` | 17754.343467 | `c01-github` |
| 8 | `packages/rafa/src/core/loop/index.ts` | 17220.532494 | `c05-index` |
| 9 | `src/project/scaffold.ts` | 12805.467679 | `c04-cli-capture` |
| 10 | `packages/rafa/src/core/config/scope.ts` | 12789.434797 | `c09-config-sections` |
| 11 | `src/board/relations/labels.ts` | 12633.755191 | `c01-github` |
| 12 | `packages/rafa/src/core/config/config-load.ts` | 12001.008564 | `c09-config-sections` |
| 13 | `src/board/setup.ts` | 11175.573861 | `c01-github` |
| 14 | `packages/rafa/src/core/output/active.ts` | 10947.637921 | `c09-config-sections` |
| 15 | `src/pr/index.ts` | 10642.992299 | `c06-index` |
| 16 | `src/config-registry.ts` | 10505.839019 | `c03-index` |
| 17 | `src/board/roadmap.ts` | 9838.793546 | `c01-github` |
| 18 | `packages/rafa/src/effort/store/development-build.ts` | 9838.3277 | `c08-sqlite` |
| 19 | `src/board/project/refresh.ts` | 9823.293871 | `c12-refresh` |
| 20 | `packages/rafa/src/effort/store/sqlite.ts` | 9354.246812 | `c08-sqlite` |
| 21 | `packages/rafa/src/core/config/sections.ts` | 9126.13938 | `c03-index` |
| 22 | `src/start/loop-events.ts` | 8644.175845 | `c07-index` |
| 23 | `src/start/suite-step.ts` | 8595.515945 | `c07-index` |
| 24 | `src/cli/dispatch.ts` | 8303.102964 | `c05-index` |
| 25 | `src/start/dispatch.ts` | 7794.284483 | `c07-index` |
| 26 | `src/start/suite-blocker.ts` | 7696.911905 | `c07-index` |
| 27 | `src/board/issue.ts` | 7525.691465 | `c01-github` |
| 28 | `src/board/gate.ts` | 7315.587871 | `c11-git` |
| 29 | `packages/rafa/src/core/command/types.ts` | 7183.000982 | `c09-config-sections` |
| 30 | `packages/rafa/src/core/plan/index.ts` | 6992.366048 | `c05-index` |
