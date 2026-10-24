# Inventory's parked tests

Inventory's unit tests that import a file outside core and inventory wait here, outside inventory's package, since
inventory moved into `packages/rafa-inventory/` (#808, pass 4a). Each sits at its path under `src/` before the move:
`src/tiers/routing.test.ts` is `tiers/routing.test.ts` here, and its code is under test at
`packages/rafa-inventory/src/tiers/routing.ts`.

A file's text was not rewritten beyond its specifiers. An import of an inventory file reads that file's subpath,
`@open-tomato/rafa-inventory/<subpath>`, an import of a core file keeps its `@open-tomato/rafa/<subpath>` text, and
an import of a root file reads the relative path from here. A path built from `import.meta` was pointed by hand at
the file or folder it named before the move.

The test-index guard (`scripts/survey/test-index.ts --against`) reads these files as any test: under its own path,
in the unit the cut table lists it in, and held to the rule of its kind. A later spec sorts each file: back into the
package once its coupling is gone, or into the module it really tests.

## What each file reaches outside core and inventory

| Test file | Reaches |
| --- | --- |
| `adapters/learning/local.test.ts` | `src/config-registry.ts` |
| `agents/roster.test.ts` | `src/commands/agent/vendor.ts`, `src/config-registry.ts` |
| `agents/vendorable.test.ts` | `src/config-registry.ts` |
| `inventory/search/prompt.test.ts` | `packages/rafa-effort/src/effort/classify.ts` |
| `plan/risk/long-runs.test.ts` | `src/plan/risk.ts` |
| `tiers/resolve.test.ts` | `src/commands/agent/vendor.ts`, `src/config-registry.ts` |
| `tiers/routing.test.ts` | `src/config-registry.ts` |
