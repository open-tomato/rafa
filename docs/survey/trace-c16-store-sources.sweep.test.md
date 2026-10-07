# Trace: `c16-store-sources.sweep.test`

Coverage: 1 of 1 cluster members read, the 1 file `docs/survey/import-graph.json` lists for `c16-store-sources.sweep.test`; it is tracked by `git ls-files`, and no tracked member was left unread. The file is a test (`src/effort/store/store-sources.sweep.test.ts`, 234 lines); because the cluster is that one file it was read in full, and the cluster facts below come from the graph and `docs/survey/test-index.json`.

By size this is the 16th cluster of the 32 in the graph, a one-file cluster; every cluster in the JSON has its own `trace-<cluster>.md` beside this one. The cluster is **four lint-shaped guards over the production sources of `src/`, run as a content sweep**: no `SELECT *`, no `INSERT INTO <table> VALUES` or `INSERT INTO <table> SELECT` without a column list, no `new Database(` outside an allow-list of eleven files, and `src/effort/store/schema-plan.ts` free of `bun:sqlite` and of `sqlite.ts`. Its header says each guard is "a plain scan a linter could in principle run, none of them wired into `eslint.config.mjs` today". It sits in the store's folder and is named in `trace-c04-sqlite.md` as the one-file cluster that "reads the sources as text". It is its own hub, with 0 edges in or out of the graph and betweenness 0: its only imports are `node:fs`, `node:path`, `node:url` and `bun:test`, and it reads the tree by `readdirSync` over `src/`.

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. None has landed, as `trace-c03-config.md` to `trace-c05-sessions.md` record, and it was checked again here: `src/steps/` and `src/flows/` do not exist, no source file imports `@open-tomato/define-config` (the name appears only in prose in `src/preflight/prerequisites-md.ts` and in two tests' strings), and `gh issue view` reads #118, #119 and #71 as open. The sweep owns no command, step, config key or flow; it is a repository-level check on the code of the store, which is `c04-sqlite`'s.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src/effort/store` | 1 | `store-sources.sweep.test.ts`: 18 cases, in one `describe` over the sources, four groups of matchers each proved against planted near-misses before it is trusted over the tree |

The folder has 90 tracked members in the graph: 85 in `c04-sqlite`, 3 in `c03-config` (`settings.ts` and two tests), 1 in `c12-index` (`index.ts`) and this one.

## What crosses the boundary

No edge, in or out, in the graph: 0 outbound, 0 inbound, 0 inside. The file's reach is by path and by text, which the graph cannot see:

- `findProductionSources(SRC_DIR)` reads every `.ts` file under `src/` that does not end in `.test.ts` (646 by `find`), whichever cluster it is in, and holds three regular expressions (`SELECT_STAR`, `INSERT_NO_COLUMNS`, `NEW_DATABASE`) over their text; the run reads all of `src/`, not the store's folder.
- `DATABASE_OPENER_ALLOW_LIST` names 11 files, all in `c04-sqlite`: `src/effort/store/sqlite.ts`, `fix-schema.ts`, `copy.ts`, `schema-report.ts`, `migrate.ts`, `merge-store.ts`, `store-meta.ts`, `fixture-extract.ts`, `testdata/merge-scenarios.ts`, `testdata/store-rows.ts`, and `src/effort/sync/wire.ts` (the one outside the store's folder). The case requires every file on the list to open a `Database` and no other file to; so a new opener, or one removed, reddens it.
- The fourth guard reads `src/effort/store/schema-plan.ts` (11 import edges, all from `c04-sqlite`) and refuses a `from 'bun:sqlite'` or a `sqlite.{js,ts}` import in it, which is that module's own note: the compatibility decision is a pure function over plain values.

The scan covers `src/` only. `packages/rafa-hub/src/store/sqlite.ts`, `packages/rafa-hub/src/testdata/compare-merged-stores.ts` and `packages/rafa-sync-service/src/sync.ts` also construct `Database` and are outside it, as the hub's two packages are separate workspaces under `packages/`.

Test reach, from `docs/survey/test-index.json`: index 0, source count 0, does not spawn. No changed file selects it; it runs because the `tests.alwaysRun` default pattern, `src/**/*.sweep.test.ts` (`src/config-schema-tests.ts`), matches its suffix, which is what the suffix is for. `src/effort/store/sqlite.ts`, the file whose rule it holds, is imported along 98 edges from ten clusters, and the sweep is none of them.

## Entry points

No member is imported from outside the cluster, no `RafaCommand` is registered from it, and it provides no hook or engine. It is run by the sweep gate (the always-run list), not called. It is the second of two sweeps in its folder: `src/effort/store/merge-rules.sweep.test.ts` (`c04-sqlite`) holds the merge's rules, this one the store's source discipline.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | none | the file defines no command; the commands over the store (`rafa effort fix-schema`, `copy`, `migrate`, `merge`, `move`) are `c04-sqlite`'s |
| Steps with guards | **partial** | the four guards in `src/effort/store/store-sources.sweep.test.ts` (no wildcard select, no unqualified insert, openers on an allow-list, `schema-plan.ts` free of the backend) | the guards are source scans at test time, not run-time steps; no registry, no guard class, nothing a loop run decides on |
| Config section | **missing** | none | no key; the allow-list is a constant of the file, not a setting |
| Flows | **missing** | none | no multi-step path; the one sequence is read the tree, apply a matcher, compare to a planted control |

### Commands

None. Several of the eleven openers the allow-list names sit under a command (`fix-schema`, `copy`, `migrate`, `merge-store`), and the sweep says why each of the ten besides `sqlite.ts` opens its own handle (a read-only `VACUUM INTO` that must not bring a store forward, a report that must leave a pending migration as it found it, a merge that opens the other store read-only). It is where the sources state the rule that every other open goes through `withSqliteStore` (`src/effort/store/sqlite.ts`), so that each open runs the test guard, the busy timeout and `bringForward`.

### Steps with guards

Partial, in a narrow sense: each is a rule over the code, not over a run. Nothing is registered and nothing is a step; the four are tests that stay green while a rule holds:

| Guard | What it refuses | Control |
| --- | --- | --- |
| no `SELECT *` | a wildcard select anywhere in a production source, so a reader across a store migration names its columns | planted `SELECT * FROM changes`, a wrapped `SELECT\n  *`, and a `COUNT(*)` that must not match |
| no unqualified `INSERT INTO` | `INSERT INTO t VALUES` or `INSERT INTO t SELECT` with no column list | four planted shapes, including `INSERT INTO main.t (a, b) SELECT ...`, which is allowed |
| `new Database(` on an allow-list | a construction outside the 11 files | planted calls, one spaced across a line break and one `openDatabase(path)` that must not match; every file on the list must open one |
| `schema-plan.ts` free of the backend | an import of `bun:sqlite` or of a relative `sqlite.js` or `sqlite.ts` | three planted imports |

The classes of #119's vocabulary do not fit: none of the four is 🔒 (it refuses nothing at run time), none ⚠️ and none 🧭. They are the repository's first lint-shaped rules over source text, held in a test because `eslint.config.mjs` does not carry them.

### Config section

None. The allow-list and the three expressions are constants of the file; nothing reads `.rafa/config.yaml`.

### Flows

None of the project's.

## Gaps

Gaps 1 and 2 are the contract and would be the same for any cluster; gaps 3 to 6 are specific to this one.

1. **No `run(ctx, options)` and no command** (commands, missing). Nothing to change in this file; the commands over the store change in `src/commands/effort/` and `src/cli/command.ts`, as `trace-c04-sqlite.md` records.
2. **No step registry or guard class** (steps, missing). The four guards are source rules, not run-time steps, and #119 has no place for a rule over source text. A cut either keeps them as a sweep or lifts them into `eslint.config.mjs` as rules (the file's header says they could be); the files to change are this one and `eslint.config.mjs`.
3. **The allow-list is a list of the store's files in a test that reads the whole of `src/`** (cut boundary). If `src/effort/store/` and `src/effort/sync/wire.ts` become a package, the list of 11 paths, `SRC_DIR` and the `src/effort/store/` paths in the case that checks the source set (`sqlite.ts`, `fix-schema.ts`, `schema-plan.ts`) move to the package's own root, and the scan covers the package's `src/` instead of the repository's. The file to change is this one, and it moves with `c04-sqlite`.
4. **The scan misses the hub's two packages** (cut boundary). `packages/rafa-hub/src/` and `packages/rafa-sync-service/src/` build `Database` handles too (`store/sqlite.ts`, `testdata/compare-merged-stores.ts`, `sync.ts`) and the sweep reads `src/` only. A cut that makes the store a package the hub and the service depend on has to decide whether their openers go on the same list or on one of their own.
5. **The "every open goes through `withSqliteStore`" rule is stated here and in the openers' own notes** (steps, partial). The note carries a paragraph for each of the ten non-`sqlite.ts` openers (why `fix-schema.ts`, `copy.ts`, `schema-report.ts`, `migrate.ts`, `merge-store.ts`, `store-meta.ts`, `fixture-extract.ts`, the two testdata files and `wire.ts` open their own) that `context/effort-store.md` does not carry: the page says `withSqliteStore` is the open and what it does, and names neither the rule that no other file constructs a `Database` nor the allow-list. A cut moves it to that page or to the store package's README when the allow-list moves.
6. **It is selected by the sweep suffix and by nothing else** (cut boundary; test index). Index 0 and no import: a package that loses the `tests.alwaysRun` default pattern, or a scoped run that ignores it, loses all four guards with no test going red. The file to change is the package's own config (`tests.alwaysRun`, `src/config-schema-tests.ts` for the default), not this file.

## Cut order this implies

The cluster has no line through it and no dependency in either direction, so it moves with `c04-sqlite` and nothing waits on it. It goes in the same step as the store package's entry (`trace-c04-sqlite.md`), with its allow-list rewritten against the package's own paths (gap 3); the decision that precedes it is the one in gap 4, whether the hub's packages are in or out of the rule, since that fixes where the scan starts. Until the store moves, leave it where it is: it reddens the day a new file opens a database or a query selects a wildcard, which is the property the store's forward compatibility rests on.
