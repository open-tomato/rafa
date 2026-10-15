# Import graph

Coverage: 1985 of 1985 tracked files read (src/ and packages/*/src/).

1985 files, 10335 edges (8107 value, 2228 type), 27 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 366 | `src/board` (119), `src/board/project` (41), `src/commands` (31), `src/commands/epic` (27), `src/commands/issue` (27), `src/tests` (27), `src/board/relations` (19), `src/next` (14), `src/commands/plan` (10), `src/commands/pr` (8), `src/status` (8), `src/claims` (6), `src/core/git` (6), `src/commands/board` (4), `src/epic` (4), `src/suite` (4), `src/pr` (3), `src/adapters/tracker` (2), `src/commands/release` (2), `src/project` (2), `src/start` (2) |
| `c02-index` | 305 | `src/start` (124), `src/tests` (24), `src/triage` (23), `src/adapters/tracker` (15), `src/adapters/logger` (12), `src/bugs` (11), `src/learning` (10), `src/commands/instinct` (9), `src/commands/issue` (9), `src/suite` (9), `src/core/output` (7), `src/utils` (7), `src/adapters/output` (5), `src/docs` (5), `src/task` (5), `src/adapters/learning` (4), `src/report` (3), `src/schema` (3), `src` (2), `src/commands/docs` (2), `src/commands/release` (2), `src/fixtures` (2), `src/ports` (2), `src/project` (2), `src/cli` (1), `src/commands/epic` (1), `src/commands/plan` (1), `src/core/plan` (1), `src/modules/testdata/hub-down-sync` (1), `src/modules/testdata/sync-fixture` (1), `src/notices` (1), `src/preflight` (1) |
| `c03-index` | 266 | `src/commands/pr` (39), `src/next` (32), `src/cli` (17), `src/tests` (16), `src/commands` (15), `src/commands/loop` (15), `src/start` (14), `src/claims` (11), `src/commands/update` (10), `src/status` (9), `src/commands/claim` (8), `src/commands/plan` (7), `src/pr` (7), `src/project` (7), `src/commands/skill` (6), `src/effort/sync` (6), `src/board` (5), `src/cli/core` (5), `src/commands/agent` (5), `src/commands/effort` (4), `src/commands/module` (4), `src/loop` (4), `src/commands/config` (3), `src/commands/issue` (3), `src` (2), `src/modules` (2), `src/utils` (2), `src/adapters/output` (1), `src/commands/instinct` (1), `src/core/adapters` (1), `src/core/command` (1), `src/core/config` (1), `src/core/loop` (1), `src/inventory` (1), `src/modules/testdata/seam-fixture` (1) |
| `c04-sqlite` | 242 | `src/effort/store` (106), `src/effort` (57), `src/commands/effort` (15), `src/tests` (13), `src/triage` (12), `src/inventory/search` (10), `src/core/runtime` (4), `src/effort/store/testdata` (4), `src/commands` (3), `src/effort/sync` (3), `src/report` (3), `src/start` (3), `src/utils` (3), `src/claims` (1), `src/commands/claim` (1), `src/commands/epic` (1), `src/docs` (1), `src/modules/testdata/pull-merge-sync` (1), `src/runtime` (1) |
| `c05-cli-capture` | 226 | `src/tests` (86), `src/release` (48), `src/start` (23), `src/commands/release` (13), `src/core/loop` (9), `src/commands/pr` (8), `src/project` (7), `src/loop` (6), `src/commands` (5), `src/next` (4), `src/runtime` (4), `src` (2), `src/pr` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src/cleanup` (1), `src/commands/bug` (1), `src/commands/stretch` (1), `src/notices` (1), `src/utils` (1) |
| `c06-sections` | 219 | `src/commands` (30), `src` (28), `src/core/config` (27), `src/core/command` (13), `src/tiers` (13), `src/inventory` (12), `src/plan/risk` (10), `src/project` (9), `src/pr` (7), `src/preflight` (7), `src/tests` (7), `src/config` (6), `src/release` (6), `src/schema` (5), `src/agents` (4), `src/check` (4), `src/start` (4), `src/utils` (4), `src/plan` (3), `src/task` (3), `src/board` (2), `src/commands/agent` (2), `src/commands/config` (2), `src/core/loop` (2), `src/effort` (2), `src/effort/store` (2), `src/inventory/search` (2), `src/modules` (2), `src/notices` (1) |
| `c07-types` | 114 | `src/pr` (23), `src/cleanup` (21), `src/commands/pr` (18), `src/pr/triage` (18), `src/cli/prompt` (10), `src/commands` (6), `src/tests` (6), `src/pr/plans` (5), `src/inventory` (2), `src/start` (2), `src/status` (2), `src/board` (1) |
| `c08-frontmatter` | 56 | `src/schema` (11), `src/backfill` (10), `src/demote` (10), `src/errors` (6), `src/commands/skill` (5), `src/tests` (5), `src/check` (4), `src/commands` (2), `src/commands/bug` (1), `src/commands/instinct` (1), `src/inventory` (1) |
| `c09-index` | 49 | `src/commands/plan` (11), `src/plan` (11), `src/board` (10), `src/core/plan` (8), `src/tests` (3), `src/adapters/planner` (2), `src/core/loop` (2), `src` (1), `src/ports` (1) |
| `c10-index` | 46 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `src/core/adapters` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa-sync-service/src/testdata` (1), `src/core/git` (1), `src/effort/store` (1) |
| `c11-start` | 33 | `src/stretch` (13), `src/ci` (7), `src/commands/stretch` (7), `src` (2), `src/commands` (2), `src/commands/ci` (2) |
| `c12-verify` | 29 | `src/refs` (13), `src/tests` (4), `src/commands` (3), `src/board` (2), `src/commands/issue` (2), `src/commands/plan` (2), `src/triage` (2), `src/cli` (1) |
| `c13-sweep-timeout` | 19 | `src/tests` (13), `src/fixtures` (3), `src/commands` (1), `src/effort/store` (1), `src/start` (1) |
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
| 1 | `src/ports/index.ts` | 59493.137119 | `c02-index` |
| 2 | `src/effort/store/merge-store.ts` | 49995.262147 | `c04-sqlite` |
| 3 | `src/core/config/index.ts` | 26085.297012 | `c06-sections` |
| 4 | `src/config-registry.ts` | 24706.534941 | `c06-sections` |
| 5 | `src/tests/cli-capture.ts` | 21822.477197 | `c05-cli-capture` |
| 6 | `src/core/command/index.ts` | 20368.061391 | `c03-index` |
| 7 | `src/inventory/record.ts` | 20045.404589 | `c06-sections` |
| 8 | `src/core/loop/index.ts` | 19937.364163 | `c05-cli-capture` |
| 9 | `src/tiers/routing.ts` | 19635.251564 | `c06-sections` |
| 10 | `src/tiers/resolve.ts` | 18591.80358 | `c06-sections` |
| 11 | `src/board/roadmap.ts` | 18514.982342 | `c01-github` |
| 12 | `src/core/config/core-section.ts` | 17888.921131 | `c06-sections` |
| 13 | `src/adapters/tracker/github.ts` | 17363.995911 | `c01-github` |
| 14 | `src/commands/index.ts` | 14561.360935 | `c03-index` |
| 15 | `src/check/run.ts` | 13353.640043 | `c08-frontmatter` |
| 16 | `src/pr/index.ts` | 13218.439682 | `c03-index` |
| 17 | `src/effort/store/development-build.ts` | 12834.741965 | `c04-sqlite` |
| 18 | `src/board/relations/labels.ts` | 12463.799511 | `c01-github` |
| 19 | `src/start/dispatch.ts` | 12393.434861 | `c02-index` |
| 20 | `src/board/setup.ts` | 12234.345957 | `c01-github` |
| 21 | `src/core/loop/sessions.ts` | 12033.415952 | `c05-cli-capture` |
| 22 | `src/next/sources.ts` | 11910.892458 | `c01-github` |
| 23 | `src/adapter-registry.ts` | 11277.778254 | `c03-index` |
| 24 | `src/start/loop-events.ts` | 10585.364669 | `c02-index` |
| 25 | `src/config-schema-issues.ts` | 10575.557936 | `c06-sections` |
| 26 | `src/effort/store/sqlite.ts` | 10549.117911 | `c04-sqlite` |
| 27 | `src/project/scaffold.ts` | 9821.350688 | `c05-cli-capture` |
| 28 | `src/board/project/refresh.ts` | 9340.973606 | `c01-github` |
| 29 | `src/schema/instinct.ts` | 9194.872612 | `c02-index` |
| 30 | `src/core/config/sections.ts` | 8983.581194 | `c06-sections` |

## Unresolved imports

- `src/tests/package-build.test.ts`: `${DEFINE_CONFIG}`
