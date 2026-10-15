# Import graph

Coverage: 1977 of 1977 tracked files read (src/ and packages/*/src/).

1977 files, 10130 edges (7909 value, 2221 type), 28 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 307 | `src/board` (117), `src/commands/epic` (27), `src/commands` (24), `src/tests` (24), `src/board/relations` (19), `src/commands/issue` (18), `src/next` (14), `src/commands/plan` (10), `src/board/project` (8), `src/commands/pr` (8), `src/status` (8), `src/core/git` (6), `src/claims` (5), `src/epic` (4), `src/suite` (4), `src/pr` (3), `src/adapters/tracker` (2), `src/commands/board` (2), `src/project` (2), `src/triage` (2) |
| `c02-sqlite` | 281 | `src/effort/store` (106), `src/effort` (57), `src/triage` (32), `src/start` (16), `src/commands/effort` (15), `src/tests` (14), `src/inventory/search` (10), `src/core/runtime` (4), `src/effort/store/testdata` (4), `src/commands` (3), `src/effort/sync` (3), `src/report` (3), `src/utils` (3), `src/adapters/tracker` (2), `src/commands/epic` (2), `src/docs` (2), `src/fixtures` (2), `src/claims` (1), `src/commands/claim` (1), `src/runtime` (1) |
| `c03-index` | 245 | `src/commands/pr` (42), `src/next` (32), `src/start` (19), `src/cli` (17), `src/commands` (15), `src/claims` (12), `src/project` (11), `src/commands/update` (10), `src/status` (9), `src/commands/claim` (8), `src/commands/loop` (8), `src/commands/plan` (7), `src/pr` (7), `src/core/command` (6), `src/tests` (6), `src/board` (5), `src/commands/agent` (4), `src/commands/module` (4), `src/commands/skill` (4), `src/commands/effort` (3), `src/commands/config` (2), `src/effort/sync` (2), `src/loop` (2), `src/runtime` (2), `src` (1), `src/commands/instinct` (1), `src/core/config` (1), `src/core/loop` (1), `src/inventory` (1), `src/modules` (1), `src/modules/testdata/seam-fixture` (1), `src/utils` (1) |
| `c04-cli-capture` | 238 | `src/tests` (88), `src/release` (50), `src/start` (22), `src/commands/release` (13), `src/core/loop` (9), `src/loop` (8), `src/commands/loop` (7), `src/commands/pr` (7), `src/commands` (5), `src/next` (4), `src/project` (4), `src/utils` (3), `src` (2), `src/pr` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src/runtime` (2), `src/cleanup` (1), `src/commands/bug` (1), `src/commands/config` (1), `src/commands/effort` (1), `src/commands/skill` (1), `src/commands/stretch` (1), `src/docs` (1), `src/notices` (1) |
| `c05-index` | 220 | `src/commands` (30), `src/core/config` (27), `src` (26), `src/tiers` (13), `src/inventory` (12), `src/plan/risk` (10), `src/tests` (9), `src/project` (8), `src/task` (8), `src/pr` (7), `src/preflight` (7), `src/start` (7), `src/config` (6), `src/schema` (6), `src/agents` (4), `src/check` (4), `src/effort/sync` (4), `src/release` (4), `src/utils` (4), `src/commands/agent` (3), `src/plan` (3), `src/board` (2), `src/commands/config` (2), `src/core/command` (2), `src/core/loop` (2), `src/effort` (2), `src/effort/store` (2), `src/inventory/search` (2), `src/commands/skill` (1), `src/core/output` (1), `src/modules` (1), `src/notices` (1) |
| `c06-index` | 183 | `src/start` (94), `src/tests` (21), `src/commands/plan` (12), `src/plan` (11), `src/board` (10), `src/core/plan` (9), `src/suite` (9), `src/utils` (6), `src` (2), `src/adapters/planner` (2), `src/core/loop` (2), `src/core/output` (1), `src/notices` (1), `src/ports` (1), `src/preflight` (1), `src/triage` (1) |
| `c07-index` | 129 | `src/commands/issue` (18), `src/adapters/tracker` (13), `src/adapters/logger` (12), `src/start` (12), `src/learning` (10), `src/commands/instinct` (9), `src/tests` (8), `src/adapters/output` (6), `src/cli/core` (5), `src/core/output` (5), `src/adapters/learning` (4), `src/core/adapters` (4), `src/docs` (3), `src/report` (3), `src/schema` (3), `src/board` (2), `src/commands/docs` (2), `src/commands/release` (2), `src/modules` (2), `src/ports` (2), `src/cli` (1), `src/modules/testdata/hub-down-sync` (1), `src/modules/testdata/pull-merge-sync` (1), `src/modules/testdata/sync-fixture` (1) |
| `c08-types` | 111 | `src/pr` (23), `src/cleanup` (21), `src/pr/triage` (18), `src/commands/pr` (16), `src/cli/prompt` (10), `src/tests` (7), `src/commands` (6), `src/pr/plans` (5), `src/inventory` (2), `src/status` (2), `src/board` (1) |
| `c09-frontmatter` | 71 | `src/bugs` (11), `src/backfill` (10), `src/demote` (10), `src/schema` (10), `src/errors` (6), `src/commands/skill` (5), `src/tests` (5), `src/check` (4), `src` (2), `src/commands` (2), `src/project` (2), `src/commands/bug` (1), `src/commands/instinct` (1), `src/commands/issue` (1), `src/inventory` (1) |
| `c10-port` | 51 | `src/board/project` (33), `src/commands` (7), `src/tests` (3), `src/commands/board` (2), `src/commands/issue` (2), `src/commands/release` (2), `src/start` (2) |
| `c11-index` | 42 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1) |
| `c12-start` | 33 | `src/stretch` (13), `src/ci` (7), `src/commands/stretch` (7), `src` (2), `src/commands` (2), `src/commands/ci` (2) |
| `c13-verify` | 32 | `src/refs` (13), `src/tests` (5), `src/cli` (3), `src/commands` (3), `src/board` (2), `src/commands/issue` (2), `src/commands/plan` (2), `src/triage` (2) |
| `c14-sweep-timeout` | 19 | `src/tests` (13), `src/fixtures` (3), `src/commands` (1), `src/effort/store` (1), `src/start` (1) |
| `c15-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c16-types.test` | 1 | `src/cli/core` (1) |
| `c17-config-schema-readings` | 1 | `src` (1) |
| `c18-agent-gates.test` | 1 | `src/tests` (1) |
| `c19-agents-split-accounting.test` | 1 | `src/tests` (1) |
| `c20-cut-table-shape.test` | 1 | `src/tests` (1) |
| `c21-entry-exports.test` | 1 | `src/tests` (1) |
| `c22-epic-guard-workflow.test` | 1 | `src/tests` (1) |
| `c23-eslint-stand-in` | 1 | `src/tests` (1) |
| `c24-learning-boundary.test` | 1 | `src/tests` (1) |
| `c25-skill-gap-section.test` | 1 | `src/tests` (1) |
| `c26-verify-workflow.test` | 1 | `src/tests` (1) |
| `c27-cli.test` | 1 | `src/tools/ts-symbols` (1) |
| `c28-cli` | 1 | `src/tools/ts-symbols` (1) |

## The 30 files of highest betweenness

| Rank | File | Betweenness | Cluster |
| --- | --- | --- | --- |
| 1 | `src/ports/index.ts` | 60858.773809 | `c07-index` |
| 2 | `src/effort/store/merge-store.ts` | 50614.161867 | `c02-sqlite` |
| 3 | `src/tests/cli-capture.ts` | 28614.372279 | `c04-cli-capture` |
| 4 | `src/core/config/index.ts` | 25591.052213 | `c05-index` |
| 5 | `src/config-registry.ts` | 24715.067907 | `c05-index` |
| 6 | `src/core/loop/index.ts` | 20928.074785 | `c04-cli-capture` |
| 7 | `src/inventory/record.ts` | 18852.989663 | `c05-index` |
| 8 | `src/board/roadmap.ts` | 18822.443672 | `c01-github` |
| 9 | `src/core/command/index.ts` | 18584.218565 | `c03-index` |
| 10 | `src/tiers/routing.ts` | 18350.539395 | `c05-index` |
| 11 | `src/adapters/tracker/github.ts` | 17758.372534 | `c01-github` |
| 12 | `src/tiers/resolve.ts` | 17283.499226 | `c05-index` |
| 13 | `src/core/config/core-section.ts` | 16575.487889 | `c05-index` |
| 14 | `src/core/command/command.ts` | 15118.151199 | `c05-index` |
| 15 | `src/commands/index.ts` | 14733.601009 | `c03-index` |
| 16 | `src/core/adapters/index.ts` | 13988.470447 | `c07-index` |
| 17 | `src/core/adapters/registry.ts` | 13642.30378 | `c07-index` |
| 18 | `src/pr/index.ts` | 13207.540306 | `c03-index` |
| 19 | `src/effort/store/development-build.ts` | 12865.011897 | `c02-sqlite` |
| 20 | `src/board/relations/labels.ts` | 12472.746595 | `c01-github` |
| 21 | `src/start/dispatch.ts` | 12469.943583 | `c06-index` |
| 22 | `src/core/loop/sessions.ts` | 12303.650108 | `c04-cli-capture` |
| 23 | `src/board/setup.ts` | 12282.375635 | `c01-github` |
| 24 | `src/check/run.ts` | 12243.713292 | `c09-frontmatter` |
| 25 | `src/next/sources.ts` | 11756.266547 | `c01-github` |
| 26 | `src/start/loop-events.ts` | 11315.225944 | `c06-index` |
| 27 | `src/project/scope.ts` | 10562.978075 | `c03-index` |
| 28 | `src/config-schema-issues.ts` | 10478.426691 | `c09-frontmatter` |
| 29 | `src/cli/dispatch.ts` | 10459.055609 | `c03-index` |
| 30 | `src/project/scaffold.ts` | 10143.4742 | `c04-cli-capture` |

## Unresolved imports

- `src/tests/package-build.test.ts`: `${DEFINE_CONFIG}`
