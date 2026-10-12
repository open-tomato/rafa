# Content schema importers

This page is the importers stage of the content-schema plan (rafa-907, under epic #801). For each non-test file under
`src/schema/`, it lists the files that import it, grouped by the future package each would sit in, and the files it
imports from outside its folder. Each edge that would point upward once the packages are cut is marked **upward**. The
tree is read at commit 83e438e. A content schema is a frontmatter or record schema for a file rafa reads, such as a
skill, an agent or an instinct. The decision stage of the plan comes after this page.

## How the rows were read
- **Importers.** The edges come from the import graph reader of `scripts/survey/import-graph.ts`, run over the tracked
  files of `src/` and of each packages/<name>/src/ at 83e438e. Each file's imports are the ones `bun build --metafile`
  records, plus the `import type`, `export … from` and `import()` specifiers in its text. Each edge is labelled
  `value` or `type`, and a pair of files holds one edge, labelled `value` when either reading finds a value import.
- **Tests.** A file `classifyFile` of `scripts/survey/files.ts` calls `test` is not listed, and test importers are not
  counted. No `test-support` file imports the folder. A grep of every other tracked file for a schema folder path
  finds no code importer outside `src/`: only data files and context pages name the folder.
- **Not from the JSON.** `docs/survey/import-graph.json` has no entry for `src/schema/scope-records.ts` or its test,
  so its rows were read from the tree. `docs/survey/cluster-map.json` has no cluster for `scope-records.ts` either.
- **External packages.** Imports of node builtins and npm packages are not edges, so they are not listed. Every
  in-repo import that leaves the folder is listed.
- **Packages.** A file goes to the future package its folder is named for in #905's cut table (its item 4). The core
  files of its item 1 go to core, under their current paths, since they have not moved. A file that no list names is
  "what is left", which #905 gives to @open-tomato/rafa-cli. The `src/stretch/` folder has no package yet, so its
  two importers are shown as unassigned.
- **Upward.** Core is the lowest package. Above it, the layer order is the one #905 cites from the survey, `core < c5
  < c4 < c1 < c3 < c6 < c8 < c7 < c2`, read by package: rafa-effort is c5, rafa-inventory c4, rafa-board and rafa-pr
  c1, rafa-run c3, rafa-release c8, and the CLI c2 at the top. An edge is upward when its importer's package sits
  below its target's. The plan gate (`src/plan/`) has no package in the cut table and counts as what is left.
- **Clusters.** Each importer line carries its cluster from `docs/survey/cluster-map.json` as a second reading. Read
  by cluster instead of package, every mark below holds except the first upward edge, which exists only after the move
  into core.

## Totals by package

| Future package | Importer files | Edges into the folder |
| --- | --- | --- |
| @open-tomato/rafa (core) | 2 | 2 |
| rafa-effort | 1 | 3 |
| rafa-inventory | 20 | 35 |
| rafa-board | 1 | 1 |
| rafa-pr | 3 | 3 |
| @open-tomato/rafa-cli (what is left) | 20 | 27 |
| unassigned (no package yet) | 2 | 2 |
| Total | 49 | 73 |

Ten non-test files sit under `src/schema/`: `agent.ts`, `failure-strings.ts`, `frontmatter.ts`, `instinct.ts`,
`project-id.ts`, `provenance.ts`, `scope-records.ts`, `skill.ts`, `stack.ts` and `tiers.ts`. Eight edges run between
them and five leave the folder; they are listed in their sections, apart from the importers.

## Upward edges

Six edges are marked upward. Each is named once here, from the importer's side. None is repaired by this page.

1. `src/config-sections.ts` imports `src/schema/tiers.ts` (value). #905 item 1 moves this file into core, and core
   would then import rafa-inventory, the edge the cut must not create. Its cluster is c1 today, so the edge is upward
   only at the move.
2. `src/effort/store/store-identity.ts` imports `src/schema/project-id.ts` (value). The effort store is core, so this
   is the same kind of edge. The survey places `project-id.ts` in cluster c1, though its folder is `src/schema/`.
3. `src/effort/report-skills.ts` imports `src/schema/frontmatter.ts` and `src/schema/scope-records.ts` (value) and
   `src/schema/tiers.ts` (type). The effort report library sits below rafa-inventory in the survey order, c5 below c4.
4. `src/schema/agent.ts` imports `src/utils/declaration.ts` (value). No list names that file, so it counts as what is
   left, at the top of the order. It stays upward if the file goes to rafa-run instead, the cluster it sits in now
   (c3).

Not marked: `src/stretch/operators.ts` and `src/stretch/prompt.ts` import `src/schema/tiers.ts`, but the stretch
folder has no package and no rank. `src/report/lessons.ts` imports `src/schema/instinct.ts` (type) and counts as what
is left: the cut table names only `src/report/parse.ts` and `src/report/record.ts`, and both go to core. Its cluster
is c4, the inventory's, and the edge is not upward under either reading.

## Sections

### `src/schema/agent.ts`

Importers outside the folder: none (its test importers are not listed).

Imported from inside the folder: none.

Its own imports leaving the folder, by the target's future package:

**@open-tomato/rafa-cli (what is left)**
- `src/utils/declaration.ts`: value, cluster c3 — **upward**

Its own imports inside the folder, listed apart: `src/schema/provenance.ts` (value).

### `src/schema/failure-strings.ts`

Importers outside the folder: none (its test importers are not listed).

Imported from inside the folder, listed apart: `src/schema/skill.ts` (value).

Its own imports leaving the folder: none.

Its own imports inside the folder: none.

### `src/schema/frontmatter.ts`

Importers outside the folder, by future package:

**rafa-effort**
- `src/effort/report-skills.ts`: value, cluster c5 — **upward**

**rafa-inventory**
- `src/agents/roster.ts`: value, cluster c4
- `src/backfill/derive.ts`: value, cluster c4
- `src/backfill/proposal-batch.ts`: value, cluster c4
- `src/backfill/proposal-file.ts`: value, cluster c4
- `src/backfill/propose.ts`: value, cluster c4
- `src/check/run.ts`: value, cluster c4
- `src/demote/classify.ts`: value, cluster c4
- `src/demote/report.ts`: value, cluster c4
- `src/demote/select.ts`: value, cluster c4
- `src/inventory/disabled.ts`: value, cluster c4
- `src/inventory/record.ts`: value, cluster c4
- `src/inventory/search/rank.ts`: value, cluster c4
- `src/inventory/show.ts`: value, cluster c2
- `src/tiers/serve.ts`: value, cluster c4

**@open-tomato/rafa-cli (what is left)**
- `src/commands/doctor-tiers.ts`: value, cluster c4
- `src/plan/needs.ts`: value, cluster c4
- `src/utils/agent-definition.ts`: value, cluster c4

Imported from inside the folder, listed apart: `src/schema/instinct.ts` (value).

Its own imports leaving the folder: none.

Its own imports inside the folder: none.

### `src/schema/instinct.ts`

Importers outside the folder, by future package:

**rafa-inventory**
- `src/check/run.ts`: value, cluster c4
- `src/demote/classify.ts`: value, cluster c4
- `src/demote/select.ts`: type, cluster c4

**@open-tomato/rafa-cli (what is left)**
- `src/adapters/learning/held.ts`: type, cluster c4
- `src/adapters/learning/local.ts`: value, cluster c4
- `src/commands/instinct/list.ts`: type, cluster c2
- `src/commands/instinct/show.ts`: value, cluster c2
- `src/commands/skill/backfill.ts`: type, cluster c4
- `src/commands/skill/demote.ts`: type, cluster c4
- `src/report/lessons.ts`: type, cluster c4

Imported from inside the folder, listed apart: `src/schema/scope-records.ts` (value).

Its own imports leaving the folder, by the target's future package:

**@open-tomato/rafa (core)**
- `src/ports/index.ts`: type, outside the cluster map
- `src/report/parse.ts`: value, cluster c5

**rafa-inventory**
- `src/learning/identity.ts`: value, cluster c4

Its own imports inside the folder, listed apart: `src/schema/frontmatter.ts` (value), `src/schema/project-id.ts`
(value).

### `src/schema/project-id.ts`

Importers outside the folder, by future package:

**@open-tomato/rafa (core)**
- `src/effort/store/store-identity.ts`: value, cluster c5 — **upward**

**rafa-board**
- `src/board/plan-spec.ts`: value, cluster c6

**rafa-pr**
- `src/commands/pr/triage-trust.ts`: value, cluster c1
- `src/pr/none.ts`: value, cluster c1
- `src/pr/provider.ts`: value, cluster c1

**@open-tomato/rafa-cli (what is left)**
- `src/commands/init.ts`: value, cluster c1
- `src/commands/update/current.ts`: value, cluster c1
- `src/plan/risk/accounts.ts`: value, cluster c1

Imported from inside the folder, listed apart: `src/schema/instinct.ts` (value).

Its own imports leaving the folder: none.

Its own imports inside the folder: none.

### `src/schema/provenance.ts`

Importers outside the folder, by future package:

**rafa-inventory**
- `src/tiers/serve.ts`: value, cluster c4

**@open-tomato/rafa-cli (what is left)**
- `src/commands/doctor-tiers.ts`: value, cluster c4

Imported from inside the folder, listed apart: `src/schema/agent.ts` (value), `src/schema/skill.ts` (value).

Its own imports leaving the folder: none.

Its own imports inside the folder: none.

### `src/schema/scope-records.ts`

Importers outside the folder, by future package:

**rafa-effort**
- `src/effort/report-skills.ts`: value, cluster c5 — **upward**

**@open-tomato/rafa-cli (what is left)**
- `src/adapters/learning/local.ts`: value, cluster c4
- `src/commands/instinct/instinct-records.ts`: type, cluster c4
- `src/commands/instinct/list.ts`: value, cluster c2
- `src/commands/instinct/show.ts`: value, cluster c2

Imported from inside the folder: none.

Its own imports leaving the folder, by the target's future package:

**rafa-inventory**
- `src/check/layout.ts`: value, cluster c4

Its own imports inside the folder, listed apart: `src/schema/instinct.ts` (value), `src/schema/tiers.ts` (value).

### `src/schema/skill.ts`

Importers outside the folder, by future package:

**rafa-inventory**
- `src/backfill/derive.ts`: value, cluster c4
- `src/backfill/proposal-batch.ts`: value, cluster c4
- `src/backfill/proposal-file.ts`: value, cluster c4
- `src/backfill/propose.ts`: value, cluster c4
- `src/check/run.ts`: value, cluster c4
- `src/inventory/record.ts`: value, cluster c4
- `src/task/skill-index.ts`: value, cluster c4

Imported from inside the folder: none.

Its own imports leaving the folder: none.

Its own imports inside the folder, listed apart: `src/schema/failure-strings.ts` (value), `src/schema/provenance.ts`
(value), `src/schema/stack.ts` (value).

### `src/schema/stack.ts`

Importers outside the folder, by future package:

**rafa-inventory**
- `src/backfill/derive.ts`: value, cluster c4
- `src/check/references.ts`: value, cluster c4
- `src/check/run.ts`: value, cluster c4

Imported from inside the folder, listed apart: `src/schema/skill.ts` (value).

Its own imports leaving the folder: none.

Its own imports inside the folder: none.

### `src/schema/tiers.ts`

Importers outside the folder, by future package:

**@open-tomato/rafa (core)**
- `src/config-sections.ts`: value, cluster c1 — **upward**

**rafa-effort**
- `src/effort/report-skills.ts`: type, cluster c5 — **upward**

**rafa-inventory**
- `src/agents/roster.ts`: value, cluster c4
- `src/inventory/disabled.ts`: type, cluster c4
- `src/inventory/index.ts`: value, cluster c4
- `src/inventory/trees.ts`: value, cluster c4
- `src/task/skill-index.ts`: value, cluster c4
- `src/tiers/resolve.ts`: value, cluster c4
- `src/tiers/routing.ts`: type, cluster c1

**@open-tomato/rafa-cli (what is left)**
- `src/adapters/learning/local.ts`: value, cluster c4
- `src/commands/agent/list.ts`: value, cluster c2
- `src/commands/agent/vendor.ts`: type, cluster c4
- `src/commands/instinct/show.ts`: type, cluster c2
- `src/commands/skill/list.ts`: value, cluster c2
- `src/plan.ts`: value, cluster c6
- `src/plan/needs.ts`: value, cluster c4
- `src/plan/risk.ts`: value, cluster c4
- `src/utils/session-env.ts`: value, cluster c4

**unassigned (no package yet)**
- `src/stretch/operators.ts`: value, not in the cluster map
- `src/stretch/prompt.ts`: value, not in the cluster map

Imported from inside the folder, listed apart: `src/schema/scope-records.ts` (value).

Its own imports leaving the folder: none.

Its own imports inside the folder: none.
