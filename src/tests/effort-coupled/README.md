# Effort's parked tests

Effort's unit tests that import a file outside core and effort wait here, outside effort's package, since effort
moved into `packages/rafa-effort/` (#808, pass 4b). Each sits at its path under `src/` before the move:
`src/effort/sync/file.test.ts` is `effort/sync/file.test.ts` here, and its code is under test at
`packages/rafa-effort/src/effort/sync/file.ts`.

A file's text was not rewritten beyond its specifiers. An import of an effort file reads that file's subpath,
`@open-tomato/rafa-effort/<subpath>`, an import of a core file keeps its `@open-tomato/rafa/<subpath>` text, and
an import of a root file reads the relative path from here. A path built from `import.meta` was pointed by hand at
the file or folder it named before the move.

`effort/classify.test.ts` imports nothing outside effort: the move tool took it into the package with
`classify.ts`, and it was parked by hand, since its drift guard reads the sources of `PROMPT_SHAPES` by path at run
time, the shape pass 1's integration test had (#1288).

The test-index guard (`scripts/survey/test-index.ts --against`) reads these files as any test: under its own path,
in the unit the cut table lists it in, and held to the rule of its kind. A later spec sorts each file: back into the
package once its coupling is gone, or into the module it really tests.

## What each file reaches outside core and effort

| Test file | Reaches |
| --- | --- |
| `effort/classify.test.ts` | by path at run time, no import: `packages/rafa-run/src/start/dispatch.ts`, `src/plan-prompt.md`, `packages/rafa-run/src/start/wrap-up.ts`, `packages/rafa-run/src/start/pr-lifecycle.ts`, `packages/rafa-inventory/src/inventory/search/prompt.ts` |
| `effort/collect.test.ts` | `src/tests/cli-capture.ts` |
| `effort/dashboard-status.test.ts` | `src/tests/loop-session-fixtures.ts` |
| `effort/report-skills.test.ts` | `packages/rafa-inventory/src/inventory/record.ts`, `packages/rafa-inventory/src/schema/instinct.ts`, `packages/rafa-inventory/src/tiers/resolve.ts` |
| `effort/report-trend-read.test.ts` | `src/tests/cli-capture.ts` |
| `effort/report.test.ts` | `packages/rafa-inventory/src/schema/instinct.ts`, `src/tests/cli-capture.ts` |
| `effort/skill-facts.test.ts` | `src/tests/merged-stores.ts` |
| `effort/sync/contact.test.ts` | `src/config-registry.ts` |
| `effort/sync/doctor-reading.test.ts` | `src/config-registry.ts` |
| `effort/sync/file-round-trip.test.ts` | `src/tests/merged-stores.ts` |
| `effort/sync/file.test.ts` | `src/tests/merged-stores.ts` |
| `effort/sync/select.test.ts` | `src/config-registry.ts` |
