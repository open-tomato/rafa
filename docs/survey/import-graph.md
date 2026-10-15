# Import graph

Coverage: 1993 of 1993 tracked files read (src/ and packages/*/src/).

1993 files, 10324 edges (8099 value, 2225 type), 27 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-index` | 342 | `src/start` (113), `src/effort` (56), `packages/rafa/src/effort/store` (32), `src/triage` (31), `src/tests` (28), `src/bugs` (11), `src/plan` (9), `src/suite` (9), `src/preflight` (7), `src/tests/core-coupled/effort/store` (6), `src/utils` (6), `packages/rafa/src/core/plan` (5), `src/epic` (4), `packages/rafa/src/report` (3), `src/commands/plan` (3), `src/adapters/output` (2), `src/commands/epic` (2), `src/docs` (2), `src/fixtures` (2), `src/project` (2), `packages/rafa/src/core/output` (1), `src` (1), `src/adapters/tracker` (1), `src/claims` (1), `src/commands/issue` (1), `src/effort/sync` (1), `src/notices` (1), `src/release` (1), `src/tests/core-coupled/core/plan` (1) |
| `c02-github` | 329 | `src/board` (111), `src/board/project` (41), `src/commands` (31), `src/commands/epic` (25), `src/tests` (25), `src/commands/issue` (22), `src/board/relations` (19), `src/commands/plan` (10), `src/next` (9), `packages/rafa/src/core/git` (6), `src/commands/pr` (6), `src/claims` (5), `src/commands/board` (4), `src/start` (4), `src/adapters/tracker` (2), `src/commands/release` (2), `src/project` (2), `src/status` (2), `src/suite` (2), `src/triage` (1) |
| `c03-index` | 247 | `src/commands/pr` (58), `src/next` (34), `src/pr` (31), `src/cleanup` (21), `src/pr/triage` (18), `src/tests` (14), `src/status` (13), `src/commands` (12), `src/board` (10), `src/cli/prompt` (10), `src/start` (7), `src/commands/loop` (5), `src/pr/plans` (5), `src/inventory` (2), `src/loop` (2), `src/suite` (2), `packages/rafa/src/core/loop` (1), `src` (1), `src/commands/effort` (1) |
| `c04-cli-capture` | 216 | `src/tests` (83), `src/release` (47), `src/start` (24), `src/commands/release` (14), `src/commands/pr` (9), `src/loop` (6), `src/commands` (5), `src/project` (4), `src/runtime` (4), `src/commands/loop` (3), `src` (2), `src/next` (2), `src/pr` (2), `src/pr/triage` (2), `src/release/strategies` (2), `packages/rafa/src/core/loop` (1), `src/cleanup` (1), `src/commands/bug` (1), `src/commands/skill` (1), `src/commands/stretch` (1), `src/notices` (1), `src/utils` (1) |
| `c05-index` | 161 | `src` (30), `packages/rafa/src/core/config` (24), `packages/rafa/src/core/loop` (19), `packages/rafa/src/core/command` (12), `packages/rafa/src/core/plan` (10), `src/commands` (6), `src/config` (6), `src/errors` (6), `src/release` (6), `src/tests/core-coupled/core/config` (5), `src/commands/config` (4), `src/tiers` (4), `packages/rafa/src/effort/store` (3), `src/effort/sync` (3), `src/project` (3), `src/start` (3), `src/tests` (3), `src/board` (2), `src/tests/core-coupled/core/loop` (2), `src/utils` (2), `packages/rafa/src/core/output` (1), `src/agents` (1), `src/commands/bug` (1), `src/modules` (1), `src/notices` (1), `src/preflight` (1), `src/tests/core-coupled/core/command` (1), `src/tests/core-coupled/effort/store` (1) |
| `c06-record` | 156 | `src/commands` (24), `src/inventory` (13), `src/inventory/search` (12), `src/schema` (12), `src/backfill` (10), `src/demote` (10), `src/plan/risk` (10), `src/tests` (9), `src/tiers` (9), `src/check` (8), `src/task` (8), `src/pr` (7), `src/commands/skill` (6), `src/plan` (4), `packages/rafa/src/schema` (3), `src/commands/agent` (3), `src/agents` (2), `src/start` (2), `src/utils` (2), `src/commands/instinct` (1), `src/tests/core-coupled/schema` (1) |
| `c07-index` | 150 | `src/project` (16), `src/cli` (15), `src/claims` (12), `src/commands/plan` (12), `src/commands` (11), `src/commands/update` (10), `src/commands/claim` (8), `src/commands/loop` (7), `src/start` (7), `src/next` (5), `src/board` (4), `src/cli/core` (4), `src/commands/agent` (4), `src/commands/module` (4), `src/commands/skill` (4), `src/status` (4), `src/tests` (4), `src/commands/effort` (3), `src/commands/instinct` (3), `src/commands/issue` (2), `packages/rafa/src/core/command` (1), `packages/rafa/src/core/config` (1), `src` (1), `src/adapters/output` (1), `src/agents` (1), `src/commands/config` (1), `src/inventory` (1), `src/modules` (1), `src/modules/testdata/seam-fixture` (1), `src/plan` (1), `src/utils` (1) |
| `c08-index` | 149 | `src/adapters/tracker` (14), `src/commands/issue` (14), `src/tests` (13), `src/adapters/logger` (12), `src/start` (12), `src/board` (10), `src/learning` (10), `src/commands/instinct` (7), `packages/rafa/src/core/adapters` (4), `packages/rafa/src/ports` (4), `src/adapters/learning` (4), `src/commands/plan` (4), `src/docs` (4), `packages/rafa/src/core/output` (3), `src/effort/sync` (3), `src/schema` (3), `src` (2), `src/adapters/planner` (2), `src/commands/docs` (2), `src/commands/epic` (2), `src/modules` (2), `src/pr` (2), `src/report` (2), `src/tests/core-coupled/core/output` (2), `src/triage` (2), `packages/rafa/src/core/git` (1), `src/adapters/output` (1), `src/cli` (1), `src/commands/release` (1), `src/modules/testdata/hub-down-sync` (1), `src/modules/testdata/pull-merge-sync` (1), `src/modules/testdata/sync-fixture` (1), `src/ports` (1), `src/tests/core-coupled/ports` (1), `src/tests/core-coupled/report` (1) |
| `c09-migrations` | 102 | `packages/rafa/src/effort/store` (57), `src/commands/effort` (15), `src/tests` (7), `src/tests/core-coupled/effort/store` (7), `packages/rafa/src/effort/store/testdata` (4), `packages/rafa/src/core/runtime` (3), `src/commands` (3), `src/effort` (2), `src/effort/sync` (2), `src/commands/claim` (1), `src/tests/core-coupled/core/runtime` (1) |
| `c10-index` | 46 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa/src/effort/store` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1), `src/tests` (1), `src/tests/core-coupled/effort/store` (1) |
| `c11-folder` | 31 | `src/stretch` (13), `src/ci` (7), `src/commands/stretch` (7), `src/commands` (2), `src/commands/ci` (2) |
| `c12-verify` | 29 | `src/refs` (13), `src/tests` (4), `src/commands` (3), `src/board` (2), `src/commands/issue` (2), `src/commands/plan` (2), `src/triage` (2), `src/cli` (1) |
| `c13-sweep-timeout` | 20 | `src/tests` (14), `src/fixtures` (3), `src/commands` (1), `src/start` (1), `src/tests/core-coupled/effort/store` (1) |
| `c14-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c15-types.test` | 1 | `packages/rafa/src/core/command` (1) |
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
| 1 | `packages/rafa/src/ports/index.ts` | 53628.04108 | `c08-index` |
| 2 | `packages/rafa/src/effort/store/merge-store.ts` | 43589.740742 | `c09-migrations` |
| 3 | `src/config-registry.ts` | 24212.682218 | `c05-index` |
| 4 | `src/tests/cli-capture.ts` | 21763.94109 | `c04-cli-capture` |
| 5 | `packages/rafa/src/core/command/index.ts` | 19058.622885 | `c07-index` |
| 6 | `src/board/roadmap.ts` | 18292.186097 | `c02-github` |
| 7 | `packages/rafa/src/core/config/index.ts` | 17891.770892 | `c05-index` |
| 8 | `src/adapters/tracker/github.ts` | 15552.923802 | `c02-github` |
| 9 | `packages/rafa/src/core/loop/index.ts` | 15036.044176 | `c04-cli-capture` |
| 10 | `src/commands/index.ts` | 14633.606815 | `c07-index` |
| 11 | `src/board/relations/labels.ts` | 12676.412818 | `c02-github` |
| 12 | `src/start/dispatch.ts` | 12559.349986 | `c01-index` |
| 13 | `src/board/setup.ts` | 12426.40467 | `c02-github` |
| 14 | `src/pr/index.ts` | 12273.248021 | `c03-index` |
| 15 | `src/next/sources.ts` | 11915.292847 | `c03-index` |
| 16 | `src/start/loop-events.ts` | 11698.329832 | `c01-index` |
| 17 | `src/adapter-registry.ts` | 11192.325091 | `c03-index` |
| 18 | `src/project/scaffold.ts` | 10345.839982 | `c04-cli-capture` |
| 19 | `src/config-schema-issues.ts` | 9725.472804 | `c05-index` |
| 20 | `src/board/gate.ts` | 9659.920356 | `c08-index` |
| 21 | `packages/rafa/src/effort/store/sqlite.ts` | 9479.384162 | `c01-index` |
| 22 | `src/board/project/refresh.ts` | 9370.083933 | `c02-github` |
| 23 | `packages/rafa/src/core/config/scope.ts` | 8332.151209 | `c05-index` |
| 24 | `packages/rafa/src/effort/store/development-build.ts` | 8330.894847 | `c09-migrations` |
| 25 | `src/effort/collect.ts` | 7629.608559 | `c01-index` |
| 26 | `packages/rafa/src/core/output/active.ts` | 7584.108351 | `c05-index` |
| 27 | `packages/rafa/src/core/config/config-load.ts` | 7340.001193 | `c05-index` |
| 28 | `src/refs/extract.ts` | 7170.175336 | `c12-verify` |
| 29 | `src/board/issue.ts` | 6831.135234 | `c02-github` |
| 30 | `packages/rafa/src/core/plan/index.ts` | 6522.416298 | `c01-index` |

## Unresolved imports

- `src/tests/package-build.test.ts`: `${DEFINE_CONFIG}`
- `src/tests/package-build.test.ts`: `${OWN_SUBPATH}core/absent`
