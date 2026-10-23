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
| `adapters/logger/active.test.ts` | `src/tests/logger-harness.ts` |
| `adapters/logger/console.test.ts` | `src/tests/logger-harness.ts` |
| `adapters/logger/contract.test.ts` | `src/tests/logger-harness.ts` |
| `bugs/record-composition.test.ts` | `src/bugs/cause-rule.ts`, `src/bugs/filed-values.ts` |
| `bugs/record.test.ts` | `src/triage/issue-text.ts`, `src/triage/similarity.ts` |
| `bugs/stack-path.test.ts` | `src/tests/package-tree.ts` |
| `commands/plan/plan-files.test.ts` | `src/config-registry.ts`, `src/tests/cli-capture.ts` |
| `config-schema-board-project.test.ts` | `src/config-registry.ts` |
| `config-schema-bugs.test.ts` | `src/config-registry.ts` |
| `config-schema-checks.test.ts` | `src/config-registry.ts` |
| `config-schema-errors.test.ts` | `src/config-registry.ts` |
| `config-schema-features-integration.test.ts` | `src/config-registry.ts` |
| `config-schema-hub.test.ts` | `src/config-registry.ts` |
| `config-schema-issues.test.ts` | `src/config-registry.ts`, `src/project/scaffold.ts` |
| `config-schema-logger.test.ts` | `src/config-registry.ts`, `src/project/scaffold.ts`, `src/tests/cli-capture.ts` |
| `config-schema-loop-continue.test.ts` | `src/config-registry.ts` |
| `config-schema-loop-retries.test.ts` | `src/config-registry.ts` |
| `config-schema-release.test.ts` | `src/config-registry.ts` |
| `config-schema-tests.test.ts` | `src/config-registry.ts`, `src/config/templates.ts` |
| `config-schema-triage.test.ts` | `src/config-registry.ts` |
| `config-schema-wrap-up.test.ts` | `src/config-registry.ts` |
| `core/command/version.test.ts` | `package.json`, the root manifest |
| `core/config/config-load-templates.test.ts` | `src/config-registry.ts` |
| `core/config/config-load.test.ts` | `src/config-registry.ts`, `src/tests/output-sinks.ts` |
| `core/config/config-schema-board.test.ts` | `src/config-registry.ts` |
| `core/config/config.test.ts` | `src/config-registry.ts` |
| `core/config/dangerous.test.ts` | `src/config-registry.ts`, `src/tests/output-sinks.ts` |
| `core/config/section.test.ts` | `src/config-registry.ts` |
| `core/loop/claude.test.ts` | `src/tests/output-sinks.ts` |
| `core/output/active.test.ts` | `src/adapters/output/json.ts` |
| `core/output/index.test.ts` | `src/adapters/output/json.ts` |
| `core/runtime/identity.test.ts` | `package.json`, the root manifest |
| `effort/store/changes.test.ts` | `src/tests/merged-stores.ts` |
| `effort/store/fixture-extract.test.ts` | `src/fixtures/scrub.ts` |
| `effort/store/forward-compat.test.ts` | `src/effort/skill-facts.ts` |
| `effort/store/index.test.ts` | `src/adapter-registry.ts` |
| `effort/store/location.test.ts` | `src/tests/cli-capture.ts` |
| `effort/store/merge-commit-gaps.test.ts` | `src/effort/commits.ts` |
| `effort/store/merge-rules.sweep.test.ts` | `src/tests/sweep-timeout.ts` |
| `effort/store/migrations.test.ts` | `src/tests/git-identity.ts` |
| `effort/store/move.test.ts` | `src/project/scaffold.ts`, `src/tests/cli-capture.ts` |
| `effort/store/origins.test.ts` | `src/effort/skill-facts.ts` |
| `effort/store/preflight.test.ts` | `src/preflight/run.ts` |
| `effort/store/search-row.test.ts` | `src/effort/collect.ts`, `src/effort/report.ts` |
| `effort/store/settings.test.ts` | `src/config-registry.ts` |
| `effort/store/stale-docs.test.ts` | `src/tests/merged-stores.ts` |
| `effort/store/store-sources.sweep.test.ts` | `src/tests/sweep-timeout.ts` |
| `errors/rafa-codes.test.ts` | `src/cli/dispatch.ts`, `src/cli/route.ts`, `src/errors/match.ts`, `packages/rafa-inventory/src/schema/failure-strings.ts`, `packages/rafa-inventory/src/schema/skill.ts` |
| `modules/load.test.ts` | `src/config-registry.ts` |
| `next/hop-record.integration.test.ts` | `src/project/gitignore.ts`, `src/tests/cli-capture.ts`, `src/tests/git-identity.ts` |
| `plan/doc-task.test.ts` | `src/plan/index.ts`, `src/plan/validate.ts` |
| `ports/index.test.ts` | `src/plan/index.ts` |
| `project/package-of.test.ts` | `src/tests/package-tree.ts` |
| `project/position.integration.test.ts` | `src/project/gitignore.ts`, `src/tests/cli-capture.ts`, `src/tests/git-identity.ts` |
| `project/scope-fallback.test.ts` | `src/tests/git-identity.ts` |
| `project/scope.test.ts` | `src/config-registry.ts` |
| `project/worktree-root.test.ts` | `src/tests/git-identity.ts` |
| `report/parse.test.ts` | `packages/rafa-inventory/src/schema/instinct.ts` |
| `schema/project-id.test.ts` | `src/tests/git-identity.ts` |
| `start/worktree-dir.test.ts` | `src/config-registry.ts` |
| `utils/git.test.ts` | `src/tests/git-identity.ts` |
| `utils/progress.test.ts` | `scripts/control-byte-gate/control-byte-gate.ts`, `src/plan.ts` |
| `utils/tracker.test.ts` | `src/effort/classify.ts`, `src/plan/index.ts`, `src/start/commit.ts`, `src/start/dispatch.ts`, `src/start/stamp.ts`, `src/tests/output-sinks.ts` |
