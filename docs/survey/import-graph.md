# Import graph

Coverage: 2166 of 2166 tracked files read (src/ and packages/*/src/).

2166 files, 10984 edges (8600 value, 2384 type), 43 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 354 | `src/board` (114), `src/board/project` (41), `src/commands/issue` (38), `src/commands` (30), `src/commands/epic` (30), `src/tests` (25), `src/board/relations` (19), `src/next` (9), `src/commands/plan` (8), `src/commands/board` (7), `src/commands/pr` (7), `packages/rafa/src/core/git` (6), `src/adapters/tracker` (4), `src/start` (3), `packages/rafa/src/project` (2), `src/claims` (2), `src/commands/release` (2), `src/status` (2), `src/suite` (2), `src/epic` (1), `src/plan` (1), `src/plan/risk` (1) |
| `c02-sqlite` | 270 | `packages/rafa/src/effort/store` (89), `src/effort` (55), `src/triage` (29), `src/commands/effort` (17), `src/start` (15), `src/tests` (13), `src/tests/core-coupled/effort/store` (11), `src/inventory/search` (10), `packages/rafa/src/effort/store/testdata` (4), `packages/rafa/src/core/runtime` (3), `packages/rafa/src/report` (3), `src/adapters/tracker` (3), `src/commands/epic` (3), `src/effort/sync` (3), `src/commands` (2), `src/docs` (2), `packages/rafa/src/utils` (1), `src` (1), `src/board/project` (1), `src/claims` (1), `src/commands/claim` (1), `src/commands/skill` (1), `src/tests/core-coupled/core/runtime` (1), `src/tests/core-coupled/utils` (1) |
| `c03-cli-capture` | 250 | `src/tests` (84), `src/release` (68), `src/commands/release` (35), `src/start` (21), `src/commands/pr` (9), `src/commands` (7), `src/project` (5), `src/pr` (3), `src/commands/bug` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src` (1), `src/board/project` (1), `src/cli` (1), `src/commands/config` (1), `src/docs` (1), `src/effort` (1), `src/next` (1), `src/notices` (1), `src/tests/core-coupled/next` (1), `src/tests/core-coupled/project` (1), `src/tests/core-coupled/schema` (1), `src/tests/core-coupled/utils` (1) |
| `c04-index` | 222 | `src/start` (115), `src/tests` (26), `src/suite` (13), `src/board` (10), `src/commands/plan` (7), `packages/rafa/src/core/plan` (6), `src/loop` (6), `src` (4), `packages/rafa/src/utils` (3), `src/epic` (3), `src/plan` (3), `packages/rafa/src/adapters/output` (2), `packages/rafa/src/runtime` (2), `src/adapters/planner` (2), `src/cleanup` (2), `src/commands` (2), `src/commands/loop` (2), `src/runtime` (2), `packages/rafa/src/core/loop` (1), `packages/rafa/src/core/output` (1), `packages/rafa/src/plan` (1), `packages/rafa/src/ports` (1), `src/commands/epic` (1), `src/commands/stretch` (1), `src/notices` (1), `src/preflight` (1), `src/tests/core-coupled/plan` (1), `src/tests/core-coupled/utils` (1), `src/triage` (1), `src/utils` (1) |
| `c05-index` | 198 | `src/commands/pr` (61), `src/next` (35), `src/pr` (17), `src/claims` (16), `src/pr/triage` (15), `src/commands/claim` (12), `src/start` (10), `src/tests` (9), `src/board` (6), `src/commands` (5), `src/pr/plans` (5), `packages/rafa/src/next` (2), `src/commands/plan` (2), `src/status` (2), `src/commands/release` (1) |
| `c06-sections` | 194 | `src/commands` (26), `src/inventory` (14), `src/tiers` (13), `src/backfill` (10), `src/demote` (10), `src/schema` (10), `src/commands/skill` (9), `src/tests` (9), `src/check` (8), `src/task` (8), `src/commands/plan` (7), `packages/rafa/src/project` (6), `src/commands/agent` (6), `src/plan` (6), `src/preflight` (6), `src/plan/risk` (5), `src/pr` (5), `src/project` (5), `src/start` (5), `packages/rafa/src/plan/risk` (4), `src/agents` (4), `packages/rafa/src/schema` (3), `packages/rafa/src/plan` (2), `src/board` (2), `src/effort` (2), `src/inventory/search` (2), `src/tests/core-coupled/project` (2), `src/utils` (2), `packages/rafa/src/core/config` (1), `packages/rafa/src/effort/store` (1), `src/commands/update` (1) |
| `c07-index` | 188 | `packages/rafa/src/core/config` (29), `src` (26), `packages/rafa/src/core/loop` (20), `packages/rafa/src/core/command` (16), `packages/rafa/src/core/plan` (10), `src/config` (8), `src/commands` (7), `src/effort/sync` (6), `src/tests` (6), `src/tests/core-coupled/core/config` (6), `packages/rafa/src` (4), `packages/rafa/src/core/adapters` (4), `packages/rafa/src/core/output` (4), `packages/rafa/src/modules` (4), `src/release` (4), `src/tests/core-coupled` (4), `packages/rafa/src/effort/store` (3), `src/commands/config` (3), `src/project` (3), `src/tests/core-coupled/effort/store` (3), `src/start` (2), `src/tests/core-coupled/core/output` (2), `packages/rafa/src/adapters/logger` (1), `packages/rafa/src/core/git` (1), `packages/rafa/src/modules/testdata/hub-down-sync` (1), `packages/rafa/src/ports` (1), `src/board` (1), `src/cli` (1), `src/modules` (1), `src/modules/testdata/pull-merge-sync` (1), `src/preflight` (1), `src/suite` (1), `src/tests/core-coupled/core/command` (1), `src/tests/core-coupled/core/loop` (1), `src/tests/core-coupled/modules` (1), `src/tests/core-coupled/project` (1) |
| `c08-index` | 142 | `src/adapters/tracker` (12), `src/bugs` (12), `src/learning` (10), `packages/rafa/src/bugs` (9), `packages/rafa/src/adapters/logger` (8), `src/commands/instinct` (8), `src/tests` (8), `src/triage` (8), `src/commands/bug` (7), `src/start` (7), `packages/rafa/src/errors` (6), `src/errors` (6), `src/schema` (5), `src/adapters/learning` (4), `src/commands/issue` (3), `src/docs` (3), `src/tests/core-coupled/adapters/logger` (3), `src/tests/core-coupled/bugs` (3), `packages/rafa/src/ports` (2), `src/commands/docs` (2), `src/commands/plan` (2), `src/commands/release` (2), `src/report` (2), `packages/rafa/src/errors/fixtures` (1), `packages/rafa/src/modules/testdata/sync-fixture` (1), `packages/rafa/src/project` (1), `src/adapters/output` (1), `src/cli` (1), `src/ports` (1), `src/tests/core-coupled/errors` (1), `src/tests/core-coupled/ports` (1), `src/tests/core-coupled/project` (1), `src/tests/core-coupled/report` (1) |
| `c09-types` | 109 | `src/cleanup` (20), `src/pr` (15), `src/status` (13), `src/commands/loop` (12), `src/cli/prompt` (10), `src/board` (9), `src/commands` (8), `src/tests` (8), `src/pr/triage` (3), `src/inventory` (2), `src/loop` (2), `src/start` (2), `src/suite` (2), `packages/rafa/src/commands/plan` (1), `packages/rafa/src/core/loop` (1), `src/tests/core-coupled/commands/plan` (1) |
| `c10-index` | 103 | `src/cli` (18), `src/refs` (13), `src/commands` (11), `src/commands/update` (9), `src/tests` (8), `src/commands/plan` (5), `src/board` (4), `src/cli/core` (4), `src/commands/module` (4), `src/commands/instinct` (3), `src/commands/config` (2), `src/commands/effort` (2), `src/commands/issue` (2), `src/next` (2), `src/status` (2), `src/triage` (2), `src/utils` (2), `packages/rafa/src/core/command` (1), `packages/rafa/src/modules/testdata/seam-fixture` (1), `src` (1), `src/adapters/output` (1), `src/commands/agent` (1), `src/commands/loop` (1), `src/commands/skill` (1), `src/notices` (1), `src/pr` (1), `src/release` (1) |
| `c11-index` | 44 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa/src/effort/store` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1) |
| `c12-start` | 33 | `src/stretch` (13), `src/ci` (7), `src/commands/stretch` (7), `src` (2), `src/commands` (2), `src/commands/ci` (2) |
| `c13-sweep-timeout` | 28 | `src/tests` (20), `src/fixtures` (5), `src/commands` (1), `src/start` (1), `src/tests/core-coupled/effort/store` (1) |
| `c14-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c15-registry-types.test` | 1 | `packages/rafa/src/core/command` (1) |
| `c16-types.test` | 1 | `packages/rafa/src/core/command` (1) |
| `c17-index.test` | 1 | `src/commands/board` (1) |
| `c18-declarations.test` | 1 | `src/commands/claim` (1) |
| `c19-index.test` | 1 | `src/commands/claim` (1) |
| `c20-declarations.test` | 1 | `src/commands/epic` (1) |
| `c21-declarations.test` | 1 | `src/commands/issue` (1) |
| `c22-declarations.test` | 1 | `src/commands/pr` (1) |
| `c23-index.test` | 1 | `src/commands/pr` (1) |
| `c24-declarations.test` | 1 | `src/commands/release` (1) |
| `c25-index.test` | 1 | `src/commands/release` (1) |
| `c26-config-schema-readings` | 1 | `src` (1) |
| `c27-types.test` | 1 | `src/pr` (1) |
| `c28-agent-gates.test` | 1 | `src/tests` (1) |
| `c29-agents-split-accounting.test` | 1 | `src/tests` (1) |
| `c30-cut-table-shape.test` | 1 | `src/tests` (1) |
| `c31-dependabot-config.test` | 1 | `src/tests` (1) |
| `c32-entry-exports.test` | 1 | `src/tests` (1) |
| `c33-epic-guard-workflow.test` | 1 | `src/tests` (1) |
| `c34-eslint-stand-in` | 1 | `src/tests` (1) |
| `c35-learning-boundary.test` | 1 | `src/tests` (1) |
| `c36-package-lint-spawned.test` | 1 | `src/tests` (1) |
| `c37-references-gate-spawned.test` | 1 | `src/tests` (1) |
| `c38-release-bot-fragment-workflow.test` | 1 | `src/tests` (1) |
| `c39-release-publish-workflow.test` | 1 | `src/tests` (1) |
| `c40-skill-gap-section.test` | 1 | `src/tests` (1) |
| `c41-verify-workflow.test` | 1 | `src/tests` (1) |
| `c42-cli.test` | 1 | `src/tools/ts-symbols` (1) |
| `c43-cli` | 1 | `src/tools/ts-symbols` (1) |

## The 30 files of highest betweenness

| Rank | File | Betweenness | Cluster |
| --- | --- | --- | --- |
| 1 | `packages/rafa/src/ports/index.ts` | 62693.582763 | `c08-index` |
| 2 | `packages/rafa/src/effort/store/merge-store.ts` | 50808.304175 | `c02-sqlite` |
| 3 | `src/tests/cli-capture.ts` | 31169.060574 | `c03-cli-capture` |
| 4 | `packages/rafa/src/core/command/index.ts` | 24459.306584 | `c10-index` |
| 5 | `packages/rafa/src/core/config/index.ts` | 22544.848271 | `c07-index` |
| 6 | `src/adapters/tracker/github.ts` | 18328.201188 | `c01-github` |
| 7 | `src/commands/index.ts` | 17937.852741 | `c10-index` |
| 8 | `packages/rafa/src/core/loop/index.ts` | 16721.098891 | `c04-index` |
| 9 | `src/board/relations/labels.ts` | 15290.043848 | `c01-github` |
| 10 | `src/board/setup.ts` | 14902.924295 | `c01-github` |
| 11 | `src/pr/index.ts` | 14461.281057 | `c05-index` |
| 12 | `src/next/sources.ts` | 13232.739781 | `c05-index` |
| 13 | `src/board/roadmap.ts` | 13102.569276 | `c01-github` |
| 14 | `src/start/dispatch.ts` | 12874.756707 | `c04-index` |
| 15 | `src/project/scaffold.ts` | 12641.416439 | `c03-cli-capture` |
| 16 | `packages/rafa/src/core/config/scope.ts` | 12365.903333 | `c07-index` |
| 17 | `packages/rafa/src/core/config/config-load.ts` | 11703.733474 | `c07-index` |
| 18 | `src/board/gate.ts` | 10899.092522 | `c04-index` |
| 19 | `src/config-registry.ts` | 10471.133113 | `c07-index` |
| 20 | `packages/rafa/src/core/output/active.ts` | 10308.149052 | `c07-index` |
| 21 | `src/board/project/refresh.ts` | 9928.52734 | `c01-github` |
| 22 | `packages/rafa/src/effort/store/development-build.ts` | 9672.367152 | `c02-sqlite` |
| 23 | `packages/rafa/src/effort/store/sqlite.ts` | 9222.541685 | `c02-sqlite` |
| 24 | `packages/rafa/src/core/config/sections.ts` | 9098.143681 | `c06-sections` |
| 25 | `src/refs/extract.ts` | 8474.407085 | `c10-index` |
| 26 | `src/cli/dispatch.ts` | 8261.910941 | `c10-index` |
| 27 | `src/triage/triage.ts` | 8224.992718 | `c02-sqlite` |
| 28 | `src/board/issue.ts` | 8037.025483 | `c01-github` |
| 29 | `src/start/loop-events.ts` | 7953.197687 | `c04-index` |
| 30 | `src/start/suite-step.ts` | 7855.883045 | `c04-index` |
