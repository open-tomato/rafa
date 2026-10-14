# Import graph

Coverage: 1947 of 1947 tracked files read (src/ and packages/*/src/).

1947 files, 9955 edges (7789 value, 2166 type), 27 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 344 | `src/board` (110), `src/board/project` (41), `src/commands` (30), `src/commands/epic` (23), `src/tests` (23), `src/next` (22), `src/board/relations` (19), `src/commands/issue` (18), `src/commands/plan` (10), `src/status` (10), `src/commands/pr` (8), `src/core/git` (6), `src/claims` (4), `src/commands/board` (4), `src/pr` (3), `src/adapters/tracker` (2), `src/commands/release` (2), `src/project` (2), `src/start` (2), `src/suite` (2), `src/cleanup` (1), `src/epic` (1), `src/refs` (1) |
| `c02-sqlite` | 285 | `src/effort/store` (107), `src/effort` (57), `src/triage` (32), `src/commands/effort` (15), `src/start` (14), `src/tests` (14), `src/inventory/search` (10), `src/commands/epic` (4), `src/core/runtime` (4), `src/effort/store/testdata` (4), `src/commands` (3), `src/effort/sync` (3), `src/epic` (3), `src/report` (3), `src/utils` (3), `src/docs` (2), `src/fixtures` (2), `src` (1), `src/adapters/tracker` (1), `src/claims` (1), `src/commands/claim` (1), `src/runtime` (1) |
| `c03-cli-capture` | 212 | `src/tests` (88), `src/release` (38), `src/start` (17), `src/commands/release` (13), `src/commands/pr` (9), `src/commands/loop` (7), `src/loop` (6), `src/commands` (5), `src/runtime` (4), `src` (3), `src/project` (3), `src/utils` (3), `src/next` (2), `src/pr` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src/cleanup` (1), `src/commands/bug` (1), `src/commands/config` (1), `src/commands/effort` (1), `src/commands/skill` (1), `src/commands/stretch` (1), `src/core/loop` (1), `src/notices` (1) |
| `c04-sections` | 202 | `src/commands` (27), `src` (20), `src/core/config` (18), `src/release` (15), `src/tiers` (13), `src/inventory` (12), `src/start` (12), `src/plan/risk` (10), `src/tests` (9), `src/preflight` (8), `src/task` (8), `src/pr` (7), `src/schema` (6), `src/agents` (4), `src/check` (4), `src/effort/sync` (4), `src/utils` (4), `src/commands/agent` (3), `src/plan` (3), `src/project` (3), `src/board` (2), `src/effort` (2), `src/inventory/search` (2), `src/commands/config` (1), `src/commands/skill` (1), `src/effort/store` (1), `src/modules` (1), `src/notices` (1), `src/suite` (1) |
| `c05-index` | 197 | `src/start` (95), `src/tests` (20), `src/board` (13), `src/commands/plan` (12), `src/plan` (11), `src/core/loop` (10), `src/suite` (10), `src/core/plan` (9), `src/utils` (6), `src` (2), `src/adapters/planner` (2), `src/loop` (2), `src/core/output` (1), `src/notices` (1), `src/ports` (1), `src/release` (1), `src/triage` (1) |
| `c06-index` | 189 | `src/commands/pr` (52), `src/pr` (28), `src/next` (23), `src/cleanup` (20), `src/pr/triage` (18), `src/commands` (11), `src/cli/prompt` (10), `src/tests` (9), `src/start` (8), `src/pr/plans` (5), `src/inventory` (2), `src/status` (2), `src/board` (1) |
| `c07-index` | 183 | `src/cli` (19), `src/project` (16), `src/claims` (13), `src/commands` (12), `src/start` (12), `src/commands/update` (10), `src/board` (8), `src/commands/claim` (8), `src/commands/loop` (8), `src/core/command` (8), `src/commands/plan` (7), `src/status` (7), `src/adapters/output` (5), `src/cli/core` (5), `src/tests` (5), `src/commands/agent` (4), `src/commands/module` (4), `src/commands/skill` (4), `src/commands/effort` (3), `src/core/loop` (3), `src/core/output` (3), `src/next` (3), `src/commands/epic` (2), `src/commands/pr` (2), `src/effort/sync` (2), `src/loop` (2), `src` (1), `src/commands/config` (1), `src/commands/instinct` (1), `src/core/config` (1), `src/inventory` (1), `src/modules` (1), `src/modules/testdata/seam-fixture` (1), `src/utils` (1) |
| `c08-index` | 124 | `src/commands/issue` (20), `src/adapters/tracker` (14), `src/adapters/logger` (12), `src/start` (12), `src/learning` (10), `src/commands/instinct` (9), `src/tests` (9), `src/adapters/learning` (4), `src/core/adapters` (4), `src/docs` (4), `src/report` (3), `src/schema` (3), `src/adapters/output` (2), `src/board` (2), `src/commands/docs` (2), `src/commands/release` (2), `src/modules` (2), `src/pr` (2), `src/triage` (2), `src/cli` (1), `src/modules/testdata/hub-down-sync` (1), `src/modules/testdata/pull-merge-sync` (1), `src/modules/testdata/sync-fixture` (1), `src/ports` (1), `src/project` (1) |
| `c09-frontmatter` | 73 | `src/bugs` (11), `src/backfill` (10), `src/demote` (10), `src/schema` (10), `src/errors` (6), `src/commands/skill` (5), `src/tests` (5), `src` (4), `src/check` (4), `src/commands` (2), `src/project` (2), `src/commands/bug` (1), `src/commands/instinct` (1), `src/commands/issue` (1), `src/inventory` (1) |
| `c10-index` | 42 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1) |
| `c11-start` | 33 | `src/stretch` (13), `src/ci` (7), `src/commands/stretch` (7), `src` (2), `src/commands` (2), `src/commands/ci` (2) |
| `c12-verify` | 29 | `src/refs` (12), `src/tests` (4), `src/board` (3), `src/commands` (3), `src/commands/issue` (2), `src/commands/plan` (2), `src/triage` (2), `src/cli` (1) |
| `c13-sweep-timeout` | 19 | `src/tests` (13), `src/fixtures` (3), `src/commands` (1), `src/effort/store` (1), `src/start` (1) |
| `c14-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c15-types.test` | 1 | `src/cli/core` (1) |
| `c16-config-schema-readings` | 1 | `src` (1) |
| `c17-agent-gates.test` | 1 | `src/tests` (1) |
| `c18-agents-split-accounting.test` | 1 | `src/tests` (1) |
| `c19-cut-table-shape.test` | 1 | `src/tests` (1) |
| `c20-entry-exports.test` | 1 | `src/tests` (1) |
| `c21-epic-guard-workflow.test` | 1 | `src/tests` (1) |
| `c22-eslint-stand-in` | 1 | `src/tests` (1) |
| `c23-learning-boundary.test` | 1 | `src/tests` (1) |
| `c24-skill-gap-section.test` | 1 | `src/tests` (1) |
| `c25-verify-workflow.test` | 1 | `src/tests` (1) |
| `c26-cli.test` | 1 | `src/tools/ts-symbols` (1) |
| `c27-cli` | 1 | `src/tools/ts-symbols` (1) |

## The 30 files of highest betweenness

| Rank | File | Betweenness | Cluster |
| --- | --- | --- | --- |
| 1 | `src/ports/index.ts` | 61098.780141 | `c08-index` |
| 2 | `src/core/config/index.ts` | 57442.126601 | `c04-sections` |
| 3 | `src/core/config/config-schema.ts` | 53097.045847 | `c04-sections` |
| 4 | `src/effort/store/merge-store.ts` | 52556.640122 | `c02-sqlite` |
| 5 | `src/tests/cli-capture.ts` | 26625.084246 | `c03-cli-capture` |
| 6 | `src/core/loop/index.ts` | 20679.327357 | `c03-cli-capture` |
| 7 | `src/core/command/index.ts` | 17513.259573 | `c07-index` |
| 8 | `src/adapters/tracker/github.ts` | 17252.339883 | `c01-github` |
| 9 | `src/inventory/record.ts` | 16339.811092 | `c04-sections` |
| 10 | `src/effort/store/development-build.ts` | 15899.482207 | `c02-sqlite` |
| 11 | `src/tiers/routing.ts` | 15665.463731 | `c04-sections` |
| 12 | `src/config-schema-issues.ts` | 14848.501268 | `c09-frontmatter` |
| 13 | `src/board/roadmap.ts` | 14494.324786 | `c01-github` |
| 14 | `src/pr/index.ts` | 14492.583695 | `c06-index` |
| 15 | `src/tiers/resolve.ts` | 14385.250866 | `c04-sections` |
| 16 | `src/core/adapters/index.ts` | 14349.777108 | `c08-index` |
| 17 | `src/core/command/command.ts` | 14070.565553 | `c07-index` |
| 18 | `src/core/adapters/registry.ts` | 14070.443775 | `c08-index` |
| 19 | `src/commands/index.ts` | 13882.558172 | `c07-index` |
| 20 | `src/project/scope.ts` | 13389.15918 | `c07-index` |
| 21 | `src/core/loop/sessions.ts` | 12695.200499 | `c05-index` |
| 22 | `src/board/relations/labels.ts` | 12394.211447 | `c01-github` |
| 23 | `src/start/dispatch.ts` | 11994.061349 | `c05-index` |
| 24 | `src/board/setup.ts` | 11779.699133 | `c01-github` |
| 25 | `src/next/sources.ts` | 11513.237942 | `c01-github` |
| 26 | `src/effort/store/sqlite.ts` | 10618.128497 | `c02-sqlite` |
| 27 | `src/start/loop-events.ts` | 10441.1837 | `c05-index` |
| 28 | `src/cli/dispatch.ts` | 10213.185193 | `c07-index` |
| 29 | `src/check/run.ts` | 9975.019244 | `c09-frontmatter` |
| 30 | `src/bugs/record.ts` | 9370.984199 | `c09-frontmatter` |
