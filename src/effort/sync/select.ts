/**
 * The `local` sync strategy, and {@link selectSync}, which hands a
 * caller the `Sync` port the project's `effort.sync` names.
 *
 * ## The `local` strategy
 *
 * `local` is the default of `effort.sync`: the store stays on the device
 * that wrote it. {@link createLocalSync} answers a `Sync` whose push and
 * pull both answer `nothing-to-sync` and read nothing of their request,
 * so neither opens the store nor touches the disk. Core registers it as
 * `sync/local` in `CORE_ADAPTER_REGISTRY` (`src/adapters/registry.ts`),
 * which calls {@link createLocalSync} from the entry's `create`.
 *
 * ## Selecting
 *
 * {@link selectSync} takes the `config` field of a resolved config and
 * never reads a `.rafa/config.yaml` itself, for the reason
 * `selectEffortStore` gives (`src/effort/store/index.ts`): resolution
 * has one owner, the config. It resolves `effortSync` as a `sync` kind
 * through the registry it is handed, `CORE_ADAPTER_REGISTRY` when none
 * is, and makes the adapter with the repository root alone. A caller
 * that loaded modules hands the registry `loadModules` answers
 * (`src/modules/load.ts`), since only that one holds a module's `sync`
 * adapter.
 *
 * A kind the registry does not hold is refused in one of two ways:
 *
 *   - `git`, `service` and `p2p`, the strategies modules bring
 *     ({@link MODULE_SYNC_STRATEGIES}), throw {@link SyncModuleMissing}.
 *     Core has no module install, so its message names the kind and the
 *     `modules:` and `allowList:` lines of `.rafa/config.yaml` that load
 *     a module providing it, written as lines that parse as they stand.
 *     `select.test.ts` fills the two placeholders in, loads the result
 *     through `loadModules`, and selects the fixture module's `git`.
 *   - Any other kind throws a `TypeError`. A name outside
 *     `SYNC_STRATEGIES` is refused by the config already, so reaching
 *     this means a caller built its config by hand, and it is never
 *     downgraded to `local`: a sync that silently moved no rows would
 *     leave two devices apart while reporting success. A core strategy
 *     the registry does not hold names the kinds it does.
 *
 * Every lookup goes through the registry's `find`, a `Map`, so a kind
 * such as `constructor` finds nothing rather than a prototype member.
 *
 * ## The import cycle
 *
 * `registry.ts` imports {@link createLocalSync} from here, and this
 * module imports `CORE_ADAPTER_REGISTRY` from there. Neither reads the
 * other's binding while it evaluates: the registry calls
 * {@link createLocalSync} only inside the entry's `create`, and this
 * module reads the registry only inside {@link selectSync}. So either
 * module can be imported first. `select.test.ts` imports each first in a
 * child `bun` and resolves `sync/local` there.
 */
import type { AdapterRegistry } from '../../adapters/registry.js';
import type { RafaConfig, SyncStrategy } from '../../config.js';
import type { Sync, SyncPullResult, SyncPushResult } from '../../ports/index.js';

import { CORE_ADAPTER_REGISTRY } from '../../adapters/registry.js';
import { describeValue } from '../../config-sections.js';
import { SYNC_STRATEGIES } from '../../config.js';

/** What every refusal opens with. */
const REFUSAL = 'effort sync';

/**
 * The strategies modules bring and core ships no adapter for, in the
 * order `SYNC_STRATEGIES` names them.
 */
export const MODULE_SYNC_STRATEGIES: readonly SyncStrategy[] = Object.freeze(['git', 'service', 'p2p']);

/** The placeholder a refusal writes for the module's directory. */
export const MODULE_DIRECTORY_PLACEHOLDER = '<module directory>';

/** The placeholder a refusal writes for the module's `package.json` name. */
export const MODULE_NAME_PLACEHOLDER = '<module name>';

/** What `local`'s push and pull both answer. */
const NOTHING_TO_SYNC: SyncPushResult & SyncPullResult = Object.freeze({ status: 'nothing-to-sync' });

/**
 * Makes the `local` strategy: a push and a pull that move no rows and
 * answer `nothing-to-sync`, whatever request they are handed. A new
 * frozen `Sync` on each call.
 */
export function createLocalSync(): Sync {
  return Object.freeze({
    kind: 'local',
    push: async () => NOTHING_TO_SYNC,
    pull: async () => NOTHING_TO_SYNC,
  });
}

/** The `sync` kinds a registry holds, as a refusal lists them. */
function listed(registered: readonly string[]): string {
  return registered.length === 0
    ? 'none'
    : registered.join(', ');
}

/** The refusal {@link SyncModuleMissing} carries for `kind`. */
function moduleMissingMessage(kind: SyncStrategy, registered: readonly string[]): string {
  return [
    `${REFUSAL}: effort.sync is "${kind}", and no module registers a sync adapter of that kind`
      + ` (registered: ${listed(registered)}). Core ships no ${kind} strategy; load a module that provides`
      + ' one with these lines in .rafa/config.yaml:',
    'modules:',
    `  - path: ${MODULE_DIRECTORY_PLACEHOLDER}`,
    'allowList:',
    `  - ${MODULE_NAME_PLACEHOLDER}`,
  ].join('\n');
}

/**
 * `effort.sync` names a strategy modules bring, and no loaded module
 * registers it. `kind` is the strategy; the message names it and the
 * `modules:` and `allowList:` lines that load a module providing it.
 */
export class SyncModuleMissing extends Error {
  override readonly name = 'SyncModuleMissing';
  readonly kind: SyncStrategy;

  constructor(kind: SyncStrategy, registered: readonly string[]) {
    super(moduleMissingMessage(kind, registered));
    this.kind = kind;
  }
}

/** Whether a value is one of the strategies modules bring. */
function isModuleStrategy(kind: unknown): kind is SyncStrategy {
  return (MODULE_SYNC_STRATEGIES as readonly unknown[]).includes(kind);
}

/**
 * Makes the `Sync` that `config.effortSync` names, under `repoRoot`,
 * through the `sync` adapter `registry` holds under that name.
 *
 * Pass the `config` field of a resolved config, and the registry
 * `loadModules` answered when modules were loaded. Selecting touches
 * nothing on disk.
 *
 * Throws {@link SyncModuleMissing} when a module strategy is not held,
 * and a `TypeError` for any other kind not held. See the module note.
 */
export function selectSync(
  repoRoot: string,
  config: Pick<RafaConfig, 'effortSync'>,
  registry: AdapterRegistry = CORE_ADAPTER_REGISTRY,
): Sync {
  const kind: unknown = config.effortSync;
  const adapter = typeof kind === 'string'
    ? registry.find('sync', kind)
    : undefined;
  if (adapter !== undefined) return adapter.create({ repoRoot });

  const registered = registry.kinds('sync');
  if (isModuleStrategy(kind)) throw new SyncModuleMissing(kind, registered);
  const known = (SYNC_STRATEGIES as readonly unknown[]).includes(kind);
  const expected = known
    ? `registered: ${listed(registered)}`
    : `expected one of: ${SYNC_STRATEGIES.join(', ')}`;
  throw new TypeError(
    `${REFUSAL}: effort.sync is ${describeValue(kind)}, and no sync adapter is registered under it; ${expected}`,
  );
}
