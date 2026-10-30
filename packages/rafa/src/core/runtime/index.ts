/**
 * The barrel over the runtime identity: every name `identity.ts`
 * exports, and nothing else.
 *
 * A file outside `packages/rafa/src/core/` imports this file and never the one behind
 * it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `packages/rafa/src/core/` imports `identity.ts` directly and never this
 * file. The effort store under `packages/rafa/src/effort/store/` is core by
 * assignment and not by folder, so it is outside `packages/rafa/src/core/` for the
 * rule and imports this file.
 *
 * ## What sits behind it
 *
 * `identity.ts` alone: {@link readRuntimeIdentity}, which reads whether
 * the running build is an installed runtime or a development build run
 * from a checkout, and the three types it answers with. It moved here
 * from `src/runtime/identity.ts` (#1088), so the effort store, which
 * asks it before it migrates a live store, imports nothing above core
 * for it. Beside it sit two values: `RAFA_PACKAGE_NAME`, rafa's
 * published name, which the walk compares each manifest against, and
 * `RUNTIME_SUBDIR`, where installed versions sit under the home. Both
 * moved into core in the seventh decouple item, so pr's merge reads
 * them without importing run.
 *
 * ## Why one barrel can hold it
 *
 * A barrel that groups a file with a file outside `packages/rafa/src/core/` that
 * imports the barrel back by value is a runtime cycle. `identity.ts`
 * imports only `node:fs` and `node:path`, no file under `src/`, and
 * spells rafa's package name as a literal, so no file behind this barrel
 * reaches a file that imports it back.
 *
 * ## The old path
 *
 * `src/runtime/identity.ts` re-exported this file's names under the same
 * names until core moved into its package (#1090), which deleted it and
 * pointed its importers at `@open-tomato/rafa/core/runtime`.
 *
 * ## What it exports
 *
 * Each name is spelled, types apart from values, as the other core
 * barrels spell theirs. No name here is part of the published surface:
 * `src/index.ts` re-exports nothing from this file. The values are
 * {@link readRuntimeIdentity}, `RAFA_PACKAGE_NAME` and `RUNTIME_SUBDIR`;
 * the types are the three identities.
 *
 * `index.test.ts` holds the list to the file: every name `identity.ts`
 * exports is here once, as the same binding, and no other name is here.
 */
export type { DevelopmentIdentity, InstalledIdentity, RuntimeIdentity } from './identity.js';

export { readRuntimeIdentity, RAFA_PACKAGE_NAME, RUNTIME_SUBDIR } from './identity.js';
