# Import graph

Coverage: 1995 of 1995 tracked files read (src/ and packages/*/src/).

1995 files, 10368 edges (8136 value, 2232 type), 26 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 384 | `src/board` (120), `src/board/project` (41), `src/tests` (32), `src/commands` (31), `src/commands/issue` (27), `src/commands/epic` (25), `src/board/relations` (19), `src/next` (16), `src/pr` (13), `src/status` (11), `src/commands/plan` (10), `src/commands/pr` (6), `src/start` (5), `src/claims` (4), `src/commands/board` (4), `src/epic` (4), `src/suite` (4), `src/project` (3), `src/adapters/tracker` (2), `src/commands/release` (2), `src/cleanup` (1), `src/core/config` (1), `src/core/git` (1), `src/pr/triage` (1), `src/refs` (1) |
| `c02-index` | 307 | `src/start` (121), `src/triage` (23), `src/tests` (22), `src/adapters/tracker` (15), `src/adapters/logger` (12), `src/bugs` (11), `src/commands/issue` (10), `src/learning` (10), `src/commands/instinct` (9), `src/suite` (9), `src/core/output` (7), `src/utils` (6), `src/adapters/output` (5), `src/docs` (5), `src/task` (5), `src/adapters/learning` (4), `src/core/adapters` (4), `src/report` (3), `src/schema` (3), `src` (2), `src/commands/docs` (2), `src/commands/release` (2), `src/fixtures` (2), `src/ports` (2), `src/project` (2), `src/cli` (1), `src/commands/epic` (1), `src/commands/plan` (1), `src/core/git` (1), `src/core/plan` (1), `src/modules` (1), `src/modules/testdata/hub-down-sync` (1), `src/modules/testdata/pull-merge-sync` (1), `src/modules/testdata/sync-fixture` (1), `src/notices` (1), `src/preflight` (1) |
| `c03-index` | 270 | `src/commands/pr` (45), `src/next` (32), `src/cli` (17), `src/commands` (16), `src/project` (16), `src/start` (16), `src/tests` (14), `src/claims` (13), `src/commands/update` (10), `src/commands/claim` (8), `src/commands/loop` (8), `src/pr` (8), `src/board` (7), `src/commands/plan` (7), `src/status` (7), `src/cli/core` (5), `src/commands/agent` (5), `src/commands/skill` (5), `src/commands/module` (4), `src/commands/config` (3), `src/commands/effort` (3), `src/utils` (3), `src` (2), `src/commands/epic` (2), `src/commands/issue` (2), `src/effort/sync` (2), `src/loop` (2), `src/adapters/output` (1), `src/commands/instinct` (1), `src/core/command` (1), `src/core/config` (1), `src/core/loop` (1), `src/inventory` (1), `src/modules` (1), `src/modules/testdata/seam-fixture` (1) |
| `c04-sqlite` | 230 | `src/effort/store` (106), `src/effort` (57), `src/commands/effort` (15), `src/tests` (13), `src/triage` (12), `src/core/runtime` (4), `src/effort/store/testdata` (4), `src/commands` (3), `src/effort/sync` (3), `src/report` (3), `src/start` (2), `src/utils` (2), `src/claims` (1), `src/commands/claim` (1), `src/commands/epic` (1), `src/docs` (1), `src/inventory/search` (1), `src/runtime` (1) |
| `c05-cli-capture` | 217 | `src/tests` (83), `src/release` (48), `src/start` (23), `src/commands/release` (13), `src/commands/loop` (7), `src/commands/pr` (7), `src/loop` (6), `src/commands` (5), `src/runtime` (4), `src/project` (3), `src` (2), `src/next` (2), `src/notices` (2), `src/pr` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src/cleanup` (1), `src/commands/effort` (1), `src/commands/skill` (1), `src/commands/stretch` (1), `src/core/loop` (1), `src/utils` (1) |
| `c06-frontmatter` | 159 | `src/commands` (25), `src/schema` (15), `src/inventory` (13), `src/inventory/search` (11), `src/backfill` (10), `src/demote` (10), `src/plan/risk` (10), `src/tests` (10), `src/tiers` (9), `src/check` (8), `src/pr` (7), `src/preflight` (6), `src/commands/skill` (5), `src/agents` (4), `src/plan` (4), `src/task` (3), `src/utils` (3), `src/commands/agent` (2), `src/effort` (2), `src/commands/instinct` (1), `src/start` (1) |
| `c07-index` | 133 | `src/core/config` (27), `src` (26), `src/core/command` (13), `src/core/loop` (12), `src/commands` (6), `src/config` (6), `src/errors` (6), `src/release` (6), `src/core/git` (5), `src/effort/sync` (4), `src/tiers` (4), `src/project` (3), `src/tests` (3), `src/commands/bug` (2), `src/commands/config` (2), `src/effort/store` (2), `src/loop` (2), `src/start` (2), `src/preflight` (1), `src/schema` (1) |
| `c08-types` | 115 | `src/cleanup` (20), `src/tests` (19), `src/pr/triage` (17), `src/commands/pr` (15), `src/pr` (12), `src/cli/prompt` (10), `src/commands` (7), `src/pr/plans` (5), `src/fixtures` (3), `src/start` (3), `src/inventory` (2), `src/effort/store` (1), `src/status` (1) |
| `c09-index` | 61 | `src/core/plan` (15), `src/commands/plan` (11), `src/plan` (10), `src/board` (9), `src/tests` (6), `src` (3), `src/adapters/planner` (2), `src/core/loop` (2), `src/modules` (2), `src/ports` (1) |
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
| 1 | `src/ports/index.ts` | 63453.083365 | `c02-index` |
| 2 | `src/effort/store/merge-store.ts` | 53992.000456 | `c04-sqlite` |
| 3 | `src/core/config/index.ts` | 29910.839644 | `c07-index` |
| 4 | `src/core/loop/index.ts` | 28863.867175 | `c05-cli-capture` |
| 5 | `src/config-registry.ts` | 24380.846727 | `c07-index` |
| 6 | `src/tests/cli-capture.ts` | 22557.956732 | `c05-cli-capture` |
| 7 | `src/core/command/index.ts` | 22189.64253 | `c03-index` |
| 8 | `src/core/loop/sessions.ts` | 21335.87398 | `c07-index` |
| 9 | `src/board/roadmap.ts` | 18823.940617 | `c01-github` |
| 10 | `src/adapters/tracker/github.ts` | 17903.999112 | `c01-github` |
| 11 | `src/tiers/routing.ts` | 17719.471716 | `c07-index` |
| 12 | `src/inventory/record.ts` | 17658.111732 | `c06-frontmatter` |
| 13 | `src/tiers/resolve.ts` | 16177.92684 | `c06-frontmatter` |
| 14 | `src/core/config/core-section.ts` | 16074.088478 | `c07-index` |
| 15 | `src/effort/store/development-build.ts` | 15754.048566 | `c04-sqlite` |
| 16 | `src/commands/index.ts` | 14657.097477 | `c03-index` |
| 17 | `src/pr/index.ts` | 13226.014604 | `c03-index` |
| 18 | `src/loop/session-record-parse.ts` | 12829.411508 | `c07-index` |
| 19 | `src/board/setup.ts` | 12703.725228 | `c01-github` |
| 20 | `src/board/relations/labels.ts` | 12584.808542 | `c01-github` |
| 21 | `src/start/dispatch.ts` | 12418.403091 | `c02-index` |
| 22 | `src/next/sources.ts` | 11868.712204 | `c01-github` |
| 23 | `src/adapter-registry.ts` | 11698.140469 | `c03-index` |
| 24 | `src/core/config/scope.ts` | 11506.76776 | `c07-index` |
| 25 | `src/effort/store/sqlite.ts` | 11094.589465 | `c04-sqlite` |
| 26 | `src/check/run.ts` | 10929.063853 | `c06-frontmatter` |
| 27 | `src/start/loop-events.ts` | 10516.734444 | `c02-index` |
| 28 | `src/config-schema-issues.ts` | 10031.296824 | `c07-index` |
| 29 | `src/core/plan/index.ts` | 9995.04148 | `c09-index` |
| 30 | `src/project/scaffold.ts` | 9715.396403 | `c01-github` |

## Unresolved imports

- `src/tests/package-build.test.ts`: `${DEFINE_CONFIG}`
