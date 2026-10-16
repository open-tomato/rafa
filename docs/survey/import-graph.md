# Import graph

Coverage: 2024 of 2024 tracked files read (src/ and packages/*/src/).

2024 files, 10533 edges (8260 value, 2273 type), 32 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 304 | `src/board` (113), `src/commands` (25), `src/tests` (25), `src/next` (21), `src/commands/issue` (20), `src/board/relations` (19), `src/commands/epic` (19), `src/status` (11), `src/commands/plan` (10), `packages/rafa/src/core/git` (6), `src/commands/pr` (6), `src/board/project` (4), `src/claims` (4), `src/suite` (4), `src/pr` (3), `src/start` (3), `src/adapters/tracker` (2), `src/commands/board` (2), `src/project` (2), `src/refs` (2), `src/cleanup` (1), `src/plan` (1), `src/plan/risk` (1) |
| `c02-sqlite` | 247 | `packages/rafa/src/effort/store` (89), `src/effort` (56), `src/triage` (25), `src/commands/effort` (17), `src/tests` (13), `src/tests/core-coupled/effort/store` (12), `src/start` (9), `packages/rafa/src/effort/store/testdata` (4), `packages/rafa/src/core/runtime` (3), `packages/rafa/src/report` (3), `src/commands` (3), `src/effort/sync` (3), `src/docs` (2), `src/fixtures` (2), `src/utils` (2), `src/claims` (1), `src/commands/claim` (1), `src/inventory/search` (1), `src/tests/core-coupled/core/runtime` (1) |
| `c03-index` | 229 | `src/commands/pr` (65), `src/release` (44), `src/pr` (25), `src/next` (23), `src/pr/triage` (18), `src/start` (12), `src/commands/release` (11), `src/tests` (9), `src/commands` (7), `src/pr/plans` (5), `src/board` (3), `src/project` (2), `src/release/strategies` (2), `src/runtime` (2), `src` (1) |
| `c04-index` | 227 | `src/start` (110), `src/tests` (25), `src/commands/plan` (12), `src/board` (10), `src/learning` (10), `src/plan` (10), `src/suite` (9), `src/preflight` (7), `packages/rafa/src/core/plan` (5), `src/adapters/learning` (4), `src/utils` (4), `src/commands/instinct` (3), `src` (2), `src/adapters/output` (2), `src/adapters/planner` (2), `src/pr` (2), `src/report` (2), `packages/rafa/src/core/output` (1), `packages/rafa/src/ports` (1), `src/commands` (1), `src/notices` (1), `src/schema` (1), `src/tests/core-coupled/core/plan` (1), `src/tests/core-coupled/report` (1), `src/triage` (1) |
| `c05-cli-capture` | 158 | `src/tests` (83), `src/start` (18), `src/commands/loop` (14), `src/loop` (8), `src/release` (6), `src/project` (4), `src/commands` (3), `src/commands/release` (3), `src/utils` (3), `packages/rafa/src/core/loop` (2), `src` (2), `src/commands/pr` (2), `src/next` (2), `src/runtime` (2), `src/cleanup` (1), `src/commands/bug` (1), `src/commands/config` (1), `src/commands/skill` (1), `src/commands/stretch` (1), `src/notices` (1) |
| `c06-sections` | 157 | `src/commands` (18), `src/inventory` (13), `src/tiers` (13), `src/inventory/search` (11), `src/schema` (11), `src/backfill` (10), `src/demote` (10), `src/plan/risk` (9), `src/check` (8), `src/task` (8), `src/tests` (8), `src/pr` (7), `src/commands/skill` (6), `src/agents` (4), `packages/rafa/src/schema` (3), `src/commands/agent` (3), `src/plan` (3), `packages/rafa/src/core/loop` (2), `src/start` (2), `src/utils` (2), `packages/rafa/src/core/config` (1), `src/board` (1), `src/commands/instinct` (1), `src/commands/plan` (1), `src/notices` (1), `src/tests/core-coupled/schema` (1) |
| `c07-index` | 151 | `src/cli` (15), `src/claims` (13), `src/commands` (13), `src/project` (13), `src/commands/update` (10), `src/commands/claim` (8), `src/commands/plan` (8), `src/commands/instinct` (7), `src/start` (7), `src/board` (5), `src/commands/issue` (5), `src/cli/core` (4), `src/commands/agent` (4), `src/commands/module` (4), `src/commands/skill` (4), `src/next` (4), `src/status` (4), `src/tests` (4), `src/commands/config` (2), `src/commands/effort` (2), `src/commands/epic` (2), `src/schema` (2), `packages/rafa/src/core/command` (1), `packages/rafa/src/core/config` (1), `src` (1), `src/adapters/output` (1), `src/commands/bug` (1), `src/commands/loop` (1), `src/effort/sync` (1), `src/inventory` (1), `src/modules` (1), `src/modules/testdata/seam-fixture` (1), `src/utils` (1) |
| `c08-index` | 139 | `src` (24), `packages/rafa/src/core/config` (23), `packages/rafa/src/core/loop` (17), `packages/rafa/src/core/command` (12), `packages/rafa/src/core/plan` (10), `src/commands` (9), `src/config` (6), `src/release` (6), `src/tests/core-coupled/core/config` (5), `src/effort/sync` (4), `src/project` (4), `packages/rafa/src/effort/store` (3), `src/tests` (3), `src/commands/config` (2), `src/start` (2), `src/tests/core-coupled/core/loop` (2), `src/tests/core-coupled/effort/store` (2), `packages/rafa/src/core/output` (1), `src/board` (1), `src/modules` (1), `src/preflight` (1), `src/tests/core-coupled/core/command` (1) |
| `c09-index` | 85 | `src/adapters/tracker` (17), `src/adapters/logger` (12), `src/commands/issue` (9), `src/tests` (6), `packages/rafa/src/core/adapters` (4), `src/docs` (4), `src/start` (4), `packages/rafa/src/core/output` (3), `packages/rafa/src/ports` (3), `src` (3), `src/commands/docs` (2), `src/commands/release` (2), `src/modules` (2), `src/tests/core-coupled/core/output` (2), `src/triage` (2), `packages/rafa/src/core/git` (1), `src/adapters/output` (1), `src/cli` (1), `src/commands/epic` (1), `src/effort/sync` (1), `src/modules/testdata/hub-down-sync` (1), `src/modules/testdata/pull-merge-sync` (1), `src/modules/testdata/sync-fixture` (1), `src/ports` (1), `src/tests/core-coupled/ports` (1) |
| `c10-refresh` | 80 | `src/board/project` (39), `src/commands/epic` (9), `src/commands` (7), `src/board` (5), `src/commands/issue` (4), `src/epic` (4), `src/tests` (4), `src/start` (3), `src/commands/board` (2), `src/commands/release` (2), `src/effort` (1) |
| `c11-index` | 57 | `src/cleanup` (20), `src/cli/prompt` (10), `src/commands` (6), `src/tests` (6), `src/pr` (5), `src/status` (4), `src/inventory` (2), `src/pr/triage` (2), `src/start` (2) |
| `c12-index` | 47 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa/src/effort/store` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort` (1), `src/effort/store` (1), `src/tests` (1), `src/tests/core-coupled/effort/store` (1) |
| `c13-record` | 43 | `src/bugs` (20), `src/triage` (10), `src/errors` (6), `src` (2), `src/project` (2), `src/commands/issue` (1), `src/schema` (1), `src/tests` (1) |
| `c14-start` | 33 | `src/stretch` (13), `src/ci` (7), `src/commands/stretch` (7), `src` (2), `src/commands` (2), `src/commands/ci` (2) |
| `c15-verify` | 28 | `src/refs` (11), `src/tests` (4), `src/board` (3), `src/commands` (3), `src/commands/issue` (2), `src/commands/plan` (2), `src/triage` (2), `src/cli` (1) |
| `c16-sweep-timeout` | 22 | `src/tests` (16), `src/fixtures` (3), `src/commands` (1), `src/start` (1), `src/tests/core-coupled/effort/store` (1) |
| `c17-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c18-types.test` | 1 | `packages/rafa/src/core/command` (1) |
| `c19-config-schema-readings` | 1 | `src` (1) |
| `c20-agent-gates.test` | 1 | `src/tests` (1) |
| `c21-agents-split-accounting.test` | 1 | `src/tests` (1) |
| `c22-cut-table-shape.test` | 1 | `src/tests` (1) |
| `c23-entry-exports.test` | 1 | `src/tests` (1) |
| `c24-epic-guard-workflow.test` | 1 | `src/tests` (1) |
| `c25-eslint-stand-in` | 1 | `src/tests` (1) |
| `c26-learning-boundary.test` | 1 | `src/tests` (1) |
| `c27-package-lint-spawned.test` | 1 | `src/tests` (1) |
| `c28-references-gate-spawned.test` | 1 | `src/tests` (1) |
| `c29-skill-gap-section.test` | 1 | `src/tests` (1) |
| `c30-verify-workflow.test` | 1 | `src/tests` (1) |
| `c31-cli.test` | 1 | `src/tools/ts-symbols` (1) |
| `c32-cli` | 1 | `src/tools/ts-symbols` (1) |

## The 30 files of highest betweenness

| Rank | File | Betweenness | Cluster |
| --- | --- | --- | --- |
| 1 | `packages/rafa/src/ports/index.ts` | 54667.682507 | `c09-index` |
| 2 | `packages/rafa/src/effort/store/merge-store.ts` | 44423.822937 | `c02-sqlite` |
| 3 | `src/tests/cli-capture.ts` | 21080.072105 | `c05-cli-capture` |
| 4 | `src/config-registry.ts` | 20193.566217 | `c08-index` |
| 5 | `packages/rafa/src/core/config/index.ts` | 19440.668062 | `c08-index` |
| 6 | `packages/rafa/src/core/command/index.ts` | 19243.930196 | `c07-index` |
| 7 | `src/board/roadmap.ts` | 17142.437549 | `c01-github` |
| 8 | `src/adapters/tracker/github.ts` | 17136.55188 | `c01-github` |
| 9 | `packages/rafa/src/core/loop/index.ts` | 15214.949217 | `c05-cli-capture` |
| 10 | `src/commands/index.ts` | 14842.633371 | `c07-index` |
| 11 | `src/board/relations/labels.ts` | 13461.357079 | `c01-github` |
| 12 | `src/start/dispatch.ts` | 12615.665075 | `c04-index` |
| 13 | `src/pr/index.ts` | 12524.061388 | `c03-index` |
| 14 | `src/board/setup.ts` | 12515.897822 | `c01-github` |
| 15 | `src/next/sources.ts` | 12245.217703 | `c01-github` |
| 16 | `src/start/loop-events.ts` | 11557.345208 | `c04-index` |
| 17 | `src/adapter-registry.ts` | 11505.113949 | `c03-index` |
| 18 | `src/board/project/refresh.ts` | 9892.692424 | `c10-refresh` |
| 19 | `src/board/gate.ts` | 9876.211571 | `c04-index` |
| 20 | `packages/rafa/src/core/config/scope.ts` | 9703.811411 | `c08-index` |
| 21 | `packages/rafa/src/effort/store/sqlite.ts` | 9581.172888 | `c02-sqlite` |
| 22 | `src/project/scaffold.ts` | 9483.455918 | `c05-cli-capture` |
| 23 | `packages/rafa/src/core/output/active.ts` | 8886.740942 | `c08-index` |
| 24 | `packages/rafa/src/core/config/config-load.ts` | 8635.553877 | `c08-index` |
| 25 | `packages/rafa/src/effort/store/development-build.ts` | 8530.876005 | `c02-sqlite` |
| 26 | `src/refs/extract.ts` | 7443.682479 | `c15-verify` |
| 27 | `src/triage/triage.ts` | 7402.642395 | `c02-sqlite` |
| 28 | `src/effort/collect.ts` | 7355.710817 | `c02-sqlite` |
| 29 | `src/board/issue.ts` | 6985.627045 | `c01-github` |
| 30 | `packages/rafa/src/core/plan/index.ts` | 6571.593187 | `c04-index` |

## Unresolved imports

- `src/tests/package-build.test.ts`: `${DEFINE_CONFIG}`
- `src/tests/package-build.test.ts`: `${OWN_SUBPATH}core/absent`
