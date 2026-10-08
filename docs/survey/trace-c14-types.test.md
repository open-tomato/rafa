# Trace: `c14-types.test`

Coverage: 1 of 1 cluster members read, the 1 file `docs/survey/import-graph.json` lists for `c14-types.test`; it is tracked by `git ls-files`, and no tracked member was left unread. The file is a test (`src/cli/core/types.test.ts`, 305 lines); because the cluster is that one file it was read in full, and the cluster facts below come from the graph and `docs/survey/test-index.json`.

By size this is the 14th cluster of the 32 in the graph, and the first of the one-file clusters; every cluster in the JSON has its own `trace-<cluster>.md` beside this one. The cluster is **the compile test of the command contracts**: `src/cli/core/types.test.ts` holds the claims of `src/cli/core/types.ts` (`CliContext`, `ArgSpec`, `FlagSpec`, `CliCommand`, copied from open-tomato's `cli-core`) as TypeScript probes compiled through the compiler API, because `bun:test`'s `expectTypeOf` checks nothing at run time (the note measures it on bun 1.3.14: a file asserting `string` equals `number` passed) and `check-types` excludes every `*.test.ts`. It is its own hub, with 0 edges in or out of the graph and betweenness 0.

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. None has landed, as `trace-c03-config.md` to `trace-c05-sessions.md` record, and it was checked again here: `src/steps/` and `src/flows/` do not exist, no source file imports `@open-tomato/define-config` (the name appears only in prose in `src/preflight/prerequisites-md.ts` and in two tests' strings), and `gh issue view` reads #118, #119 and #71 as open. The test owns no command, step, config key or flow; what it guards is the shape of the command contract that #119 would replace.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src/cli/core` | 1 | `types.test.ts`: one probe holding every claim that must compile clean, seven refusal probes, and the compile that reads them |

`src/cli/core/` has six tracked files: `types.ts`, `parseArgs.ts`, `assembleContext.ts` and a test each. Of them only this test is outside `c06-command`, whose graph holds the other five. The test imports no project file: its only imports are `node:fs`, `node:os`, `node:path`, `node:url`, `bun:test` and `typescript`.

## What crosses the boundary

No edge, in or out, in the graph: 0 outbound, 0 inbound, 0 inside. The test reads the repository by path, at run time, which is what the graph cannot see:

- it compiles probes in a `mkdtemp` directory outside the repository that import `src/cli/core/types.js`, `src/cli/core/parseArgs.js` (for `ParseArgsSpec`) and `src/ports/index.js` (for `Output` and `CliEvent`) by absolute path, under the options of the root `tsconfig.json` read through `ts.readConfigFile`;
- the probes reach what those modules import: `src/config-sections.ts` (`OutputMode`, imported by `types.ts`) and the ports entry, which 160 files import across ten clusters.

Test reach, from `docs/survey/test-index.json`: index 0 and source count 0, does not spawn. The index counts static imports only, so a change to `src/cli/core/types.ts` (reached by 570 tests, 568 from other folders, through the graph) never selects this test under `bun test --changed=<base>`, and the file's name has no `.sweep.test.ts` suffix, so the default `tests.alwaysRun` pattern (`src/**/*.sweep.test.ts`, `src/config-schema-tests.ts`) does not add it either. It runs in the full suite; a scoped run after an edit to `types.ts` has to name it (`related`, `bun test src/cli/core/`).

## Entry points

No member is imported from outside the cluster, no `RafaCommand` is registered from it, and it provides no hook or engine. It is a consumer of `c06-command`'s `src/cli/core/types.ts` and `c10-index`'s `src/ports/index.ts`, by path. One other test names it: `src/cli/command.test.ts` says in its header that it compiles `RafaCommand` through the compiler API "as `src/cli/core/types.test.ts` does".

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | none; the test holds the contract commands are written against, not a command | no `RafaCommand`; what it pins is `CliCommand` (`src/cli/core/types.ts`), which `RafaCommand` in `src/cli/command.ts` extends with its `run` omitted |
| Steps with guards | **missing** | none | no step; the refusals it holds are compile diagnostics (seven, each held to its TypeScript code and a message naming the change), not run-time guards |
| Config section | **missing** | none | no key; the test reads the root `tsconfig.json` and nothing of rafa's config |
| Flows | **missing** | none | no multi-step path of the project; its one path, compile then read the diagnostics, is the test's own |

### Commands

None. The 9 cases (`reads the root tsconfig with no error`, `compiles the probe holding every claim with no diagnostic`, and one per refusal) are the guard on the shape `src/cli/core/types.ts` gives every command: `outputMode` exactly `'text' | 'json' | 'events'`, a `log` event narrowing to its own fields, `output` exactly the `Output` port, a `CliCommand` assignable to `ParseArgsSpec`, `run` returning a promise, flag `aliases` an array, an argument `default` never `null`. When #119 gives `run` the shape `run(ctx, options)`, this is the test that goes red first, on the `run-sync.ts` refusal and the `T.CliCommand` literal in the clean probe.

### Steps with guards

None. The seven refusal probes are the nearest thing to guards in the file: each changes one thing and is held to exactly one diagnostic with its code and message, so a probe failing for another reason does not pass. They guard a type, and nothing here runs in a loop.

### Config section

None. The test reads `tsconfig.json` at the repository root only to compile under the same options as `check-types`, and fails with `reads the root tsconfig with no error` if that file stops parsing.

### Flows

None of the project's.

## Gaps

Every export is missing; none is a defect of a test. Gaps 1 and 2 are the contract and would be the same for any cluster; 3 and 4 are specific to this one.

1. **No `run(ctx, options)`** (commands, missing). `src/cli/core/types.ts` still says `run: (context: CliContext) => Promise<void>`. A cut to the contract changes `src/cli/core/types.ts`, `src/cli/command.ts` (`RafaCommand`) and this test's clean probe and `run-sync.ts` refusal, which pin the old signature.
2. **No step registry or consent** (steps, missing). Nothing here asks or refuses at run time; a contract type for a step would add its own probes beside these, in a file of the package that holds the type.
3. **The test is not selected by a change to the file it guards** (cut boundary; test index). It imports no project file (index 0) and has no sweep suffix, so a `changed` run after an edit to `src/cli/core/types.ts`, `parseArgs.ts` or `src/ports/index.ts` does not run it, and a break of a claim shows only in the full suite. A cut either gives the test a static import of the module it compiles (so the graph sees it), renames it to carry the sweep suffix (so `tests.alwaysRun` adds it), or keeps it as a `related` run by path; the file to change is `src/cli/core/types.test.ts` (and its name, for the suffix).
4. **The test lives beside `src/cli/core/` but reaches `src/ports/index.ts` and the root `tsconfig.json`** (cut boundary). The probes import the ports entry by absolute path and compile under the repo root's options (`REPO_ROOT` is `../../../` from the test's directory). A package that owns `src/cli/core/` takes the test with it and has to give the compile its own `tsconfig.json` and a path to the ports entry; `src/cli/command.test.ts`, which does the same for `RafaCommand`, changes with it.

## Cut order this implies

The cluster has no line through it: it moves with `src/cli/core/` and the contract types of `c06-command`, whenever those are cut, and is the first guard to redden when `run` changes shape (gap 1). Nothing imports it and it imports no cluster, so it cannot block or be blocked; the cut decision is where the file runs from (gap 3) and whether its compile keeps reading the root `tsconfig.json` (gap 4).
