# Trace: `c29-sweep-suffix.sweep.test`

Coverage: 1 of 1 cluster member read, the 1 file `docs/survey/import-graph.json` lists for `c29-sweep-suffix.sweep.test`; it is tracked by `git ls-files`, and no tracked member was left unread. The member is a test (`src/tests/sweep-suffix.sweep.test.ts`, 172 lines), read in full for what it detects and asserts, and through the graph and `docs/survey/test-index.json` for its place in them.

Cluster 29 of 32 by the `NN` of its name, and one of the 19 single-file clusters (`c14` to `c32`). Every cluster in the JSON has its own `trace-<cluster>.md` beside this one. The cluster is **the meta sweep that keeps the always-run sweeps findable**: a test that reads the repository tree at run time must end in `.sweep.test.ts`, because `bun test --changed=<base>` follows the import graph, a test that imports no project file is never selected by a changed file, and the suffix is how `tests.alwaysRun` (default `src/**/*.sweep.test.ts`) finds it. `src/tests/sweep-suffix.sweep.test.ts` lists every tracked `*.test.ts`, reads each file that lacks the suffix, and fails naming any that calls `git ls-files` on this repository or walks the repository root (a glob scan, `readdirSync` or `readdir` rooted at `REPO_ROOT` or `repoRoot`). It holds 14 tests in four `describe` blocks (the sweep and its listing guard, the `ls-files` detector, the root-walk detector, the suffix check), all but two over planted sources. Its hub is itself, being the only member; its betweenness is 0, as it has no edge to carry a path through.

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. Neither has landed: `src/steps/` and `src/flows/` do not exist, no source file imports `@open-tomato/define-config` (the name appears only as text in `src/preflight/prerequisites-md.ts` and `src/start/preflight.test.ts`), and `gh issue view 119` and `gh issue view 71` both read OPEN. This cluster would give the contract nothing: it is a check on file names.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src/tests` | 1 | `sweep-suffix.sweep.test.ts`: the regexes `LS_FILES_ARG`, `GIT_SPAWN`, `SCRATCH_MARKER` and `ROOT_WALK`, the predicates `callsLsFiles`, `walksRoot`, `readsRepositoryTree` and `lacksSweepSuffix`, `unsuffixedSweeps(listing)`, `trackedFiles()` (`git ls-files -z -- '*.test.ts'`) and the planted sources |

`src/tests` holds 188 files, of which this is one; the rest are spread over 25 other clusters (`c08-cli-capture` has 71, `c02-active` 26, `c01-github` 25). The member imports `node:child_process`, `node:path` and `bun:test`, and no project file and no package beyond them. It names one file, `src/tests/git-identity.sweep.test.ts` (`c22-git-identity.sweep.test`), as the committed sweep its listing check expects to find; the file exists and is tracked. It skips itself by `SELF`, since its own text holds the planted `ls-files` sources it would otherwise flag.

## What crosses the boundary

Outbound: no imports of project files, so 0 edges to any cluster (0 value, 0 type). Inbound: 0 edges; nothing imports it. By path it lists every tracked `*.test.ts` (git's `*` crosses directories, so `packages/` is read as well as `src/`) and reads the source of each that lacks the suffix, so it reads members of every cluster that holds a test.

Test reach, from `docs/survey/test-index.json`: the test has index 0 (no source file reached, no folder counted) and `spawns` true, with itself as the only `spawnsVia` (its `node:child_process` import, used for the one `git ls-files` call). It is one of 44 of the 908 indexed tests at 0. It matches the rule it enforces: its suffix is what `tests.alwaysRun` (`src/config-schema-tests.ts`, default `src/**/*.sweep.test.ts`, line 135) takes, so a task's scoped run includes it beside the `--changed` selection. A full pass reads every `*.test.ts` that lacks the suffix once.

## Entry points

No member is imported from outside the cluster. No `RafaCommand` is registered from it, and it provides no hook or engine to code outside it. `src/config-schema-tests.ts` and `src/start/task-always-run.ts` document the same rule from the setting's side (a content sweep sits outside every import graph and is taken by the suffix).

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | none | the cluster is a test; no `RafaCommand` |
| Steps with guards | **missing** | none; the test is a gate, run by `bun test` and by the always-run sweeps step | no step, no guard class; what it guards is a naming rule on test files |
| Config section | **missing** | none; reads no config key | none needed; the rule restates the default of `tests.alwaysRun`, which `src/config-schema-tests.ts` owns |
| Flows | **missing** | none | no multi-step path; list, read, detect, compare |

### Commands

None.

### Steps with guards

None. The check is a gate in the sense of `context/verification.md` ("always-run sweeps"): a test in the suite, not a step a loop run contributes. Its class, if the contract gave it one, would be a reading.

### Config section

None, and no config read. The suffix `.sweep.test.ts` is a constant in this file (`SWEEP_SUFFIX`) and the default pattern in `src/config-schema-tests.ts` (`['src/**/*.sweep.test.ts']`, line 135) is a second spelling of it; a project that sets `tests.alwaysRun` to another pattern keeps passing this sweep, which reads the repository's own convention and not the setting.

### Flows

None. The sweep is one pass (list tracked tests, read each lacking the suffix, apply the two detectors), and the detectors are pure functions over source text.

## Gaps

Every export is missing; the cluster is a test, so a cut moves it and does not fill the exports.

1. **No command, step, config key or flow** (all four, missing). Nothing to add; a naming sweep is not one of the four exports.
2. **The suffix is spelled in two places** (config, cut boundary). `SWEEP_SUFFIX` in `src/tests/sweep-suffix.sweep.test.ts` and the `tests.alwaysRun` default in `src/config-schema-tests.ts` agree today by hand; a cut that gives the tests section its own file (as the five `config-schema-*.ts` section files do) has to keep one of them as the source of the other, or the sweep passes a rename the setting no longer matches.
3. **The detectors read text, so they have blind spots** (flows, partial). `callsLsFiles` needs `'ls-files'` as a literal, a `git` spawn and no scratch marker; `walksRoot` needs the constants `REPO_ROOT` or `repoRoot`. A test that reads fixed tracked paths with `readFileSync` is not flagged: `src/tests/skill-gap-section.test.ts` (`c27-skill-gap-section.test`) and `src/tests/verify-workflow.test.ts` (`c30-verify-workflow.test`) each import no project file and read repository files at run time, carry no suffix, and are therefore not selected by `--changed` when the file they guard changes. Closing it changes the detectors in this file (a third detector for a `readFileSync` or `Bun.file` of a path outside the test's own folder) or renames those two files.
4. **It reads the whole repository's tests and names one of them** (cut boundary). The listing check expects `src/tests/git-identity.sweep.test.ts` in `trackedFiles()`, named instead of this file because the comment above the line says this file is untracked until the loop commits it. A cut that moves or renames that sweep changes the `toContain` in this file's second test.
5. **Root constants are a convention** (cut boundary). The root-walk detector keys on the names `REPO_ROOT` and `repoRoot`; a test of a package under `packages/` that calls its root `ROOT` or `PACKAGE_DIR` is not seen. A cut that gives each package its own tests has to extend `ROOT_WALK` in this file or settle one name.

## Cut order this implies

Taken last and alone: the test has no edge to cut, so it goes where the tests it governs go, and it governs all of them, so it stays at the repository root as a repo-level check. It keeps its `.sweep.test.ts` suffix, and so `tests.alwaysRun` still selects it. The one coupling to resolve before any cut moves a test is gap 2 (the two spellings of the suffix), and the one that tells whether a cut has left a sweep unselected is gap 3, which is the reason the sweep exists and which the two files named there currently escape.
