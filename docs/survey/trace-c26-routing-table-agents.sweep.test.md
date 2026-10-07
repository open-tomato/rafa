# Trace: `c26-routing-table-agents.sweep.test`

Coverage: 1 of 1 cluster members read, the 1 file `docs/survey/import-graph.json` lists for `c26-routing-table-agents.sweep.test` (`src/tests/routing-table-agents.sweep.test.ts`, 582 lines); it is tracked by `git ls-files`, and no tracked member was left unread. The one member is a test, so no source export was read; the test was read in full as well as through the graph and `docs/survey/test-index.json`, and so was the page it reads (the routing table in `context/workflow.md`, lines 6 to 40).

`c26` ranks 26th of the 32 clusters in the import graph by number, and by size it sits among the 19 one-file clusters (`c14` to `c32`) that follow the twelve real ones; at 582 lines it is the longest of the seven files in this group of traces. Every cluster in the JSON has its own `trace-<cluster>.md` beside this one. 0 edges inside it, 0 leaving, 0 entering; betweenness 0, as for the 992 of the graph's 1577 files that no shortest path runs through. The cluster is **a check that every agent the task-shape routing table names resolves to a real, tracked, correctly named file**: the table in `context/workflow.md` (generated from `DEFAULT_ROUTES` in `src/tiers/routing.ts` by `src/tiers/routing-table.ts`) has five rows today, each pointing at `src/bundled/agents/<name>.md`, and the sweep holds each path tracked in the index, present on disk and named after the agent of its row, and the prose count under the table equal to the row count. Its hub is itself.

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. None has landed, as the earlier traces record, and as rechecked here: `src/steps/` and `src/flows/` do not exist, no source or `package.json` file imports `@open-tomato/define-config` (the name appears only in `src/preflight/prerequisites-md.ts` and two tests, as an npm availability probe in prose), and `gh issue view` shows #118, #119 and #71 still open. This cluster owns none of the four exports; the routing it audits is a config section (`routing`) held by `c03-config`.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src/tests` | 1 | `routing-table-agents.sweep.test.ts`: one `describe` and 20 tests (run: 20 pass, 37 assertions, about 60 ms); 12 exported helper functions (`splitTableRow`, `findRoutingTables`, `classifyHome`, `readRoutingEntries`, `projectRows`, `unrecognisedRows`, `pipeCountOffenders`, `untrackedProjectRows`, `missingProjectFiles`, `mismatchedProjectRows`, `trackedAgentFiles`, `proseCounts`) and six exported types (`TableRow`, `MarkdownTable`, `AgentHome`, `RoutingEntry`, `ProjectRow`, `ProseCount`); nothing outside the file imports any of them |

The 20 tests are ten live claims and ten plants:

| Kind | Tests |
| --- | --- |
| Live claims over the page | finds exactly one routing table with rows; every row splits on the header's pipe count; every agent cell is a single code span; every row has a rafa-tier path; every row carries a path (a live subject); the tracked listing refuses a fabricated member; every row names a file git tracks; every row's file is on disk as well as in the index; each file is named after the agent of its row; the prose under the table states the row count (`The five tracked rows travel`) |
| Plants, each a rewrite of the live page in memory so the real matcher is the one tested | a third column that is not a rafa-tier path; a row pointing at an untracked path; a row pointing at a tracked file of another agent; a pipe inside a cell; a header with no alignment row; a prose count moved off the table's; a prose count written as an unreadable word; a plant target that is not unique on its line; a page carrying two tables; `trackedAgentFiles` over a directory git cannot read (throws) |

The test reads one file as text at load (`context/workflow.md`, through `REPO_ROOT`, `../../` from `src/tests`) and spawns `git ls-files -z -- src/bundled/agents` once at load through `spawnSync`, plus one in a scratch directory made with `mkdtempSync` under `tmpdir()` for the throwing case. It imports `node:child_process`, `node:fs`, `node:os`, `node:path`, `node:url` and `bun:test`, nothing of the project. Its module note carries the reasoning that makes it a sweep rather than a unit test: the subject is the live page, not a fixture (`src/tests/agents-split-accounting.test.ts`, `c18-agents-split-accounting.test`, is the fixture-driven sibling, on purpose), and the claim is two-sided because `git ls-files` reads the index while `existsSync` reads the disk. It also records a mutation grid taken when the file held a "user-level" row form, "not re-run since the file moved to the rafa tier"; that reading is the file's own and is not repeated here.

## What crosses the boundary

- Outbound: none by import. It reaches `context/workflow.md` and `src/bundled/agents/` by path. The generator it holds the page against is `src/tiers/routing-table.ts` (`ROUTING_TABLE_START`, `ROUTING_TABLE_END`, `withRoutingTable`), over `DEFAULT_ROUTES` in `src/tiers/routing.ts`, both in `c03-config`; the only importer of `routing-table.ts` in the graph is `src/tiers/routing-table.test.ts`, which holds the page equal to the generator. This sweep holds what the generated rows claim against the tree; that test holds the page against the generator.
- Inbound: none by import. A comment in `src/tests/default-plan-dirs.sweep.test.ts` names it beside `repo-hygiene.sweep.test.ts` as using the same whitespace-normalised reading, and `context/workflow.md` itself names no test.
- Test reach, from `docs/survey/test-index.json`: index 0, 0 source files reached, no folders; `spawns: true`, through itself (the `git` child), which the index doubles into 0. It is selected by no changed file; it is an always-run sweep by its name (`.sweep.test.ts`, default `tests.alwaysRun` glob `src/**/*.sweep.test.ts` in `src/config-schema-tests.ts`), so every task's scoped run takes it, which is how a task that edits `src/tiers/routing.ts`, the page or an agent file meets it.

## Entry points

An entry point is a member imported from outside the cluster, or a command registered from it. None of its members is imported, including the 18 exports (the helpers are exported for the file's own use and are imported by nothing), 0 registered commands are in it, and it provides no hook or engine. What it stands in front of is a CLI behaviour: its note says an unresolvable `--agent` name exits 1 with no JSON and the whole roster on stderr before any model call, so a row pointing at nothing stops a dispatch; the roster module note (`src/agents/roster.ts`, `c03-config`) records the same behaviour.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | none | a sweep is not a command; the `--agent` name it protects is resolved by `src/utils/claude.ts` and `src/agents/roster.ts`, outside the cluster |
| Steps with guards | **missing** | none | the sweep is a guard on the page, enforced by test; no step with a class |
| Config section | **missing** | none; it reads no key; the `routing` section it audits is `DEFAULT_ROUTES` in `src/tiers/routing.ts` and the rows a project's `.rafa/config.yaml` may add, re-point or remove (`context/workflow.md`), both in `c03-config` | the sweep reads the defaults through the page, not through the section |
| Flows | **missing** | none | no multi-step path is driven; a parse of a table, a listing and a set of comparisons |

### Commands

None. The cluster owns no `RafaCommand`.

### Steps with guards

None registered. The guard here is a page-level one: a generated row (task shape, agent, file) that points at nothing is a red case in the suite instead of a stopped loop. It is a repo check on a doc and a folder.

### Config section

None of its own. The test reads the defaults' rendered form in `context/workflow.md`; it does not read a project's `routing` overrides, which the planner takes from its `{ROUTING}` slot.

### Flows

None.

## Gaps

1. **The sweep binds the page, the generator's output and a folder by literal paths** (cut boundary). `PAGE_PATH = 'context/workflow.md'` and `AGENT_DIR = 'src/bundled/agents'` are constants of `src/tests/routing-table-agents.sweep.test.ts`; `AGENT_PATH_CELL` hard-codes the `src/bundled/agents/<slug>.md` shape. A cut that makes the agents a package (with the rest of `src/bundled/`, which the build copies with `cp -R src/bundled dist/bundled`) moves `AGENT_DIR` and `AGENT_PATH_CELL`, and a cut that moves the workflow page moves `PAGE_PATH`; the generator in `src/tiers/routing-table.ts` has its own matching string for the same path and has to change in the same commit.
2. **The rule and its generator are in different clusters** (cut boundary). The generator and defaults are `c03-config` (`src/tiers/routing.ts`, `routing-table.ts`, `routing-table.test.ts`); the sweep here holds the output against the tree. A cut of the tiers into a package takes `routing-table.test.ts` with it and leaves the sweep, which reads the generated page and the tree, at the repository root or with whichever package owns `src/bundled/agents/`; this is the split to decide before the routing section's file moves.
3. **Six agent files are tracked and five rows name one** (provenance). `git ls-files src/bundled/agents` lists six files (`build-error-resolver`, `code-reviewer`, `doc-updater`, `loop-implementer`, `qa-bug-reporter`, `tdd-guide`) and the table's five rows route to five of them; `qa-bug-reporter` has no row. The sweep checks rows against files, not files against rows, so an agent shipped and never routed is not a red case; `.claude/agents/` also holds symlinks into `src/bundled/agents/` for all six, which no test reads. A cut that wants the "every shipped agent is routed" direction adds it here.
4. **The file is long for one sweep and has 12 exported helpers no one imports** (file size). At 582 lines it is under the 800-line soft ceiling but carries a table parser, a classifier and a plant harness in one file, with 18 exports to a file that nothing imports. A cut that wants the same parsing for another page (`context/` pages with generated tables) lifts `findRoutingTables`, `splitTableRow` and `proseCounts` out as a test-support module; today the file is the only user, and nothing outside it depends on them, so this is not blocking.
5. **No contract surface** (the four exports, all missing). There is nothing to port to `run(ctx, options)`, a step registry or a config section from here.

## Cut order this implies

The sweep waits on two things and blocks nothing: the tiers (`src/tiers/routing*.ts`, `c03-config`) and wherever `src/bundled/agents/` lives. While both stay in this repository it stays at the repository root as a repo-level check on a doc and a folder, in the always-run set. When the tiers become a package it takes `routing-table.test.ts` and the generator with it, and its own literal paths (gap 1) are the last thing to change, after the agents folder has a settled home; it should be green on both sides of that move, since it is the check that a generated row still points at a file that exists.
