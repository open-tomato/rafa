# Import graph

Coverage: 1843 of 1843 tracked files read (src/ and packages/*/src/).

1843 files, 9340 edges (7299 value, 2041 type), 38 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 302 | `src/board` (121), `src/tests` (30), `src/commands` (24), `src/commands/epic` (24), `src/commands/issue` (20), `src/board/relations` (19), `src/commands/plan` (10), `src/next` (9), `src/status` (9), `src/board/project` (8), `src/commands/pr` (6), `src/claims` (5), `src/project` (4), `src/suite` (4), `src/pr` (3), `src/adapters/tracker` (2), `src/commands/board` (2), `src` (1), `src/core/git` (1) |
| `c02-index` | 224 | `src/commands/pr` (59), `src/release` (42), `src/next` (33), `src/pr` (25), `src/pr/triage` (18), `src/commands/release` (12), `src/start` (10), `src/tests` (9), `src/commands` (5), `src/pr/plans` (5), `src/board` (2), `src/epic` (2), `src/release/strategies` (2) |
| `c03-index` | 212 | `src/start` (103), `src/tests` (28), `src/commands/plan` (12), `src/core/loop` (11), `src/board` (9), `src/core/plan` (9), `src/suite` (9), `src/plan` (8), `src/utils` (7), `src/loop` (4), `src` (3), `src/adapters/planner` (2), `src/epic` (2), `src/cleanup` (1), `src/commands/stretch` (1), `src/core/output` (1), `src/notices` (1), `src/ports` (1) |
| `c04-sqlite` | 212 | `src/effort/store` (85), `src/effort` (53), `src/tests` (18), `src/commands/effort` (14), `src/inventory/search` (10), `src/effort/sync` (5), `src/fixtures` (5), `src/triage` (5), `src/effort/store/testdata` (4), `src/report` (3), `src/utils` (3), `src/commands` (2), `src/runtime` (2), `src/claims` (1), `src/commands/claim` (1), `src/start` (1) |
| `c05-index` | 188 | `src/commands` (33), `src` (22), `src/tiers` (13), `src/inventory` (12), `src/tests` (10), `src/core/config` (9), `src/plan/risk` (8), `src/preflight` (8), `src/project` (8), `src/start` (8), `src/task` (8), `src/release` (6), `src/pr` (5), `src/schema` (5), `src/agents` (4), `src/check` (4), `src/effort/sync` (4), `src/plan` (4), `src/utils` (4), `src/commands/agent` (3), `src/effort` (2), `src/inventory/search` (2), `src/runtime` (2), `src/board` (1), `src/commands/skill` (1), `src/effort/store` (1), `src/modules` (1) |
| `c06-index` | 177 | `src/cli` (17), `src/commands/loop` (15), `src/claims` (12), `src/commands/update` (10), `src/project` (10), `src/tests` (10), `src/status` (9), `src/commands` (8), `src/commands/claim` (8), `src/commands/plan` (7), `src/core/command` (6), `src/loop` (6), `src/next` (6), `src/start` (6), `src/cli/core` (5), `src/commands/skill` (5), `src/board` (4), `src/commands/agent` (4), `src/commands/effort` (4), `src/commands/module` (4), `src/adapters/output` (3), `src/commands/issue` (3), `src/commands/epic` (2), `src/core/output` (2), `src/effort/sync` (2), `src` (1), `src/commands/config` (1), `src/commands/instinct` (1), `src/commands/pr` (1), `src/core/config` (1), `src/core/loop` (1), `src/inventory` (1), `src/modules` (1), `src/modules/testdata/seam-fixture` (1) |
| `c07-cli-capture` | 140 | `src/tests` (62), `src/cleanup` (18), `src/start` (11), `src/cli/prompt` (10), `src/commands` (9), `src/pr` (7), `src/release` (6), `src/commands/pr` (2), `src/inventory` (2), `src/notices` (2), `src/pr/triage` (2), `src/project` (2), `src/commands/config` (1), `src/commands/effort` (1), `src/commands/release` (1), `src/next` (1), `src/schema` (1), `src/status` (1), `src/utils` (1) |
| `c08-index` | 138 | `src/triage` (16), `src/adapters/tracker` (13), `src/adapters/logger` (12), `src/commands/issue` (12), `src/bugs` (11), `src/learning` (10), `src/commands/instinct` (9), `src/start` (8), `src/errors` (6), `src/tests` (6), `src` (4), `src/adapters/learning` (4), `src/adapters/output` (4), `src/core/adapters` (4), `src/project` (3), `src/report` (3), `src/schema` (3), `src/commands/bug` (2), `src/modules` (2), `src/cli` (1), `src/commands/epic` (1), `src/modules/testdata/hub-down-sync` (1), `src/modules/testdata/pull-merge-sync` (1), `src/modules/testdata/sync-fixture` (1), `src/ports` (1) |
| `c09-port` | 51 | `src/board/project` (33), `src/commands` (7), `src/tests` (3), `src/commands/board` (2), `src/commands/issue` (2), `src/commands/release` (2), `src/start` (2) |
| `c10-verify` | 51 | `src/refs` (13), `src/core/config` (9), `src/core/git` (5), `src/tests` (5), `src/cli` (3), `src/commands` (3), `src/board` (2), `src/commands/issue` (2), `src/commands/plan` (2), `src/core/command` (2), `src/core/loop` (2), `src/triage` (2), `src/core/output` (1) |
| `c11-frontmatter` | 47 | `src/backfill` (10), `src/demote` (10), `src/schema` (10), `src/commands/skill` (5), `src/check` (4), `src/tests` (4), `src/commands` (2), `src/commands/instinct` (1), `src/inventory` (1) |
| `c12-index` | 42 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1) |
| `c13-start` | 33 | `src/stretch` (13), `src/ci` (7), `src/commands/stretch` (7), `src` (2), `src/commands` (2), `src/commands/ci` (2) |
| `c14-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c15-types.test` | 1 | `src/cli/core` (1) |
| `c16-config-schema-readings` | 1 | `src` (1) |
| `c17-store-sources.sweep.test` | 1 | `src/effort/store` (1) |
| `c18-agent-gates.test` | 1 | `src/tests` (1) |
| `c19-agents-split-accounting.test` | 1 | `src/tests` (1) |
| `c20-commands-direction.sweep.test` | 1 | `src/tests` (1) |
| `c21-context-page-imports.sweep.test` | 1 | `src/tests` (1) |
| `c22-core-barrels.sweep.test` | 1 | `src/tests` (1) |
| `c23-entry-exports.test` | 1 | `src/tests` (1) |
| `c24-epic-guard-workflow.test` | 1 | `src/tests` (1) |
| `c25-eslint-stand-in` | 1 | `src/tests` (1) |
| `c26-git-identity.sweep.test` | 1 | `src/tests` (1) |
| `c27-import-cycle.sweep.test` | 1 | `src/tests` (1) |
| `c28-learning-boundary.test` | 1 | `src/tests` (1) |
| `c29-relations-import-boundary.sweep.test` | 1 | `src/tests` (1) |
| `c30-repo-hygiene.sweep.test` | 1 | `src/tests` (1) |
| `c31-routing-table-agents.sweep.test` | 1 | `src/tests` (1) |
| `c32-skill-gap-section.test` | 1 | `src/tests` (1) |
| `c33-spawned-exit-code.sweep.test` | 1 | `src/tests` (1) |
| `c34-sweep-suffix.sweep.test` | 1 | `src/tests` (1) |
| `c35-verify-workflow.test` | 1 | `src/tests` (1) |
| `c36-workflow-permission-section.sweep.test` | 1 | `src/tests` (1) |
| `c37-cli.test` | 1 | `src/tools/ts-symbols` (1) |
| `c38-cli` | 1 | `src/tools/ts-symbols` (1) |

## The 30 files of highest betweenness

| Rank | File | Betweenness | Cluster |
| --- | --- | --- | --- |
| 1 | `src/ports/index.ts` | 58651.643329 | `c08-index` |
| 2 | `src/core/config/index.ts` | 54304.200089 | `c05-index` |
| 3 | `src/core/config/config-schema.ts` | 50317.376434 | `c05-index` |
| 4 | `src/effort/store/merge-store.ts` | 48369.635226 | `c04-sqlite` |
| 5 | `src/tests/cli-capture.ts` | 25414.839318 | `c07-cli-capture` |
| 6 | `src/core/loop/index.ts` | 18455.22972 | `c03-index` |
| 7 | `src/project/scope.ts` | 16533.600474 | `c06-index` |
| 8 | `src/core/command/index.ts` | 15733.069863 | `c06-index` |
| 9 | `src/adapters/tracker/github.ts` | 15685.640438 | `c01-github` |
| 10 | `src/inventory/record.ts` | 15584.343234 | `c05-index` |
| 11 | `src/tiers/routing.ts` | 14860.955206 | `c05-index` |
| 12 | `src/config-schema-issues.ts` | 14290.611519 | `c08-index` |
| 13 | `src/board/roadmap.ts` | 13595.683314 | `c01-github` |
| 14 | `src/tiers/resolve.ts` | 13551.141342 | `c05-index` |
| 15 | `src/core/adapters/index.ts` | 13096.766772 | `c08-index` |
| 16 | `src/core/adapters/registry.ts` | 12840.933439 | `c08-index` |
| 17 | `src/core/command/command.ts` | 12414.087826 | `c10-verify` |
| 18 | `src/commands/index.ts` | 12349.446495 | `c06-index` |
| 19 | `src/pr/index.ts` | 12248.377636 | `c02-index` |
| 20 | `src/effort/store/development-build.ts` | 12063.965912 | `c04-sqlite` |
| 21 | `src/core/loop/sessions.ts` | 10914.986332 | `c03-index` |
| 22 | `src/board/relations/labels.ts` | 9804.519303 | `c01-github` |
| 23 | `src/board/setup.ts` | 9737.25679 | `c01-github` |
| 24 | `src/cli/dispatch.ts` | 9714.746853 | `c06-index` |
| 25 | `src/check/run.ts` | 9635.156149 | `c11-frontmatter` |
| 26 | `src/effort/store/sqlite.ts` | 9539.089545 | `c04-sqlite` |
| 27 | `src/bugs/record.ts` | 9085.681818 | `c08-index` |
| 28 | `src/start/dispatch.ts` | 9069.283905 | `c03-index` |
| 29 | `src/board/project/refresh.ts` | 8782.63826 | `c09-port` |
| 30 | `src/next/sources.ts` | 8433.73508 | `c02-index` |
