# Import graph

Coverage: 2166 of 2166 tracked files read (src/ and packages/*/src/).

2166 files, 10983 edges (8599 value, 2384 type), 45 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 317 | `src/board` (114), `src/commands` (29), `src/commands/issue` (29), `src/commands/epic` (28), `src/tests` (28), `src/board/relations` (19), `src/refs` (13), `src/commands/plan` (10), `src/next` (9), `src/commands/pr` (7), `packages/rafa/src/core/git` (6), `src/board/project` (4), `src/commands/board` (3), `packages/rafa/src/project` (2), `src/adapters/tracker` (2), `src/claims` (2), `src/status` (2), `src/suite` (2), `src/triage` (2), `src/cli` (1), `src/epic` (1), `src/plan` (1), `src/plan/risk` (1), `src/project` (1), `src/start` (1) |
| `c02-sqlite` | 290 | `packages/rafa/src/effort/store` (90), `src/effort` (53), `src/triage` (37), `src/commands/effort` (17), `src/start` (15), `src/tests` (13), `src/tests/core-coupled/effort/store` (11), `packages/rafa/src/bugs` (9), `src/bugs` (6), `packages/rafa/src/effort/store/testdata` (4), `src/commands` (4), `packages/rafa/src/core/runtime` (3), `packages/rafa/src/report` (3), `src/adapters/tracker` (3), `src/commands/epic` (3), `src/effort/sync` (3), `src/tests/core-coupled/bugs` (3), `src/docs` (2), `packages/rafa/src/project` (1), `packages/rafa/src/utils` (1), `src` (1), `src/board/project` (1), `src/claims` (1), `src/commands/claim` (1), `src/commands/issue` (1), `src/inventory/search` (1), `src/tests/core-coupled/core/runtime` (1), `src/tests/core-coupled/project` (1), `src/tests/core-coupled/utils` (1) |
| `c03-index` | 251 | `src/commands/pr` (61), `src/next` (37), `src/cli` (17), `src/pr` (17), `src/pr/triage` (15), `src/commands` (13), `src/commands/update` (10), `src/tests` (9), `src/start` (7), `packages/rafa/src/errors` (6), `src/errors` (6), `src/pr/plans` (5), `packages/rafa/src/project` (4), `src/board` (4), `src/cli/core` (4), `src/commands/module` (4), `src/project` (3), `packages/rafa/src/next` (2), `src/bugs` (2), `src/commands/board` (2), `src/commands/effort` (2), `src/commands/instinct` (2), `src/status` (2), `src/tests/core-coupled/project` (2), `packages/rafa/src/core/command` (1), `packages/rafa/src/effort/store` (1), `packages/rafa/src/errors/fixtures` (1), `packages/rafa/src/modules/testdata/seam-fixture` (1), `src` (1), `src/adapters/output` (1), `src/commands/bug` (1), `src/commands/loop` (1), `src/commands/plan` (1), `src/commands/release` (1), `src/notices` (1), `src/release` (1), `src/tests/core-coupled/commands/plan` (1), `src/tests/core-coupled/errors` (1), `src/tests/core-coupled/next` (1) |
| `c04-index` | 241 | `src/start` (114), `src/tests` (26), `src/suite` (13), `src/commands/plan` (10), `src/pr` (7), `src/preflight` (7), `packages/rafa/src/core/plan` (6), `src/commands/bug` (6), `src/loop` (6), `src/plan` (6), `src/bugs` (4), `packages/rafa/src/plan` (3), `src` (3), `src/epic` (3), `packages/rafa/src/adapters/output` (2), `packages/rafa/src/project` (2), `packages/rafa/src/runtime` (2), `packages/rafa/src/utils` (2), `src/cleanup` (2), `src/commands` (2), `src/commands/loop` (2), `src/runtime` (2), `packages/rafa/src/core/loop` (1), `packages/rafa/src/core/output` (1), `packages/rafa/src/schema` (1), `src/commands/epic` (1), `src/commands/stretch` (1), `src/notices` (1), `src/tests/core-coupled/plan` (1), `src/tests/core-coupled/schema` (1), `src/tests/core-coupled/utils` (1), `src/triage` (1), `src/utils` (1) |
| `c05-cli-capture` | 233 | `src/tests` (82), `src/release` (61), `src/commands/release` (32), `src/start` (21), `src/commands/pr` (9), `src/commands` (5), `src/project` (5), `src/effort` (3), `src/commands/bug` (2), `src/pr` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src` (1), `src/cli` (1), `src/commands/config` (1), `src/docs` (1), `src/next` (1), `src/notices` (1), `src/tests/core-coupled/project` (1) |
| `c06-index` | 155 | `src` (26), `packages/rafa/src/core/config` (22), `packages/rafa/src/core/command` (16), `src/config` (8), `src/commands` (7), `src/effort/sync` (6), `src/tests` (6), `src/tests/core-coupled/core/config` (6), `src/commands/config` (5), `packages/rafa/src` (4), `packages/rafa/src/core/adapters` (4), `packages/rafa/src/core/output` (4), `packages/rafa/src/modules` (4), `src/release` (4), `src/tests/core-coupled` (4), `src/project` (3), `src/tests/core-coupled/effort/store` (3), `src/start` (2), `src/tests/core-coupled/core/output` (2), `src/utils` (2), `packages/rafa/src/adapters/logger` (1), `packages/rafa/src/core/git` (1), `packages/rafa/src/core/loop` (1), `packages/rafa/src/effort/store` (1), `packages/rafa/src/modules/testdata/hub-down-sync` (1), `packages/rafa/src/ports` (1), `src/board` (1), `src/cli` (1), `src/modules` (1), `src/modules/testdata/pull-merge-sync` (1), `src/preflight` (1), `src/suite` (1), `src/tests/core-coupled/core/command` (1), `src/tests/core-coupled/core/loop` (1), `src/tests/core-coupled/modules` (1), `src/tests/core-coupled/project` (1), `src/tiers` (1) |
| `c07-record` | 147 | `src/commands` (18), `src/inventory` (14), `src/schema` (13), `src/tiers` (12), `src/commands/skill` (11), `src/inventory/search` (11), `src/backfill` (10), `src/demote` (10), `src/check` (8), `src/task` (8), `src/tests` (8), `src/commands/agent` (7), `src/agents` (4), `packages/rafa/src/core/loop` (2), `packages/rafa/src/schema` (2), `src/commands/plan` (2), `src/effort` (2), `src/plan` (2), `src/utils` (2), `src/commands/instinct` (1) |
| `c08-types` | 108 | `src/cleanup` (20), `src/pr` (15), `src/status` (13), `src/commands/loop` (12), `src/cli/prompt` (10), `src/board` (9), `src/commands` (8), `src/tests` (8), `src/pr/triage` (3), `src/inventory` (2), `src/loop` (2), `src/start` (2), `src/suite` (2), `packages/rafa/src/commands/plan` (1), `packages/rafa/src/core/loop` (1) |
| `c09-index` | 91 | `src/adapters/tracker` (14), `src/learning` (10), `src/commands/issue` (9), `packages/rafa/src/adapters/logger` (8), `src/commands/instinct` (8), `src/tests` (8), `src/start` (7), `src/adapters/learning` (4), `src/docs` (3), `src/tests/core-coupled/adapters/logger` (3), `packages/rafa/src/ports` (2), `src/commands/docs` (2), `src/commands/release` (2), `src/report` (2), `src/schema` (2), `packages/rafa/src/modules/testdata/sync-fixture` (1), `src/adapters/output` (1), `src/cli` (1), `src/ports` (1), `src/project` (1), `src/tests/core-coupled/ports` (1), `src/tests/core-coupled/report` (1) |
| `c10-sections` | 91 | `src/board` (18), `src/claims` (16), `src/commands/claim` (12), `packages/rafa/src/core/config` (8), `src/release` (7), `src/commands/plan` (6), `src/start` (6), `src/tests` (5), `src/commands/release` (3), `src/adapters/planner` (2), `src/commands` (2), `src/status` (2), `packages/rafa/src/ports` (1), `packages/rafa/src/utils` (1), `src` (1), `src/tests/core-coupled/utils` (1) |
| `c11-refresh` | 60 | `src/board/project` (38), `src/commands` (7), `src/commands/issue` (4), `src/tests` (3), `src/commands/board` (2), `src/commands/epic` (2), `src/commands/release` (2), `src/start` (2) |
| `c12-start` | 51 | `src/stretch` (13), `src/ci` (7), `src/commands/stretch` (7), `src/commands` (5), `src/plan/risk` (5), `packages/rafa/src/plan/risk` (4), `src/start` (3), `src` (2), `src/commands/ci` (2), `src/commands/plan` (2), `src/plan` (1) |
| `c13-index` | 43 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa-sync-service/src/testdata` (1), `packages/rafa/src/effort/store` (1), `src/effort/store` (1) |
| `c14-sessions` | 29 | `packages/rafa/src/core/loop` (17), `packages/rafa/src/core/plan` (10), `packages/rafa/src/effort/store` (2) |
| `c15-sweep-timeout` | 28 | `src/tests` (20), `src/fixtures` (5), `src/commands` (1), `src/start` (1), `src/tests/core-coupled/effort/store` (1) |
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
| 1 | `packages/rafa/src/ports/index.ts` | 62700.057763 | `c09-index` |
| 2 | `packages/rafa/src/effort/store/merge-store.ts` | 50812.495842 | `c02-sqlite` |
| 3 | `src/tests/cli-capture.ts` | 31176.218505 | `c05-cli-capture` |
| 4 | `packages/rafa/src/core/command/index.ts` | 24460.398601 | `c03-index` |
| 5 | `packages/rafa/src/core/config/index.ts` | 22550.439139 | `c06-index` |
| 6 | `src/adapters/tracker/github.ts` | 18360.138828 | `c01-github` |
| 7 | `src/commands/index.ts` | 17938.087934 | `c03-index` |
| 8 | `packages/rafa/src/core/loop/index.ts` | 16726.896614 | `c04-index` |
| 9 | `src/board/relations/labels.ts` | 15291.753768 | `c01-github` |
| 10 | `src/pr/index.ts` | 14612.910376 | `c03-index` |
| 11 | `src/board/setup.ts` | 14293.369386 | `c01-github` |
| 12 | `src/next/sources.ts` | 13249.19175 | `c03-index` |
| 13 | `src/board/roadmap.ts` | 13096.45182 | `c01-github` |
| 14 | `src/start/dispatch.ts` | 12874.756707 | `c04-index` |
| 15 | `src/project/scaffold.ts` | 12641.682883 | `c05-cli-capture` |
| 16 | `packages/rafa/src/core/config/scope.ts` | 12363.836667 | `c06-index` |
| 17 | `packages/rafa/src/core/config/config-load.ts` | 11704.483474 | `c06-index` |
| 18 | `src/board/gate.ts` | 10691.406738 | `c10-sections` |
| 19 | `src/config-registry.ts` | 10471.133113 | `c06-index` |
| 20 | `packages/rafa/src/core/output/active.ts` | 10334.322148 | `c06-index` |
| 21 | `src/board/project/refresh.ts` | 10009.466626 | `c11-refresh` |
| 22 | `packages/rafa/src/effort/store/development-build.ts` | 9676.092152 | `c02-sqlite` |
| 23 | `packages/rafa/src/effort/store/sqlite.ts` | 9222.541685 | `c02-sqlite` |
| 24 | `packages/rafa/src/core/config/sections.ts` | 9096.981055 | `c10-sections` |
| 25 | `src/refs/extract.ts` | 8474.407085 | `c01-github` |
| 26 | `src/cli/dispatch.ts` | 8269.144274 | `c03-index` |
| 27 | `src/triage/triage.ts` | 8224.992718 | `c02-sqlite` |
| 28 | `src/board/issue.ts` | 8024.6855 | `c01-github` |
| 29 | `src/start/loop-events.ts` | 7957.767977 | `c04-index` |
| 30 | `src/start/suite-step.ts` | 7855.883045 | `c04-index` |
