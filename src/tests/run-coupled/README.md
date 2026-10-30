# Run's parked tests

Run's unit tests that import a file outside core, run and the packages run declares wait here, outside run's package,
since run moved into `packages/rafa-run/` (#808, pass 4f). Each sits at its path under `src/` before the move:
`src/start/preflight.test.ts` is `start/preflight.test.ts` here, and its code is under test at
`packages/rafa-run/src/start/preflight.ts`.

A file's text was not rewritten beyond its specifiers. An import of a run file reads that file's subpath,
`@open-tomato/rafa-run/<subpath>`, an import of a core file keeps its `@open-tomato/rafa/<subpath>` text, and an
import of a root file reads the relative path from here. A path built from `import.meta` was pointed by hand at the
file or folder it named before the move: `start/preflight.test.ts` and `start/preflight-sync.test.ts` read core's
`packages/rafa/src/modules/testdata/sync-fixture`, `start/runtime.test.ts` spawns the root's `src/rafa.ts`, and
`start/wrap-up-run.test.ts` reads `packages/rafa-run/src/start/wrap-up-run.ts` and has its driver import that module
and the root's `src/adapter-registry.ts`.

An import of a board, effort, inventory, pr or release file reads that file's subpath
(`@open-tomato/rafa-board/<subpath>`, `@open-tomato/rafa-effort/<subpath>`, `@open-tomato/rafa-inventory/<subpath>`,
`@open-tomato/rafa-pr/<subpath>`, `@open-tomato/rafa-release/<subpath>`). Run declares the five in its
`dependencies`, so the tool counts a file of theirs as inside: a test that reaches only their files outside core and
run moved with its source into the package instead of parking here.

The test-index guard (`scripts/survey/test-index.ts --against`) reads these files as any test: under its own path,
in the unit the cut table lists it in, and held to the rule of its kind. A later spec sorts each file: back into the
package once its coupling is gone, or into the module it really tests.

## What each file reaches outside core, run and its declared packages

| Test file | Reaches |
| --- | --- |
| `claims/device.test.ts` | `src/tests/merged-stores.ts` |
| `cleanup/index.test.ts` | `src/cleanup/scratch-repository.ts` |
| `commands/claim/accept.test.ts` | `src/tests/cli-capture.ts` |
| `commands/claim/hand.test.ts` | `src/tests/cli-capture.ts` |
| `commands/claim/release-after-merge.test.ts` | `src/commands/effort/merge.ts`, `src/tests/cli-capture.ts` |
| `commands/claim/release.test.ts` | `src/tests/cli-capture.ts` |
| `commands/claim/take.test.ts` | `src/project/scaffold.ts`, `src/tests/cli-capture.ts` |
| `commands/switch-native.test.ts` | `src/tests/cli-capture.ts` |
| `commands/switch.test.ts` | `src/tests/cli-capture.ts` |
| `next/actions.test.ts` | `src/commands/loop/start.ts`, `src/commands/plan/create.ts` |
| `next/ending.test.ts` | `src/commands/index.ts`, `src/commands/loop/start.ts`, `src/commands/plan/create.ts` |
| `next/relations-mode.test.ts` | `src/commands/next.ts`, `src/next/lines.ts`, `src/tests/cli-capture.ts` |
| `next/settle-step.test.ts` | `src/next/ceiling.ts`, `src/next/lines.ts` |
| `start/continue-exits.test.ts` | `src/loop/wait-reasons.ts` |
| `start/convention-body.test.ts` | `src/tests/release-stage-fixtures.ts` |
| `start/loop-events.test.ts` | `src/adapters/output/json.ts` |
| `start/preflight-sync.test.ts` | `src/config-registry.ts` |
| `start/preflight.test.ts` | `src/config-registry.ts` |
| `start/release-body.test.ts` | `src/tests/release-stage-fixtures.ts` |
| `start/release-stage-forecast.test.ts` | `src/tests/release-stage-fixtures.ts` |
| `start/release-stage.test.ts` | `src/tests/release-stage-fixtures.ts` |
| `start/run-checkout.test.ts` | `src/config-registry.ts` |
| `start/run-config.test.ts` | `src/tests/cli-capture.ts` |
| `start/runtime.test.ts` | `src/tests/cli-capture.ts` |
| `start/stale-docs.test.ts` | `src/commands/docs/plan.ts` |
| `start/triage-inherited.test.ts` | `src/config-registry.ts` |
| `start/triage-kind-routes.test.ts` | `src/config-registry.ts` |
| `start/triage.test.ts` | `src/adapters/output/json.ts` |
| `start/type-step.test.ts` | `src/tests/real-node-modules.ts` |
| `start/worktree.test.ts` | `src/config-registry.ts` |
| `start/wrap-up-run.test.ts` | `src/tests/cli-capture.ts`, `src/tests/release-stage-fixtures.ts` |
| `start/wrap-up.test.ts` | `src/tests/loop-scratch.ts` |
| `suite/checks.test.ts` | `src/config/templates.ts` |
