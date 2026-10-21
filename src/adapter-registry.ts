/**
 * The composition root of the adapter registry: core's adapters, listed
 * here and handed to core when {@link registerCoreAdapters} is called.
 *
 * Core declares the registry (`packages/rafa/src/core/adapters/registry.ts`) and
 * imports no adapter: the adapters sit under `src/adapters/`,
 * `packages/rafa/src/effort/store/` and `src/effort/sync/`, above core, and a core
 * file importing them would be an upward edge. This module, outside
 * `packages/rafa/src/core/`, is the one place they are listed, {@link CORE_ADAPTERS}.
 *
 * Importing it registers nothing. {@link registerCoreAdapters} calls
 * `registerAdapters` with that list, so `CORE_ADAPTER_REGISTRY` answers
 * every core kind, and answers the registry it made; a registration
 * core refuses throws from the call, naming what it refused. The root
 * is called, never imported for its effect: under `"sideEffects":
 * false` in a manifest, `bun build` drops an import kept for its effect
 * alone. The root manifest declares no such field today, since bun
 * 1.3.14's split build breaks under it (#1213). `src/rafa.ts` and
 * `src/index.ts` call it as they load, after their imports and before
 * anything that resolves an adapter; core never imports this module.
 * Until something calls it, every member of `CORE_ADAPTER_REGISTRY`
 * refuses.
 *
 * `bun test` calls it once for the test process, from
 * `src/tests/preload.ts`, which `bunfig.toml` names under
 * `[test] preload`: a test that reads core's adapters off
 * `CORE_ADAPTER_REGISTRY`, directly or through the module under test,
 * reads them registered whether it runs alone or behind another file.
 * A child process a test spawns runs no preload, and calls the root
 * itself before it reads the registry.
 *
 * A second call, from an entry a test imports or from both entries in
 * one process, finds core's adapters held already and answers the
 * active registry as it is, registering nothing: `registerAdapters`
 * would refuse each kind as already registered.
 *
 * ## The order
 *
 * `kinds` answers each port type's kinds in the order they were
 * registered, which is the order of {@link CORE_ADAPTERS}: the store
 * backends, in the order the config names them, then the `text`, `json`
 * and `events` outputs, then the `console` logger, then the `local` and
 * `github` trackers, then the `local` learning adapter, then the `claude`
 * planner, then the `local` and `file` sync strategies.
 * `adapter-registry.test.ts` holds that list.
 *
 * ## The refusals it keeps
 *
 * Every refusal an adapter's `create` makes here opens with
 * `adapter registry:`, as the registry's own do, so a caller reads the
 * same sentence it read when core listed these adapters itself.
 */
import type { AdapterRegistry, AnyAdapter } from '@open-tomato/rafa/core/adapters';
import type { StoreBackend } from '@open-tomato/rafa/core/config/sections';
import type { SelectedEffortStore } from '@open-tomato/rafa/store';

import { homedir } from 'node:os';

import { createFileSync, createLocalSync } from '@open-tomato/rafa-effort';
import { createLocalLearning, localInstinctsDir } from '@open-tomato/rafa-inventory';

import { createConsoleLogger } from '@open-tomato/rafa/adapters/logger/console';
import { createEventsOutput } from '@open-tomato/rafa/adapters/output/events';
import { activeAdapterRegistry, PORT_VERSIONS, registerAdapters } from '@open-tomato/rafa/core/adapters';
import { activeDefaults } from '@open-tomato/rafa/core/config';
import { describeValue, STORE_BACKENDS } from '@open-tomato/rafa/core/config/sections';
import { createTextOutput } from '@open-tomato/rafa/core/output';
import { openNdjsonStore } from '@open-tomato/rafa/store/ndjson';
import { openSqliteStore } from '@open-tomato/rafa/store/sqlite';

import { createJsonOutput } from './adapters/output/json.js';
import { createClaudePlanner } from './adapters/planner/claude.js';
import { createGhRunner, createGithubTracker } from './adapters/tracker/github.js';
import { createLocalTracker, localIssuesDir } from './adapters/tracker/local.js';

/** What every refusal opens with: the registry's own opening. */
const REFUSAL = 'adapter registry';

/**
 * The registered default of `learning.bless.minConfidence`, for a
 * learning adapter made with none: read off the sections registered
 * with `section.ts`, since this module imports no list of them. Throws
 * when nothing registered one, naming the module that registers them.
 */
function registeredBlessMinConfidence(): number {
  const value = activeDefaults().learningBlessMinConfidence;
  if (value === undefined) {
    throw new Error(`${REFUSAL}: learning.bless.minConfidence has no registered default:`
      + ' call registerCoreConfigSections from src/config-registry.ts before making the local learning adapter without one');
  }
  return value;
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
 * store backends, in the order the config names them, then the `text`,
 * `json` and `events` outputs, then the `console` logger, then the
 * `local` and `github` trackers, then the `local` learning adapter, then
 * the `claude` planner, then the `local` and `file` sync strategies.
 * {@link registerCoreAdapters} hands them to core.
 */
export const CORE_ADAPTERS: readonly AnyAdapter[] = [
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
    port: 'output',
    kind: 'events',
    portVersion: PORT_VERSIONS.output,
    create: ({ stream = process.stdout }) => createEventsOutput({ stream }),
  },
  {
    port: 'logger',
    kind: 'console',
    portVersion: PORT_VERSIONS.logger,
    create: ({ verbosity = 0, colour = false }) => createConsoleLogger({ verbosity, colour }),
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
    create: ({
      repoRoot,
      home = homedir(),
      learningBlessMinConfidence = registeredBlessMinConfidence(),
    }) => createLocalLearning({
      instinctsDir: localInstinctsDir(repoRoot),
      home,
      minConfidence: learningBlessMinConfidence,
    }),
  },
  {
    port: 'planner',
    kind: 'claude',
    portVersion: PORT_VERSIONS.planner,
    create: ({ repoRoot, settingSources, planPrompt, planDir, claude }) => {
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
      if (typeof planDir !== 'string') {
        throw new TypeError(
          `${REFUSAL}: planner/claude has planDir ${describeValue(planDir)} in its context,`
            + ' expected a directory path',
        );
      }
      return createClaudePlanner({ repoRoot, planDir, settingSources, buildPrompt: planPrompt, spawn: claude });
    },
  },
  {
    port: 'sync',
    kind: 'local',
    portVersion: PORT_VERSIONS.sync,
    create: () => createLocalSync(),
  },
  {
    port: 'sync',
    kind: 'file',
    portVersion: PORT_VERSIONS.sync,
    create: ({ repoRoot, store }) => {
      if (!(STORE_BACKENDS as readonly unknown[]).includes(store)) {
        throw new TypeError(
          `${REFUSAL}: sync/file has store ${describeValue(store)} in its context,`
            + ` expected one of: ${STORE_BACKENDS.join(', ')}`,
        );
      }
      return createFileSync({ repoRoot, backend: store as StoreBackend });
    },
  },
];

/** Whether `registry` holds every adapter of {@link CORE_ADAPTERS}, each under its own kind. */
function holdsCoreAdapters(registry: AdapterRegistry): boolean {
  return CORE_ADAPTERS.every(
    (adapter) => registry.find(adapter.port, adapter.kind)?.create === adapter.create,
  );
}

/**
 * Registers {@link CORE_ADAPTERS} on the active registry through
 * `registerAdapters`, and answers the registry that call made: the active
 * one once the call returns, as `activeAdapterRegistry` answers it.
 *
 * When the active registry holds every one of them already, it
 * registers nothing and answers that registry, so the preload and an
 * entry may both call it in one process. Throws what `registerAdapters`
 * throws on an adapter core refuses, such as a kind of core's taken by
 * another adapter, leaving the active registry as it was.
 */
export function registerCoreAdapters(): AdapterRegistry {
  if (!holdsCoreAdapters(activeAdapterRegistry())) registerAdapters(CORE_ADAPTERS);
  return activeAdapterRegistry();
}
