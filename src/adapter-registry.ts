/**
 * The composition root of the adapter registry: core's adapters, listed
 * here and handed to core when this module is imported.
 *
 * Core declares the registry (`src/core/adapters/registry.ts`) and
 * imports no adapter: the adapters sit under `src/adapters/`,
 * `src/effort/store/` and `src/effort/sync/`, above core, and a core
 * file importing them would be an upward edge. This module, outside
 * `src/core/`, is the one place they are listed, {@link CORE_ADAPTERS}.
 * Importing it calls `registerAdapters` once with that list, so
 * `CORE_ADAPTER_REGISTRY` answers every core kind; a registration core
 * refuses throws at import, naming what it refused. `src/rafa.ts` and
 * `src/index.ts` import it right after `src/config-registry.ts`, before
 * anything that resolves an adapter; core never imports it. Until
 * something imports it, every member of `CORE_ADAPTER_REGISTRY` refuses,
 * naming this module.
 *
 * A test that reads core's adapters off `CORE_ADAPTER_REGISTRY`,
 * directly or through the module under test, imports this module for
 * its effect, as the entries do. Bun runs every test file in one
 * process, so a file that leaves it out may pass behind a file that
 * imported it and fail alone.
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
import type { AnyAdapter } from './core/adapters/index.js';
import type { StoreBackend } from './core/config/sections.js';
import type { SelectedEffortStore } from './effort/store/index.js';

import { homedir } from 'node:os';

import { createLocalLearning, localInstinctsDir } from './adapters/learning/local.js';
import { createConsoleLogger } from './adapters/logger/console.js';
import { createEventsOutput } from './adapters/output/events.js';
import { createJsonOutput } from './adapters/output/json.js';
import { createClaudePlanner } from './adapters/planner/claude.js';
import { createGhRunner, createGithubTracker } from './adapters/tracker/github.js';
import { createLocalTracker, localIssuesDir } from './adapters/tracker/local.js';
import { PORT_VERSIONS, registerAdapters } from './core/adapters/index.js';
import { activeDefaults } from './core/config/index.js';
import { describeValue, STORE_BACKENDS } from './core/config/sections.js';
import { createTextOutput } from './core/output/index.js';
import { openNdjsonStore } from './effort/store/ndjson.js';
import { openSqliteStore } from './effort/store/sqlite.js';
import { createFileSync } from './effort/sync/file.js';
import { createLocalSync } from './effort/sync/select.js';

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
      + ' import src/config-registry.ts before making the local learning adapter without one');
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
 * store backends, in the order the config names them, then the `text`
 * and `json` outputs, then the `local` and `github` trackers, then the
 * `local` learning adapter, then the `claude` planner, then the `local`
 * and `file` sync strategies.
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

registerAdapters(CORE_ADAPTERS);
