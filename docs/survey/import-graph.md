# Import graph

Coverage: 1983 of 1983 tracked files read (src/ and packages/*/src/).

1983 files, 10333 edges (8105 value, 2228 type), 27 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 335 | `src/board` (119), `src/tests` (29), `src/commands/epic` (25), `src/commands/issue` (25), `src/commands` (23), `src/board/relations` (19), `src/next` (16), `src/pr` (13), `src/status` (11), `src/commands/plan` (10), `src/board/project` (8), `src/commands/pr` (6), `src/core/git` (6), `src/claims` (4), `src/epic` (4), `src/suite` (4), `src/project` (3), `src/adapters/tracker` (2), `src/commands/board` (2), `src/start` (2), `src/cleanup` (1), `src/effort` (1), `src/pr/triage` (1), `src/refs` (1) |
| `c02-index` | 308 | `src/start` (119), `src/tests` (24), `src/triage` (23), `src/adapters/tracker` (15), `src/adapters/logger` (12), `src/bugs` (11), `src/commands/issue` (10), `src/learning` (10), `src/commands/instinct` (9), `src/suite` (9), `src/core/output` (7), `src/utils` (6), `src/adapters/output` (5), `src/docs` (5), `src/task` (5), `src/adapters/learning` (4), `src/core/adapters` (4), `src/report` (3), `src/schema` (3), `src` (2), `src/commands/docs` (2), `src/commands/release` (2), `src/fixtures` (2), `src/modules` (2), `src/ports` (2), `src/project` (2), `src/cli` (1), `src/commands/epic` (1), `src/commands/plan` (1), `src/core/git` (1), `src/core/plan` (1), `src/modules/testdata/hub-down-sync` (1), `src/modules/testdata/pull-merge-sync` (1), `src/modules/testdata/sync-fixture` (1), `src/notices` (1), `src/preflight` (1) |
| `c03-index` | 260 | `src/commands/pr` (45), `src/next` (32), `src/cli` (16), `src/start` (16), `src/commands` (15), `src/claims` (13), `src/tests` (13), `src/commands/update` (10), `src/project` (9), `src/commands/claim` (8), `src/commands/loop` (8), `src/pr` (8), `src/board` (7), `src/commands/plan` (7), `src/status` (7), `src/cli/core` (5), `src/commands/agent` (5), `src/commands/skill` (5), `src/commands/module` (4), `src/commands/config` (3), `src/commands/effort` (3), `src/utils` (3), `src` (2), `src/commands/epic` (2), `src/commands/issue` (2), `src/effort/sync` (2), `src/loop` (2), `src/adapters/output` (1), `src/commands/instinct` (1), `src/core/command` (1), `src/core/config` (1), `src/core/loop` (1), `src/inventory` (1), `src/modules` (1), `src/modules/testdata/seam-fixture` (1) |
| `c04-sqlite` | 240 | `src/effort/store` (106), `src/effort` (56), `src/commands/effort` (15), `src/tests` (13), `src/triage` (12), `src/inventory/search` (10), `src/core/runtime` (4), `src/effort/store/testdata` (4), `src/commands` (3), `src/effort/sync` (3), `src/report` (3), `src/start` (3), `src/utils` (3), `src/claims` (1), `src/commands/claim` (1), `src/commands/epic` (1), `src/docs` (1), `src/runtime` (1) |
| `c05-index` | 221 | `src/commands` (31), `src` (28), `src/core/config` (27), `src/tiers` (13), `src/core/command` (12), `src/inventory` (12), `src/plan/risk` (10), `src/tests` (8), `src/pr` (7), `src/preflight` (7), `src/project` (7), `src/config` (6), `src/release` (6), `src/schema` (5), `src/start` (5), `src/agents` (4), `src/check` (4), `src/effort/sync` (4), `src/utils` (4), `src/plan` (3), `src/task` (3), `src/commands/agent` (2), `src/commands/config` (2), `src/core/loop` (2), `src/effort` (2), `src/effort/store` (2), `src/inventory/search` (2), `src/board` (1), `src/modules` (1), `src/notices` (1) |
| `c06-cli-capture` | 219 | `src/tests` (83), `src/release` (48), `src/start` (23), `src/commands/release` (13), `src/commands/loop` (7), `src/commands/pr` (7), `src/loop` (6), `src/project` (6), `src/commands` (5), `src/runtime` (4), `src` (2), `src/next` (2), `src/pr` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src/cleanup` (1), `src/commands/effort` (1), `src/commands/skill` (1), `src/commands/stretch` (1), `src/core/loop` (1), `src/notices` (1), `src/utils` (1) |
| `c07-types` | 115 | `src/cleanup` (20), `src/tests` (19), `src/pr/triage` (17), `src/commands/pr` (15), `src/pr` (12), `src/cli/prompt` (10), `src/commands` (7), `src/pr/plans` (5), `src/fixtures` (3), `src/start` (3), `src/inventory` (2), `src/effort/store` (1), `src/status` (1) |
| `c08-frontmatter` | 57 | `src/schema` (11), `src/backfill` (10), `src/demote` (10), `src/errors` (6), `src/commands/skill` (5), `src/tests` (5), `src/check` (4), `src/commands` (2), `src/commands/bug` (2), `src/commands/instinct` (1), `src/inventory` (1) |
| `c09-port` | 51 | `src/board/project` (33), `src/commands` (7), `src/tests` (3), `src/commands/board` (2), `src/commands/issue` (2), `src/commands/release` (2), `src/start` (2) |
| `c10-index` | 48 | `src/commands/plan` (11), `src/plan` (11), `src/board` (9), `src/core/plan` (8), `src/tests` (3), `src/adapters/planner` (2), `src/core/loop` (2), `src` (1), `src/ports` (1) |
| `c11-folder` | 43 | `src/stretch` (13), `src/core/loop` (8), `src/ci` (7), `src/commands/stretch` (7), `src` (2), `src/commands` (2), `src/commands/ci` (2), `src/loop` (2) |
| `c12-index` | 42 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1) |
| `c13-verify` | 29 | `src/refs` (12), `src/tests` (4), `src/board` (3), `src/commands` (3), `src/commands/issue` (2), `src/commands/plan` (2), `src/triage` (2), `src/cli` (1) |
| `c14-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c15-config-schema-readings` | 1 | `src` (1) |
| `c16-types.test` | 1 | `src/core/command` (1) |
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
| 1 | `src/ports/index.ts` | 58294.654588 | `c02-index` |
| 2 | `src/effort/store/merge-store.ts` | 48788.564658 | `c04-sqlite` |
| 3 | `src/core/config/index.ts` | 26001.944731 | `c05-index` |
| 4 | `src/config-registry.ts` | 24653.634869 | `c05-index` |
| 5 | `src/core/command/index.ts` | 22802.147222 | `c03-index` |
| 6 | `src/tests/cli-capture.ts` | 21566.74327 | `c06-cli-capture` |
| 7 | `src/core/loop/index.ts` | 19486.974028 | `c06-cli-capture` |
| 8 | `src/inventory/record.ts` | 19259.328398 | `c05-index` |
| 9 | `src/board/roadmap.ts` | 18980.68465 | `c01-github` |
| 10 | `src/tiers/routing.ts` | 18801.199183 | `c05-index` |
| 11 | `src/tiers/resolve.ts` | 17760.201199 | `c05-index` |
| 12 | `src/adapters/tracker/github.ts` | 17072.327535 | `c01-github` |
| 13 | `src/core/config/core-section.ts` | 17016.879464 | `c05-index` |
| 14 | `src/commands/index.ts` | 14554.617743 | `c03-index` |
| 15 | `src/pr/index.ts` | 13361.516938 | `c03-index` |
| 16 | `src/check/run.ts` | 12554.097186 | `c08-frontmatter` |
| 17 | `src/board/relations/labels.ts` | 12485.836812 | `c01-github` |
| 18 | `src/core/loop/sessions.ts` | 12376.216993 | `c11-folder` |
| 19 | `src/effort/store/development-build.ts` | 12358.983376 | `c04-sqlite` |
| 20 | `src/start/dispatch.ts` | 12315.52849 | `c02-index` |
| 21 | `src/board/setup.ts` | 12262.866983 | `c01-github` |
| 22 | `src/next/sources.ts` | 11763.059102 | `c01-github` |
| 23 | `src/adapter-registry.ts` | 11277.679963 | `c03-index` |
| 24 | `src/project/scope.ts` | 10754.741527 | `c03-index` |
| 25 | `src/effort/store/sqlite.ts` | 10694.791695 | `c04-sqlite` |
| 26 | `src/config-schema-issues.ts` | 10549.176983 | `c05-index` |
| 27 | `src/start/loop-events.ts` | 10454.899579 | `c02-index` |
| 28 | `src/project/scaffold.ts` | 10041.57182 | `c01-github` |
| 29 | `src/board/project/refresh.ts` | 9364.756939 | `c09-port` |
| 30 | `src/core/config/sections.ts` | 9005.906194 | `c05-index` |

## Unresolved imports

- `src/tests/package-build.test.ts`: `${DEFINE_CONFIG}`
