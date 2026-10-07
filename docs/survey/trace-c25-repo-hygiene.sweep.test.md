# Trace: `c25-repo-hygiene.sweep.test`

Coverage: 1 of 1 cluster members read, the 1 file `docs/survey/import-graph.json` lists for `c25-repo-hygiene.sweep.test` (`src/tests/repo-hygiene.sweep.test.ts`, 130 lines); it is tracked by `git ls-files`, and no tracked member was left unread. The one member is a test, so no source export was read; the test was read in full as well as through the graph and `docs/survey/test-index.json`, and so was the hook it reads (`.githooks/pre-commit`, 8 lines of shell).

`c25` ranks 25th of the 32 clusters in the import graph by number, and by size it sits among the 19 one-file clusters (`c14` to `c32`) that follow the twelve real ones; every cluster in the JSON has its own `trace-<cluster>.md` beside this one. 0 edges inside it, 0 leaving, 0 entering; betweenness 0, as for the 992 of the graph's 1577 files that no shortest path runs through. The cluster is **two repo-hygiene claims pinned against the live tree**: the index holds neither `progress.txt` nor `@progress.txt`, and every repository path the `.githooks/pre-commit` hook names (in its comment and on its `exec` line) exists on disk. Its hub is itself.

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. None has landed, as the earlier traces record, and as rechecked here: `src/steps/` and `src/flows/` do not exist, no source or `package.json` file imports `@open-tomato/define-config` (the name appears only in `src/preflight/prerequisites-md.ts` and two tests, as an npm availability probe in prose), and `gh issue view` shows #118, #119 and #71 still open. This cluster owns none of the four exports; it is a check on the repository, not on a module.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src/tests` | 1 | `repo-hygiene.sweep.test.ts`: two `describe` blocks and 4 tests (run: 4 pass, 7 assertions, about 40 ms), the constants `PATH_EXTENSIONS` and `PATH_TOKEN`, and the helpers `looksLikeRepoPath`, `repoPathsNamedIn`, `missingRepoPaths` and `lsFiles`; nothing exported |

The blocks and what each asserts:

| Block | Test | What it asserts |
| --- | --- | --- |
| `progress.txt and @progress.txt are out of the index` | lists neither stray file, against a tracked file the same call finds | `git ls-files` (run with `execFileSync` at the repository root) does not contain `progress.txt` or `@progress.txt`, and does contain `package.json`, the positive control that proves the call can see the index at all |
| `.githooks/pre-commit names only paths that exist` | extracts exactly the two paths the hook comment and its exec line carry | `repoPathsNamedIn` over the hook gives `scripts/control-byte-gate/` and `scripts/control-byte-gate/control-byte-gate.ts`, pinned as a literal |
| | finds every one of them on disk | `missingRepoPaths` (a path token with a trailing `/` or a known source extension, joined to the root, tested with `existsSync`) is empty |
| | refuses a planted hook naming the old `tools/` path | the same text with `scripts/control-byte-gate/` replaced by `tools/control-byte-gate/` must report exactly those two paths missing, so a checker that always answers `[]` fails |

The test's module note explains the one trap in the extractor: the hook's comment contains `invisible/bidi`, a slash-joined word pair that is not a path, which is why a token counts as a path only with a trailing `/` or an extension in `{ts, js, mjs, cjs, json, md, sh}`. `progress.txt` is a gitignored derived file (`.gitignore`, line 49), so the first claim is a guard on a file someone could `git add -f`. The test imports `node:child_process`, `node:fs`, `node:path`, `node:url` and `bun:test`, nothing of the project.

## What crosses the boundary

- Outbound: none by import. It reaches `.githooks/pre-commit` and, through the hook's text, `scripts/control-byte-gate/` and `scripts/control-byte-gate/control-byte-gate.ts` (the control-byte gate, with its own `control-byte-gate.test.ts`); `scripts/` is outside the import graph, which covers `src/` and `packages/*/src/`, so those are not nodes. It spawns `git ls-files` once.
- Inbound: none by import. Three tracked tests name the file as a literal path: `src/start/task-gate-lines.test.ts` and `src/start/dispatch.test.ts` use its path as a sample always-run sweep in their fixtures, and `src/tests/default-plan-dirs.sweep.test.ts` names it in a comment beside `routing-table-agents.sweep.test.ts`; none imports it.
- Test reach, from `docs/survey/test-index.json`: index 0, 0 source files reached, no folders; `spawns: true`, through itself (the `git` child), which the index doubles into 0. It is selected by no changed file; it is an always-run sweep by its name (`.sweep.test.ts`, default `tests.alwaysRun` glob `src/**/*.sweep.test.ts` in `src/config-schema-tests.ts`), so every task's scoped run takes it, and its cost is one `git ls-files` and one file read. The survey's own check command runs it beside the spelling and git-identity sweeps.

## Entry points

An entry point is a member imported from outside the cluster, or a command registered from it. None of its members is imported, 0 registered commands are in it, and it provides no hook or engine. It is the repository's one test of the pre-commit hook: the hook itself (`.githooks/pre-commit`, enabled per clone with `git config core.hooksPath .githooks`) is a shell script with an `exec bun scripts/control-byte-gate/control-byte-gate.ts --staged`, and `package.json` has the matching script `gate:control-bytes`; neither is read by the loop.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | none | a sweep is not a command |
| Steps with guards | **missing** | none; the hook (`.githooks/pre-commit`) is a guard on staged content, outside rafa, and this test guards the hook | no registered step and no class; the hook is not a loop step |
| Config section | **missing** | none | no key read; `tests.alwaysRun` (`src/config-schema-tests.ts`, `c03-config`) is what makes it run and is not read here |
| Flows | **missing** | none | no multi-step path is driven; two scans and one planted control |

### Commands

None. The cluster owns no `RafaCommand`.

### Steps with guards

None registered. The only guard in sight is the control-byte gate the hook runs, which is a repository tool under `scripts/control-byte-gate/`, outside the package; the test pins the hook's path references so that a repoint of the gate cannot leave the hook describing a directory that moved.

### Config section

None. The test's parameters are constants in the file (`PATH_EXTENSIONS`, `PATH_TOKEN`) and the two stray names; `progress.txt` is ignored by `.gitignore`, not by config.

### Flows

None.

## Gaps

1. **The claims are about the repository, and cut with no package** (cut boundary). The test names `progress.txt`, `@progress.txt`, `package.json`, `.githooks/pre-commit` and `scripts/control-byte-gate/` at the repository root through `REPO_ROOT` (`../../` from `src/tests`). A cut that leaves one root repository with several packages keeps them true and the test unchanged; a cut that splits into separate repositories needs one such check per root, and `package.json` as the control file would have to be each root's own.
2. **The hook and its gate sit outside the survey's graph** (provenance). `scripts/` has no node in `docs/survey/import-graph.json`, and neither does `.githooks/`; the test is the one that reads the hook's path references, which makes the pinned two-path literal in its second test the contract between the hook and the gate (its note says why: a hook that drops one path or names a third reddens there before the existence check can hide it). A cut that moves `scripts/` has to change the literal and `src/tests/repo-hygiene.sweep.test.ts` in the same commit as the hook.
3. **The extractor reads prose and code the same way** (test fidelity). A path in the hook counts only with a trailing `/` or one of seven extensions (`ts`, `js`, `mjs`, `cjs`, `json`, `md`, `sh`); a path the hook gains with another extension, a `.yml` for instance, is not seen. This is deliberate, per the module note, and it is the file to change if the hook starts naming other file types.
4. **No contract surface** (the four exports, all missing). There is nothing to port to `run(ctx, options)`, a step registry or a config section from here.

## Cut order this implies

Nothing has to be cut out of this cluster, and nothing waits on it. The sweep stays at the repository root as a repo-level check on the index and the hook, in the always-run set, for as long as `progress.txt` is a derived file and the hook points at `scripts/control-byte-gate/`. A package cut does not touch it unless the hook, the gate or `package.json` moves, in which case its literal moves in the same commit (gap 2). It is first and last in no order, and is the cheapest check the cut has: one `git ls-files`.
