# Import graph

Coverage: 1577 of 1577 tracked files read (src/ and packages/*/src/).

1577 files, 8064 edges (6291 value, 1773 type), 32 clusters. Value edges are what `bun build --metafile` records; type edges are the imports `ts.preProcessFile` reads that it does not.

## Clusters by size

| Cluster | Files | Folders |
| --- | --- | --- |
| `c01-github` | 265 | `src/board` (84), `src/commands` (29), `src/tests` (25), `src/commands/epic` (22), `src/board/relations` (19), `src/commands/issue` (19), `src/next` (15), `src/refs` (11), `src/commands/plan` (10), `src/commands/pr` (8), `src/start` (3), `src/adapters/tracker` (2), `src/claims` (2), `src/cli/prompt` (2), `src/commands/board` (2), `src/pr` (2), `src/project` (2), `src/status` (2), `src/suite` (2), `src/triage` (2), `src/plan` (1), `src/plan/risk` (1) |
| `c02-active` | 188 | `src/start` (68), `src/tests` (26), `src/board` (10), `src/learning` (10), `src/plan` (10), `src/utils` (10), `src/commands/instinct` (8), `src/suite` (8), `src/preflight` (7), `src/commands/plan` (6), `src/effort` (5), `src/task` (5), `src/adapters/learning` (4), `src` (2), `src/adapters/planner` (2), `src/pr` (2), `src/report` (2), `src/adapters/output` (1), `src/notices` (1), `src/schema` (1) |
| `c03-config` | 180 | `src` (25), `src/commands` (24), `src/inventory` (13), `src/tiers` (13), `src/inventory/search` (12), `src/tests` (11), `src/plan/risk` (7), `src/commands/agent` (6), `src/commands/skill` (6), `src/start` (6), `src/check` (5), `src/effort` (5), `src/agents` (4), `src/commands/plan` (4), `src/effort/sync` (4), `src/modules` (4), `src/project` (4), `src/schema` (4), `src/utils` (4), `src/effort/store` (3), `src/plan` (3), `src/task` (3), `src/board` (2), `src/adapters` (1), `src/commands/issue` (1), `src/commands/module` (1), `src/modules/testdata/hub-down-sync` (1), `src/modules/testdata/pull-merge-sync` (1), `src/preflight` (1), `src/release` (1), `src/suite` (1) |
| `c04-sqlite` | 163 | `src/effort/store` (81), `src/effort` (28), `src/commands/effort` (15), `src/tests` (7), `src/effort/sync` (5), `src/fixtures` (5), `src/commands` (4), `src/effort/store/testdata` (4), `src/report` (4), `src/cli` (2), `src/runtime` (2), `src/triage` (2), `src/utils` (2), `src/claims` (1), `src/commands/claim` (1) |
| `c05-sessions` | 141 | `src/cleanup` (17), `src/status` (15), `src/commands/loop` (14), `src/loop` (14), `src/next` (13), `src/effort` (12), `src/commands` (10), `src/board` (8), `src/pr` (7), `src/tests` (7), `src/commands/plan` (6), `src/start` (5), `src/commands/pr` (4), `src/project` (3), `src/commands/effort` (2), `src/pr/triage` (2), `src/runtime` (2) |
| `c06-command` | 128 | `src/cli` (20), `src/commands/pr` (18), `src/next` (18), `src/commands` (11), `src/cli/prompt` (10), `src/tests` (9), `src/commands/update` (8), `src/adapters/output` (6), `src/cli/core` (5), `src/pr` (4), `src/board` (3), `src/commands/module` (3), `src/commands/plan` (3), `src/commands/effort` (2), `src/inventory` (2), `src` (1), `src/commands/agent` (1), `src/commands/instinct` (1), `src/commands/loop` (1), `src/modules/testdata/seam-fixture` (1), `src/start` (1) |
| `c07-index` | 127 | `src/pr` (25), `src/commands/pr` (21), `src/pr/triage` (16), `src/claims` (15), `src/start` (13), `src/board` (9), `src/commands/claim` (8), `src/pr/plans` (5), `src/tests` (5), `src/commands/plan` (2), `src/next` (2), `src/schema` (2), `src/status` (2), `src/utils` (2) |
| `c08-cli-capture` | 126 | `src/tests` (71), `src/start` (16), `src/project` (15), `src/commands` (6), `src/commands/pr` (6), `src` (2), `src/commands/release` (2), `src/commands/update` (2), `src/notices` (2), `src/release` (2), `src/commands/instinct` (1), `src/next` (1) |
| `c09-version` | 78 | `src/release` (46), `src/commands/release` (11), `src/commands/pr` (7), `src/start` (6), `src` (2), `src/pr/triage` (2), `src/release/strategies` (2), `src/tests` (2) |
| `c10-index` | 69 | `src/triage` (19), `src/adapters/tracker` (11), `src/commands/issue` (10), `src/tests` (6), `src/board` (5), `src/epic` (4), `src/start` (4), `src/adapters/output` (2), `src/commands/epic` (2), `src/ports` (2), `src/adapters` (1), `src/effort` (1), `src/modules/testdata/sync-fixture` (1), `src/project` (1) |
| `c11-frontmatter` | 46 | `src/backfill` (10), `src/demote` (10), `src/schema` (10), `src/commands/skill` (5), `src/tests` (4), `src/check` (3), `src/commands` (2), `src/commands/instinct` (1), `src/inventory` (1) |
| `c12-index` | 45 | `packages/rafa-hub/src` (11), `packages/rafa-sync-service/src` (9), `packages/rafa-hub/src/identity` (5), `packages/rafa-hub/src/store` (5), `packages/rafa-hub/src/testdata` (5), `packages/rafa-hub/src/identity/testdata` (3), `packages/rafa-hub/src/store/testdata` (2), `src/effort` (2), `packages/rafa-sync-service/src/testdata` (1), `src/effort/store` (1), `src/tests` (1) |
| `c13-main` | 2 | `src/tools/ts-symbols/fixtures/proj/src` (2) |
| `c14-types.test` | 1 | `src/cli/core` (1) |
| `c15-config-schema-readings` | 1 | `src` (1) |
| `c16-store-sources.sweep.test` | 1 | `src/effort/store` (1) |
| `c17-agent-gates.test` | 1 | `src/tests` (1) |
| `c18-agents-split-accounting.test` | 1 | `src/tests` (1) |
| `c19-context-page-imports.sweep.test` | 1 | `src/tests` (1) |
| `c20-epic-guard-workflow.test` | 1 | `src/tests` (1) |
| `c21-eslint-stand-in` | 1 | `src/tests` (1) |
| `c22-git-identity.sweep.test` | 1 | `src/tests` (1) |
| `c23-learning-boundary.test` | 1 | `src/tests` (1) |
| `c24-relations-import-boundary.sweep.test` | 1 | `src/tests` (1) |
| `c25-repo-hygiene.sweep.test` | 1 | `src/tests` (1) |
| `c26-routing-table-agents.sweep.test` | 1 | `src/tests` (1) |
| `c27-skill-gap-section.test` | 1 | `src/tests` (1) |
| `c28-spawned-exit-code.sweep.test` | 1 | `src/tests` (1) |
| `c29-sweep-suffix.sweep.test` | 1 | `src/tests` (1) |
| `c30-verify-workflow.test` | 1 | `src/tests` (1) |
| `c31-cli.test` | 1 | `src/tools/ts-symbols` (1) |
| `c32-cli` | 1 | `src/tools/ts-symbols` (1) |

## The 30 files of highest betweenness

| Rank | File | Betweenness | Cluster |
| --- | --- | --- | --- |
| 1 | `src/commands/index.ts` | 193950.328716 | `c06-command` |
| 2 | `src/commands/plan/refs-check.ts` | 186043.314455 | `c01-github` |
| 3 | `src/commands/doctor-refs.ts` | 185424.296864 | `c01-github` |
| 4 | `src/commands/issue/issue-tracker.ts` | 137956.4965 | `c01-github` |
| 5 | `src/commands/issue/unblock.ts` | 102640.727188 | `c01-github` |
| 6 | `src/board/relations/labels.ts` | 102158.789817 | `c01-github` |
| 7 | `src/refs/extract.ts` | 82399.202061 | `c01-github` |
| 8 | `src/board/issue.ts` | 70800.005855 | `c01-github` |
| 9 | `src/refs/stamp.ts` | 70275.466585 | `c01-github` |
| 10 | `src/board/roadmap.ts` | 42781.12857 | `c01-github` |
| 11 | `src/board/roadmap-rows.ts` | 42679.823139 | `c01-github` |
| 12 | `src/ports/index.ts` | 39489.687191 | `c10-index` |
| 13 | `src/board/setup.ts` | 32116.208421 | `c01-github` |
| 14 | `src/effort/store/merge-store.ts` | 31717.131922 | `c04-sqlite` |
| 15 | `src/next/sources.ts` | 26155.056647 | `c05-sessions` |
| 16 | `src/start/dispatch.ts` | 22656.02615 | `c02-active` |
| 17 | `src/commands/epic/show.ts` | 22358.058325 | `c01-github` |
| 18 | `src/commands/loop/start.ts` | 21780.646544 | `c06-command` |
| 19 | `src/board/place.ts` | 21109.843242 | `c01-github` |
| 20 | `src/start.ts` | 20063.329486 | `c02-active` |
| 21 | `src/board/issue-board.ts` | 20046.689444 | `c07-index` |
| 22 | `src/config-schema.ts` | 18676.077562 | `c03-config` |
| 23 | `src/commands/doctor.ts` | 18030.005755 | `c03-config` |
| 24 | `src/commands/epic/close.ts` | 14862.95703 | `c10-index` |
| 25 | `src/config.ts` | 14852.556167 | `c03-config` |
| 26 | `src/start/preflight.ts` | 14710.694528 | `c02-active` |
| 27 | `src/start/preflight-drift.ts` | 14277.152814 | `c01-github` |
| 28 | `src/inventory/record.ts` | 14001.874545 | `c03-config` |
| 29 | `src/tests/cli-capture.ts` | 13716.348752 | `c08-cli-capture` |
| 30 | `src/adapters/registry.ts` | 13578.923549 | `c03-config` |

## Known suspects

Four parts of the tree were suspected before the survey ran of not
fitting one package each. This section is written by hand from
`import-graph.json` and `test-index.json` at the same commit, not by
`scripts/survey/import-graph.ts`: a rerun of that script rewrites this
file without it.

How to read the columns:

- A rank is the file's place among all 1577 files by betweenness, score
  descending and path ascending on a tie, the same order as the table
  above. Only 585 files score above zero, so a rank past 585 is a tie
  at zero broken by path and says nothing.
- Test-index reach for source files is the number of the 908 test
  files whose transitive imports reach at least one of them (the
  `tests` lists in `test-index.json`, joined), and how many of those
  tests sit in a different folder from the file they reach. For
  test-support files it counts the tests that list one of them under
  `support`, since `test-index.ts` keeps support files out of a test's
  index.

| Suspect | Files | Clusters (files) | Top betweenness rank | Test-index reach |
| --- | --- | --- | --- | --- |
| `src/config-schema*.ts` | 14 (7 source, 7 test) | `c03-config` (13), `c15-config-schema-readings` (1) | 22, `src/config-schema.ts`; then 350, 381, 429; 6 of 14 above zero | 756 tests, 743 from other folders; each of the six schema modules reaches all 756 |
| `src/commands/` | 336 (158 source, 178 test) | `c01-github` (90), `c06-command` (48), `c03-config` (42), `c05-sessions` (36), `c07-index` (31), `c04-sqlite` (20), `c09-version` (18), `c08-cli-capture` (17), `c02-active` (14), `c10-index` (12), `c11-frontmatter` (8) | 1 to 5: `index.ts`, `plan/refs-check.ts`, `doctor-refs.ts`, `issue/issue-tracker.ts`, `issue/unblock.ts`; 9 in the top 30, 29 in the top 100 | 500 tests, 477 from other folders; the widest single file, `plan/plan-files.ts`, reaches 427 |
| `src/adapters` | 30 (14 source, 15 test, 1 test-support) | `c10-index` (14), `c02-active` (7), `c06-command` (6), `c01-github` (2), `c03-config` (1) | 30, `registry.ts`; then 46 (`tracker/github.ts`), 58 (`output/active.ts`), 98 (`learning/local.ts`) | 756 tests, 752 from other folders; the support file is listed by 16 tests, 12 outside `src/adapters` |
| `src/tests` | 188 (172 test, 16 test-support, no source) | `c08-cli-capture` (71), `c02-active` (26), `c01-github` (25), `c03-config` (11), `c06-command` (9), `c04-sqlite` (7), `c05-sessions` (7), `c10-index` (6), `c07-index` (5), `c11-frontmatter` (4), `c09-version` (2), `c12-index` (1), and 14 one-file clusters `c17` to `c30` | 29, `cli-capture.ts`; then 163 (`next-chain-fixtures.ts`), 208 (`output-sinks.ts`) | no source file; the 16 support files are listed by 394 tests, 266 outside `src/tests`; its own 172 tests have indexes from 0 to 128, median 48 |

What the rows show:

- `src/config-schema*.ts` mostly stayed together: 13 of its 14 files
  are in `c03-config`, whose hub is `src/config.ts`. The one outside,
  `src/config-schema-readings.ts`, is a note module that exports nothing
  and is imported by nothing. It is a one-file cluster and one of the
  three source files no test reaches.
- `src/commands/` splits across eleven clusters. Its largest group, 90
  files, sits in `c01-github` with the board and issue code it drives.
  It also holds the top five files of the whole graph by betweenness.
- `src/adapters` splits five ways, and its 14 files in `c10-index` sit
  beside `src/ports/index.ts`, that cluster's hub. The hub of the
  largest cluster, `c01-github`, is `src/adapters/tracker/github.ts`.
- `src/tests` spreads over 26 clusters. 71 of its files gather around
  `src/tests/cli-capture.ts`, the hub of `c08-cli-capture`. Thirteen
  of its tests and one support file, `src/tests/eslint-stand-in.mjs`,
  have no edge to or from any other file in scope, and each makes a
  one-file cluster.
