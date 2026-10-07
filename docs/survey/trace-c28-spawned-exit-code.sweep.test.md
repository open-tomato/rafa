# Trace: `c28-spawned-exit-code.sweep.test`

Coverage: 1 of 1 cluster member read, the 1 file `docs/survey/import-graph.json` lists for `c28-spawned-exit-code.sweep.test`; it is tracked by `git ls-files`, and no tracked member was left unread. The member is a test (`src/tests/spawned-exit-code.sweep.test.ts`, 676 lines), read in full for what it detects and what it asserts, and through the graph and `docs/survey/test-index.json` for its place in them. The files it names (`src/tests/cli-capture.ts`, `src/tests/loop-scratch.ts`) were checked for the exports it depends on, and are not members.

Cluster 28 of 32 by the `NN` of its name, and one of the 19 single-file clusters (`c14` to `c32`). Every cluster in the JSON has its own `trace-<cluster>.md` beside this one. The cluster is **one content sweep over the test tree**: a test that parses every tracked test file under `src/` with the TypeScript compiler and fails when one asserts the exit code of a spawned rafa run with a bare `expect(run.exitCode).toBe(n)` instead of `expectExit` from `src/tests/cli-capture.ts` (#775). It holds two detectors, the spawned-rafa detector (`spawnsRafa`) and the bare-assertion detector (`bareExitAssertions`), 20 tests in three `describe` blocks (the repository sweep with its listing guard, 10 planted-source cases for the assertion detector, 8 for the spawn detector), and the detector code (lines 48 to 454) before them. Its hub is itself, being the only member; its betweenness is 0, as it has no edge to carry a path through.

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. Neither has landed: `src/steps/` and `src/flows/` do not exist, no source file imports `@open-tomato/define-config` (the name appears only as text in `src/preflight/prerequisites-md.ts` and `src/start/preflight.test.ts`), and `gh issue view 119` and `gh issue view 71` both read OPEN. This cluster would give the contract nothing: it is a check on the tests, not a unit of behaviour.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src/tests` | 1 | `spawned-exit-code.sweep.test.ts`: the two detectors, the scope readers they share (`valuesOf`, `declaredIn`, `rootName`), `trackedTests()` (a `git ls-files -z -- 'src/*.test.ts'`, 889 files today), `offenders(paths)`, and the planted sources |

`src/tests` holds 188 files, of which this is one; the rest are spread over 25 other clusters (`c08-cli-capture` has 71, `c02-active` 26, `c01-github` 25). The member imports `node:child_process`, `node:path`, `bun:test` and the `typescript` package, and no project file; like `c22-git-identity.sweep.test`, `c25-repo-hygiene.sweep.test` and `c26-routing-table-agents.sweep.test`, it is a sweep the survey sets apart as a cluster of one, because a sweep imports no project file. It names, in strings and comments and not by import, `src/tests/cli-capture.ts` (`expectExit`, `runRafa`, `startRafa`), `src/tests/loop-scratch.ts` (`RAFA_ENTRY`, `runLoopStart`), `src/commands/doctor.test.ts` and `src/tests/loop-output.test.ts` (the last two asserted present in the listing, so an empty read fails). All four exist and are tracked; `cli-capture.ts` and `loop-scratch.ts` are in `c08-cli-capture`. The detector's `SHARED_RUNNERS` constant (`runRafa`, `startRafa`, `runLoopStart`) and its `RAFA_ENTRY` constant restate those helpers' names, so a rename there has no compiler to tell this file.

## What crosses the boundary

Outbound: no imports of project files, so 0 edges to any cluster (0 value, 0 type). Inbound: 0 edges; nothing imports it. By path it reads all 889 tracked `src/*.test.ts` files (git's `*` crosses directories), so it reads members of every cluster that holds a test and no source file. The 19 tracked `.test.ts` files under `packages/` are outside its pathspec.

Test reach, from `docs/survey/test-index.json`: the test has index 0 (no source file reached, no folder counted) and `spawns` true, with itself as the only `spawnsVia` (its `node:child_process` import, used for the one `git ls-files` call; the detectors' `Bun.spawnSync` and `spawn` texts are planted strings it parses). It is one of 44 of the 908 indexed tests at 0. It is the always-run kind: its `.sweep.test.ts` suffix is what `tests.alwaysRun` (`src/config-schema-tests.ts`, default `src/**/*.sweep.test.ts`) matches, so a task's scoped run takes it beside the `--changed` selection. A full pass reads 889 files and parses each one with the compiler, so it is far from the cheapest 0-index test.

## Entry points

No member is imported from outside the cluster. No `RafaCommand` is registered from it, and it provides no hook or engine to code outside it. `context/verification.md` (lines 445 to 456) names it as the rule that spawned cases use `expectExit` or `expectEvent`.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | none | the cluster is a test; no `RafaCommand` |
| Steps with guards | **missing** | none; the test is a gate, run by `bun test` and by the always-run sweeps step | no step, no guard class; what it guards is a style rule on 889 tests |
| Config section | **missing** | none; reads no config key | none needed; it is selected by `tests.alwaysRun`, which `src/config-schema-tests.ts` owns |
| Flows | **missing** | none | no multi-step path; list, parse, detect, compare |

### Commands

None.

### Steps with guards

None. The check is a gate in the sense of `context/verification.md` ("always-run sweeps"): a test in the suite, not a step a loop run contributes. Its class, if the contract gave it one, would be a reading: it changes nothing and refuses nothing in a run.

### Config section

None, and no config read. It runs because of the suffix its name carries and the `tests.alwaysRun` default that matches it.

### Flows

None. The sweep is a single pass (list the tracked tests, parse each, collect `<path>:<line>: <assertion>`), and the detectors are a chain of pure functions over a syntax tree.

## Gaps

Every export is missing; the cluster is a test, so a cut moves it and does not fill the exports.

1. **No command, step, config key or flow** (all four, missing). Nothing to add; a style sweep is not one of the four exports.
2. **The sweep reads `src/` and not `packages/`** (cut boundary). `trackedTests()` passes the pathspec `src/*.test.ts`; the 19 `.test.ts` files under `packages/` (the hub's two workspaces) are not read. A cut that moves tests into `packages/*` takes them out of the rule unless `trackedTests()` in `src/tests/spawned-exit-code.sweep.test.ts` widens its pathspec, and the second test of the file (the listing holds `src/commands/doctor.test.ts` and `src/tests/loop-output.test.ts`) changes with it.
3. **The detector restates the shared helpers' names** (cut boundary). `SHARED_RUNNERS` (`runRafa`, `startRafa`, `runLoopStart`), `ENTRY_CONSTANT` (`RAFA_ENTRY`) and `ENTRY_PATH` (`rafa.ts`, `cli.js`) are string constants for exports of `src/tests/cli-capture.ts` and `src/tests/loop-scratch.ts` (`c08-cli-capture`) and for the entry file. A cut that renames or moves one has to change those constants in this file; nothing fails to compile if it forgets, and the sweep then reads a spawned run as an in-process one and passes.
4. **A second `typescript` consumer** (cut boundary). The file parses with the `typescript` package (a dev dependency of the root `package.json`, imported as `ts`); `src/tools/ts-symbols/cli.ts` (`c32-cli`) loads the project's own copy by a walk and does not import it. A cut that gives the tests a package of their own gives it `typescript` as a dev dependency.
5. **It is the heaviest of the sweeps** (test index). 676 lines, of which lines 48 to 454 are detector code with its own planted-source tests, in a file whose index is 0. It is a candidate to split into a detector module and the sweep (a helper beside the test in `src/tests/`), so that another sweep can reuse the scope reader (`valuesOf`); today nothing but this file uses the detectors.

## Cut order this implies

Taken last and alone: the test has no edge to cut, so it goes with the tests it governs. It stays at the repository root as a repo-level check, running over every package's tests once gap 2's pathspec is widened, and it keeps its `.sweep.test.ts` name so `tests.alwaysRun` still selects it. If `src/tests/cli-capture.ts` moves into a test-support package, gap 3's constants change in the same commit. It does not constrain the order of any other cluster's cut, but a cut that moves spawning tests between folders is checked by it as soon as they land.
