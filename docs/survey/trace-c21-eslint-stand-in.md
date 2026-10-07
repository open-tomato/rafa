# Trace: `c21-eslint-stand-in`

Coverage: 1 of 1 cluster members read, the 1 file `docs/survey/import-graph.json` lists for `c21-eslint-stand-in` (`src/tests/eslint-stand-in.mjs`, 69 lines); it is tracked by `git ls-files` (mode 100644, a plain file in the index), and no tracked member was left unread. The one member is test support, not a test, so it was read in full for what it does; there is no test file in the cluster and nothing for `docs/survey/test-index.json` to read, since that index lists test files and TypeScript sources and this is neither (it is in no `tests` entry and not among the 633 `sources`).

`c21` ranks 21st of the 32 clusters in the import graph by number, and by size it sits among the 19 one-file clusters (`c14` to `c32`) that follow the twelve real ones; every cluster in the JSON has its own `trace-<cluster>.md` beside this one. It is the only one of the 19 whose member has the kind `test-support` and the only `.mjs` among them. 0 edges inside it, 0 leaving, 0 entering; betweenness 0, as for the 992 of the graph's 1577 files that no shortest path runs through. The file is **an ESLint that is not ESLint**: a script that answers the one rule a spawned fixture repository configures, `jsonc/indent` at two spaces, in ESLint's own JSON report shape (`filePath`, `messages`, `errorCount`, `warningCount`) and exits 1 when a file holds an error and 0 otherwise. It is planted at `node_modules/.bin/eslint` inside a fixture so that `bunx eslint` there runs it and nothing outside the repository is read. Its hub is itself.

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. None has landed, as the earlier traces record, and as rechecked here: `src/steps/` and `src/flows/` do not exist, no source or `package.json` file imports `@open-tomato/define-config` (the name appears only in `src/preflight/prerequisites-md.ts` and two tests, as an npm availability probe in prose), and `gh issue view` shows #118, #119 and #71 still open. This cluster is a fixture tool for one test; it owns none of the four exports.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src/tests` | 1 | `eslint-stand-in.mjs`: a `#!/usr/bin/env bun` script with four functions, `filesIn(argv)` (the arguments that are neither a flag nor the value after `--format`), `count(text, chars)`, `indentMessages(text)` (the `jsonc/indent` messages of one JSON file) and a top-level report; one constant, `INDENT = 2`; no export |

The cluster spans one folder, `src/tests`, which holds 188 files over many clusters. The script imports `node:fs` (`readFileSync`) and `node:path` (`resolve`), nothing of the project. It reads no config and no flag but `--format`; a file that does not end `.json` answers an empty message list. `src/tests/git-identity.sweep.test.ts` globs `src/**/*.{ts,tsx,js,mjs}`, so it reads this file too (it names neither `GIT_CONFIG_GLOBAL` nor `HOME`, and passes).

## What crosses the boundary

- Outbound: none. It imports only built-ins.
- Inbound: none in the graph, and one by path. `src/tests/task-gate-spawned.test.ts` (`c08-cli-capture`) holds `ESLINT_STAND_IN = join(import.meta.dir, 'eslint-stand-in.mjs')` (line 107) and `plantEslint` copies it to the fixture's `node_modules/.bin/eslint` with mode 0o755 (lines 153 to 159), because the index records it as 644. A path string and a file copy are not imports, so the graph draws no edge, and the test index does not list the file among that test's `support` (`src/tests/cli-capture.ts`, `git-identity.ts`, `loop-scratch.ts`). No other tracked file outside `docs/survey/` names it. A change to the script is therefore invisible to `bun test --changed=<base>`, which selects by import: only `task-gate-spawned.test.ts` exercises it, and it is not selected when this file alone changes.
- Test reach: not applicable; the file is not a test, and the test that uses it spawns a process through three files (`cli-capture.ts`, `loop-scratch.ts` and itself) at index 42 over 21 folders.

## Entry points

An entry point is a member imported from outside the cluster, or a command registered from it. None of its members is imported, 0 registered commands are in it, and it provides no hook or engine in the repository's own sense. Its one use from outside is the file copy above, which makes it an executable that a fixture's `bunx` runs. It is not `src/tools/ts-symbols/` (`c13-main`, `c31-cli.test`, `c32-cli`), which is a shipped tool built to `dist/bundled/bin/ts-symbols`; this script ships nowhere, and the `build` script in `package.json` does not touch `src/tests/`.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | none | a stand-in for an external tool is not a `RafaCommand` |
| Steps with guards | **missing** | none | it stands in for the lint step's tool (`src/start/lint-step.ts`, which runs `bunx eslint --no-warn-ignored`), but it is that step's test double, not a step or a guard |
| Config section | **missing** | none | it reads no config; the one rule it answers is wired in the fixture's own `eslint.config.mjs`, which `task-gate-spawned.test.ts` writes, and which the stand-in does not read |
| Flows | **missing** | none | nothing multi-step: one pass over `argv` and one report |

### Commands

None. The cluster owns no `RafaCommand`.

### Steps with guards

None. The step the stand-in serves is the task gate's lint step; its guards (`src/start/lint-step.ts`, `src/start/task-gate-lines.ts`, in `c02-active`) are not here. The stand-in is what makes that step testable without a real ESLint: `task-gate-spawned.test.ts` plants it, or plants none, to prove a lint step that could not run ESLint ends as such.

### Config section

None. `INDENT = 2` is the stand-in's own constant and mirrors the rule the fixture configures (`jsonc/indent` at two spaces, as the root config does); it is not a config key.

### Flows

None.

## Gaps

1. **A fixture tool reached only by a path string** (cut boundary). `src/tests/task-gate-spawned.test.ts` reaches the script through `join(import.meta.dir, 'eslint-stand-in.mjs')`. A cut that moves the task gate's suites with `src/start/` has to move the script beside that test, or give it a path the test takes from the support folder; changing the file alone does not select the test that uses it. This is the one reason the cluster is not simply deletable by cutting `src/tests/`.
2. **The stand-in mirrors a rule, not a config** (test fidelity). It implements `jsonc/indent` at two spaces for a JSON file and nothing else; if the fixture's config grows a second rule, the file changes with it and `src/tests/task-gate-spawned.test.ts` is the only place that would show the drift. The fixture config (`ESLINT_CONFIG_TEXT` in that test) is the other half and is held in the test, not here.
3. **No contract surface** (the four exports, all missing). There is nothing to port to `run(ctx, options)`, a step registry or a config section from this file.

## Cut order this implies

The file moves with its one user: whichever package takes `src/start/` and its task-gate suites (`trace-c02-active.md`) takes `task-gate-spawned.test.ts` (`c08-cli-capture`) and this script together, as test support, in the same commit; no source package has to know it exists. It is last in any order, because nothing waits on it and it waits only on that test. Until then it stays in `src/tests/`, where its path constant is correct.
