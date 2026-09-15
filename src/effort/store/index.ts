/**
 * The effort store's entry: the port, both backends, and the one
 * decision between them.
 *
 * The spec's `exports` map points the package's `./store` subpath at
 * `./dist/effort/store/index.js`, which is this module built. A caller
 * that needs a store and none of the rest of the library imports it
 * from here.
 *
 * ## Selection
 *
 * {@link selectEffortStore} opens, under one repo root, the backend a
 * resolved config names. It takes the config already resolved, the
 * `config` field of what `loadConfig` and `resolveConfig` answer, and
 * never reads a `.rafa/config.yaml` itself. Resolution has one owner,
 * the config: `src/config.ts` ranks the command line over the project's
 * file over the user scope's over the default, and `src/config-load.ts`
 * is the only place that reads either file and warns about it. A
 * selector that loaded the config again would read the files a second
 * time, warn twice, and answer a file's backend over a flag its caller
 * had already ranked above it.
 *
 * Selecting touches nothing on disk. Both backends open without reading
 * or creating anything, so a store's first-run rules stay the backend's
 * own, and a selection that is never used leaves no trace.
 *
 * The backend is the `store` adapter of that name in core's adapter
 * registry, `src/adapters/registry.ts`, which registers both backends
 * from a record closed over the config's backend names. A name added to
 * `STORE_BACKENDS` therefore fails to compile there until a backend
 * opens it, rather than being accepted by the config and refused by the
 * store. The selector resolves through core's registry and never through
 * one an add-on extended, since the config accepts no store name but
 * those two.
 *
 * A name no backend opens is refused with a `TypeError` listing the
 * store kinds the registry holds, and never downgraded to the default.
 * The resolver refuses such a name already, so reaching this refusal
 * means a caller built its config by hand, and falling back would write
 * rows into a store other than the one it named: the silent success
 * `src/config.ts` refuses, for the same reason. The registry looks the
 * name up in a `Map` rather than by indexing an object, because an index
 * answers more than the registry holds. Measured before the registry,
 * with this module's record of openers indexed in place of its `Map`,
 * `constructor` indexed it to `Object`, which called on the repo root
 * returns a string wrapper, so the selection threw nothing and handed
 * that wrapper back as the store. A list holding `sqlite` was coerced to
 * the name and opened SQLite.
 *
 * ## What a selected store carries
 *
 * The port, plus `path`, the one reading both backends make beyond it.
 * A reading only one backend can make, such as the NDJSON line
 * arithmetic or `separatedPartialLine`, stays on that backend's own
 * surface. A caller that needs one opens that backend directly, which
 * is why both openers are exported beside the selector.
 *
 * ## What the entry exports
 *
 * The port's types and its key record, each backend's opener and
 * surface type, the selector, and the backend names, so a caller can
 * spell a selection without importing the config module. Nothing else.
 * A subpath is a public surface: a name added to it later breaks
 * nobody, and a name removed breaks every caller that imported it. So
 * the SQLite module's schema history and migration function, exported
 * there for its own suite, are not exported here, and neither is the
 * adapter registry the selector resolves through.
 *
 * `effort/store.ts`, the sibling's store bound to one file, is not
 * re-exported either. It is what the NDJSON backend runs, not a third
 * backend.
 *
 * Importing this entry imports both backends, and `bun:sqlite` with
 * the SQLite one, so the entry needs Bun even to select NDJSON.
 */
import type { EffortRowKind, EffortStore } from './types.js';
import type { RafaConfig } from '../../config.js';

import { CORE_ADAPTER_REGISTRY } from '../../adapters/registry.js';

export type { StoreBackend } from '../../config.js';
export type {
  NdjsonAppendResult,
  NdjsonEffortStore,
  StoreReadResult,
} from './ndjson.js';
export type { SqliteEffortStore } from './sqlite.js';
export type {
  AppendResult,
  CommitEffortRow,
  EffortKeyProjections,
  EffortRow,
  EffortRowByKind,
  EffortRowKind,
  EffortStore,
  SessionEffortRow,
  SessionMode,
} from './types.js';

export { STORE_BACKENDS } from '../../config.js';
export { openNdjsonStore } from './ndjson.js';
export { openSqliteStore } from './sqlite.js';
export { EFFORT_KEY_PROJECTIONS } from './types.js';

/**
 * What {@link selectEffortStore} answers: the port, plus the one
 * reading both backends make beyond it.
 */
export interface SelectedEffortStore extends EffortStore {
  /**
   * The file one kind lives in, whether or not it exists yet: the
   * kind's own file under NDJSON, the file every kind shares under
   * SQLite.
   */
  path: (kind: EffortRowKind) => string;
}

/** A value as a refusal quotes it. Never serialises an object. */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'object' && value !== null) return 'an object';
  return String(value);
}

/**
 * Opens the backend `config.store` names, under `repoRoot`, through the
 * `store` adapter core's registry holds under that name.
 *
 * Pass the `config` field of a resolved config, not the resolution
 * itself. Opening touches nothing on disk; each backend reads and
 * creates its files only when a call needs them.
 *
 * Throws a `TypeError`, having opened nothing, when `config.store`
 * names no backend. See the module note on why it is not downgraded.
 */
export function selectEffortStore(
  repoRoot: string,
  config: Pick<RafaConfig, 'store'>,
): SelectedEffortStore {
  const adapter = CORE_ADAPTER_REGISTRY.find('store', config.store);
  if (adapter === undefined) {
    const expected = CORE_ADAPTER_REGISTRY.kinds('store').join(', ');
    throw new TypeError(
      `effort store: store is ${describeValue(config.store)},`
        + ` expected one of: ${expected}`,
    );
  }
  return adapter.create({ repoRoot });
}
