# Import graph

Coverage: 2166 of 2166 tracked files read (src/ and packages/*/src/).

2166 files, 10993 edges (8600 value, 2393 type), 45 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 317 | `src/board` (114), `src/commands/issue` (29), `src/commands/epic` (28), `src/tests` (28), `src/commands` (27), `src/board/relations` (19), `src/refs` (13), `src/commands/plan` (10), `src/next` (9), `src/commands/pr` (7), `packages/rafa/src/core/git` (6), `src/board/project` (4), `src/commands/board` (3), `src/start` (3), `packages/rafa/src/project` (2), `src/adapters/tracker` (2), `src/claims` (2), `src/status` (2), `src/suite` (2), `src/triage` (2), `src/cli` (1), `src/epic` (1), `src/plan` (1), `src/plan/risk` (1), `src/project` (1) |
| `c02-sqlite` | 260 | `packages/rafa/src/effort/store` (90), `src/effort` (53), `src/triage` (29), `src/commands/effort` (17), `src/start` (15), `src/tests` (12), `src/tests/core-coupled/effort/store` (11), `packages/rafa/src/effort/store/testdata` (4), `packages/rafa/src/core/runtime` (3), `packages/rafa/src/report` (3), `src/adapters/tracker` (3), `src/commands` (3), `src/commands/epic` (3), `src/effort/sync` (3), `src/docs` (2), `packages/rafa/src/commands/plan` (1), `packages/rafa/src/utils` (1), `src` (1), `src/board/project` (1), `src/claims` (1), `src/commands/claim` (1), `src/inventory/search` (1), `src/tests/core-coupled/core/runtime` (1), `src/tests/core-coupled/utils` (1) |
| `c03-index` | 247 | `src/commands/pr` (59), `src/next` (37), `src/pr` (25), `src/cli` (17), `src/pr/triage` (15), `src/commands` (13), `src/commands/update` (10), `src/tests` (9), `src/start` (7), `src/pr/plans` (5), `packages/rafa/src/project` (4), `src/board` (4), `src/cli/core` (4), `src/commands/module` (4), `src/epic` (3), `src/project` (3), `packages/rafa/src/next` (2), `src/commands/board` (2), `src/commands/effort` (2), `src/commands/instinct` (2), `src/status` (2), `src/tests/core-coupled/project` (2), `packages/rafa/src/core/command` (1), `packages/rafa/src/effort/store` (1), `packages/rafa/src/modules/testdata/seam-fixture` (1), `packages/rafa/src/schema` (1), `src` (1), `src/adapters/output` (1), `src/cleanup` (1), `src/commands/epic` (1), `src/commands/loop` (1), `src/commands/plan` (1), `src/commands/release` (1), `src/notices` (1), `src/release` (1), `src/tests/core-coupled/commands/plan` (1), `src/tests/core-coupled/next` (1), `src/tests/core-coupled/schema` (1) |
| `c04-cli-capture` | 244 | `src/tests` (82), `src/release` (68), `src/commands/release` (35), `src/start` (21), `src/commands/pr` (9), `src/commands` (7), `src/project` (5), `src` (2), `src/commands/bug` (2), `src/pr` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src/cli` (1), `src/commands/config` (1), `src/docs` (1), `src/effort` (1), `src/next` (1), `src/notices` (1), `src/tests/core-coupled/project` (1) |
| `c05-index` | 209 | `src/start` (110), `src/tests` (23), `src/commands/plan` (14), `src/suite` (13), `src/board` (10), `src/preflight` (7), `packages/rafa/src/core/plan` (6), `src/plan` (6), `packages/rafa/src/plan` (3), `src` (3), `packages/rafa/src/adapters/output` (2), `packages/rafa/src/utils` (2), `src/adapters/planner` (2), `packages/rafa/src/core/output` (1), `packages/rafa/src/ports` (1), `src/commands` (1), `src/notices` (1), `src/tests/core-coupled/plan` (1), `src/tests/core-coupled/utils` (1), `src/triage` (1), `src/utils` (1) |
| `c06-sections` | 200 | `src/commands` (18), `src/claims` (16), `src/inventory` (14), `src/schema` (13), `src/commands/claim` (12), `src/tests` (12), `src/tiers` (12), `src/commands/skill` (11), `src/inventory/search` (11), `src/backfill` (10), `src/demote` (10), `src/board` (8), `src/check` (8), `src/task` (8), `src/commands/agent` (7), `src/start` (6), `src/agents` (4), `src/commands/plan` (4), `packages/rafa/src/core/loop` (2), `packages/rafa/src/schema` (2), `src/effort` (2), `src/plan` (2), `src/status` (2), `src/utils` (2), `packages/rafa/src/core/config` (1), `packages/rafa/src/utils` (1), `src/commands/instinct` (1), `src/tests/core-coupled/utils` (1) |
| `c07-index` | 167 | `packages/rafa/src/core/config` (29), `src` (26), `packages/rafa/src/core/command` (16), `src/commands` (12), `src/config` (8), `src/effort/sync` (6), `src/tests` (6), `src/tests/core-coupled/core/config` (6), `src/commands/config` (5), `packages/rafa/src` (4), `packages/rafa/src/core/adapters` (4), `packages/rafa/src/core/output` (4), `packages/rafa/src/modules` (4), `src/release` (4), `src/tests/core-coupled` (4), `src/project` (3), `src/tests/core-coupled/effort/store` (3), `src/start` (2), `src/tests/core-coupled/core/output` (2), `src/utils` (2), `packages/rafa/src/adapters/logger` (1), `packages/rafa/src/core/git` (1), `packages/rafa/src/core/loop` (1), `packages/rafa/src/effort/store` (1), `packages/rafa/src/modules/testdata/hub-down-sync` (1), `packages/rafa/src/ports` (1), `src/board` (1), `src/cli` (1), `src/modules` (1), `src/modules/testdata/pull-merge-sync` (1), `src/preflight` (1), `src/suite` (1), `src/tests/core-coupled/core/command` (1), `src/tests/core-coupled/core/loop` (1), `src/tests/core-coupled/modules` (1), `src/tests/core-coupled/project` (1), `src/tiers` (1) |
| `c08-index` | 165 | `src/cleanup` (21), `src/commands/loop` (14), `src/pr` (14), `src/status` (13), `src/stretch` (13), `src/commands` (12), `src/tests` (11), `src/cli/prompt` (10), `src/board` (9), `src/commands/stretch` (8), `src/loop` (8), `src/ci` (7), `src/start` (4), `src/pr/triage` (3), `packages/rafa/src/core/loop` (2), `packages/rafa/src/project` (2), `packages/rafa/src/runtime` (2), `src` (2), `src/commands/ci` (2), `src/commands/pr` (2), `src/inventory` (2), `src/runtime` (2), `src/suite` (2) |
| `c09-index` | 91 | `src/adapters/tracker` (14), `src/learning` (10), `src/commands/issue` (9), `packages/rafa/src/adapters/logger` (8), `src/commands/instinct` (8), `src/tests` (8), `src/start` (7), `src/adapters/learning` (4), `src/docs` (3), `src/tests/core-coupled/adapters/logger` (3), `packages/rafa/src/ports` (2), `src/commands/docs` (2), `src/commands/release` (2), `src/report` (2), `src/schema` (2), `packages/rafa/src/modules/testdata/sync-fixture` (1), `src/adapters/output` (1), `src/cli` (1), `src/ports` (1), `src/project` (1), `src/tests/core-coupled/ports` (1), `src/tests/core-coupled/report` (1) |
| `c10-refresh` | 60 | `src/board/project` (38), `src/commands` (7), `src/commands/issue` (4), `src/tests` (3), `src/commands/board` (2), `src/commands/epic` (2), `src/commands/release` (2), `src/start` (2) |
| `c11-record` | 57 | `src/bugs` (12), `packages/rafa/src/bugs` (9), `src/triage` (8), `src/commands/bug` (7), `packages/rafa/src/errors` (6), `src/errors` (6), `src/tests/core-coupled/bugs` (3), `packages/rafa/src/errors/fixtures` (1), `packages/rafa/src/project` (1), `src/commands/issue` (1), `src/tests` (1), `src/tests/core-coupled/errors` (1), `src/tests/core-coupled/project` (1) |
| `c12-index` | 46 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `src/effort` (2), `packages/rafa-sync-service/src/testdata` (1), `packages/rafa/src/effort/store` (1), `src/effort/store` (1), `src/tests` (1) |
| `c13-sessions` | 29 | `packages/rafa/src/core/loop` (17), `packages/rafa/src/core/plan` (10), `packages/rafa/src/effort/store` (2) |
| `c14-sweep-timeout` | 28 | `src/tests` (20), `src/fixtures` (5), `src/commands` (1), `src/start` (1), `src/tests/core-coupled/effort/store` (1) |
| `c15-risk` | 15 | `src/plan/risk` (5), `packages/rafa/src/plan/risk` (4), `src/start` (3), `src/commands/plan` (2), `src/plan` (1) |
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
| 1 | `packages/rafa/src/ports/index.ts` | 62676.536072 | `c09-index` |
| 2 | `packages/rafa/src/effort/store/merge-store.ts` | 50801.184142 | `c02-sqlite` |
| 3 | `src/tests/cli-capture.ts` | 31161.054829 | `c04-cli-capture` |
| 4 | `packages/rafa/src/core/command/index.ts` | 24447.062558 | `c03-index` |
| 5 | `packages/rafa/src/core/config/index.ts` | 22545.730228 | `c07-index` |
| 6 | `src/adapters/tracker/github.ts` | 18357.113524 | `c01-github` |
| 7 | `src/commands/index.ts` | 17941.671333 | `c03-index` |
| 8 | `packages/rafa/src/core/loop/index.ts` | 16729.937348 | `c08-index` |
| 9 | `src/board/relations/labels.ts` | 15287.021626 | `c01-github` |
| 10 | `src/pr/index.ts` | 14593.056408 | `c03-index` |
| 11 | `src/board/setup.ts` | 14271.052719 | `c01-github` |
| 12 | `src/next/sources.ts` | 13235.441646 | `c03-index` |
| 13 | `src/board/roadmap.ts` | 13096.42801 | `c01-github` |
| 14 | `src/start/dispatch.ts` | 12874.756707 | `c05-index` |
| 15 | `src/project/scaffold.ts` | 12640.72992 | `c04-cli-capture` |
| 16 | `packages/rafa/src/core/config/scope.ts` | 12361.633095 | `c07-index` |
| 17 | `packages/rafa/src/core/config/config-load.ts` | 11701.24776 | `c07-index` |
| 18 | `src/board/gate.ts` | 10665.405839 | `c05-index` |
| 19 | `src/config-registry.ts` | 10471.133113 | `c07-index` |
| 20 | `packages/rafa/src/core/output/active.ts` | 10333.651818 | `c07-index` |
| 21 | `src/board/project/refresh.ts` | 10009.466626 | `c10-refresh` |
| 22 | `packages/rafa/src/effort/store/development-build.ts` | 9676.092152 | `c02-sqlite` |
| 23 | `packages/rafa/src/effort/store/sqlite.ts` | 9226.209068 | `c02-sqlite` |
| 24 | `packages/rafa/src/core/config/sections.ts` | 9099.164343 | `c06-sections` |
| 25 | `src/refs/extract.ts` | 8474.407085 | `c01-github` |
| 26 | `src/cli/dispatch.ts` | 8266.62778 | `c03-index` |
| 27 | `src/triage/triage.ts` | 8224.574128 | `c02-sqlite` |
| 28 | `src/board/issue.ts` | 8024.6855 | `c01-github` |
| 29 | `src/start/loop-events.ts` | 7962.19327 | `c05-index` |
| 30 | `src/start/suite-step.ts` | 7858.015188 | `c05-index` |
