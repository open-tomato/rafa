/**
 * The barrel over the adapter registry: every name `registry.ts`
 * exports, and nothing else.
 *
 * A file outside `src/core/` imports this file and never the one behind
 * it (`scripts/survey/core-barrels.ts` measures that, and
 * `src/tests/core-barrels.sweep.test.ts` holds it against the tree). A
 * file inside `src/core/` imports `registry.ts` directly and never this
 * file. None does today.
 *
 * ## What sits behind it
 *
 * `registry.ts` alone: the registry keyed by port type and kind, the
 * version core serves of each port, and the registry holding core's own
 * adapters. The adapters themselves stay under `src/adapters/`, the two
 * store backends under `src/effort/store/` and the two sync strategies
 * under `src/effort/sync/`; `registry.ts` imports each by value, which
 * is why it has a barrel of its own and shares none with another
 * subject.
 *
 * ## The cycle this barrel is in
 *
 * A barrel that groups a file with a file outside `src/core/` that
 * imports the barrel back by value is a runtime cycle, and this barrel
 * is in one. `registry.ts` imports `createLocalSync` from
 * `src/effort/sync/select.ts`, and that file imports
 * `CORE_ADAPTER_REGISTRY` back, through this file since the move. The
 * cycle is older than the barrel: before the move the two files imported
 * each other directly (`select.ts` says why under "The import cycle").
 * The move changed paths and no logic, so it could not take the cycle
 * out, and a barrel over one file cannot be split to step round it.
 *
 * Measured when the file moved: the value imports of the non-test files
 * under `src/` and `packages/` held six cycles before the move and six
 * after it. The one through `registry.ts` held two files before,
 * `registry.ts` and `select.ts`, and three after, with this file
 * between them. `docs/survey/cluster-map.json` places `registry.ts` and
 * `select.ts` in one cluster, and this file by its folder in the same
 * one, so `src/tests/import-cycle.sweep.test.ts` reads the cycle as
 * inside a cluster.
 *
 * The cycle loads in every order because neither side reads the other's
 * binding while it evaluates: `registry.ts` calls `createLocalSync`
 * inside an adapter's `create`, and `select.ts` reads
 * `CORE_ADAPTER_REGISTRY` inside `selectSync`. Each of the three files
 * was imported first in a fresh `bun` process and `sync/local` resolved
 * in all three. The control, the same tree with `select.ts` reading
 * `CORE_ADAPTER_REGISTRY.kinds('sync')` at its top level, failed with a
 * `ReferenceError` when this file or `registry.ts` was imported first
 * and loaded when `select.ts` was. `index.test.ts` holds the three
 * orders.
 *
 * ## What it exports
 *
 * Each name is spelled, types apart from values, as the other core
 * barrels spell theirs. Eight of the nine names are part of the
 * published surface: `src/index.ts` re-exports them from this file. The
 * ninth, `PlanPromptBuilder`, is read by the `claude` planner, which
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

export { CORE_ADAPTER_REGISTRY, createAdapterRegistry, PORT_VERSIONS } from './registry.js';
