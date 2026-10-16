# Core's parked tests

Core's unit tests that import a file above core wait here, outside core's package, since core moved into
`packages/rafa/` (#1090). Each sits at its path under `src/` before the move: `src/core/config/config.test.ts` is
`core/config/config.test.ts` here, and its code is under test at `packages/rafa/src/core/config/config.ts`.

A file's text was not rewritten beyond its specifiers. An import of a core file reads that file's subpath,
`@open-tomato/rafa/<subpath>`, barrel or not, and an import of a root file reads the relative path from here. A
path built from `import.meta` was pointed by hand at the file or folder it named before the move.

The barrels sweep (`scripts/survey/core-barrels.ts`) treats this folder as core's own, through `CORE_PARKED_TESTS`
and `isCoreRead` of `scripts/survey/core-moves.ts`: it reads these files as core's and does not hold their imports
to the barrel rule. The test-index guard (`scripts/survey/test-index.ts --against`) reads them as any test: under
its own path, in the unit the cut table lists it in, and held to the rule of its kind. A later spec sorts each
file: back into the package once its coupling is gone, or into the module it really tests.

## What each file reaches above core

| Test file | Reaches |
| --- | --- |
| `core/command/version.test.ts` | `package.json`, the root manifest |
| `core/config/config-load.test.ts` | `src/adapters/logger/settings.ts`, `src/config-registry.ts`, `src/tests/output-sinks.ts` |
| `core/config/config-schema-board.test.ts` | `src/config-registry.ts` |
| `core/config/config.test.ts` | `src/config-registry.ts` |
| `core/config/dangerous.test.ts` | `src/config-registry.ts`, `src/tests/output-sinks.ts` |
| `core/config/section.test.ts` | `src/config-registry.ts` |
| `core/loop/claude.test.ts` | `src/tests/output-sinks.ts` |
| `core/loop/sessions-hop.test.ts` | `src/next/hop-record.ts` |
| `core/output/active.test.ts` | `src/adapters/output/json.ts` |
| `core/output/index.test.ts` | `src/adapters/output/json.ts` |
| `core/plan/parse.test.ts` | `src/utils/tracker.ts` |
| `core/runtime/identity.test.ts` | `package.json`, the root manifest |
| `effort/store/changes.test.ts` | `src/tests/merged-stores.ts` |
| `effort/store/fixture-extract.test.ts` | `src/fixtures/scrub.ts`, `src/triage/local-paths.ts` |
| `effort/store/forward-compat.test.ts` | `src/effort/skill-facts.ts`, `src/utils/progress.ts` |
| `effort/store/index.test.ts` | `src/adapter-registry.ts` |
| `effort/store/location.test.ts` | `src/tests/cli-capture.ts` |
| `effort/store/merge-commit-gaps.test.ts` | `src/effort/commits.ts` |
| `effort/store/merge-rules.sweep.test.ts` | `src/tests/sweep-timeout.ts` |
| `effort/store/migrations.test.ts` | `src/tests/git-identity.ts` |
| `effort/store/move.test.ts` | `src/project/scaffold.ts`, `src/tests/cli-capture.ts` |
| `effort/store/origins.test.ts` | `src/effort/skill-facts.ts`, `src/utils/progress.ts` |
| `effort/store/preflight.test.ts` | `src/preflight/run.ts` |
| `effort/store/search-row.test.ts` | `src/effort/collect.ts`, `src/effort/report.ts` |
| `effort/store/settings.test.ts` | `src/config-registry.ts` |
| `effort/store/stale-docs.test.ts` | `src/tests/merged-stores.ts` |
| `effort/store/store-sources.sweep.test.ts` | `src/tests/sweep-timeout.ts` |
| `effort/store/tracker-refs.test.ts` | `src/utils/progress.ts` |
| `ports/index.test.ts` | `src/plan/index.ts` |
| `report/parse.test.ts` | `src/schema/instinct.ts` |
| `schema/project-id.test.ts` | `src/tests/git-identity.ts` |
