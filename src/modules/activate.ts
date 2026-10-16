/**
 * Makes the adapters the loaded modules registered the ones an
 * invocation resolves, so a module's kind is found through
 * `CORE_ADAPTER_REGISTRY` like any of core's.
 *
 * `loadModules` (`load.ts`) registers each loaded module's adapters on a
 * registry value and answers it as `LoadedModules.adapters`, leaving the
 * active registry as it was. {@link activateModuleAdapters} hands that
 * value to core's `restoreAdapters`, which makes it the active registry,
 * and `CORE_ADAPTER_REGISTRY`, a facade reading the active registry at
 * call time, answers its adapters from then on. `src/rafa.ts` calls it
 * once, after `loadInvocationModules` and before it dispatches.
 *
 * ## The base registry
 *
 * Activation keeps the registry it replaced, the one holding core's
 * adapters and no module's, as {@link baseAdapterRegistry}. A command
 * that loads the modules again from the config, `rafa module list` among
 * them, starts from that base when it hands `loadModules` no registry:
 * started from the active registry, every module would meet its own
 * kinds already held and be refused. Before anything is activated the
 * base is `CORE_ADAPTER_REGISTRY` itself, so a reader in a process that
 * never activates reads what it read before this module.
 *
 * A second activation keeps the base the first one kept: its modules
 * were loaded from that base, so its registry holds the base's adapters
 * and the modules', never the first activation's twice.
 *
 * ## Nothing to activate
 *
 * A load with no loaded adapter answers `CORE_ADAPTER_REGISTRY` itself
 * as `LoadedModules.adapters`, which core refuses to make the active
 * registry (the facade would read itself). That answer is left alone:
 * the active registry already holds everything it does.
 *
 * ## Undoing it
 *
 * The call answers a function that puts back the active registry and the
 * base as they were before it. `src/rafa.ts` never calls it, since the
 * process ends with the invocation; a test calls it in a `finally`, or
 * every file bun runs after it reads the module's adapters.
 */
import type { AdapterRegistry } from '@open-tomato/rafa/core/adapters';

import {
  activeAdapterRegistry,
  CORE_ADAPTER_REGISTRY,
  restoreAdapters,
} from '@open-tomato/rafa/core/adapters';

/** What activation reads of a load: the `adapters` of `LoadedModules`. */
export interface ModuleAdapters {
  /** The base registry with every loaded module's adapters registered. */
  readonly adapters: AdapterRegistry;
}

/** The registry the first activation replaced, or null while none has run. */
let base: AdapterRegistry | null = null;

/**
 * The registry holding core's adapters and no module's: the one the
 * first {@link activateModuleAdapters} replaced, or
 * `CORE_ADAPTER_REGISTRY` while no activation has run.
 */
export function baseAdapterRegistry(): AdapterRegistry {
  return base ?? CORE_ADAPTER_REGISTRY;
}

/**
 * Makes `loaded.adapters` the active registry, unless it is
 * `CORE_ADAPTER_REGISTRY` itself, keeping the registry it replaced as
 * {@link baseAdapterRegistry} when no earlier activation kept one.
 * Answers a function putting the active registry and the base back as
 * they were before the call; see the module note.
 */
export function activateModuleAdapters(loaded: ModuleAdapters): () => void {
  if (loaded.adapters === CORE_ADAPTER_REGISTRY) return () => {};
  const previousBase = base;
  const previous = activeAdapterRegistry();
  restoreAdapters(loaded.adapters);
  base = previousBase ?? previous;
  return () => {
    restoreAdapters(previous);
    base = previousBase;
  };
}
