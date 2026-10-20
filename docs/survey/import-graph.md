# Import graph

Coverage: 2166 of 2166 tracked files read (src/ and packages/*/src/).

2166 files, 10981 edges (8598 value, 2383 type), 44 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 354 | `src/board` (114), `src/board/project` (41), `src/commands/issue` (38), `src/commands` (30), `src/commands/epic` (30), `src/tests` (25), `src/board/relations` (19), `src/next` (9), `src/commands/plan` (8), `src/commands/board` (7), `src/commands/pr` (7), `packages/rafa/src/core/git` (6), `src/adapters/tracker` (4), `src/start` (3), `packages/rafa/src/project` (2), `src/claims` (2), `src/commands/release` (2), `src/status` (2), `src/suite` (2), `src/epic` (1), `src/plan` (1), `src/plan/risk` (1) |
| `c02-sqlite` | 298 | `packages/rafa/src/effort/store` (90), `src/effort` (53), `src/triage` (37), `src/commands/effort` (17), `src/start` (15), `src/tests` (14), `src/tests/core-coupled/effort/store` (11), `packages/rafa/src/bugs` (9), `src/bugs` (6), `src/docs` (5), `packages/rafa/src/effort/store/testdata` (4), `src/commands` (4), `packages/rafa/src/core/runtime` (3), `packages/rafa/src/report` (3), `src/adapters/tracker` (3), `src/commands/epic` (3), `src/effort/sync` (3), `src/tests/core-coupled/bugs` (3), `src/commands/docs` (2), `src/commands/release` (2), `packages/rafa/src/project` (1), `packages/rafa/src/utils` (1), `src` (1), `src/board/project` (1), `src/claims` (1), `src/commands/claim` (1), `src/commands/issue` (1), `src/inventory/search` (1), `src/tests/core-coupled/core/runtime` (1), `src/tests/core-coupled/project` (1), `src/tests/core-coupled/utils` (1) |
| `c03-index` | 245 | `src/start` (114), `src/tests` (26), `src/commands/plan` (14), `src/suite` (13), `src/board` (10), `packages/rafa/src/core/plan` (6), `src/commands/bug` (6), `src/loop` (6), `src/plan` (6), `src` (4), `src/bugs` (4), `packages/rafa/src/plan` (3), `src/epic` (3), `packages/rafa/src/adapters/output` (2), `packages/rafa/src/project` (2), `packages/rafa/src/runtime` (2), `packages/rafa/src/utils` (2), `src/adapters/planner` (2), `src/cleanup` (2), `src/commands` (2), `src/commands/loop` (2), `src/preflight` (2), `src/runtime` (2), `packages/rafa/src/core/loop` (1), `packages/rafa/src/core/output` (1), `packages/rafa/src/ports` (1), `src/commands/epic` (1), `src/commands/stretch` (1), `src/notices` (1), `src/tests/core-coupled/plan` (1), `src/tests/core-coupled/utils` (1), `src/triage` (1), `src/utils` (1) |
| `c04-cli-capture` | 237 | `src/tests` (85), `src/release` (61), `src/commands/release` (32), `src/start` (21), `src/commands/pr` (9), `src/project` (6), `src/commands` (4), `src/effort` (3), `src/commands/bug` (2), `src/pr` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src` (1), `src/board/project` (1), `src/cli` (1), `src/commands/config` (1), `src/docs` (1), `src/next` (1), `src/notices` (1), `src/tests/core-coupled/project` (1) |
| `c05-index` | 203 | `src` (26), `packages/rafa/src/core/config` (22), `src/adapters/tracker` (12), `src/tests` (11), `src/commands/instinct` (10), `src/learning` (10), `src/start` (9), `packages/rafa/src/adapters/logger` (8), `src/config` (8), `src/commands` (6), `src/effort/sync` (6), `src/tests/core-coupled/core/config` (6), `packages/rafa/src` (4), `packages/rafa/src/core/adapters` (4), `packages/rafa/src/core/output` (4), `packages/rafa/src/modules` (4), `src/adapters/learning` (4), `src/release` (4), `src/tests/core-coupled` (4), `packages/rafa/src/ports` (3), `src/commands/config` (3), `src/project` (3), `src/schema` (3), `src/tests/core-coupled/adapters/logger` (3), `src/tests/core-coupled/effort/store` (3), `src/commands/issue` (2), `src/report` (2), `src/tests/core-coupled/core/output` (2), `packages/rafa/src/core/git` (1), `packages/rafa/src/effort/store` (1), `packages/rafa/src/modules/testdata/hub-down-sync` (1), `packages/rafa/src/modules/testdata/sync-fixture` (1), `src/adapters/output` (1), `src/board` (1), `src/cli` (1), `src/modules` (1), `src/modules/testdata/pull-merge-sync` (1), `src/ports` (1), `src/preflight` (1), `src/suite` (1), `src/tests/core-coupled/modules` (1), `src/tests/core-coupled/ports` (1), `src/tests/core-coupled/project` (1), `src/tests/core-coupled/report` (1), `src/tiers` (1) |
| `c06-record` | 184 | `src/commands` (26), `src/inventory` (14), `src/schema` (12), `src/tiers` (12), `src/commands/skill` (11), `src/inventory/search` (11), `src/backfill` (10), `src/demote` (10), `src/tests` (9), `src/check` (8), `src/task` (8), `src/commands/agent` (7), `src/pr` (7), `src/plan/risk` (5), `src/preflight` (5), `packages/rafa/src/plan/risk` (4), `src/agents` (4), `src/commands/plan` (4), `packages/rafa/src/schema` (3), `src/plan` (3), `src/start` (3), `packages/rafa/src/core/loop` (2), `src/effort` (2), `src/utils` (2), `src/commands/instinct` (1), `src/tests/core-coupled/schema` (1) |
| `c07-index` | 161 | `src/commands/pr` (61), `src/next` (35), `src/pr` (17), `src/pr/triage` (15), `src/start` (7), `src/tests` (6), `src/commands` (5), `src/pr/plans` (5), `packages/rafa/src/next` (2), `src/board` (2), `src/project` (2), `packages/rafa/src/project` (1), `src/commands/release` (1), `src/tests/core-coupled/commands/plan` (1), `src/tests/core-coupled/next` (1) |
| `c08-index` | 140 | `src/cli` (19), `packages/rafa/src/core/command` (17), `src/refs` (13), `src/commands` (11), `src/commands/update` (10), `src/tests` (8), `packages/rafa/src/errors` (6), `src/errors` (6), `src/board` (4), `src/cli/core` (4), `src/commands/module` (4), `packages/rafa/src/project` (3), `src/commands/plan` (3), `src/bugs` (2), `src/commands/config` (2), `src/commands/effort` (2), `src/commands/issue` (2), `src/next` (2), `src/project` (2), `src/status` (2), `src/tests/core-coupled/project` (2), `src/triage` (2), `src/utils` (2), `packages/rafa/src/adapters/logger` (1), `packages/rafa/src/core/loop` (1), `packages/rafa/src/errors/fixtures` (1), `packages/rafa/src/modules/testdata/seam-fixture` (1), `src` (1), `src/adapters/output` (1), `src/commands/bug` (1), `src/commands/loop` (1), `src/release` (1), `src/tests/core-coupled/core/command` (1), `src/tests/core-coupled/core/loop` (1), `src/tests/core-coupled/errors` (1) |
| `c09-types` | 108 | `src/cleanup` (20), `src/pr` (15), `src/status` (13), `src/commands/loop` (12), `src/cli/prompt` (10), `src/board` (9), `src/commands` (8), `src/tests` (8), `src/pr/triage` (3), `src/inventory` (2), `src/loop` (2), `src/start` (2), `src/suite` (2), `packages/rafa/src/commands/plan` (1), `packages/rafa/src/core/loop` (1) |
| `c10-sections` | 71 | `src/claims` (16), `src/commands/claim` (12), `packages/rafa/src/core/config` (8), `src/release` (7), `src/board` (6), `src/start` (6), `src/tests` (4), `src/commands/release` (3), `src/commands` (2), `src/commands/plan` (2), `src/status` (2), `packages/rafa/src/utils` (1), `src/notices` (1), `src/tests/core-coupled/utils` (1) |
| `c11-index` | 44 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa/src/effort/store` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1) |
| `c12-start` | 33 | `src/stretch` (13), `src/ci` (7), `src/commands/stretch` (7), `src` (2), `src/commands` (2), `src/commands/ci` (2) |
| `c13-sessions` | 29 | `packages/rafa/src/core/loop` (17), `packages/rafa/src/core/plan` (10), `packages/rafa/src/effort/store` (2) |
| `c14-sweep-timeout` | 28 | `src/tests` (20), `src/fixtures` (5), `src/commands` (1), `src/start` (1), `src/tests/core-coupled/effort/store` (1) |
| `c15-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c16-registry-types.test` | 1 | `packages/rafa/src/core/command` (1) |
| `c17-types.test` | 1 | `packages/rafa/src/core/command` (1) |
| `c18-index.test` | 1 | `src/commands/board` (1) |
| `c19-declarations.test` | 1 | `src/commands/claim` (1) |
| `c20-index.test` | 1 | `src/commands/claim` (1) |
| `c21-declarations.test` | 1 | `src/commands/epic` (1) |
| `c22-declarations.test` | 1 | `src/commands/issue` (1) |
| `c23-declarations.test` | 1 | `src/commands/pr` (1) |
| `c24-index.test` | 1 | `src/commands/pr` (1) |
| `c25-declarations.test` | 1 | `src/commands/release` (1) |
| `c26-index.test` | 1 | `src/commands/release` (1) |
| `c27-config-schema-readings` | 1 | `src` (1) |
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
| 1 | `packages/rafa/src/ports/index.ts` | 62425.827387 | `c05-index` |
| 2 | `packages/rafa/src/effort/store/merge-store.ts` | 50657.980907 | `c02-sqlite` |
| 3 | `src/tests/cli-capture.ts` | 31052.464939 | `c04-cli-capture` |
| 4 | `packages/rafa/src/core/command/index.ts` | 24461.993525 | `c08-index` |
| 5 | `packages/rafa/src/core/config/index.ts` | 22550.807398 | `c05-index` |
| 6 | `src/adapters/tracker/github.ts` | 18315.273482 | `c01-github` |
| 7 | `src/commands/index.ts` | 17942.772741 | `c08-index` |
| 8 | `packages/rafa/src/core/loop/index.ts` | 16644.766965 | `c03-index` |
| 9 | `src/board/relations/labels.ts` | 15259.543848 | `c01-github` |
| 10 | `src/board/setup.ts` | 14851.924295 | `c01-github` |
| 11 | `src/pr/index.ts` | 14445.922724 | `c07-index` |
| 12 | `src/next/sources.ts` | 13185.019542 | `c07-index` |
| 13 | `src/board/roadmap.ts` | 13102.133562 | `c01-github` |
| 14 | `src/start/dispatch.ts` | 12745.512371 | `c03-index` |
| 15 | `src/project/scaffold.ts` | 12637.416439 | `c04-cli-capture` |
| 16 | `packages/rafa/src/core/config/scope.ts` | 12311.166032 | `c05-index` |
| 17 | `src/start/loop-events.ts` | 12137.694441 | `c03-index` |
| 18 | `packages/rafa/src/core/config/config-load.ts` | 11699.414823 | `c05-index` |
| 19 | `src/board/gate.ts` | 10846.925855 | `c03-index` |
| 20 | `src/config-registry.ts` | 10471.133113 | `c05-index` |
| 21 | `packages/rafa/src/core/output/active.ts` | 10277.023114 | `c05-index` |
| 22 | `src/board/project/refresh.ts` | 9926.924959 | `c01-github` |
| 23 | `packages/rafa/src/effort/store/development-build.ts` | 9651.242152 | `c02-sqlite` |
| 24 | `packages/rafa/src/effort/store/sqlite.ts` | 9219.657342 | `c02-sqlite` |
| 25 | `packages/rafa/src/core/config/sections.ts` | 9098.143681 | `c10-sections` |
| 26 | `src/refs/extract.ts` | 8474.407085 | `c08-index` |
| 27 | `src/triage/triage.ts` | 8224.557004 | `c02-sqlite` |
| 28 | `src/cli/dispatch.ts` | 8184.910941 | `c08-index` |
| 29 | `src/board/issue.ts` | 8036.400483 | `c01-github` |
| 30 | `src/start/suite-step.ts` | 7816.860859 | `c03-index` |

## Unresolved imports

- `src/tests/package-build.test.ts`: `${DEFINE_CONFIG}`
- `src/tests/package-build.test.ts`: `${OWN_SUBPATH}core/absent`
