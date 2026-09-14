/**
 * The adapter registry: the adapters core can hand a caller, keyed by
 * the port type each one fills and the kind a config selects it by.
 *
 * Among the seams core carries from phase 1, the modules spec names "an
 * adapter registry inside core keyed by `(type, kind)`, populated from
 * core's own adapters at startup and from enabled modules", with config
 * selecting by kind. This module is that registry and core's part of
 * populating it. Enabling a module is phase 7's work; until then an
 * add-on reaches the registry through {@link AdapterRegistry.register},
 * and core never imports one.
 *
 * ## Keys
 *
 * A port type is one of the five `PortType` names: `tracker`, `store`,
 * `learning`, `output` and `planner`. A kind is any non-empty string,
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
 * {@link CORE_ADAPTER_REGISTRY} is a constant for the same reason.
 *
 * ## What core registers
 *
 * The two store backends, `store/sqlite` and `store/ndjson`, which
 * `selectEffortStore` resolves through {@link CORE_ADAPTER_REGISTRY},
 * the two outputs under `src/adapters/output/`, `output/text` and
 * `output/json`, the two trackers under `src/adapters/tracker/`,
 * `tracker/local` and `tracker/github`, the learning stub under
 * `src/adapters/learning/`, `learning/local`, and the planner under
 * `src/adapters/planner/`, `planner/claude`, which `rafa plan` resolves
 * through {@link CORE_ADAPTER_REGISTRY}. Those are all the core adapters
 * the phase 1 table names.
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
 * `github` tracker added `gh`, and the `claude` planner added
 * `settingSources`, `planPrompt` and `claude`. The planner's first two are
 * optional to the type and not to the adapter: neither has a default it
 * could fall back on (`src/adapters/planner/claude.ts` says why), so its
 * `create` throws when either is left out. Each output `create` makes a new output,
 * so a `json` output's one terminal result belongs to the command it was
 * made for. Each tracker `create` makes a new tracker, so the reason a
 * `local` tracker records is the one its own context named, and the
 * labels a `github` tracker remembers making are the ones it made itself.
 */
import type { ClaudeSettingSource, StoreBackend } from '../config.js';
import type { OutputStream } from './output/stream.js';
import type { PlanPromptBuilder } from './planner/claude.js';
import type { GhRunner } from './tracker/github.js';
import type { SelectedEffortStore } from '../effort/store/index.js';
import type {
  Learning,
  Output,
  Planner,
  PortType,
  PortVersions,
  Tracker,
} from '../ports/index.js';
import type { ClaudeSpawner } from '../utils/claude.js';

import { describeValue } from '../config-sections.js';
import { STORE_BACKENDS } from '../config.js';
import { openNdjsonStore } from '../effort/store/ndjson.js';
import { openSqliteStore } from '../effort/store/sqlite.js';

import { createLocalLearning, localInstinctsDir } from './learning/local.js';
import { createJsonOutput } from './output/json.js';
import { createTextOutput } from './output/text.js';
import { createClaudePlanner } from './planner/claude.js';
import { createGhRunner, createGithubTracker } from './tracker/github.js';
import { createLocalTracker, localIssuesDir } from './tracker/local.js';

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
}

/** What every adapter is made with. */
export interface AdapterContext {
  /** The repository the adapter acts on. */
  readonly repoRoot: string;
  /** Where an output adapter writes. Read by the outputs alone; `process.stdout` when left out. */
  readonly stream?: OutputStream;
  /** How much the `text` output writes. Read by it alone; 0 when left out. */
  readonly verbosity?: number;
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
   * stub. Read by it alone, which is refused without one.
   */
  readonly planPrompt?: PlanPromptBuilder;
  /**
   * The spawner the `claude` planner's session goes through. Read by it
   * alone; a spawner running `claude` when left out.
   */
  readonly claude?: ClaudeSpawner;
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
   * is. Never throws, whatever it is handed.
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

/**
 * Each store backend's opener, by the name the config selects it with.
 *
 * A mapped record so the set is closed over `StoreBackend`: a name the
 * config accepts with no opener here does not compile.
 */
const STORE_OPENERS: {
  readonly [B in StoreBackend]: (repoRoot: string) => SelectedEffortStore;
} = {
  sqlite: openSqliteStore,
  ndjson: openNdjsonStore,
};

/**
 * The adapters core registers, in the order `kinds` answers them: the
 * store backends, in the order the config names them, then the `text`
 * and `json` outputs, then the `local` and `github` trackers, then the
 * `local` learning stub, then the `claude` planner.
 */
const CORE_ADAPTERS: readonly AnyAdapter[] = [
  ...STORE_BACKENDS.map(
    (backend): AnyAdapter => ({
      port: 'store',
      kind: backend,
      portVersion: PORT_VERSIONS.store,
      create: ({ repoRoot }) => STORE_OPENERS[backend](repoRoot),
    }),
  ),
  {
    port: 'output',
    kind: 'text',
    portVersion: PORT_VERSIONS.output,
    create: ({ stream = process.stdout, verbosity = 0 }) => createTextOutput({ verbosity, stream }),
  },
  {
    port: 'output',
    kind: 'json',
    portVersion: PORT_VERSIONS.output,
    create: ({ stream = process.stdout }) => createJsonOutput({ stream }),
  },
  {
    port: 'tracker',
    kind: 'local',
    portVersion: PORT_VERSIONS.tracker,
    create: ({ repoRoot, fallbackReason = null }) => createLocalTracker({
      issuesDir: localIssuesDir(repoRoot),
      fallbackReason,
    }),
  },
  {
    port: 'tracker',
    kind: 'github',
    portVersion: PORT_VERSIONS.tracker,
    create: ({ repoRoot, gh }) => createGithubTracker({ gh: gh ?? createGhRunner({ cwd: repoRoot }) }),
  },
  {
    port: 'learning',
    kind: 'local',
    portVersion: PORT_VERSIONS.learning,
    create: ({ repoRoot }) => createLocalLearning({ instinctsDir: localInstinctsDir(repoRoot) }),
  },
  {
    port: 'planner',
    kind: 'claude',
    portVersion: PORT_VERSIONS.planner,
    create: ({ repoRoot, settingSources, planPrompt, claude }) => {
      if (!Array.isArray(settingSources)) {
        throw new TypeError(
          `${REFUSAL}: planner/claude has settingSources ${describeValue(settingSources)} in its context,`
            + ' expected a list of setting sources',
        );
      }
      if (typeof planPrompt !== 'function') {
        throw new TypeError(
          `${REFUSAL}: planner/claude has planPrompt ${describeValue(planPrompt)} in its context,`
            + ' expected a function',
        );
      }
      return createClaudePlanner({ repoRoot, settingSources, buildPrompt: planPrompt, spawn: claude });
    },
  },
];

/**
 * Core's registry: every adapter core registers, and nothing else. An
 * add-on extends it with `register`, which answers a new registry and
 * leaves this one as it is.
 */
export const CORE_ADAPTER_REGISTRY: AdapterRegistry = createAdapterRegistry(CORE_ADAPTERS);
