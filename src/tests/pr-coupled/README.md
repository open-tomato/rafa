# Pr's parked tests

Pr's unit tests that import a file outside core, pr and the packages pr declares wait here, outside pr's package,
since pr moved into `packages/rafa-pr/` (#808, pass 4e). Each sits at its path under `src/` before the move:
`src/commands/pr/merge.test.ts` is `commands/pr/merge.test.ts` here, and its code is under test at
`packages/rafa-pr/src/commands/pr/merge.ts`.

A file's text was not rewritten beyond its specifiers. An import of a pr file reads that file's subpath,
`@open-tomato/rafa-pr/<subpath>`, an import of a core file keeps its `@open-tomato/rafa/<subpath>` text, and an
import of a root file reads the relative path from here. A path built from `import.meta` was pointed by hand at the
file or folder it named before the move: `commands/pr/triage-fixtures.test.ts` reads the captured fixtures in the
root's `src/tests/fixtures/pr-triage/`, and `pr/conflict-sentence.sweep.test.ts` walks the root's `src/` and
`packages/rafa-pr/src/` and finds its one allowed copy at `packages/rafa-pr/src/pr/conflict-sentence.ts`.

An import of a board, release or inventory file reads that file's subpath (`@open-tomato/rafa-board/<subpath>`,
`@open-tomato/rafa-release/<subpath>`, `@open-tomato/rafa-inventory/<subpath>`). Pr declares the three in its
`dependencies`, so since this move the tool counts a file of theirs as inside: 26 tests that reach only board,
release and inventory files outside core and pr moved with their sources into the package instead of parking here.
An import of an effort file reads that file's subpath, `@open-tomato/rafa-effort/<subpath>`, and is listed below as
the tool printed it, since pr does not declare effort.

The test-index guard (`scripts/survey/test-index.ts --against`) reads these files as any test: under its own path,
in the unit the cut table lists it in, and held to the rule of its kind. A later spec sorts each file: back into the
package once its coupling is gone, or into the module it really tests.

## What each file reaches outside core, pr and its declared packages

| Test file | Reaches |
| --- | --- |
| `commands/pr/close.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/current.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/list-forecast.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/list.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/merge-driven.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/merge-guard.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/merge-loop-holder.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/merge-native.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/merge-plan-ci.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/merge-settle.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/merge-skip-checks-driven.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/merge-skip-checks.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/merge-untracked.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/merge.test.ts` | `src/tests/cli-capture.ts`, `src/tests/ending-probe.ts` |
| `commands/pr/open.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/pr-context.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/retarget.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/show.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/triage-config-trust.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/triage-fixtures.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/triage-plan-ci.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/triage-resolve-driven.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/triage-resolve.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/triage.test.ts` | `src/tests/cli-capture.ts`, `src/tests/ending-probe.ts` |
| `commands/pr/view.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/wait-grace-driven.test.ts` | `src/tests/cli-capture.ts` |
| `commands/pr/wait.test.ts` | `src/tests/cli-capture.ts`, `src/tests/ending-probe.ts` |
| `pr/conflict-sentence.sweep.test.ts` | `packages/rafa-effort/src/effort/classify.ts`, `src/start/wrap-up.ts`, `src/tests/sweep-timeout.ts` |
| `pr/preflight-items.test.ts` | nothing since `run.ts` moved into core as `packages/rafa/src/preflight/run.ts` (#808, pass 4f) |
| `triage/leftover-repair.test.ts` | `src/start/suite-blocker.ts` |
