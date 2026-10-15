# Import graph

Coverage: 1980 of 1980 tracked files read (src/ and packages/*/src/).

1980 files, 10325 edges (8100 value, 2225 type), 27 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 317 | `src/board` (119), `src/commands/epic` (27), `src/commands/issue` (24), `src/tests` (24), `src/commands` (23), `src/board/relations` (19), `src/next` (18), `src/status` (11), `src/commands/plan` (10), `src/board/project` (8), `src/commands/pr` (6), `src/core/git` (6), `src/claims` (5), `src/epic` (4), `src/suite` (4), `src/pr` (3), `src/adapters/tracker` (2), `src/commands/board` (2), `src/project` (2) |
| `c02-index` | 307 | `src/start` (112), `src/tests` (23), `src/triage` (23), `src/adapters/tracker` (15), `src/adapters/logger` (12), `src/bugs` (11), `src/commands/issue` (10), `src/learning` (10), `src/commands/instinct` (9), `src/suite` (9), `src/adapters/output` (6), `src/core/output` (6), `src/utils` (6), `src/cli/core` (5), `src/docs` (5), `src/task` (5), `src/adapters/learning` (4), `src/core/adapters` (4), `src/effort/sync` (3), `src/report` (3), `src/schema` (3), `src` (2), `src/commands/docs` (2), `src/commands/release` (2), `src/fixtures` (2), `src/ports` (2), `src/project` (2), `src/cli` (1), `src/commands/epic` (1), `src/commands/plan` (1), `src/core/git` (1), `src/core/plan` (1), `src/modules` (1), `src/modules/testdata/hub-down-sync` (1), `src/modules/testdata/pull-merge-sync` (1), `src/modules/testdata/sync-fixture` (1), `src/notices` (1), `src/preflight` (1) |
| `c03-index` | 268 | `src/commands/pr` (41), `src/next` (30), `src/start` (26), `src/tests` (18), `src/cli` (17), `src/commands` (13), `src/claims` (12), `src/cli/prompt` (10), `src/commands/update` (10), `src/project` (9), `src/commands/claim` (8), `src/commands/loop` (8), `src/commands/plan` (7), `src/status` (7), `src/commands/skill` (6), `src/core/command` (6), `src/pr` (6), `src/board` (5), `src/commands/agent` (5), `src/commands/module` (4), `src/inventory` (3), `src` (2), `src/commands/config` (2), `src/commands/effort` (2), `src/commands/issue` (2), `src/loop` (2), `src/modules` (2), `src/commands/instinct` (1), `src/core/config` (1), `src/core/loop` (1), `src/modules/testdata/seam-fixture` (1), `src/utils` (1) |
| `c04-sqlite` | 238 | `src/effort/store` (103), `src/effort` (57), `src/commands/effort` (16), `src/tests` (13), `src/triage` (12), `src/inventory/search` (10), `src/core/runtime` (4), `src/effort/store/testdata` (4), `src/effort/sync` (3), `src/report` (3), `src/start` (3), `src/utils` (3), `src/commands` (2), `src/claims` (1), `src/commands/claim` (1), `src/commands/epic` (1), `src/docs` (1), `src/runtime` (1) |
| `c05-cli-capture` | 225 | `src/tests` (87), `src/release` (48), `src/start` (23), `src/commands/release` (13), `src/commands/pr` (8), `src/commands/loop` (7), `src/loop` (6), `src/commands` (5), `src/project` (4), `src/runtime` (4), `src/utils` (3), `src` (2), `src/next` (2), `src/pr` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src/cleanup` (1), `src/commands/bug` (1), `src/commands/config` (1), `src/commands/effort` (1), `src/commands/stretch` (1), `src/core/loop` (1), `src/notices` (1) |
| `c06-index` | 217 | `src/commands` (34), `src` (28), `src/core/config` (27), `src/tiers` (13), `src/inventory` (12), `src/plan/risk` (10), `src/project` (10), `src/pr` (7), `src/preflight` (7), `src/tests` (7), `src/config` (6), `src/release` (6), `src/schema` (5), `src/agents` (4), `src/check` (4), `src/start` (4), `src/utils` (4), `src/effort/store` (3), `src/effort/sync` (3), `src/plan` (3), `src/task` (3), `src/board` (2), `src/commands/agent` (2), `src/commands/config` (2), `src/core/command` (2), `src/core/loop` (2), `src/effort` (2), `src/inventory/search` (2), `src/core/output` (1), `src/modules` (1), `src/notices` (1) |
| `c07-types` | 117 | `src/pr` (24), `src/cleanup` (21), `src/commands/pr` (18), `src/pr/triage` (18), `src/tests` (15), `src/commands` (7), `src/pr/plans` (5), `src/fixtures` (3), `src/start` (3), `src/board` (1), `src/effort/store` (1), `src/status` (1) |
| `c08-frontmatter` | 56 | `src/schema` (11), `src/backfill` (10), `src/demote` (10), `src/errors` (6), `src/commands/skill` (5), `src/tests` (5), `src/check` (4), `src/commands` (2), `src/commands/bug` (1), `src/commands/instinct` (1), `src/inventory` (1) |
| `c09-port` | 52 | `src/board/project` (33), `src/commands` (7), `src/commands/issue` (3), `src/tests` (3), `src/commands/board` (2), `src/commands/release` (2), `src/start` (2) |
| `c10-index` | 49 | `src/commands/plan` (11), `src/plan` (11), `src/board` (10), `src/core/plan` (8), `src/tests` (3), `src/adapters/planner` (2), `src/core/loop` (2), `src` (1), `src/ports` (1) |
| `c11-index` | 44 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `src/effort/store` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa-sync-service/src/testdata` (1) |
| `c12-folder` | 43 | `src/stretch` (13), `src/core/loop` (8), `src/ci` (7), `src/commands/stretch` (7), `src` (2), `src/commands` (2), `src/commands/ci` (2), `src/loop` (2) |
| `c13-verify` | 32 | `src/refs` (13), `src/tests` (5), `src/cli` (3), `src/commands` (3), `src/board` (2), `src/commands/issue` (2), `src/commands/plan` (2), `src/triage` (2) |
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
| 1 | `src/ports/index.ts` | 58531.696637 | `c02-index` |
| 2 | `src/effort/store/merge-store.ts` | 49091.962937 | `c04-sqlite` |
| 3 | `src/core/config/index.ts` | 26075.517646 | `c06-index` |
| 4 | `src/config-registry.ts` | 24650.931668 | `c06-index` |
| 5 | `src/tests/cli-capture.ts` | 21445.420304 | `c05-cli-capture` |
| 6 | `src/core/loop/index.ts` | 20993.561557 | `c05-cli-capture` |
| 7 | `src/inventory/record.ts` | 19330.319821 | `c06-index` |
| 8 | `src/board/roadmap.ts` | 18871.342615 | `c01-github` |
| 9 | `src/tiers/routing.ts` | 18767.144427 | `c06-index` |
| 10 | `src/core/command/index.ts` | 18598.067001 | `c03-index` |
| 11 | `src/tiers/resolve.ts` | 17735.972222 | `c06-index` |
| 12 | `src/adapters/tracker/github.ts` | 17402.778025 | `c01-github` |
| 13 | `src/core/config/core-section.ts` | 16999.332068 | `c06-index` |
| 14 | `src/core/command/command.ts` | 15139.760746 | `c06-index` |
| 15 | `src/commands/index.ts` | 14547.450566 | `c03-index` |
| 16 | `src/pr/index.ts` | 13368.474844 | `c03-index` |
| 17 | `src/check/run.ts` | 12732.205275 | `c08-frontmatter` |
| 18 | `src/effort/store/development-build.ts` | 12690.239384 | `c04-sqlite` |
| 19 | `src/board/relations/labels.ts` | 12477.048995 | `c01-github` |
| 20 | `src/core/loop/sessions.ts` | 12377.979314 | `c12-folder` |
| 21 | `src/start/dispatch.ts` | 12302.471876 | `c02-index` |
| 22 | `src/board/setup.ts` | 12259.175483 | `c01-github` |
| 23 | `src/next/sources.ts` | 11746.443698 | `c01-github` |
| 24 | `src/adapter-registry.ts` | 11243.638551 | `c03-index` |
| 25 | `src/project/scope.ts` | 10678.347285 | `c03-index` |
| 26 | `src/effort/store/sqlite.ts` | 10632.876788 | `c04-sqlite` |
| 27 | `src/config-schema-issues.ts` | 10555.637122 | `c06-index` |
| 28 | `src/start/loop-events.ts` | 10465.454729 | `c02-index` |
| 29 | `src/project/scaffold.ts` | 10015.614043 | `c05-cli-capture` |
| 30 | `src/board/project/refresh.ts` | 9425.312531 | `c09-port` |

## Unresolved imports

- `src/tests/package-build.test.ts`: `${DEFINE_CONFIG}`
