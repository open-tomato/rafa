# Board's parked tests

Board's unit tests that import a file outside core and board wait here, outside board's package, since board moved
into `packages/rafa-board/` (#808, pass 4c). Each sits at its path under `src/` before the move:
`src/commands/issue/ready.test.ts` is `commands/issue/ready.test.ts` here, and its code is under test at
`packages/rafa-board/src/commands/issue/ready.ts`.

A file's text was not rewritten beyond its specifiers. An import of a board file reads that file's subpath,
`@open-tomato/rafa-board/<subpath>`, an import of a core file keeps its `@open-tomato/rafa/<subpath>` text, and an
import of a root file reads the relative path from here. A path built from `import.meta` was pointed by hand at the
file or folder it named before the move: `commands/plan/refs-check.test.ts` reads the repository's root five
folders up.

An import of an effort file reads that file's subpath, `@open-tomato/rafa-effort/<subpath>`, and is listed below
as the tool printed it, since effort is a package of its own and not board's.

The test-index guard (`scripts/survey/test-index.ts --against`) reads these files as any test: under its own path,
in the unit the cut table lists it in, and held to the rule of its kind. A later spec sorts each file: back into the
package once its coupling is gone, or into the module it really tests.

## What each file reaches outside core and board

| Test file | Reaches |
| --- | --- |
| `adapters/tracker/github.test.ts` | `src/tests/scratch-home-env.ts` |
| `adapters/tracker/resolve.test.ts` | `src/adapter-registry.ts` |
| `board/owner-resolve.test.ts` | `src/pr/gh-fake-shapes.ts` |
| `board/project/add-filed.test.ts` | `src/triage/triage.ts` |
| `board/refs-gate.test.ts` | `src/config-registry.ts` |
| `board/roadmap-claims-remote.test.ts` | `src/pr/index.ts` |
| `board/roadmap.test.ts` | `src/pr/gh-fake.ts` |
| `board/setup-config.test.ts` | `src/project/scaffold.ts` |
| `board/setup.test.ts` | `src/project/scaffold.ts` |
| `board/status.test.ts` | `src/project/scaffold.ts` |
| `board/trust.test.ts` | `src/pr/gh-fake.ts` |
| `commands/board/list.test.ts` | `src/tests/cli-capture.ts` |
| `commands/board/sync.test.ts` | `src/tests/cli-capture.ts` |
| `commands/doctor-refs-roadmap.test.ts` | `src/commands/index.ts` |
| `commands/doctor-refs.test.ts` | `src/commands/index.ts` |
| `commands/epic/cancel-native.test.ts` | `src/tests/cli-capture.ts` |
| `commands/epic/cancel.test.ts` | `src/tests/cli-capture.ts` |
| `commands/epic/close-docs.test.ts` | `src/docs/release-issue.ts` |
| `commands/epic/close-native.test.ts` | `src/tests/cli-capture.ts` |
| `commands/epic/close.test.ts` | `packages/rafa-effort/src/effort/epic-cost.ts`, `src/docs/release-issue.ts`, `src/tests/cli-capture.ts`, `src/triage/triage.ts` |
| `commands/epic/epic-project.test.ts` | `src/tests/cli-capture.ts` |
| `commands/epic/horizon-change.test.ts` | `src/tests/cli-capture.ts` |
| `commands/epic/move-native.test.ts` | `src/tests/cli-capture.ts` |
| `commands/epic/move.test.ts` | `src/tests/cli-capture.ts` |
| `commands/epic/new-native.test.ts` | `src/tests/cli-capture.ts` |
| `commands/epic/new.test.ts` | `src/tests/cli-capture.ts` |
| `commands/epic/show-native.test.ts` | `src/tests/cli-capture.ts` |
| `commands/epic/show.test.ts` | `src/tests/cli-capture.ts` |
| `commands/issue/check.test.ts` | `src/tests/cli-capture.ts` |
| `commands/issue/comment.test.ts` | `src/tests/cli-capture.ts` |
| `commands/issue/create-bug.test.ts` | `src/tests/cli-capture.ts` |
| `commands/issue/create.test.ts` | `src/tests/cli-capture.ts` |
| `commands/issue/edit-run.test.ts` | `packages/rafa-effort/src/effort/file-stamp.ts`, `src/tests/cli-capture.ts` |
| `commands/issue/edit.test.ts` | `src/tests/cli-capture.ts` |
| `commands/issue/issue-tracker.test.ts` | `src/tests/cli-capture.ts` |
| `commands/issue/list.test.ts` | `src/commands/roadmap.ts`, `src/tests/cli-capture.ts` |
| `commands/issue/move-refresh.test.ts` | `src/tests/cli-capture.ts` |
| `commands/issue/move.test.ts` | `src/tests/cli-capture.ts` |
| `commands/issue/ready-native.test.ts` | `src/tests/cli-capture.ts` |
| `commands/issue/ready-refresh.test.ts` | `src/tests/cli-capture.ts` |
| `commands/issue/ready.test.ts` | `src/commands/index.ts`, `src/tests/cli-capture.ts`, `src/tests/ending-probe.ts` |
| `commands/issue/show.test.ts` | `src/tests/cli-capture.ts` |
| `commands/issue/unblock-native.test.ts` | `src/project/scaffold.ts`, `src/tests/cli-capture.ts` |
| `commands/issue/unblock.test.ts` | `src/tests/cli-capture.ts` |
| `commands/plan/refs-check.test.ts` | `src/commands/index.ts` |
| `refs/reading.test.ts` | `src/commands/index.ts` |
| `refs/verify.test.ts` | `src/commands/index.ts`, `src/config-registry.ts` |
