# Trace: `c32-cli`

Coverage: 1 of 1 cluster member read, the 1 file `docs/survey/import-graph.json` lists for `c32-cli`; it is tracked by `git ls-files`, and no tracked member was left unread. The member is a source file (`src/tools/ts-symbols/cli.ts`, 399 lines), so it was read in full for its commands, its exits and what it exports. Its test (`src/tools/ts-symbols/cli.test.ts`, `c31-cli.test`) was read for what it asserts, through the graph and `docs/survey/test-index.json` for its reach.

Cluster 32 of 32 by the `NN` of its name, and the last of the 19 single-file clusters (`c14` to `c32`). Every cluster in the JSON has its own `trace-<cluster>.md` beside this one. The cluster is **`ts-symbols`, a standalone program that answers TypeScript symbol queries from a shell**: `src/tools/ts-symbols/cli.ts` is a script with a `#!/usr/bin/env bun` line, four commands over the TypeScript language service (`outline <file>`, `def`, `refs` and `type <file>:<line>:<col>`, positions 1-based), the flags `--json` and `--full`, and the exit codes 0 (results), 1 (usage or error), 2 (a valid query with no results) and 3 (no `typescript` package under the project root). It loads the `typescript` package of the project it is run in, found by a hand-written walk up from the working directory (`typescriptDirectory`, `loadTypeScript`) and not by an import, so that a build bundled into `dist/bundled/bin/` does not find rafa's own copy. It has no `export`, and its top level runs on import (`readRequest(process.argv.slice(2))` and `loadTypeScript(process.cwd())`), which is why its test spawns it and cannot import it. Its hub is itself, being the only member; its betweenness is 0, as it has no edge to carry a path through (its only imports are `typescript` as a type, `node:fs`, `node:module` and `node:path`).

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. Neither has landed: `src/steps/` and `src/flows/` do not exist, no source file imports `@open-tomato/define-config` (the name appears only as text in `src/preflight/prerequisites-md.ts` and `src/start/preflight.test.ts`), and `gh issue view 119` and `gh issue view 71` both read OPEN. So every "present" below means present in today's shape. This cluster is not a candidate for the contract's commands: it is a program rafa ships and puts on a loop session's `PATH`, not a subject of the `rafa` CLI.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src/tools/ts-symbols` | 1 | `cli.ts`: the request reader (`readRequest`, `fail`, `noResults`), the loader (`typescriptDirectory`, `loadTypeScript`), the language-service host (`createProject`, `sourceFileOf`, `offsetOf`, `locOf`), the four commands (`cmdOutline` with `navToOutline` and `printOutline`, `cmdDef`, `cmdRefs`, `cmdType` with `tokenAt`) and `main` |

`src/tools/ts-symbols` is a four-file folder split over three clusters: this program, its test (`c31-cli.test`) and the fixture project's `main.ts` and `util.ts` (`c13-main`, kind `test-support`), plus `fixtures/proj/tsconfig.json`, which the graph does not scope. It is the only file under `src/tools/`. In the survey's file classification (`scripts/survey/files.ts`) the program is kind `source` and the fixture files are `test-support`.

## What crosses the boundary

Outbound: no imports of project files, so 0 edges to any cluster (0 value, 0 type). The file imports `typescript` as a type and loads it at run time from the project it is run in; it imports no package of the repository. Inbound: 0 edges; nothing imports it.

By path and by name, and not by import, the program is reached from outside:

- the root `package.json` `build` script bundles it (`bun build src/tools/ts-symbols/cli.ts --target=bun --outfile=dist/bundled/bin/ts-symbols`), and `files` ships `dist`;
- `src/schema/tiers.ts` (`bundledBinDirectory`, `BUNDLED_BIN_DIR`) names the directory a build writes it to, and `src/utils/session-env.ts` puts that directory first on a session's `PATH`;
- `src/plan/needs.ts` (the `ts-symbols` program row) and `src/refs/verify.ts` (`Bun.which('ts-symbols', ...)`, its outliner over `ts-symbols outline <file> --json`, null when the program is not on `PATH`) look it up on `PATH`; `src/refs/outline-cache.ts`, `src/triage/refs-section.ts` and `src/commands/doctor-refs.ts` take its answers or its `PATH` lookup through seams; none imports the file;
- `src/bundled/skills/ts-symbols/SKILL.md` documents it to agents;
- `src/tests/package-build.test.ts` (`c08-cli-capture`, `TS_SYMBOLS`) spawns the source and the built copy and compares their answers, and `src/tests/doctor-deep-spawned.test.ts` names a skill for it.

Test reach, from `docs/survey/test-index.json`: `src/tools/ts-symbols/cli.ts` is reached by 0 tests (`tests: []`, `testsFromOtherFolders: 0`), since the tests that exercise it, `cli.test.ts` and `src/tests/package-build.test.ts`, spawn it by path. A change to the program therefore selects no test under `bun test --changed=<base>`; the answer to that is in `trace-c31-cli.test.md`. Its coverage is by run: 14 spawned cases in `cli.test.ts` and the ts-symbols cases of `package-build.test.ts` (the source and the built program answering `help` and no arguments alike, exit 0 over a project with `typescript`, exit 3 over one without).

## Entry points

No member is imported from outside the cluster. No `RafaCommand` is registered from it: `CORE_COMMANDS` in `src/commands/index.ts` holds no `ts-symbols` command (a grep of the file for the name finds none), and `rafa` does not route to it. It is an entry point in its own right: the program a shell, an agent session or the `rafa` loop runs by name. It provides no hook and no engine to code outside it; the consumers above read its stdout (`outline --json`) and its exit code.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | `src/tools/ts-symbols/cli.ts` holds four commands of its own (`outline`, `def`, `refs`, `type`) | none is a `RafaCommand`: no `subject`, `action`, `summary`, `flags`, `examples` or `outputs`; no `run`; not in `CORE_COMMANDS` or `rafa describe` |
| Steps with guards | **missing** | none; its refusal is exit 3 in `loadTypeScript` | no step, no registry, no guard class; it is not run by a loop as a step but looked up on `PATH` by readers |
| Config section | **missing** | none; reads no config key, no environment variable and no file but the project's | none needed; its one input beyond argv is the working directory |
| Flows | **partial** | one path inside the file: argv, then `loadTypeScript`, then a language service over the nearest `tsconfig.json`, then a command, then an exit code | no flow list, no step id; the path is a script's top level and `main` |

### Commands

Four, none registered. `outline` builds a one-file service (`createProject(absFile, true)`, which skips config discovery) and prints the navigation tree with one level of members under a class, interface, enum, module or type; `def`, `refs` and `type` build a service over the nearest `tsconfig.json` (`ts.findConfigFile`, with a loose fallback of `allowJs`, `ES2022`, `ESNext` and `Bundler` resolution when there is none) and add the target file if the tsconfig excludes it. `refs` marks each reference `def`, `write` or `use` by matching the definition spans, because `isDefinition` is unreliable from the API (a note in the file), and writes a count line on stderr; `type` prints the declared text and, with `--full`, the expanded type with `NoTruncation`. `help` and a usage error are answered in `readRequest`, before any `typescript` is loaded. Output is text lines or, with `--json`, JSON.

A cut that registers it as a `RafaCommand` would give the repository a `rafa symbols` or similar subject, which it does not have today; whether it should is a design question for #119, because the program's reason to be standalone is that it runs in a project without rafa, from a shell, with the project's `typescript`.

### Steps with guards

None registered. The program has three refusals, all in the file: exit 1 for a missing target, an unknown command or a malformed `<file>:<line>:<col>` (`fail`), exit 2 for a query with no results (`noResults`), and exit 3 when no `node_modules/typescript` exists at or above the working directory (`NO_TYPESCRIPT_EXIT`), which names the root and exits before any language service is built. No setting or flag turns any of them off. The program holds no state and changes nothing (all four commands read), so its class, if the contract gave it one, would be a reading, with exit 3 a refusal on a missing input and not a guard on a change.

### Config section

None. It reads no `RafaConfig`, no `process.env` key (the lookup of `typescript` uses the working directory and the file tree, not the environment) and no file of rafa's. The one decision that looks like configuration, which `typescript` to load, is made from the project it is run in, on purpose: the file's comments record that a bare `import 'typescript'` would find rafa's copy from `dist/bundled/bin/`, and that `createRequire(root)` made bun auto-install `typescript@7.0.2` in an empty temp directory.

### Flows

One path, inside one file: `readRequest` (answers `help`, a missing target and an unknown command), `loadTypeScript(process.cwd())`, then `main` over the command, which builds a project and a language service, resolves the position, queries, and prints; each step ends in `process.exit` with a code on any refusal. Partial because the chain exists and is ordered, and nothing declares it as steps.

## Gaps

Every export of the contract is missing or partial; the cluster is a standalone program, so a cut would move it as it is.

1. **Not a `RafaCommand`** (commands, missing). `src/tools/ts-symbols/cli.ts` has no `run`, no `RafaCommand` fields and no entry in `CORE_COMMANDS` (`src/commands/index.ts`). A cut that wants it under `rafa` changes `src/commands/index.ts` (a registered command and a subject), `src/cli/command.ts` (the type it satisfies), and the file itself (exit codes become `CommandExit` and `console.log` the context's output); a cut that leaves it as a program changes nothing here.
2. **No step or guard** (steps, missing). Exit 3 in `src/tools/ts-symbols/cli.ts` (`loadTypeScript`) is the one guard worth naming. A cut that makes it a guard changes the same file; nothing else in the repository calls it as a step.
3. **No config section and none needed** (config, missing). The file reads nothing from `src/config-schema*.ts`. No cut changes it.
4. **A flow that is a script** (flows, partial). The top level of `src/tools/ts-symbols/cli.ts` runs the request and the loader on import, which blocks an import by a test or a command and is why `cli.test.ts` spawns it. A cut that wants the four commands callable in process, for a test that selects by import graph or for a `rafa` subject, splits the file in two: a module with the commands and the loader as exports, and a thin entry that reads argv and exits.
5. **No test selects a change to it** (test index). Reached by 0 tests, and its test (`c31-cli.test`) imports nothing; see `trace-c31-cli.test.md` gap 3. The file a cut would change is `src/config-schema-tests.ts` (an `alwaysRun` or `integration` pattern naming `src/tools/ts-symbols/cli.test.ts`), or the split in gap 4, after which the test imports the module and the graph carries it.
6. **Three places name its output path** (cut boundary). `package.json` (`build`), `src/schema/tiers.ts` (`BUNDLED_BIN_DIR`) and `src/tests/package-build.test.ts` (`TS_SYMBOLS`) agree on `dist/bundled/bin/ts-symbols` and on the source path `src/tools/ts-symbols/cli.ts`; the skill at `src/bundled/skills/ts-symbols/SKILL.md` also documents the invocation. A cut that moves the folder changes the `build` script and the constant in the build test together; the dependency is by string and nothing fails to compile if one is missed.

## Cut order this implies

This cluster has no edge to cut, so it needs no order inside the tree: it is the program that leaves with its test (`c31-cli.test`), its fixture (`fixtures/proj/`, two files in `c13-main` and a `tsconfig.json`) and its build line, as one folder, `src/tools/ts-symbols/`, and nothing else has to move first. What a cut has to keep is the by-path agreement of gap 6 (the root `package.json` `build`, `BUNDLED_BIN_DIR`, `package-build.test.ts`) and the readers that already treat it as optional (`src/refs/verify.ts`, whose outliner is null without it, and `src/plan/needs.ts`, whose row names it as a program to look up). It can be taken first, because it needs nothing from the others, or last, because nothing in the other clusters waits on it; gap 4's split is only needed if the commands are to be a `rafa` subject.
