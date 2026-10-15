/**
 * The adapter registry: the adapters core can hand a caller, keyed by
 * the port type each one fills and the kind a config selects it by.
 *
 * Among the seams core carries from phase 1, the modules spec names "an
 * adapter registry inside core keyed by `(type, kind)`, populated from
 * core's own adapters at startup and from enabled modules", with config
 * selecting by kind. This module is that registry and the slot it is
 * populated through; core's own adapters are handed in by the
 * composition root `src/adapter-registry.ts` (see "What core
 * registers"). Enabling a module is phase 7's work; until then an
 * add-on reaches the registry through {@link AdapterRegistry.register},
 * which `src/modules/load.ts` calls for each module `allowList:` names
 * from a `path` source. No reader resolves through that registry yet:
 * every caller below resolves through {@link CORE_ADAPTER_REGISTRY}.
 *
 * ## Keys
 *
 * A port type is one of the seven `PortType` names: `tracker`, `store`,
 * `learning`, `output`, `planner`, `sync` and `logger`. A kind is any non-empty string,
 * core's own (`sqlite`) or one an add-on brings. The registry refuses a
 * second adapter under a port type and kind it already holds, so an
 * add-on cannot take a core kind over by registering its name. A
 * replacement store or planner registers under a kind of its own, and
 * the config selects that kind.
 *
 * Every lookup goes through a `Map`, never an index into an object,
 * because an index answers names the registry does not hold. Measured
 * in `src/effort/store/index.ts` before this module, with its record of
 * backends indexed in place of its `Map`: `constructor` answered
 * `Object`, and a list holding `sqlite` was coerced to that name.
 * `registry.test.ts` holds both finding nothing here.
 *
 * ## Port versions
 *
 * {@link PORT_VERSIONS} is the version core serves of each port. The
 * entry `src/ports/index.ts` exports types and no value, so it declares
 * each version as a number literal type, gathered in `PortVersions`,
 * and the number compared at runtime lives here. The value `satisfies`
 * `PortVersions`, so `check-types` refuses a number that differs from
 * its literal. A literal widened to `number` passes that check, so
 * `registry.test.ts` also reads each literal off the compiler and holds
 * it equal to the value.
 *
 * An adapter states the port version it implements. Registering one
 * whose version is not the one core serves throws, naming both numbers:
 * the modules spec's refusal of a module whose port version core no
 * longer serves. Nothing is coerced, so a version of `"1"` is refused
 * as `2` is.
 *
 * ## A registry is a value
 *
 * {@link AdapterRegistry.register} answers a new registry holding one
 * more adapter and leaves the registry it was called on unchanged. Each
 * adapter is copied and frozen as it is accepted, so moving its
 * `portVersion` afterwards cannot get past the check. Bun runs every
 * test file in one process, and a registry changed in place would carry
 * one case's fixture adapter into every file after it.
 *
 * The one module-level value is the active registry, and it is replaced,
 * never changed: {@link registerAdapters} replaces it with one holding
 * more adapters and answers the one it replaced, and
 * {@link restoreAdapters} puts one back, as `registerConfigSections` and
 * `restoreConfigSections` do for the config sections
 * (`src/core/config/section.ts`). A case that registers puts the
 * previous registry back in a `finally`, or every file bun runs later
 * reads its adapters. {@link activeAdapterRegistry} answers the active
 * registry as the value it is. {@link CORE_ADAPTER_REGISTRY} is a
 * frozen facade over that slot: no caller can change it, and each of its
 * members reads the active registry when it is called.
 *
 * ## What core registers
 *
 * Nothing of its own: this module imports no adapter. The composition
 * root `src/adapter-registry.ts`, outside `src/core/`, lists core's
 * adapters and hands them to {@link registerAdapters} as it is imported,
 * and `src/rafa.ts` and `src/index.ts` import it right after
 * `src/config-registry.ts`. Until something registers, every member of
 * {@link CORE_ADAPTER_REGISTRY} refuses, naming that module.
 *
 * The root registers the two store backends, `store/sqlite` and
 * `store/ndjson`, which `selectEffortStore` resolves through
 * {@link CORE_ADAPTER_REGISTRY}, the three outputs, `output/text` from
 * `src/core/output/` and `output/json` and `output/events` under
 * `src/adapters/output/`, the logger under `src/adapters/logger/`,
 * `logger/console`, the two trackers under `src/adapters/tracker/`,
 * `tracker/local` and `tracker/github`, the learning adapter under
 * `src/adapters/learning/`, `learning/local`, and the planner under
 * `src/adapters/planner/`, `planner/claude`, which `rafa plan` resolves
 * through {@link CORE_ADAPTER_REGISTRY}. Those are all the core adapters
 * the phase 1 table names. The `sync` port adds `sync/local`, the
 * default strategy of `effort.sync`, from `src/effort/sync/select.ts`,
 * whose `selectSync` resolves `effort.sync` through a registry, and
 * `sync/file`, the store carried as a file, from
 * `src/effort/sync/file.ts`. `git`, `service` and `p2p` are modules'
 * strategies, registered by a loaded module.
 *
 * ## What an adapter answers
 *
 * An adapter's `create` answers its port, except a store adapter's,
 * which answers `SelectedEffortStore`: the port plus `path`. That is
 * what `selectEffortStore` hands its callers, and what it hands them is
 * the adapter's store. No module under `src/` outside a test reads
 * `path`, so a store with no file behind it, such as the homelab store
 * the phase 1 table names as a later add-on, is where that answer is
 * next decided.
 *
 * Every adapter is made with an {@link AdapterContext}, which holds the
 * repository root, the one thing a store opens under. A port whose
 * adapter needs more gains a field when that adapter lands, optional so
 * that no other port's caller has to pass it: the outputs added `stream`
 * and `verbosity`, the `local` tracker added `fallbackReason`, the
 * `github` tracker added `gh`, the `claude` planner added
 * `settingSources`, `planPrompt`, `planDir` and `claude`, and the
 * `local` learning adapter added `home` and
 * `learningBlessMinConfidence`, each with a default, and the `file` sync
 * strategy added `store`, and the `service` sync strategy a module
 * brings added `hub`. The planner's first three are optional to the
 * type and not to the adapter: none has a default it could fall back on
 * (`src/adapters/planner/claude.ts` says why), so the `create` the root
 * registers throws when any is left out. `store` is the same to
 * `sync/file`: a default of
 * `sqlite` would carry an NDJSON project's store without its sessions
 * (`src/effort/sync/file.ts` says why), so its `create` throws when it is
 * left out or names no backend. The `local` learning adapter's floor
 * defaults to the registered `learning.bless.minConfidence`, and its
 * `create` throws, naming `src/config-registry.ts`, when no section
 * registered one. Each output `create` makes a new output,
 * so a `json` output's one terminal result belongs to the command it was
 * made for. Each tracker `create` makes a new tracker, so the reason a
 * `local` tracker records is the one its own context named, and the
 * labels a `github` tracker remembers making are the ones it made itself.
 */
import type { SelectedEffortStore } from '../../effort/store/index.js';
import type {
  Learning,
  Logger,
  Output,
  Planner,
  PortType,
  PortVersions,
  Sync,
  Tracker,
} from '../../ports/index.js';
import type { ClaudeSettingSource, StoreBackend } from '../config/config-sections.js';
import type { GhRunner } from '../git/gh-runner.js';
import type { CapturingSpawner } from '../loop/claude.js';
import type { OutputStream } from '../output/stream.js';

import { describeValue } from '../config/config-sections.js';

/** What every refusal opens with. */
const REFUSAL = 'adapter registry';

/**
 * The version core serves of each port, by port type.
 *
 * Held equal to the literal types `src/ports/index.ts` declares; see
 * the module note. Frozen, so no caller moves a version core compares
 * an adapter against.
 */
export const PORT_VERSIONS: Readonly<PortVersions> = Object.freeze({
  tracker: 1,
  store: 1,
  learning: 1,
  output: 1,
  planner: 1,
  sync: 1,
  logger: 1,
} satisfies PortVersions);

/** The served versions by port type, for a lookup no prototype member answers. */
const SERVED_VERSIONS: ReadonlyMap<unknown, number> = new Map<unknown, number>(
  Object.entries(PORT_VERSIONS),
);

/** The port types, as a refusal lists them. */
const PORT_TYPE_LIST = [...SERVED_VERSIONS.keys()].join(', ');

/** What an adapter of each port type answers once it is made. */
export interface PortImplementations {
  tracker: Tracker;
  /** The port plus `path`; see the module note. */
  store: SelectedEffortStore;
  learning: Learning;
  output: Output;
  planner: Planner;
  sync: Sync;
  logger: Logger;
}

/**
 * Builds one session's prompt from the spec's content, the plan's stub
 * and `planDir`, the plans directory as an absolute path: the files the
 * prompt tells the session to write are named in it.
 */
export type PlanPromptBuilder = (specContent: string, stub: string, planDir: string) => string;

/** What every adapter is made with. */
export interface AdapterContext {
  /** The repository the adapter acts on. */
  readonly repoRoot: string;
  /** Where an output adapter writes. Read by the outputs alone; `process.stdout` when left out. */
  readonly stream?: OutputStream;
  /** How much the `text` output writes, and from which verbosity a logger writes `debug` and `api`; 0 when left out. */
  readonly verbosity?: number;
  /** Whether a logger may colour its lines. Read by the loggers alone; false when left out. */
  readonly colour?: boolean;
  /**
   * Why the trackers ahead of this one were passed over, recorded in each
   * issue the `local` tracker creates. Read by it alone; null when left out.
   */
  readonly fallbackReason?: string | null;
  /**
   * The runner every `gh` command goes through. Read by the `github`
   * tracker alone; a runner spawning `gh` in `repoRoot` when left out.
   */
  readonly gh?: GhRunner;
  /**
   * What the `claude` planner's session loads settings from: the run's
   * resolved `loop.settingSources`. Read by it alone, which is refused
   * without them.
   */
  readonly settingSources?: readonly ClaudeSettingSource[];
  /**
   * The prompt the `claude` planner's session is handed for one spec and
   * stub, naming its files in the absolute plans directory the planner
   * hands over. Read by it alone, which is refused without one.
   */
  readonly planPrompt?: PlanPromptBuilder;
  /**
   * The directory the `claude` planner writes plans into: the run's
   * resolved `plan.dir`. Read by it alone, which is refused without one.
   */
  readonly planDir?: string;
  /**
   * The spawner the `claude` planner's session goes through, which
   * answers the session's stdout beside its exit code, since the
   * planner reads the spec review out of it. Read by that planner
   * alone; a spawner running `claude` when left out.
   */
  readonly claude?: CapturingSpawner;
  /**
   * The home whose `.rafa/instincts` is the user scope the `local`
   * learning adapter pulls from. Read by it alone; `homedir()` when left
   * out.
   */
  readonly home?: string;
  /**
   * The lowest confidence the `local` learning adapter blesses: the run's
   * resolved `learning.bless.minConfidence`. Read by it alone; the
   * config default when left out.
   */
  readonly learningBlessMinConfidence?: number;
  /**
   * The project's resolved `store` backend. Read by the `file` sync
   * strategy alone, which is refused without one.
   */
  readonly store?: StoreBackend;
  /**
   * The hub a `service` sync reaches: the run's resolved `hub.url`,
   * `hub.tokenSecret` and `hub.timeout`, the last in milliseconds.
   * Handed on by `selectSync` whenever `hub.url` is set, and read by a
   * module's `service` strategy alone; core's adapters never read it.
   *
   * The shape is spelled here rather than imported: it is the
   * `HubContext` the `hub` section declares in
   * `src/config-schema-hub.ts`, and core imports no section file.
   * `selectSync` hands that section's value in, so the checker holds
   * the two shapes together there.
   */
  readonly hub?: {
    /** The hub's address: the resolved `hub.url`. */
    readonly url: string;
    /** The secret store name of the token, or null: the resolved `hub.tokenSecret`. */
    readonly tokenSecret: string | null;
    /** How long one request may take, in milliseconds: the resolved `hub.timeout`. */
    readonly timeoutMs: number;
  };
}

/**
 * One adapter as the registry holds it. `create` is a property
 * signature, as every port function is, for the reason the ports note
 * gives.
 */
export interface Adapter<P extends PortType> {
  /** The port type the adapter fills. */
  readonly port: P;
  /** The name a config selects the adapter by: `sqlite`, `github`. */
  readonly kind: string;
  /** The version of its port the adapter implements. */
  readonly portVersion: number;
  /** Makes the adapter. Registering one never calls it. */
  readonly create: (context: AdapterContext) => PortImplementations[P];
}

/** An adapter of any port type, told apart by `port`. */
export type AnyAdapter = { [P in PortType]: Adapter<P> }[PortType];

/** Adapters keyed by port type and kind. A registry never changes once made. */
export interface AdapterRegistry {
  /**
   * A new registry holding this one's adapters followed by `adapter`,
   * leaving this one unchanged.
   *
   * Throws, answering no registry, when `port` names no port type,
   * `kind` is not a non-empty string, `create` is not a function,
   * `portVersion` is not the version core serves of that port (naming
   * both numbers), or an adapter is already held under that port type
   * and kind.
   */
  readonly register: (adapter: AnyAdapter) => AdapterRegistry;
  /**
   * The adapter held under a port type and kind, or undefined when none
   * is. Never throws, whatever it is handed, but for
   * {@link CORE_ADAPTER_REGISTRY} while nothing is registered.
   */
  readonly find: <P extends PortType>(port: P, kind: string) => Adapter<P> | undefined;
  /**
   * The adapter held under a port type and kind. Throws a `TypeError`
   * when `port` names no port type, and an `Error` naming the kinds held
   * when no adapter is held under `kind`.
   */
  readonly resolve: <P extends PortType>(port: P, kind: string) => Adapter<P>;
  /**
   * The kinds held for a port type, in the order they were registered.
   * Throws a `TypeError` when `port` names no port type.
   */
  readonly kinds: (port: PortType) => readonly string[];
}

/** Each port type's adapters, by kind. */
type AdaptersByPort = { readonly [P in PortType]: ReadonlyMap<string, Adapter<P>> };

/** Throws a `TypeError` unless a value names a port type. */
function checkPortType(port: unknown): asserts port is PortType {
  if (!SERVED_VERSIONS.has(port)) {
    throw new TypeError(
      `${REFUSAL}: port is ${describeValue(port)}, expected one of: ${PORT_TYPE_LIST}`,
    );
  }
}

/**
 * An adapter as the registry keeps it: checked, copied and frozen.
 * `held` is what was accepted before it, for the duplicate check.
 */
function accept(adapter: unknown, held: readonly AnyAdapter[]): AnyAdapter {
  if (typeof adapter !== 'object' || adapter === null) {
    throw new TypeError(
      `${REFUSAL}: an adapter is ${describeValue(adapter)}, expected a mapping`,
    );
  }
  const { port, kind, portVersion, create } = adapter as Partial<
    Record<keyof AnyAdapter, unknown>
  >;

  checkPortType(port);
  if (typeof kind !== 'string' || kind === '') {
    throw new TypeError(
      `${REFUSAL}: a ${port} adapter has kind ${describeValue(kind)}, expected a non-empty name`,
    );
  }
  const key = `${port}/${kind}`;
  if (typeof create !== 'function') {
    throw new TypeError(
      `${REFUSAL}: ${key} has create ${describeValue(create)}, expected a function`,
    );
  }
  const served = SERVED_VERSIONS.get(port);
  if (portVersion !== served) {
    throw new Error(
      `${REFUSAL}: ${key} implements ${port} port version ${describeValue(portVersion)},`
        + ` and core serves ${port} port version ${served}`,
    );
  }
  if (held.some((other) => other.port === port && other.kind === kind)) {
    throw new Error(`${REFUSAL}: ${key} is already registered`);
  }
  return Object.freeze({ port, kind, portVersion, create }) as AnyAdapter;
}

/** Each port type's adapters by kind, from adapters already accepted. */
function indexByPort(adapters: readonly AnyAdapter[]): AdaptersByPort {
  const only = <P extends PortType>(port: P): ReadonlyMap<string, Adapter<P>> => new Map(
    adapters
      .filter((adapter) => adapter.port === port)
      // Filtered on `port`, so each one is an adapter of that port type.
      .map((adapter): [string, Adapter<P>] => [adapter.kind, adapter as Adapter<P>]),
  );
  return {
    tracker: only('tracker'),
    store: only('store'),
    learning: only('learning'),
    output: only('output'),
    planner: only('planner'),
    sync: only('sync'),
    logger: only('logger'),
  };
}

/**
 * Makes a registry holding `adapters`, each accepted in order as
 * {@link AdapterRegistry.register} accepts one.
 *
 * Throws, answering no registry, on the first adapter `register` would
 * refuse.
 */
export function createAdapterRegistry(adapters: readonly AnyAdapter[] = []): AdapterRegistry {
  const held = adapters.reduce<readonly AnyAdapter[]>(
    (accepted, adapter) => [...accepted, accept(adapter, accepted)],
    [],
  );
  const byPort = indexByPort(held);

  const registry: AdapterRegistry = {
    register: (adapter) => createAdapterRegistry([...held, adapter]),
    find: (port, kind) => (SERVED_VERSIONS.has(port)
      ? byPort[port].get(kind)
      : undefined),
    resolve: (port, kind) => {
      checkPortType(port);
      const adapter = byPort[port].get(kind);
      if (adapter !== undefined) return adapter;
      const registered = [...byPort[port].keys()];
      const listed = registered.length === 0
        ? 'none'
        : registered.join(', ');
      throw new Error(
        `${REFUSAL}: no ${port} adapter is registered as ${describeValue(kind)};`
          + ` registered: ${listed}`,
      );
    },
    kinds: (port) => {
      checkPortType(port);
      return [...byPort[port].keys()];
    },
  };
  return Object.freeze(registry);
}

/** The registry before anything is registered: no adapter under any port type. */
const EMPTY_ADAPTER_REGISTRY: AdapterRegistry = createAdapterRegistry();

/** The module that registers core's adapters, as a refusal names it. */
const COMPOSITION_ROOT = 'src/adapter-registry.ts';

/** The module-level registry {@link CORE_ADAPTER_REGISTRY} reads at call time. */
let active: AdapterRegistry = EMPTY_ADAPTER_REGISTRY;

/** Whether a registry holds no adapter under any port type. */
function holdsNone(registry: AdapterRegistry): boolean {
  return [...SERVED_VERSIONS.keys()].every((port) => registry.kinds(port as PortType).length === 0);
}

/**
 * Registers `adapters` on the active registry, each accepted in order as
 * {@link AdapterRegistry.register} accepts one, and answers the registry
 * it replaced, for {@link restoreAdapters}.
 *
 * Throws on the first adapter `register` would refuse, and leaves the
 * active registry as it was: none of `adapters` is registered.
 */
export function registerAdapters(adapters: readonly AnyAdapter[]): AdapterRegistry {
  const previous = active;
  active = adapters.reduce<AdapterRegistry>((registry, adapter) => registry.register(adapter), previous);
  return previous;
}

/**
 * Makes `registry` the active one: what {@link registerAdapters} or
 * {@link activeAdapterRegistry} answered, or one made with
 * {@link createAdapterRegistry}, which with no adapters is the registry
 * before anything is registered.
 *
 * Throws a `TypeError`, leaving the active registry as it was, when
 * handed {@link CORE_ADAPTER_REGISTRY} itself: the facade reads the
 * active registry, so making it the active one would leave every call
 * reading itself.
 */
export function restoreAdapters(registry: AdapterRegistry): void {
  if (registry === CORE_ADAPTER_REGISTRY) {
    throw new TypeError(
      `${REFUSAL}: CORE_ADAPTER_REGISTRY reads the active registry and cannot be made the active one;`
        + ' restore what registerAdapters or activeAdapterRegistry answered',
    );
  }
  active = registry;
}

/**
 * The active registry as it is now: a value, which a later
 * {@link registerAdapters} does not change. It holds no adapter until
 * something registers one.
 */
export function activeAdapterRegistry(): AdapterRegistry {
  return active;
}

/** The active registry, or a refusal naming the module that registers core's adapters. */
function registered(): AdapterRegistry {
  if (holdsNone(active)) {
    throw new Error(
      `${REFUSAL}: no adapter is registered: import ${COMPOSITION_ROOT},`
        + ' which registers core\'s adapters, before reading CORE_ADAPTER_REGISTRY',
    );
  }
  return active;
}

/**
 * Core's registry: whatever the active registry holds when it is called,
 * which `src/adapter-registry.ts` fills with core's adapters as it is
 * imported. Core imports no adapter; it reads the ones it is handed.
 *
 * A frozen facade, not a registry value: each member reads the active
 * registry at call time, so a caller holding it reads what was
 * registered after it took hold of it. While the active registry holds
 * no adapter, every member, `find` among them, throws an `Error` naming
 * `src/adapter-registry.ts`, so a caller that never imported it learns
 * so at its first read rather than finding nothing. `register` answers
 * a new registry, a value, and leaves the active registry as it is.
 */
export const CORE_ADAPTER_REGISTRY: AdapterRegistry = Object.freeze<AdapterRegistry>({
  register: (adapter) => registered().register(adapter),
  find: (port, kind) => registered().find(port, kind),
  resolve: (port, kind) => registered().resolve(port, kind),
  kinds: (port) => registered().kinds(port),
});
