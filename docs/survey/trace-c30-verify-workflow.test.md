# Trace: `c30-verify-workflow.test`

Coverage: 1 of 1 cluster member read, the 1 file `docs/survey/import-graph.json` lists for `c30-verify-workflow.test`; it is tracked by `git ls-files`, and no tracked member was left unread. The member is a test (`src/tests/verify-workflow.test.ts`, 145 lines), read in full for what it asserts and which file it parses, and through the graph and `docs/survey/test-index.json` for its place in them; the workflow file it parses (`.github/workflows/verify.yml`, 40 lines) was read in full.

Cluster 30 of 32 by the `NN` of its name, and one of the 19 single-file clusters (`c14` to `c32`). Every cluster in the JSON has its own `trace-<cluster>.md` beside this one. The cluster is **the one gate on the hosted verify workflow**: the root eslint config lints no YAML, so `src/tests/verify-workflow.test.ts` is the only check on `.github/workflows/verify.yml`, the workflow that runs `bun test`, `bunx eslint .` and `bunx tsc --noEmit` on every pull request into `main` and on every push to a `stretch/**` branch. It parses the file with `Bun.YAML.parse` and asserts its triggers (pull requests into `main` and pushes to `stretch/**` only, and neither branch under the other event, with a control over a file that swaps them), that the trigger key reads as the string `on` and not a YAML 1.1 boolean, one job `verify`, the three gate steps by name and command each under the `${{ !cancelled() }}` guard and last in the job, the install from the frozen lockfile before the first gate, the checkout and `setup-bun` steps, `contents: read` permissions and a 30 minute timeout. It holds 12 test definitions in two `describe` blocks (one an `it.each` over the three gates, so 14 cases). Its hub is itself, being the only member; its betweenness is 0, as it has no edge to carry a path through.

The contract the exports are read against is `run(ctx, options)` from #119 (step registry, guards with a class, consent in `ctx.answered`, `--dry-run`) and config and flows through define-config from #118 and #71. Neither has landed: `src/steps/` and `src/flows/` do not exist, no source file imports `@open-tomato/define-config` (the name appears only as text in `src/preflight/prerequisites-md.ts` and `src/start/preflight.test.ts`), and `gh issue view 119` and `gh issue view 71` both read OPEN. This cluster would give the contract nothing: it is a check on one CI file, not a unit of behaviour. The workflow it guards is the one place the three gates run outside a loop run, which makes it adjacent to the contract's guards without being part of them.

## Members and folders

| Folder | Files | Holds |
| --- | --- | --- |
| `src/tests` | 1 | `verify-workflow.test.ts`: the `Step` and `Workflow` shapes, `parse`, `branchesOf`, `steps()`, the `GATES` table and `GUARD` constant, and two `describe` blocks |

`src/tests` holds 188 files, of which this is one; the rest are spread over 25 other clusters (`c08-cli-capture` has 71, `c02-active` 26, `c01-github` 25). The member imports `node:fs`, `node:path`, `node:url` and `bun:test`, and no project file, which is why it has no edge in the graph. It names one tracked file by path, `.github/workflows/verify.yml`, resolved from the repository root through `import.meta.url`, so it runs from any working directory. Its sibling for the other workflow is `src/tests/epic-guard-workflow.test.ts` (`c20-epic-guard-workflow.test`), which guards `.github/workflows/epic-guard.yml` the same way.

## What crosses the boundary

Outbound: no imports of project files, so 0 edges to any cluster (0 value, 0 type). Inbound: 0 edges; nothing imports it.

By path and not by import, it touches the workflow, which other files describe or name: `context/verification.md` (lines 118 to 128, the triggers, gates and the two cases of `gh pr checks`), `src/pr/workflow-triggers.ts` (`c06-command`; answers whether any workflow runs on pull requests into a given base, with `verify.yml` as its named example, for `rafa pr merge --skip-checks`; its tests `src/pr/workflow-triggers.test.ts`, `src/commands/pr/merge-skip-checks.test.ts` and `src/commands/pr/merge-unchecked.test.ts` name the file too). `src/start/lint-step.test.ts` names the file only as an ignored path in a lint case. None of those import this test, and this test reads none of them, so the test, the context page and the reader of workflow triggers agree by hand.

Test reach, from `docs/survey/test-index.json`: the test has index 0 (no source file reached, no folder counted, `spawns` false). It is one of 44 of the 908 indexed tests at 0. Its name has no `.sweep.test.ts` suffix, it imports no project file and it reads a repository file at run time, so neither `bun test --changed=<base>` nor `tests.alwaysRun` (`src/config-schema-tests.ts`, default `src/**/*.sweep.test.ts`) selects it when `verify.yml` changes; it runs in a full pass, which is the same pass the workflow runs on `main`.

## Entry points

No member is imported from outside the cluster. No `RafaCommand` is registered from it, and it provides no hook or engine to code outside it. The workflow file it guards is the entry point GitHub reads, not one the code imports.

## The four exports

| Export | Status | Where it is held | What is missing |
| --- | --- | --- | --- |
| Commands | **missing** | none | the cluster is a test; no `RafaCommand` |
| Steps with guards | **missing** | none; the test is a gate on a CI file, run by `bun test` | no step, no guard class; the workflow's own `if: ${{ !cancelled() }}` guards are GitHub's, not rafa's |
| Config section | **missing** | none; reads no config key | none needed; the workflow's branches are in the YAML, not in `RafaConfig` |
| Flows | **missing** | none | no multi-step path; one read of one file, one parse, and assertions on it |

### Commands

None. The workflow it guards runs the three gate commands (`bun test`, `bunx eslint .`, `bunx tsc --noEmit`), none of them a `RafaCommand`.

### Steps with guards

None. The test is a gate in the sense of `context/verification.md`: a test in the suite, not a step a loop run contributes. The workflow's three gates are repeated outside the loop and are not a registered step list, and the three `if` guards it asserts are conditions on GitHub's runner. Its class, if the contract gave it one, would be a reading.

### Config section

None, and no config read. The branches `main` and `stretch/**` that the workflow names are the same two the pull-request module and the context page name, with no setting behind them.

### Flows

None.

## Gaps

Every export is missing; the cluster is a test, so a cut moves it and does not fill the exports.

1. **No command, step, config key or flow** (all four, missing). Nothing to add; a check on a workflow file is not one of the four exports.
2. **The test runs only in a full pass** (test index, flows). It has index 0, no `.sweep.test.ts` suffix and no project import, so a change to `.github/workflows/verify.yml` selects nothing under `--changed`. The file a cut would have to change is `src/tests/verify-workflow.test.ts` (a `git mv` to `verify-workflow.sweep.test.ts`, which the default `tests.alwaysRun` pattern then takes), or the detector in `src/tests/sweep-suffix.sweep.test.ts` (`c29-sweep-suffix.sweep.test`), which does not flag a `readFileSync` of a fixed path.
3. **The workflow's gates are a second copy of the loop's** (config, cut boundary). `bun test`, `bunx eslint .` and `bunx tsc --noEmit` are the `GATES` table in this test and the three steps of the YAML; the loop runs the same three kinds of check through `src/start/lint-step.ts` (eslint on the changed files), `src/start/type-step.ts` and the scoped test run governed by `tests.*` in `src/config-schema-tests.ts`, on a task's changed files where the workflow runs the whole tree. Nothing ties them: a cut that gives the tests, the lint and the type check a config section of their own leaves the workflow, this table and `context/verification.md` to be updated by hand together, or this test to read the commands from the config.
4. **One test per workflow file, with a copied parser** (cut boundary). `src/tests/verify-workflow.test.ts` and `src/tests/epic-guard-workflow.test.ts` (`c20`) each define their own `ROOT` constant and read a workflow with `readFileSync`, and share no helper. A cut that moves the workflows into a package or an extras tree has to change the path in each (`.github/workflows/verify.yml` in this file) and, if they keep a shared parse, lift it to one test-support file.
5. **A root workflow covers one root's gates** (cut boundary). `verify.yml` runs the root `bun test`, `bunx eslint .` and `bunx tsc --noEmit`, whereas `check-types` in the root `package.json` runs `tsc --noEmit` and the packages' own. The test asserts the command line as the YAML spells it (`GATES`), so a cut that splits the repository into packages and gives each its own gate changes `GATES` and the `names.slice(-GATES.length)` order check in this file, together with `.github/workflows/verify.yml`.

## Cut order this implies

Taken last and alone: the test has no edge to cut, so it goes where the workflow goes. It stays at the repository root as a repo-level check, since the workflow it guards is a root file that gates every package and any package built from this tree is checked by it; it moves with the workflow only if the workflow moves (gap 4). Gap 2 (the rename) is independent of any cut and the cheapest change in the cluster; gaps 3 and 5 are decided when the tests, lint and type-check commands get a config section of their own, and not before.
