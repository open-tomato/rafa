# Trace: `c20-epic-guard-workflow.test`

Coverage: 1 of 1 cluster members read, the 1 file `docs/survey/import-graph.json` lists for `c20-epic-guard-workflow.test` (`src/tests/epic-guard-workflow.test.ts`, 26 lines); it is tracked by `git ls-files`, and no tracked member was left unread. The one member is a test, so no source export was read; the test itself was read in full as well as through the graph and `docs/survey/test-index.json`, because the note on it has to say what it asserts.

`c20` ranks 20th of the 32 clusters in the import graph by number, and by size it sits among the 19 one-file clusters (`c14` to `c32`) that follow the twelve real ones; every cluster in the JSON has its own `trace-<cluster>.md` beside this one. The cluster has no edge to or from any other file in scope: 0 edges inside it, 0 leaving, 0 entering, and its betweenness is 0, as for the 992 of the graph's 1577 files that no shortest path runs through. It exists because the test imports no project file. Its hub is the file itself, `src/tests/epic-guard-workflow.test.ts`, and the cluster is **a content check on a YAML file the graph cannot see**: `.github/workflows/epic-guard.yml` (the epic guard this repository installs) must equal, byte for byte, `src/board/templates/epic-guard.yml` (the template `rafa init --board --epic-guard` writes). The root eslint config lints no YAML, so the test is the copy's only gate, as its module note says.

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. None has landed, as the earlier traces record, and as rechecked here: `src/steps/` and `src/flows/` do not exist, no source or `package.json` file imports `@open-tomato/define-config` (the name appears only in `src/preflight/prerequisites-md.ts` and two tests, as an npm availability probe in prose), and `gh issue view` shows #118, #119 and #71 still open. This cluster is one test; it owns none of the four exports and nothing in the contract would change it.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src/tests` | 1 | `epic-guard-workflow.test.ts`: one `describe`, one `it` ("is byte for byte the template rafa init --board --epic-guard writes"), run and passing at 1 test, 1 assertion |

The cluster spans one folder, `src/tests`, which holds 188 files over many clusters (`trace-c05-sessions.md` lists the split). The test reads two files as text with `readFileSync`, both resolved from the repository root through `import.meta.url` (`../../` from `src/tests`): `.github/workflows/epic-guard.yml` and `src/board/templates/epic-guard.yml`. Both are tracked (the YAML files are not nodes of the import graph, which reads TypeScript and JavaScript). Its imports are `node:fs`, `node:path`, `node:url` and `bun:test`, nothing of the project.

## What crosses the boundary

- Outbound: none, by import. The test names `src/board/templates/epic-guard.yml` as a path, not as an import, so the graph draws nothing. The code that owns the template is `src/board/epic-guard.ts` (`EPIC_GUARD_PATH`, a reader of `templates/epic-guard.yml` beside the module, `src/board/templates/` in a checkout and `dist/templates/` in a build), in `c01-github`; the test does not import it.
- Inbound: none. Nothing imports a test.
- Test reach, from `docs/survey/test-index.json`: index 0, 0 source files reached, no folders, no process spawned. It is the cheapest kind of test in the index; a change to any source file leaves it unselected by `bun test --changed=<base>`, since it has no import to be selected through, and the default `tests.alwaysRun` glob (`src/**/*.sweep.test.ts`, `src/config-schema-tests.ts`) does not name it, because the file is `.test.ts` and not `.sweep.test.ts`. It runs in the full suite and in a scoped run that names it, or when the template or the workflow is the changed path and someone selects it.

## Entry points

An entry point is a member imported from outside the cluster, or a command registered from it. None of its members is imported from outside the cluster, and 0 registered commands are in it: no `RafaCommand` is defined here and nothing is listed from this file in `CORE_COMMANDS` (`src/commands/index.ts`). It provides no hook or engine to code outside. The only thing outside that names it is prose: `context/workflow.md` (section "The epic guard", line 401 onward) says `src/tests/epic-guard-workflow.test.ts` holds the template and the installed copy identical.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | none; the file is a test | a test is not a command; the command it guards, `rafa init --board --epic-guard`, is registered from `init` (`src/commands/init.ts`, another cluster) |
| Steps with guards | **missing** | none | the one assertion is a check, not a step a loop run contributes; it is the guard on a copy, not a guard class |
| Config section | **missing** | none | no key of `src/config-schema*.ts` is read or declared here; `board.relationships` (which makes `--epic-guard` refuse in `native` mode, per `src/commands/init-board-native.test.ts`) belongs to the board section, not this file |
| Flows | **missing** | none | no multi-step path is driven; the test is two reads and one equality |

### Commands

None. The cluster owns no `RafaCommand`.

### Steps with guards

None. One assertion is the nearest thing to a guard: the installed workflow equals the template, so a change to the template reaches this repository's copy in the same commit. It is a repository-level check on a tracked file, with no class and no refusal a run could meet.

### Config section

None. Whether the guard is switched on is not config either: `context/workflow.md` says the workflow is installed disabled and the person turns it on with `gh workflow enable "Epic guard"`, a state on GitHub that no file in this repository holds.

### Flows

None.

## Gaps

Every export is missing for the same reason: the cluster is one test. The list is the cut's view of it.

1. **The test reaches its subject by path, not by import** (cut boundary). It reads `src/board/templates/epic-guard.yml` from the repository root. If the board code (`src/board/`, `c01-github`) becomes a package and the template travels with it, the test has to change `ROOT` and the template path in `src/tests/epic-guard-workflow.test.ts`, or move beside the template; the installed copy at `.github/workflows/epic-guard.yml` stays at the repository root.
2. **The check is not an always-run sweep** (test index). The file is named `.test.ts`, so the default `tests.alwaysRun` glob does not select it when the changed files are only the template or the workflow. A cut that wants it to gate every task renames it to `src/tests/epic-guard-workflow.sweep.test.ts`; nothing else imports the name, only `context/workflow.md` quotes it.
3. **No contract surface** (the four exports, all missing). There is nothing to port to `run(ctx, options)`, a step registry or a config section from here.

## Cut order this implies

Nothing has to be cut out of this cluster. The test stays at the repository root as a repo-level check on a tracked workflow file, for as long as the installed copy lives at `.github/workflows/epic-guard.yml`. If the template moves into a board package, it moves last or in the same commit, with its path constant changed; before that, it needs no work and blocks nothing. It is not on the path of any other cluster's cut.
