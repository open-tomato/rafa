# Release's parked tests

Release's unit tests that import a file outside core and release wait here, outside release's package, since
release moved into `packages/rafa-release/` (#808, pass 4d). Each sits at its path under `src/` before the move:
`src/commands/release/settle.test.ts` is `commands/release/settle.test.ts` here, and its code is under test at
`packages/rafa-release/src/commands/release/settle.ts`.

A file's text was not rewritten beyond its specifiers. An import of a release file reads that file's subpath,
`@open-tomato/rafa-release/<subpath>`, an import of a core file keeps its `@open-tomato/rafa/<subpath>` text, and
an import of a root file reads the relative path from here. A path built from `import.meta` was pointed by hand at
the file or folder it named before the move: `release/changelog.test.ts` reads the repository's `CHANGELOG.md`
four folders up, and `release/templates-shape.test.ts` reads the workflow templates in
`packages/rafa-release/src/release/templates/`.

An import of a board file reads that file's subpath, `@open-tomato/rafa-board/<subpath>`, and is listed below as
the tool printed it, since board is a package of its own and not release's. `next/epic-end.test.ts` imports no
board file by path: it takes two types from the board facade by name, `@open-tomato/rafa-board`, which the move
tool reads as `packages/rafa-board/index.ts`, a file outside core, the package and the move, so the test parked
for that import alone.

The test-index guard (`scripts/survey/test-index.ts --against`) reads these files as any test: under its own path,
in the unit the cut table lists it in, and held to the rule of its kind. A later spec sorts each file: back into the
package once its coupling is gone, or into the module it really tests.

## What each file reaches outside core and release

| Test file | Reaches |
| --- | --- |
| `commands/doctor-ladder.command.test.ts` | `packages/rafa-inventory/src/tiers/delivery.ts`, `src/commands/doctor.ts`, `src/tests/cli-capture.ts` |
| `commands/release/fragment.test.ts` | `src/tests/cli-capture.ts` |
| `commands/release/list.test.ts` | `src/tests/cli-capture.ts` |
| `commands/release/publish-repo.test.ts` | `src/tests/cli-capture.ts` |
| `commands/release/publish.test.ts` | `src/tests/cli-capture.ts` |
| `commands/release/settle-lock.test.ts` | `src/project/scaffold.ts`, `src/tests/cli-capture.ts` |
| `commands/release/settle-project.test.ts` | `packages/rafa-board/src/adapters/tracker/github.ts`, `packages/rafa-board/src/board/project/project-runner.ts`, `packages/rafa-board/src/board/project/refresh.ts`, `packages/rafa-board/src/board/project/retry-fake.ts` |
| `commands/release/settle-workspace.test.ts` | `src/tests/cli-capture.ts`, `src/tests/workspace-world.ts` |
| `commands/release/settle.test.ts` | `packages/rafa-board/src/adapters/tracker/github.ts`, `src/project/scaffold.ts`, `src/tests/cli-capture.ts` |
| `commands/release/status-fragments.test.ts` | `src/tests/cli-capture.ts` |
| `commands/release/status-stale-docs.test.ts` | `packages/rafa-board/src/adapters/tracker/local.ts`, `src/tests/cli-capture.ts` |
| `commands/release/status.test.ts` | `src/tests/cli-capture.ts` |
| `commands/release/tag-workspace.test.ts` | `src/tests/cli-capture.ts`, `src/tests/workspace-world.ts` |
| `commands/release/tag.test.ts` | `src/tests/cli-capture.ts` |
| `commands/release/workflows.levels.test.ts` | `src/tests/cli-capture.ts` |
| `commands/release/workflows.test.ts` | `src/tests/cli-capture.ts` |
| `docs/release-issue.test.ts` | `packages/rafa-board/src/adapters/tracker/local.ts` |
| `next/epic-end.test.ts` | `packages/rafa-board/index.ts` |
| `release/changelog.test.ts` | `src/config-registry.ts` |
| `release/scaffold.test.ts` | `src/config-registry.ts` |
| `release/setting.test.ts` | `src/project/scaffold.ts` |
| `release/templates-shape.test.ts` | `src/commands/index.ts` |
