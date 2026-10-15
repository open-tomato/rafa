# Import graph

Coverage: 1994 of 1994 tracked files read (src/ and packages/*/src/).

1994 files, 10363 edges (8134 value, 2229 type), 25 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 370 | `src/board` (118), `src/board/project` (41), `src/tests` (31), `src/commands` (30), `src/commands/epic` (27), `src/commands/issue` (27), `src/board/relations` (19), `src/next` (16), `src/status` (11), `src/commands/plan` (10), `src/commands/pr` (6), `src/claims` (4), `src/commands/board` (4), `src/epic` (4), `src/start` (4), `src/suite` (4), `src/pr` (3), `src/project` (3), `src/adapters/tracker` (2), `src/commands/release` (2), `src/cleanup` (1), `src/core/git` (1), `src/effort` (1), `src/refs` (1) |
| `c02-index` | 307 | `src/start` (121), `src/triage` (23), `src/tests` (22), `src/adapters/tracker` (15), `src/adapters/logger` (12), `src/bugs` (11), `src/commands/issue` (10), `src/learning` (10), `src/commands/instinct` (9), `src/suite` (9), `src/core/output` (7), `src/utils` (6), `src/adapters/output` (5), `src/docs` (5), `src/task` (5), `src/adapters/learning` (4), `src/core/adapters` (4), `src/report` (3), `src/schema` (3), `src` (2), `src/commands/docs` (2), `src/commands/release` (2), `src/fixtures` (2), `src/ports` (2), `src/project` (2), `src/cli` (1), `src/commands/epic` (1), `src/commands/plan` (1), `src/core/git` (1), `src/core/plan` (1), `src/modules` (1), `src/modules/testdata/hub-down-sync` (1), `src/modules/testdata/pull-merge-sync` (1), `src/modules/testdata/sync-fixture` (1), `src/notices` (1), `src/preflight` (1) |
| `c03-index` | 254 | `src/commands/pr` (45), `src/next` (32), `src/cli` (17), `src/start` (16), `src/tests` (14), `src/claims` (13), `src/commands` (13), `src/commands/update` (10), `src/commands/claim` (8), `src/commands/loop` (8), `src/pr` (8), `src/board` (7), `src/commands/plan` (7), `src/project` (7), `src/status` (7), `src/cli/core` (5), `src/commands/agent` (4), `src/commands/module` (4), `src/commands/skill` (4), `src/commands/config` (3), `src/commands/effort` (3), `src/utils` (3), `src` (2), `src/commands/issue` (2), `src/effort/sync` (2), `src/loop` (2), `src/adapters/output` (1), `src/commands/instinct` (1), `src/core/command` (1), `src/core/config` (1), `src/core/loop` (1), `src/inventory` (1), `src/modules` (1), `src/modules/testdata/seam-fixture` (1) |
| `c04-sqlite` | 241 | `src/effort/store` (105), `src/effort` (57), `src/commands/effort` (15), `src/tests` (13), `src/triage` (12), `src/inventory/search` (10), `src/core/runtime` (4), `src/effort/store/testdata` (4), `src/effort/sync` (3), `src/report` (3), `src` (2), `src/commands` (2), `src/modules` (2), `src/start` (2), `src/utils` (2), `src/claims` (1), `src/commands/claim` (1), `src/commands/epic` (1), `src/docs` (1), `src/runtime` (1) |
| `c05-sections` | 225 | `src/commands` (28), `src/tests` (16), `src/core/plan` (15), `src/schema` (15), `src/plan` (14), `src/inventory` (13), `src/tiers` (13), `src/commands/plan` (11), `src/backfill` (10), `src/board` (10), `src/demote` (10), `src/plan/risk` (10), `src/check` (8), `src/pr` (7), `src/commands/skill` (6), `src/preflight` (6), `src/project` (6), `src/agents` (4), `src/commands/agent` (3), `src/task` (3), `src/adapters/planner` (2), `src/core/loop` (2), `src/inventory/search` (2), `src/start` (2), `src/utils` (2), `src` (1), `src/commands/instinct` (1), `src/core/config` (1), `src/effort` (1), `src/effort/store` (1), `src/notices` (1), `src/ports` (1) |
| `c06-cli-capture` | 220 | `src/tests` (83), `src/release` (48), `src/start` (23), `src/commands/release` (13), `src/commands/loop` (7), `src/commands/pr` (7), `src/commands` (6), `src/loop` (6), `src/project` (6), `src/runtime` (4), `src` (2), `src/next` (2), `src/pr` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src/cleanup` (1), `src/commands/effort` (1), `src/commands/skill` (1), `src/commands/stretch` (1), `src/core/loop` (1), `src/notices` (1), `src/utils` (1) |
| `c07-index` | 130 | `src/core/config` (27), `src` (26), `src/core/command` (13), `src/core/loop` (12), `src/commands` (7), `src/config` (6), `src/errors` (6), `src/release` (6), `src/core/git` (5), `src/effort/sync` (4), `src/project` (3), `src/tests` (3), `src/commands/bug` (2), `src/commands/config` (2), `src/effort/store` (2), `src/loop` (2), `src/start` (2), `src/preflight` (1), `src/schema` (1) |
| `c08-types` | 128 | `src/pr` (22), `src/cleanup` (20), `src/tests` (20), `src/pr/triage` (18), `src/commands/pr` (15), `src/cli/prompt` (10), `src/commands` (7), `src/pr/plans` (5), `src/fixtures` (3), `src/start` (3), `src/inventory` (2), `src/board` (1), `src/effort/store` (1), `src/status` (1) |
| `c09-index` | 42 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1) |
| `c10-start` | 33 | `src/stretch` (13), `src/ci` (7), `src/commands/stretch` (7), `src` (2), `src/commands` (2), `src/commands/ci` (2) |
| `c11-verify` | 29 | `src/refs` (12), `src/tests` (4), `src/board` (3), `src/commands` (3), `src/commands/issue` (2), `src/commands/plan` (2), `src/triage` (2), `src/cli` (1) |
| `c12-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c13-config-schema-readings` | 1 | `src` (1) |
| `c14-types.test` | 1 | `src/core/command` (1) |
| `c15-agent-gates.test` | 1 | `src/tests` (1) |
| `c16-agents-split-accounting.test` | 1 | `src/tests` (1) |
| `c17-cut-table-shape.test` | 1 | `src/tests` (1) |
| `c18-entry-exports.test` | 1 | `src/tests` (1) |
| `c19-epic-guard-workflow.test` | 1 | `src/tests` (1) |
| `c20-eslint-stand-in` | 1 | `src/tests` (1) |
| `c21-learning-boundary.test` | 1 | `src/tests` (1) |
| `c22-skill-gap-section.test` | 1 | `src/tests` (1) |
| `c23-verify-workflow.test` | 1 | `src/tests` (1) |
| `c24-cli.test` | 1 | `src/tools/ts-symbols` (1) |
| `c25-cli` | 1 | `src/tools/ts-symbols` (1) |

## The 30 files of highest betweenness

| Rank | File | Betweenness | Cluster |
| --- | --- | --- | --- |
| 1 | `src/ports/index.ts` | 62622.67103 | `c02-index` |
| 2 | `src/effort/store/merge-store.ts` | 53231.652406 | `c04-sqlite` |
| 3 | `src/core/config/index.ts` | 29970.853929 | `c07-index` |
| 4 | `src/core/loop/index.ts` | 26120.808603 | `c06-cli-capture` |
| 5 | `src/config-registry.ts` | 24362.513393 | `c07-index` |
| 6 | `src/tests/cli-capture.ts` | 22504.519827 | `c06-cli-capture` |
| 7 | `src/core/command/index.ts` | 22113.65465 | `c03-index` |
| 8 | `src/core/loop/sessions.ts` | 19373.139457 | `c07-index` |
| 9 | `src/board/roadmap.ts` | 18815.877125 | `c01-github` |
| 10 | `src/adapters/tracker/github.ts` | 17775.893557 | `c01-github` |
| 11 | `src/inventory/record.ts` | 17616.861732 | `c05-sections` |
| 12 | `src/tiers/routing.ts` | 17542.471716 | `c05-sections` |
| 13 | `src/tiers/resolve.ts` | 16018.960173 | `c05-sections` |
| 14 | `src/core/config/core-section.ts` | 15867.438478 | `c07-index` |
| 15 | `src/effort/store/development-build.ts` | 15446.567795 | `c04-sqlite` |
| 16 | `src/commands/index.ts` | 14636.135572 | `c03-index` |
| 17 | `src/pr/index.ts` | 13205.105477 | `c03-index` |
| 18 | `src/board/setup.ts` | 12695.058562 | `c01-github` |
| 19 | `src/board/relations/labels.ts` | 12581.919653 | `c01-github` |
| 20 | `src/start/dispatch.ts` | 12360.520735 | `c02-index` |
| 21 | `src/next/sources.ts` | 11860.7531 | `c01-github` |
| 22 | `src/adapter-registry.ts` | 11617.038485 | `c03-index` |
| 23 | `src/core/config/scope.ts` | 11084.015379 | `c07-index` |
| 24 | `src/effort/store/sqlite.ts` | 11021.610642 | `c04-sqlite` |
| 25 | `src/check/run.ts` | 10951.647186 | `c05-sections` |
| 26 | `src/start/loop-events.ts` | 10459.398732 | `c02-index` |
| 27 | `src/config-schema-issues.ts` | 10007.630158 | `c07-index` |
| 28 | `src/core/plan/index.ts` | 9924.979575 | `c05-sections` |
| 29 | `src/project/scaffold.ts` | 9715.396403 | `c01-github` |
| 30 | `src/board/project/refresh.ts` | 9477.058658 | `c01-github` |

## Unresolved imports

- `src/tests/package-build.test.ts`: `${DEFINE_CONFIG}`
