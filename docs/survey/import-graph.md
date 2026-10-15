# Import graph

Coverage: 2001 of 2001 tracked files read (src/ and packages/*/src/).

2001 files, 10377 edges (8142 value, 2235 type), 26 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 384 | `src/board` (120), `src/board/project` (41), `src/tests` (32), `src/commands` (31), `src/commands/issue` (27), `src/commands/epic` (25), `src/board/relations` (19), `src/next` (16), `src/pr` (13), `src/status` (11), `src/commands/plan` (10), `src/commands/pr` (6), `src/start` (5), `src/claims` (4), `src/commands/board` (4), `src/epic` (4), `src/suite` (4), `src/project` (3), `src/adapters/tracker` (2), `src/commands/release` (2), `src/cleanup` (1), `src/core/config` (1), `src/core/git` (1), `src/pr/triage` (1), `src/refs` (1) |
| `c02-index` | 307 | `src/start` (121), `src/triage` (23), `src/tests` (22), `src/adapters/tracker` (15), `src/adapters/logger` (12), `src/bugs` (11), `src/commands/issue` (10), `src/learning` (10), `src/commands/instinct` (9), `src/suite` (9), `src/core/output` (7), `src/utils` (6), `src/adapters/output` (5), `src/docs` (5), `src/task` (5), `src/adapters/learning` (4), `src/core/adapters` (4), `src/report` (3), `src/schema` (3), `src` (2), `src/commands/docs` (2), `src/commands/release` (2), `src/fixtures` (2), `src/ports` (2), `src/project` (2), `src/cli` (1), `src/commands/epic` (1), `src/commands/plan` (1), `src/core/git` (1), `src/core/plan` (1), `src/modules` (1), `src/modules/testdata/hub-down-sync` (1), `src/modules/testdata/pull-merge-sync` (1), `src/modules/testdata/sync-fixture` (1), `src/notices` (1), `src/preflight` (1) |
| `c03-index` | 270 | `src/commands/pr` (45), `src/next` (32), `src/cli` (17), `src/commands` (16), `src/project` (16), `src/start` (16), `src/tests` (14), `src/claims` (13), `src/commands/update` (10), `src/commands/claim` (8), `src/commands/loop` (8), `src/pr` (8), `src/board` (7), `src/commands/plan` (7), `src/status` (7), `src/cli/core` (5), `src/commands/agent` (5), `src/commands/skill` (5), `src/commands/module` (4), `src/commands/config` (3), `src/commands/effort` (3), `src/utils` (3), `src` (2), `src/commands/epic` (2), `src/commands/issue` (2), `src/effort/sync` (2), `src/loop` (2), `src/adapters/output` (1), `src/commands/instinct` (1), `src/core/command` (1), `src/core/config` (1), `src/core/loop` (1), `src/inventory` (1), `src/modules` (1), `src/modules/testdata/seam-fixture` (1) |
| `c04-sqlite` | 230 | `src/effort/store` (106), `src/effort` (57), `src/commands/effort` (15), `src/tests` (13), `src/triage` (12), `src/core/runtime` (4), `src/effort/store/testdata` (4), `src/commands` (3), `src/effort/sync` (3), `src/report` (3), `src/start` (2), `src/utils` (2), `src/claims` (1), `src/commands/claim` (1), `src/commands/epic` (1), `src/docs` (1), `src/inventory/search` (1), `src/runtime` (1) |
| `c05-cli-capture` | 217 | `src/tests` (83), `src/release` (48), `src/start` (23), `src/commands/release` (13), `src/commands/loop` (7), `src/commands/pr` (7), `src/loop` (6), `src/commands` (5), `src/runtime` (4), `src/project` (3), `src` (2), `src/next` (2), `src/notices` (2), `src/pr` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src/cleanup` (1), `src/commands/effort` (1), `src/commands/skill` (1), `src/commands/stretch` (1), `src/core/loop` (1), `src/utils` (1) |
| `c06-frontmatter` | 161 | `src/commands` (25), `src/schema` (15), `src/inventory` (13), `src/inventory/search` (11), `src/backfill` (10), `src/demote` (10), `src/plan/risk` (10), `src/tests` (10), `src/tiers` (9), `src/check` (8), `src/pr` (7), `src/preflight` (6), `src/commands/skill` (5), `src/agents` (4), `src/plan` (4), `src/task` (3), `src/utils` (3), `src/commands/agent` (2), `src/core/loop` (2), `src/effort` (2), `src/commands/instinct` (1), `src/start` (1) |
| `c07-index` | 140 | `src/core/config` (27), `src` (26), `src/core/loop` (19), `src/core/command` (13), `src/commands` (6), `src/config` (6), `src/errors` (6), `src/release` (6), `src/core/git` (5), `src/effort/sync` (4), `src/tiers` (4), `src/project` (3), `src/tests` (3), `src/commands/bug` (2), `src/commands/config` (2), `src/core/plan` (2), `src/effort/store` (2), `src/start` (2), `src/preflight` (1), `src/schema` (1) |
| `c08-types` | 116 | `src/cleanup` (20), `src/tests` (19), `src/pr/triage` (17), `src/commands/pr` (15), `src/pr` (12), `src/cli/prompt` (10), `src/commands` (7), `src/pr/plans` (5), `src/fixtures` (3), `src/start` (3), `src/inventory` (2), `src/effort/store` (1), `src/loop` (1), `src/status` (1) |
| `c09-index` | 57 | `src/core/plan` (13), `src/commands/plan` (11), `src/plan` (10), `src/board` (9), `src/tests` (6), `src` (3), `src/adapters/planner` (2), `src/modules` (2), `src/ports` (1) |
| `c10-index` | 42 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1) |
| `c11-start` | 33 | `src/stretch` (13), `src/ci` (7), `src/commands/stretch` (7), `src` (2), `src/commands` (2), `src/commands/ci` (2) |
| `c12-verify` | 29 | `src/refs` (12), `src/tests` (4), `src/board` (3), `src/commands` (3), `src/commands/issue` (2), `src/commands/plan` (2), `src/triage` (2), `src/cli` (1) |
| `c13-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c14-config-schema-readings` | 1 | `src` (1) |
| `c15-types.test` | 1 | `src/core/command` (1) |
| `c16-agent-gates.test` | 1 | `src/tests` (1) |
| `c17-agents-split-accounting.test` | 1 | `src/tests` (1) |
| `c18-cut-table-shape.test` | 1 | `src/tests` (1) |
| `c19-entry-exports.test` | 1 | `src/tests` (1) |
| `c20-epic-guard-workflow.test` | 1 | `src/tests` (1) |
| `c21-eslint-stand-in` | 1 | `src/tests` (1) |
| `c22-learning-boundary.test` | 1 | `src/tests` (1) |
| `c23-skill-gap-section.test` | 1 | `src/tests` (1) |
| `c24-verify-workflow.test` | 1 | `src/tests` (1) |
| `c25-cli.test` | 1 | `src/tools/ts-symbols` (1) |
| `c26-cli` | 1 | `src/tools/ts-symbols` (1) |

## The 30 files of highest betweenness

| Rank | File | Betweenness | Cluster |
| --- | --- | --- | --- |
| 1 | `src/ports/index.ts` | 55947.513524 | `c02-index` |
| 2 | `src/effort/store/merge-store.ts` | 46004.993313 | `c04-sqlite` |
| 3 | `src/core/config/index.ts` | 29251.364644 | `c07-index` |
| 4 | `src/config-registry.ts` | 24144.846727 | `c07-index` |
| 5 | `src/tests/cli-capture.ts` | 21991.682922 | `c05-cli-capture` |
| 6 | `src/core/command/index.ts` | 21271.849673 | `c03-index` |
| 7 | `src/board/roadmap.ts` | 18784.3303 | `c01-github` |
| 8 | `src/tiers/routing.ts` | 17621.271716 | `c07-index` |
| 9 | `src/inventory/record.ts` | 17329.861732 | `c06-frontmatter` |
| 10 | `src/core/loop/index.ts` | 16339.05589 | `c05-cli-capture` |
| 11 | `src/adapters/tracker/github.ts` | 16250.523716 | `c01-github` |
| 12 | `src/tiers/resolve.ts` | 16113.17684 | `c06-frontmatter` |
| 13 | `src/core/config/core-section.ts` | 16050.921811 | `c07-index` |
| 14 | `src/commands/index.ts` | 14733.180672 | `c03-index` |
| 15 | `src/pr/index.ts` | 12927.681271 | `c03-index` |
| 16 | `src/board/setup.ts` | 12773.581181 | `c01-github` |
| 17 | `src/board/relations/labels.ts` | 12635.311716 | `c01-github` |
| 18 | `src/start/dispatch.ts` | 12553.030471 | `c02-index` |
| 19 | `src/next/sources.ts` | 12042.2352 | `c01-github` |
| 20 | `src/core/config/scope.ts` | 11146.74276 | `c07-index` |
| 21 | `src/adapter-registry.ts` | 11136.257946 | `c03-index` |
| 22 | `src/start/loop-events.ts` | 11071.846349 | `c02-index` |
| 23 | `src/check/run.ts` | 10514.480519 | `c06-frontmatter` |
| 24 | `src/effort/store/development-build.ts` | 10330.981502 | `c04-sqlite` |
| 25 | `src/effort/store/sqlite.ts` | 10283.500179 | `c04-sqlite` |
| 26 | `src/config-schema-issues.ts` | 9727.963491 | `c07-index` |
| 27 | `src/project/scaffold.ts` | 9715.979736 | `c01-github` |
| 28 | `src/board/project/refresh.ts` | 9566.129365 | `c01-github` |
| 29 | `src/board/gate.ts` | 9510.778215 | `c01-github` |
| 30 | `src/core/config/sections.ts` | 8654.693004 | `c01-github` |

## Unresolved imports

- `src/tests/package-build.test.ts`: `${DEFINE_CONFIG}`
