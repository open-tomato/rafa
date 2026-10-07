# Trace: `c13-main`

Coverage: 2 of 2 cluster members read, the 2 files `docs/survey/import-graph.json` lists for `c13-main`; all 2 are tracked by `git ls-files`, and no tracked member was left unread. Both are test support (`src/tools/ts-symbols/fixtures/proj/src/main.ts`, 6 lines, and `util.ts`, 20 lines) and both were read in full for their exports. The `tsconfig.json` beside them in `fixtures/proj/` is tracked and is no member, since the graph holds only `.ts` files.

By size this is the 13th cluster of the 32 in the graph, the only one of the small ones with two files, and the first of the small clusters after the twelve large ones; every cluster in the JSON has its own `trace-<cluster>.md` beside this one. The cluster is **a fixture project for the `ts-symbols` tool**, a two-file TypeScript program whose only job is to be asked questions: `main.ts` imports `makeChunk` and the type `Chunk` from `./util`, declares `first`, re-exports `makeChunk as reChunk`, and declares the alias `MaybeChunk` and `maybe`; `util.ts` declares the `Chunk` interface, `makeChunk`, the class `ChunkStore` and a non-exported `HIDDEN_LIMIT` that is also its default export. Its hub is `src/tools/ts-symbols/fixtures/proj/src/main.ts` (the one in-cluster edge starts there and ends at `util.ts`, a value edge); betweenness is 0 for both files, because nothing imports either and no path in the graph runs through them. The cluster has no edge to any other cluster, in or out.

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. None has landed, as `trace-c03-config.md` to `trace-c05-sessions.md` record, and it was checked again here: `src/steps/` and `src/flows/` do not exist, no source file imports `@open-tomato/define-config` (the name appears only in prose in `src/preflight/prerequisites-md.ts` and in two tests' strings), and `gh issue view` reads #118, #119 and #71 as open. This cluster has nothing the contract asks for, and says so below: it owns no command, step, config key or flow.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src/tools/ts-symbols/fixtures/proj/src` | 2 | `main.ts` (a value import, a re-export, a type alias), `util.ts` (an interface, a function, a class, a default export) |

The cluster is two of the three tracked files under `src/tools/ts-symbols/fixtures/proj/` (the third is the `tsconfig.json`, with `strict`, `noEmit`, `moduleResolution: bundler` and `include: ["src"]`). The other files of `src/tools/ts-symbols/` are `cli.ts` (`c32-cli`) and `cli.test.ts` (`c31-cli.test`), one cluster each. The fixture sits under `src/`, so the root `tsconfig.json` (`include: ["src", ...]`, with `node_modules`, `packages` and `**/*.test.ts` excluded) type-checks both files with the rest of the tree.

## What crosses the boundary

Nothing, by the graph: 0 edges out, 0 edges in, 1 edge inside (`main.ts` to `util.ts`, value). That is by design and is also what hides the fixture from the graph. `src/tools/ts-symbols/cli.test.ts` reaches the fixture by path, not by import: it sets `PROJ` to `fixtures/proj` through `import.meta.dir`, runs `bun cli.ts <query>` with that directory as the working directory, and asks about positions in `src/main.ts` and `src/util.ts` (for example `def src/main.ts:3:29` must answer `src/util.ts:7:17 function makeChunk`, and `outline src/util.ts` must list `11: export class ChunkStore` and `19: const HIDDEN_LIMIT`). Other cases copy the project with `cpSync` into a `tmpdir` directory and plant a `package.json` that depends on nothing, to test that the tool exits 3 when the project has no `typescript` and loads the project's own copy, planted under `node_modules`, when it has one. So what the tests read is line and column numbers (21 lines of `cli.test.ts` name `main.ts` or `util.ts` with a position or as the file asked about), and an edit to either fixture file that moves a line breaks `cli.test.ts` with no import edge to say so.

Test reach, from `docs/survey/test-index.json`: no test lists either file as a source it reaches (the index lists no `fixtures/proj` file, as a source or as a test), and the one test that depends on them, `src/tools/ts-symbols/cli.test.ts`, has index 0 and source count 0 and is marked as spawning a process. A scoped run (`bun test --changed=<base>`) therefore does not select `cli.test.ts` when only a fixture file changed.

## Entry points

An entry point is a member imported from outside the cluster, or a command registered from it. No member is imported from outside, and no `RafaCommand` is registered from it (`CORE_COMMANDS` in `src/commands/index.ts` holds no command from `src/tools/`). The only user of the fixture is `src/tools/ts-symbols/cli.test.ts`, by path. The tool it exercises is not a rafa command either: `package.json`'s `build` script bundles `src/tools/ts-symbols/cli.ts` to `dist/bundled/bin/ts-symbols`, a binary the loop's agents call from the shell. The cluster provides no hook and no engine.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | none; the fixture is data for a tool's tests | no `RafaCommand`; `ts-symbols` is a bundled binary (`src/tools/ts-symbols/cli.ts`, `c32-cli`), not a registered command |
| Steps with guards | **missing** | none | no step and no guard; the fixture refuses nothing |
| Config section | **missing** | none | no key read or declared; `src/config-schema.ts` holds nothing about it |
| Flows | **missing** | none | the paths driven through the fixture (`outline`, `def`, `refs`, `type`) are the tool's, driven by `cli.test.ts`, and are not multi-step paths of the project |

### Commands

None. `src/tools/ts-symbols/cli.ts` (`c32-cli`) takes `outline`, `def`, `refs` and `type` as its own argv and is not in `CORE_COMMANDS`; this cluster is the project those queries run in. Nothing here is a `RafaCommand` or could become one.

### Steps with guards

None. The two files are inert: `main.ts` and `util.ts` declare values and run no code beyond a `makeChunk('hello')` call at module load, and `ChunkStore.add` is never called.

### Config section

None. The fixture's own `tsconfig.json` is the only configuration it carries, and it is read by the TypeScript compiler API that `cli.ts` drives, not by rafa's loader.

### Flows

None of the project's. The tool's paths that touch the fixture are the queries `cli.test.ts` asserts, each one command against one project; the only multi-step cases are the ones that copy the project, plant a `typescript` of its own and run the tool from a subdirectory, which test how the tool finds the compiler, not a flow of this cluster.

## Gaps

Every export is missing, and none of them is a defect of a fixture. Gaps 1 and 2 are the contract and would be the same for any cluster; 3 and 4 are specific to this one.

1. **No `run(ctx, options)` and no command** (commands, missing). Nothing to change in the cluster; a cut that gives `ts-symbols` a command changes `src/tools/ts-symbols/cli.ts` and `src/commands/index.ts` (`CORE_COMMANDS`), and the fixture stays as the data.
2. **No step, guard class or consent** (steps, missing). Nothing here asks a question or refuses; no change to the fixture.
3. **The fixture is tied to `cli.test.ts` by line and column numbers and by path** (cut boundary). The position strings in `src/tools/ts-symbols/cli.test.ts` name lines of `main.ts` and `util.ts`, and `PROJ` is `fixtures/proj` beside the test. A cut that moves the tool moves the fixture with it, and the tool's test (`c31-cli.test`) is the file that would have to change if it did not.
4. **The fixture is type-checked and built into nothing** (cut boundary). It sits under `src/`, so the root `tsconfig.json` includes it, while the tool's `build` script bundles only `cli.ts`. A package that owns `ts-symbols` takes the folder with its `tsconfig.json`; if the fixture stays in the root's `src/`, the root's gates keep reading two files that exist for another package's test.

## Cut order this implies

The cluster has no line through it. It goes with `src/tools/ts-symbols/` as one unit (`cli.ts`, `cli.test.ts`, the fixture project), whenever that folder is cut, and it is the last thing to move or the first, depending on nothing: no other cluster imports it and it imports no other cluster. If the tool is never packaged, the fixture stays where it is with no change.
