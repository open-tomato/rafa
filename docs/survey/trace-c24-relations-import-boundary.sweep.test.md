# Trace: `c24-relations-import-boundary.sweep.test`

Coverage: 1 of 1 cluster members read, the 1 file `docs/survey/import-graph.json` lists for `c24-relations-import-boundary.sweep.test` (`src/tests/relations-import-boundary.sweep.test.ts`, 185 lines); it is tracked by `git ls-files`, and no tracked member was left unread. The one member is a test, so no source export was read; the test was read in full as well as through the graph and `docs/survey/test-index.json`, and the 24 files it lists were each placed in their cluster from the graph.

`c24` ranks 24th of the 32 clusters in the import graph by number, and by size it sits among the 19 one-file clusters (`c14` to `c32`) that follow the twelve real ones; every cluster in the JSON has its own `trace-<cluster>.md` beside this one. 0 edges inside it, 0 leaving, 0 entering; betweenness 0, as for the 992 of the graph's 1577 files that no shortest path runs through. The cluster is **a closed-set audit of who may import four board names**: it reads every non-test `.ts` file under `src/` as text and asserts that `EPIC_LABEL_PREFIX`, `SPEC_BLOCKED_LABEL`, `groupByEpicLabel` and `readBlockedBy` (defined in `src/board/epics.ts` and `src/board/blocked.ts`, `c01-github`) are imported by nothing outside `src/board/relations/` except the 24 files of an allow-list, each with its reason, and that every allow-list entry still imports one. It closes "Stage: Readers behind the port" of the relationships plan (`.rafa/plans/PLAN-rafa-340-relationships-epics-blockers-github.md`, which the module note cites and which is gitignored, so it is not in a checkout). Its hub is itself.

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. None has landed, as the earlier traces record, and as rechecked here: `src/steps/` and `src/flows/` do not exist, no source or `package.json` file imports `@open-tomato/define-config` (the name appears only in `src/preflight/prerequisites-md.ts` and two tests, as an npm availability probe in prose), and `gh issue view` shows #118, #119 and #71 still open. This cluster owns none of the four exports; it holds a boundary of the board package, the board's port for relationships (`src/board/relations/`), and that boundary is what a cut of the board has to carry.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src/tests` | 1 | `relations-import-boundary.sweep.test.ts`: two `describe` blocks and 4 tests (run: 4 pass, 5 assertions, about 0.9 s), the constants `TRACKED_NAMES`, `EPICS_MODULE`, `BLOCKED_MODULE` and the frozen `ALLOWED_IMPORTERS`, and the helpers `listSourceFiles`, `resolvedImportTarget`, `trackedImportsOf` and `srcRelative` |

The two blocks:

| Block | Test | What it asserts |
| --- | --- | --- |
| `the board relationship symbols stay behind the port` | finds every current importer | the scan is not vacuous: at least one importer exists and `board/relations/labels.ts` is one |
| | imports the four names from no file outside the allow-list | the files outside `src/board/relations/` that import a tracked name are all in `ALLOWED_IMPORTERS` |
| | carries no stale entry | every `ALLOWED_IMPORTERS` path still imports a tracked name, so the list stays honest in both directions |
| `the labels baseline captures` | still match | spawns `bun test src/tests/relations-labels-baseline.test.ts` (`execFileSync`, `timeout: 150_000`) and expects no throw: a passing exit is "the labels-mode captures still match" |

The 24 allowed importers sit in four clusters: `c01-github` 20 (`board/epics.ts`, `epic-walk.ts`, `epic-context.ts`, `epic-dependents.ts`, `epic-problems.ts`, `roadmap-rows.ts`, `blocked-line.ts`, `setup.ts`; `status/blocked-count.ts`; `commands/doctor-blocked.ts`, `doctor-epics.ts`, `doctor-marks.ts`; `commands/epic/move.ts`, `new.ts`, `cancel.ts`, `cancel-unblock.ts`; `commands/pr/merge-tick.ts`; `commands/issue/roadmap-epic-table.ts`, `unblock.ts`; `suite/owns.ts`), `c10-index` 2 (`commands/epic/close.ts`, `commands/issue/create-blocked.ts`), `c05-sessions` 1 (`status/render.ts`) and `c06-command` 1 (`next/state.ts`). Every one is the labels-mode half of a reader that branches on `relations.mode`, or a labels-only write the port has no native counterpart for yet; the reasons are in the file's own table. `src/board/relations/` is exempt as a directory: 19 files, 10 of them source, all in `c01-github`.

The test imports `node:child_process`, `node:fs`, `node:path`, `node:url` and `bun:test`, nothing of the project. It matches the statement `import [type] { ... } from '<relative>'` against the two defining modules by resolved path (a `.js` specifier read as `.ts`), so a default import, `import * as`, a dynamic `import()` or a re-export (`export { ... } from`) of the names is not seen.

## What crosses the boundary

- Outbound: none by import. The test reaches 24 allow-listed files and two defining modules by path, and the baseline test by a spawned process: `src/tests/relations-labels-baseline.test.ts` (`c08-cli-capture`), a golden-capture harness that runs `rafa roadmap`, `rafa roadmap --full`, `rafa next --dry-run` and `rafa plan create --next --dry-run` over a fixture labels board and diffs stdout and the stand-in `gh` call log against committed files under `src/tests/fixtures/relations-labels/`.
- Inbound: none. Nothing imports a test.
- Test reach, from `docs/survey/test-index.json`: index 0, 0 source files reached, no folders; `spawns: true`, through itself (the `bun test` child), which the index doubles into 0. The index sees no import, so it reads 0 here, and the nested baseline run (a CLI-capture test of `c08-cli-capture`) is invisible to it. The sweep is selected by no changed file; it is an always-run sweep by its name (`.sweep.test.ts`, default `tests.alwaysRun` glob `src/**/*.sweep.test.ts` in `src/config-schema-tests.ts`), so every task's scoped run takes it, and takes the nested baseline run with it.

## Entry points

An entry point is a member imported from outside the cluster, or a command registered from it. None of its members is imported, 0 registered commands are in it, and it provides no hook or engine. Its entry is the runner and the always-run line. `ALLOWED_IMPORTERS` is the only list in the repository of the files that read a relationship by its labels, which makes it the nearest thing to an entry point for the question "what has to change to drop the labels mode".

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | none | a sweep is not a command; it audits the files behind `epic move`, `epic new`, `epic close`, `epic cancel`, `issue unblock`, `issue create` and the epic tick of `pr merge`, whose files are in `c01-github` and `c10-index` |
| Steps with guards | **missing** | none | the allow-list is a guard on imports, enforced by test, not a step with a class; the baseline spawn is a check run beside it |
| Config section | **missing** | none | it reads no key; the mode it audits, `board.relationships` (`src/config-schema.ts`, `c03-config`), selects the branch the allow-listed files keep |
| Flows | **missing** | none | no multi-step path is driven; one scan, three predicates and one spawn |

### Commands

None. The cluster owns no `RafaCommand`.

### Steps with guards

None registered. The audit is the guard that keeps the labels reads of `src/board/relations/` from spreading: a new file importing a tracked name fails the test until someone adds it to `ALLOWED_IMPORTERS` with a reason, and a file that stops importing one fails it until the entry is removed.

### Config section

None. `board.relationships` (the mode switch) is declared in `src/config-schema.ts` (`c03-config`, line 488) and read by the allow-listed readers; this file reads no config. Its own parameters are constants: `TRACKED_NAMES`, the two module paths, `ALLOWED_IMPORTERS` and the 150-second spawn timeout.

### Flows

None. The nested `bun test` of the baseline is one subprocess and its exit code, not a flow of this cluster's.

## Gaps

1. **The allow-list spans four clusters and names 24 files in paths relative to `src/`** (cut boundary). The files are in `c01-github` (20), `c10-index` (2), `c05-sessions` (1) and `c06-command` (1); a cut that moves any of them (`status/render.ts` with `src/status/`, `next/state.ts` with `rafa next`) changes a key of `ALLOWED_IMPORTERS` in `src/tests/relations-import-boundary.sweep.test.ts`, and the stale-entry test reds until it does. The audit is not tied to one package, so it stays at the repository root as a repo-level check, or splits into one allow-list per package that owns a labels-mode reader.
2. **The names are defined in the board and the boundary is the board's** (cut boundary). `EPICS_MODULE` and `BLOCKED_MODULE` are `src/board/epics.ts` and `src/board/blocked.ts`, which also hold the roadmap's board code in `c01-github` (265 files, the survey's largest cluster). The point of the audit is to shrink the allow-list as the labels mode is retired; a cut of the board has to carry the four names, the 19 files of `src/board/relations/` and the allow-list together, and the dependents outside `c01-github` (`status/render.ts`, `next/state.ts`, `commands/epic/close.ts`, `commands/issue/create-blocked.ts`) are the edges it would have to turn into a port call.
3. **The baseline spawn reaches a test of another cluster by path** (cut boundary; test index). The sweep's index is 0, but its fourth test runs `join(SRC_ROOT, 'tests', 'relations-labels-baseline.test.ts')` as a `bun test` child under a 150 s timeout, on every task (the file is an always-run sweep); the whole file ran in about 0.9 s here. A cut that moves the baseline test and its `src/tests/fixtures/relations-labels/` goldens (with the board's CLI-capture suites) has to change that path in `src/tests/relations-import-boundary.sweep.test.ts`, or the fourth test reds on a missing file.
4. **The matcher is text over named imports only** (test fidelity). A default or namespace import, a dynamic `import()` or a re-export of a tracked name from `src/board/epics.ts` is not matched, so the closed set is closed over one spelling. It passes today (the 24 entries and the stale check agree), but a cut that re-exports the names through a package index would bypass it; the matcher in `trackedImportsOf` must learn `export ... from` first.
5. **The module note cites a plan that is not tracked** (provenance). `.rafa/plans/PLAN-rafa-340-relationships-epics-blockers-github.md` is under `.rafa/plans`, which is gitignored, so a reader of a clean checkout cannot open it; the test's note carries the rules in prose, which is what a cut can rely on.
6. **No contract surface** (the four exports, all missing). There is nothing to port to `run(ctx, options)`, a step registry or a config section from here.

## Cut order this implies

The sweep waits on the board. It stays at the repository root as a repo-level check while the board is one cluster, and moves with `src/board/relations/` (or is split into per-package allow-lists, gap 1) when the board becomes a package; until then, the order it asks for is the one the allow-list already draws: the 20 `c01-github` entries move with the board; the four outside it (`status/render.ts`, `next/state.ts`, `commands/epic/close.ts`, `commands/issue/create-blocked.ts`) are the labels reads the board's package has to answer for through a port before it can be cut. It should be green before the board is cut and stay in the always-run set through the whole cut, since an entry that disappears from the list is the evidence a labels read really moved behind the port.
