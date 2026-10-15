# Import graph

Coverage: 1982 of 1982 tracked files read (src/ and packages/*/src/).

1982 files, 10333 edges (8104 value, 2229 type), 27 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 319 | `src/board` (119), `src/commands/epic` (27), `src/commands` (24), `src/commands/issue` (24), `src/tests` (24), `src/board/relations` (19), `src/next` (18), `src/status` (11), `src/commands/plan` (10), `src/board/project` (8), `src/claims` (6), `src/commands/pr` (6), `src/core/git` (6), `src/epic` (4), `src/suite` (4), `src/pr` (3), `src/adapters/tracker` (2), `src/commands/board` (2), `src/project` (2) |
| `c02-index` | 304 | `src/start` (112), `src/tests` (24), `src/triage` (23), `src/adapters/tracker` (15), `src/adapters/logger` (12), `src/bugs` (11), `src/commands/issue` (10), `src/learning` (10), `src/commands/instinct` (9), `src/suite` (9), `src/core/output` (7), `src/utils` (6), `src/adapters/output` (5), `src/docs` (5), `src/task` (5), `src/adapters/learning` (4), `src/core/adapters` (4), `src/effort/sync` (3), `src/report` (3), `src/schema` (3), `src` (2), `src/commands/docs` (2), `src/commands/release` (2), `src/fixtures` (2), `src/ports` (2), `src/project` (2), `src/cli` (1), `src/commands/epic` (1), `src/commands/plan` (1), `src/core/git` (1), `src/core/loop` (1), `src/core/plan` (1), `src/modules` (1), `src/modules/testdata/hub-down-sync` (1), `src/modules/testdata/pull-merge-sync` (1), `src/modules/testdata/sync-fixture` (1), `src/notices` (1), `src/preflight` (1) |
| `c03-index` | 278 | `src/commands/pr` (41), `src/next` (30), `src/start` (26), `src/cli` (19), `src/tests` (19), `src/commands` (12), `src/claims` (11), `src/cli/prompt` (10), `src/commands/update` (10), `src/core/command` (9), `src/project` (9), `src/commands/claim` (8), `src/commands/loop` (8), `src/commands/plan` (7), `src/status` (7), `src/commands/skill` (6), `src/pr` (6), `src/board` (5), `src/cli/core` (5), `src/commands/agent` (5), `src/commands/module` (4), `src/inventory` (3), `src` (2), `src/commands/config` (2), `src/commands/effort` (2), `src/commands/issue` (2), `src/loop` (2), `src/modules` (2), `src/adapters/output` (1), `src/commands/instinct` (1), `src/core/config` (1), `src/core/loop` (1), `src/modules/testdata/seam-fixture` (1), `src/utils` (1) |
| `c04-sqlite` | 238 | `src/effort/store` (103), `src/effort` (57), `src/commands/effort` (16), `src/tests` (13), `src/triage` (12), `src/inventory/search` (10), `src/core/runtime` (4), `src/effort/store/testdata` (4), `src/effort/sync` (3), `src/report` (3), `src/start` (3), `src/utils` (3), `src/commands` (2), `src/claims` (1), `src/commands/claim` (1), `src/commands/epic` (1), `src/docs` (1), `src/runtime` (1) |
| `c05-cli-capture` | 225 | `src/tests` (87), `src/release` (48), `src/start` (23), `src/commands/release` (13), `src/commands/pr` (8), `src/commands/loop` (7), `src/loop` (6), `src/commands` (5), `src/project` (4), `src/runtime` (4), `src/utils` (3), `src` (2), `src/next` (2), `src/pr` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src/cleanup` (1), `src/commands/bug` (1), `src/commands/config` (1), `src/commands/effort` (1), `src/commands/stretch` (1), `src/core/loop` (1), `src/notices` (1) |
| `c06-index` | 212 | `src/commands` (34), `src` (28), `src/core/config` (27), `src/tiers` (13), `src/inventory` (12), `src/plan/risk` (10), `src/project` (10), `src/pr` (7), `src/preflight` (7), `src/tests` (7), `src/config` (6), `src/release` (6), `src/schema` (5), `src/agents` (4), `src/check` (4), `src/start` (4), `src/utils` (4), `src/effort/store` (3), `src/effort/sync` (3), `src/plan` (3), `src/task` (3), `src/board` (2), `src/commands/agent` (2), `src/commands/config` (2), `src/effort` (2), `src/inventory/search` (2), `src/modules` (1), `src/notices` (1) |
| `c07-types` | 117 | `src/pr` (24), `src/cleanup` (21), `src/commands/pr` (18), `src/pr/triage` (18), `src/tests` (15), `src/commands` (7), `src/pr/plans` (5), `src/fixtures` (3), `src/start` (3), `src/board` (1), `src/effort/store` (1), `src/status` (1) |
| `c08-frontmatter` | 56 | `src/schema` (11), `src/backfill` (10), `src/demote` (10), `src/errors` (6), `src/commands/skill` (5), `src/tests` (5), `src/check` (4), `src/commands` (2), `src/commands/bug` (1), `src/commands/instinct` (1), `src/inventory` (1) |
| `c09-port` | 52 | `src/board/project` (33), `src/commands` (7), `src/commands/issue` (3), `src/tests` (3), `src/commands/board` (2), `src/commands/release` (2), `src/start` (2) |
| `c10-index` | 49 | `src/commands/plan` (11), `src/plan` (11), `src/board` (10), `src/core/plan` (8), `src/tests` (3), `src/adapters/planner` (2), `src/core/loop` (2), `src` (1), `src/ports` (1) |
| `c11-index` | 44 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `src/effort/store` (3), `packages/rafa-hub/src/store/testdata` (2), `packages/rafa-sync-service/src/testdata` (1) |
| `c12-folder` | 44 | `src/stretch` (13), `src/core/loop` (9), `src/ci` (7), `src/commands/stretch` (7), `src` (2), `src/commands` (2), `src/commands/ci` (2), `src/loop` (2) |
| `c13-verify` | 29 | `src/refs` (13), `src/tests` (4), `src/commands` (3), `src/board` (2), `src/commands/issue` (2), `src/commands/plan` (2), `src/triage` (2), `src/cli` (1) |
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
| 1 | `src/ports/index.ts` | 59252.324288 | `c02-index` |
| 2 | `src/effort/store/merge-store.ts` | 49772.423186 | `c04-sqlite` |
| 3 | `src/core/config/index.ts` | 26038.965759 | `c06-index` |
| 4 | `src/config-registry.ts` | 24681.737197 | `c06-index` |
| 5 | `src/core/loop/index.ts` | 21708.892036 | `c05-cli-capture` |
| 6 | `src/tests/cli-capture.ts` | 21688.683078 | `c05-cli-capture` |
| 7 | `src/core/command/index.ts` | 21264.157672 | `c03-index` |
| 8 | `src/inventory/record.ts` | 19302.939509 | `c06-index` |
| 9 | `src/board/roadmap.ts` | 18863.228365 | `c01-github` |
| 10 | `src/tiers/routing.ts` | 18821.368788 | `c06-index` |
| 11 | `src/tiers/resolve.ts` | 17782.889538 | `c06-index` |
| 12 | `src/adapters/tracker/github.ts` | 17408.806435 | `c01-github` |
| 13 | `src/core/config/core-section.ts` | 17036.581179 | `c06-index` |
| 14 | `src/commands/index.ts` | 14553.799893 | `c03-index` |
| 15 | `src/pr/index.ts` | 13320.621041 | `c03-index` |
| 16 | `src/effort/store/development-build.ts` | 13027.361593 | `c04-sqlite` |
| 17 | `src/check/run.ts` | 12608.574964 | `c08-frontmatter` |
| 18 | `src/board/relations/labels.ts` | 12480.233638 | `c01-github` |
| 19 | `src/core/loop/sessions.ts` | 12388.3415 | `c12-folder` |
| 20 | `src/start/dispatch.ts` | 12317.730959 | `c02-index` |
| 21 | `src/board/setup.ts` | 12266.875185 | `c01-github` |
| 22 | `src/next/sources.ts` | 11765.345408 | `c01-github` |
| 23 | `src/adapter-registry.ts` | 11293.454677 | `c03-index` |
| 24 | `src/project/scope.ts` | 10737.805366 | `c03-index` |
| 25 | `src/effort/store/sqlite.ts` | 10725.701729 | `c04-sqlite` |
| 26 | `src/config-schema-issues.ts` | 10582.645762 | `c06-index` |
| 27 | `src/start/loop-events.ts` | 10463.281364 | `c02-index` |
| 28 | `src/project/scaffold.ts` | 10047.928501 | `c05-cli-capture` |
| 29 | `src/core/command/command.ts` | 9710.697847 | `c03-index` |
| 30 | `src/board/project/refresh.ts` | 9355.35932 | `c09-port` |

## Unresolved imports

- `src/tests/package-build.test.ts`: `${DEFINE_CONFIG}`
