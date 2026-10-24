/**
 * The barrel over the adapter registry: every name `registry.ts`
 * exports, and nothing else.
 *
 * A file outside `packages/rafa/src/core/` imports this file and never the one behind
 * it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `packages/rafa/src/core/` imports `registry.ts` directly and never this
 * file. None does today.
 *
 * ## What sits behind it
 *
 * `registry.ts` alone: the registry keyed by port type and kind, the
 * version core serves of each port, the slot the active registry is
 * kept in with the three functions that register, restore and read it,
 * and `CORE_ADAPTER_REGISTRY`, the frozen facade every caller resolves
 * through. `registry.ts` imports no adapter, so this barrel loads none.
 * Core's adapters stay under `src/adapters/`, the two store backends
 * under `packages/rafa/src/effort/store/` and the two sync strategies under
 * `src/effort/sync/`, and the composition root `src/adapter-registry.ts`
 * imports each by value and registers them through this barrel when its
 * `registerCoreAdapters` is called; importing the root registers
 * nothing. `src/rafa.ts` and `src/index.ts` call it, and `bun test`
 * calls it from `src/tests/preload.ts`; a process that loads none of
 * them calls the root itself, or every member of
 * `CORE_ADAPTER_REGISTRY` refuses, naming it.
 *
 * ## No cycle runs through it
 *
 * Before the root, `registry.ts` imported `createLocalSync` from
 * `packages/rafa-effort/src/effort/sync/select.ts`, and that file imported
 * `CORE_ADAPTER_REGISTRY` back through this barrel: a runtime cycle of
 * three files, inside one cluster of `docs/survey/cluster-map.json`. The
 * root imports `select.ts` now and `registry.ts` imports nothing above
 * core, so the cycle is gone. `index.test.ts` imports each of this file,
 * `registry.ts` and `select.ts` first in a fresh `bun`, the root after
 * it with `registerCoreAdapters` called, and resolves `sync/local` in
 * each order.
 *
 * ## What it exports
 *
 * Each name is spelled, types apart from values, as the other core
 * barrels spell theirs. Eleven of the twelve names are part of the
 * published surface: `src/index.ts` re-exports them from this file. The
 * twelfth, `PlanPromptBuilder`, is read by the `claude` planner, which
 * re-exports it under the same name.
 *
 * `index.test.ts` holds the list to the file: every name `registry.ts`
 * exports is here once, as the same binding, and no other name is here.
 */
export type {
  Adapter,
  AdapterContext,
  AdapterRegistry,
  AnyAdapter,
  PlanPromptBuilder,
  PortImplementations,
} from './registry.js';

export {
  activeAdapterRegistry,
  CORE_ADAPTER_REGISTRY,
  createAdapterRegistry,
  PORT_VERSIONS,
  registerAdapters,
  restoreAdapters,
} from './registry.js';
