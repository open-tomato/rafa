# Import graph

Coverage: 1975 of 1975 tracked files read (src/ and packages/*/src/).

1975 files, 10131 edges (7909 value, 2222 type), 29 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 302 | `src/board` (117), `src/commands/epic` (25), `src/commands` (23), `src/tests` (23), `src/board/relations` (19), `src/next` (18), `src/commands/issue` (13), `src/commands/plan` (10), `src/board/project` (8), `src/commands/pr` (8), `src/status` (8), `src/core/git` (6), `src/claims` (5), `src/epic` (4), `src/suite` (4), `src/pr` (3), `src/adapters/tracker` (2), `src/commands/board` (2), `src/project` (2), `src/triage` (2) |
| `c02-sqlite` | 283 | `src/effort/store` (106), `src/effort` (57), `src/triage` (31), `src/start` (18), `src/tests` (16), `src/commands/effort` (15), `src/inventory/search` (10), `src/utils` (5), `src/core/runtime` (4), `src/effort/store/testdata` (4), `src/commands` (3), `src/effort/sync` (3), `src/report` (3), `src/docs` (2), `src/fixtures` (2), `src/adapters/tracker` (1), `src/claims` (1), `src/commands/claim` (1), `src/runtime` (1) |
| `c03-index` | 235 | `src/commands/pr` (56), `src/release` (44), `src/pr` (32), `src/pr/triage` (20), `src/cleanup` (19), `src/start` (12), `src/commands/release` (11), `src/tests` (11), `src/cli/prompt` (10), `src/commands` (7), `src/pr/plans` (5), `src/board` (2), `src/inventory` (2), `src/release/strategies` (2), `src/status` (2) |
| `c04-index` | 224 | `src/next` (28), `src/cli` (17), `src/commands` (17), `src/project` (16), `src/commands/plan` (15), `src/claims` (12), `src/start` (12), `src/plan` (11), `src/commands/update` (10), `src/status` (9), `src/commands/claim` (8), `src/commands/loop` (8), `src/commands/pr` (6), `src/core/command` (6), `src/cli/core` (5), `src/board` (4), `src/commands/agent` (4), `src/commands/module` (4), `src/commands/skill` (4), `src/tests` (4), `src/commands/effort` (3), `src/commands/config` (2), `src/commands/epic` (2), `src/effort/sync` (2), `src/loop` (2), `src/runtime` (2), `src` (1), `src/adapters/output` (1), `src/commands/instinct` (1), `src/core/config` (1), `src/core/loop` (1), `src/core/plan` (1), `src/inventory` (1), `src/modules` (1), `src/modules/testdata/seam-fixture` (1), `src/ports` (1), `src/utils` (1) |
| `c05-index` | 205 | `src/commands` (28), `src/core/config` (27), `src` (26), `src/tiers` (13), `src/inventory` (12), `src/plan/risk` (10), `src/tests` (9), `src/pr` (7), `src/preflight` (7), `src/config` (6), `src/schema` (6), `src/start` (6), `src/agents` (4), `src/check` (4), `src/effort/sync` (4), `src/release` (4), `src/utils` (4), `src/commands/agent` (3), `src/plan` (3), `src/project` (3), `src/task` (3), `src/board` (2), `src/commands/config` (2), `src/core/command` (2), `src/core/loop` (2), `src/effort` (2), `src/effort/store` (2), `src/commands/skill` (1), `src/core/output` (1), `src/modules` (1), `src/notices` (1) |
| `c06-index` | 192 | `src/start` (103), `src/tests` (20), `src/learning` (10), `src/commands/instinct` (9), `src/suite` (9), `src/core/plan` (8), `src/task` (5), `src/adapters/learning` (4), `src/utils` (4), `src/report` (3), `src/schema` (3), `src/core/adapters` (2), `src/core/loop` (2), `src/inventory/search` (2), `src/modules` (2), `src` (1), `src/core/output` (1), `src/modules/testdata/hub-down-sync` (1), `src/modules/testdata/pull-merge-sync` (1), `src/notices` (1), `src/preflight` (1) |
| `c07-cli-capture` | 166 | `src/tests` (86), `src/start` (17), `src/core/loop` (9), `src/loop` (8), `src/commands/loop` (7), `src/release` (6), `src/commands` (4), `src/next` (4), `src/cleanup` (3), `src/commands/pr` (3), `src/commands/release` (3), `src/project` (3), `src/utils` (3), `src` (2), `src/runtime` (2), `src/commands/bug` (1), `src/commands/config` (1), `src/commands/effort` (1), `src/commands/skill` (1), `src/commands/stretch` (1), `src/notices` (1) |
| `c08-index` | 84 | `src/commands/issue` (21), `src/adapters/tracker` (14), `src/adapters/logger` (12), `src/adapters/output` (6), `src/tests` (6), `src/docs` (4), `src/board` (2), `src/commands/docs` (2), `src/commands/epic` (2), `src/core/adapters` (2), `src/core/output` (2), `src/ports` (2), `src/start` (2), `src/triage` (2), `src/cli` (1), `src/commands` (1), `src/commands/release` (1), `src/modules/testdata/sync-fixture` (1), `src/project` (1) |
| `c09-frontmatter` | 71 | `src/bugs` (11), `src/backfill` (10), `src/demote` (10), `src/schema` (10), `src/errors` (6), `src/commands/skill` (5), `src/tests` (5), `src/check` (4), `src` (2), `src/commands` (2), `src/project` (2), `src/commands/bug` (1), `src/commands/instinct` (1), `src/commands/issue` (1), `src/inventory` (1) |
| `c10-refresh` | 53 | `src/board/project` (33), `src/commands` (7), `src/commands/issue` (4), `src/tests` (3), `src/commands/board` (2), `src/commands/release` (2), `src/start` (2) |
| `c11-index` | 42 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1) |
| `c12-start` | 33 | `src/stretch` (13), `src/ci` (7), `src/commands/stretch` (7), `src` (2), `src/commands` (2), `src/commands/ci` (2) |
| `c13-verify` | 32 | `src/refs` (13), `src/tests` (5), `src/cli` (3), `src/commands` (3), `src/board` (2), `src/commands/issue` (2), `src/commands/plan` (2), `src/triage` (2) |
| `c14-sweep-timeout` | 20 | `src/tests` (14), `src/fixtures` (3), `src/commands` (1), `src/effort/store` (1), `src/start` (1) |
| `c15-spec-review` | 18 | `src/board` (10), `src/commands/plan` (4), `src/adapters/planner` (2), `src` (1), `src/tests` (1) |
| `c16-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c17-types.test` | 1 | `src/cli/core` (1) |
| `c18-config-schema-readings` | 1 | `src` (1) |
| `c19-agent-gates.test` | 1 | `src/tests` (1) |
| `c20-agents-split-accounting.test` | 1 | `src/tests` (1) |
| `c21-cut-table-shape.test` | 1 | `src/tests` (1) |
| `c22-entry-exports.test` | 1 | `src/tests` (1) |
| `c23-epic-guard-workflow.test` | 1 | `src/tests` (1) |
| `c24-eslint-stand-in` | 1 | `src/tests` (1) |
| `c25-learning-boundary.test` | 1 | `src/tests` (1) |
| `c26-skill-gap-section.test` | 1 | `src/tests` (1) |
| `c27-verify-workflow.test` | 1 | `src/tests` (1) |
| `c28-cli.test` | 1 | `src/tools/ts-symbols` (1) |
| `c29-cli` | 1 | `src/tools/ts-symbols` (1) |

## The 30 files of highest betweenness

| Rank | File | Betweenness | Cluster |
| --- | --- | --- | --- |
| 1 | `src/ports/index.ts` | 60951.885225 | `c08-index` |
| 2 | `src/effort/store/merge-store.ts` | 50737.873972 | `c02-sqlite` |
| 3 | `src/tests/cli-capture.ts` | 28118.361961 | `c07-cli-capture` |
| 4 | `src/core/config/index.ts` | 25542.745017 | `c05-index` |
| 5 | `src/config-registry.ts` | 24684.90124 | `c05-index` |
| 6 | `src/core/loop/index.ts` | 20998.528723 | `c07-cli-capture` |
| 7 | `src/board/roadmap.ts` | 19155.364751 | `c01-github` |
| 8 | `src/inventory/record.ts` | 18830.989663 | `c05-index` |
| 9 | `src/core/command/index.ts` | 18616.859965 | `c04-index` |
| 10 | `src/tiers/routing.ts` | 18324.622729 | `c05-index` |
| 11 | `src/tiers/resolve.ts` | 17259.499226 | `c05-index` |
| 12 | `src/adapters/tracker/github.ts` | 17093.733733 | `c01-github` |
| 13 | `src/core/config/core-section.ts` | 16547.493117 | `c05-index` |
| 14 | `src/core/command/command.ts` | 15159.625932 | `c05-index` |
| 15 | `src/commands/index.ts` | 14728.73685 | `c04-index` |
| 16 | `src/core/adapters/index.ts` | 13876.439489 | `c06-index` |
| 17 | `src/core/adapters/registry.ts` | 13528.772822 | `c08-index` |
| 18 | `src/pr/index.ts` | 13279.638083 | `c03-index` |
| 19 | `src/effort/store/development-build.ts` | 12808.060065 | `c02-sqlite` |
| 20 | `src/board/relations/labels.ts` | 12471.834691 | `c01-github` |
| 21 | `src/start/dispatch.ts` | 12448.23577 | `c06-index` |
| 22 | `src/board/setup.ts` | 12289.158305 | `c01-github` |
| 23 | `src/core/loop/sessions.ts` | 12285.753449 | `c07-cli-capture` |
| 24 | `src/check/run.ts` | 12232.713292 | `c09-frontmatter` |
| 25 | `src/next/sources.ts` | 11758.132686 | `c01-github` |
| 26 | `src/start/loop-events.ts` | 11233.993296 | `c07-cli-capture` |
| 27 | `src/project/scope.ts` | 10665.190287 | `c04-index` |
| 28 | `src/config-schema-issues.ts` | 10468.926691 | `c09-frontmatter` |
| 29 | `src/cli/dispatch.ts` | 10351.757593 | `c04-index` |
| 30 | `src/project/scaffold.ts` | 10150.7492 | `c07-cli-capture` |

## Unresolved imports

- `src/tests/package-build.test.ts`: `${DEFINE_CONFIG}`
