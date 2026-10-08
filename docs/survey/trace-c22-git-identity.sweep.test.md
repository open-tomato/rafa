# Trace: `c22-git-identity.sweep.test`

Coverage: 1 of 1 cluster members read, the 1 file `docs/survey/import-graph.json` lists for `c22-git-identity.sweep.test` (`src/tests/git-identity.sweep.test.ts`, 328 lines); it is tracked by `git ls-files`, and no tracked member was left unread. The one member is a test, so no source export was read; the test was read in full as well as through the graph and `docs/survey/test-index.json`, because the note on it has to say what it sweeps.

`c22` ranks 22nd of the 32 clusters in the import graph by number, and by size it sits among the 19 one-file clusters (`c14` to `c32`) that follow the twelve real ones; every cluster in the JSON has its own `trace-<cluster>.md` beside this one. 0 edges inside it, 0 leaving, 0 entering; betweenness 0, as for the 992 of the graph's 1577 files that no shortest path runs through. The cluster is **a content sweep over the whole tree**: it reads every `.ts`, `.tsx`, `.js` and `.mjs` file under `src/` and `packages/` as text (1,577 files today, 1,536 under `src/` and 41 under `packages/`; `node_modules/` left out) and asserts three rules about the environment a test hands a spawned process, so that a scratch repository never depends on the host's git identity or the operator's home. Its hub is itself.

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. None has landed, as the earlier traces record, and as rechecked here: `src/steps/` and `src/flows/` do not exist, no source or `package.json` file imports `@open-tomato/define-config` (the name appears only in `src/preflight/prerequisites-md.ts` and two tests, as an npm availability probe in prose), and `gh issue view` shows #118, #119 and #71 still open. This cluster is a repo-level check; it owns none of the four exports.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src/tests` | 1 | `git-identity.sweep.test.ts`: three `describe` blocks and 25 tests (run: 25 pass, 25 assertions), eight helper functions of its own (`setsConfigWithoutHelper`, `setsHomeWithoutHelper`, `keysBeforeSpread`, `spreadsHomeWithoutTmpdir`, `argumentsAt`, `splitArguments`, `callsOptionalGitSeamWithoutIt`, `offendingFiles`) over a handful of constants, and nothing exported |

The three blocks are the three rules:

| Block | Rule | Tests |
| --- | --- | --- |
| `git identity sweep` | no source names `GIT_CONFIG_GLOBAL` without `gitIdentityEnv`; no source sets a scratch `HOME` object key for a spawned process (a spawn call in the same source) with neither `scratchHomeEnv` nor `gitIdentityEnv` | 12: two live sweeps, ten planted sources (flags, accepts, ignores) |
| `optional git seam sweep` | no source that sets `GIT_CONFIG_GLOBAL` calls `addRunWorktree` without a `git` seam in its second argument | 5: one live, four planted |
| `scratch HOME TMPDIR sweep` | no source under `src/` spreads `scratchHomeEnv(` into an object literal that carries no `TMPDIR` key before the spread | 8: one live, seven planted |

Each live sweep has planted controls beside it: a planted source the matcher must flag, and ones it must accept or ignore, so that an empty offender list is not what a matcher that stopped matching would also answer. `EXEMPT` names five sources with a reason: itself, `src/tests/git-identity.ts` and `src/tests/scratch-home-env.ts` (the helpers spell the variables), `packages/rafa-hub/src/testdata/scratch-home-env.ts` (the hub's own copy of the helper) and `src/tests/cli-capture.test.ts` (a control that spawns under `HOME` alone on purpose). The `TMPDIR` rule reads only `src/`, since the hub's spawned suites under `packages/` spread their own copy. The test imports `node:path` and `bun:test` only; it reads files with `Bun.Glob` and `Bun.file`, and spawns nothing (the index says `spawns: false`).

## What crosses the boundary

- Outbound: none by import. The test names, and exempts, three helpers it never imports: `src/tests/git-identity.ts` (`gitIdentityEnv`) and `src/tests/scratch-home-env.ts` (`scratchHomeEnv`), both in `c08-cli-capture` (imported by 121 and 56 files, per the graph), and `packages/rafa-hub/src/testdata/scratch-home-env.ts` (`c12-index`). It reads `addRunWorktree` by name; that function is `src/start/worktree.ts` (`c02-active`), whose `git` seam is optional and falls back to `createGitRunner`, the host's own identity.
- Inbound: none. Nothing imports a test.
- Test reach, from `docs/survey/test-index.json`: index 0, 0 source files reached, no folders, no process spawned. A change to any source file leaves it unselected by `bun test --changed=<base>`; it runs on every task anyway, because its name ends `.sweep.test.ts` and the default `tests.alwaysRun` glob is `src/**/*.sweep.test.ts` (`src/config-schema-tests.ts`, line 135), which `src/start/task-always-run.ts` resolves and adds to a scoped run. It is one of the nine tracked sweeps under `src/tests/`. Its cost is one tree read: about 350 ms for the 25 tests on this checkout.

## Entry points

An entry point is a member imported from outside the cluster, or a command registered from it. None of its members is imported, 0 registered commands are in it, and it provides no hook or engine. Its entry is the runner: `bun test` and the task gate's always-run line (`src/start/task-gate-lines.ts`, which names the resolved sweeps in the task prompt). The survey's own check command runs it beside `src/tests/user-facing-spelling.sweep.test.ts` and `src/tests/repo-hygiene.sweep.test.ts`; it reads only `src/` and `packages/`, so it never reads the trace files themselves.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | none | a sweep is not a command |
| Steps with guards | **missing** | none; the sweep gates every task through `tests.alwaysRun` (`src/start/task-always-run.ts`, `c02-active`), but the step is that file's | the sweep is the guard on a convention (isolate git and `HOME` in a spawned fixture), not a step with a class |
| Config section | **missing** | none; it reads no config key; `tests.alwaysRun` (`src/config-schema-tests.ts`, `c03-config`) is what makes it run, and it is not read here | no section of its own |
| Flows | **missing** | none | no multi-step path is driven; the sweep is a scan and a set of regex predicates |

### Commands

None. The cluster owns no `RafaCommand`.

### Steps with guards

None registered. The nearest thing is a convention enforced by text: every fixture that points `GIT_CONFIG_GLOBAL` at a scratch file, or sets a scratch `HOME` for a spawn, must spread the identity helper and the `TMPDIR` key. A cut puts that on the package that owns the helper (gap 1), not on the test.

### Config section

None. The sweep's own parameters are constants in the file: `SWEEP_ROOTS` (`src`, `packages`), `TMPDIR_SWEEP_ROOTS` (`src`), `OPTIONAL_GIT_SEAM_CALLS` (`addRunWorktree`) and `EXEMPT`.

### Flows

None.

## Gaps

1. **The sweep names helpers in two packages and reads the tree of both** (cut boundary). `SWEEP_ROOTS` is `['src', 'packages']`, and `EXEMPT` names `packages/rafa-hub/src/testdata/scratch-home-env.ts` (the hub's copy of `scratchHomeEnv`) beside the two helpers under `src/tests/`. A cut that makes `packages/` a set of real packages has to keep the sweep reading all of them from the repository root (it stays at the root as a repo-level check, `src/tests/git-identity.sweep.test.ts`), or give each package its own sweep that reads its own tree and carries its own `EXEMPT`; `packages/rafa-hub/src/testdata/scratch-home-env.ts` is already an acknowledged duplicate whose `TMPDIR` rule is left out of the sweep (`TMPDIR_SWEEP_ROOTS`).
2. **The sweep encodes a function of `c02-active` by name** (cut boundary). `OPTIONAL_GIT_SEAM_CALLS` is `['addRunWorktree']`, whose home is `src/start/worktree.ts`, and the note on it says only `addRunWorktree` reaches a command that needs an identity (the catch-up `git merge --no-edit`). If the seam stops being optional the list and the two tests on it go; if another function gains an optional seam, `src/tests/git-identity.sweep.test.ts` is the file to change.
3. **The helpers are the survey's most imported test support and live in `c08-cli-capture`** (cut boundary). The sweep guards `src/tests/git-identity.ts` and `scratch-home-env.ts`, which 121 and 56 files import; a cut that moves test support into its own package moves them first, and `EXEMPT` has to follow the new paths, or the sweep reds on the helpers it exempts today.
4. **The sweep is path-and-text based and not selected by import** (test index). With index 0 it never rides a scoped run through the graph, only through the `tests.alwaysRun` glob; a rename of the file away from the `.sweep.test.ts` suffix would silently turn it into a once-in-a-full-suite check (`src/tests/sweep-suffix.sweep.test.ts` is the guard on that, in `c29-sweep-suffix.sweep.test`).
5. **No contract surface** (the four exports, all missing). There is nothing to port to `run(ctx, options)`, a step registry or a config section from here.

## Cut order this implies

The sweep stays at the repository root as a repo-level check; it has no source to move and nothing waits on it. It has to be updated, not moved, when the things it names move: first when test support leaves `src/tests/` (gap 3, its `EXEMPT` paths), when `packages/` splits (gap 1), and last when `addRunWorktree`'s seam is made required (gap 2). Because it reads text across both roots, it is also the check that a package cut did not leave a fixture that sets `GIT_CONFIG_GLOBAL` without the identity helper, which is why it should be green before the first package is cut and stay in the always-run set through the whole cut.
