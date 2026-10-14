# Import graph

Coverage: 1936 of 1936 tracked files read (src/ and packages/*/src/).

1936 files, 9927 edges (7764 value, 2163 type), 27 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 344 | `src/board` (110), `src/board/project` (41), `src/commands` (30), `src/commands/epic` (23), `src/tests` (23), `src/next` (22), `src/board/relations` (19), `src/commands/issue` (18), `src/commands/plan` (10), `src/status` (10), `src/commands/pr` (8), `src/core/git` (6), `src/claims` (4), `src/commands/board` (4), `src/pr` (3), `src/adapters/tracker` (2), `src/commands/release` (2), `src/project` (2), `src/start` (2), `src/suite` (2), `src/cleanup` (1), `src/epic` (1), `src/refs` (1) |
| `c02-sqlite` | 273 | `src/effort/store` (93), `src/effort` (57), `src/triage` (33), `src/commands/effort` (15), `src/start` (14), `src/tests` (13), `src/inventory/search` (10), `src/effort/sync` (5), `src/commands/epic` (4), `src/core/runtime` (4), `src/effort/store/testdata` (4), `src/commands` (3), `src/epic` (3), `src/report` (3), `src/utils` (3), `src/docs` (2), `src/fixtures` (2), `src` (1), `src/adapters/tracker` (1), `src/claims` (1), `src/commands/claim` (1), `src/runtime` (1) |
| `c03-index` | 245 | `src/commands/pr` (59), `src/release` (32), `src/pr` (30), `src/next` (23), `src/cleanup` (20), `src/pr/triage` (20), `src/commands` (12), `src/cli/prompt` (10), `src/commands/release` (10), `src/tests` (9), `src/start` (8), `src/pr/plans` (5), `src/inventory` (2), `src/release/strategies` (2), `src/status` (2), `src/board` (1) |
| `c04-sections` | 203 | `src/commands` (27), `src` (20), `src/core/config` (18), `src/release` (15), `src/tiers` (13), `src/inventory` (12), `src/start` (12), `src/plan/risk` (10), `src/tests` (9), `src/preflight` (8), `src/task` (8), `src/pr` (7), `src/schema` (6), `src/agents` (4), `src/check` (4), `src/effort/sync` (4), `src/utils` (4), `src/commands/agent` (3), `src/plan` (3), `src/project` (3), `src/board` (2), `src/effort` (2), `src/effort/store` (2), `src/inventory/search` (2), `src/commands/config` (1), `src/commands/skill` (1), `src/modules` (1), `src/notices` (1), `src/suite` (1) |
| `c05-index` | 197 | `src/start` (95), `src/tests` (20), `src/board` (13), `src/commands/plan` (12), `src/plan` (11), `src/core/loop` (10), `src/suite` (10), `src/core/plan` (9), `src/utils` (6), `src` (2), `src/adapters/planner` (2), `src/loop` (2), `src/core/output` (1), `src/notices` (1), `src/ports` (1), `src/release` (1), `src/triage` (1) |
| `c06-index` | 183 | `src/cli` (19), `src/project` (16), `src/claims` (13), `src/commands` (12), `src/start` (12), `src/commands/update` (10), `src/board` (8), `src/commands/claim` (8), `src/commands/loop` (8), `src/core/command` (8), `src/commands/plan` (7), `src/status` (7), `src/adapters/output` (5), `src/cli/core` (5), `src/tests` (5), `src/commands/agent` (4), `src/commands/module` (4), `src/commands/skill` (4), `src/commands/effort` (3), `src/core/loop` (3), `src/core/output` (3), `src/next` (3), `src/commands/epic` (2), `src/commands/pr` (2), `src/effort/sync` (2), `src/loop` (2), `src` (1), `src/commands/config` (1), `src/commands/instinct` (1), `src/core/config` (1), `src/inventory` (1), `src/modules` (1), `src/modules/testdata/seam-fixture` (1), `src/utils` (1) |
| `c07-cli-capture` | 156 | `src/tests` (88), `src/start` (17), `src/commands/loop` (7), `src/loop` (6), `src/release` (6), `src/commands` (4), `src/runtime` (4), `src` (3), `src/commands/release` (3), `src/project` (3), `src/utils` (3), `src/commands/pr` (2), `src/next` (2), `src/cleanup` (1), `src/commands/bug` (1), `src/commands/config` (1), `src/commands/effort` (1), `src/commands/skill` (1), `src/commands/stretch` (1), `src/core/loop` (1), `src/notices` (1) |
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
| 1 | `src/ports/index.ts` | 62212.153153 | `c08-index` |
| 2 | `src/core/config/index.ts` | 56798.234396 | `c04-sections` |
| 3 | `src/core/config/config-schema.ts` | 52584.866191 | `c04-sections` |
| 4 | `src/effort/store/merge-store.ts` | 51688.892453 | `c02-sqlite` |
| 5 | `src/tests/cli-capture.ts` | 26883.78776 | `c07-cli-capture` |
| 6 | `src/core/loop/index.ts` | 19283.149153 | `c07-cli-capture` |
| 7 | `src/adapters/tracker/github.ts` | 17552.217596 | `c01-github` |
| 8 | `src/project/scope.ts` | 16998.135522 | `c06-index` |
| 9 | `src/inventory/record.ts` | 16325.811092 | `c04-sections` |
| 10 | `src/core/command/index.ts` | 16322.422091 | `c06-index` |
| 11 | `src/tiers/routing.ts` | 15628.259885 | `c04-sections` |
| 12 | `src/config-schema-issues.ts` | 14804.24504 | `c09-frontmatter` |
| 13 | `src/tiers/resolve.ts` | 14346.908009 | `c04-sections` |
| 14 | `src/board/roadmap.ts` | 14308.65555 | `c01-github` |
| 15 | `src/core/adapters/index.ts` | 14272.000296 | `c08-index` |
| 16 | `src/pr/index.ts` | 14093.77567 | `c03-index` |
| 17 | `src/core/adapters/registry.ts` | 13992.666963 | `c08-index` |
| 18 | `src/commands/index.ts` | 13749.986479 | `c06-index` |
| 19 | `src/effort/store/development-build.ts` | 12921.596942 | `c02-sqlite` |
| 20 | `src/core/command/command.ts` | 12821.00762 | `c06-index` |
| 21 | `src/board/relations/labels.ts` | 12107.102568 | `c01-github` |
| 22 | `src/start/dispatch.ts` | 11850.540348 | `c05-index` |
| 23 | `src/next/sources.ts` | 11431.182145 | `c01-github` |
| 24 | `src/core/loop/sessions.ts` | 11308.834045 | `c05-index` |
| 25 | `src/effort/store/sqlite.ts` | 11110.811355 | `c02-sqlite` |
| 26 | `src/board/setup.ts` | 10992.545618 | `c01-github` |
| 27 | `src/cli/dispatch.ts` | 10390.667876 | `c06-index` |
| 28 | `src/start/loop-events.ts` | 9968.603647 | `c05-index` |
| 29 | `src/check/run.ts` | 9942.685911 | `c09-frontmatter` |
| 30 | `src/bugs/record.ts` | 9339.148485 | `c09-frontmatter` |
