# Import graph

Coverage: 2167 of 2167 tracked files read (src/ and packages/*/src/).

2167 files, 10994 edges (8602 value, 2392 type), 45 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 320 | `src/board` (114), `src/commands` (29), `src/commands/issue` (29), `src/tests` (29), `src/commands/epic` (28), `src/board/relations` (19), `src/refs` (13), `src/commands/plan` (10), `src/next` (9), `src/commands/pr` (7), `packages/rafa/src/core/git` (6), `src/board/project` (4), `src/commands/board` (3), `src/start` (3), `src/status` (3), `packages/rafa/src/project` (2), `src/adapters/tracker` (2), `src/claims` (2), `src/suite` (2), `src/triage` (2), `src/cli` (1), `src/epic` (1), `src/plan` (1), `src/plan/risk` (1) |
| `c02-sqlite` | 297 | `packages/rafa/src/effort/store` (90), `src/effort` (53), `src/triage` (37), `src/commands/effort` (15), `src/start` (15), `src/tests` (13), `src/tests/core-coupled/effort/store` (11), `src/inventory/search` (10), `packages/rafa/src/bugs` (9), `src/bugs` (6), `packages/rafa/src/effort/store/testdata` (4), `src/commands` (4), `packages/rafa/src/core/runtime` (3), `packages/rafa/src/report` (3), `src/adapters/tracker` (3), `src/commands/epic` (3), `src/effort/sync` (3), `src/tests/core-coupled/bugs` (3), `src/docs` (2), `packages/rafa/src/project` (1), `packages/rafa/src/utils` (1), `src` (1), `src/board/project` (1), `src/claims` (1), `src/commands/claim` (1), `src/commands/issue` (1), `src/tests/core-coupled/core/runtime` (1), `src/tests/core-coupled/project` (1), `src/tests/core-coupled/utils` (1) |
| `c03-cli-capture` | 278 | `src/tests` (87), `src/release` (68), `src/commands/release` (35), `src/start` (24), `src/commands/pr` (9), `src/commands` (8), `src/commands/loop` (6), `src/project` (5), `src/loop` (4), `src/effort` (3), `packages/rafa/src/project` (2), `packages/rafa/src/runtime` (2), `src` (2), `src/cleanup` (2), `src/commands/bug` (2), `src/commands/config` (2), `src/pr` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src/runtime` (2), `packages/rafa/src/core/loop` (1), `src/cli` (1), `src/commands/effort` (1), `src/commands/stretch` (1), `src/docs` (1), `src/next` (1), `src/notices` (1), `src/tests/core-coupled/next` (1), `src/tests/core-coupled/project` (1) |
| `c04-index` | 237 | `src/commands/pr` (61), `src/pr` (39), `src/next` (32), `src/cleanup` (20), `src/pr/triage` (18), `src/board` (12), `src/commands` (12), `src/start` (9), `src/status` (9), `src/tests` (9), `src/pr/plans` (5), `packages/rafa/src/next` (2), `src/loop` (2), `src/suite` (2), `packages/rafa/src/effort/store` (1), `packages/rafa/src/schema` (1), `src/commands/release` (1), `src/plan` (1), `src/tests/core-coupled/schema` (1) |
| `c05-index` | 187 | `src/start` (108), `src/tests` (20), `src/suite` (13), `src/board` (10), `packages/rafa/src/core/plan` (6), `src/commands/bug` (6), `src/bugs` (4), `src/commands/plan` (4), `src/epic` (3), `packages/rafa/src/utils` (2), `src` (2), `src/adapters/planner` (2), `packages/rafa/src/core/output` (1), `packages/rafa/src/ports` (1), `src/commands/epic` (1), `src/preflight` (1), `src/tests/core-coupled/utils` (1), `src/triage` (1), `src/utils` (1) |
| `c06-sections` | 176 | `src/commands` (19), `src/claims` (16), `src/tiers` (13), `src/commands/claim` (12), `src/inventory` (12), `src/start` (10), `src/tests` (10), `src/commands/plan` (9), `src/board` (8), `src/plan` (8), `src/task` (8), `src/preflight` (6), `src/plan/risk` (5), `packages/rafa/src/plan/risk` (4), `src/agents` (4), `src/check` (4), `packages/rafa/src/plan` (3), `src` (3), `src/commands/agent` (3), `packages/rafa/src/core/loop` (2), `packages/rafa/src/schema` (2), `src/effort` (2), `src/inventory/search` (2), `src/notices` (2), `src/status` (2), `src/utils` (2), `packages/rafa/src/core/config` (1), `packages/rafa/src/utils` (1), `src/commands/skill` (1), `src/tests/core-coupled/plan` (1), `src/tests/core-coupled/utils` (1) |
| `c07-index` | 155 | `packages/rafa/src/core/config` (29), `src` (25), `packages/rafa/src/core/command` (16), `src/config` (8), `src/commands` (7), `src/effort/sync` (6), `src/tests/core-coupled/core/config` (6), `src/tests` (5), `packages/rafa/src` (4), `packages/rafa/src/core/adapters` (4), `packages/rafa/src/core/output` (4), `packages/rafa/src/modules` (4), `src/release` (4), `src/tests/core-coupled` (4), `src/commands/config` (3), `src/project` (3), `src/tests/core-coupled/effort/store` (3), `src/start` (2), `src/tests/core-coupled/core/output` (2), `packages/rafa/src/adapters/logger` (1), `packages/rafa/src/core/git` (1), `packages/rafa/src/core/loop` (1), `packages/rafa/src/effort/store` (1), `packages/rafa/src/modules/testdata/hub-down-sync` (1), `packages/rafa/src/ports` (1), `src/board` (1), `src/cli` (1), `src/modules` (1), `src/modules/testdata/pull-merge-sync` (1), `src/preflight` (1), `src/suite` (1), `src/tests/core-coupled/core/command` (1), `src/tests/core-coupled/core/loop` (1), `src/tests/core-coupled/modules` (1), `src/tests/core-coupled/project` (1) |
| `c08-index` | 151 | `src/cli` (17), `src/cli/prompt` (10), `src/commands` (10), `src/commands/update` (10), `src/commands/loop` (9), `src/commands/plan` (7), `src/tests` (7), `packages/rafa/src/errors` (6), `src/errors` (6), `src/commands/skill` (5), `src/next` (5), `src/project` (5), `src/status` (5), `packages/rafa/src/project` (4), `src/cli/core` (4), `src/commands/agent` (4), `src/commands/module` (4), `src/commands/effort` (3), `src/commands/instinct` (3), `src/inventory` (3), `src/bugs` (2), `src/commands/board` (2), `src/loop` (2), `src/tests/core-coupled/project` (2), `src/utils` (2), `packages/rafa/src/commands/plan` (1), `packages/rafa/src/core/command` (1), `packages/rafa/src/core/loop` (1), `packages/rafa/src/errors/fixtures` (1), `packages/rafa/src/modules/testdata/seam-fixture` (1), `src/adapters/output` (1), `src/board` (1), `src/commands/bug` (1), `src/commands/config` (1), `src/commands/docs` (1), `src/release` (1), `src/schema` (1), `src/tests/core-coupled/commands/plan` (1), `src/tests/core-coupled/errors` (1) |
| `c09-index` | 92 | `src/adapters/tracker` (14), `src/learning` (10), `src/commands/issue` (9), `packages/rafa/src/adapters/logger` (8), `src/tests` (8), `src/commands/instinct` (7), `src/start` (7), `src/adapters/learning` (4), `src/docs` (3), `src/schema` (3), `src/tests/core-coupled/adapters/logger` (3), `packages/rafa/src/adapters/output` (2), `packages/rafa/src/ports` (2), `src/commands/release` (2), `src/report` (2), `packages/rafa/src/modules/testdata/sync-fixture` (1), `src/adapters/output` (1), `src/cli` (1), `src/commands/docs` (1), `src/commands/plan` (1), `src/ports` (1), `src/tests/core-coupled/ports` (1), `src/tests/core-coupled/report` (1) |
| `c10-refresh` | 60 | `src/board/project` (38), `src/commands` (7), `src/commands/issue` (4), `src/tests` (3), `src/commands/board` (2), `src/commands/epic` (2), `src/commands/release` (2), `src/start` (2) |
| `c11-frontmatter` | 49 | `src/schema` (11), `src/backfill` (10), `src/demote` (10), `src/commands/skill` (5), `src/tests` (5), `src/check` (4), `src/commands` (2), `src/commands/instinct` (1), `src/inventory` (1) |
| `c12-index` | 43 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa-sync-service/src/testdata` (1), `packages/rafa/src/effort/store` (1), `src/effort/store` (1) |
| `c13-start` | 33 | `src/stretch` (13), `src/ci` (7), `src/commands/stretch` (7), `src` (2), `src/commands` (2), `src/commands/ci` (2) |
| `c14-sessions` | 29 | `packages/rafa/src/core/loop` (17), `packages/rafa/src/core/plan` (10), `packages/rafa/src/effort/store` (2) |
| `c15-sweep-timeout` | 29 | `src/tests` (21), `src/fixtures` (5), `src/commands` (1), `src/start` (1), `src/tests/core-coupled/effort/store` (1) |
| `c16-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
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
| `c28-config-schema-readings` | 1 | `src` (1) |
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
| 1 | `packages/rafa/src/ports/index.ts` | 62675.059119 | `c09-index` |
| 2 | `packages/rafa/src/effort/store/merge-store.ts` | 50799.322293 | `c02-sqlite` |
| 3 | `src/tests/cli-capture.ts` | 31161.070356 | `c03-cli-capture` |
| 4 | `packages/rafa/src/core/command/index.ts` | 24447.878876 | `c08-index` |
| 5 | `packages/rafa/src/core/config/index.ts` | 22546.03316 | `c07-index` |
| 6 | `src/adapters/tracker/github.ts` | 18358.223265 | `c01-github` |
| 7 | `src/commands/index.ts` | 17941.717048 | `c08-index` |
| 8 | `packages/rafa/src/core/loop/index.ts` | 16729.139597 | `c03-cli-capture` |
| 9 | `src/board/relations/labels.ts` | 15287.128696 | `c01-github` |
| 10 | `src/pr/index.ts` | 14775.330146 | `c04-index` |
| 11 | `src/board/setup.ts` | 14271.052719 | `c01-github` |
| 12 | `src/next/sources.ts` | 13168.749987 | `c04-index` |
| 13 | `src/board/roadmap.ts` | 13105.673825 | `c01-github` |
| 14 | `src/start/dispatch.ts` | 12866.847817 | `c05-index` |
| 15 | `src/project/scaffold.ts` | 12640.772381 | `c03-cli-capture` |
| 16 | `packages/rafa/src/core/config/scope.ts` | 12361.581695 | `c07-index` |
| 17 | `packages/rafa/src/core/config/config-load.ts` | 11701.188062 | `c07-index` |
| 18 | `src/board/gate.ts` | 10665.405839 | `c05-index` |
| 19 | `src/config-registry.ts` | 10471.133113 | `c07-index` |
| 20 | `packages/rafa/src/core/output/active.ts` | 10333.652979 | `c07-index` |
| 21 | `src/board/project/refresh.ts` | 10009.444276 | `c10-refresh` |
| 22 | `packages/rafa/src/effort/store/development-build.ts` | 9675.358819 | `c02-sqlite` |
| 23 | `packages/rafa/src/effort/store/sqlite.ts` | 9226.639624 | `c02-sqlite` |
| 24 | `packages/rafa/src/core/config/sections.ts` | 9098.768787 | `c06-sections` |
| 25 | `src/refs/extract.ts` | 8474.407085 | `c01-github` |
| 26 | `src/cli/dispatch.ts` | 8266.494447 | `c08-index` |
| 27 | `src/triage/triage.ts` | 8224.574128 | `c02-sqlite` |
| 28 | `src/board/issue.ts` | 8024.6855 | `c01-github` |
| 29 | `src/start/loop-events.ts` | 7961.264026 | `c03-cli-capture` |
| 30 | `src/start/suite-step.ts` | 7858.015188 | `c05-index` |
